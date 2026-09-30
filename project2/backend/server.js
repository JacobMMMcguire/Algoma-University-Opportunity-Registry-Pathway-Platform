require("dotenv").config();

const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { createPool } = require("./src/db");
const { createBrevoSender } = require("./src/email");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy .env.example to .env and set it, or use `npm run dev:local`.");
  process.exit(1);
}

const config = loadConfig();
if (!config.emailEnabled && !config.testMode) {
  console.warn("Neither email delivery nor sign-in test mode is enabled: nobody can sign in.");
}

const app = createApp({
  db: createPool(process.env.DATABASE_URL),
  config,
  sendSignInEmail: createBrevoSender(config),
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`Project 2 API listening on port ${port}`);
});
