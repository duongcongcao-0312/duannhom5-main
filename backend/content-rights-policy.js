"use strict";

/**
 * Book cover image and book content intellectual property rights review & takedown policy
 * (BN-200 / issue #177).
 *
 * Note: Rights clearance status must be confirmed with publishers, rights holders,
 * or qualified IP counsel prior to commercial operation.
 */

const CONTENT_RIGHTS_POLICY = Object.freeze({
  version: "2026-01",
  policyUrl: "/content-rights.html",
  legalDisclaimer:
    "Tài liệu này ghi nhận kết quả kiểm kê và quy trình quản trị bản quyền nội bộ. Trước khi kinh doanh chính thức, đơn vị vận hành cần xác nhận quyền sử dụng hình ảnh bìa và trích dẫn trực tiếp với nhà xuất bản, chủ thể quyền hoặc chuyên gia sở hữu trí tuệ.",
  sections: Object.freeze([
    {
      id: "rightsInventory",
      title: "Danh mục hình ảnh bìa, nội dung sách & nguồn gốc",
      summary:
        "Phân loại rõ 5 nhóm tài nguyên: bìa chữ CSS tự thiết kế, ảnh bìa tham chiếu Open Library (cần thay thế bằng ảnh được NXB cấp phép trước khi thương mại hóa), ảnh bìa do Admin tải lên, dữ liệu thư mục/mô tả biên soạn và tài nguyên giao diện nội bộ.",
    },
    {
      id: "rightsLicensingLimits",
      title: "Quyền cấp phép, giới hạn hiển thị & yêu cầu ghi nguồn",
      summary:
        "Chỉ hiển thị ảnh bìa ở kích thước xem trước để nhận diện sản phẩm trong danh mục và trang chi tiết; bắt buộc ghi rõ tên tác giả/nhà xuất bản; nghiêm cấm đăng toàn văn hoặc trích đoạn dài chưa được cấp phép.",
    },
    {
      id: "rightsTakedownProcedure",
      title: "Quy trình tiếp nhận yêu cầu gỡ bỏ (Takedown) & lưu hồ sơ cấp phép",
      summary:
        "Xác nhận tiếp nhận trong 1 ngày làm việc, tạm ẩn nội dung có căn cứ khiếu nại trong vòng 24 giờ, giải quyết dứt điểm trong 5 ngày làm việc và lưu hồ sơ cấp phép/gỡ bỏ tối thiểu 5 năm.",
    },
  ]),
  assetCategories: Object.freeze([
    {
      id: "css_typographic_covers",
      source: "Nội bộ (main.css / books-data.js cover-1..cover-5)",
      rightsHolder: "BookNest",
      usageBasis: "Tự thiết kế đồ họa chữ, không sử dụng tác phẩm mỹ thuật bên thứ ba",
      clearanceStatus: "cleared_internal",
    },
    {
      id: "external_openlibrary_covers",
      source: "https://covers.openlibrary.org",
      rightsHolder: "Nhà xuất bản / Chủ sở hữu bản quyền bìa sách gốc (tham chiếu qua Open Library)",
      usageBasis: "Dữ liệu minh họa thử nghiệm; cần thay bằng ảnh bìa được NXB/nhà phát hành cấp phép trước khi vận hành thương mại",
      clearanceStatus: "requires_prelaunch_replacement_or_license",
    },
    {
      id: "admin_uploaded_covers",
      source: "POST /api/v1/admin/uploads/book-cover",
      rightsHolder: "Nhà xuất bản / Đối tác phân phối cấp phép cho BookNest",
      usageBasis: "Chỉ Admin (write:books) được tải lên sau khi đối chiếu thư/hợp đồng cấp phép",
      clearanceStatus: "license_record_required_per_upload",
    },
    {
      id: "book_metadata_and_descriptions",
      source: "books-data.js & quản trị danh mục sách",
      rightsHolder: "Thông tin thư mục công khai / Mô tả biên soạn nội bộ hoặc giới thiệu từ NXB",
      usageBasis: "Chỉ dùng thông tin nhận diện sách và tóm tắt ngắn; không đăng toàn văn hay chương sách có bản quyền",
      clearanceStatus: "editorial_review_required",
    },
    {
      id: "ui_brand_assets",
      source: "assets/favicon.svg, main.css, admin.css",
      rightsHolder: "BookNest",
      usageBasis: "Tài sản tự phát triển của dự án",
      clearanceStatus: "cleared_internal",
    },
  ]),
  takedownWorkflow: Object.freeze({
    acknowledgementBusinessDays: 1,
    temporaryHideHours: 24,
    resolutionBusinessDays: 5,
    licenseRecordRetentionYears: 5,
    requiredNoticeFields: Object.freeze([
      "claimantName",
      "contactEmail",
      "bookTitleOrUrl",
      "rightsOwnershipProof",
      "requestedAction",
    ]),
  }),
  linkedPolicies: Object.freeze({
    terms: "/terms.html",
    consumerTax: "/consumer-tax.html",
    ecommerceCompliance: "/ecommerce-compliance.html",
    privacy: "/privacy.html",
  }),
});

function auditCatalogRights(catalogBooks) {
  const list = Array.isArray(catalogBooks) ? catalogBooks : [];
  const externalHosts = {};
  const booksNeedingClearance = [];
  let typographicCoverCount = 0;

  for (const book of list) {
    const image = typeof book?.image === "string" ? book.image.trim() : "";
    if (!image) {
      typographicCoverCount += 1;
      continue;
    }
    let host = "unknown";
    try {
      host = new URL(image).hostname.toLowerCase();
    } catch {
      host = image.startsWith("/") ? "local" : "invalid";
    }
    externalHosts[host] = (externalHosts[host] || 0) + 1;
    if (host !== "local") {
      booksNeedingClearance.push({
        title: book.title,
        author: book.author,
        sourceHost: host,
      });
    }
  }

  return {
    totalBooks: list.length,
    typographicCoverCount,
    externalCoverCount: booksNeedingClearance.length,
    externalHosts,
    booksNeedingClearance,
  };
}

module.exports = {
  CONTENT_RIGHTS_POLICY,
  auditCatalogRights,
};
