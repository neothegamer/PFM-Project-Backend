# Budgets


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

