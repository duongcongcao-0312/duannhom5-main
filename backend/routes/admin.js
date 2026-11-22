function createAdminRoutes(dependencies) {
  const { CUSTOMER_ROLE_PERMISSIONS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ROLE_PERMISSIONS, ROLES, RequestError, STUDENT_VERIFICATION_STATUSES, allowedOrderStatuses, allowedPaymentStatuses, assertStockCoversReservations, assertUniqueBookTitle, auditLogPath, backupStatusFile, bookCount, catalogBookById, db, enqueueOrderWrite, getBookCatalog, getCatalogBookOverrides, getCatalogBookList, getDatabaseMonitoringStatus, getBookCategories, getBookAuthors, getBookPublishers, normalizeAuthorSlug, normalizePublisherSlug, saveBookAuthors, saveBookPublishers, normalizeCategorySlug, saveBookCategories, isPasswordValid, listQuerySchema, monitoringMetrics, normalizeAdminBook, normalizeCoupon, ordersPath, paginateList, payloadSchemas, publicUser, readAuditEntries, readBackupStatus, readJson, requireJsonObject, requireRole, sanitizePlainText, sendJson, sendPaginatedJson, sessionStore, startedAt, validateQuery, waitForCatalogReady } = dependencies;
  const serializeAdminOrder = (order) => {
    const { accessCodeHash, ...safeOrder } = order;
    return safeOrder;
  };
  return async function handleRoute(request, response, requestUrl) {
if (
  requestUrl.pathname === "/api/admin/books" &&
  request.method === "GET"
) {
  await requireRole(request, "read:books");
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["title", "price", "category"] } },
    "Bộ lọc sách không hợp lệ.",
  );
  sendPaginatedJson(response, paginateList(await getCatalogBookList(), filters, "title"));
  return true;
}

if (
  requestUrl.pathname === "/api/admin/categories" &&
  request.method === "GET"
) {
  await requireRole(request, "read:books");
  sendJson(response, 200, await getBookCategories());
  return true;
}

if (
  requestUrl.pathname === "/api/admin/categories" &&
  request.method === "POST"
) {
  await requireRole(request, "write:books");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu danh mục không hợp lệ.",
  );
  const slug = normalizeCategorySlug(payload.slug || payload.value || payload.name || payload.label);
  const name = sanitizePlainText(payload.name || payload.label, 120);
  if (!slug || !name) {
    throw new RequestError(400, "Tên và slug danh mục là bắt buộc.");
  }
  const categories = await getBookCategories();
  if (categories.some((category) => category.slug === slug)) {
    throw new RequestError(409, "Slug danh mục đã tồn tại.");
  }
  const now = new Date().toISOString();
  const category = {
    id: slug,
    slug,
    name,
    label: sanitizePlainText(payload.label || name, 120),
    status: payload.status === "inactive" ? "inactive" : "active",
    description: sanitizePlainText(payload.description || "", 500),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveBookCategories([...categories, category]);
  sendJson(response, 201, saved.find((entry) => entry.slug === slug));
  return true;
}

const adminCategoryMatch = requestUrl.pathname.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/);
if (
  adminCategoryMatch &&
  ["PUT", "PATCH", "DELETE"].includes(request.method)
) {
  await requireRole(request, request.method === "DELETE" ? "write:books" : "write:books");
  const slug = adminCategoryMatch[1];
  const categories = await getBookCategories();
  const existing = categories.find((category) => category.slug === slug);
  if (!existing) {
    throw new RequestError(404, "Không tìm thấy danh mục.");
  }

  if (request.method === "DELETE") {
    const linkedBooks = (await getCatalogBookList()).filter((book) => book.category === slug);
    if (linkedBooks.length) {
      throw new RequestError(409, "Không thể xóa danh mục đang có sách liên kết.");
    }
    await saveBookCategories(categories.filter((category) => category.slug !== slug));
    sendJson(response, 200, { success: true });
    return true;
  }

  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật danh mục không hợp lệ.",
  );
  const requestedSlug = normalizeCategorySlug(payload.slug || payload.value);
  if (requestedSlug && requestedSlug !== slug) {
    const linkedBooks = (await getCatalogBookList()).filter((book) => book.category === slug);
    if (linkedBooks.length) {
      throw new RequestError(409, "Không thể đổi slug danh mục đang có sách liên kết.");
    }
    if (categories.some((category) => category.slug === requestedSlug)) {
      throw new RequestError(409, "Slug danh mục đã tồn tại.");
    }
  }
  const nextSlug = requestedSlug || slug;
  const name = sanitizePlainText(payload.name || payload.label || existing.name, 120);
  if (!name) {
    throw new RequestError(400, "Tên danh mục không được để trống.");
  }
  const status = payload.status !== undefined
    ? (payload.status === "inactive" || payload.status === "disabled" ? "inactive" : "active")
    : existing.status;
  const updated = {
    ...existing,
    id: nextSlug,
    slug: nextSlug,
    name,
    label: sanitizePlainText(payload.label || name, 120),
    status,
    description: payload.description !== undefined
      ? sanitizePlainText(payload.description, 500)
      : existing.description,
    updatedAt: new Date().toISOString(),
  };
  await saveBookCategories(categories.map((category) => category.slug === slug ? updated : category));
  sendJson(response, 200, updated);
  return true;
}

