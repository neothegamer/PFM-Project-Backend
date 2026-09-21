const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { authLimiter } = require("../middleware/rateLimit");
const { isNonEmptyString, isValidEmail, isValidPassword } = require("../utils/validate");

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

module.exports = router;
