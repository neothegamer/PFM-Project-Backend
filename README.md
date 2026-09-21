# PFM Dashboard — Backend

Node.js/Express/MongoDB backend for the Personal Finance Management Dashboard.
Covers auth, Plaid integration, transactions, and budgeting.

## Setup

```bash
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, TOKEN_ENCRYPTION_KEY, and Plaid sandbox keys
npm run dev            # requires nodemon; or `npm start`
```

### Token encryption

Plaid access tokens are encrypted (AES-256-GCM) before being stored in MongoDB.
The server will not start without `TOKEN_ENCRYPTION_KEY` (64 hex characters). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Keep the key out of git and back it up somewhere safe. If it is lost or changed, stored
  tokens cannot be decrypted and users must re-link their banks.
- Everyone sharing one database must use the same key.
- If you have tokens saved from before encryption was added, convert them once with
  `npm run encrypt-tokens` (safe to re-run).

Get free Plaid sandbox keys at https://dashboard.plaid.com/signup — sandbox
mode uses fake banks/data, no real bank account needed.

### Security hardening

- **Input validation:** `/auth/register` and `/auth/login` reject non-string
  payloads (blocks query-operator injection like `{"email": {"$ne": null}}`),
  require a valid email format, and require an 8+ character password.
  `PUT /budgets` requires a non-negative `monthlyLimit`.
- **Rate limiting:** `/auth/register` and `/auth/login` are limited to 20
  requests per 15 minutes per IP (`middleware/rateLimit.js`). Disabled when
  `NODE_ENV=test`.
- **CORS:** locked to an allowlist via `CORS_ORIGIN` (comma-separated) in
  `.env`, e.g. `CORS_ORIGIN=https://app.example.com`. Falls back to
  `http://localhost:3000,http://localhost:5173` if unset, for local dev.
  Requests from any other origin get a `403`.
- **`helmet`** sets baseline security response headers on every route.
- Before deploying: rotate any credential that has appeared in a screenshot
  or a zipped copy of this repo (Atlas password, `JWT_SECRET`, Plaid secret),
  set `CORS_ORIGIN` to the real frontend origin, and set `NODE_ENV=production`.

## Tests

```bash
npm test
```

Runs against an in-memory MongoDB (`mongodb-memory-server`) — no real
database needed to run the suite. Covers auth, transactions, budgets, Plaid linking / sync / balance
refresh, token encryption, per-user data isolation, categorization, and error handling.

Full request/response reference for the frontend: [`docs/API.md`](docs/API.md).  
Architecture, security decisions, and data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).  
Postman collection: [`docs/PFM-Backend.postman_collection.json`](docs/PFM-Backend.postman_collection.json).

### Live end-to-end smoke test

```bash
# Terminal 1
npm run dev

# Terminal 2 (requires real Plaid sandbox keys in .env)
npm run e2e
```

This registers a throwaway user, creates a Plaid sandbox public token (no Link UI), exchanges it, syncs, refreshes balances, exercises manual transaction CRUD, summaries and budgets.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create a user |
| POST | `/api/auth/login` | Get a JWT |
| GET | `/api/auth/me` | Verify a token, get current user |
| POST | `/api/plaid/create-link-token` | Get a token for Plaid Link on the frontend |
| POST | `/api/plaid/exchange-public-token` | Exchange Plaid Link's public_token, save accounts |
| GET | `/api/plaid/accounts` | List linked accounts |
| POST | `/api/plaid/sync-transactions` | Pull last 30 days of transactions from Plaid |
| POST | `/api/plaid/refresh-balances` | Re-read balances for all linked banks |
| GET | `/api/transactions` | List stored transactions |
| POST | `/api/transactions` | Manually add a transaction |
| PUT | `/api/transactions/:id` | Edit a transaction (name, amount, date, category) |
| DELETE | `/api/transactions/:id` | Delete a transaction |
| GET | `/api/transactions/summary/by-category` | Totals per category — feeds the Recharts pie chart |
| GET | `/api/transactions/summary/by-month` | Income vs. expense per month — feeds the bar chart |
| GET | `/api/budgets` | List category limits |
| PUT | `/api/budgets` | Set or update a category's monthly limit |
| GET | `/api/budgets/status` | Each budget with this month's actual spend and over/under status |

All routes except `/api/auth/register` and `/api/auth/login` require:
`Authorization: Bearer <token>`

`/api/auth/register` and `/api/auth/login` are rate-limited (20 req / 15 min / IP)
and validate their input — see [Security hardening](#security-hardening) above.

## Team ownership

- **Backend, auth, Plaid, security** — team lead
- **Budgeting feature + test suite** — 4th member (`routes/budgets.js`, `__tests__/`)

See the frontend README for the Mridul/Avadhut split.
