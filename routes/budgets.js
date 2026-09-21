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

// PUT /api/budgets — create or update a category's monthly limit
router.put("/", requireAuth, asyncHandler(async (req, res) => {
  const { category, monthlyLimit } = req.body;
  if (!isNonEmptyString(category) || monthlyLimit === undefined) {
    return res.status(400).json({ error: "category and monthlyLimit are required" });
  }
  if (!isNonNegativeNumber(monthlyLimit)) {
    return res.status(400).json({ error: "monthlyLimit must be a non-negative number" });
  }
  const budget = await Budget.findOneAndUpdate(
    { user: req.userId, category: category.trim() },
    { monthlyLimit: Number(monthlyLimit) },
    { upsert: true, new: true }
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

// GET /api/budgets/status — each budget alongside this month's actual spend
router.get("/status", requireAuth, asyncHandler(async (req, res) => {
  const budgets = await Budget.find({ user: req.userId });
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const status = await Promise.all(
    budgets.map(async (b) => {
      const spent = await Transaction.aggregate([
        { $match: { user: req.userId, category: b.category, date: { $gte: startOfMonth }, amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const spentTotal = spent[0]?.total || 0;
      return {
        category: b.category,
        monthlyLimit: b.monthlyLimit,
        spent: spentTotal,
        remaining: b.monthlyLimit - spentTotal,
        overBudget: spentTotal > b.monthlyLimit,
      };
    })
  );

  res.json({ status });
}));

module.exports = router;
