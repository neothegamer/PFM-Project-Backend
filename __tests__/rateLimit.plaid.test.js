process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_PLAID_MAX = "3";

const request = require("supertest");
require("./setup");
const createApp = require("../app");

const app = createApp();

// No banks linked, so sync-transactions returns 400 before ever touching
// Plaid — lets this test exercise the limiter without mocking the Plaid
// client.
describe("plaidActionLimiter (sync-transactions, refresh-balances)", () => {
  test("blocks after the configured max, keyed per user", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "pl1@example.com", password: "password123" });
    const token = register.body.token;

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400); // "No linked bank accounts" — reached the handler, not blocked yet
    }

    const blocked = await request(app).post("/api/plaid/sync-transactions").set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(429);
  });
});
