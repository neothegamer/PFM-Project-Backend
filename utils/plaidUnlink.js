// Shared by "unlink one bank" (routes/plaid.js) and "delete my account"
// (routes/auth.js cascade), so both remove a Plaid item the same way.
//
// Plaid must be told first, before any local row is touched: if the local
// delete ran first and the Plaid call then failed, the connection would keep
// pulling data at Plaid with nothing locally to show for it or let the user
// manage. ITEM_NOT_FOUND (already removed, e.g. the user pulled it from their
// bank's side) is treated as success rather than a failure, since the end
// state — no live connection — is the same either way.
//
// Returns { ok: true } or { ok: false, errorCode } and never throws; the
// caller decides what an unrecoverable failure means for its own local data.
async function removeItemAtPlaid(plaidClient, accessToken) {
  try {
    await plaidClient.itemRemove({ access_token: accessToken });
    return { ok: true };
  } catch (err) {
    const code = err.response?.data?.error_code;
    if (code === "ITEM_NOT_FOUND") return { ok: true };
    console.error("Plaid itemRemove failed:", err.response?.data || err.message);
    return { ok: false, errorCode: code || "ITEM_REMOVE_FAILED" };
  }
}

module.exports = { removeItemAtPlaid };
