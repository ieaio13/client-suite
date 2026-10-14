// Sends email through your cPanel mailbox (SMTP_* settings) or, if those are not
// set, through Resend (RESEND_API_KEY). Returns true on success; failures are
// logged, never thrown, matching the old sendSafeEmail_.

let transporter = null;

async function smtpTransport() {
  if (!transporter) {
    const nodemailer = (await import('nodemailer')).default;
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
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

  const useSmtp = Boolean(process.env.SMTP_HOST);
  if (!useSmtp && !process.env.RESEND_API_KEY) {
    console.warn('Email skipped: set SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY).');
    return false;
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
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
    console.error('Email failure:', e);
    return false;
  }
}
