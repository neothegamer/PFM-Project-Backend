const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const { isNonEmptyString } = require("../utils/validate");

const router = express.Router();

// Marker value stored in `itemId` for accounts the user added by hand.
// Plaid-linked accounts carry the real Plaid item id, so "manual" cleanly
// separates the two sources everywhere itemId is inspected (balance sync,
// unlink, delete-guard below).
const MANUAL_ITEM_ID = "manual";

// Map the frontend's display labels onto Plaid-ish type values so the shape
// stays consistent with linked accounts.
function plaidTypeFor(displayType) {
  const t = displayType.trim().toLowerCase();
  if (t.includes("credit")) return "credit";
  if (t.includes("loan") || t.includes("mortgage")) return "loan";
  return "depository";
}

// POST /api/accounts/manual — create a manually-tracked account (Week 4 style
// feature: lets users track cash wallets / accounts their bank doesn't
// support through Plaid). The account behaves like a Plaid one everywhere
// else: it shows up in GET /api/plaid/accounts and transactions can be
// attached to it.
router.post(
  "/manual",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, institution, type, balance, mask, currency } = req.body;

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!isNonEmptyString(type)) {
      return res.status(400).json({ error: "type is required" });
    }

    // Balance is optional and may be negative (e.g. a credit card the user
    // tracks as outstanding debt), but it must be a real number.
    const openingBalance = balance === undefined || balance === null || balance === "" ? 0 : Number(balance);
    if (!Number.isFinite(openingBalance)) {
      return res.status(400).json({ error: "balance must be a number" });
    }

    // mask = last 4 digits, purely cosmetic. Generate a placeholder if the
    // user didn't supply one, matching the frontend's old local behavior.
    const rawMask = mask === undefined || mask === null ? "" : String(mask).replace(/\D/g, "");
    const finalMask = /^\d{1,4}$/.test(rawMask) ? rawMask.padStart(4, "0") : String(Math.floor(1000 + Math.random() * 9000));

    const account = await Account.create({
      user: req.userId,
      // Satisfies the unique index without touching the model. The random
      // suffix makes same-millisecond double-submits safe.
      plaidAccountId: `manual_${req.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      itemId: MANUAL_ITEM_ID,
      institutionName: isNonEmptyString(institution) ? institution.trim() : "Manual Account",
      name: name.trim(),
      officialName: name.trim(),
      type: plaidTypeFor(type),
      subtype: type.trim(), // what the UI displays (mapAccount prefers subtype)
      mask: finalMask,
      currentBalance: openingBalance,
      availableBalance: openingBalance,
      isoCurrencyCode: isNonEmptyString(currency) ? currency.trim() : "USD",
    });

    res.status(201).json({ account });
  })
);

// DELETE /api/accounts/:id — remove a MANUAL account and its transactions.
// Plaid-linked accounts are rejected here: they must go through
// DELETE /api/plaid/items/:itemId, which disconnects the item at Plaid first.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid account id" });
    }

    const account = await Account.findOne({ _id: req.params.id, user: req.userId });
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (account.itemId !== MANUAL_ITEM_ID) {
      return res.status(400).json({
        error: "This account is linked through Plaid — disconnect the bank instead.",
      });
    }

    await Transaction.deleteMany({ user: req.userId, account: account._id });
    await Account.deleteOne({ _id: account._id });

    res.json({ message: "Account deleted", account });
  })
);

module.exports = router;