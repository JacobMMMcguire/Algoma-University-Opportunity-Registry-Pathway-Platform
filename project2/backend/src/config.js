function loadConfig(env = process.env) {
  const brevoApiKey = env.BREVO_API_KEY || "";
  const emailFrom = env.EMAIL_FROM || "";
  const emailEnabled = Boolean(brevoApiKey && emailFrom);

  return {
    allowedEmailDomain: (env.ALLOWED_EMAIL_DOMAIN || "algomau.ca").toLowerCase(),
    challengeTtlMinutes: 10,
    maxChallengesPerWindow: 3,
    maxFailedAttemptsPerChallenge: 5,
    sessionTtlDays: 7,
    brevoApiKey,
    emailFrom,
    emailFromName: env.EMAIL_FROM_NAME || "Opportunity Registry",
    emailEnabled,
    // Defaults on only when email isn't configured, so there is always some way to sign in.
    testMode: env.SIGN_IN_TEST_MODE ? env.SIGN_IN_TEST_MODE === "true" : !emailEnabled,
  };
}

module.exports = { loadConfig };
