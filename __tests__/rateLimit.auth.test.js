// A dedicated file so this suite gets its own module registry, and so its
// own rate limiter singleton, isolated from every other test file. Jest
// gives each test file a fresh require() cache, so setting a low override
// here doesn't affect any other suite's use of the real, higher default.
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_AUTH_MAX = "3";

const request = require("supertest");
require("./setup");
const createApp = require("../app");

const app = createApp();

describe("authLimiter (IP-keyed, register/login only)", () => {
  test("blocks after the configured max, with a 429 and an error message", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Test", email: `al${i}@example.com`, password: "password123" });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "al-blocked@example.com", password: "password123" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBeDefined();
  });
});
