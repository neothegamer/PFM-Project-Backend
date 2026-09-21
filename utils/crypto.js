// AES-256-GCM encryption for secrets stored in MongoDB (Plaid access tokens).
//
// Stored format:  enc:v1:<iv>:<authTag>:<ciphertext>   (each part base64)
//
// - GCM authenticates the data, so a tampered or corrupted value fails to decrypt
//   instead of silently returning garbage.
// - A fresh random IV per encryption means the same token never encrypts to the
//   same string twice.
// - The key lives ONLY in the environment (TOKEN_ENCRYPTION_KEY), never in the database.
const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";
const IV_BYTES = 12; // recommended IV size for GCM

// Read at call time (not cached) so the key can be set/changed after startup in tests.
function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes). Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

// True if the value is in the encrypted format above.
function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function encryptToken(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken expects a non-empty string");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

// Returns the plaintext. A value that isn't in the encrypted format is treated as a
// legacy plaintext token (saved before encryption existed) and returned as-is, so
// existing linked banks keep working until `npm run encrypt-tokens` converts them.
function decryptToken(stored) {
  if (!isEncrypted(stored)) return stored;

  const key = getKey();
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Malformed encrypted token");
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    throw new Error("Could not decrypt token (wrong TOKEN_ENCRYPTION_KEY or corrupted data)");
  }
}

// Call once at startup so a missing/invalid key fails fast instead of on the first sync.
function assertKeyConfigured() {
  getKey();
}

module.exports = { encryptToken, decryptToken, isEncrypted, assertKeyConfigured };