// --- Admin API: Stats ---
if (
  requestUrl.pathname === "/api/admin/stats" &&
  request.method === "GET"
) {
  await requireRole(request, "read:dashboard");
  const stats = await db.getStats(ordersPath, bookCount);
  if (Array.isArray(stats.recentOrders)) {
    stats.recentOrders = stats.recentOrders.map(serializeAdminOrder);
  }
  sendJson(response, 200, stats);
  return true;
}

if (
  requestUrl.pathname === "/api/admin/monitoring" &&
  request.method === "GET"
) {
  await requireRole(request, "read:dashboard");
  const databaseStatus = await getDatabaseMonitoringStatus(
    response.getHeader("X-Request-Id"),
  );
  const backupStatus = await readBackupStatus(backupStatusFile);
  sendJson(response, 200, {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: monitoringMetrics.getSnapshot(),
    database: databaseStatus,
    backup: backupStatus,
  });
  return true;
}

// --- Admin API: Orders (Full detail, status update) ---
if (
  requestUrl.pathname === "/api/admin/orders" &&
  request.method === "GET"
) {
  await requireRole(request, "read:orders");
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["createdAt", "status", "total"] } },
    "Bộ lọc đơn hàng không hợp lệ.",
  );
  const orders = await db.getAllOrders(ordersPath);
  sendPaginatedJson(
    response,
    paginateList(orders.map(serializeAdminOrder), filters, "createdAt"),
  );
  return true;
}

const adminOrderMatch = requestUrl.pathname.match(
  /^\/api\/admin\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (
  adminOrderMatch &&
  (request.method === "PATCH" || request.method === "PUT")
) {
  const requester = await requireRole(request, "write:orders");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật đơn hàng không hợp lệ.",
    payloadSchemas.orderStatusUpdate,
  );
  const safePayload = {
    ...payload,
  };
  if (requester.role !== ROLES.ADMIN && safePayload.paymentStatus !== undefined) {
    throw new RequestError(
      403,
      "Chỉ quản trị viên hoặc hệ thống thanh toán mới được xác nhận thanh toán.",
    );
  }
  if (safePayload.status !== undefined) {
    safePayload.status = sanitizePlainText(
      typeof safePayload.status === "string" ? safePayload.status : String(safePayload.status || ""),
      32,
    );
    if (!allowedOrderStatuses.has(safePayload.status)) {
      throw new RequestError(400, "Trạng thái đơn hàng không hợp lệ.");
    }
  }
  if (safePayload.paymentStatus !== undefined) {
    safePayload.paymentStatus = sanitizePlainText(
      typeof safePayload.paymentStatus === "string" ? safePayload.paymentStatus : String(safePayload.paymentStatus || ""),
      32,
    );
    if (!allowedPaymentStatuses.has(safePayload.paymentStatus)) {
      throw new RequestError(400, "Trạng thái thanh toán không hợp lệ.");
    }
  }
  const updated = await enqueueOrderWrite(ordersPath, () =>
    db.updateOrderStatus(
      adminOrderMatch[1],
      safePayload,
      ordersPath,
      { actorRole: requester.role, actorId: requester.userId },
    ),
  );
  if (!updated) {
    throw new RequestError(404, "Không tìm thấy đơn hàng.");
  }
  sendJson(response, 200, serializeAdminOrder(updated));
  return true;
}

