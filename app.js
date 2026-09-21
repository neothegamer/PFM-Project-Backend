const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const plaidRoutes = require("./routes/plaid");
const transactionRoutes = require("./routes/transactions");
const budgetRoutes = require("./routes/budgets");
const { notFound, errorHandler } = require("./middleware/errorHandler");

// CORS_ORIGIN is a comma-separated allowlist, e.g. "https://app.example.com,http://localhost:5173".
// Falls back to common local dev ports so `npm run dev` keeps working out of the box;
// set CORS_ORIGIN explicitly in every other environment.
function resolveAllowedOrigins() {
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return ["http://localhost:3000", "http://localhost:5173"];
}

function createApp() {
  const app = express();

  // Render (and most PaaS hosts) sit behind a reverse proxy. Without this,
  // req.ip resolves to the proxy's IP for every request, which would make
  // the rate limiter below treat all users as one client sharing one limit.
  app.set("trust proxy", 1);

  app.use(helmet());

  const allowedOrigins = resolveAllowedOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header (curl, server-to-server, same-origin) — allow.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
    })
  );

  app.use(express.json());

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/plaid", plaidRoutes);
  app.use("/api/transactions", transactionRoutes);
  app.use("/api/budgets", budgetRoutes);

  // Must come after all routes
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
