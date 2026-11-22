"use strict";

const { requireOwnershipOrPermission } = require("../authorization");

const PHONE_REGEX = /^[0-9 +()-]{8,20}$/;

function createAddressRoutes({
  RequestError,
  addressStore,
  getAuthUser,
  payloadSchemas,
  readJson,
  requireJsonObject,
  sanitizePlainText,
  sendJson,
  validateQuery,
}) {
  function sanitizeAddressFields(payload, { partial = false } = {}) {
    const result = {};
    if (!partial || payload.recipientName !== undefined) {
      const recipientName = sanitizePlainText(payload.recipientName, 120);
      if (recipientName.length < 2) {
        throw new RequestError(400, "Tên người nhận phải có ít nhất 2 ký tự.");
      }
      result.recipientName = recipientName;
    }
    if (!partial || payload.phone !== undefined) {
      const phone = sanitizePlainText(payload.phone, 20);
      if (!PHONE_REGEX.test(phone) || phone.replace(/\D/g, "").length < 8) {
        throw new RequestError(400, "Số điện thoại giao hàng không hợp lệ.");
      }
      result.phone = phone;
    }
    if (!partial || payload.addressLine !== undefined) {
      const addressLine = sanitizePlainText(payload.addressLine, 300);
      if (addressLine.length < 5) {
        throw new RequestError(400, "Địa chỉ giao hàng quá ngắn.");
      }
      result.addressLine = addressLine;
    }
    if (payload.ward !== undefined) result.ward = sanitizePlainText(payload.ward, 100);
    if (payload.district !== undefined) result.district = sanitizePlainText(payload.district, 100);
    if (payload.city !== undefined) result.city = sanitizePlainText(payload.city, 100);
    if (payload.label !== undefined) result.label = sanitizePlainText(payload.label, 60) || "Nhà riêng";
    if (payload.isDefault !== undefined) result.isDefault = Boolean(payload.isDefault);
    return result;
  }

  return async function handleAddressRoute(request, response, requestUrl) {
    if (requestUrl.pathname === "/api/addresses" && request.method === "GET") {
      validateQuery(requestUrl, {}, "Không hỗ trợ tham số truy vấn cho danh sách địa chỉ.");
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để xem địa chỉ giao hàng.");
      }
      const addresses = await addressStore.listByUser(requester.userId);
      sendJson(response, 200, { addresses });
      return true;
    }

    if (requestUrl.pathname === "/api/addresses" && request.method === "POST") {
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để thêm địa chỉ giao hàng.");
      }
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu địa chỉ giao hàng không hợp lệ.",
        payloadSchemas.address,
      );
      const fields = sanitizeAddressFields(payload, { partial: false });
      const created = await addressStore.createForUser(requester.userId, fields);
      sendJson(response, 201, { address: created });
      return true;
    }

    const addressMatch = requestUrl.pathname.match(
      /^\/api\/addresses\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (!addressMatch) {
      return false;
    }
    const addressId = addressMatch[1];

    if (request.method === "GET") {
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để xem địa chỉ giao hàng.");
      }
      const existing = await addressStore.findById(addressId);
      if (!existing) {
        throw new RequestError(404, "Không tìm thấy địa chỉ giao hàng.");
      }
      requireOwnershipOrPermission(
        requester,
        {
          ownerId: existing.userId,
          permission: "read:users",
          message: "Bạn không có quyền xem địa chỉ giao hàng của tài khoản khác.",
        },
        RequestError,
      );
      sendJson(response, 200, { address: existing });
      return true;
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để cập nhật địa chỉ giao hàng.");
      }
      const existing = await addressStore.findById(addressId);
      if (!existing) {
        throw new RequestError(404, "Không tìm thấy địa chỉ giao hàng.");
      }
      requireOwnershipOrPermission(
        requester,
        {
          ownerId: existing.userId,
          permission: "write:users",
          message: "Bạn không có quyền sửa địa chỉ giao hàng của tài khoản khác.",
        },
        RequestError,
      );
      const schema = request.method === "PUT" ? payloadSchemas.address : payloadSchemas.addressUpdate;
      const payload = requireJsonObject(
        await readJson(request),
        "Dữ liệu cập nhật địa chỉ giao hàng không hợp lệ.",
        schema,
      );
      const fields = sanitizeAddressFields(payload, { partial: request.method === "PATCH" });
      const updated = await addressStore.updateById(addressId, fields);
      sendJson(response, 200, { address: updated });
      return true;
    }

    if (request.method === "DELETE") {
      const requester = await getAuthUser(request);
      if (!requester) {
        throw new RequestError(401, "Vui lòng đăng nhập để xóa địa chỉ giao hàng.");
      }
      const existing = await addressStore.findById(addressId);
      if (!existing) {
        throw new RequestError(404, "Không tìm thấy địa chỉ giao hàng.");
      }
      requireOwnershipOrPermission(
        requester,
        {
          ownerId: existing.userId,
          permission: "write:users",
          message: "Bạn không có quyền xóa địa chỉ giao hàng của tài khoản khác.",
        },
        RequestError,
      );
      const deleted = await addressStore.deleteById(addressId);
      sendJson(response, 200, { deleted: true, id: deleted.id });
      return true;
    }

    return false;
  };
}

module.exports = { createAddressRoutes };
