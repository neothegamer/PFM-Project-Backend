# Conventions

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
- **Error shape:** always `{ "error": "message" }` with an appropriate status code. See [Errors](errors.md).
- **Rate limits:** three tiers, all returning `429 { "error": "message" }` when exceeded.
  | Tier | Limit | Applies to |
  |---|---|---|
  | Auth | 20 / 15 min per IP | `POST /api/auth/register`, `POST /api/auth/login` |
  | General | 300 / 15 min per user (per IP if unauthenticated) | every other `/api` route |
  | Bank sync | 10 / 15 min per user | `POST /api/plaid/sync-transactions`, `POST /api/plaid/refresh-balances` |
  | Link token | 30 / 15 min per user | `POST /api/plaid/create-link-token` |

  300/15 min is far above normal dashboard usage — it's there to catch a runaway request loop, not to constrain a real user. If you get a `429`, back off and show a "try again in a few minutes" message rather than retrying immediately.

---

