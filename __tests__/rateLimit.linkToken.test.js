process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_LINK_TOKEN_MAX = "3";

jest.mock("../config/plaid", () => ({ linkTokenCreate: jest.fn().mockResolvedValue({ data: { link_token: "tok" } }) }));

const request = require("supertest");
require("./setup");
const createApp = require("../app");

const app = createApp();

describe("linkTokenLimiter (create-link-token)", () => {
  test("allows more headroom than the Plaid-call tier, then blocks", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "lk1@example.com", password: "password123" });
    const token = register.body.token;

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/api/plaid/create-link-token").set("Authorization", `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/api/plaid/create-link-token").set("Authorization", `Bearer ${token}`).send({});
    expect(blocked.status).toBe(429);
  });
});
