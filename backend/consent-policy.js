"use strict";

/**
 * Consent Management Policy & Versioned Purpose Catalog (BN-198 / issue #175).
 *
 * Ensures optional consents (such as marketing) are never bundled into core
 * terms of service, registration, or checkout, and that every grant/revocation
 * records timestamp, scope, source, and policy version.
 */

const CONSENT_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/privacy.html#consentManagement",
  legalDisclaimer:
    "Quy trình quản lý sự đồng ý này phục vụ vận hành và tuân thủ kỹ thuật, không thay thế ý kiến tư vấn pháp lý của chuyên gia hoặc cơ quan có thẩm quyền.",
  unbundledGuarantee:
    "Đồng ý tùy chọn (tiếp thị/marketing) luôn tách biệt hoàn toàn, mặc định không chọn sẵn và không bao giờ là điều kiện bắt buộc để đăng ký tài khoản hay đặt hàng.",
  purposes: Object.freeze([
    {
      purpose: "order",
      label: "Xử lý dữ liệu đơn hàng & giao nhận",
      requiredForCoreService: false,
      defaultChecked: false,
      revocable: true,
      dataTypes: Object.freeze(["customerName", "phone", "address", "orderItems"]),
      basisNote: "Phục vụ xử lý đơn hàng, giao nhận và đối soát thanh toán.",
      defaultRetentionDays: 0,
    },
    {
      purpose: "service",
      label: "Xử lý yêu cầu dịch vụ sách (thuê, thu mua, trao đổi)",
      requiredForCoreService: false,
      defaultChecked: false,
      revocable: true,
      dataTypes: Object.freeze(["name", "phone", "bookTitle", "condition", "note"]),
      basisNote: "Phục vụ liên hệ tư vấn và thực hiện yêu cầu dịch vụ do khách gửi.",
      defaultRetentionDays: 0,
    },
    {
      purpose: "marketing",
      label: "Tiếp thị & thông báo ưu đãi (tùy chọn)",
      requiredForCoreService: false,
      defaultChecked: false,
      revocable: true,
      dataTypes: Object.freeze(["email", "name"]),
      basisNote: "Hoàn toàn tùy chọn (opt-in); từ chối hoặc rút lại không ảnh hưởng việc mua hàng hay sử dụng tài khoản.",
      defaultRetentionDays: 365,
    },
  ]),
  evidenceFields: Object.freeze([
    "id",
    "subjectId",
    "purpose",
    "consent",
    "policyVersion",
    "dataSource",
    "retentionDays",
    "createdAt",
  ]),
  versioningRules: Object.freeze({
    policyVersionPattern: "^[A-Za-z0-9._-]{1,20}$",
    appendOnlyHistory: true,
    reconfirmOnMaterialChange: true,
  }),
  endpoints: Object.freeze({
    list: "GET /api/v1/privacy/consents",
    record: "POST /api/v1/privacy/consents",
    revoke: "DELETE /api/v1/privacy/consents/:purpose?policyVersion=2026-01",
    policy: "GET /api/v1/policies/consent",
  }),
});

module.exports = {
  CONSENT_POLICY,
};
