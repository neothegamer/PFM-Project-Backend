# PFM Dashboard — API Reference

Reference for the frontend team. Everything here is taken from the backend code, so if an endpoint behaves differently from what is written, that is a backend bug — tell the backend lead.

- [Conventions](conventions.md)
- [Endpoint summary](endpoint-summary.md)
- [Auth](authentication.md)
- [Plaid (bank linking)](plaid.md)
- [Transactions](transactions.md)
- [Budgets](budgets.md)
- [Data shapes](data-shapes.md)
- [Errors](errors.md)
- [Plaid Link flow, step by step](plaid-link-flow.md)
- [Known limitations](known-limitations.md)

---

## Quick start

Base URL (local): `http://localhost:5000`. The port comes from `PORT` in `.env` (default 5000).

To run the backend locally:

```bash
cd PFM-Project-Backend
npm install
cp .env.example .env     # then fill in the values below
npm run dev
```

| `.env` variable | Purpose |
|---|---|
| `PORT` | Server port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign login tokens |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Plaid tokens — 64 hex characters, **required** (the server won't start without it). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Everyone sharing one database must use the same key; never commit it |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Plaid sandbox keys (free at https://dashboard.plaid.com/signup) |
| `PLAID_ENV` | `sandbox` |
| `RATE_LIMIT_ENABLED` | Set to `false` to disable rate limiting (used in tests). Defaults to on |
| `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_GENERAL_MAX`, `RATE_LIMIT_PLAID_MAX`, `RATE_LIMIT_LINK_TOKEN_MAX` | Override the default request caps for each rate-limit tier — see [Conventions](conventions.md) |

Health check: `GET /api/health` returns `{ "status": "ok" }` (no auth needed).
