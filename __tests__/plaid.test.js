const request = require("supertest");
require("./setup");

// Stub the Plaid client — no network calls in tests.
jest.mock("../config/plaid", () => ({
  itemPublicTokenExchange: jest.fn(),
  itemGet: jest.fn(),
  accountsGet: jest.fn(),
  transactionsGet: jest.fn(),
  institutionsGetById: jest.fn(),
}));

const plaidClient = require("../config/plaid");
const createApp = require("../app");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const { encryptToken, decryptToken, isEncrypted } = require("../utils/crypto");

const app = createApp();
const PLAINTEXT_TOKEN = "access-sandbox-super-secret-token";

async function register(email) {
  const res = await request(app).post("/api/auth/register").send({ name: "Test", email, password: "password123" });
  return { token: res.body.token, userId: res.body.user.id };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Plaid access token encryption", () => {
  test("exchange-public-token stores the token encrypted and never returns it", async () => {
    const { token, userId } = await register("p1@example.com");
    plaidClient.itemPublicTokenExchange.mockResolvedValue({ data: { access_token: PLAINTEXT_TOKEN, item_id: "item-1" } });
    plaidClient.itemGet.mockResolvedValue({
      data: { item: { institution_id: "ins_1", institution_name: "Chase" } },
    });
    plaidClient.institutionsGetById.mockResolvedValue({
      data: { institution: { name: "Chase" } },
    });
    plaidClient.accountsGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "acc-1", name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000", balances: { current: 100, available: 90, iso_currency_code: "USD" } },
        ],
      },
    });

    const res = await request(app)
      .post("/api/plaid/exchange-public-token")
      .set("Authorization", `Bearer ${token}`)
      .send({ public_token: "public-sandbox-x" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(PLAINTEXT_TOKEN);

    // The Plaid client received the plaintext token for its own calls...
    expect(plaidClient.accountsGet).toHaveBeenCalledWith({ access_token: PLAINTEXT_TOKEN });

    // ...but what is stored in MongoDB is encrypted.
    const user = await User.findById(userId);
    const stored = user.plaidItems[0].accessToken;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain(PLAINTEXT_TOKEN);
    expect(decryptToken(stored)).toBe(PLAINTEXT_TOKEN);

    // institutionName should be the real bank name, not the ID
    expect(user.plaidItems[0].institutionName).toBe("Chase");
  });
});

