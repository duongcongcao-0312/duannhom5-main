const { appendAuditEntry } = require("../audit");
const {
  PRIVACY_ESCALATION_LEVELS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_RESOLUTION_CODES,
} = require("../privacy-data-requests");
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
  const { RequestError, addressStore, allowedConsentPurposes, allowedConsentSources, allowedPrivacyDataRequestStatuses: privacyDataRequestStatuses, allowedPrivacyDataRequestTypes: privacyDataRequestTypes, auditLogPath, db, getAuthUser, ordersPath, payloadSchemas, privacyExportLimit = 5, privacyExportStore, privacyExportWindowMs = 15 * 60 * 1000, rateLimitRequest, readJson, requireAdmin, requireJsonObject, requireRole, sanitizePlainText, sendJson, sessionStore, verifyPasswordReauthentication } = dependencies;
  return async function handleRoute(request, response, requestUrl) {
if (
  requestUrl.pathname === "/api/privacy/consents" &&
  request.method === "GET"
) {
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new RequestError(400, "Endpoint /api/privacy/consents không chấp nhận tham số truy vấn.");
  }
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
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new RequestError(400, "Endpoint /api/privacy/data-requests không chấp nhận tham số truy vấn.");
  }
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
      allowed: ["type", "channel"],
      required: ["type"],
      types: { type: "string", channel: "string" },
    },
  );
  if (!privacyDataRequestTypes.has(payload.type)) {
    throw new RequestError(400, "Loại yêu cầu dữ liệu cá nhân không hợp lệ.");
  }
  const channel = payload.channel ? sanitizePlainText(payload.channel, 32) : "web_portal";
  if (!PRIVACY_REQUEST_CHANNELS.includes(channel)) {
    throw new RequestError(400, "Kênh tiếp nhận yêu cầu không hợp lệ.");
  }
  const dataRequest = await db.createPrivacyDataRequest(session.userId, payload.type, {
    channel,
    verificationMethod: "session_token",
  });
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
  const allRequests = await db.getAllPrivacyDataRequests();
  const statusFilter = requestUrl.searchParams.get("status");
  const typeFilter = requestUrl.searchParams.get("type");
  const escalationFilter = requestUrl.searchParams.get("escalationLevel");
  const overdueFilter = requestUrl.searchParams.get("overdue");
  const requests = allRequests.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (escalationFilter && item.escalationLevel !== escalationFilter) return false;
    if (overdueFilter === "true" && !item.overdue) return false;
    if (overdueFilter === "false" && item.overdue) return false;
    return true;
  });
  const summary = {
    total: allRequests.length,
    pending: allRequests.filter((item) => item.status === "pending").length,
    processing: allRequests.filter((item) => item.status === "processing").length,
    completed: allRequests.filter((item) => item.status === "completed").length,
    rejected: allRequests.filter((item) => item.status === "rejected").length,
    overdue: allRequests.filter((item) => item.overdue).length,
  };
  sendJson(response, 200, { requests, summary });
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
      allowed: ["status", "assignedTo", "escalationLevel", "resolutionCode", "executeAnonymization"],
      types: {
        status: "string",
        assignedTo: "string",
        escalationLevel: "string",
        resolutionCode: "string",
        executeAnonymization: "boolean",
      },
      minProperties: 1,
    },
  );
  if (payload.status !== undefined && !privacyDataRequestStatuses.has(payload.status)) {
    throw new RequestError(400, "Trạng thái yêu cầu dữ liệu cá nhân không hợp lệ.");
  }
  if (
    payload.escalationLevel !== undefined &&
    !PRIVACY_ESCALATION_LEVELS.includes(payload.escalationLevel)
  ) {
    throw new RequestError(400, "Cấp chuyển xử lý không hợp lệ.");
  }
  if (
    payload.resolutionCode !== undefined &&
    !PRIVACY_RESOLUTION_CODES.includes(payload.resolutionCode)
  ) {
    throw new RequestError(400, "Mã kết quả xử lý không hợp lệ.");
  }

  const requestId = updatePrivacyDataRequestMatch[1];
  if (payload.executeAnonymization === true) {
    const existingList = typeof db.getAllPrivacyDataRequests === "function"
      ? await db.getAllPrivacyDataRequests()
      : [];
    const target = existingList.find((entry) => entry.id === requestId);
    if (!target) {
      throw new RequestError(404, "Không tìm thấy yêu cầu dữ liệu cá nhân.");
    }
    if (target.type !== "delete" || payload.status !== "completed") {
      throw withErrorCode(
        new RequestError(
          400,
          "Chỉ có thể ẩn danh tài khoản khi hoàn tất yêu cầu xóa dữ liệu.",
        ),
        "ANONYMIZATION_NOT_ALLOWED",
      );
    }
  }

  const dataRequest = await db.updatePrivacyDataRequest(
    requestId,
    payload.status,
    actor.userId,
    {
      assignedTo: payload.assignedTo !== undefined
        ? sanitizePlainText(payload.assignedTo, 120)
        : undefined,
      escalationLevel: payload.escalationLevel,
      resolutionCode: payload.resolutionCode !== undefined
        ? payload.resolutionCode
        : (payload.executeAnonymization ? "anonymized" : undefined),
      actorRole: actor.role,
    },
  );
  if (!dataRequest) {
    throw new RequestError(404, "Không tìm thấy yêu cầu dữ liệu cá nhân.");
  }
  if (dataRequest.conflict) {
    throw new RequestError(409, "Không thể chuyển trạng thái yêu cầu dữ liệu cá nhân.");
  }

  let anonymized = false;
  let addressesDeleted = 0;
  let exportsPurged = 0;
  if (payload.executeAnonymization === true && typeof db.anonymizeUserAccount === "function") {
    const result = await db.anonymizeUserAccount(dataRequest.subjectId, actor.userId, actor.role);
    anonymized = Boolean(result);
    if (anonymized) {
      if (sessionStore && typeof sessionStore.destroyUserSessions === "function") {
        await sessionStore.destroyUserSessions(dataRequest.subjectId);
      }
      if (addressStore && typeof addressStore.deleteByUser === "function") {
        addressesDeleted = await addressStore.deleteByUser(dataRequest.subjectId);
      }
      if (privacyExportStore && typeof privacyExportStore.purgeUserExports === "function") {
        exportsPurged = privacyExportStore.purgeUserExports(dataRequest.subjectId);
      }
      if (auditLogPath) {
        await appendAuditEntry(auditLogPath, {
          action: "privacy.account.anonymize",
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: "privacy_data_request",
          entityId: dataRequest.id,
          metadata: {
            addressesDeleted,
            exportsPurged,
            sessionsRevoked: true,
            ordersPreservedForAccounting: true,
          },
        });
      }
    }
  }

  sendJson(response, 200, payload.executeAnonymization === true
    ? { request: dataRequest, anonymized, addressesDeleted, exportsPurged }
    : { request: dataRequest });
  return true;
}

const revokeConsentMatch = requestUrl.pathname.match(
  /^\/api\/privacy\/consents\/(order|service|marketing)$/,
);
if (revokeConsentMatch && request.method === "DELETE") {
  for (const key of requestUrl.searchParams.keys()) {
    if (key !== "policyVersion") {
      throw new RequestError(400, "Tham số truy vấn không hợp lệ.");
    }
  }
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
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new RequestError(400, "Endpoint /api/privacy/exports không chấp nhận tham số truy vấn.");
  }
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