// --- Admin API: Services ---
if (
  requestUrl.pathname === "/api/admin/services" &&
  request.method === "GET"
) {
  await requireRole(request, "read:services");
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["createdAt", "status", "service"] } },
    "Bộ lọc yêu cầu dịch vụ không hợp lệ.",
  );
  sendPaginatedJson(response, paginateList(await db.getServiceRequests(), filters, "createdAt"));
  return true;
}

const adminServiceMatch = requestUrl.pathname.match(
  /^\/api\/admin\/services\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (
  adminServiceMatch &&
  (request.method === "PATCH" || request.method === "PUT")
) {
  await requireRole(request, "write:services");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật yêu cầu dịch vụ không hợp lệ.",
    payloadSchemas.serviceStatus,
  );
  const status =
    sanitizePlainText(payload.status, 32);
  if (
    status !== undefined &&
    !allowedServiceStatuses.has(status)
  ) {
    throw new RequestError(400, "Trạng thái yêu cầu dịch vụ không hợp lệ.");
  }
  const updated = await db.updateServiceRequestStatus(
    adminServiceMatch[1],
    status,
  );
  if (!updated) {
    throw new RequestError(404, "Không tìm thấy yêu cầu.");
  }
  sendJson(response, 200, updated);
  return true;
}

// --- Admin API: Author Management ---
if (
  requestUrl.pathname === "/api/admin/authors" &&
  request.method === "GET"
) {
  await requireRole(request, "read:books");
  sendJson(response, 200, await getBookAuthors());
  return true;
}

if (
  requestUrl.pathname === "/api/admin/authors" &&
  request.method === "POST"
) {
  await requireRole(request, "write:books");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu tác giả không hợp lệ.",
  );
  const name = sanitizePlainText(payload.name || payload.displayName, 200);
  const slug = normalizeAuthorSlug(payload.slug || payload.id || name);
  if (!name || !slug) {
    throw new RequestError(400, "Tên tác giả và định danh là bắt buộc.");
  }
  const authors = await getBookAuthors();
  if (authors.some((author) =>
    author.slug === slug ||
    String(author.name).toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
  )) {
    throw new RequestError(409, "Tác giả hoặc định danh đã tồn tại.");
  }
  const now = new Date().toISOString();
  const author = {
    id: slug,
    slug,
    name,
    displayName: sanitizePlainText(payload.displayName || name, 200),
    status: payload.status === "inactive" ? "inactive" : "active",
    bio: sanitizePlainText(payload.bio || "", 1000),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveBookAuthors([...authors, author]);
  sendJson(response, 201, saved.find((entry) => entry.slug === slug));
  return true;
}

