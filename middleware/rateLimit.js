const rateLimit = require("express-rate-limit");

// Login and register are the only unauthenticated routes, so they're the only
// ones exposed to credential-stuffing / brute-force and registration-spam.
// Keyed by IP; generous enough for a normal user mistyping a password a few
// times, tight enough to make scripted guessing impractical.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
  // Tests hit these routes dozens of times across many describe blocks; a
  // shared in-memory store would make suites fail depending on run order.
  skip: () => process.env.NODE_ENV === "test",
});

module.exports = { authLimiter };
