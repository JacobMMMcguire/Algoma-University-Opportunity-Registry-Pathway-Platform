// Returns a function that emails a sign-in code through Brevo's HTTPS API, or null when
// email isn't configured. HTTPS rather than SMTP because free Render services may block SMTP.
function createBrevoSender(config) {
  if (!config.emailEnabled) return null;

  return async function sendSignInEmail(email, code) {
    const minutes = config.challengeTtlMinutes;
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": config.brevoApiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: config.emailFromName, email: config.emailFrom },
        to: [{ email }],
        subject: "Your Opportunity Registry sign-in code",
        textContent:
          `Your sign-in code is ${code}. It expires in ${minutes} minutes and can only be used once.\n\n` +
          "If you did not request this, you can ignore this email.",
        htmlContent:
          `<p>Your sign-in code is <strong style="font-size:1.25em">${code}</strong>.</p>` +
          `<p>It expires in ${minutes} minutes and can only be used once.</p>` +
          "<p>If you did not request this, you can ignore this email.</p>",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Brevo responded ${response.status}: ${await response.text()}`);
    }
  };
}

module.exports = { createBrevoSender };
