// 404 for any route that didn't match.
function notFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

// Central error handler — must be registered last, with four arguments.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Malformed ObjectId (e.g. /api/transactions/not-an-id)
  if (err.name === "CastError") {
    return res.status(400).json({ error: `Invalid value for ${err.path || "id"}` });
  }
  // Schema validation failures (runValidators on updates, required fields, etc.)
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }
  // Malformed JSON body from express.json()
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  // Unique-index violation
  if (err.code === 11000) {
    return res.status(409).json({ error: "Duplicate value" });
  }
  // Origin not on the CORS allowlist (see resolveAllowedOrigins in app.js)
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Not allowed by CORS" });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

module.exports = { notFound, errorHandler };
