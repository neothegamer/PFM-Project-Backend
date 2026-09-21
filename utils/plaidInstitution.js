// Helpers for the bank's display name (e.g. "First Platypus Bank").

// Used when Plaid can't give us a name at link time.
const FALLBACK_BANK_NAME = "Connected Bank";

// True if a stored bank name is missing or is only a placeholder that should be replaced:
// nothing, the generic fallback, or a raw Plaid institution id such as "ins_109508"
// (older links saved the id in place of the name).
function isPlaceholderBankName(name) {
  return !name || name === FALLBACK_BANK_NAME || /^ins_/.test(name);
}

// Look up the bank's display name for a linked Item. Uses the name on the Item itself when
// Plaid provides one; otherwise looks it up by institution id. Returns null on any failure
// so a name lookup can never block linking a bank or refreshing balances.
async function getInstitutionName(plaidClient, accessToken, countryCodes = ["US"]) {
  try {
    const { data } = await plaidClient.itemGet({ access_token: accessToken });
    const item = data.item;

    if (item.institution_name) return item.institution_name;
    if (!item.institution_id) return null;

    const response = await plaidClient.institutionsGetById({
      institution_id: item.institution_id,
      country_codes: countryCodes,
    });
    return response.data.institution.name || null;
  } catch (err) {
    console.warn("Could not fetch institution name:", err.message);
    return null;
  }
}

module.exports = { getInstitutionName, isPlaceholderBankName, FALLBACK_BANK_NAME };
