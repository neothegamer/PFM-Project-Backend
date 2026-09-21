const Account = require("../models/Account");

// Create or update the local Account documents for the accounts Plaid returned for one bank.
// Shared by "link a bank" and "refresh balances" so both store accounts the same way.
//
// Safety: an account that already belongs to a DIFFERENT user is skipped, never overwritten,
// so one user's data can't be changed by another user's link or refresh.
// Balances Plaid doesn't know are saved as null ("unknown"), not 0.
// Returns the accounts that were saved.
async function saveAccounts({ userId, itemId, plaidAccounts, institutionName }) {
  const ids = plaidAccounts.map((acc) => acc.account_id);
  const foreign = await Account.find({ plaidAccountId: { $in: ids }, user: { $ne: userId } }).select("plaidAccountId");
  const foreignIds = new Set(foreign.map((a) => a.plaidAccountId));

  const saved = await Promise.all(
    plaidAccounts
      .filter((acc) => !foreignIds.has(acc.account_id))
      .map(async (acc) => {
        const fields = {
          user: userId,
          plaidAccountId: acc.account_id,
          itemId,
          name: acc.name,
          officialName: acc.official_name,
          type: acc.type,
          subtype: acc.subtype,
          mask: acc.mask,
          currentBalance: acc.balances.current ?? null,
          availableBalance: acc.balances.available ?? null,
          isoCurrencyCode: acc.balances.iso_currency_code || "USD",
        };
        // Only overwrite the stored bank name when we actually know it.
        if (institutionName) fields.institutionName = institutionName;

        try {
          return await Account.findOneAndUpdate({ plaidAccountId: acc.account_id, user: userId }, fields, {
            upsert: true,
            new: true,
          });
        } catch (err) {
          if (err.code === 11000) return null; // lost a race with another user's copy — skip it
          throw err;
        }
      })
  );

  return saved.filter(Boolean);
}

module.exports = { saveAccounts };
