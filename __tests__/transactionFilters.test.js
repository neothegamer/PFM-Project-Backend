const request = require("supertest");
require("./setup");
const createApp = require("../app");
const Account = require("../models/Account");

const app = createApp();

async function registerAndLogin(email) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test", email, password: "password123" });
  return { token: res.body.token, userId: res.body.user.id };
}

async function addTxn(app, token, account, overrides) {
  return request(app)
    .post("/api/transactions")
    .set("Authorization", `Bearer ${token}`)
    .send({ account, name: "Txn", amount: 10, date: "2026-08-01", ...overrides });
}

describe("GET /api/transactions filters", () => {
  test("with no query params, behaves as before (most recent 200)", async () => {
    const { token, userId } = await registerAndLogin("tf1@example.com");
    const account = await Account.create({ user: userId, plaidAccountId: "tf1-acc", itemId: "tf1-item", name: "Checking" });
    await addTxn(app, token, account._id, { name: "A" });
    await addTxn(app, token, account._id, { name: "B" });

    const res = await request(app).get("/api/transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(2);
    expect(res.body.limit).toBe(200);
    expect(res.body.page).toBe(1);
  });

  test("filters by account", async () => {
    const { token, userId } = await registerAndLogin("tf2@example.com");
    const a = await Account.create({ user: userId, plaidAccountId: "tf2-a", itemId: "tf2-item", name: "A" });
    const b = await Account.create({ user: userId, plaidAccountId: "tf2-b", itemId: "tf2-item", name: "B" });
    await addTxn(app, token, a._id, { name: "From A" });
    await addTxn(app, token, b._id, { name: "From B" });

    const res = await request(app)
      .get(`/api/transactions?account=${a._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].name).toBe("From A");
  });

  test("a malformed account id returns 400", async () => {
    const { token } = await registerAndLogin("tf3@example.com");
    const res = await request(app).get("/api/transactions?account=nope").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("filters by category, case-insensitively", async () => {
    const { token, userId } = await registerAndLogin("tf4@example.com");
    const account = await Account.create({ user: userId, plaidAccountId: "tf4-acc", itemId: "tf4-item", name: "Checking" });
    await addTxn(app, token, account._id, { name: "Coffee", category: "Food and Drink" });
    await addTxn(app, token, account._id, { name: "Movie", category: "Entertainment" });

    const res = await request(app)
      .get("/api/transactions?category=food and drink")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].name).toBe("Coffee");
  });

  test("filters by date range, inclusive on both ends", async () => {
    const { token, userId } = await registerAndLogin("tf5@example.com");
    const account = await Account.create({ user: userId, plaidAccountId: "tf5-acc", itemId: "tf5-item", name: "Checking" });
    await addTxn(app, token, account._id, { name: "Early", date: "2026-07-01" });
    await addTxn(app, token, account._id, { name: "Mid", date: "2026-08-15" });
    await addTxn(app, token, account._id, { name: "Late", date: "2026-09-30" });

    const res = await request(app)
      .get("/api/transactions?from=2026-08-01&to=2026-08-31")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].name).toBe("Mid");
  });

  test("an invalid date returns 400", async () => {
    const { token } = await registerAndLogin("tf6@example.com");
    const res = await request(app).get("/api/transactions?from=not-a-date").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("paginates with limit and page", async () => {
    const { token, userId } = await registerAndLogin("tf7@example.com");
    const account = await Account.create({ user: userId, plaidAccountId: "tf7-acc", itemId: "tf7-item", name: "Checking" });
    for (let i = 0; i < 5; i++) {
      await addTxn(app, token, account._id, { name: `T${i}`, date: `2026-08-0${i + 1}` });
    }

    const page1 = await request(app)
      .get("/api/transactions?limit=2&page=1")
      .set("Authorization", `Bearer ${token}`);
    expect(page1.body.transactions).toHaveLength(2);
    // most recent first
    expect(page1.body.transactions[0].name).toBe("T4");

    const page2 = await request(app)
      .get("/api/transactions?limit=2&page=2")
      .set("Authorization", `Bearer ${token}`);
    expect(page2.body.transactions).toHaveLength(2);
    expect(page2.body.transactions[0].name).toBe("T2");
  });

  test("rejects a limit above the cap", async () => {
    const { token } = await registerAndLogin("tf8@example.com");
    const res = await request(app).get("/api/transactions?limit=501").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("rejects a non-positive page", async () => {
    const { token } = await registerAndLogin("tf9@example.com");
    const res = await request(app).get("/api/transactions?page=0").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("never returns another user's transactions", async () => {
    const owner = await registerAndLogin("tf10-owner@example.com");
    const other = await registerAndLogin("tf10-other@example.com");
    const account = await Account.create({ user: owner.userId, plaidAccountId: "tf10-acc", itemId: "tf10-item", name: "Checking" });
    await addTxn(app, owner.token, account._id, { name: "Owner's" });

    const res = await request(app).get("/api/transactions").set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(0);
  });
});
