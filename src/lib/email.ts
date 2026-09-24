import nodemailer, {
  type Transporter,
  type TransportOptions,
} from "nodemailer";

/**
 * SMTP email delivery via nodemailer.
 *
 * Transport modes:
 * - When SMTP_HOST + SMTP_USER + SMTP_PASS are all set: real delivery through
 *   the provider (e.g. Gmail SMTP on 465 using an App Password).
 * - Otherwise everything prints to the server console with an "[email:dev]"
 *   prefix so auth flows stay testable locally. The very first code the
 *   developer needs to retrieve must never be lost, so this fallback exists
 *   even with no mail account configured.
 *
 * Failure handling: sends never throw to callers. The transport is probed once
 * (verify) at first use and every send is wrapped, so an SMTP outage or a
 * misconfiguration logs "[email:error]" instead of 500ing signup / resend /
 * reset-request. The verification code is already stored server-side, and the
 * resend endpoint gives the user another path to get the email.
 */
let transporterPromise: Promise<Transporter> | null = null;

/** Gmail, Mailtrap, Brevo, SES etc. need all three; blanks keep dev mode on. */
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      (process.env.SMTP_PASS ?? "") !== ""
  );
}

function smtpErrorSummary(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // Port 465 = implicit TLS (SMTPS); 587/25 use STARTTLS via nodemailer.
        secure: port === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        tls: {
          rejectUnauthorized:
            process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
        },
        // Optional persistent pool (default off) — handy for bulk resends.
        pool: process.env.SMTP_POOL === "true",
        maxConnections: 5,
        maxMessages: 100,
      } as TransportOptions);

      // Probe once on first use: a clear "connection/auth failed" line here is
      // far easier to diagnose than a stack trace from the first real send.
      try {
        await transporter.verify();
        console.log(`[email] SMTP connected (${process.env.SMTP_HOST}:${port})`);
      } catch (error) {
        console.error(
          `[email:error] SMTP verify failed for ${process.env.SMTP_HOST}:${port}: ${smtpErrorSummary(error)}`
        );
      }

      return transporter;
    })();
  }
  return transporterPromise;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  if (!isEmailConfigured()) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}`);
    return;
  }

  try {
    const transporter = await getTransporter();
    const from = process.env.EMAIL_FROM ?? process.env.SMTP_USER!;
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[email] sent to=${to} subject="${subject}"`);
  } catch (error) {
    // Soft-fail: log loudly, never 500 the calling route.
    console.error(
      `[email:error] failed to send "${subject}" to ${to}: ${smtpErrorSummary(error)}`
    );
  }
}

export async function sendVerificationEmail(
  to: string,
  code: string
): Promise<void> {
  await sendEmail(
    to,
    "Your SCOPE verification code",
    `<p>Your SCOPE verification code is:</p>
     <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
     <p>It expires in 10 minutes. If you didn't create a SCOPE account, you can ignore this email.</p>`
  );
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<void> {
  await sendEmail(
    to,
    "Reset your SCOPE password",
    `<p>We received a request to reset your password.</p>
     <p><a href="${resetUrl}">Choose a new password</a></p>
     <p>This link expires in 1 hour. If you didn't request it, you can ignore it.</p>`
  );
}