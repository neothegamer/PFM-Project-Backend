const crypto = require("crypto");
const { encryptToken, decryptToken, isEncrypted, assertKeyConfigured } = require("../utils/crypto");

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("token encryption", () => {
  test("round-trips a token", () => {
    const token = "access-sandbox-1234abcd-0000-1111-2222-333344445555";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  test("the stored value is in the encrypted format and does not contain the plaintext", () => {
    const token = "access-sandbox-secret-value";
    const stored = encryptToken(token);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored.includes(token)).toBe(false);
  });

  test("encrypting the same token twice gives different output (random IV)", () => {
    const token = "access-sandbox-same";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  test("a tampered value fails to decrypt instead of returning garbage", () => {
    const stored = encryptToken("access-sandbox-abc");
    const parts = stored.split(":"); // enc, v1, iv, tag, ciphertext
    const bytes = Buffer.from(parts[4], "base64");
    bytes[0] ^= 0xff;
    parts[4] = bytes.toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow(/Could not decrypt/);
  });

  test("decrypting with a different key fails", () => {
    const stored = encryptToken("access-sandbox-abc");
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    expect(() => decryptToken(stored)).toThrow(/Could not decrypt/);
  });

  test("a malformed encrypted value is rejected", () => {
    expect(() => decryptToken("enc:v1:onlyonepart")).toThrow(/Malformed/);
  });

  test("legacy plaintext tokens pass through unchanged", () => {
    expect(isEncrypted("access-sandbox-legacy")).toBe(false);
    expect(decryptToken("access-sandbox-legacy")).toBe("access-sandbox-legacy");
  });

  test("refuses to encrypt an empty or non-string value", () => {
    expect(() => encryptToken("")).toThrow();
    expect(() => encryptToken(undefined)).toThrow();
  });
});

describe("encryption key validation", () => {
  test("throws a helpful error when the key is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertKeyConfigured()).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  test("throws when the key is the wrong length or not hex", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => assertKeyConfigured()).toThrow(/64 hex/);
    process.env.TOKEN_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => assertKeyConfigured()).toThrow(/64 hex/);
  });

  test("accepts a valid 64-character hex key", () => {
    expect(() => assertKeyConfigured()).not.toThrow();
  });
});
