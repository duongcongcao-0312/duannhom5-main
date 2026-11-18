function createServiceRoutes(dependencies) {
  const { RequestError, allowedServiceStatuses, allowedServiceTypes, currentPrivacyPolicyVersion, db, getAuthUser, listQuerySchema, paginateList, payloadSchemas, readJson, requireJsonObject, requireRole, sanitizePlainText, sendJson, sendPaginatedJson, validateQuery } = dependencies;
  return async function handleRoute(request, response, requestUrl) {
// --- API: Services (Thuê / Thu mua / Trao đổi) ---
if (requestUrl.pathname === "/api/services" && request.method === "POST") {
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu yêu cầu dịch vụ không hợp lệ.",
    payloadSchemas.service,
  );
  const bookTitle = sanitizePlainText(
    typeof payload.bookTitle === "string" ? payload.bookTitle : String(payload.bookTitle || ""),
    200,
  );
  const name = sanitizePlainText(
    typeof payload.name === "string" ? payload.name : String(payload.name || ""),
    120,
  );
  const phone = sanitizePlainText(
    typeof payload.phone === "string" ? payload.phone : String(payload.phone || ""),
    20,
  );
  const service = sanitizePlainText(
    typeof payload.service === "string" ? payload.service : String(payload.service || ""),
    32,
  );
  if (!bookTitle || !name || !phone || !service) {
    throw new RequestError(400, "Vui lòng nhập đầy đủ thông tin dịch vụ.");
  }
  if (!allowedServiceTypes.has(service)) {
    throw new RequestError(400, "Loại dịch vụ không hợp lệ.");
  }
  const entry = await db.addServiceRequest({
    ...payload,
    bookTitle,
    name,
    phone,
    service,
    condition: sanitizePlainText(
      typeof payload.condition === "string" ? payload.condition : "",
      64,
    ),
    note: sanitizePlainText(
      typeof payload.note === "string" ? payload.note : "",
      500,
    ),
  });
  sendJson(response, 201, {
    message: "Đã gửi yêu cầu thành công.",
    request: entry,
  });
  return true;
}

    return false;
  };
}

module.exports = { createServiceRoutes };
