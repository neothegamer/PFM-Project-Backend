const request = require("supertest");
require("./setup");

jest.mock("../config/plaid", () => ({ itemRemove: jest.fn() }));
const plaidClient = require("../config/plaid");
const createApp = require("../app");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const { encryptToken } = require("../utils/crypto");

const app = createApp();
const credentials = { name: "Test User", email: "prof1@example.com", password: "password123" };

async function register(email = credentials.email) {
  const res = await request(app).post("/api/auth/register").send({ ...credentials, email });
  return { token: res.body.token, userId: res.body.user.id };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("PUT /api/auth/me", () => {
  test("updates the name", async () => {
    const { token } = await register("prof2@example.com");
    const res = await request(app).put("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("New Name");
    expect(res.body.user.password).toBeUndefined();
  });

  test("rejects an empty name", async () => {
    const { token } = await register("prof3@example.com");
    const res = await request(app).put("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "  " });
    expect(res.status).toBe(400);
  });

  test("requires a token", async () => {
    const res = await request(app).put("/api/auth/me").send({ name: "New Name" });
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/auth/me/password", () => {
  test("changes the password, provable by logging in with the new one", async () => {
    const { token, userId } = await register("prof4@example.com");
    const res = await request(app)
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: credentials.password, newPassword: "newpassword456" });
    expect(res.status).toBe(200);

    const login = await request(app).post("/api/auth/login").send({ email: "prof4@example.com", password: "newpassword456" });
    expect(login.status).toBe(200);

    const oldLogin = await request(app).post("/api/auth/login").send({ email: "prof4@example.com", password: credentials.password });
    expect(oldLogin.status).toBe(401);
  });

  test("rejects the wrong current password", async () => {
    const { token } = await register("prof5@example.com");
    const res = await request(app)
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrongpassword", newPassword: "newpassword456" });
    expect(res.status).toBe(401);
  });

  test("rejects a new password under 8 characters", async () => {
    const { token } = await register("prof6@example.com");
    const res = await request(app)
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: credentials.password, newPassword: "short" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/auth/me", () => {
  test("requires the current password", async () => {
    const { token } = await register("prof7@example.com");
    const res = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test("rejects the wrong password and deletes nothing", async () => {
    const { token, userId } = await register("prof8@example.com");
    const res = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(await User.findById(userId)).not.toBeNull();
  });

  test("with no linked banks, deletes the user and their accounts/transactions/budgets", async () => {
    const { token, userId } = await register("prof9@example.com");
    const account = await Account.create({ user: userId, plaidAccountId: "pf9-acc", itemId: "pf9-item", name: "Checking" });
    await Transaction.create({ user: userId, account: account._id, name: "Coffee", amount: 5, date: new Date() });
    await Budget.create({ user: userId, category: "Food", monthlyLimit: 100 });

    const res = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ password: credentials.password });
    expect(res.status).toBe(200);

    expect(await User.findById(userId)).toBeNull();
    expect(await Account.countDocuments({ user: userId })).toBe(0);
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
    expect(await Budget.countDocuments({ user: userId })).toBe(0);
    expect(plaidClient.itemRemove).not.toHaveBeenCalled();
  });

  test("removes every linked bank at Plaid before deleting local data", async () => {
    const { token, userId } = await register("prof10@example.com");
    await User.findByIdAndUpdate(userId, {
      $push: { plaidItems: { $each: [
        { accessToken: encryptToken("tok-1"), itemId: "item-1" },
        { accessToken: encryptToken("tok-2"), itemId: "item-2" },
      ] } },
    });
    plaidClient.itemRemove.mockResolvedValue({});

    const res = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ password: credentials.password });
    expect(res.status).toBe(200);
    expect(plaidClient.itemRemove).toHaveBeenCalledTimes(2);
    expect(await User.findById(userId)).toBeNull();
  });

  test("deletes nothing locally if Plaid fails to remove a linked bank", async () => {
    const { token, userId } = await register("prof11@example.com");
    await User.findByIdAndUpdate(userId, {
      $push: { plaidItems: { accessToken: encryptToken("tok-1"), itemId: "item-1" } },
    });
    plaidClient.itemRemove.mockRejectedValue(
      Object.assign(new Error("down"), { response: { data: { error_code: "PLAID_ERROR" } } })
    );

    const res = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ password: credentials.password });
    expect(res.status).toBe(502);
    expect(await User.findById(userId)).not.toBeNull();
  });
});
