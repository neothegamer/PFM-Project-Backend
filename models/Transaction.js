const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    plaidTransactionId: { type: String, unique: true, sparse: true }, // absent for manually added transactions
    name: { type: String, required: true }, // merchant / description
    amount: { type: Number, required: true }, // positive = expense, negative = income (Plaid convention)
    date: { type: Date, required: true },
    category: { type: String, default: "Uncategorized" }, // filled in by categorization logic later
    isManual: { type: Boolean, default: false }, // true if created by the user directly
    isEdited: { type: Boolean, default: false }, // true once the user edits it; Plaid sync then leaves it alone
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
