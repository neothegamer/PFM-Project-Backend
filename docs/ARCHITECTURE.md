# PFM Dashboard — Backend Architecture

## Folder structure

```
backend/
├── app.js                 # Express app factory (middleware + route mounting)
├── server.js              # Entry point: load env, connect DB, listen
├── config/
│   ├── db.js              # Mongoose connection
│   └── plaid.js           # Plaid client (sandbox / production via PLAID_ENV)
├── middleware/
│   ├── auth.js            # JWT verification → req.userId
│   ├── asyncHandler.js    # Wraps async route handlers
│   ├── errorHandler.js    # 404 + central error responses
│   └── rateLimit.js       # Auth rate limiter (20 req / 15 min / IP)
├── models/
│   ├── User.js            # name, email, password (bcrypt), plaidItems[]
│   ├── Account.js         # Plaid accounts + balances, owned by user
│   ├── Transaction.js     # Plaid or manual; isEdited protects user edits
│   └── Budget.js          # per-user category monthlyLimit
├── routes/
│   ├── auth.js            # register / login / me
│   ├── plaid.js           # link-token, exchange, accounts, sync, refresh-balances
│   ├── transactions.js    # CRUD + summary/by-category + summary/by-month
│   └── budgets.js         # PUT / GET / status
├── utils/
│   ├── crypto.js          # AES-256-GCM encrypt/decrypt for Plaid access tokens
│   ├── categorize.js      # merchant-name → category
│   ├── plaidInstitution.js# resolve real bank name (with fallbacks)
│   ├── plaidTransactions.js # paginated transactionsGet + PRODUCT_NOT_READY retry
│   ├── accounts.js        # upsert accounts from Plaid payload
│   └── validate.js        # email / password / string guards
├── scripts/
│   ├── encrypt-existing-tokens.js
│   └── e2e.js             # full flow smoke test (no Link UI)
├── docs/
│   ├── API.md             # request/response reference for frontend
│   ├── ARCHITECTURE.md    # this file
│   └── BACKEND_CHECKLIST.md
└── __tests__/             # Jest + mongodb-memory-server + supertest
```

## Request flow (authenticated)

1. Client sends `Authorization: Bearer <jwt>`.
2. `middleware/auth.js` verifies the token with `JWT_SECRET` and sets `req.userId`.
3. Route handler runs (often via `asyncHandler`).
4. All data queries filter by `user: req.userId` (or ownership checks for nested resources).
5. Errors bubble to `errorHandler` → consistent JSON `{ error: "..." }` with proper status.

Public routes: only `POST /api/auth/register`, `POST /api/auth/login`, and `GET /api/health`.

## Data model (high level)

```
User
 ├── plaidItems[]  { accessToken (encrypted), itemId, institutionName }
 └── owns → Account[]  (plaidAccountId, balances, mask, …)
            └── owns → Transaction[]  (amount, date, category, isManual, isEdited)
 └── owns → Budget[]   (category, monthlyLimit)
```

- **Positive amount** = expense, **negative** = income (Plaid convention).
- Plaid sync never overwrites a transaction where `isEdited === true`.
- Access tokens never leave the server; only encrypted form is stored.

## Security decisions

| Concern | Approach |
|---------|----------|
| Passwords | bcrypt (salt rounds 10), never returned |
| Sessions | Stateless JWT (`JWT_SECRET`, configurable expiry) |
| Plaid tokens | AES-256-GCM at rest (`TOKEN_ENCRYPTION_KEY` = 64 hex chars) |
| Injection | `typeof === "string"` + format checks before any DB query |
| Rate abuse | 20 req / 15 min / IP on register & login |
| Headers | `helmet` |
| CORS | Allowlist via `CORS_ORIGIN` env (default local dev ports only) |
| Ownership | Every mutation checks the resource belongs to `req.userId` |
| Proxy | `trust proxy = 1` so rate-limiter sees real client IP behind PaaS |

## Plaid integration flow

```
Frontend                          Backend                         Plaid
   │                                 │                              │
   │  POST /create-link-token        │                              │
   │────────────────────────────────►│  linkTokenCreate             │
   │◄────────────────────────────────│─────────────────────────────►│
   │  link_token                     │                              │
   │                                 │                              │
   │  Plaid Link UI (user selects bank)                             │
   │◄───────────────────────────────────────────────────────────────│
   │  public_token                                                  │
   │                                 │                              │
   │  POST /exchange-public-token    │                              │
   │────────────────────────────────►│  itemPublicTokenExchange     │
   │                                 │─────────────────────────────►│
   │                                 │  access_token + item_id      │
   │                                 │  accountsGet + institution   │
   │                                 │  encrypt & store             │
   │◄────────────────────────────────│                              │
   │  accounts[]                     │                              │
   │                                 │                              │
   │  POST /sync-transactions        │  transactionsGet (paged)     │
   │────────────────────────────────►│─────────────────────────────►│
   │◄────────────────────────────────│  upsert (skip isEdited)      │
```

For automated testing without the Link UI, `scripts/e2e.js` uses Plaid’s `sandboxPublicTokenCreate` endpoint.

## Running tests & e2e

```bash
npm test          #  unit + integration (in-memory Mongo, mocked Plaid)
npm run e2e       #  full live flow against running server + real sandbox
```

## Deployment checklist (reminder)

1. Rotate any secret that appeared in a screenshot or shared zip (Atlas password, `JWT_SECRET`, Plaid secret, `TOKEN_ENCRYPTION_KEY`).
2. Set `NODE_ENV=production`, `PLAID_ENV=sandbox` (or production when ready), and a real `CORS_ORIGIN`.
3. Confirm `.env` is never committed (already in `.gitignore`).
4. Prefer a platform that supports environment variables (Render, Railway, Fly, etc.).