const adminAuthorMatch = requestUrl.pathname.match(/^\/api\/admin\/authors\/([a-z0-9-]+)$/);
if (
  adminAuthorMatch &&
  ["PUT", "PATCH", "DELETE"].includes(request.method)
) {
  await requireRole(request, "write:books");
  const slug = adminAuthorMatch[1];
  const authors = await getBookAuthors();
  const existing = authors.find((author) => author.slug === slug);
  if (!existing) {
    throw new RequestError(404, "Không tìm thấy tác giả.");
  }

  if (request.method === "DELETE") {
    const linkedBooks = (await getCatalogBookList()).filter((book) =>
      (Array.isArray(book.authorIds) && book.authorIds.includes(slug)) ||
      String(book.author || "").split(/\s*[,;&]\s*|(?:\svà\s)/i).some((name) =>
        [existing.name, existing.displayName].some((candidate) =>
          candidate && name.trim().toLocaleLowerCase("vi") === candidate.toLocaleLowerCase("vi")
        )
      )
    );
    if (linkedBooks.length) {
      throw new RequestError(409, "Không thể xóa tác giả đang liên kết với sách.");
    }
    await saveBookAuthors(authors.filter((author) => author.slug !== slug));
    sendJson(response, 200, { success: true });
    return true;
  }

  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật tác giả không hợp lệ.",
  );
  const name = sanitizePlainText(payload.name || payload.displayName || existing.name, 200);
  if (!name) {
    throw new RequestError(400, "Tên tác giả không được để trống.");
  }
  const requestedSlug = normalizeAuthorSlug(payload.slug || payload.id);
  const nextSlug = requestedSlug || slug;
  if (
    nextSlug !== slug &&
    authors.some((author) => author.slug === nextSlug)
  ) {
    throw new RequestError(409, "Định danh tác giả đã tồn tại.");
  }
  if (
    String(payload.name || payload.displayName || existing.name).trim().toLocaleLowerCase("vi") !==
      existing.name.toLocaleLowerCase("vi") &&
    authors.some((author) =>
      author.slug !== slug &&
      author.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
    )
  ) {
    throw new RequestError(409, "Tên tác giả đã tồn tại.");
  }
  const updated = {
    ...existing,
    id: nextSlug,
    slug: nextSlug,
    name,
    displayName: sanitizePlainText(payload.displayName || name, 200),
    status: payload.status !== undefined
      ? (payload.status === "inactive" ? "inactive" : "active")
      : existing.status,
    bio: payload.bio !== undefined
      ? sanitizePlainText(payload.bio, 1000)
      : existing.bio,
    updatedAt: new Date().toISOString(),
  };

  const linkedBooks = (await getCatalogBookList()).filter((book) =>
    (Array.isArray(book.authorIds) && book.authorIds.includes(slug)) ||
    String(book.author || "").split(/\s*[,;&]\s*|(?:\svà\s)/i).some((authorName) =>
      [existing.name, existing.displayName].some((candidate) =>
        candidate && authorName.trim().toLocaleLowerCase("vi") === candidate.toLocaleLowerCase("vi")
      )
    )
  );
  for (const book of linkedBooks) {
    let updatedAuthor = String(book.author || "");
    for (const candidate of [existing.displayName, existing.name]) {
      if (!candidate) continue;
      updatedAuthor = updatedAuthor.replace(
        new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        updated.displayName || name,
      );
    }
    const authorIds = Array.isArray(book.authorIds)
      ? book.authorIds.map((id) => id === slug ? nextSlug : id)
      : [];
    const authors = Array.isArray(book.authors)
      ? book.authors.map((authorName) =>
          [existing.name, existing.displayName].includes(authorName)
            ? updated.displayName || name
            : authorName
        )
      : [];
    if (book.isCustom) {
      await db.updateCustomBook(book.id, { author: updatedAuthor, authorIds, authors }, book.updatedAt);
    } else {
      await db.updateCatalogBook(book.id, { ...book, author: updatedAuthor, authorIds, authors }, book.updatedAt, book);
    }
  }

  await saveBookAuthors(authors.map((author) => author.slug === slug ? updated : author));
  sendJson(response, 200, updated);
  return true;
}

// --- Admin API: Publisher Management ---
if (
  requestUrl.pathname === "/api/admin/publishers" &&
  request.method === "GET"
) {
  await requireRole(request, "read:books");
  sendJson(response, 200, await getBookPublishers());
  return true;
}

