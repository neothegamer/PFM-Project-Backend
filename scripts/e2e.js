/**
 * End-to-end smoke test for the PFM backend (Week 4 deliverable).
 *
 * Flow (no browser / Plaid Link UI required):
 *   1. Health check
 *   2. Register a throwaway user
 *   3. Create a Plaid sandbox public_token via the Plaid API
 *   4. Exchange it → accounts appear
 *   5. Sync transactions
 *   6. Refresh balances
 *   7. Manually add / edit / delete a transaction
 *   8. Hit summary + budget endpoints
 *
 * Prerequisites:
 *   - Server running (`npm run dev` or `npm start`) on BASE_URL
 *   - Real Plaid sandbox keys in .env (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV=sandbox)
 *   - MongoDB reachable (the same one the server uses)
 *
 * Usage:
 *   node scripts/e2e.js
 *   BASE_URL=http://localhost:5000 node scripts/e2e.js
 */

require("dotenv").config();
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const INSTITUTION_ID = "ins_109508"; // First Platypus Bank (sandbox)

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});
const plaid = new PlaidApi(plaidConfig);

let passed = 0;
let failed = 0;

function ok(label, detail = "") {
  passed++;
  console.log(`  ✅  ${label}${detail ? " — " + detail : ""}`);
}
function fail(label, err) {
  failed++;
  console.error(`  ❌  ${label}`);
  console.error(`      ${err?.message || err}`);
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function main() {
  console.log("\nPFM Backend — E2E smoke test");
  console.log(`Target: ${BASE_URL}\n`);

  // ── 1. Health ──────────────────────────────────────────────────────────
  try {
    const { status, data } = await api("GET", "/api/health");
    if (status === 200 && data.status === "ok") ok("GET /api/health");
    else fail("GET /api/health", `status ${status}`);
  } catch (e) {
    fail("GET /api/health (is the server running?)", e);
    process.exit(1);
  }

  // ── 2. Register ────────────────────────────────────────────────────────
  const email = `e2e-${Date.now()}@example.com`;
  const password = "password123";
  let token, userId;
  try {
    const { status, data } = await api("POST", "/api/auth/register", {
      body: { name: "E2E Tester", email, password },
    });
    if (status === 201 && data.token) {
      token = data.token;
      userId = data.user.id;
      ok("POST /api/auth/register", email);
    } else {
      fail("POST /api/auth/register", JSON.stringify(data));
      process.exit(1);
    }
  } catch (e) {
    fail("POST /api/auth/register", e);
    process.exit(1);
  }

  // ── 3. /me ─────────────────────────────────────────────────────────────
  try {
    const { status, data } = await api("GET", "/api/auth/me", { token });
    if (status === 200 && data.user?.email === email) ok("GET /api/auth/me");
    else fail("GET /api/auth/me", JSON.stringify(data));
  } catch (e) {
    fail("GET /api/auth/me", e);
  }

  // ── 4. Sandbox public token → exchange ─────────────────────────────────
  let publicToken;
  try {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      throw new Error("PLAID_CLIENT_ID / PLAID_SECRET missing from .env");
    }
    const createRes = await plaid.sandboxPublicTokenCreate({
      institution_id: INSTITUTION_ID,
      initial_products: ["transactions"],
    });
    publicToken = createRes.data.public_token;
    ok("Plaid sandboxPublicTokenCreate", publicToken.slice(0, 24) + "…");
  } catch (e) {
    fail("Plaid sandboxPublicTokenCreate", e.response?.data || e);
    console.log("\n  Skipping remaining Plaid steps (no public_token).\n");
    summary();
    process.exit(failed ? 1 : 0);
  }

  let accountId;
  try {
    const { status, data } = await api("POST", "/api/plaid/exchange-public-token", {
      token,
      body: { public_token: publicToken },
    });
    if (status === 200 && data.accounts?.length) {
      accountId = data.accounts[0]._id;
      ok("POST /api/plaid/exchange-public-token", `${data.accounts.length} account(s)`);
    } else {
      fail("POST /api/plaid/exchange-public-token", JSON.stringify(data));
    }
  } catch (e) {
    fail("POST /api/plaid/exchange-public-token", e);
  }

  // ── 5. Accounts ────────────────────────────────────────────────────────
  try {
    const { status, data } = await api("GET", "/api/plaid/accounts", { token });
    if (status === 200 && data.accounts?.length) {
      ok("GET /api/plaid/accounts", `${data.accounts.length} account(s)`);
      if (!accountId) accountId = data.accounts[0]._id;
    } else {
      fail("GET /api/plaid/accounts", JSON.stringify(data));
    }
  } catch (e) {
    fail("GET /api/plaid/accounts", e);
  }

  // ── 6. Sync transactions ───────────────────────────────────────────────
  try {
    const { status, data } = await api("POST", "/api/plaid/sync-transactions", { token });
    if (status === 200) {
      ok("POST /api/plaid/sync-transactions", data.message || JSON.stringify(data));
    } else {
      fail("POST /api/plaid/sync-transactions", JSON.stringify(data));
    }
  } catch (e) {
    fail("POST /api/plaid/sync-transactions", e);
  }

  // ── 7. Refresh balances ────────────────────────────────────────────────
  try {
    const { status, data } = await api("POST", "/api/plaid/refresh-balances", { token });
    if (status === 200) {
      ok("POST /api/plaid/refresh-balances", data.message || `${data.accounts?.length || 0} accounts`);
    } else {
      fail("POST /api/plaid/refresh-balances", JSON.stringify(data));
    }
  } catch (e) {
    fail("POST /api/plaid/refresh-balances", e);
  }

  // ── 8. Manual transaction CRUD ─────────────────────────────────────────
  let manualId;
  if (accountId) {
    try {
      const { status, data } = await api("POST", "/api/transactions", {
        token,
        body: {
          account: accountId,
          name: "E2E Coffee",
          amount: 4.5,
          date: new Date().toISOString().slice(0, 10),
          category: "Food & Drink",
        },
      });
      if (status === 201 || status === 200) {
        manualId = data.transaction?._id || data._id;
        ok("POST /api/transactions (manual)", manualId);
      } else {
        fail("POST /api/transactions", JSON.stringify(data));
      }
    } catch (e) {
      fail("POST /api/transactions", e);
    }

    if (manualId) {
      try {
        const { status, data } = await api("PUT", `/api/transactions/${manualId}`, {
          token,
          body: { name: "E2E Coffee (edited)", amount: 5.0 },
        });
        if (status === 200) ok("PUT /api/transactions/:id");
        else fail("PUT /api/transactions/:id", JSON.stringify(data));
      } catch (e) {
        fail("PUT /api/transactions/:id", e);
      }

      try {
        const { status } = await api("DELETE", `/api/transactions/${manualId}`, { token });
        if (status === 200 || status === 204) ok("DELETE /api/transactions/:id");
        else fail("DELETE /api/transactions/:id", `status ${status}`);
      } catch (e) {
        fail("DELETE /api/transactions/:id", e);
      }
    }
  } else {
    fail("Manual transaction CRUD", "no accountId available");
  }

  // ── 9. Summaries ───────────────────────────────────────────────────────
  try {
    const { status, data } = await api("GET", "/api/transactions/summary/by-category", { token });
    if (status === 200) ok("GET /api/transactions/summary/by-category");
    else fail("GET /api/transactions/summary/by-category", JSON.stringify(data));
  } catch (e) {
    fail("GET /api/transactions/summary/by-category", e);
  }

  try {
    const { status, data } = await api("GET", "/api/transactions/summary/by-month", { token });
    if (status === 200) ok("GET /api/transactions/summary/by-month");
    else fail("GET /api/transactions/summary/by-month", JSON.stringify(data));
  } catch (e) {
    fail("GET /api/transactions/summary/by-month", e);
  }

  // ── 10. Budgets ────────────────────────────────────────────────────────
  try {
    const { status, data } = await api("PUT", "/api/budgets", {
      token,
      body: { category: "Food & Drink", monthlyLimit: 200 },
    });
    if (status === 200 || status === 201) ok("PUT /api/budgets");
    else fail("PUT /api/budgets", JSON.stringify(data));
  } catch (e) {
    fail("PUT /api/budgets", e);
  }

  try {
    const { status, data } = await api("GET", "/api/budgets/status", { token });
    if (status === 200) ok("GET /api/budgets/status");
    else fail("GET /api/budgets/status", JSON.stringify(data));
  } catch (e) {
    fail("GET /api/budgets/status", e);
  }

  // ── 11. List transactions ──────────────────────────────────────────────
  try {
    const { status, data } = await api("GET", "/api/transactions", { token });
    if (status === 200 && Array.isArray(data.transactions)) {
      ok("GET /api/transactions", `${data.transactions.length} row(s)`);
    } else {
      fail("GET /api/transactions", JSON.stringify(data));
    }
  } catch (e) {
    fail("GET /api/transactions", e);
  }

  summary();
  process.exit(failed ? 1 : 0);
}

function summary() {
  console.log(`\n────────────────────────────`);
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  console.log(`────────────────────────────\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
