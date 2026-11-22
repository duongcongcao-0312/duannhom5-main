"use strict";

/**
 * Public Terms of Service metadata and policy structure (BN-190 / issue #266).
 *
 * Synchronized with shipping, return, refund, and privacy policies, and
 * surfaced prior to account registration and order checkout.
 */

const TERMS_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/terms.html",
  changeNoticeDays: 7,
  complaintResponseBusinessDays: 2,
  sections: Object.freeze([
    {
      id: "termsAccount",
      title: "Tài khoản người dùng & bảo mật",
      summary:
        "Người dùng chịu trách nhiệm cung cấp thông tin chính xác, bảo mật mật khẩu (12–128 ký tự) và không mạo danh hoặc chia sẻ tài khoản. Ưu đãi học sinh/sinh viên chỉ áp dụng sau khi được xác minh.",
    },
    {
      id: "termsOrdering",
      title: "Đặt hàng, giá bán & thanh toán",
      summary:
        "Giá bán, chiết khấu, mã ưu đãi và tồn kho luôn được hệ thống backend kiểm tra lại khi tạo đơn. Hỗ trợ chuyển khoản ngân hàng (đối soát mã BN...) và COD; khách chỉ được tự hủy đơn khi đang ở trạng thái received.",
    },
    {
      id: "termsIpUsage",
      title: "Quyền sở hữu nội dung & giới hạn sử dụng",
      summary:
        "Thương hiệu, giao diện, mã nguồn và nội dung biên soạn thuộc quyền quản lý của BookNest hoặc đối tác cấp phép. Nghiêm cấm tự động thu thập dữ liệu trái phép, vượt kiểm soát truy cập, spam yêu cầu hoặc gửi dữ liệu độc hại/số thẻ thanh toán.",
    },
    {
      id: "termsLinkedPolicies",
      title: "Đồng bộ vận chuyển, đổi trả, hoàn tiền & quyền riêng tư",
      summary:
        "Giao nhận áp dụng theo Chính sách vận chuyển (/shipping.html), đổi trả trong 7 ngày (/returns.html), hoàn tiền 3–5 ngày làm việc (/refund.html) và bảo vệ dữ liệu cá nhân (/privacy.html).",
    },
    {
      id: "termsChanges",
      title: "Thay đổi điều khoản sử dụng",
      summary:
        "BookNest công bố phiên bản mới kèm ngày hiệu lực và thông báo trước ít nhất 7 ngày đối với các thay đổi quan trọng. Nếu không đồng ý, người dùng có thể ngừng sử dụng và gửi yêu cầu xuất/xóa dữ liệu.",
    },
    {
      id: "termsComplaints",
      title: "Liên hệ & giải quyết khiếu nại",
      summary:
        "Mọi thắc mắc hoặc khiếu nại được tiếp nhận qua CSKH (phản hồi ≤ 2 ngày làm việc), ghi nhận có kiểm soát và chuyển cấp Quản trị viên khi phát sinh tranh chấp.",
    },
  ]),
  linkedPolicies: Object.freeze({
    shipping: "/shipping.html",
    returns: "/returns.html",
    refund: "/refund.html",
    privacy: "/privacy.html",
  }),
});

module.exports = {
  TERMS_POLICY,
};
