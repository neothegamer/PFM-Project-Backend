# Transactions


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

