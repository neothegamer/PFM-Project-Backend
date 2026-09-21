const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const Transaction = require("../models/Transaction");
const Account = require("../models/Account");
const categorizeTransaction = require("../utils/categorize");

const router = express.Router();

// Only these fields may be changed through PUT. Everything else (user, account,
// plaidTransactionId, isManual, ...) is server-controlled.
const EDITABLE_FIELDS = ["name", "amount", "date", "category"];

// GET /api/transactions — plain list, this is your "bare-bones frontend" data source (step 3)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const transactions = await Transaction.find({ user: req.userId }).sort({ date: -1 }).limit(200);
    res.json({ transactions });
  })
);

// POST /api/transactions — manually add one (Week 4 feature, but useful for testing without Plaid)
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { account, name, amount, date, category } = req.body;
    if (!account || !name || amount === undefined || !date) {
      return res.status(400).json({ error: "account, name, amount, and date are required" });
    }
    if (typeof name !== "string") {
      return res.status(400).json({ error: "name must be a string" });
    }
    if (!mongoose.isValidObjectId(account)) {
      return res.status(400).json({ error: "Invalid account id" });
    }

    // The account must belong to the logged-in user — otherwise anyone could
    // attach transactions to somebody else's account by guessing an id.
    const ownsAccount = await Account.exists({ _id: account, user: req.userId });
    if (!ownsAccount) return res.status(404).json({ error: "Account not found" });

    const txn = await Transaction.create({
      user: req.userId,
      account,
      name,
      amount,
      date,
      // If the user didn't specify a category, try our own merchant-name rules
      // before falling back to "Uncategorized" — same logic used for synced transactions.
      category: category || categorizeTransaction(name) || "Uncategorized",
      isManual: true,
    });
    res.status(201).json({ transaction: txn });
  })
);

// PUT /api/transactions/:id — edit a transaction (name, amount, date, category)
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid transaction id" });
    }

    // Whitelist: never pass req.body straight into the update.
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `Provide at least one of: ${EDITABLE_FIELDS.join(", ")}` });
    }
    updates.isEdited = true; // tells Plaid sync not to overwrite this later

    const txn = await Transaction.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!txn) return res.status(404).json({ error: "Transaction not found" });
    res.json({ transaction: txn });
  })
);

// DELETE /api/transactions/:id — remove a transaction (e.g. a mistaken manual entry)
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid transaction id" });
    }
    const txn = await Transaction.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!txn) return res.status(404).json({ error: "Transaction not found" });
    res.json({ message: "Transaction deleted", transaction: txn });
  })
);

// GET /api/transactions/summary/by-category — powers the pie chart (spending breakdown).
// Only expenses (positive amounts, Plaid convention) count as "spending"; income
// is negative and would otherwise show up as a negative slice.
router.get(
  "/summary/by-category",
  requireAuth,
  asyncHandler(async (req, res) => {
    const summary = await Transaction.aggregate([
      { $match: { user: req.userId, amount: { $gt: 0 } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);
    res.json({ summary });
  })
);

// GET /api/transactions/summary/by-month — powers the bar chart (income vs. expense).
// Under the Plaid convention used throughout this app, a positive amount is an
// expense and a negative amount is income, so the split happens in one aggregate
// stage rather than being computed client-side.
router.get(
  "/summary/by-month",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await Transaction.aggregate([
      { $match: { user: req.userId } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$date" } },
          income: { $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] } },
          expense: { $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const summary = rows.map((r) => ({ month: r._id, income: r.income, expense: r.expense }));
    res.json({ summary });
  })
);

module.exports = router;
