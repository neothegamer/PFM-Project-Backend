const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const plaidClient = require("../config/plaid");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { authLimiter } = require("../middleware/rateLimit");
const { decryptToken } = require("../utils/crypto");
const { isNonEmptyString, isValidEmail, isValidPassword } = require("../utils/validate");
const { removeItemAtPlaid } = require("../utils/plaidUnlink");

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// POST /api/auth/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // typeof checks first: without them an object like {"$ne": null} for email
    // would reach User.findOne/create as a query operator instead of a value.
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const user = await User.create({ name: name.trim(), email: normalizedEmail, password }); // hashed by pre-save hook
    const token = signToken(user._id);

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Same typeof guard as register — a non-string here must never reach findOne.
    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/auth/me — sanity check that a token works
router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select("-password -plaidItems.accessToken");
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
}));

// PUT /api/auth/me — update profile fields. Only name is editable here;
// email changes aren't supported yet (it's also the login identifier, so
// changing it needs its own verification step this app doesn't have).
router.put("/me", requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: "name is required" });
  }
  const user = await User.findByIdAndUpdate(
    req.userId,
    { name: name.trim() },
    { new: true, runValidators: true }
  ).select("-password -plaidItems.accessToken");
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
}));

// PUT /api/auth/me/password — change password. Requires the current password
// so a hijacked, still-logged-in session token can't be used to lock the real
// owner out.
router.put("/me/password", requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const match = await user.comparePassword(currentPassword);
  if (!match) return res.status(401).json({ error: "Current password is incorrect" });

  user.password = newPassword; // re-hashed by the pre-save hook
  await user.save();
  res.json({ message: "Password updated" });
}));

// DELETE /api/auth/me — permanently delete the account and everything tied to
// it: linked banks (removed at Plaid first, same as DELETE
// /api/plaid/items/:itemId), their accounts and transactions, and budgets.
// Requires the current password as confirmation, since this can't be undone.
router.delete("/me", requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!isNonEmptyString(password)) {
    return res.status(400).json({ error: "password is required to delete your account" });
  }

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const match = await user.comparePassword(password);
  if (!match) return res.status(401).json({ error: "Incorrect password" });

  // Plaid first, and only local data belonging to items that were
  // successfully removed (or already gone) gets deleted — matches the same
  // rule used for a single unlink, just applied per item.
  for (const item of user.plaidItems) {
    const result = await removeItemAtPlaid(plaidClient, decryptToken(item.accessToken));
    if (!result.ok) {
      return res.status(502).json({
        error: "Could not disconnect one of your linked banks. Please try again.",
        itemId: item.itemId,
        plaidError: result.errorCode,
      });
    }
  }

  await Transaction.deleteMany({ user: req.userId });
  await Account.deleteMany({ user: req.userId });
  await Budget.deleteMany({ user: req.userId });
  await User.findByIdAndDelete(req.userId);

  res.json({ message: "Account and all associated data deleted" });
}));

module.exports = router;
