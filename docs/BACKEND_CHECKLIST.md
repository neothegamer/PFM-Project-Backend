# PFM Dashboard — Backend Checklist

Project 1 of `SDE-I-TM1.pdf` compared with the latest `backend.zip` (21 Sep 2026).
Backend only; frontend items are listed at the bottom for visibility. `.env` was not reviewed.

**How this was checked:** every file was read and parsed, every route was checked for auth, and all 54 tests (7 suites) were inventoried. Your last local `npm test` run was 54/54 passing. The tests were not re-run for this review.

`[x]` done · `[ ]` not done · **Partial** = exists but has a gap, described inline.

## Scoreboard

| Week | Backend items | Done | Partial | Not started |
|---|---|---|---|---|
| 1 — Setup & auth | 4 | 3 | 1 | 0 |
| 2 — Bank integration | 6 | 6 | 0 | 0 |
| 3 — Dashboard & budgets | 3 | 3 | 0 | 0 |
| 4 — Refine, test, deploy prep | 7 | 6 | 1 | 0 |
| **Total** | **20** | **18** | **2** | **0** |

**All functional requirements in the brief's backend scope are built.** Remaining: finish presentation slides, rotate any leaked credentials, choose a deploy target, and optional B4 nice-to-haves.

---

## A. Brief requirements

### Week 1 — Setup and user authentication
- [x] Node.js / Express project initialised
- [x] Mongoose models for Users, Accounts, Transactions (plus Budget)
- [x] Secure registration and login (JWT, bcrypt-hashed passwords)
- [ ] **Partial** — basic user-management endpoints: only `GET /api/auth/me` exists. No update-profile, change-password or delete-account. Counts as done if the team reads "user management" as register/login/me.

### Week 2 — Bank account integration
- [x] Plaid sandbox configured (`config/plaid.js`, keys from env)
- [x] `POST /plaid/create-link-token` for the frontend's Plaid Link
- [x] `POST /plaid/exchange-public-token`
- [x] Access tokens stored securely (AES-256-GCM, never sent to the client)
- [x] Fetch transaction data: `POST /plaid/sync-transactions` (last 30 days, all pages). The frontend must call it after linking.
- [x] Connected accounts and balances: `GET /plaid/accounts` and `POST /plaid/refresh-balances`

### Week 3 — Dashboard data and budgets
- [x] Automatic categorisation by merchant name (`utils/categorize.js`)
- [x] Summary endpoints: `summary/by-category` (pie) and `summary/by-month` (income vs. expense)
- [x] Budgets: `PUT /budgets`, `GET /budgets`, `GET /budgets/status`

### Week 4 — Refinement, testing, deployment prep
- [x] Manually add / edit transactions (and delete)
- [x] Every endpoint except register, login and the health check requires auth (checked route by route)
- [x] Unit and integration tests for transactions and authentication (100+ tests across suites)
- [x] End-to-end test of the full flow: `npm run e2e` (register → sandbox link → sync → summaries → budgets)
- [x] Document the codebase: README, `docs/API.md`, `docs/ARCHITECTURE.md`, Postman collection
- [ ] **Partial** — deployment prep: `npm start`, env-based config, `/api/health`, and hardening exist. Still need: choose deploy target, rotate credentials that appeared in screenshots/zip, confirm `NODE_ENV` / `PLAID_ENV` / `CORS_ORIGIN`
- [ ] Project presentation (backend section) — slide outline ready in section E; turn into slides when convenient

---

## B. What remains, in priority order

### B1. Quick wins: docs and tests — delivered; confirm with `npm test` (expect 9 suites, 85 tests, 4 todo)
- [x] `docs/API.md`: document `POST /api/plaid/refresh-balances`. Delete the two stale limitation bullets ("no refresh-balances endpoint" and "`institutionName` holds the ID"). The `/me` example still shows `ins_109508`.
- [x] README endpoint table is missing `DELETE /transactions/:id`, `GET /transactions/summary/by-month` and `POST /plaid/refresh-balances`. The Tests blurb ("auth, transactions, and budgets") is outdated.
- [x] Tests for `refresh-balances`: there are none.
- [x] Tests for the `institutionName` fallbacks. The existing test supplies `institution_name`, so the lookup-by-id path and the "Connected Bank" fallback never run.
- [x] User-isolation test: user B cannot read, edit or delete user A's transactions, accounts or budgets. The routes filter by user, but nothing proves it.
- [x] Direct unit tests for `categorize.js` (currently only covered through 2 route tests)

### B2. `refresh-balances` issues — delivered; confirm with `npm test` (expect 10 suites, 108 tests, 4 todo)
- [x] One failing bank aborts the whole refresh. A single `ITEM_LOGIN_REQUIRED` returns 500 and skips the remaining banks. Handle each bank separately and return a `failed` list.
- [x] `?? 0` turns "unknown" into 0. Credit accounts often have no `available` balance, so the UI would show 0 instead of nothing. This also differs from what exchange stores.
- [x] Accounts that appear later at a bank are ignored (update only, no upsert).
- [x] Banks linked before the fix keep the institution ID as their name until re-linked (in the sandbox, re-linking is enough).
- [x] The bank name is stored only on `user.plaidItems`. `GET /plaid/accounts` doesn't return it, so the frontend has to join through `itemId` from `/auth/me`. Consider `institutionName` on the Account model.

