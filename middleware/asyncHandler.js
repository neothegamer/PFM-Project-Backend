// Express 4 does not catch rejected promises from async route handlers. Without
// this wrapper, a thrown error (e.g. a Mongoose CastError from a malformed :id)
// becomes an unhandled rejection, which crashes the Node process on modern Node.
// Wrapping a handler forwards any rejection to the error middleware instead.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