if (
  requestUrl.pathname === "/api/admin/publishers" &&
  request.method === "POST"
) {
  await requireRole(request, "write:books");
  const payload = requireJsonObject(await readJson(request), "Dữ liệu nhà xuất bản không hợp lệ.");
  const name = sanitizePlainText(payload.name || payload.displayName, 200);
  const slug = normalizePublisherSlug(payload.slug || payload.id || name);
  if (!name || !slug) {
    throw new RequestError(400, "Tên nhà xuất bản và định danh là bắt buộc.");
  }
  const publishers = await getBookPublishers();
  if (publishers.some((publisher) =>
    publisher.slug === slug ||
    publisher.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
  )) {
    throw new RequestError(409, "Nhà xuất bản hoặc định danh đã tồn tại.");
  }
  const now = new Date().toISOString();
  const publisher = {
    id: slug,
    slug,
    name,
    displayName: sanitizePlainText(payload.displayName || name, 200),
    status: payload.status === "inactive" ? "inactive" : "active",
    address: sanitizePlainText(payload.address || "", 300),
    website: sanitizePlainText(payload.website || "", 500),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveBookPublishers([...publishers, publisher]);
  sendJson(response, 201, saved.find((entry) => entry.slug === slug));
  return true;
}

const adminPublisherMatch = requestUrl.pathname.match(/^\/api\/admin\/publishers\/([a-z0-9-]+)$/);
if (
  adminPublisherMatch &&
  ["PUT", "PATCH", "DELETE"].includes(request.method)
) {
  await requireRole(request, "write:books");
  const slug = adminPublisherMatch[1];
  const publishers = await getBookPublishers();
  const existing = publishers.find((publisher) => publisher.slug === slug);
  if (!existing) throw new RequestError(404, "Không tìm thấy nhà xuất bản.");

  if (request.method === "DELETE") {
    const linked = (await getCatalogBookList()).some((book) =>
      book.publisherId === slug ||
      [existing.name, existing.displayName].some((name) =>
        name && String(book.publisher || "").toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
      )
    );
    if (linked) throw new RequestError(409, "Không thể xóa nhà xuất bản đang được sách tham chiếu.");
    await saveBookPublishers(publishers.filter((publisher) => publisher.slug !== slug));
    sendJson(response, 200, { success: true });
    return true;
  }

  const payload = requireJsonObject(await readJson(request), "Dữ liệu cập nhật nhà xuất bản không hợp lệ.");
  const name = sanitizePlainText(payload.name || payload.displayName || existing.name, 200);
  if (!name) throw new RequestError(400, "Tên nhà xuất bản không được để trống.");
  const nextSlug = normalizePublisherSlug(payload.slug || payload.id) || slug;
  if (
    nextSlug !== slug &&
    publishers.some((publisher) => publisher.slug === nextSlug)
  ) throw new RequestError(409, "Định danh nhà xuất bản đã tồn tại.");
  if (
    name.toLocaleLowerCase("vi") !== existing.name.toLocaleLowerCase("vi") &&
    publishers.some((publisher) =>
      publisher.slug !== slug &&
      publisher.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
    )
  ) throw new RequestError(409, "Tên nhà xuất bản đã tồn tại.");

  const updated = {
    ...existing,
    id: nextSlug,
    slug: nextSlug,
    name,
    displayName: sanitizePlainText(payload.displayName || name, 200),
    status: payload.status !== undefined
      ? (payload.status === "inactive" ? "inactive" : "active")
      : existing.status,
    address: payload.address !== undefined ? sanitizePlainText(payload.address, 300) : existing.address,
    website: payload.website !== undefined ? sanitizePlainText(payload.website, 500) : existing.website,
    updatedAt: new Date().toISOString(),
  };

  for (const book of (await getCatalogBookList()).filter((entry) =>
    entry.publisherId === slug ||
    [existing.name, existing.displayName].some((candidate) =>
      candidate && String(entry.publisher || "").toLocaleLowerCase("vi") === candidate.toLocaleLowerCase("vi")
    )
  )) {
    const update = {
      publisherId: nextSlug,
      publisher: updated.displayName || name,
    };
    if (book.isCustom) await db.updateCustomBook(book.id, update, book.updatedAt);
    else await db.updateCatalogBook(book.id, { ...book, ...update }, book.updatedAt, book);
  }

  await saveBookPublishers(publishers.map((publisher) => publisher.slug === slug ? updated : publisher));
  sendJson(response, 200, updated);
  return true;
}

// --- Admin API: Coupon Management ---
if (
  requestUrl.pathname === "/api/admin/coupons" &&
  request.method === "GET"
) {
  await requireRole(request, "read:coupons");
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["code", "expiresAt", "usedCount"] } },
    "Bộ lọc coupon không hợp lệ.",
  );
  sendPaginatedJson(response, paginateList(await db.getCoupons(), filters, "code"));
  return true;
}

if (
  requestUrl.pathname === "/api/admin/coupons" &&
  request.method === "POST"
) {
  await requireRole(request, "write:coupons");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu coupon không hợp lệ.",
    payloadSchemas.coupon,
  );
  const coupon = normalizeCoupon(payload, payload.code);
  if ((await db.getCoupons()).some((entry) => entry.code === coupon.code)) {
    throw new RequestError(409, "Mã coupon đã tồn tại.");
  }
  sendJson(response, 201, await db.saveCoupon(coupon, undefined, true));
  return true;
}

