const nodemailer = require("nodemailer");

function createResendMailer(apiKey, from, fetchImpl = fetch) {
  return {
    async sendPasswordReset({ to, name, url }) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "Khôi phục mật khẩu BookNest",
          text: `Xin chào ${name},\n\nĐể đặt lại mật khẩu BookNest, hãy mở liên kết sau trong vòng 1 giờ:\n${url}\n\nNếu bạn không yêu cầu khôi phục mật khẩu, hãy bỏ qua email này.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Resend trả về HTTP ${response.status}: ${detail.slice(0, 500)}`);
      }
    },
  };
}

function createSmtpMailer(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 587);
  const from = String(env.SMTP_FROM || "").trim();
  const user = String(env.SMTP_USER || "").trim();
  const password = String(env.SMTP_PASSWORD || "");
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(user || password ? { auth: { user, pass: password } } : {}),
  });

  return {
    async sendPasswordReset({ to, name, url }) {
      await transport.sendMail({
        from,
        to,
        subject: "Khôi phục mật khẩu BookNest",
        text: `Xin chào ${name},\n\nĐể đặt lại mật khẩu BookNest, hãy mở liên kết sau trong vòng 1 giờ:\n${url}\n\nNếu bạn không yêu cầu khôi phục mật khẩu, hãy bỏ qua email này.`,
      });
    },
  };
}

function createEmailMailer(env = process.env, fetchImpl = fetch) {
  const resendApiKey = String(env.RESEND_API_KEY || "").trim();
  const resendFrom = String(env.RESEND_FROM || "").trim();
  if (resendApiKey && resendFrom) {
    return createResendMailer(resendApiKey, resendFrom, fetchImpl);
  }
  return createSmtpMailer(env);
}

module.exports = { createEmailMailer, createResendMailer, createSmtpMailer };
