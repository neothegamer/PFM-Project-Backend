const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plaidAccountId: { type: String, required: true, unique: true },
    itemId: { type: String, required: true },
    institutionName: { type: String }, // e.g. "First Platypus Bank"
    name: { type: String, required: true },
    officialName: { type: String },
    type: { type: String }, // e.g. "depository", "credit"
    subtype: { type: String }, // e.g. "checking", "savings"
    mask: { type: String }, // last 4 digits
    currentBalance: { type: Number, default: 0 }, // null = unknown (Plaid did not report one)
    availableBalance: { type: Number, default: 0 }, // null = unknown, e.g. some credit accounts
    isoCurrencyCode: { type: String, default: "USD" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Account", accountSchema);