const adminCouponMatch = requestUrl.pathname.match(
  /^\/api\/admin\/coupons\/([A-Za-z0-9_-]{3,32})$/,
);
if (
  adminCouponMatch &&
  (request.method === "PUT" || request.method === "PATCH")
) {
  await requireRole(request, "write:coupons");
  const code = adminCouponMatch[1].toUpperCase();
  const existing = (await db.getCoupons()).find((entry) => entry.code === code);
  if (!existing) throw new RequestError(404, "Không tìm thấy coupon.");
  const expectedUpdatedAt = request.headers["if-match"];
  if (!expectedUpdatedAt) {
    throw new RequestError(428, "Cần gửi If-Match để cập nhật coupon mới nhất.");
  }
  const schema = request.method === "PATCH"
    ? payloadSchemas.couponToggle
    : payloadSchemas.couponUpdate;
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật coupon không hợp lệ.",
    schema,
  );
  const coupon = request.method === "PATCH"
    ? { ...existing, enabled: payload.enabled }
    : normalizeCoupon(payload, code);
  const updated = await db.saveCoupon(
    coupon,
    expectedUpdatedAt,
  );
  sendJson(response, 200, updated);
  return true;
}

// --- Admin API: Books Management ---
if (
  requestUrl.pathname === "/api/admin/books" &&
  request.method === "POST"
) {
  await requireRole(request, "write:books");
  await getBookCategories();
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu sách không hợp lệ.",
    payloadSchemas.book,
  );
  if (payload.publisherId || payload.publisher) {
    const publishers = await getBookPublishers();
    const publisher = publishers.find((entry) =>
      entry.slug === normalizePublisherSlug(payload.publisherId) ||
      entry.name.toLocaleLowerCase("vi") === String(payload.publisher || "").toLocaleLowerCase("vi")
    );
    if (!publisher) throw new RequestError(400, "Nhà xuất bản liên kết không hợp lệ.");
    payload.publisherId = publisher.slug;
    payload.publisher = publisher.displayName || publisher.name;
  }
  if (Array.isArray(payload.authorIds) || Array.isArray(payload.authors)) {
    const authors = await getBookAuthors();
    const resolved = (Array.isArray(payload.authorIds) ? payload.authorIds : []).map((slug) =>
      authors.find((author) => author.slug === normalizeAuthorSlug(slug))
    ).filter(Boolean).map((author) => author.displayName || author.name);
    if (!resolved.length && Array.isArray(payload.authors)) {
      resolved.push(...payload.authors.map((name) => sanitizePlainText(name, 200)).filter(Boolean));
    }
    if (!resolved.length && !sanitizePlainText(payload.author, 200)) {
      throw new RequestError(400, "Tác giả liên kết không hợp lệ.");
    }
    if (resolved.length) payload.author = resolved.join(", ");
  }
  const newBook = await enqueueOrderWrite(ordersPath, async () => {
    const newBookData = normalizeAdminBook(payload);
    await assertUniqueBookTitle(newBookData.title);
    const created = {
      ...(await db.addCustomBook(newBookData)),
      isCustom: true,
    };
    getBookCatalog().set(created.title, created);
    return created;
  });
  sendJson(response, 201, newBook);
  return true;
}

