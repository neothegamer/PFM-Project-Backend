const Account = require("../models/Account");

const MANUAL_ITEM_ID = "manual";

// Adjust a manual account's stored balances when one of its transactions is
// created, edited, or deleted. Plaid convention throughout this app: a
// positive amount is money OUT (reduces the balance), a negative amount is
// money IN (raises it). So the balance delta is always `-amount`.
//
// No-op for Plaid-linked accounts (their balances come from Plaid on the
// next refresh) — detected by the itemId filter inside the query itself, so
// the caller never needs to know which kind of account it's touching.
//
// Returns the updated account, or null if it wasn't a manual account.
async function adjustManualBalance(accountId, delta) {
  if (!delta) return null; // nothing to do — saves a write on no-op edits
  return Account.findOneAndUpdate(
    { _id: accountId, itemId: MANUAL_ITEM_ID },
    { $inc: { currentBalance: delta, availableBalance: delta } },
    { new: true }
  );
}

module.exports = { adjustManualBalance, MANUAL_ITEM_ID };