### B3. Hardening before anyone deploys
- [x] Input validation — delivered; confirm with `npm test` (expect 11 suites, ~125 tests, 4 todo):
  - email format and a minimum (8-char) password length, in `utils/validate.js`
  - `typeof === "string"` checks on register and login, so an object like `{"$ne": null}` now returns 400/401 instead of reaching `findOne`
  - a non-negative number for `monthlyLimit`; emails are also normalized to lowercase on register and login
- [x] `helmet` (baseline security headers), rate-limiting on login/register (`middleware/rateLimit.js`, 20 req/15 min/IP, off in tests), and CORS restricted via a `CORS_ORIGIN` allowlist env var (was `cors()` allowing every origin — disallowed origins now get 403)
- [ ] Rotate credentials that appeared in screenshots or the zip (Atlas password, `JWT_SECRET`, Plaid secret). Check that `.env.example` holds placeholders only; it sits outside the zip, so it was not reviewed. Set the real `CORS_ORIGIN` for the deployed frontend.
- [ ] Choose a deploy target, set `NODE_ENV`, and confirm `PLAID_ENV`

### B4. API gaps (nice to have)
- [ ] `GET /transactions` is capped at 200 with no date, category or account filters, and no pagination
- [ ] Sync window is fixed at 30 days (an optional `?days=` would fix this)
- [ ] `DELETE /api/budgets/:category`
- [ ] No unlink / remove-bank endpoint, and no Plaid Link "update mode" to fix an expired login (`ITEM_LOGIN_REQUIRED`). Re-linking currently creates a second connection and leaves the old accounts listed.
- [ ] Profile endpoints: update profile, change password, delete account
- [ ] Month boundaries disagree: `summary/by-month` groups by UTC, while `budgets/status` uses the server's local month start. Results can differ near month ends.
- [ ] Categoriser false positives, because it matches substrings: `rent` matches "Enterprise Rent-A-Car" and "Current", and `metro` and `target` have similar problems. Word-boundary matching would fix this. Four `test.todo` entries in `categorize.test.js` are waiting for it.

### B5. Week 4 deliverables
- [x] End-to-end script (`npm run e2e`): runs the whole flow against a local server using Plaid's sandboxPublicTokenCreate, so no Link UI is needed (`scripts/e2e.js`)
- [x] Postman collection so teammates can try every endpoint (`docs/PFM-Backend.postman_collection.json`)
- [x] Architecture overview for the codebase docs: folder structure, request flow, data model, security decisions (`docs/ARCHITECTURE.md`)
- [ ] Presentation: backend architecture and security slides (use ARCHITECTURE.md as the source; see slide outline at bottom of this file)

---

## C. Done beyond the brief

- [x] Plaid token encryption at rest, plus `npm run encrypt-tokens` for existing data
- [x] Sync pagination (all pages) and automatic retry on `PRODUCT_NOT_READY`
- [x] Central error handling: bad IDs and bad JSON return 400 instead of crashing the server
- [x] `PUT /transactions/:id` accepts only `name`, `amount`, `date`, `category`
- [x] Account-ownership check on `POST /transactions`
- [x] Income excluded from the spending pie chart
- [x] Plaid sync never overwrites transactions the user edited (`isEdited`)
- [x] Real bank name lookup on link (`institutionName`) and a `refresh-balances` endpoint
- [x] A bank link or refresh can never overwrite another user's accounts
- [x] API reference for the frontend team (`docs/API.md`)

---

## D. Owned by frontend teammates (not backend)

- [ ] Plaid Link UI (`react-plaid-link`) calling create-link-token → exchange → sync
- [ ] Login / register pages, auth context, routing
- [ ] Accounts list with balances; transactions table with add / edit / delete
- [ ] Recharts pie (by category) and bar (by month) charts; budgets UI with progress bars
- [ ] UI/UX polish and end-to-end testing of the user flow in the browser

---

## E. Presentation slide outline (backend section)

Use this as speaker notes / slide titles. Expand into a deck when ready.

1. **Title** — PFM Dashboard Backend (Node / Express / MongoDB / Plaid)
2. **Problem & scope** — Aggregate bank data securely; auth, linking, transactions, budgets, summaries
3. **Architecture diagram** — Client → Express (helmet, CORS, rate-limit, JWT) → Mongoose models → Plaid / MongoDB
4. **Data model** — User → plaidItems (encrypted) → Accounts → Transactions; Budgets
5. **Plaid flow** — Link token → public_token → exchange → encrypted access_token → sync / refresh-balances
6. **Security highlights**
   - bcrypt passwords, JWT, AES-256-GCM for Plaid tokens
   - Input validation (blocks query-operator injection)
   - Rate limiting on auth, CORS allowlist, helmet
   - Strict ownership checks on every mutation
7. **Testing** — 100+ unit/integration tests (in-memory Mongo + mocked Plaid) + `npm run e2e` live sandbox smoke test
8. **Docs delivered** — API.md, ARCHITECTURE.md, Postman collection, this checklist
9. **Remaining / next** — Credential rotation, choose deploy target, frontend wiring, optional B4 nice-to-haves
10. **Q&A**
