# Auth


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

