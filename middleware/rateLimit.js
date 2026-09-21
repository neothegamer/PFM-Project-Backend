const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");

// A single switch for every limiter below. Defaults on; set
// RATE_LIMIT_ENABLED=false to disable (e.g. in .env.test), separate from
// NODE_ENV so a test can still assert that a limiter returns 429 by
// re-enabling it for just that suite.
function limitingEnabled() {
  return process.env.RATE_LIMIT_ENABLED !== "false";
}

// Best-effort decode: used only to choose a rate-limit *key*, never to
// authenticate. A missing/invalid/expired token just falls through to the
// IP-based key below — the real auth check still happens in requireAuth.
function tryGetUserId(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    return decoded.userId || null;
  } catch {
    return null;
  }
}

// Login and register are the only unauthenticated routes, so they're the only
// ones exposed to credential-stuffing / brute-force and registration-spam.
// Keyed by IP; generous enough for a normal user mistyping a password a few
// times, tight enough to make scripted guessing impractical.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_AUTH_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
  skip: () => !limitingEnabled(),
});

// Catches a runaway frontend loop or a scraping attempt across the whole API.
// Real usage is nowhere near this: a dashboard loading several endpoints at
// once is a handful of requests, not hundreds. Keyed by user once the request
// carries a valid token (so one user can't be rate-limited by someone else on
// the same network), by IP otherwise.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GENERAL_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req) => tryGetUserId(req) || req.ip,
  skip: () => !limitingEnabled(),
});

// sync-transactions and refresh-balances each call out to Plaid, which has
// its own limits and, in production, bills per call. Ten in fifteen minutes
// is already more than a user pressing "refresh" needs. Always mounted after
// requireAuth, so req.userId is guaranteed set.
const plaidActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PLAID_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many bank sync requests. Please try again later." },
  keyGenerator: (req) => req.userId.toString(),
  skip: () => !limitingEnabled(),
});

// create-link-token is free and short-lived (expiry, an abandoned Link
// session, linking several banks in one sitting, or re-entering update mode
// after a failed reconnect all mean a legitimate refetch), so it gets its own,
// looser tier rather than sharing the Plaid-call limiter above.
const linkTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LINK_TOKEN_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many link requests. Please try again later." },
  keyGenerator: (req) => req.userId.toString(),
  skip: () => !limitingEnabled(),
});

module.exports = { authLimiter, generalLimiter, plaidActionLimiter, linkTokenLimiter };
