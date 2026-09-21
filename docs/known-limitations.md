# Known limitations


These are known and planned on the backend side; build around them for now.

- **Transaction list is capped at 200** with no date, category or account filters. Filter client-side for now.
- **Sync only covers the last 30 days.** Within that window, every transaction is imported.
- **Balances are Plaid's cached values.** `refresh-balances` re-reads them but is not a live check with the bank.
- **Reconnecting an expired bank means linking it again.** When `refresh-balances` reports `ITEM_LOGIN_REQUIRED`, the user has to link that bank again as a new connection, and the old connection's accounts stay listed. There is no unlink / remove-bank endpoint yet, and Plaid's Link update mode isn't implemented.
- **No delete endpoint for budgets**, and no endpoints for updating or deleting the user profile.
- **CORS is open to all origins** during development. It will be restricted to the frontend's URL before deployment — tell the backend lead what that URL is.
