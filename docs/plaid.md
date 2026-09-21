# Plaid (bank linking)


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

