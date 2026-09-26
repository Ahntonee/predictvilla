const nodemailer = require('nodemailer');

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM || 'Predictvilla <noreply@predictvilla.com>';
const SITE_URL = process.env.SITE_URL || 'https://www.predictvilla.com';

function brandedEmail(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#07191e;font-family:'Open Sans',Arial,sans-serif;color:#e8f4f8}
  .wrap{max-width:600px;margin:0 auto;background:#003152;border-radius:14px;overflow:hidden}
  .header{background:#003333;padding:28px 32px;text-align:center}
  .header h1{margin:0;color:#02f5a1;font-size:24px;letter-spacing:1px}
  .header p{margin:4px 0 0;color:#addff1;font-size:13px}
  .body{padding:32px}
  .body h2{color:#02f5a1;margin-top:0}
  .body p{line-height:1.7;color:#e8f4f8}
  .btn{display:inline-block;background:#02f5a1;color:#07191e;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;margin-top:20px}
  .footer{background:#07191e;padding:20px 32px;text-align:center;font-size:12px;color:#addff1}
  .footer a{color:#02f5a1;text-decoration:none}
</style>
</head>
<body>
<div style="padding:24px 16px">
<div class="wrap">
  <div class="header">
    <h1>⚡ Predictvilla</h1>
    <p>Data-Driven Picks. Proven Results.</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">
    &copy; 2025 Predictvilla &bull; <a href="${SITE_URL}/privacy.html">Privacy</a> &bull; <a href="${SITE_URL}/terms.html">Terms</a><br>
    For entertainment only. Please gamble responsibly.
  </div>
</div>
</div>
</body></html>`;
}

async function sendWelcomeEmail({ name, email }) {
  await transport.sendMail({
    from: FROM, to: email,
    subject: 'Welcome to Predictvilla! 🎯',
    html: brandedEmail('Welcome to Predictvilla', `
      <h2>Welcome, ${name}! 🎉</h2>
      <p>You're now part of the Predictvilla community — where data meets football intelligence.</p>
      <p>Start exploring today's free predictions and consider upgrading to VIP for our highest-confidence picks.</p>
      <a class="btn" href="${SITE_URL}/predictions.html">View Today's Tips</a>
      <p style="margin-top:24px;color:#addff1;font-size:13px">Need help? Reply to this email anytime.</p>
    `),
  });
}

async function sendVerificationEmail({ name, email, otp }) {
  await transport.sendMail({
    from: FROM, to: email,
    subject: `Your Predictvilla verification code: ${otp}`,
    html: brandedEmail('Verify Your Email', `
      <h2>Verify your email, ${name}</h2>
      <p>Enter this 6-digit code to complete your registration. It expires in <strong>15 minutes</strong>.</p>
      <div style="text-align:center;margin:28px 0">
        <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#02f5a1">${otp}</span>
      </div>
      <p style="color:#addff1;font-size:13px">If you didn't sign up for Predictvilla, you can safely ignore this email.</p>
    `),
  });
}

async function sendPasswordResetEmail({ name, email, resetUrl }) {
  await transport.sendMail({
    from: FROM, to: email,
    subject: 'Reset your Predictvilla password',
    html: brandedEmail('Reset Your Password', `
      <h2>Password reset request</h2>
      <p>Hi ${name},</p>
      <p>We received a request to reset your Predictvilla password. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <a class="btn" href="${resetUrl}">Reset Password</a>
      <p style="margin-top:24px;color:#addff1;font-size:13px">If you didn't request a password reset, ignore this email — your account is safe.</p>
    `),
  });
}

async function sendExpiryReminderEmail({ name, email, plan, expiresAt }) {
  const expDate = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  await transport.sendMail({
    from: FROM, to: email,
    subject: 'Your Predictvilla VIP is expiring soon',
    html: brandedEmail('VIP Expiring Soon', `
      <h2>Your VIP subscription is ending soon</h2>
      <p>Hi ${name},</p>
      <p>Your <strong>${plan}</strong> VIP subscription expires on <strong>${expDate}</strong>.</p>
      <p>Renew now to keep enjoying our Intelligence Engine picks, banker-of-the-day selections, and access to the VIP Telegram channel.</p>
      <a class="btn" href="${SITE_URL}/pricing.html">Renew VIP Now</a>
    `),
  });
}

async function sendVipWelcomeEmail({ name, email, plan, telegramLink }) {
  await transport.sendMail({
    from: FROM, to: email,
    subject: '🏆 Welcome to Predictvilla VIP!',
    html: brandedEmail('VIP Access Activated', `
      <h2>You're now a VIP member! 🏆</h2>
      <p>Hi ${name},</p>
      <p>Your <strong>${plan}</strong> VIP subscription is now active. You have full access to:</p>
      <ul>
        <li>All VIP prediction cards (fully unlocked)</li>
        <li>Intelligence Engine picks</li>
        <li>Banker-of-the-day exclusives</li>
        <li>Early access to tomorrow's tips</li>
        <li>VIP Telegram channel</li>
      </ul>
      ${telegramLink ? `<p><strong>Join your exclusive VIP Telegram channel:</strong></p><a class="btn" href="${telegramLink}">Join Telegram VIP Channel</a>` : ''}
      <p style="margin-top:24px"><a href="${SITE_URL}/predictions.html" style="color:#02f5a1">View VIP Predictions →</a></p>
    `),
  });
}

// Forwards a validated website contact message without rendering user input as HTML.
async function sendContactEmail({ name, email, subject, message }) {
  const supportEmail = process.env.CONTACT_EMAIL || process.env.SMTP_USER;
  if (!supportEmail) throw new Error('Contact email is not configured');
  await transport.sendMail({
    from: FROM,
    to: supportEmail,
    replyTo: email,
    subject: `[Predictvilla Contact] ${subject || 'General enquiry'}`,
    text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject || 'General enquiry'}\n\n${message}`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendExpiryReminderEmail,
  sendVipWelcomeEmail,
  sendContactEmail,
};
