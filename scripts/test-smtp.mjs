#!/usr/bin/env node
/**
 * SMTP probe + test mail.
 *
 * Usage:  npm run email:test [recipient@example.com]
 *
 * Loads .env (node --env-file) and verifies the SMTP connection, then sends a
 * test message — by default to the configured SMTP_USER (useful for Gmail:
 * you'll receive it in the same inbox you send from).
 *
 * Exits non-zero on any configuration or transport failure so it fails CI.
 */
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error(
    "[email] Not configured: set SMTP_HOST, SMTP_USER and SMTP_PASS in .env (Gmail: host smtp.gmail.com, port 465, user = your Gmail, pass = a 16-char App Password from your Google account)."
  );
  process.exit(1);
}

const port = Number(SMTP_PORT ?? 587);
const from = EMAIL_FROM || SMTP_USER;
const to = process.argv[2] || SMTP_USER;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
});

try {
  await transporter.verify();
  console.log(`[email] SMTP OK: ${SMTP_HOST}:${port} authenticated as ${SMTP_USER}`);
} catch (error) {
  console.error(
    `[email:error] SMTP verify failed for ${SMTP_HOST}:${port}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
}

try {
  await transporter.sendMail({
    from,
    to,
    subject: "[SCOPE] SMTP test",
    html: `<p>Your SCOPE SMTP settings work.</p><p>Recipient: ${to}</p>`,
  });
  console.log(`[email] test message sent to ${to} (from ${from})`);
} catch (error) {
  console.error(
    `[email:error] send failed to ${to}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
}