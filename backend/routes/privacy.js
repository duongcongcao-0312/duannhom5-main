function createPrivacyRoutes(dependencies) {
  const { RequestError, allowedConsentPurposes, allowedConsentSources, allowedPrivacyDataRequestStatuses: privacyDataRequestStatuses, allowedPrivacyDataRequestTypes: privacyDataRequestTypes, db, getAuthUser, payloadSchemas, readJson, requireAdmin, requireJsonObject, requireRole, sanitizePlainText, sendJson } = dependencies;
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

    return false;
  };
}

module.exports = { createPrivacyRoutes };
