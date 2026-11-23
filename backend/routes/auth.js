const { appendAuditEntry } = require("../audit");
const {
  RefreshTokenReuseError,
  hashPassword,
  needsPasswordRehash,
  validatePasswordPolicy,
} = require("../auth");
const {
  CSRF_COOKIE_NAME,
  buildAuthCookieHeaders,
  buildClearAuthCookieHeaders,
  createCsrfToken,
  extractSessionToken,
} = require("../csrf");
const { redactLogText } = require("../monitoring");
const { requireOwnershipOrPermission } = require("../authorization");
const {
  ProfileUpdateError,
  RECENT_LOGIN_WINDOW_MS,
  diffCustomerInfo,
  findPhoneConflict,
  parseProfileUpdate,
  pickSelfServiceFields,
  requiresConfirmation,
} = require("../profile-update");

function withErrorCode(error, errorCode) {
  error.errorCode = errorCode;
  return error;
}

function createAuthRoutes(dependencies) {
  const { RequestError, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ROLES, appBaseUrl, auditLogPath, db, dispatchMonitoringAlert, getAuthUser, getClientAddress, hashPasswordResetToken, isPasswordValid, loginAttemptLimit, loginAttemptWindowMs, loginAccountAttemptLimit = 10, loginAccountWindowMs = 15 * 60 * 1000, passwordResetEmailLimit, passwordResetIpLimit, passwordResetWindowMs, passwordResetTtlMs = 60 * 60 * 1000, emailVerificationTtlMs = 24 * 60 * 60 * 1000, passwordResetMailer, payloadSchemas, privacyExportStore, publicUser, randomBytes, rateLimitRequest, clearRateLimit, readJson, registrationAttemptLimit, registrationAttemptWindowMs, requireJsonObject, sanitizePlainText, sendJson, sessionStore, socialTokenVerifier, verifyPassword, verifyPasswordReauthentication, verifySocialIdentity } = dependencies;
  function toRequestError(error) {
    if (error instanceof ProfileUpdateError) {
      return withErrorCode(new RequestError(error.status, error.message), error.errorCode);
    }
    return error;
  }
  return async function handleRoute(request, response, requestUrl) {
if (
  requestUrl.pathname === "/api/auth/csrf-token" &&
  request.method === "GET"
) {
  const csrfToken = createCsrfToken();
  const isSecure = request.socket?.encrypted === true ||
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  response.setHeader(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; SameSite=Lax${isSecure ? "; Secure" : ""}`,
  );
  sendJson(response, 200, {
    csrfToken,
    cookieName: CSRF_COOKIE_NAME,
    headerName: "X-CSRF-Token",
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/verify-email/request" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  let email = session?.email ? String(session.email).trim().toLowerCase() : "";
  if (!email && (Number(request.headers["content-length"] || 0) > 0 || request.headers["content-type"])) {
    const payload = requireJsonObject(
      await readJson(request),
      "Email không hợp lệ.",
      payloadSchemas.passwordReset,
    );
    if (typeof payload.email === "string") {
      email = sanitizePlainText(payload.email, 254).toLowerCase();
    }
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, "Vui lòng nhập địa chỉ email hợp lệ.");
  }

  let verifyBase;
  try {
    verifyBase = new URL(String(appBaseUrl || ""));
    if (
      !["http:", "https:"].includes(verifyBase.protocol) ||
      verifyBase.username ||
      verifyBase.password ||
      verifyBase.search ||
      verifyBase.hash
    ) {
      throw new Error("Invalid public app URL.");
    }
    if (!verifyBase.pathname.endsWith("/")) verifyBase.pathname += "/";
  } catch {
    throw new RequestError(503, "Xác thực email chưa được cấu hình địa chỉ website.");
  }
  await db.init();
  if (!passwordResetMailer || typeof passwordResetMailer.sendEmailVerification !== "function") {
    throw new RequestError(503, "Xác thực email chưa được cấu hình dịch vụ gửi email.");
  }

  const address = getClientAddress(request);
  const tooManyRequests = "Bạn đã yêu cầu gửi xác thực email quá nhiều lần. Vui lòng thử lại sau.";
  await rateLimitRequest(
    response,
    "email-verify-ip",
    address,
    passwordResetIpLimit,
    passwordResetWindowMs,
    tooManyRequests,
  );
  await rateLimitRequest(
    response,
    "email-verify-email",
    email,
    passwordResetEmailLimit,
    passwordResetWindowMs,
    tooManyRequests,
  );

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + emailVerificationTtlMs).toISOString();
  const user = await db.createEmailVerificationToken(email, tokenHash, expiresAt);
  if (user) {
    verifyBase.hash = new URLSearchParams({ verifyEmailToken: token }).toString();
    try {
      await passwordResetMailer.sendEmailVerification({
        to: user.email,
        name: user.name,
        url: verifyBase.toString(),
      });
    } catch (error) {
      await db.clearEmailVerificationToken(tokenHash);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "email_verification_delivery_failed",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
        message: redactLogText(error?.message),
      }));
      throw new RequestError(
        503,
        "Không thể gửi email xác thực. Vui lòng kiểm tra cấu hình nhà cung cấp email hoặc thử lại sau.",
      );
    }
  }
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.email_verification.requested",
      actorId: session?.userId || null,
      actorRole: session?.role || "anonymous",
      entityType: "auth",
      entityId: null,
      outcome: "attempt",
      statusCode: 200,
      requestId: response.getHeader("X-Request-Id"),
      metadata: { deliveryAttempted: true },
    }).catch(() => {});
  }
  sendJson(response, 200, {
    message: "Nếu email chưa được xác minh, liên kết xác thực đã được gửi đến hộp thư của bạn.",
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/verify-email/confirm" &&
  request.method === "POST"
) {
  await rateLimitRequest(
    response,
    "email-verify-confirm",
    getClientAddress(request),
    passwordResetIpLimit,
    passwordResetWindowMs,
    "Bạn đã thử xác thực email quá nhiều lần. Vui lòng thử lại sau.",
  );
  const payload = requireJsonObject(
    await readJson(request),
    "Yêu cầu xác thực email không hợp lệ.",
    {
      allowed: ["token"],
      required: ["token"],
      types: { token: "string" },
      preserveStrings: ["token"],
    },
  );
  const token = sanitizePlainText(
    typeof payload.token === "string" ? payload.token : String(payload.token || ""),
    128,
  );
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new RequestError(400, "Liên kết xác thực email không hợp lệ hoặc đã hết hạn.");
  }
  const verifiedUser = await db.verifyEmailToken(token);
  if (!verifiedUser) {
    throw new RequestError(400, "Liên kết xác thực email không hợp lệ hoặc đã hết hạn.");
  }
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.email_verification.completed",
      actorId: verifiedUser.id,
      actorRole: verifiedUser.role,
      entityType: "user",
      entityId: verifiedUser.id,
      outcome: "success",
      statusCode: 200,
      requestId: response.getHeader("X-Request-Id"),
      metadata: { emailVerified: true },
    }).catch(() => {});
  }
  sendJson(response, 200, {
    verified: true,
    user: publicUser(verifiedUser),
    message: "Email đã được xác thực thành công.",
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/password-reset" &&
  request.method === "POST"
) {
  const payload = requireJsonObject(
    await readJson(request),
    "Email không hợp lệ.",
    payloadSchemas.passwordReset,
  );
  const email = sanitizePlainText(
    typeof payload.email === "string" ? payload.email : String(payload.email || ""),
    254,
  ).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, "Vui lòng nhập địa chỉ email hợp lệ.");
  }

  const now = Date.now();
  let resetBase;
  try {
    resetBase = new URL(String(appBaseUrl || ""));
    if (
      !["http:", "https:"].includes(resetBase.protocol) ||
      resetBase.username ||
      resetBase.password ||
      resetBase.search ||
      resetBase.hash
    ) {
      throw new Error("Invalid public app URL.");
    }
    if (!resetBase.pathname.endsWith("/")) resetBase.pathname += "/";
  } catch {
    throw new RequestError(503, "Khôi phục mật khẩu chưa được cấu hình địa chỉ website.");
  }
  await db.init();
  if (!passwordResetMailer) {
    throw new RequestError(503, "Khôi phục mật khẩu chưa được cấu hình email.");
  }

  const address = getClientAddress(request);
  const tooManyPasswordResets =
    "Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.";
  await rateLimitRequest(
    response,
    "password-reset-ip",
    address,
    passwordResetIpLimit,
    passwordResetWindowMs,
    tooManyPasswordResets,
  );
  await rateLimitRequest(
    response,
    "password-reset-email",
    email,
    passwordResetEmailLimit,
    passwordResetWindowMs,
    tooManyPasswordResets,
  );

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(token);
  const user = await db.createPasswordResetToken(
    email,
    tokenHash,
    new Date(now + passwordResetTtlMs).toISOString(),
  );
  if (user) {
    resetBase.hash = new URLSearchParams({ resetToken: token }).toString();
    try {
      await passwordResetMailer.sendPasswordReset({
        to: user.email,
        name: user.name,
        url: resetBase.toString(),
      });
    } catch (error) {
      await db.clearPasswordResetToken(tokenHash);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "password_reset_delivery_failed",
        errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
        message: redactLogText(error?.message),
      }));
      throw new RequestError(
        503,
        "Không thể gửi email khôi phục. Vui lòng kiểm tra cấu hình nhà cung cấp email hoặc thử lại sau.",
      );
    }
  }
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.password_reset.requested",
      actorId: null,
      actorRole: "anonymous",
      entityType: "auth",
      entityId: null,
      outcome: "attempt",
      statusCode: 200,
      requestId: response.getHeader("X-Request-Id"),
      metadata: { deliveryAttempted: true },
    }).catch(() => {});
  }
  sendJson(response, 200, {
    message: "Nếu email được đăng ký, hướng dẫn khôi phục mật khẩu sẽ được gửi đến hộp thư của bạn.",
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/password-reset/confirm" &&
  request.method === "POST"
) {
  await rateLimitRequest(
    response,
    "password-reset-confirm",
    getClientAddress(request),
    passwordResetIpLimit,
    passwordResetWindowMs,
    "Bạn đã thử đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau.",
  );
  const payload = requireJsonObject(
    await readJson(request),
    "Yêu cầu đặt lại mật khẩu không hợp lệ.",
    payloadSchemas.passwordResetConfirm,
  );
  const token = sanitizePlainText(
    typeof payload.token === "string" ? payload.token : String(payload.token || ""),
    128,
  );
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new RequestError(400, "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.");
  }
  const passwordCheck = validatePasswordPolicy(password);
  if (!passwordCheck.valid) {
    throw withErrorCode(new RequestError(400, passwordCheck.message), passwordCheck.code);
  }
  const userId = await db.resetPassword(token, password);
  if (!userId) {
    throw new RequestError(400, "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.");
  }
  await sessionStore.destroyUserSessions(userId);
  if (privacyExportStore && typeof privacyExportStore.purgeUserExports === "function") {
    privacyExportStore.purgeUserExports(userId);
  }
  response.setHeader("Set-Cookie", buildClearAuthCookieHeaders(request));
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.password_reset.completed",
      actorId: userId,
      actorRole: "user",
      entityType: "user",
      entityId: userId,
      outcome: "success",
      statusCode: 200,
      requestId: response.getHeader("X-Request-Id"),
      metadata: { sessionsRevoked: true },
    }).catch(() => {});
  }
  sendJson(response, 200, { message: "Mật khẩu đã được cập nhật." });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/register" &&
  request.method === "POST"
) {
  const address = getClientAddress(request);
  await rateLimitRequest(
    response,
    "registration",
    address,
    registrationAttemptLimit,
    registrationAttemptWindowMs,
    "Bạn đã đăng ký quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  );
  const payload = requireJsonObject(
    await readJson(request),
    "Vui lòng điền đầy đủ họ tên, email và mật khẩu.",
    payloadSchemas.register,
  );
  const name = sanitizePlainText(
    typeof payload.name === "string" ? payload.name : String(payload.name || ""),
    120,
  );
  const email = sanitizePlainText(
    typeof payload.email === "string" ? payload.email : String(payload.email || ""),
    254,
  ).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!name || !email || !password) {
    throw new RequestError(
      400,
      "Vui lòng điền đầy đủ họ tên, email và mật khẩu.",
    );
  }
  const registerPasswordCheck = validatePasswordPolicy(password, { email });
  if (!registerPasswordCheck.valid) {
    throw withErrorCode(
      new RequestError(400, registerPasswordCheck.message),
      registerPasswordCheck.code,
    );
  }
  try {
    const user = await db.createUser({
      name,
      email,
      password,
      studentType: sanitizePlainText(
        typeof payload.studentType === "string" ? payload.studentType : "other",
        32,
      ) || "other",
      studentId: sanitizePlainText(
        typeof payload.studentId === "string" ? payload.studentId : "",
        64,
      ),
    });
    const session = await sessionStore.createSession(user);
    response.setHeader(
      "Set-Cookie",
      buildAuthCookieHeaders(request, { sessionToken: session.token, expiresAt: session.expiresAt }),
    );
    sendJson(response, 201, {
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      user: publicUser(user),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Email này đã được đăng ký trên hệ thống.") {
      throw new RequestError(
        409,
        "Không thể hoàn tất đăng ký với thông tin đã cung cấp. Vui lòng kiểm tra và thử lại.",
      );
    }
    throw new RequestError(
      503,
      "Hệ thống hiện không thể lưu tài khoản. Vui lòng thử lại sau hoặc liên hệ quản trị viên.",
      err,
    );
  }
  return true;
}

if (
  requestUrl.pathname === "/api/auth/login" &&
  request.method === "POST"
) {
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu đăng nhập không hợp lệ.",
    payloadSchemas.login,
  );
  const address = getClientAddress(request);
  const email = sanitizePlainText(
    typeof payload.email === "string" ? payload.email : String(payload.email || ""),
    254,
  ).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  const requestId = response.getHeader("X-Request-Id");
  const bruteForceMessage = "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.";

  async function enforceLoginLimit(scope, identity, limit, windowMs) {
    try {
      await rateLimitRequest(response, scope, identity, limit, windowMs, bruteForceMessage);
    } catch (error) {
      if (error instanceof RequestError && error.status === 429) {
        await appendAuditEntry(auditLogPath, {
          action: "auth.login.blocked",
          actorId: null,
          actorRole: "anonymous",
          entityType: "auth",
          entityId: null,
          outcome: "denied",
          statusCode: 429,
          requestId,
          metadata: {
            scope,
            reason: "brute_force_threshold_exceeded",
          },
        }).catch(() => {});
        if (typeof dispatchMonitoringAlert === "function") {
          dispatchMonitoringAlert({
            event: "auth_login_brute_force_blocked",
            severity: "warning",
            count: 1,
            threshold: `${scope}:${limit}/${Math.round(windowMs / 1000)}s`,
          }, requestId);
        }
      }
      throw error;
    }
  }

  await enforceLoginLimit("login", address, loginAttemptLimit, loginAttemptWindowMs);
  if (email) {
    await enforceLoginLimit(
      "login-account",
      email,
      loginAccountAttemptLimit,
      loginAccountWindowMs,
    );
  }

  const user = await db.findUserByEmail(email);
  if (
    !user ||
    user.isActive === false ||
    user.passwordAuthEnabled === false ||
    !verifyPassword(password, user.password)
  ) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.login.failed",
      actorId: null,
      actorRole: "anonymous",
      entityType: "auth",
      entityId: null,
      outcome: "failure",
      statusCode: 401,
      requestId,
      metadata: {
        reason: "invalid_credentials",
      },
    }).catch(() => {});
    throw new RequestError(401, "Email hoặc mật khẩu không chính xác.");
  }
  if (user.mustResetPassword === true) {
    throw withErrorCode(
      new RequestError(
        403,
        "Tài khoản đang yêu cầu đặt lại mật khẩu vì lý do bảo mật. Vui lòng dùng chức năng khôi phục mật khẩu trước khi đăng nhập.",
      ),
      "PASSWORD_RESET_REQUIRED",
    );
  }
  await clearRateLimit("login", address);
  if (email) await clearRateLimit("login-account", email);
  if (needsPasswordRehash(user.password) && typeof db.updateUserPasswordHash === "function") {
    try {
      await db.updateUserPasswordHash(user.id, hashPassword(password));
      await appendAuditEntry(auditLogPath, {
        action: "auth.password.rehashed",
        actorId: user.id,
        actorRole: user.role,
        entityType: "user",
        entityId: user.id,
        outcome: "success",
        statusCode: 200,
        requestId,
        metadata: { reason: "hash_format_upgrade" },
      }).catch(() => {});
    } catch {
      // Do not fail a valid login if transparent password rehash persistence fails.
    }
  }
  const session = await sessionStore.createSession(user);
  response.setHeader(
    "Set-Cookie",
    buildAuthCookieHeaders(request, { sessionToken: session.token, expiresAt: session.expiresAt }),
  );
  await appendAuditEntry(auditLogPath, {
    action: "auth.login.succeeded",
    actorId: user.id,
    actorRole: user.role,
    entityType: "auth",
    entityId: user.id,
    outcome: "success",
    statusCode: 200,
    requestId,
    metadata: {
      authMethod: "password",
    },
  }).catch(() => {});
  sendJson(response, 200, {
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    user: publicUser(user),
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/social" &&
  request.method === "POST"
) {
  await rateLimitRequest(
    response,
    "social-login",
    getClientAddress(request),
    loginAttemptLimit,
    loginAttemptWindowMs,
    "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  );
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu xác thực không hợp lệ.",
    payloadSchemas.socialAuth,
  );
  const authHeader = request.headers["authorization"] || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "").trim() ||
    (typeof payload.idToken === "string" ? payload.idToken.trim() : "");
  if (!idToken) throw new RequestError(401, "Thiếu Firebase ID Token.");

  const { email, name, provider, providerId } = await verifySocialIdentity(
    idToken,
    socialTokenVerifier,
  );

  const user = await db.findOrCreateSocialUser({
    name,
    email,
    authProvider: provider,
    providerId,
    emailVerified: true,
  });
  if (user.role === ROLES.ADMIN) {
    throw new RequestError(403, "Tài khoản quản trị không được đăng nhập bằng social.");
  }

  const session = await sessionStore.createSession(user);
  response.setHeader(
    "Set-Cookie",
    buildAuthCookieHeaders(request, { sessionToken: session.token, expiresAt: session.expiresAt }),
  );
  sendJson(response, 200, {
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    user: publicUser(user),
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/social/link" &&
  request.method === "POST"
) {
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu liên kết tài khoản không hợp lệ.",
    payloadSchemas.socialAuthLink,
  );
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  const user = await db.findUserById(session.userId);
  if (!user || user.isActive === false || user.role === ROLES.ADMIN) {
    throw new RequestError(403, "Không thể liên kết tài khoản social.");
  }
  await verifyPasswordReauthentication(request, response, user, payload.password);
  const identity = await verifySocialIdentity(payload.idToken, socialTokenVerifier);
  const linkedUser = await db.linkSocialAccount(
    user.id,
    identity.provider,
    identity.providerId,
  );
  sendJson(response, 200, { user: publicUser(linkedUser) });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/social/unlink" &&
  request.method === "POST"
) {
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu tách tài khoản không hợp lệ.",
    payloadSchemas.socialAuthUnlink,
  );
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  const user = await db.findUserById(session.userId);
  if (!user || user.isActive === false || user.role === ROLES.ADMIN) {
    throw new RequestError(403, "Không thể tách tài khoản social.");
  }
  await verifyPasswordReauthentication(request, response, user, payload.password);
  const updatedUser = await db.unlinkSocialAccount(user.id, payload.provider);
  sendJson(response, 200, { user: publicUser(updatedUser) });
  return true;
}

if (requestUrl.pathname === "/api/auth/me" && request.method === "GET") {
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new RequestError(400, "Endpoint /api/auth/me không chấp nhận tham số truy vấn.");
  }
  const user = await getAuthUser(request);
  if (!user) {
    throw new RequestError(401, "Chưa đăng nhập.");
  }
  const storedUser = await db.findUserById(user.userId);
  sendJson(response, 200, { user: publicUser(storedUser || user) });
  return true;
}

const userProfileMatch = requestUrl.pathname.match(
  /^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (userProfileMatch) {
  const targetUserId = userProfileMatch[1];
  const session = await getAuthUser(request);
  if (!session) {
    throw new RequestError(401, "Chưa đăng nhập.");
  }

  if (request.method === "GET") {
    requireOwnershipOrPermission(
      session,
      {
        ownerId: targetUserId,
        permission: "read:users",
        message: "Bạn không có quyền xem hồ sơ của tài khoản khác.",
      },
      RequestError,
    );
    const targetUser = await db.findUserById(targetUserId);
    if (!targetUser) {
      throw new RequestError(404, "Không tìm thấy tài khoản.");
    }
    sendJson(response, 200, { user: publicUser(targetUser) });
    return true;
  }

  if (request.method === "PATCH" || request.method === "PUT") {
    requireOwnershipOrPermission(
      session,
      {
        ownerId: targetUserId,
        permission: "write:users",
        message: "Bạn không có quyền cập nhật hồ sơ của tài khoản khác.",
      },
      RequestError,
    );
    const rawPayload = await readJson(request);
    let parsed;
    try {
      parsed = parseProfileUpdate(rawPayload, sanitizePlainText);
    } catch (error) {
      throw toRequestError(error);
    }
    const targetUser = await db.findUserById(targetUserId);
    if (!targetUser || targetUser.isActive === false) {
      throw new RequestError(404, "Không tìm thấy tài khoản.");
    }
    const currentInfo = targetUser.customerInfo || {};
    const changed = diffCustomerInfo(currentInfo, parsed.changes);
    const changedFields = Object.keys(changed);
    if (changedFields.length === 0) {
      sendJson(response, 200, {
        customerInfo: pickSelfServiceFields(currentInfo),
        changedFields: [],
        ordersUpdated: 0,
      });
      return true;
    }
    if (changed.phone && typeof db.getUsers === "function") {
      const users = await db.getUsers();
      if (findPhoneConflict(users, targetUser.id, changed.phone)) {
        throw withErrorCode(
          new RequestError(
            409,
            "Số điện thoại này không thể dùng cho tài khoản của bạn. Vui lòng liên hệ hỗ trợ nếu cần.",
          ),
          "PHONE_IN_USE",
        );
      }
    }
    let confirmation = "none";
    if (session.userId === targetUser.id && requiresConfirmation(currentInfo, changed)) {
      if (targetUser.passwordAuthEnabled !== false) {
        if (!parsed.currentPassword) {
          throw withErrorCode(
            new RequestError(428, "Thay đổi số điện thoại cần xác nhận bằng mật khẩu hiện tại."),
            "REAUTH_REQUIRED",
          );
        }
        await verifyPasswordReauthentication(request, response, targetUser, parsed.currentPassword);
        confirmation = "password";
      } else {
        const sessionAge = Date.now() - Number(session.createdAt || 0);
        if (!(sessionAge >= 0 && sessionAge <= RECENT_LOGIN_WINDOW_MS)) {
          throw withErrorCode(
            new RequestError(
              428,
              "Thay đổi số điện thoại cần đăng nhập lại để xác nhận. Vui lòng đăng xuất và đăng nhập lại.",
            ),
            "RECENT_LOGIN_REQUIRED",
          );
        }
        confirmation = "recent_login";
      }
    }
    const updatedUser = await db.updateCustomerInfo(
      targetUser.id,
      changed,
      session.userId,
      session.role,
      { confirmation },
    );
    if (!updatedUser) {
      throw new RequestError(404, "Không tìm thấy tài khoản.");
    }
    sendJson(response, 200, {
      customerInfo: pickSelfServiceFields(updatedUser.customerInfo),
      changedFields,
      ordersUpdated: 0,
    });
    return true;
  }

  if (request.method === "DELETE") {
    requireOwnershipOrPermission(
      session,
      {
        ownerId: targetUserId,
        permission: "write:users",
        message: "Bạn không có quyền xóa hồ sơ của tài khoản khác.",
      },
      RequestError,
    );
    throw withErrorCode(
      new RequestError(
        403,
        "Không hỗ trợ xóa trực tiếp tài khoản; vui lòng gửi yêu cầu xóa dữ liệu qua /api/v1/privacy/data-requests.",
      ),
      "GOVERNED_DELETION_REQUIRED",
    );
  }
}

if (
  requestUrl.pathname === "/api/auth/customer-info" &&
  request.method === "PATCH"
) {
  // Ownership: the target account always comes from the session, never the payload.
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  const rawPayload = await readJson(request);
  let parsed;
  try {
    parsed = parseProfileUpdate(rawPayload, sanitizePlainText);
  } catch (error) {
    throw toRequestError(error);
  }

  const user = await db.findUserById(session.userId);
  if (!user || user.isActive === false) {
    throw new RequestError(404, "Không tìm thấy tài khoản.");
  }
  const currentInfo = user.customerInfo || {};
  const changed = diffCustomerInfo(currentInfo, parsed.changes);
  const changedFields = Object.keys(changed);

  // Duplicate submission (no effective change): no write, no audit entry.
  if (changedFields.length === 0) {
    sendJson(response, 200, {
      customerInfo: pickSelfServiceFields(currentInfo),
      changedFields: [],
      ordersUpdated: 0,
    });
    return true;
  }

  if (changed.phone && typeof db.getUsers === "function") {
    const users = await db.getUsers();
    if (findPhoneConflict(users, user.id, changed.phone)) {
      throw withErrorCode(
        new RequestError(
          409,
          "Số điện thoại này không thể dùng cho tài khoản của bạn. Vui lòng liên hệ hỗ trợ nếu cần.",
        ),
        "PHONE_IN_USE",
      );
    }
  }

  let confirmation = "none";
  if (requiresConfirmation(currentInfo, changed)) {
    if (user.passwordAuthEnabled !== false) {
      if (!parsed.currentPassword) {
        throw withErrorCode(
          new RequestError(
            428,
            "Thay đổi số điện thoại cần xác nhận bằng mật khẩu hiện tại.",
          ),
          "REAUTH_REQUIRED",
        );
      }
      await verifyPasswordReauthentication(request, response, user, parsed.currentPassword);
      confirmation = "password";
    } else {
      const sessionAge = Date.now() - Number(session.createdAt || 0);
      if (!(sessionAge >= 0 && sessionAge <= RECENT_LOGIN_WINDOW_MS)) {
        throw withErrorCode(
          new RequestError(
            428,
            "Thay đổi số điện thoại cần đăng nhập lại để xác nhận. Vui lòng đăng xuất và đăng nhập lại.",
          ),
          "RECENT_LOGIN_REQUIRED",
        );
      }
      confirmation = "recent_login";
    }
  }

  const updatedUser = await db.updateCustomerInfo(
    session.userId,
    changed,
    session.userId,
    session.role,
    { confirmation },
  );
  if (!updatedUser)
    throw new RequestError(404, "Không tìm thấy tài khoản.");
  session.customerInfo = updatedUser.customerInfo;
  // Existing orders keep the delivery snapshot captured at checkout.
  sendJson(response, 200, {
    customerInfo: pickSelfServiceFields(updatedUser.customerInfo),
    changedFields,
    ordersUpdated: 0,
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/refresh" &&
  request.method === "POST"
) {
  await rateLimitRequest(
    response,
    "auth-refresh",
    getClientAddress(request),
    loginAttemptLimit,
    loginAttemptWindowMs,
    "Bạn đã yêu cầu làm mới phiên quá nhiều lần. Vui lòng thử lại sau.",
  );
  const token = extractSessionToken(request);
  if (!token) {
    throw new RequestError(401, "Chưa đăng nhập.");
  }
  let refreshToken;
  if (Number(request.headers["content-length"] || 0) > 0 || request.headers["content-type"]) {
    const payload = requireJsonObject(
      await readJson(request),
      "Dữ liệu làm mới phiên không hợp lệ.",
      {
        allowed: ["refreshToken"],
        types: { refreshToken: "string" },
        preserveStrings: ["refreshToken"],
      },
    );
    refreshToken = payload.refreshToken;
  }
  let refreshed;
  let rotated = false;
  try {
    if (typeof refreshToken === "string" && refreshToken.trim()) {
      refreshed = await sessionStore.rotateSession(token, refreshToken.trim());
      rotated = Boolean(refreshed);
    } else {
      refreshed = await sessionStore.refreshSession(token);
    }
  } catch (error) {
    if (error instanceof RefreshTokenReuseError || error?.code === "REFRESH_TOKEN_REUSE_DETECTED") {
      response.setHeader("Set-Cookie", buildClearAuthCookieHeaders(request));
      if (auditLogPath) {
        await appendAuditEntry(auditLogPath, {
          action: "auth.refresh_token.reuse_detected",
          actorId: error.userId || null,
          actorRole: "anonymous",
          entityType: "auth",
          entityId: error.userId || null,
          outcome: "denied",
          statusCode: 401,
          requestId: response.getHeader("X-Request-Id"),
          metadata: {
            reason: "refresh_token_replay",
            actionTaken: "revoked_all_user_sessions",
          },
        }).catch(() => {});
      }
      throw withErrorCode(
        new RequestError(
          401,
          "Phát hiện tái sử dụng refresh token. Toàn bộ phiên đã bị thu hồi, vui lòng đăng nhập lại.",
        ),
        "REFRESH_TOKEN_REUSE_DETECTED",
      );
    }
    throw error;
  }
  if (!refreshed) {
    throw new RequestError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
  response.setHeader(
    "Set-Cookie",
    buildAuthCookieHeaders(request, { sessionToken: refreshed.token, expiresAt: refreshed.expiresAt }),
  );
  sendJson(response, 200, {
    token: refreshed.token,
    ...(rotated && refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
    rotated,
    expiresAt: refreshed.expiresAt,
    idleExpiresAt: refreshed.idleExpiresAt,
    refreshExpiresAt: refreshed.refreshExpiresAt,
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/change-password" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu đổi mật khẩu không hợp lệ.",
    {
      allowed: ["currentPassword", "newPassword"],
      required: ["currentPassword", "newPassword"],
      types: { currentPassword: "string", newPassword: "string" },
      preserveStrings: ["currentPassword", "newPassword"],
    },
  );
  const user = await db.findUserById(session.userId);
  if (!user || user.isActive === false) {
    throw new RequestError(401, "Tài khoản không hợp lệ.");
  }
  await verifyPasswordReauthentication(request, response, user, payload.currentPassword);
  const passwordCheck = validatePasswordPolicy(payload.newPassword, { email: user.email });
  if (!passwordCheck.valid) {
    throw withErrorCode(new RequestError(400, passwordCheck.message), passwordCheck.code);
  }
  if (payload.newPassword === payload.currentPassword) {
    throw withErrorCode(
      new RequestError(400, "Mật khẩu mới không được trùng với mật khẩu hiện tại."),
      "PASSWORD_POLICY_REUSE",
    );
  }
  if (typeof db.updateUserPasswordHash !== "function") {
    throw new RequestError(503, "Hệ thống hiện không thể cập nhật mật khẩu.");
  }
  await db.updateUserPasswordHash(user.id, hashPassword(payload.newPassword));
  await sessionStore.destroyUserSessions(user.id);
  if (privacyExportStore && typeof privacyExportStore.purgeUserExports === "function") {
    privacyExportStore.purgeUserExports(user.id);
  }
  const nextSession = await sessionStore.createSession(user);
  response.setHeader(
    "Set-Cookie",
    buildAuthCookieHeaders(request, { sessionToken: nextSession.token, expiresAt: nextSession.expiresAt }),
  );
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.password.changed",
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: user.id,
      outcome: "success",
      statusCode: 200,
      requestId: response.getHeader("X-Request-Id"),
      metadata: { sessionsRevoked: true },
    }).catch(() => {});
  }
  sendJson(response, 200, {
    message: "Mật khẩu đã được cập nhật và các phiên cũ đã bị thu hồi.",
    token: nextSession.token,
    refreshToken: nextSession.refreshToken,
    expiresAt: nextSession.expiresAt,
    refreshExpiresAt: nextSession.refreshExpiresAt,
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/logout" &&
  request.method === "POST"
) {
  const token = extractSessionToken(request);
  await sessionStore.destroySession(token);
  response.setHeader("Set-Cookie", buildClearAuthCookieHeaders(request));
  sendJson(response, 200, { message: "Đã đăng xuất thành công." });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/logout-all" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  await sessionStore.destroyUserSessions(session.userId);
  response.setHeader("Set-Cookie", buildClearAuthCookieHeaders(request));
  const exportsPurged =
    privacyExportStore && typeof privacyExportStore.purgeUserExports === "function"
      ? privacyExportStore.purgeUserExports(session.userId)
      : 0;
  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "auth.sessions.revoke_all",
      actorId: session.userId,
      actorRole: session.role,
      entityType: "user",
      entityId: session.userId,
      metadata: {
        reason: "user_logout_all",
        exportsPurged,
      },
    });
  }
  sendJson(response, 200, {
    revoked: true,
    exportsPurged,
    message: "Đã thu hồi toàn bộ phiên đăng nhập trên mọi thiết bị.",
  });
  return true;
}

// --- Customer CRM API (public and admin variants) ---
    return false;
  };
}

module.exports = { createAuthRoutes };
