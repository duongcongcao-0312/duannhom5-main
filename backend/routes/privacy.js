const { appendAuditEntry } = require("../audit");
const {
  EXPORT_FORMATS,
  buildPersonalDataExport,
} = require("../privacy-export");
const { RECENT_LOGIN_WINDOW_MS } = require("../profile-update");

function withErrorCode(error, errorCode) {
  error.errorCode = errorCode;
  return error;
}

function createPrivacyRoutes(dependencies) {
  const { RequestError, allowedConsentPurposes, allowedConsentSources, allowedPrivacyDataRequestStatuses: privacyDataRequestStatuses, allowedPrivacyDataRequestTypes: privacyDataRequestTypes, auditLogPath, db, getAuthUser, ordersPath, payloadSchemas, privacyExportLimit = 5, privacyExportStore, privacyExportWindowMs = 15 * 60 * 1000, rateLimitRequest, readJson, requireAdmin, requireJsonObject, requireRole, sanitizePlainText, sendJson, verifyPasswordReauthentication } = dependencies;
  return async function handleRoute(request, response, requestUrl) {
if (
  requestUrl.pathname === "/api/privacy/consents" &&
  request.method === "GET"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (typeof db.getConsentRecords !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ quản lý consent.");
  }
  const records = await db.getConsentRecords(session.userId);
  const current = {};
  for (const record of records) {
    if (!Object.hasOwn(current, record.purpose)) current[record.purpose] = record;
  }
  sendJson(response, 200, { records, current });
  return true;
}

if (
  requestUrl.pathname === "/api/privacy/consents" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (typeof db.recordConsent !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ quản lý consent.");
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu consent không hợp lệ.",
    {
      allowed: ["purpose", "policyVersion", "dataSource", "consent", "retentionDays"],
      required: ["purpose", "policyVersion", "consent", "retentionDays"],
      types: {
        purpose: "string",
        policyVersion: "string",
        dataSource: "string",
        consent: "boolean",
        retentionDays: "number",
      },
    },
  );
  const purpose = sanitizePlainText(payload.purpose, 40);
  const policyVersion = sanitizePlainText(payload.policyVersion, 20);
  const dataSource = sanitizePlainText(payload.dataSource || "web", 20);
  const retentionDays = Number(payload.retentionDays);
  if (
    !allowedConsentPurposes.has(purpose) ||
    !/^[A-Za-z0-9._-]{1,20}$/.test(policyVersion) ||
    !allowedConsentSources.has(dataSource) ||
    typeof payload.consent !== "boolean" ||
    !Number.isInteger(retentionDays) ||
    retentionDays < 0 ||
    retentionDays > 3650
  ) {
    throw new RequestError(400, "Dữ liệu consent không hợp lệ.");
  }
  const record = await db.recordConsent(session.userId, {
    purpose,
    consent: payload.consent,
    policyVersion,
    dataSource,
    retentionDays,
  });
  sendJson(response, 201, { record });
  return true;
}

if (
  requestUrl.pathname === "/api/privacy/data-requests" &&
  request.method === "GET"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (typeof db.getPrivacyDataRequests !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ yêu cầu dữ liệu cá nhân.");
  }
  const requests = await db.getPrivacyDataRequests(session.userId);
  sendJson(response, 200, { requests });
  return true;
}

if (
  requestUrl.pathname === "/api/privacy/data-requests" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (typeof db.createPrivacyDataRequest !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ yêu cầu dữ liệu cá nhân.");
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Yêu cầu dữ liệu cá nhân không hợp lệ.",
    {
      allowed: ["type"],
      required: ["type"],
      types: { type: "string" },
    },
  );
  if (!privacyDataRequestTypes.has(payload.type)) {
    throw new RequestError(400, "Loại yêu cầu dữ liệu cá nhân không hợp lệ.");
  }
  const dataRequest = await db.createPrivacyDataRequest(session.userId, payload.type);
  if (!dataRequest) {
    throw new RequestError(409, "Đã có yêu cầu cùng loại đang được xử lý.");
  }
  sendJson(response, 201, { request: dataRequest });
  return true;
}

if (
  requestUrl.pathname === "/api/admin/privacy/data-requests" &&
  request.method === "GET"
) {
  await requireRole(request, "read:privacy");
  if (typeof db.getAllPrivacyDataRequests !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ yêu cầu dữ liệu cá nhân.");
  }
  const requests = await db.getAllPrivacyDataRequests();
  sendJson(response, 200, { requests });
  return true;
}

const updatePrivacyDataRequestMatch = requestUrl.pathname.match(
  /^\/api\/admin\/privacy\/data-requests\/([0-9a-f-]{36})$/i,
);
if (updatePrivacyDataRequestMatch && request.method === "PATCH") {
  const actor = await requireRole(request, "write:privacy");
  if (typeof db.updatePrivacyDataRequest !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ yêu cầu dữ liệu cá nhân.");
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Trạng thái yêu cầu dữ liệu cá nhân không hợp lệ.",
    {
      allowed: ["status"],
      required: ["status"],
      types: { status: "string" },
    },
  );
  if (!privacyDataRequestStatuses.has(payload.status)) {
    throw new RequestError(400, "Trạng thái yêu cầu dữ liệu cá nhân không hợp lệ.");
  }
  const dataRequest = await db.updatePrivacyDataRequest(
    updatePrivacyDataRequestMatch[1],
    payload.status,
    actor.userId,
  );
  if (!dataRequest) {
    throw new RequestError(404, "Không tìm thấy yêu cầu dữ liệu cá nhân.");
  }
  if (dataRequest.conflict) {
    throw new RequestError(409, "Không thể chuyển trạng thái yêu cầu dữ liệu cá nhân.");
  }
  sendJson(response, 200, { request: dataRequest });
  return true;
}

const revokeConsentMatch = requestUrl.pathname.match(
  /^\/api\/privacy\/consents\/(order|service|marketing)$/,
);
if (revokeConsentMatch && request.method === "DELETE") {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (typeof db.revokeConsent !== "function") {
    throw new RequestError(503, "Kho dữ liệu chưa hỗ trợ quản lý consent.");
  }
  const policyVersion = sanitizePlainText(
    requestUrl.searchParams.get("policyVersion") || "",
    20,
  );
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(policyVersion)) {
    throw new RequestError(400, "Phiên bản chính sách không hợp lệ.");
  }
  const record = await db.revokeConsent(
    session.userId,
    revokeConsentMatch[1],
    policyVersion,
    "web",
  );
  sendJson(response, 200, { record });
  return true;
}

if (
  requestUrl.pathname === "/api/privacy/exports" &&
  request.method === "GET"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (!privacyExportStore) {
    throw new RequestError(503, "Chức năng xuất dữ liệu cá nhân chưa sẵn sàng.");
  }
  const exportsList = privacyExportStore.listUserExports(session.userId);
  sendJson(response, 200, { exports: exportsList });
  return true;
}

if (
  requestUrl.pathname === "/api/privacy/exports" &&
  request.method === "POST"
) {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (!privacyExportStore) {
    throw new RequestError(503, "Chức năng xuất dữ liệu cá nhân chưa sẵn sàng.");
  }
  const payload = requireJsonObject(
    await readJson(request),
    "Yêu cầu xuất dữ liệu cá nhân không hợp lệ.",
    {
      allowed: ["format", "currentPassword"],
      types: {
        format: "string",
        currentPassword: "string",
      },
      preserveStrings: ["currentPassword"],
    },
  );
  const format = payload.format ? sanitizePlainText(payload.format, 16).toLowerCase() : "json";
  if (!EXPORT_FORMATS.includes(format)) {
    throw withErrorCode(
      new RequestError(400, "Định dạng xuất dữ liệu chưa được hỗ trợ. Hiện chỉ hỗ trợ JSON."),
      "UNSUPPORTED_FORMAT",
    );
  }

  const user = await db.findUserById(session.userId);
  if (!user || user.isActive === false) {
    throw new RequestError(404, "Không tìm thấy tài khoản.");
  }

  let confirmation = "none";
  if (user.passwordAuthEnabled !== false) {
    if (!payload.currentPassword) {
      throw withErrorCode(
        new RequestError(428, "Xuất dữ liệu cá nhân cần xác nhận bằng mật khẩu hiện tại."),
        "REAUTH_REQUIRED",
      );
    }
    if (typeof verifyPasswordReauthentication !== "function") {
      throw new RequestError(503, "Hệ thống xác thực lại chưa sẵn sàng.");
    }
    await verifyPasswordReauthentication(request, response, user, payload.currentPassword);
    confirmation = "password";
  } else {
    const sessionAge = Date.now() - Number(session.createdAt || 0);
    if (!(sessionAge >= 0 && sessionAge <= RECENT_LOGIN_WINDOW_MS)) {
      throw withErrorCode(
        new RequestError(
          428,
          "Xuất dữ liệu cá nhân cần đăng nhập lại để xác nhận. Vui lòng đăng xuất và đăng nhập lại.",
        ),
        "RECENT_LOGIN_REQUIRED",
      );
    }
    confirmation = "recent_login";
  }

  if (typeof rateLimitRequest === "function") {
    await rateLimitRequest(
      response,
      "privacy-export",
      session.userId,
      privacyExportLimit,
      privacyExportWindowMs,
      "Bạn đã yêu cầu xuất dữ liệu quá nhiều lần. Vui lòng thử lại sau.",
    );
  }

  const activeExport = privacyExportStore.findActiveExport(session.userId);
  if (activeExport) {
    throw withErrorCode(
      new RequestError(
        409,
        "Bạn đã có bản xuất dữ liệu đang còn hiệu lực. Vui lòng tải bản hiện có hoặc chờ hết hạn để tạo bản mới.",
      ),
      "EXPORT_ALREADY_ACTIVE",
    );
  }

  const [allOrders, consents, dataRequests] = await Promise.all([
    typeof db.getAllOrders === "function" ? db.getAllOrders(ordersPath) : [],
    typeof db.getConsentRecords === "function" ? db.getConsentRecords(session.userId) : [],
    typeof db.getPrivacyDataRequests === "function" ? db.getPrivacyDataRequests(session.userId) : [],
  ]);

  const exportDocument = buildPersonalDataExport({
    user,
    orders: allOrders,
    consents,
    dataRequests,
  });
  const created = privacyExportStore.createExport(session.userId, exportDocument);
  if (created.conflict) {
    throw withErrorCode(
      new RequestError(
        409,
        "Bạn đã có bản xuất dữ liệu đang còn hiệu lực. Vui lòng tải bản hiện có hoặc chờ hết hạn để tạo bản mới.",
      ),
      "EXPORT_ALREADY_ACTIVE",
    );
  }

  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "privacy.export.create",
      actorId: session.userId,
      actorRole: session.role,
      entityType: "privacy_export",
      entityId: created.record.id,
      metadata: {
        format: created.record.format,
        confirmation,
        byteLength: created.record.byteLength,
        counts: created.record.counts,
        expiresAt: created.record.expiresAt,
      },
    });
  }

  sendJson(response, 201, {
    export: {
      ...created.record,
      downloadToken: created.downloadToken,
    },
  });
  return true;
}

