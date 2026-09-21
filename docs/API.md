# PFM Dashboard — API Reference

Reference for the frontend team. Everything here is taken from the backend code, so if an endpoint behaves differently from what is written, that is a backend bug — tell the backend lead.

- [Quick start](#quick-start)
- [Conventions](#conventions)
- [Endpoint summary](#endpoint-summary)
- [Auth](#auth)
- [Plaid (bank linking)](#plaid-bank-linking)
- [Transactions](#transactions)
- [Budgets](#budgets)
- [Data shapes](#data-shapes)
- [Errors](#errors)
- [Plaid Link flow, step by step](#plaid-link-flow-step-by-step)
- [Known limitations](#known-limitations)

---

## Quick start

Base URL (local): `http://localhost:5000`. The port comes from `PORT` in `.env` (default 5000).

To run the backend locally:

```bash
cd backend
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

Health check: `GET /api/health` returns `{ "status": "ok" }` (no auth needed).

---

## Conventions

- **Format:** all requests and responses are JSON. Send `Content-Type: application/json` on requests with a body.
- **Auth:** every endpoint except `/api/health`, `/api/auth/register` and `/api/auth/login` requires the header
  `Authorization: Bearer <token>`. The token comes from register or login and lasts 7 days by default.
- **Scoping:** every resource belongs to the logged-in user. You can never read or change another user's data, and there is no way to pass a `userId`.
- **IDs:** MongoDB ObjectIds — 24-character hex strings such as `64f1c2a9e4b0a1b2c3d4e5f6`. Malformed IDs return `400`.
- **Dates:** send `"2026-08-15"` or a full ISO string. Dates come back as ISO strings.
- **Amount sign (important):** follows Plaid's convention.
  - **Positive amount = expense** (money out)
  - **Negative amount = income** (money in)

  So a $4.50 coffee is `4.5` and a $1,500 paycheck is `-1500`. Show the sign the way your UI needs; the summary endpoints already return income as a positive number.
- **Error shape:** always `{ "error": "message" }` with an appropriate status code. See [Errors](#errors).
- **Rate limits:** three tiers, all returning `429 { "error": "message" }` when exceeded.
  | Tier | Limit | Applies to |
  |---|---|---|
  | Auth | 20 / 15 min per IP | `POST /api/auth/register`, `POST /api/auth/login` |
  | General | 300 / 15 min per user (per IP if unauthenticated) | every other `/api` route |
  | Bank sync | 10 / 15 min per user | `POST /api/plaid/sync-transactions`, `POST /api/plaid/refresh-balances` |
  | Link token | 30 / 15 min per user | `POST /api/plaid/create-link-token` |

  300/15 min is far above normal dashboard usage — it's there to catch a runaway request loop, not to constrain a real user. If you get a `429`, back off and show a "try again in a few minutes" message rather than retrying immediately.

---

## Endpoint summary

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | No | Server health check |
| POST | `/api/auth/register` | No | Create a user, returns a token |
| POST | `/api/auth/login` | No | Log in, returns a token |
| GET | `/api/auth/me` | Yes | Current user |
| POST | `/api/plaid/create-link-token` | Yes | Get a `link_token` to open Plaid Link |
| POST | `/api/plaid/exchange-public-token` | Yes | Finish linking a bank, saves its accounts |
| GET | `/api/plaid/accounts` | Yes | List linked accounts with balances |
| POST | `/api/plaid/sync-transactions` | Yes | Pull recent transactions from Plaid |
| POST | `/api/plaid/refresh-balances` | Yes | Re-read balances for all linked banks |
| GET | `/api/transactions` | Yes | List transactions (latest 200) |
| POST | `/api/transactions` | Yes | Add a transaction manually |
| PUT | `/api/transactions/:id` | Yes | Edit a transaction |
| DELETE | `/api/transactions/:id` | Yes | Delete a transaction |
| GET | `/api/transactions/summary/by-category` | Yes | Spending per category (pie chart) |
| GET | `/api/transactions/summary/by-month` | Yes | Income vs. expense per month (bar chart) |
| GET | `/api/budgets` | Yes | List category limits |
| PUT | `/api/budgets` | Yes | Create or update a category limit |
| GET | `/api/budgets/status` | Yes | Limits with this month's spending |

---

## Auth

### POST `/api/auth/register`

Body:

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "secret123" }
```

`201`:

```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "64f1...", "name": "Ada Lovelace", "email": "ada@example.com" }
}
```

Errors: `400` if any of the three fields is missing, `409` if the email is already registered. Emails are stored lowercase.

### POST `/api/auth/login`

Body: `{ "email": "ada@example.com", "password": "secret123" }`

`200`: same shape as register (`token` + `user`). Error: `401 { "error": "Invalid credentials" }` for a wrong email or password (the message is deliberately the same for both).

### PUT `/api/auth/me`

Updates the display name. Email isn't editable through this endpoint.

Body: `{ "name": "New Name" }`

`200`: `{ "user": { ... } }`. Error: `400` if `name` is missing or empty.

### PUT `/api/auth/me/password`

Changes the password. Requires the current password.

Body: `{ "currentPassword": "...", "newPassword": "..." }`

`200`: `{ "message": "Password updated" }`. Errors: `400` missing fields or `newPassword` under 8 characters, `401` if `currentPassword` is wrong.

### DELETE `/api/auth/me`

Permanently deletes the account: every linked bank (removed at Plaid first, same as `DELETE /api/plaid/items/:itemId`), their accounts and transactions, and all budgets. **No undo.** Requires the current password as confirmation — the frontend should also confirm with the user before calling this.

Body: `{ "password": "..." }`

`200`: `{ "message": "Account and all associated data deleted" }`. Errors: `400` missing password, `401` wrong password, `502` if a linked bank couldn't be removed at Plaid (nothing is deleted locally in that case — retry is safe).

### GET `/api/auth/me`

`200`:

```json
{
  "user": {
    "_id": "64f1...",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "plaidItems": [{ "_id": "...", "itemId": "...", "institutionName": "First Platypus Bank" }],
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T10:00:00.000Z"
  }
}
```

The password and Plaid access tokens are never returned. Use this to check on page load that a stored token is still valid: a `401` means send the user to the login page.

---

## Plaid (bank linking)

### POST `/api/plaid/create-link-token`

Body optional. `200`: `{ "link_token": "link-sandbox-..." }`. Pass this to Plaid Link to open the bank-connection popup.

To **reconnect** a bank that `refresh-balances` reported as `ITEM_LOGIN_REQUIRED`, pass that bank's `itemId` instead of linking it fresh:

```json
{ "itemId": "abc123" }
```

This opens Plaid Link in *update mode* against the existing connection rather than creating a new one — the reconnect doesn't produce duplicate accounts or transactions the way linking again from scratch would. No `exchange-public-token` call is needed afterward; update mode re-authorizes the existing access token in place.

Errors: `404 { "error": "Linked bank not found" }` if `itemId` isn't one of the user's banks, `500` if Plaid rejects the request.

### POST `/api/plaid/exchange-public-token`

Call this from Plaid Link's `onSuccess` callback.

Body: `{ "public_token": "public-sandbox-..." }`

`200`:

```json
{ "message": "Bank account connected", "accounts": [ /* Account objects */ ] }
```

The backend exchanges the token, stores the credentials server-side, and saves the accounts. The Plaid access token is never sent to the frontend. The bank's display name (e.g. `First Platypus Bank`) is saved on each account as `institutionName` (and in `GET /api/auth/me` under `plaidItems[].institutionName`). If Plaid can't supply a name it is `Connected Bank`, which `refresh-balances` later replaces with the real name. Errors: `400` if `public_token` is missing, `500` if Plaid rejects it.

### GET `/api/plaid/accounts`

`200`: `{ "accounts": [ /* Account objects */ ] }`. Empty array if no bank is linked yet — use that to decide whether to show a "Connect a bank" prompt.

### POST `/api/plaid/sync-transactions`

Body optional. Fetches transactions from every linked bank (all pages, so busy accounts aren't truncated) and saves them. Safe to call repeatedly (existing transactions are updated, not duplicated).

By default this covers the last 30 days. Pass `days` to widen the window (e.g. a first sync, or catching up after time away):

```json
{ "days": 90 }
```

`days` must be an integer between 1 and 730.

`200`: `{ "message": "Synced 42 transactions", "skippedEdited": 1 }`

`skippedEdited` counts transactions the user edited by hand; the sync leaves those untouched so their corrections are not overwritten.

Errors: `400 { "error": "No linked bank accounts" }`, `500` if Plaid fails. Call this right after linking, and again whenever the user hits a "Refresh" button. If Plaid is still preparing the data right after linking, the backend waits and retries automatically (up to about 8 seconds), so the first sync after linking can take a little longer to respond.

---

### POST `/api/plaid/refresh-balances`

No body. Re-reads the balances of every linked bank from Plaid and updates the saved accounts. Use it for a "Refresh balances" button.

By default this reads Plaid's cached balances (which Plaid refreshes periodically on its own), not a live check with the bank. Add `?live=true` to instead call Plaid's real-time balance endpoint. **Plaid bills the live endpoint per call in production** — use it for an explicit "get exact balance now" action, not on every page load.

`200`:

```json
{
  "message": "Refreshed balances for 2 account(s)",
  "refreshed": 2,
  "failed": [
    { "itemId": "abc123", "institutionName": "Chase", "error": "ITEM_LOGIN_REQUIRED" }
  ],
  "live": false,
  "accounts": [ /* ALL of the user's accounts, with fresh balances where the refresh worked */ ]
}
```

- **Each bank is refreshed on its own.** If one fails, the others still refresh, the failed one is listed in `failed`, and the response is still `200`. `accounts` is always the user's full list, so replace whatever you are showing with it. A failed bank's accounts keep their previous balances.
- `failed[].error` is Plaid's error code. `ITEM_LOGIN_REQUIRED` means the user's bank login expired and they must reconnect that bank — show something like "Reconnect Chase". `institutionName` is `null` if the bank's name isn't known.
- Accounts that appeared at a bank since it was linked are added automatically.
- Bank names are fixed here too: banks linked earlier that show an ID like `ins_109508` get their real name on the next refresh.

Errors: `400 { "error": "No linked bank accounts" }`. If **every** linked bank fails, the status is `500` with `{ "error": "Failed to refresh balances", "failed": [ ... ] }`.

### DELETE `/api/plaid/items/:itemId`

Unlinks one bank. **This permanently deletes that bank's accounts and every transaction on them — including ones the user edited or added by hand — with no undo.** Confirm with the user before calling this, and say so plainly in the confirmation, e.g. "This removes First Platypus Bank and deletes all of its transaction history, including any you edited. This can't be undone."

No body. `200`:

```json
{ "message": "Bank disconnected", "itemId": "abc123", "accountsRemoved": 2 }
```

The bank is removed at Plaid first; if that fails (for any reason other than the item already being gone at Plaid's end), nothing local is deleted and the response is `502 { "error": "...", "plaidError": "..." }` — retry is safe.

To reconnect a bank that failed rather than unlinking it, use `create-link-token` with `itemId` (update mode) instead of this endpoint.

Errors: `404` if `itemId` isn't one of the user's banks, `502` if Plaid can't be reached.

## Transactions

### GET `/api/transactions`

`200`: `{ "transactions": [ /* Transaction objects */ ], "page": 1, "limit": 200 }` — newest first.

All query parameters are optional; with none of them this is unchanged from before (most recent 200 transactions).

| Param | Notes |
|---|---|
| `account` | Filter to one account's `_id` |
| `category` | Exact match, case-insensitive |
| `from`, `to` | Date range, inclusive on both ends. Either can be given alone |
| `limit` | Default `200`, max `500` |
| `page` | 1-based, default `1` |

Example: `GET /api/transactions?category=Food and Drink&from=2026-08-01&to=2026-08-31&limit=50&page=2`

Errors: `400` for an invalid `account` id, an unparseable `from`/`to`, a `limit` outside 1–500, or a non-positive `page`.

### POST `/api/transactions`

Adds a manual transaction.

Body:

```json
{
  "account": "64f1...",
  "name": "Starbucks #4521",
  "amount": 6.25,
  "date": "2026-08-04",
  "category": "Food and Drink"
}
```

| Field | Required | Notes |
|---|---|---|
| `account` | Yes | The `_id` of one of the user's accounts from `GET /api/plaid/accounts` (not `plaidAccountId`) |
| `name` | Yes | String — merchant or description |
| `amount` | Yes | Number; positive = expense, negative = income |
| `date` | Yes | Date string |
| `category` | No | If omitted, the backend picks one from the merchant name, else `"Uncategorized"` |

`201`: `{ "transaction": { ... } }` with `isManual: true`.

Errors: `400` for missing or invalid fields, `404 { "error": "Account not found" }` if the account doesn't exist or isn't the user's.

Note that a manual transaction needs an existing account, so the user must link a bank first.

### PUT `/api/transactions/:id`

Edits a transaction. Send any of `name`, `amount`, `date`, `category`:

```json
{ "category": "Groceries" }
```

`200`: `{ "transaction": { ... } }` with the updated values. Any other field in the body is ignored. The transaction is marked `isEdited: true`, so future Plaid syncs won't overwrite it.

Errors: `400` for an invalid ID, a body with no editable fields, or an invalid value (e.g. non-numeric `amount`); `404` if not found.

### DELETE `/api/transactions/:id`

`200`: `{ "message": "Transaction deleted", "transaction": { ... } }`. Errors: `400` invalid ID, `404` not found.

Caveat: if you delete a Plaid-synced transaction, the next sync can bring it back. Deleting is meant for mistaken manual entries.

### GET `/api/transactions/summary/by-category`

For the **pie chart**. Total spending per category; income is excluded.

`200`:

```json
{ "summary": [ { "_id": "Food and Drink", "total": 312.4 }, { "_id": "Shopping", "total": 120 } ] }
```

Sorted by `total`, largest first. The category name is in `_id` (a MongoDB naming quirk). Map it to `{ name: item._id, value: item.total }` for Recharts.

### GET `/api/transactions/summary/by-month`

For the **bar chart**. Income and expense per calendar month, oldest first.

`200`:

```json
{ "summary": [ { "month": "2026-07", "income": 3000, "expense": 1840.5 }, { "month": "2026-08", "income": 1500, "expense": 80 } ] }
```

Both `income` and `expense` are positive numbers. Months are calculated in UTC.

---

## Budgets

One monthly limit per category per user.

### GET `/api/budgets`

`200`: `{ "budgets": [ { "_id": "...", "category": "Food and Drink", "monthlyLimit": 300, ... } ] }`

### PUT `/api/budgets`

Creates the budget for a category, or updates it if one exists (safe to call for both "add" and "edit").

Body: `{ "category": "Food and Drink", "monthlyLimit": 300 }`

`200`: `{ "budget": { ... } }`. Error: `400` if either field is missing.

### DELETE `/api/budgets/:id`

Removes a category's limit. Does not touch the transactions themselves, only the limit tracked against them.

`200`: `{ "message": "Budget deleted", "budget": { ... } }`. Errors: `400` invalid id, `404` not found.

### GET `/api/budgets/status`

Each budget alongside spending in the **current calendar month** (expenses only). This is what a budget progress bar needs.

`200`:

```json
{
  "status": [
    { "category": "Food and Drink", "monthlyLimit": 300, "spent": 312.4, "remaining": -12.4, "overBudget": true }
  ]
}
```

`remaining` goes negative when the user is over budget.

---

## Data shapes

**Account**

```json
{
  "_id": "64f1...",
  "plaidAccountId": "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
  "itemId": "...",
  "institutionName": "First Platypus Bank",
  "name": "Plaid Checking",
  "officialName": "Plaid Gold Standard 0% Interest Checking",
  "type": "depository",
  "subtype": "checking",
  "mask": "0000",
  "currentBalance": 110,
  "availableBalance": 100,
  "isoCurrencyCode": "USD"
}
```

`type` is a category like `depository`, `credit` or `loan`; `subtype` is more specific (`checking`, `savings`, `credit card`). `mask` is the last 4 digits, safe to display. `institutionName` is the bank's display name, the same for every account at that bank. **`currentBalance` and `availableBalance` can be `null`** when Plaid doesn't report a balance (e.g. some credit accounts) — show a dash, not 0.

**Transaction**

```json
{
  "_id": "64f1...",
  "account": "64f1...",
  "plaidTransactionId": "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje",
  "name": "Uber 063015 SF**POOL**",
  "amount": 5.4,
  "date": "2026-08-04T00:00:00.000Z",
  "category": "Transportation",
  "isManual": false,
  "isEdited": false
}
```

`account` is the account's `_id` (not expanded); match it against the accounts list to show the account name. `plaidTransactionId` exists only on synced transactions. `isManual` is true for user-created ones.

**Categories.** The backend assigns one of: `Food and Drink`, `Transportation`, `Shopping`, `Entertainment`, `Housing`, `Utilities`, `Health`, `Income`. If none matches, it uses Plaid's own category (e.g. `Travel`, `Payment`, `Transfer`) or `Uncategorized`. Users can also type their own on manual entries. **Don't hard-code a category list in the UI** — build dropdowns from the categories present in the data, plus the list above.

---

## Errors

| Status | Meaning |
|---|---|
| `400` | Missing or invalid input, malformed ID, or malformed JSON |
| `401` | No token, or the token is invalid or expired. Clear the stored token and go to login |
| `404` | Resource not found (or not yours), or unknown route |
| `409` | Conflict, e.g. email already registered |
| `429` | Rate limit exceeded — see [Conventions](#conventions) |
| `500` | Server failure |
| `502` | Plaid couldn't be reached to remove a linked bank — nothing local was changed |

Auth errors use these messages: `"No token provided"` and `"Invalid or expired token"`.

---

## Plaid Link flow, step by step

Use the [`react-plaid-link`](https://github.com/plaid/react-plaid-link) package.

1. Call `POST /api/plaid/create-link-token` and keep the returned `link_token`.
2. Open Plaid Link with that token (`usePlaidLink({ token, onSuccess })`).
3. In `onSuccess(public_token)`, call `POST /api/plaid/exchange-public-token` with `{ public_token }`.
4. Call `POST /api/plaid/sync-transactions` to import transactions.
5. Reload `GET /api/plaid/accounts` and `GET /api/transactions` to update the screen.

In the Plaid sandbox, pick any test bank and log in with username `user_good` and password `pass_good`.

**Reconnecting a bank that failed:** when `refresh-balances` reports `ITEM_LOGIN_REQUIRED` for a bank, call `create-link-token` with that bank's `itemId` to get an update-mode token, then open Plaid Link with it as usual. On success, call `sync-transactions` and reload accounts — no `exchange-public-token` call needed, since update mode re-authorizes the existing connection rather than creating a new one.

---

## Known limitations

These are known and planned on the backend side; build around them for now.

- **Transaction list is capped at 200** with no date, category or account filters. Filter client-side for now.
- **Sync only covers the last 30 days.** Within that window, every transaction is imported.
- **Balances are Plaid's cached values.** `refresh-balances` re-reads them but is not a live check with the bank.
- **Reconnecting an expired bank means linking it again.** When `refresh-balances` reports `ITEM_LOGIN_REQUIRED`, the user has to link that bank again as a new connection, and the old connection's accounts stay listed. There is no unlink / remove-bank endpoint yet, and Plaid's Link update mode isn't implemented.
- **No delete endpoint for budgets**, and no endpoints for updating or deleting the user profile.
- **CORS is open to all origins** during development. It will be restricted to the frontend's URL before deployment — tell the backend lead what that URL is.
