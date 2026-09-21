require("dotenv").config();
const connectDB = require("./config/db");
const createApp = require("./app");
const { assertKeyConfigured } = require("./utils/crypto");

// Refuse to start without a valid encryption key rather than failing later on the first bank sync.
assertKeyConfigured();

connectDB();
const app = createApp();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
