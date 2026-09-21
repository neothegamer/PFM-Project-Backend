# Data shapes


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

