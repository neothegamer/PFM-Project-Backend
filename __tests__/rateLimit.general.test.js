process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_GENERAL_MAX = "5";

const request = require("supertest");
require("./setup");
const createApp = require("../app");

const app = createApp();

describe("generalLimiter (user-keyed once authenticated)", () => {
  test("blocks one user's requests after their configured max, without affecting another user", async () => {
    const userA = await request(app)
      .post("/api/auth/register")
      .send({ name: "A", email: "gl-a@example.com", password: "password123" });
    const userB = await request(app)
      .post("/api/auth/register")
      .send({ name: "B", email: "gl-b@example.com", password: "password123" });

    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${userA.body.token}`);
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${userA.body.token}`);
    expect(blocked.status).toBe(429);

    // A different user, keyed separately, is unaffected.
    const stillOk = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${userB.body.token}`);
    expect(stillOk.status).toBe(200);
  });
});
