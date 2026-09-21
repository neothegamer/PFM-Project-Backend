// Small, dependency-free validation helpers.
//
// The important one is isString: Mongoose/Mongo will happily accept an object
// like {"$ne": null} where a string is expected, which can turn a login or
// register call into a query-operator injection. Every field pulled from
// req.body and used in a Mongo query or bcrypt call should pass through here
// first.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isString(v) {
  return typeof v === "string";
}

function isNonEmptyString(v) {
  return isString(v) && v.trim().length > 0;
}

function isValidEmail(v) {
  return isString(v) && v.trim().length <= 254 && EMAIL_RE.test(v.trim());
}

function isValidPassword(v, minLength = 8) {
  return isString(v) && v.length >= minLength;
}

// Accepts a finite number, or a numeric string (e.g. from a form), and
// rejects negatives, NaN, and Infinity.
function isNonNegativeNumber(v) {
  const n = typeof v === "number" ? v : Number(v);
  return typeof v !== "boolean" && Number.isFinite(n) && n >= 0;
}

module.exports = { isString, isNonEmptyString, isValidEmail, isValidPassword, isNonNegativeNumber };
