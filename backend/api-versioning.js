"use strict";

const CURRENT_API_VERSION = "v1";
const SUPPORTED_API_VERSIONS = Object.freeze(["v1"]);
const LEGACY_ALIAS_SUNSET_HTTP_DATE = "Thu, 01 Jul 2027 00:00:00 GMT";
const MIN_SUPPORT_WINDOW_DAYS = 180;
const DEPRECATION_NOTICE_DAYS = 30;

const API_VERSION_POLICY = Object.freeze({
  scheme: "url-path-prefix",
  currentVersion: CURRENT_API_VERSION,
  supportedVersions: SUPPORTED_API_VERSIONS,
  pathPrefix: `/api/${CURRENT_API_VERSION}`,
  legacyAliasPrefix: "/api",
  unversionedProbes: Object.freeze(["/health", "/ready"]),
  minSupportWindowDays: MIN_SUPPORT_WINDOW_DAYS,
  deprecationNoticeDays: DEPRECATION_NOTICE_DAYS,
  legacyAliasSunset: LEGACY_ALIAS_SUNSET_HTTP_DATE,
  responseHeaders: Object.freeze({
    version: "X-API-Version",
    deprecation: "Deprecation",
    sunset: "Sunset",
    successorLink: "Link",
  }),
  compatibility: Object.freeze({
    nonBreakingChanges: Object.freeze([
      "Thêm endpoint mới",
      "Thêm trường tùy chọn trong request body hoặc query",
      "Thêm trường mới trong response object",
      "Nới lỏng ràng buộc hợp lệ của input",
    ]),
    breakingChanges: Object.freeze([
      "Xóa hoặc đổi tên endpoint, trường response, hoặc giá trị enum hiện hữu",
      "Thay đổi kiểu dữ liệu hoặc ngữ nghĩa trường hiện có",
      "Thêm trường bắt buộc mới vào request hiện hữu",
      "Thay đổi cơ chế xác thực hoặc mã lỗi hợp đồng",
    ]),
  }),
});

function resolveApiVersion(pathname) {
  const rawPath = typeof pathname === "string" ? pathname : "/";
  const versionedMatch = rawPath.match(/^\/api\/(v\d+)(\/.*|$)/i);
  if (versionedMatch) {
    const requestedVersion = versionedMatch[1].toLowerCase();
    const rest = versionedMatch[2] || "";
    if (!SUPPORTED_API_VERSIONS.includes(requestedVersion)) {
      return {
        isApi: true,
        version: requestedVersion,
        isVersioned: true,
        isLegacyAlias: false,
        unsupportedVersion: requestedVersion,
        canonicalPath: rawPath,
        versionedPath: rawPath,
      };
    }
    const canonicalPath = `/api${rest || "/"}`;
    return {
      isApi: true,
      version: requestedVersion,
      isVersioned: true,
      isLegacyAlias: false,
      unsupportedVersion: null,
      canonicalPath: rest ? `/api${rest}` : "/api",
      versionedPath: `/api/${requestedVersion}${rest}`,
    };
  }

  if (rawPath === "/api" || rawPath.startsWith("/api/")) {
    const rest = rawPath.slice("/api".length);
    return {
      isApi: true,
      version: CURRENT_API_VERSION,
      isVersioned: false,
      isLegacyAlias: true,
      unsupportedVersion: null,
      canonicalPath: rawPath,
      versionedPath: `/api/${CURRENT_API_VERSION}${rest}`,
    };
  }

  return {
    isApi: false,
    version: null,
    isVersioned: false,
    isLegacyAlias: false,
    unsupportedVersion: null,
    canonicalPath: rawPath,
    versionedPath: rawPath,
  };
}

function applyApiVersionHeaders(response, versionInfo) {
  if (!response || !versionInfo || !versionInfo.isApi) return;
  response.setHeader("X-API-Version", CURRENT_API_VERSION);
  if (versionInfo.isLegacyAlias && !versionInfo.unsupportedVersion) {
    response.setHeader("Deprecation", "true");
    response.setHeader("Sunset", LEGACY_ALIAS_SUNSET_HTTP_DATE);
    if (/^\/api\/v\d+\/[A-Za-z0-9._~/%-]*$/.test(versionInfo.versionedPath)) {
      response.setHeader("Link", `<${versionInfo.versionedPath}>; rel="successor-version"`);
    }
  }
}

module.exports = {
  API_VERSION_POLICY,
  CURRENT_API_VERSION,
  DEPRECATION_NOTICE_DAYS,
  LEGACY_ALIAS_SUNSET_HTTP_DATE,
  MIN_SUPPORT_WINDOW_DAYS,
  SUPPORTED_API_VERSIONS,
  applyApiVersionHeaders,
  resolveApiVersion,
};
