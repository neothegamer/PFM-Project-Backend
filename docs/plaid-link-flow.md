# Plaid Link flow, step by step


Use the [`react-plaid-link`](https://github.com/plaid/react-plaid-link) package.

1. Call `POST /api/plaid/create-link-token` and keep the returned `link_token`.
2. Open Plaid Link with that token (`usePlaidLink({ token, onSuccess })`).
3. In `onSuccess(public_token)`, call `POST /api/plaid/exchange-public-token` with `{ public_token }`.
4. Call `POST /api/plaid/sync-transactions` to import transactions.
5. Reload `GET /api/plaid/accounts` and `GET /api/transactions` to update the screen.

In the Plaid sandbox, pick any test bank and log in with username `user_good` and password `pass_good`.

**Reconnecting a bank that failed:** when `refresh-balances` reports `ITEM_LOGIN_REQUIRED` for a bank, call `create-link-token` with that bank's `itemId` to get an update-mode token, then open Plaid Link with it as usual. On success, call `sync-transactions` and reload accounts — no `exchange-public-token` call needed, since update mode re-authorizes the existing connection rather than creating a new one.

---

