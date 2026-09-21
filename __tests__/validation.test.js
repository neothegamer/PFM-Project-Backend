const request = require("supertest");
require("./setup");

const createApp = require("../app");
const app = createApp();

describe("POST /api/auth/register input validation", () => {
  test("rejects a non-string email (query-operator injection attempt)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Attacker", email: { $ne: null }, password: "password123" });
    expect(res.status).toBe(400);
  });

  test("rejects a non-string password", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Attacker", email: "a@example.com", password: { $gt: "" } });
    expect(res.status).toBe(400);
  });

  test("rejects a malformed email address", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "not-an-email", password: "password123" });
    expect(res.status).toBe(400);
  });

  test("rejects a password under 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "short-pw@example.com", password: "abc123" });
    expect(res.status).toBe(400);
  });

  test("accepts a valid registration and lowercases the stored email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "MixedCase@Example.com", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("mixedcase@example.com");
  });
});

describe("POST /api/auth/login input validation", () => {
  test("a query-operator payload for email never reaches findOne — returns 401, not a hijacked login", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Victim", email: "victim@example.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(401);
  });

  test("login is case-insensitive on email", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Case Test", email: "case-test@example.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "Case-Test@Example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

describe("PUT /api/budgets input validation", () => {
  async function registeredToken(email) {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Budgeter", email, password: "password123" });
    return res.body.token;
  }

  test("rejects a negative monthlyLimit", async () => {
    const token = await registeredToken("budget-neg@example.com");
    const res = await request(app)
      .put("/api/budgets")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Food", monthlyLimit: -50 });
    expect(res.status).toBe(400);
  });

  test("rejects a non-numeric monthlyLimit", async () => {
    const token = await registeredToken("budget-nan@example.com");
    const res = await request(app)
      .put("/api/budgets")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Food", monthlyLimit: "not-a-number" });
    expect(res.status).toBe(400);
  });

  test("accepts a zero monthlyLimit (used to freeze a category)", async () => {
    const token = await registeredToken("budget-zero@example.com");
    const res = await request(app)
      .put("/api/budgets")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Food", monthlyLimit: 0 });
    expect(res.status).toBe(200);
    expect(res.body.budget.monthlyLimit).toBe(0);
  });
});

describe("CORS allowlist", () => {
  test("a disallowed Origin is rejected", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example.com");
    expect(res.status).toBe(403);
  });

  test("an allowed dev Origin (default allowlist) is accepted", async () => {
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:3000");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  test("no Origin header (server-to-server / curl) is accepted", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});

describe("Security headers", () => {
  test("helmet sets baseline security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
  });
});
