const request = require("supertest");
require("./setup");

jest.mock("../config/plaid", () => ({
  itemPublicTokenExchange: jest.fn(),
  itemGet: jest.fn(),
  accountsGet: jest.fn(),
  accountsBalanceGet: jest.fn(),
  transactionsGet: jest.fn(),
  institutionsGetById: jest.fn(),
  linkTokenCreate: jest.fn(),
  itemRemove: jest.fn(),
}));

const plaidClient = require("../config/plaid");
const createApp = require("../app");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const { encryptToken } = require("../utils/crypto");

const app = createApp();
const PLAINTEXT_TOKEN = "access-sandbox-secret";

async function register(email) {
  const res = await request(app).post("/api/auth/register").send({ name: "Test", email, password: "password123" });
  return { token: res.body.token, userId: res.body.user.id };
}

async function linkedUser(email, { itemId = "item-1", accountId = "acc-1" } = {}) {
  const { token, userId } = await register(email);
  await User.findByIdAndUpdate(userId, {
    $push: { plaidItems: { accessToken: encryptToken(PLAINTEXT_TOKEN), itemId, institutionName: "Test Bank" } },
  });
  const account = await Account.create({ user: userId, plaidAccountId: accountId, itemId, name: "Checking" });
  return { token, userId, account };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("DELETE /api/plaid/items/:itemId", () => {
  test("removes the item at Plaid, then deletes accounts, transactions, and the plaidItems entry", async () => {
    const { token, userId, account } = await linkedUser("un1@example.com");
    await Transaction.create({ user: userId, account: account._id, name: "Coffee", amount: 5, date: new Date() });
    plaidClient.itemRemove.mockResolvedValue({});

    const res = await request(app).delete("/api/plaid/items/item-1").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.accountsRemoved).toBe(1);
    expect(plaidClient.itemRemove).toHaveBeenCalledWith({ access_token: PLAINTEXT_TOKEN });

    expect(await Account.countDocuments({ user: userId })).toBe(0);
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
    const user = await User.findById(userId);
    expect(user.plaidItems).toHaveLength(0);
  });

  test("leaves other banks untouched", async () => {
    const { token, userId } = await linkedUser("un2@example.com", { itemId: "item-1", accountId: "acc-1" });
    await User.findByIdAndUpdate(userId, {
      $push: { plaidItems: { accessToken: encryptToken(PLAINTEXT_TOKEN), itemId: "item-2", institutionName: "Other Bank" } },
    });
    await Account.create({ user: userId, plaidAccountId: "acc-2", itemId: "item-2", name: "Savings" });
    plaidClient.itemRemove.mockResolvedValue({});

    const res = await request(app).delete("/api/plaid/items/item-1").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(await Account.countDocuments({ user: userId, itemId: "item-2" })).toBe(1);
    const user = await User.findById(userId);
    expect(user.plaidItems.map((i) => i.itemId)).toEqual(["item-2"]);
  });

  test("treats an already-removed item at Plaid as success", async () => {
    const { token } = await linkedUser("un3@example.com");
    plaidClient.itemRemove.mockRejectedValue(
      Object.assign(new Error("not found"), { response: { data: { error_code: "ITEM_NOT_FOUND" } } })
    );
    const res = await request(app).delete("/api/plaid/items/item-1").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test("deletes nothing locally when Plaid fails for another reason", async () => {
    const { token, userId, account } = await linkedUser("un4@example.com");
    await Transaction.create({ user: userId, account: account._id, name: "Coffee", amount: 5, date: new Date() });
    plaidClient.itemRemove.mockRejectedValue(
      Object.assign(new Error("down"), { response: { data: { error_code: "PLAID_ERROR" } } })
    );

    const res = await request(app).delete("/api/plaid/items/item-1").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(502);

    expect(await Account.countDocuments({ user: userId })).toBe(1);
    expect(await Transaction.countDocuments({ user: userId })).toBe(1);
    expect((await User.findById(userId)).plaidItems).toHaveLength(1);
  });

  test("404s for a bank the user doesn't have linked", async () => {
    const { token } = await register("un5@example.com");
    const res = await request(app).delete("/api/plaid/items/does-not-exist").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test("cannot unlink another user's bank", async () => {
    const owner = await linkedUser("un6-owner@example.com");
    const attacker = await register("un6-attacker@example.com");
    const res = await request(app).delete("/api/plaid/items/item-1").set("Authorization", `Bearer ${attacker.token}`);
    expect(res.status).toBe(404);
    expect((await User.findById(owner.userId)).plaidItems).toHaveLength(1);
  });
});

describe("POST /api/plaid/create-link-token", () => {
  test("normal mode requests the transactions product", async () => {
    const { token } = await register("lt1@example.com");
    plaidClient.linkTokenCreate.mockResolvedValue({ data: { link_token: "link-abc" } });

    const res = await request(app).post("/api/plaid/create-link-token").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(plaidClient.linkTokenCreate.mock.calls[0][0]).toMatchObject({ products: ["transactions"] });
    expect(plaidClient.linkTokenCreate.mock.calls[0][0].access_token).toBeUndefined();
  });

  test("update mode passes the item's access token instead of products", async () => {
    const { token } = await linkedUser("lt2@example.com");
    plaidClient.linkTokenCreate.mockResolvedValue({ data: { link_token: "link-update" } });

    const res = await request(app)
      .post("/api/plaid/create-link-token")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId: "item-1" });
    expect(res.status).toBe(200);
    expect(plaidClient.linkTokenCreate.mock.calls[0][0]).toMatchObject({ access_token: PLAINTEXT_TOKEN });
    expect(plaidClient.linkTokenCreate.mock.calls[0][0].products).toBeUndefined();
  });

  test("404s when the itemId isn't one of the user's banks", async () => {
    const { token } = await register("lt3@example.com");
    const res = await request(app)
      .post("/api/plaid/create-link-token")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId: "not-mine" });
    expect(res.status).toBe(404);
    expect(plaidClient.linkTokenCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/plaid/sync-transactions with days", () => {
  test("defaults to a 30-day window", async () => {
    const { token } = await linkedUser("sd1@example.com");
    plaidClient.transactionsGet.mockResolvedValue({ data: { transactions: [], total_transactions: 0 } });

    await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`).send({});
    const call = plaidClient.transactionsGet.mock.calls[0][0];
    const spanDays = Math.round((new Date(call.end_date) - new Date(call.start_date)) / 86400000);
    expect(spanDays).toBe(30);
  });

  test("honors a custom days value", async () => {
    const { token } = await linkedUser("sd2@example.com");
    plaidClient.transactionsGet.mockResolvedValue({ data: { transactions: [], total_transactions: 0 } });

    await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`).send({ days: 90 });
    const call = plaidClient.transactionsGet.mock.calls[0][0];
    const spanDays = Math.round((new Date(call.end_date) - new Date(call.start_date)) / 86400000);
    expect(spanDays).toBe(90);
  });

  test("rejects an out-of-range days value", async () => {
    const { token } = await linkedUser("sd3@example.com");
    const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`).send({ days: 0 });
    expect(res.status).toBe(400);
    expect(plaidClient.transactionsGet).not.toHaveBeenCalled();
  });
});

describe("POST /api/plaid/refresh-balances?live=true", () => {
  test("uses the real-time balance endpoint instead of the cached one", async () => {
    const { token } = await linkedUser("lv1@example.com");
    plaidClient.accountsBalanceGet.mockResolvedValue({
      data: { accounts: [{ account_id: "acc-1", name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000", balances: { current: 500, available: 490, iso_currency_code: "USD" } }] },
    });

    const res = await request(app).post("/api/plaid/refresh-balances?live=true").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(plaidClient.accountsBalanceGet).toHaveBeenCalledWith({ access_token: PLAINTEXT_TOKEN });
    expect(plaidClient.accountsGet).not.toHaveBeenCalled();
  });

  test("defaults to the cached endpoint", async () => {
    const { token } = await linkedUser("lv2@example.com");
    plaidClient.accountsGet.mockResolvedValue({
      data: { accounts: [{ account_id: "acc-1", name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000", balances: { current: 500, available: 490, iso_currency_code: "USD" } }] },
    });

    const res = await request(app).post("/api/plaid/refresh-balances").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
    expect(plaidClient.accountsBalanceGet).not.toHaveBeenCalled();
  });
});
