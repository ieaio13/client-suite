// Sends email through your cPanel mailbox (SMTP_* settings) or, if those are not
// set, through Resend (RESEND_API_KEY). Returns true on success; failures are
// logged, never thrown, matching the old sendSafeEmail_.

let transporter = null;

// Settings pasted into cPanel often carry stray spaces or invisible characters,
// which make the mail server name unreadable (EBADNAME). Strip them.
function setting(name) {
  return String(process.env[name] || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
}

async function smtpTransport() {
  if (!transporter) {
    const nodemailer = (await import('nodemailer')).default;
    const port = Number(setting('SMTP_PORT') || 465);
    transporter = nodemailer.createTransport({
      host: setting('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: { user: setting('SMTP_USER'), pass: process.env.SMTP_PASS },
      // cPanel mail servers often present a certificate for the server's own hostname
      // rather than mail.<your-domain>; SMTP_TLS_INSECURE=true accepts it anyway.
      tls: String(process.env.SMTP_TLS_INSECURE || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
  }
  return transporter;
}

function describeEmailError(e) {
  const parts = [];
  if (e && e.code) parts.push(e.code);
  if (e && e.responseCode) parts.push(String(e.responseCode));
  parts.push(e && e.message ? e.message : String(e));
  return parts.join(' ');
}

// Connects and logs in to the mail server without sending anything (for /api/health).
export async function checkEmail() {
  if (!setting('SMTP_HOST')) return process.env.RESEND_API_KEY ? 'resend (not checked)' : 'not configured';
  try {
    await (await smtpTransport()).verify();
    return 'ok';
  } catch (e) {
    transporter = null; // retry fresh next time, e.g. after settings change
    return 'error: ' + describeEmailError(e);
  }
}

async function sendViaSmtp({ from, recipients, subject, html, attachments }) {
  const transport = await smtpTransport();
  await transport.sendMail({
    from,
    to: recipients.join(', '),
    subject,
    html,
    attachments: (attachments || []).map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' }))
  });
}

async function sendViaResend({ from, recipients, subject, html, attachments }) {
  const body = { from, to: recipients, subject, html };
  if (attachments && attachments.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()));
}

// attachments: [{ filename, content: <base64 string> }]
export async function sendEmail({ to, subject, html, attachments }) {
  const recipients = String(to || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) return false;

  const useSmtp = Boolean(setting('SMTP_HOST'));
  if (!useSmtp && !process.env.RESEND_API_KEY) {
    console.warn('Email skipped: set SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY).');
    return false;
  }
  const from = String(process.env.MAIL_FROM || '').trim() || setting('SMTP_USER');
  if (!from) {
    console.warn('Email skipped: MAIL_FROM is not set.');
    return false;
  }

  try {
    const msg = { from, recipients, subject, html, attachments };
    if (useSmtp) await sendViaSmtp(msg);
    else await sendViaResend(msg);
    return true;
  } catch (e) {
    console.error('Email failure:', describeEmailError(e));
    transporter = null;
    return false;
  }
}
