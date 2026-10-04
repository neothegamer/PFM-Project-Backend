const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const Budget = require("../models/Budget");
const Transaction = require("../models/Transaction");
const { isNonEmptyString, isNonNegativeNumber } = require("../utils/validate");

const router = express.Router();

// GET /api/budgets — list this user's category limits
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const budgets = await Budget.find({ user: req.userId });
  res.json({ budgets });
}));

// PUT /api/budgets — create or update a category's monthly limit.
// color/notes are optional; when omitted on an update, existing values are kept.
router.put("/", requireAuth, asyncHandler(async (req, res) => {
  const { category, monthlyLimit, color, notes } = req.body;
  if (!isNonEmptyString(category) || monthlyLimit === undefined) {
    return res.status(400).json({ error: "category and monthlyLimit are required" });
  }
  if (!isNonNegativeNumber(monthlyLimit)) {
    return res.status(400).json({ error: "monthlyLimit must be a non-negative number" });
  }

  const set = { monthlyLimit: Number(monthlyLimit) };
  if (color !== undefined) {
    if (typeof color !== "string") return res.status(400).json({ error: "color must be a string" });
    set.color = color;
  }
  if (notes !== undefined) {
    if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });
    set.notes = notes;
  }

  const budget = await Budget.findOneAndUpdate(
    { user: req.userId, category: category.trim() },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ budget });
}));

// DELETE /api/budgets/:id — remove a category's monthly limit. Does not touch
// the transactions themselves, only the limit tracked against them.
router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid budget id" });
  }
  const budget = await Budget.findOneAndDelete({ _id: req.params.id, user: req.userId });
  if (!budget) return res.status(404).json({ error: "Budget not found" });
  res.json({ message: "Budget deleted", budget });
}));

// GET /api/budgets/status — each budget alongside this month's actual spend.
// Category matching is case-insensitive: spending is grouped by lowercased
// category in one aggregate, so "Food and Drink" matches "food and drink".
router.get("/status", requireAuth, asyncHandler(async (req, res) => {
  const budgets = await Budget.find({ user: req.userId });
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const rows = await Transaction.aggregate([
    { $match: { user: req.userId, date: { $gte: startOfMonth }, amount: { $gt: 0 } } },
    { $group: { _id: { $toLower: "$category" }, total: { $sum: "$amount" } } },
  ]);
  const spentByCat = new Map(rows.map((r) => [r._id, r.total]));

  const status = budgets.map((b) => {
    const spent = spentByCat.get(b.category.trim().toLowerCase()) || 0;
    return {
      category: b.category,
      monthlyLimit: b.monthlyLimit,
      spent,
      remaining: b.monthlyLimit - spent,
      overBudget: spent > b.monthlyLimit,
    };
  });

  res.json({ status });
}));

module.exports = router;