describe("Plaid sync", () => {
  async function setupLinkedUser(email, storedToken) {
    const { token, userId } = await register(email);
    await User.findByIdAndUpdate(userId, { $push: { plaidItems: { accessToken: storedToken, itemId: "item-1" } } });
    await Account.create({ user: userId, plaidAccountId: "acc-1", itemId: "item-1", name: "Checking" });
    return { token, userId };
  }

  const txn = (id, name) => ({ transaction_id: id, account_id: "acc-1", name, amount: 10, date: "2026-08-01", category: ["Other"] });

  test("decrypts the stored token and imports every page of transactions", async () => {
    const { token } = await setupLinkedUser("p2@example.com", encryptToken(PLAINTEXT_TOKEN));
    plaidClient.transactionsGet
      .mockResolvedValueOnce({ data: { transactions: [txn("p1", "Netflix"), txn("p2", "Spotify")], total_transactions: 3 } })
      .mockResolvedValueOnce({ data: { transactions: [txn("p3", "Uber")], total_transactions: 3 } });

    const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Synced 3 transactions");
    expect(await Transaction.countDocuments()).toBe(3);

    expect(plaidClient.transactionsGet).toHaveBeenCalledTimes(2);
    expect(plaidClient.transactionsGet.mock.calls[0][0]).toMatchObject({ access_token: PLAINTEXT_TOKEN, options: { count: 500, offset: 0 } });
    expect(plaidClient.transactionsGet.mock.calls[1][0]).toMatchObject({ access_token: PLAINTEXT_TOKEN, options: { count: 500, offset: 2 } });
  });

  test("still works for legacy plaintext tokens saved before encryption", async () => {
    const { token } = await setupLinkedUser("p3@example.com", PLAINTEXT_TOKEN);
    plaidClient.transactionsGet.mockResolvedValue({ data: { transactions: [txn("p1", "Netflix")], total_transactions: 1 } });

    const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(plaidClient.transactionsGet.mock.calls[0][0].access_token).toBe(PLAINTEXT_TOKEN);
  });

  test("returns 500 (not a crash) when the stored token cannot be decrypted", async () => {
    const { token } = await setupLinkedUser("p4@example.com", "enc:v1:AAAA:AAAA:AAAA");
    const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(plaidClient.transactionsGet).not.toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// Bank name lookup when linking
// ---------------------------------------------------------------------------
describe("Bank name lookup when linking", () => {
  function mockLinkFlow(item) {
    plaidClient.itemPublicTokenExchange.mockResolvedValue({ data: { access_token: PLAINTEXT_TOKEN, item_id: "item-1" } });
    plaidClient.itemGet.mockResolvedValue({ data: { item } });
    plaidClient.accountsGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "acc-1", name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000", balances: { current: 100, available: 90, iso_currency_code: "USD" } },
        ],
      },
    });
  }

  async function link(email) {
    const { token, userId } = await register(email);
    const res = await request(app)
      .post("/api/plaid/exchange-public-token")
      .set("Authorization", `Bearer ${token}`)
      .send({ public_token: "public-sandbox-x" });
    const user = await User.findById(userId);
    return { res, storedName: user.plaidItems[0] && user.plaidItems[0].institutionName };
  }

  test("uses the institution name Plaid returns with the item", async () => {
    mockLinkFlow({ institution_id: "ins_1", institution_name: "Chase" });
    const { res, storedName } = await link("n1@example.com");
    expect(res.status).toBe(200);
    expect(storedName).toBe("Chase");
    expect(plaidClient.institutionsGetById).not.toHaveBeenCalled();
  });

  test("looks the name up by institution id when the item has no name", async () => {
    mockLinkFlow({ institution_id: "ins_109508" });
    plaidClient.institutionsGetById.mockResolvedValue({ data: { institution: { name: "First Platypus Bank" } } });
    const { res, storedName } = await link("n2@example.com");
    expect(res.status).toBe(200);
    expect(storedName).toBe("First Platypus Bank");
    expect(plaidClient.institutionsGetById).toHaveBeenCalledWith({ institution_id: "ins_109508", country_codes: ["US"] });
  });

  test("still links the bank, with a generic name, if the name lookup fails", async () => {
    mockLinkFlow({ institution_id: "ins_1" });
    plaidClient.institutionsGetById.mockRejectedValue(new Error("lookup failed"));
    const { res, storedName } = await link("n3@example.com");
    expect(res.status).toBe(200);
    expect(storedName).toBe("Connected Bank");
  });

  test("uses a generic name when Plaid gives neither a name nor an id", async () => {
    mockLinkFlow({});
    const { res, storedName } = await link("n4@example.com");
    expect(res.status).toBe(200);
    expect(storedName).toBe("Connected Bank");
    expect(plaidClient.institutionsGetById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/plaid/refresh-balances
// ---------------------------------------------------------------------------
describe("POST /api/plaid/refresh-balances", () => {
  const plaidAccount = (id, current, available) => ({
    account_id: id, name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000",
    balances: { current, available, iso_currency_code: "USD" },
  });

  async function linkedUser(email, plaidAccountId, itemId) {
    const { token, userId } = await register(email);
    await User.findByIdAndUpdate(userId, {
      $push: { plaidItems: { accessToken: encryptToken(PLAINTEXT_TOKEN), itemId, institutionName: "Test Bank" } },
    });
    await Account.create({ user: userId, plaidAccountId, itemId, name: "Checking", currentBalance: 0, availableBalance: 0 });
    return { token, userId };
  }

  const refresh = (token) => request(app).post("/api/plaid/refresh-balances").set("Authorization", `Bearer ${token}`);

  test("requires a token", async () => {
    const res = await request(app).post("/api/plaid/refresh-balances");
    expect(res.status).toBe(401);
  });

  test("returns 400 when no bank is linked", async () => {
    const { token } = await register("rb1@example.com");
    const res = await refresh(token);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No linked bank accounts");
  });

  test("updates the saved balances, using the decrypted access token", async () => {
    const { token } = await linkedUser("rb2@example.com", "acc-1", "item-1");
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount("acc-1", 250, 240)] } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({ currentBalance: 250, availableBalance: 240 });
    expect(plaidClient.accountsGet).toHaveBeenCalledWith({ access_token: PLAINTEXT_TOKEN });

    const saved = await Account.findOne({ plaidAccountId: "acc-1" });
    expect(saved).toMatchObject({ currentBalance: 250, availableBalance: 240 });
  });

  test("never changes another user's accounts", async () => {
    const userA = await linkedUser("rb3a@example.com", "acc-A", "item-A");
    await linkedUser("rb3b@example.com", "acc-B", "item-B");
    await Account.updateOne({ plaidAccountId: "acc-B" }, { currentBalance: 5 });

    // Even if Plaid's response for user A's bank mentions acc-B, user B's data must not change.
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount("acc-A", 250, 240), plaidAccount("acc-B", 999, 999)] } });

    const res = await refresh(userA.token);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);

    expect((await Account.findOne({ plaidAccountId: "acc-A" })).currentBalance).toBe(250);
    expect((await Account.findOne({ plaidAccountId: "acc-B" })).currentBalance).toBe(5);
  });

  test("returns 500 when Plaid fails for the only linked bank", async () => {
    const { token } = await linkedUser("rb4@example.com", "acc-1", "item-1");
    plaidClient.accountsGet.mockRejectedValue(
      Object.assign(new Error("login required"), { response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } })
    );
    const res = await refresh(token);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to refresh balances");
  });
});


