# Errors


| Status | Meaning |
|---|---|
| `400` | Missing or invalid input, malformed ID, or malformed JSON |
| `401` | No token, or the token is invalid or expired. Clear the stored token and go to login |
| `404` | Resource not found (or not yours), or unknown route |
| `409` | Conflict, e.g. email already registered |
| `429` | Rate limit exceeded — see [Conventions](conventions.md) |
| `500` | Server failure |
| `502` | Plaid couldn't be reached to remove a linked bank — nothing local was changed |

Auth errors use these messages: `"No token provided"` and `"Invalid or expired token"`.

---

