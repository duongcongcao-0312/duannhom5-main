const ALERT_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUEST_SAMPLES = 10000;

function normalizeRequestRoute(pathname) {
  if (pathname === "/" || pathname === "/health" || pathname === "/ready") {
    return pathname;
  }
  if (!pathname.startsWith("/api/")) return "/<static>";

  const segments = pathname.split("/").filter(Boolean);
  if (segments[1] === "payments" &&
      ["webhook", "sepay-webhook"].includes(segments[2])) {
    return `/api/payments/${segments[2]}`;
  }
  if (segments[1] === "admin" && segments[2]) {
    return `/api/admin/${segments[2]}`;
  }
  return segments.length > 1 ? `/api/${segments[1]}` : "/api";
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]);
}

class MonitoringMetrics {
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.requests = [];
    this.totalRequests = 0;
    this.paymentWebhookDuplicates = 0;
    this.lastAlertAt = new Map();
  }

  recordRequest({ method, pathname, status, durationMs }, now = this.clock()) {
    const sample = {
      at: now,
      method: String(method || "GET").toUpperCase(),
      route: normalizeRequestRoute(pathname || "/"),
      status: Number.isInteger(status) ? status : 500,
      durationMs: Math.max(0, Number(durationMs) || 0),
    };
    this.requests.push(sample);
    this.totalRequests += 1;
    if (this.requests.length > MAX_REQUEST_SAMPLES) this.requests.shift();
    return sample;
  }

  recordPaymentWebhookDuplicate() {
    this.paymentWebhookDuplicates += 1;
  }

  getSnapshot(now = this.clock()) {
    const recent = this.requests.filter((entry) => now - entry.at <= ALERT_WINDOW_MS);
    const apiRequests = recent.filter((entry) => entry.route.startsWith("/api/"));
    const apiErrors = apiRequests.filter((entry) => entry.status >= 500);
    const routes = new Map();
    for (const entry of recent) {
      const current = routes.get(entry.route) || {
        route: entry.route,
        requests: 0,
        errors: 0,
        conflicts: 0,
      };
      current.requests += 1;
      if (entry.status >= 500) current.errors += 1;
      if (entry.status === 409) current.conflicts += 1;
      routes.set(entry.route, current);
    }

    const paymentRequests = recent.filter((entry) => (
      entry.route === "/api/payments/webhook" ||
      entry.route === "/api/payments/sepay-webhook"
    ));
    const paymentConflicts = paymentRequests.filter((entry) => entry.status === 409).length;
    const paymentFailures = paymentRequests.filter((entry) => entry.status >= 500).length;
    const orderConflicts = recent.filter((entry) => (
      entry.route === "/api/orders" && entry.status === 409
    )).length;
    const durations = apiRequests.map((entry) => entry.durationMs);

    return {
      totalRequests: this.totalRequests,
      windowMinutes: ALERT_WINDOW_MS / 60_000,
      requestsLast5m: apiRequests.length,
      serverErrorsLast5m: apiErrors.length,
      errorRatePct: apiRequests.length
        ? Number(((apiErrors.length / apiRequests.length) * 100).toFixed(2))
        : 0,
      averageLatencyMs: durations.length
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
        : 0,
      p95LatencyMs: percentile(durations, 0.95),
      routes: [...routes.values()].sort((left, right) => right.requests - left.requests),
      payments: {
        webhookRequestsLast5m: paymentRequests.length,
        webhookFailuresLast5m: paymentFailures,
        webhookConflictsLast5m: paymentConflicts,
        orderConflictsLast5m: orderConflicts,
        duplicatesSinceStart: this.paymentWebhookDuplicates,
      },
    };
  }

  getTriggeredAlerts(now = this.clock()) {
    const snapshot = this.getSnapshot(now);
    const alerts = [];
    if (snapshot.serverErrorsLast5m >= 5) {
      alerts.push({
        event: "api_server_error_threshold",
        severity: "critical",
        count: snapshot.serverErrorsLast5m,
        threshold: "5 API 5xx responses within 5 minutes",
      });
    }
    if (this.requests.some((entry) => (
      entry.route === "/ready" &&
      entry.status >= 500 &&
      now - entry.at <= ALERT_WINDOW_MS
    ))) {
      alerts.push({
        event: "database_readiness_failed",
        severity: "critical",
        count: this.requests.filter((entry) => (
          entry.route === "/ready" &&
          entry.status >= 500 &&
          now - entry.at <= ALERT_WINDOW_MS
        )).length,
        threshold: "readiness returned 5xx",
      });
    }
    if (
      snapshot.payments.webhookFailuresLast5m >= 3 ||
      snapshot.payments.webhookConflictsLast5m >= 3
    ) {
      alerts.push({
        event: "payment_webhook_threshold",
        severity: "warning",
        count: Math.max(
          snapshot.payments.webhookFailuresLast5m,
          snapshot.payments.webhookConflictsLast5m,
        ),
        threshold: "3 payment webhook 5xx responses or conflicts within 5 minutes",
      });
    }
    if (snapshot.payments.orderConflictsLast5m >= 3) {
      alerts.push({
        event: "order_idempotency_conflict_threshold",
        severity: "warning",
        count: snapshot.payments.orderConflictsLast5m,
        threshold: "3 order HTTP 409 conflicts within 5 minutes",
      });
    }
    return alerts;
  }

  shouldSendAlert(event, now = this.clock(), cooldownMs = 15 * 60 * 1000) {
    const lastSentAt = this.lastAlertAt.get(event);
    if (lastSentAt === undefined) {
      this.lastAlertAt.set(event, now);
      return true;
    }
    if (now - lastSentAt < cooldownMs) return false;
    this.lastAlertAt.set(event, now);
    return true;
  }
}

function redactLogText(value, env = process.env) {
  let redacted = String(value ?? "");
  const requestIds = [];
  redacted = redacted.replace(
    /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi,
    (requestId) => {
      requestIds.push(requestId);
      return `BOOKNEST_REQUEST_ID_${requestIds.length - 1}`;
    },
  );
  for (const name of [
    "DATABASE_URL",
    "ADMIN_PASSWORD",
    "PAYMENT_WEBHOOK_SECRET",
    "SEPAY_API_KEY",
    "SMTP_PASSWORD",
    "SMTP_PASS",
    "RESEND_API_KEY",
    "FIREBASE_API_KEY",
    "METRICS_TOKEN",
    "MONITORING_ALERT_WEBHOOK_URL",
    "SMOKE_ALERT_WEBHOOK_URL",
    "BACKUP_ALERT_WEBHOOK_URL",
  ]) {
    const secret = env[name];
    if (typeof secret === "string" && secret.length >= 6) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  redacted = redacted
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*["']?)[^"'\s,;&]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?\d[\d\s()-]{7,}\d)\b/g, "[REDACTED_PHONE]");
  return redacted.replace(
    /BOOKNEST_REQUEST_ID_(\d+)/g,
    (_match, index) => requestIds[Number(index)] || "[REDACTED]",
  );
}

module.exports = {
  ALERT_WINDOW_MS,
  MonitoringMetrics,
  normalizeRequestRoute,
  redactLogText,
};
