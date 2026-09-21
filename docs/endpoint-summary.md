# Endpoint summary


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