// ---------------------------------------------------------------------------
// Bank name saved on accounts
// ---------------------------------------------------------------------------
describe("Bank name on accounts", () => {
  test("linking a bank saves the bank name on each of its accounts", async () => {
    const { token } = await register("bn1@example.com");
    plaidClient.itemPublicTokenExchange.mockResolvedValue({ data: { access_token: PLAINTEXT_TOKEN, item_id: "item-1" } });
    plaidClient.itemGet.mockResolvedValue({ data: { item: { institution_id: "ins_1", institution_name: "Chase" } } });
    plaidClient.accountsGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "acc-1", name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000", balances: { current: 100, available: 90, iso_currency_code: "USD" } },
        ],
      },
    });

    const res = await request(app)
      .post("/api/plaid/exchange-public-token")
      .set("Authorization", `Bearer ${token}`)
      .send({ public_token: "public-sandbox-x" });
    expect(res.status).toBe(200);
    expect(res.body.accounts[0].institutionName).toBe("Chase");
    expect((await Account.findOne({ plaidAccountId: "acc-1" })).institutionName).toBe("Chase");
  });
});

// ---------------------------------------------------------------------------
// refresh-balances: resilience, unknown balances, new accounts, bank names
// ---------------------------------------------------------------------------
describe("refresh-balances handles real-world cases", () => {
  const plaidAcct = (id, current, available) => ({
    account_id: id, name: "Checking", official_name: "Official", type: "depository", subtype: "checking", mask: "0000",
    balances: { current, available, iso_currency_code: "USD" },
  });

  async function addBank(userId, { itemId, accountId, institutionName = "Test Bank" }) {
    await User.findByIdAndUpdate(userId, {
      $push: { plaidItems: { accessToken: encryptToken(PLAINTEXT_TOKEN), itemId, institutionName } },
    });
    await Account.create({ user: userId, plaidAccountId: accountId, itemId, name: "Checking", currentBalance: 0, availableBalance: 0 });
  }

  const refresh = (token) => request(app).post("/api/plaid/refresh-balances").set("Authorization", `Bearer ${token}`);
  const loginRequired = () => Object.assign(new Error("login required"), { response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } });

  test("keeps refreshing the other banks when one fails, and reports the failure", async () => {
    const { token, userId } = await register("rr1@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1" });
    await addBank(userId, { itemId: "item-2", accountId: "acc-2" });
    plaidClient.accountsGet
      .mockRejectedValueOnce(loginRequired())
      .mockResolvedValueOnce({ data: { accounts: [plaidAcct("acc-2", 300, 290)] } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.refreshed).toBe(1);
    expect(res.body.failed).toEqual([{ itemId: "item-1", institutionName: "Test Bank", error: "ITEM_LOGIN_REQUIRED" }]);

    expect((await Account.findOne({ plaidAccountId: "acc-2" })).currentBalance).toBe(300);
    expect((await Account.findOne({ plaidAccountId: "acc-1" })).currentBalance).toBe(0); // failed bank keeps its old value
    expect(res.body.accounts).toHaveLength(2); // the full list, so the frontend can replace what it shows
  });

  test("reports which bank failed and why when every bank fails", async () => {
    const { token, userId } = await register("rr2@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1" });
    plaidClient.accountsGet.mockRejectedValue(loginRequired());

    const res = await refresh(token);
    expect(res.status).toBe(500);
    expect(res.body.failed).toEqual([{ itemId: "item-1", institutionName: "Test Bank", error: "ITEM_LOGIN_REQUIRED" }]);
  });

  test("keeps an unknown balance as null instead of showing it as 0", async () => {
    const { token, userId } = await register("rr3@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1" });
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAcct("acc-1", 250, null)] } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts[0].currentBalance).toBe(250);
    expect(res.body.accounts[0].availableBalance).toBeNull();
    expect((await Account.findOne({ plaidAccountId: "acc-1" })).availableBalance).toBeNull();
  });

  test("adds accounts that appeared at the bank after it was linked", async () => {
    const { token, userId } = await register("rr4@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1" });
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAcct("acc-1", 250, 240), plaidAcct("acc-new", 75, 75)] } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(2);

    const added = await Account.findOne({ plaidAccountId: "acc-new" });
    expect(added.user.toString()).toBe(userId);
    expect(added.itemId).toBe("item-1");
    expect(added.currentBalance).toBe(75);
  });

  test("replaces a bank name saved as an institution id with the real name", async () => {
    const { token, userId } = await register("rr5@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1", institutionName: "ins_109508" });
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAcct("acc-1", 250, 240)] } });
    plaidClient.itemGet.mockResolvedValue({ data: { item: { institution_id: "ins_109508" } } });
    plaidClient.institutionsGetById.mockResolvedValue({ data: { institution: { name: "First Platypus Bank" } } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts[0].institutionName).toBe("First Platypus Bank");
    expect((await User.findById(userId)).plaidItems[0].institutionName).toBe("First Platypus Bank");
    expect((await Account.findOne({ plaidAccountId: "acc-1" })).institutionName).toBe("First Platypus Bank");
  });

  test("leaves a proper bank name alone and does not look it up again", async () => {
    const { token, userId } = await register("rr6@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1", institutionName: "My Bank" });
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAcct("acc-1", 250, 240)] } });

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts[0].institutionName).toBe("My Bank");
    expect(plaidClient.itemGet).not.toHaveBeenCalled();
    expect(plaidClient.institutionsGetById).not.toHaveBeenCalled();
  });

  test("still refreshes balances when the bank name cannot be looked up", async () => {
    const { token, userId } = await register("rr7@example.com");
    await addBank(userId, { itemId: "item-1", accountId: "acc-1", institutionName: "ins_1" });
    plaidClient.accountsGet.mockResolvedValue({ data: { accounts: [plaidAcct("acc-1", 250, 240)] } });
    plaidClient.itemGet.mockRejectedValue(new Error("lookup failed"));

    const res = await refresh(token);
    expect(res.status).toBe(200);
    expect(res.body.accounts[0].currentBalance).toBe(250);
    expect((await User.findById(userId)).plaidItems[0].institutionName).toBe("ins_1"); // unchanged
    expect(res.body.accounts[0].institutionName).toBeUndefined();
  });
});
