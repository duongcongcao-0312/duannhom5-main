"use strict";

/**
 * Data Retention Policy, Schedule, and Legal-Hold Exceptions
 * (BN-199 / issue #176).
 *
 * Separates operational, transactional, log, and backup data with explicit
 * retention periods, disposal actions (delete / anonymize / rotate), and
 * legal-hold exceptions.
 */

const DATA_RETENTION_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/privacy.html#dataRetentionSchedule",
  domains: Object.freeze(["operational", "transactional", "logs", "backups"]),
  schedule: Object.freeze([
    {
      id: "sessions_and_reset_tokens",
      domain: "operational",
      label: "Phiên đăng nhập & token đặt lại mật khẩu",
      purpose: "Xác thực phiên làm việc và khôi phục mật khẩu an toàn",
      retentionDays: 30,
      retentionDisplay: "Phiên 8 giờ (refresh tối đa 30 ngày); token đặt lại mật khẩu 1 giờ",
      basis: "Vận hành bảo mật tài khoản",
      disposalAction: "delete",
      executionCadence: "realtime_ttl",
    },
    {
      id: "privacy_exports",
      domain: "operational",
      label: "Bản xuất dữ liệu cá nhân (JSON)",
      purpose: "Cung cấp bản sao dữ liệu cá nhân cho chủ thể dữ liệu",
      retentionDays: 1,
      retentionDisplay: "15 phút (tự hủy payload sau khi hết hạn)",
      basis: "Nguyên tắc tối thiểu hóa dữ liệu",
      disposalAction: "delete",
      executionCadence: "realtime_ttl",
    },
    {
      id: "consent_records",
      domain: "operational",
      label: "Bản ghi đồng ý (Consent)",
      purpose: "Bằng chứng chấp thuận hoặc rút lại đồng ý xử lý dữ liệu",
      retentionDays: 365,
      retentionDisplay: "Theo retentionDays đã cấu hình (mặc định tối đa 365 ngày; 0 = lưu làm bằng chứng không tự hết hạn)",
      basis: "Nghĩa vụ chứng minh sự đồng ý hợp lệ",
      disposalAction: "delete",
      executionCadence: "scheduled_script",
    },
    {
      id: "account_profiles_and_addresses",
      domain: "operational",
      label: "Tài khoản, hồ sơ cá nhân & địa chỉ giao hàng",
      purpose: "Quản lý tài khoản, ưu đãi sinh viên và giao nhận đơn hàng",
      retentionDays: 1095,
      retentionDisplay: "Trong thời gian tài khoản hoạt động hoặc tối đa 3 năm không hoạt động; ẩn danh trong 72 giờ khi có DSAR xóa hợp lệ",
      basis: "Thực hiện hợp đồng & yêu cầu chủ thể dữ liệu",
      disposalAction: "anonymize",
      executionCadence: "on_demand_dsar_or_periodic",
    },
    {
      id: "service_requests_and_crm",
      domain: "operational",
      label: "Yêu cầu dịch vụ sách & hồ sơ CSKH (CRM)",
      purpose: "Hỗ trợ thuê/thu mua/trao đổi sách và giải quyết khiếu nại",
      retentionDays: 1095,
      retentionDisplay: "Tối đa 3 năm kể từ tương tác hoặc yêu cầu dịch vụ gần nhất",
      basis: "Chăm sóc khách hàng & giải quyết tranh chấp",
      disposalAction: "anonymize",
      executionCadence: "periodic_review",
    },
    {
      id: "orders_and_payments",
      domain: "transactional",
      label: "Đơn hàng, đối soát thanh toán & hoàn tiền",
      purpose: "Thực hiện giao dịch, đối soát thanh toán BN.../COD và nghĩa vụ kế toán/thuế",
      retentionDays: 3650,
      retentionDisplay: "5–10 năm theo nghĩa vụ lưu trữ chứng từ kế toán/thuế (giữ nguyên sổ sách ngay cả khi ẩn danh tài khoản)",
      basis: "Nghĩa vụ pháp lý về kế toán & thuế",
      disposalAction: "anonymize",
      executionCadence: "annual_accounting_review",
    },
    {
      id: "admin_audit_logs",
      domain: "logs",
      label: "Nhật ký kiểm toán quản trị (admin-audit.jsonl)",
      purpose: "Giám sát an ninh, truy vết thay đổi nhạy cảm và điều tra sự cố",
      retentionDays: 365,
      retentionDisplay: "365 ngày (append-only, nối chuỗi SHA-256, không lưu mật khẩu/token/PII tự do)",
      basis: "An ninh thông tin & quản trị rủi ro",
      disposalAction: "delete",
      executionCadence: "annual_log_rotation",
    },
    {
      id: "encrypted_backups",
      domain: "backups",
      label: "Bản sao lưu cơ sở dữ liệu mã hóa (AES-256-GCM)",
      purpose: "Khôi phục sau sự cố (Disaster Recovery)",
      retentionDays: 30,
      retentionDisplay: "30 ngày xoay vòng tự động; khi khôi phục phải áp dụng lại danh sách ẩn danh DSAR",
      basis: "Đảm bảo tính sẵn sàng & liên tục kinh doanh",
      disposalAction: "delete",
      executionCadence: "automated_backup_rotation",
    },
  ]),
  legalHoldExceptions: Object.freeze([
    {
      id: "accounting_tax_obligation",
      description: "Chứng từ đơn hàng, đối soát thanh toán và hoàn tiền thuộc thời hạn lưu trữ bắt buộc theo luật kế toán/thuế.",
    },
    {
      id: "active_dispute_or_complaint",
      description: "Hồ sơ đang có khiếu nại, tranh chấp, yêu cầu hoàn tiền hoặc yêu cầu từ cơ quan có thẩm quyền.",
    },
    {
      id: "consent_evidence_non_expiring",
      description: "Bản ghi consent đánh dấu retentionDays = 0 nhằm lưu bằng chứng pháp lý không tự động hết hạn.",
    },
    {
      id: "security_incident_investigation",
      description: "Nhật ký kiểm toán và bản sao lưu liên quan đến sự cố an ninh đang điều tra.",
    },
  ]),
});

function evaluateRetentionDisposition(categoryId, { ageDays = 0, legalHold = false } = {}) {
  const entry = DATA_RETENTION_POLICY.schedule.find((item) => item.id === categoryId);
  if (!entry) {
    throw new Error(`Unknown retention category: ${categoryId}`);
  }
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    throw new TypeError("ageDays must be a non-negative finite number.");
  }
  if (legalHold) {
    return {
      categoryId,
      domain: entry.domain,
      action: "legal_hold",
      expired: ageDays >= entry.retentionDays,
      retentionDays: entry.retentionDays,
    };
  }
  const expired = ageDays >= entry.retentionDays;
  return {
    categoryId,
    domain: entry.domain,
    action: expired ? entry.disposalAction : "retain",
    expired,
    retentionDays: entry.retentionDays,
  };
}

module.exports = {
  DATA_RETENTION_POLICY,
  evaluateRetentionDisposition,
};
