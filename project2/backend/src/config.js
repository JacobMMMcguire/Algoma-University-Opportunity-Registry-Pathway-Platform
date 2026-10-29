const MIN_OPERATOR_SECRET_LENGTH = 24;

// R3-08 to R3-10 (R3_PLAN.md, D3): CLOCK_DATE=YYYY-MM-DD makes the app treat that date as today
// for deadlines, so the R3 fixture can be evaluated as of its evaluation_date. Unset means the
// real date. A malformed value stops the server rather than silently using the wrong date.
function parseClockDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!date || date.toISOString().slice(0, 10) !== value.trim()) {
    throw new Error(`CLOCK_DATE must be a real date written YYYY-MM-DD, not "${value}".`);
  }
  return value.trim();
}

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
    // Lets an authorised operator read test-account codes without a staff session. Too short
    // to resist guessing means disabled.
    clockDate: parseClockDate(env.CLOCK_DATE),
    operatorSecret: (env.OPERATOR_SECRET || "").length >= MIN_OPERATOR_SECRET_LENGTH ? env.OPERATOR_SECRET : "",
  };
}

module.exports = { loadConfig, parseClockDate, MIN_OPERATOR_SECRET_LENGTH };
