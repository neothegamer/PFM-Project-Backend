const request = require("supertest");
require("./setup");
const createApp = require("../app");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");

const app = createApp();

// Every route filters by the logged-in user. These tests prove that user B can never
// read, change or delete user A's data — the most important security property of the API.

async function makeUser(name) {
  const email = `${name}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ name, email, password: "password123" });
  const account = await Account.create({
    user: res.body.user.id,
    plaidAccountId: `acc-${name}`,
    itemId: `item-${name}`,
    name: `${name} checking`,
  });
  return { email, userId: res.body.user.id, account, auth: { Authorization: `Bearer ${res.body.token}` } };
}

// Uses "now" (not just today's date) so the transaction always falls inside the current month.
const addTxn = (user, body) =>
  request(app)
    .post("/api/transactions")
    .set(user.auth)
    .send({ account: user.account._id, date: new Date().toISOString(), ...body });

describe("User data isolation", () => {
  test("each user only sees their own transactions", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await addTxn(a, { name: "Alice coffee", amount: 5 });
    await addTxn(b, { name: "Bob rent", amount: 500 });

    const listA = await request(app).get("/api/transactions").set(a.auth);
    const listB = await request(app).get("/api/transactions").set(b.auth);
    expect(listA.body.transactions.map((t) => t.name)).toEqual(["Alice coffee"]);
    expect(listB.body.transactions.map((t) => t.name)).toEqual(["Bob rent"]);
  });

  test("cannot edit another user's transaction", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    const created = await addTxn(a, { name: "Alice coffee", amount: 5, category: "Food and Drink" });
    const id = created.body.transaction._id;

    const res = await request(app).put(`/api/transactions/${id}`).set(b.auth).send({ name: "Hacked", category: "Shopping" });
    expect(res.status).toBe(404);

    const untouched = await Transaction.findById(id);
    expect(untouched.name).toBe("Alice coffee");
    expect(untouched.category).toBe("Food and Drink");
  });

  test("cannot delete another user's transaction", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    const created = await addTxn(a, { name: "Alice coffee", amount: 5 });

    const res = await request(app).delete(`/api/transactions/${created.body.transaction._id}`).set(b.auth);
    expect(res.status).toBe(404);
    expect(await Transaction.countDocuments()).toBe(1);
  });

  test("summaries only include the caller's data", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await addTxn(a, { name: "Alice lunch", amount: 10, category: "Food" });
    await addTxn(b, { name: "Bob lunch", amount: 500, category: "Food" });

    const byCategory = await request(app).get("/api/transactions/summary/by-category").set(a.auth);
    expect(byCategory.body.summary).toHaveLength(1);
    expect(byCategory.body.summary[0]).toMatchObject({ _id: "Food", total: 10 });

    const byMonth = await request(app).get("/api/transactions/summary/by-month").set(a.auth);
    const totalExpense = byMonth.body.summary.reduce((sum, m) => sum + m.expense, 0);
    expect(totalExpense).toBe(10);
  });

  test("each user has their own budgets, even for the same category", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await request(app).put("/api/budgets").set(a.auth).send({ category: "Food", monthlyLimit: 100 });
    await request(app).put("/api/budgets").set(b.auth).send({ category: "Food", monthlyLimit: 500 });

    const listA = await request(app).get("/api/budgets").set(a.auth);
    const listB = await request(app).get("/api/budgets").set(b.auth);
    expect(listA.body.budgets).toHaveLength(1);
    expect(listA.body.budgets[0].monthlyLimit).toBe(100);
    expect(listB.body.budgets).toHaveLength(1);
    expect(listB.body.budgets[0].monthlyLimit).toBe(500);
  });

  test("budget status only counts the caller's spending", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await request(app).put("/api/budgets").set(a.auth).send({ category: "Food", monthlyLimit: 100 });
    await addTxn(a, { name: "Alice groceries", amount: 60, category: "Food" });
    await addTxn(b, { name: "Bob feast", amount: 500, category: "Food" });

    const res = await request(app).get("/api/budgets/status").set(a.auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toHaveLength(1);
    expect(res.body.status[0]).toMatchObject({ category: "Food", spent: 60, overBudget: false });
  });

  test("linked accounts are private", async () => {
    const a = await makeUser("alice");
    await makeUser("bob");

    const res = await request(app).get("/api/plaid/accounts").set(a.auth);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].plaidAccountId).toBe("acc-alice");
  });

  test("/me returns the caller's own profile, never someone else's", async () => {
    await makeUser("alice");
    const b = await makeUser("bob");

    const res = await request(app).get("/api/auth/me").set(b.auth);
    expect(res.body.user.email).toBe("bob@example.com");
  });
});
