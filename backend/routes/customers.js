function createCustomerRoutes(dependencies) {
  const { RequestError, applyCustomerFilters, customerInteractionQuerySchema, customerQuerySchema, db, paginateList, payloadSchemas, readJson, requireCustomerPermission, requireJsonObject, sendJson, sendPaginatedJson, validateCustomerData, validateCustomerInteractionData, validateQuery } = dependencies;
  return async function handleRoute(request, response, requestUrl) {
if (requestUrl.pathname === "/api/customers" && request.method === "GET") {
  await requireCustomerPermission(request, "view");
  const customers = await db.getCustomers();
  const filters = validateQuery(
    requestUrl,
    customerQuerySchema,
    "Bộ lọc khách hàng không hợp lệ.",
  );
  const pagedCustomers = applyCustomerFilters(customers, {
    ...filters,
  });
  sendPaginatedJson(response, paginateList(pagedCustomers, filters, "createdAt", 20));
  return true;
}

if (requestUrl.pathname === "/api/customers" && request.method === "POST") {
  const user = await requireCustomerPermission(request, "create");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu khách hàng không hợp lệ.",
    payloadSchemas.customer,
  );
  const customer = await db.createCustomer(
    validateCustomerData(payload),
    user.userId,
    user.role,
  );
  sendJson(response, 201, customer);
  return true;
}

if (
  requestUrl.pathname === "/api/admin/customers" &&
  request.method === "GET"
) {
  await requireCustomerPermission(request, "view");
  const customers = await db.getCustomers();
  const filters = validateQuery(
    requestUrl,
    customerQuerySchema,
    "Bộ lọc khách hàng không hợp lệ.",
  );
  const pagedCustomers = applyCustomerFilters(customers, {
    ...filters,
  });
  sendPaginatedJson(response, paginateList(pagedCustomers, filters, "createdAt", 20));
  return true;
}

if (
  requestUrl.pathname === "/api/admin/customers" &&
  request.method === "POST"
) {
  const user = await requireCustomerPermission(request, "create");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu khách hàng không hợp lệ.",
    payloadSchemas.customer,
  );
  const customer = await db.createCustomer(
    validateCustomerData(payload),
    user.userId,
    user.role,
  );
  sendJson(response, 201, customer);
  return true;
}

const customerInteractionsMatch = requestUrl.pathname.match(
  /^\/api\/(?:admin\/)?customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/interactions(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i,
);
if (customerInteractionsMatch) {
  const [, customerId, interactionId] = customerInteractionsMatch;
  if (!interactionId && request.method === "GET") {
    await requireCustomerPermission(request, "interaction:view");
    const query = validateQuery(
      requestUrl,
      customerInteractionQuerySchema,
      "Bộ lọc lịch sử tương tác không hợp lệ.",
    );
    const result = await db.getCustomerInteractions(customerId, {
      page: query.page || 1,
      limit: query.limit || 20,
    });
    if (!result) throw new RequestError(404, "Không tìm thấy khách hàng.");
    sendJson(response, 200, result);
    return true;
  }

  if (!interactionId && request.method === "POST") {
    const user = await requireCustomerPermission(request, "interaction:create");
    const payload = requireJsonObject(
      await readJson(request),
      "Dữ liệu tương tác khách hàng không hợp lệ.",
      payloadSchemas.customerInteraction,
    );
    const interaction = await db.createCustomerInteraction(
      customerId,
      validateCustomerInteractionData(payload),
      user.userId,
      user.role,
    );
    if (!interaction) throw new RequestError(404, "Không tìm thấy khách hàng.");
    sendJson(response, 201, interaction);
    return true;
  }

  if (
    interactionId &&
    (request.method === "PATCH" || request.method === "PUT")
  ) {
    const user = await requireCustomerPermission(request, "interaction:update");
    const payload = requireJsonObject(
      await readJson(request),
      "Dữ liệu cập nhật tương tác không hợp lệ.",
      payloadSchemas.customerInteractionUpdate,
    );
    const interaction = await db.updateCustomerInteraction(
      customerId,
      interactionId,
      validateCustomerInteractionData(payload, { partial: true }),
      user.userId,
      user.role,
    );
    if (!interaction) throw new RequestError(404, "Không tìm thấy tương tác.");
    sendJson(response, 200, interaction);
    return true;
  }

  if (interactionId && request.method === "DELETE") {
    const user = await requireCustomerPermission(request, "interaction:delete");
    const deleted = await db.deleteCustomerInteraction(
      customerId,
      interactionId,
      user.userId,
      user.role,
    );
    if (!deleted) throw new RequestError(404, "Không tìm thấy tương tác.");
    sendJson(response, 200, { success: true });
    return true;
  }
}

const customerMatch = requestUrl.pathname.match(
  /^\/api\/(?:admin\/)?customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (
  customerMatch &&
  (request.method === "GET" ||
    request.method === "PATCH" ||
    request.method === "PUT" ||
    request.method === "DELETE")
) {
  if (request.method === "GET") {
    await requireCustomerPermission(request, "view");
    const customer = await db.getCustomerById(customerMatch[1]);
    if (!customer) {
      throw new RequestError(404, "Không tìm thấy khách hàng.");
    }
    sendJson(response, 200, customer);
    return true;
  }

  if (request.method === "DELETE") {
    const user = await requireCustomerPermission(request, "delete");
    const deleted = await db.softDeleteCustomer(
      customerMatch[1],
      user.userId,
      user.role,
    );
    if (!deleted) {
      throw new RequestError(404, "Không tìm thấy khách hàng.");
    }
    sendJson(response, 200, { success: true });
    return true;
  }

  const user = await requireCustomerPermission(request, "update");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật khách hàng không hợp lệ.",
    payloadSchemas.customerUpdate,
  );
  const updated =
    payload && payload.status !== undefined
      ? await db.updateCustomerStatus(
        customerMatch[1],
        payload.status,
        user.userId,
        user.role,
      )
      : await db.updateCustomer(
        customerMatch[1],
        payload,
        user.userId,
        user.role,
      );

  if (!updated) {
    throw new RequestError(404, "Không tìm thấy khách hàng.");
  }
  sendJson(response, 200, updated);
  return true;
}

    return false;
  };
}

module.exports = { createCustomerRoutes };