const downloadExportMatch = requestUrl.pathname.match(
  /^\/api\/privacy\/exports\/([0-9a-f-]{36})\/download$/i,
);
if (downloadExportMatch && request.method === "GET") {
  const session = await getAuthUser(request);
  if (!session) throw new RequestError(401, "Chưa đăng nhập.");
  if (!privacyExportStore) {
    throw new RequestError(503, "Chức năng xuất dữ liệu cá nhân chưa sẵn sàng.");
  }
  const exportId = downloadExportMatch[1];
  const headerToken = typeof request.headers["x-export-token"] === "string"
    ? request.headers["x-export-token"].trim()
    : "";
  const result = privacyExportStore.getDownload(exportId, session.userId, headerToken);
  if (result.status === "not_found") {
    throw withErrorCode(
      new RequestError(404, "Không tìm thấy bản xuất dữ liệu."),
      "EXPORT_NOT_FOUND",
    );
  }
  if (result.status === "forbidden") {
    throw withErrorCode(
      new RequestError(403, "Bạn không có quyền truy cập bản xuất dữ liệu này."),
      "FORBIDDEN",
    );
  }
  if (result.status === "expired") {
    throw withErrorCode(
      new RequestError(410, "Liên kết tải xuống bản xuất dữ liệu đã hết hạn. Vui lòng tạo yêu cầu xuất mới."),
      "EXPORT_EXPIRED",
    );
  }
  if (result.status === "invalid_token") {
    throw withErrorCode(
      new RequestError(403, "Mã tải xuống bản xuất dữ liệu không hợp lệ hoặc bị thiếu."),
      "INVALID_EXPORT_TOKEN",
    );
  }

  if (auditLogPath) {
    await appendAuditEntry(auditLogPath, {
      action: "privacy.export.download",
      actorId: session.userId,
      actorRole: session.role,
      entityType: "privacy_export",
      entityId: result.id,
      metadata: {
        format: "json",
        byteLength: result.byteLength,
        downloadCount: result.downloadCount,
      },
    });
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "Content-Length": String(result.byteLength),
    "Cache-Control": "no-store, private",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Export-Sha256": result.sha256,
  });
  response.end(result.payload);
  return true;
}

    return false;
  };
}

module.exports = { createPrivacyRoutes };
