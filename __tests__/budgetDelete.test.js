const request = require("supertest");
require("./setup");
const createApp = require("../app");

const app = createApp();

async function registerAndLogin(email) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test", email, password: "password123" });
  return { token: res.body.token, userId: res.body.user.id };
}

describe("DELETE /api/budgets/:id", () => {
  test("removes the budget", async () => {
    const { token } = await registerAndLogin("bd1@example.com");
    const put = await request(app)
      .put("/api/budgets")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "Dining", monthlyLimit: 200 });

    const del = await request(app)
      .delete(`/api/budgets/${put.body.budget._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.budget.category).toBe("Dining");

    const list = await request(app).get("/api/budgets").set("Authorization", `Bearer ${token}`);
    expect(list.body.budgets).toHaveLength(0);
  });

  test("does not delete another user's budget", async () => {
    const owner = await registerAndLogin("bd2-owner@example.com");
    const attacker = await registerAndLogin("bd2-attacker@example.com");
    const put = await request(app)
      .put("/api/budgets")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ category: "Dining", monthlyLimit: 200 });

    const del = await request(app)
      .delete(`/api/budgets/${put.body.budget._id}`)
      .set("Authorization", `Bearer ${attacker.token}`);
    expect(del.status).toBe(404);

    const list = await request(app).get("/api/budgets").set("Authorization", `Bearer ${owner.token}`);
    expect(list.body.budgets).toHaveLength(1);
  });

  test("a malformed id returns 400", async () => {
    const { token } = await registerAndLogin("bd3@example.com");
    const res = await request(app).delete("/api/budgets/not-an-id").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("a non-existent id returns 404", async () => {
    const { token } = await registerAndLogin("bd4@example.com");
    const res = await request(app)
      .delete("/api/budgets/64f1c2a9e4b0a1b2c3d4e5f6")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