const adminBookMatch = requestUrl.pathname.match(
  /^\/api\/admin\/books\/([A-Za-z0-9_-]{1,128})$/i,
);
if (
  adminBookMatch &&
  (request.method === "PUT" || request.method === "PATCH")
) {
  await requireRole(request, "write:books");
  await getBookCategories();
  const id = adminBookMatch[1];
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật sách không hợp lệ.",
    payloadSchemas.bookUpdate,
  );
  if (payload.publisherId || payload.publisher) {
    const publishers = await getBookPublishers();
    const publisher = publishers.find((entry) =>
      entry.slug === normalizePublisherSlug(payload.publisherId) ||
      entry.name.toLocaleLowerCase("vi") === String(payload.publisher || "").toLocaleLowerCase("vi")
    );
    if (!publisher) throw new RequestError(400, "Nhà xuất bản liên kết không hợp lệ.");
    payload.publisherId = publisher.slug;
    payload.publisher = publisher.displayName || publisher.name;
  }
  if (Array.isArray(payload.authorIds) || Array.isArray(payload.authors)) {
    const authors = await getBookAuthors();
    const resolved = (Array.isArray(payload.authorIds) ? payload.authorIds : []).map((slug) =>
      authors.find((author) => author.slug === normalizeAuthorSlug(slug))
    ).filter(Boolean).map((author) => author.displayName || author.name);
    if (!resolved.length && Array.isArray(payload.authors)) {
      resolved.push(...payload.authors.map((name) => sanitizePlainText(name, 200)).filter(Boolean));
    }
    if (!resolved.length && !sanitizePlainText(payload.author, 200)) {
      throw new RequestError(400, "Tác giả liên kết không hợp lệ.");
    }
    if (resolved.length) payload.author = resolved.join(", ");
  }
  const updatedBook = await enqueueOrderWrite(ordersPath, async () => {
    await waitForCatalogReady();
    const isCatalogBook = catalogBookById.has(id);
    const previousBooks = isCatalogBook ? [] : await db.getCustomBooks();
    const previous = isCatalogBook
      ? { ...catalogBookById.get(id), ...getCatalogBookOverrides().get(id), id, isCustom: false }
      : previousBooks.find((book) => book.id === id);
    if (!previous) throw new RequestError(404, "Không tìm thấy sách.");
    const updatedData = normalizeAdminBook(payload, previous);
    await assertUniqueBookTitle(updatedData.title, id);
    await assertStockCoversReservations(previous.title, updatedData.stock);
    const expectedUpdatedAt = request.headers["if-match"];
    const updated = isCatalogBook
      ? await db.updateCatalogBook(id, updatedData, expectedUpdatedAt, previous)
      : await db.updateCustomBook(id, updatedData, expectedUpdatedAt);
    if (!updated) throw new RequestError(404, "Không tìm thấy sách.");
    const result = { ...updated, isCustom: !isCatalogBook };
    if (previous?.title && previous.title !== updated.title) {
      getBookCatalog().delete(previous.title);
    }
    if (isCatalogBook) getCatalogBookOverrides().set(id, updated);
    if (result.title) getBookCatalog().set(result.title, result);
    return result;
  });
  sendJson(response, 200, updatedBook);
  return true;
}

if (adminBookMatch && request.method === "DELETE") {
  await requireRole(request, "write:books");
  if (catalogBookById.has(adminBookMatch[1])) {
    throw new RequestError(409, "Không thể xóa sách mặc định khỏi danh mục.");
  }
  await enqueueOrderWrite(ordersPath, async () => {
    const previousBooks = await db.getCustomBooks();
    const previous = previousBooks.find((book) => book.id === adminBookMatch[1]);
    const deleted = await db.deleteCustomBook(adminBookMatch[1]);
    if (!deleted) throw new RequestError(404, "Không tìm thấy sách.");
    if (previous?.title) getBookCatalog().delete(previous.title);
  });
  sendJson(response, 200, { success: true });
  return true;
}

// --- Admin API: Users Management ---
if (
  requestUrl.pathname === "/api/admin/staff" &&
  request.method === "GET"
) {
  await requireRole(request, "read:staff");
  const staff = await db.getStaffUsers();
  const rolePermissions = Object.fromEntries(
    ["sales", "support"].map((role) => [
      role,
      [
        ...(ROLE_PERMISSIONS[role] || []),
        ...(CUSTOMER_ROLE_PERMISSIONS[role] || []).map((permission) => `customer:${permission}`),
      ],
    ]),
  );
  sendJson(response, 200, { staff, rolePermissions });
  return true;
}

if (
  requestUrl.pathname === "/api/admin/audit" &&
  request.method === "GET"
) {
  await requireRole(request, "read:users");
  const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "50", 10);
  const offset = Number.parseInt(requestUrl.searchParams.get("offset") || "0", 10);
  const entries = await readAuditEntries(auditLogPath);
  const safeEntries = entries
    .slice(Math.max(0, offset), Math.max(0, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)))
    .map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      entityType: entry.entityType,
      entityId: entry.entityId,
      requestId: entry.requestId,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
      hash: entry.hash,
    }));
  sendJson(response, 200, { entries: safeEntries, total: entries.length, limit: safeEntries.length, offset });
  return true;
}

