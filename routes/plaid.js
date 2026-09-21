const express = require("express");
const plaidClient = require("../config/plaid");
const requireAuth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const categorizeTransaction = require("../utils/categorize");
const { encryptToken, decryptToken } = require("../utils/crypto");
const { fetchAllTransactions } = require("../utils/plaidTransactions");
const { getInstitutionName, isPlaceholderBankName, FALLBACK_BANK_NAME } = require("../utils/plaidInstitution");
const { saveAccounts } = require("../utils/accounts");

const router = express.Router();

// POST /api/plaid/create-link-token
router.post("/create-link-token", requireAuth, async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: req.userId.toString() },
      client_name: "PFM Dashboard",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create link token" });
  }
});

// POST /api/plaid/exchange-public-token
router.post("/exchange-public-token", requireAuth, async (req, res) => {
  try {
    const { public_token } = req.body;
    if (!public_token) return res.status(400).json({ error: "public_token is required" });

    const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchange.data;

    // Look up the bank's display name; fall back to a generic label if Plaid can't give one.
    const institutionName = (await getInstitutionName(plaidClient, access_token)) || FALLBACK_BANK_NAME;

    await User.findByIdAndUpdate(req.userId, {
      $push: {
        plaidItems: {
          accessToken: encryptToken(access_token),
          itemId: item_id,
          institutionName,
        },
      },
    });

    // Pull accounts immediately
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const savedAccounts = await saveAccounts({
      userId: req.userId,
      itemId: item_id,
      plaidAccounts: accountsResponse.data.accounts,
      institutionName,
    });

    res.json({ message: "Bank account connected", accounts: savedAccounts });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to exchange public token" });
  }
});

// GET /api/plaid/accounts
router.get("/accounts", requireAuth, asyncHandler(async (req, res) => {
  const accounts = await Account.find({ user: req.userId });
  res.json({ accounts });
}));

// POST /api/plaid/sync-transactions
router.post("/sync-transactions", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user.plaidItems.length) {
      return res.status(400).json({ error: "No linked bank accounts" });
    }

    let totalSynced = 0;
    let skippedEdited = 0;
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = new Date().toISOString().slice(0, 10);

    const accounts = await Account.find({ user: req.userId });
    const accountByPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a]));

    for (const item of user.plaidItems) {
      const transactions = await fetchAllTransactions(plaidClient, {
        accessToken: decryptToken(item.accessToken),
        startDate,
        endDate,
      });

      for (const txn of transactions) {
        const account = accountByPlaidId.get(txn.account_id);
        if (!account) continue;

        const existing = await Transaction.findOne({ plaidTransactionId: txn.transaction_id }).select("isEdited");
        if (existing && existing.isEdited) {
          skippedEdited++;
          continue;
        }

        await Transaction.findOneAndUpdate(
          { plaidTransactionId: txn.transaction_id },
          {
            user: req.userId,
            account: account._id,
            plaidTransactionId: txn.transaction_id,
            name: txn.name,
            amount: txn.amount,
            date: new Date(txn.date),
            category: categorizeTransaction(txn.name) || txn.category?.[0] || "Uncategorized",
          },
          { upsert: true }
        );
        totalSynced++;
      }
    }

    res.json({ message: `Synced ${totalSynced} transactions`, skippedEdited });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to sync transactions" });
  }
});

// POST /api/plaid/refresh-balances — re-read balances for every linked bank
//
// Uses /accounts/get, which returns the balances Plaid has cached (Plaid refreshes them
// periodically). For real-time balances, swap in plaidClient.accountsBalanceGet — Plaid bills
// that endpoint per request in production.
//
// Each bank is refreshed independently: if one fails (e.g. ITEM_LOGIN_REQUIRED, meaning the
// user must reconnect it) it is listed in `failed` and the others still refresh. Only if EVERY
// linked bank fails does this return 500. Also replaces a placeholder bank name (an old
// "ins_..." id or "Connected Bank") with the real name when it can.
router.post("/refresh-balances", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.plaidItems?.length) {
      return res.status(400).json({ error: "No linked bank accounts" });
    }

    let refreshed = 0;
    const failed = [];

    for (const item of user.plaidItems) {
      try {
        const accessToken = decryptToken(item.accessToken);
        const response = await plaidClient.accountsGet({ access_token: accessToken });

        let institutionName = item.institutionName;
        if (isPlaceholderBankName(institutionName)) {
          const resolved = await getInstitutionName(plaidClient, accessToken);
          if (resolved) {
            institutionName = resolved;
            await User.updateOne(
              { _id: req.userId, "plaidItems.itemId": item.itemId },
              { $set: { "plaidItems.$.institutionName": resolved } }
            );
          } else {
            institutionName = null; // still unknown — leave the accounts' stored name alone
          }
        }

        const saved = await saveAccounts({
          userId: req.userId,
          itemId: item.itemId,
          plaidAccounts: response.data.accounts,
          institutionName,
        });
        refreshed += saved.length;
      } catch (err) {
        const code = err.response?.data?.error_code || "REFRESH_FAILED";
        console.error(`Balance refresh failed for item ${item.itemId}:`, err.response?.data || err.message);
        failed.push({
          itemId: item.itemId,
          institutionName: isPlaceholderBankName(item.institutionName) ? null : item.institutionName,
          error: code,
        });
      }
    }

    if (failed.length === user.plaidItems.length) {
      return res.status(500).json({ error: "Failed to refresh balances", failed });
    }

    // Return every account (not just the refreshed ones) so the frontend can replace its list.
    const accounts = await Account.find({ user: req.userId });
    res.json({ message: `Refreshed balances for ${refreshed} account(s)`, refreshed, failed, accounts });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to refresh balances" });
  }
});

module.exports = router;
