// Custom backend categorization logic, based on merchant name — this is what the
// brief asks for explicitly ("Build backend logic to categorize transactions
// automatically, e.g., based on merchant name"), rather than only relying on
// whatever category Plaid's own API happens to return.
//
// Rules are checked in order; the first keyword match wins. Add new rules by
// appending to CATEGORY_RULES — no other code needs to change.
const CATEGORY_RULES = [
  {
    category: "Food and Drink",
    keywords: ["starbucks", "mcdonald", "restaurant", "coffee", "cafe", "pizza", "burger", "doordash", "grubhub", "uber eats", "chipotle", "subway"],
  },
  {
    category: "Transportation",
    keywords: ["uber", "lyft", "gas station", "shell", "chevron", "exxon", "parking", "transit", "metro"],
  },
  {
    category: "Shopping",
    keywords: ["amazon", "walmart", "target", "best buy", "ebay", "costco"],
  },
  {
    category: "Entertainment",
    keywords: ["netflix", "spotify", "hulu", "disney+", "movie", "cinema", "steam", "playstation", "xbox"],
  },
  {
    category: "Housing",
    keywords: ["rent", "mortgage", "landlord", "property management"],
  },
  {
    category: "Utilities",
    keywords: ["electric", "water bill", "internet", "comcast", "at&t", "verizon", "t-mobile"],
  },
  {
    category: "Health",
    keywords: ["pharmacy", "cvs", "walgreens", "doctor", "hospital", "clinic", "dental"],
  },
  {
    category: "Income",
    keywords: ["payroll", "salary", "direct deposit"],
  },
];

/**
 * Categorize a transaction by its merchant/description name.
 * Returns a category string, or null if nothing matched (caller decides the fallback).
 */
function categorizeTransaction(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.category;
    }
  }
  return null;
}

module.exports = categorizeTransaction;
