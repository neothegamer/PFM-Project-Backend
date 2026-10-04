const mongoose = require("mongoose");

const budgetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, required: true },
    monthlyLimit: { type: Number, required: true },
    color: { type: String, default: "#8B5CF6" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

budgetSchema.index({ user: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Budget", budgetSchema);