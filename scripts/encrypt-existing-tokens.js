// One-time migration: encrypt any Plaid access tokens that were saved as plaintext
// before encryption was added. Safe to run more than once — tokens that are already
// encrypted are skipped.
//
// Usage (from the backend folder, with TOKEN_ENCRYPTION_KEY and MONGO_URI in .env):
//   npm run encrypt-tokens
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { encryptToken, isEncrypted, assertKeyConfigured } = require("../utils/crypto");

async function main() {
  assertKeyConfigured();
  await mongoose.connect(process.env.MONGO_URI);

  let usersUpdated = 0;
  let tokensEncrypted = 0;

  const users = await User.find({ "plaidItems.0": { $exists: true } });
  for (const user of users) {
    let changed = false;
    for (const item of user.plaidItems) {
      if (!isEncrypted(item.accessToken)) {
        item.accessToken = encryptToken(item.accessToken);
        tokensEncrypted++;
        changed = true;
      }
    }
    if (changed) {
      await user.save();
      usersUpdated++;
    }
  }

  console.log(`Done. Encrypted ${tokensEncrypted} token(s) across ${usersUpdated} user(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
