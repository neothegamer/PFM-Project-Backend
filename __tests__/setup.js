require("dotenv").config();
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

// Fall back to a test-only secret if .env isn't loaded yet in this environment,
// so auth routes (which sign a JWT) don't crash with "secretOrPrivateKey must have a value".
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-only-secret-do-not-use-in-production";
}

// Always use a fixed test-only encryption key (64 hex chars), so tests never depend on
// (or get broken by) whatever TOKEN_ENCRYPTION_KEY is in your real .env.
process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);

let mongo;

// A 30s timeout on just this hook — starting the in-memory MongoDB engine can
// occasionally take longer than Jest's 5s default, especially on a cold start.
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 30000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongo.stop();
});