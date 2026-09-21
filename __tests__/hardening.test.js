const request = require("supertest");
require("./setup");

// Stub the Plaid client so the sync route can be tested without network access.
jest.mock("../config/plaid", () => ({ transactionsGet: jest.fn() }));

const plaidClient = require("../config/plaid");
const createApp = require("../app");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");

const app = createApp();

async function register(email) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test", email, password: "password123" });
  return { token: res.body.token, userId: res.body.user.id };
}

async function makeAccount(userId, plaidAccountId) {
  return Account.create({ user: userId, plaidAccountId, itemId: `item-${plaidAccountId}`, name: "Checking" });
}

describe("Malformed ids no longer crash the server", () => {
  test("PUT with a malformed id returns 400 and the server keeps responding", async () => {
    const { token } = await register("h1@example.com");
    const res = await request(app)
      .put("/api/transactions/not-an-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Food" });
    expect(res.status).toBe(400);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });

  test("DELETE with a malformed id returns 400", async () => {
    const { token } = await register("h2@example.com");
    const res = await request(app).delete("/api/transactions/not-an-id").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("malformed JSON body returns 400 instead of an HTML error page", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{ not valid json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test("unknown routes return a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe("PUT /api/transactions/:id only changes whitelisted fields", () => {
  test("ignores protected fields like user, isManual and plaidTransactionId", async () => {
    const { token, userId } = await register("h3@example.com");
    const other = await register("h3-other@example.com");
    const account = await makeAccount(userId, "hard-acc-1");
    const add = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({ account: account._id, name: "Lunch", amount: 12, date: "2026-08-01" });

    const res = await request(app)
      .put(`/api/transactions/${add.body.transaction._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Food", user: other.userId, isManual: false, plaidTransactionId: "hijack" });
    expect(res.status).toBe(200);

    const saved = await Transaction.findById(add.body.transaction._id);
    expect(saved.category).toBe("Food");
    expect(saved.user.toString()).toBe(userId);
    expect(saved.isManual).toBe(true);
    expect(saved.plaidTransactionId).toBeUndefined();
    expect(saved.isEdited).toBe(true);
  });

  test("rejects an update that contains no editable fields", async () => {
    const { token, userId } = await register("h4@example.com");
    const account = await makeAccount(userId, "hard-acc-2");
    const add = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({ account: account._id, name: "Lunch", amount: 12, date: "2026-08-01" });

    const res = await request(app)
      .put(`/api/transactions/${add.body.transaction._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isManual: false });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/transactions checks account ownership", () => {
  test("cannot attach a transaction to another user's account", async () => {
    const victim = await register("h5-victim@example.com");
    const attacker = await register("h5-attacker@example.com");
    const victimAccount = await makeAccount(victim.userId, "hard-acc-3");

    const res = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${attacker.token}`)
      .send({ account: victimAccount._id, name: "Injected", amount: 99, date: "2026-08-01" });
    expect(res.status).toBe(404);
    expect(await Transaction.countDocuments()).toBe(0);
  });

  test("a malformed account id returns 400", async () => {
    const { token } = await register("h6@example.com");
    const res = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({ account: "nope", name: "X", amount: 1, date: "2026-08-01" });
    expect(res.status).toBe(400);
  });
});

describe("Spending by category excludes income", () => {
  test("income (negative amounts) does not appear in the pie chart data", async () => {
    const { token, userId } = await register("h7@example.com");
    const account = await makeAccount(userId, "hard-acc-4");
    const post = (body) =>
      request(app)
        .post("/api/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({ account: account._id, date: "2026-08-01", ...body });
    await post({ name: "Groceries", amount: 50, category: "Food" });
    await post({ name: "Paycheck", amount: -1500, category: "Income" });

    const res = await request(app).get("/api/transactions/summary/by-category").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveLength(1);
    expect(res.body.summary[0]).toMatchObject({ _id: "Food", total: 50 });
  });
});

describe("Plaid sync preserves user edits", () => {
  test("skips edited transactions but still updates untouched ones", async () => {
    const { token, userId } = await register("h8@example.com");
    await User.findByIdAndUpdate(userId, { $push: { plaidItems: { accessToken: "test-token", itemId: "item-1" } } });
    const account = await makeAccount(userId, "hard-acc-5");

    await Transaction.create({
      user: userId, account: account._id, plaidTransactionId: "t-edited",
      name: "My corrected name", amount: 10, date: new Date(), category: "Custom", isEdited: true,
    });
    await Transaction.create({
      user: userId, account: account._id, plaidTransactionId: "t-untouched",
      name: "Old name", amount: 5, date: new Date(), category: "Uncategorized",
    });

    plaidClient.transactionsGet.mockResolvedValue({
      data: {
        transactions: [
          { transaction_id: "t-edited", account_id: "hard-acc-5", name: "Plaid overwrote me", amount: 99, date: "2026-08-01", category: ["Other"] },
          { transaction_id: "t-untouched", account_id: "hard-acc-5", name: "Starbucks #1", amount: 6, date: "2026-08-02", category: ["Other"] },
        ],
      },
    });

    const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.skippedEdited).toBe(1);

    const edited = await Transaction.findOne({ plaidTransactionId: "t-edited" });
    expect(edited).toMatchObject({ name: "My corrected name", amount: 10, category: "Custom" });

    const untouched = await Transaction.findOne({ plaidTransactionId: "t-untouched" });
    expect(untouched).toMatchObject({ name: "Starbucks #1", amount: 6, category: "Food and Drink" });
  });
});
