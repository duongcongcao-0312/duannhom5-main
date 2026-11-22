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
  const { RequestError, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ROLES, appBaseUrl, db, getAuthUser, getClientAddress, hashPasswordResetToken, isPasswordValid, loginAttemptLimit, loginAttemptWindowMs, passwordResetEmailLimit, passwordResetIpLimit, passwordResetWindowMs, passwordResetMailer, payloadSchemas, publicUser, randomBytes, rateLimitRequest, clearRateLimit, readJson, registrationAttemptLimit, registrationAttemptWindowMs, requireJsonObject, sanitizePlainText, sendJson, sessionStore, socialTokenVerifier, verifyPassword, verifyPasswordReauthentication, verifySocialIdentity } = dependencies;
  function toRequestError(error) {
    if (error instanceof ProfileUpdateError) {
      return withErrorCode(new RequestError(error.status, error.message), error.errorCode);
    }
    return error;
  }
  return async function handleRoute(request, response, requestUrl) {
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
    new Date(now + 60 * 60 * 1000).toISOString(),
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
  sendJson(response, 200, {
    message: "Nếu email được đăng ký, hướng dẫn khôi phục mật khẩu sẽ được gửi đến hộp thư của bạn.",
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/password-reset/confirm" &&
  request.method === "POST"
) {
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
  if (!isPasswordValid(password)) {
    throw new RequestError(
      400,
      `Mật khẩu mới phải có từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự và không được chỉ chứa khoảng trắng.`,
    );
  }
  const userId = await db.resetPassword(token, password);
  if (!userId) {
    throw new RequestError(400, "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.");
  }
  await sessionStore.destroyUserSessions(userId);
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
  if (!isPasswordValid(password)) {
    throw new RequestError(
      400,
      `Mật khẩu phải có từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự và không được chỉ chứa khoảng trắng.`,
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
    sendJson(response, 201, {
      token: session.token,
      expiresAt: session.expiresAt,
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
  await rateLimitRequest(
    response,
    "login",
    address,
    loginAttemptLimit,
    loginAttemptWindowMs,
    "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  );
  const email = sanitizePlainText(
    typeof payload.email === "string" ? payload.email : String(payload.email || ""),
    254,
  ).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  const user = await db.findUserByEmail(email);
  if (
    !user ||
    user.isActive === false ||
    user.passwordAuthEnabled === false ||
    !verifyPassword(password, user.password)
  ) {
    throw new RequestError(401, "Email hoặc mật khẩu không chính xác.");
  }
  await clearRateLimit("login", address);
  const session = await sessionStore.createSession(user);
  sendJson(response, 200, {
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user),
  });
  return true;
}

if (
  requestUrl.pathname === "/api/auth/social" &&
  request.method === "POST"
) {
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
  sendJson(response, 200, {
    token: session.token,
    expiresAt: session.expiresAt,
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
  requestUrl.pathname === "/api/auth/logout" &&
  request.method === "POST"
) {
  const authHeader = request.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  await sessionStore.destroySession(token);
  sendJson(response, 200, { message: "Đã đăng xuất thành công." });
  return true;
}

// --- Customer CRM API (public and admin variants) ---
    return false;
  };
}

module.exports = { createAuthRoutes };