if (
  requestUrl.pathname === "/api/admin/staff" &&
  request.method === "POST"
) {
  const actor = await requireRole(request, "write:staff");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu nhân viên không hợp lệ.",
    payloadSchemas.staff,
  );
  if (!isPasswordValid(payload.password)) {
    throw new RequestError(
      400,
      `Mật khẩu nhân viên phải có từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự.`,
    );
  }
  const name = sanitizePlainText(payload.name, 120);
  const email = sanitizePlainText(payload.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, "Địa chỉ email nhân viên không hợp lệ.");
  }
  const staff = await db.createStaffUser({
    name,
    email,
    password: payload.password,
    role: payload.role,
  }, actor.userId);
  const { password, passwordAuthEnabled, passwordReset, ...safeStaff } = staff;
  sendJson(response, 201, safeStaff);
  return true;
}

const staffMatch = requestUrl.pathname.match(
  /^\/api\/admin\/staff\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
);
if (staffMatch && request.method === "PATCH") {
  const actor = await requireRole(request, "write:staff");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu cập nhật nhân viên không hợp lệ.",
    payloadSchemas.staffUpdate,
  );
  if (payload.role !== undefined && !["sales", "support"].includes(payload.role)) {
    throw new RequestError(400, "Vai trò nhân viên chỉ có thể là sales hoặc support.");
  }
  if (payload.name !== undefined) {
    payload.name = sanitizePlainText(payload.name, 120);
    if (!payload.name) throw new RequestError(400, "Họ tên nhân viên không hợp lệ.");
  }
  if (payload.email !== undefined) {
    payload.email = sanitizePlainText(payload.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      throw new RequestError(400, "Địa chỉ email nhân viên không hợp lệ.");
    }
  }
  const staff = await db.updateStaffUser(staffMatch[1], payload, actor.userId);
  if (!staff) throw new RequestError(404, "Không tìm thấy nhân viên.");
  await sessionStore.destroyUserSessions(staff.id);
  sendJson(response, 200, staff);
  return true;
}

if (
  requestUrl.pathname === "/api/admin/users" &&
  request.method === "GET"
) {
  await requireRole(request, "read:users");
  const filters = validateQuery(
    requestUrl,
    { ...listQuerySchema, sort: { type: "string", maxLength: 32, values: ["createdAt", "name", "role"] } },
    "Bộ lọc người dùng không hợp lệ.",
  );
  const users = await db.getUsers();
  const safeUsers = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    studentType: u.studentType,
    studentId: u.studentId,
    studentVerification: u.studentVerification || { status: STUDENT_VERIFICATION_STATUSES.PENDING },
    createdAt: u.createdAt,
  }));
  sendPaginatedJson(response, paginateList(safeUsers, filters, "createdAt"));
  return true;
}

const adminUserMatch = requestUrl.pathname.match(
  /^\/api\/admin\/users\/([0-9a-f-]+)$/i,
);
if (adminUserMatch && request.method === "PATCH") {
  const actor = await requireRole(request, "write:users");
  const payload = requireJsonObject(
    await readJson(request),
    "Dữ liệu xác minh sinh viên không hợp lệ.",
    {
      allowed: ["studentVerificationStatus"],
      required: ["studentVerificationStatus"],
      types: { studentVerificationStatus: "string" },
    },
  );
  if (!Object.values(STUDENT_VERIFICATION_STATUSES).includes(payload.studentVerificationStatus)) {
    throw new RequestError(400, "Trạng thái xác minh sinh viên không hợp lệ.");
  }
  const updated = await db.updateStudentVerification(
    adminUserMatch[1],
    payload.studentVerificationStatus,
    actor.userId,
  );
  if (!updated) throw new RequestError(404, "Không tìm thấy tài khoản người dùng.");
  await sessionStore.destroyUserSessions(updated.id);
  sendJson(response, 200, publicUser(updated));
  return true;
}

    return false;
  };
}

module.exports = { createAdminRoutes };
