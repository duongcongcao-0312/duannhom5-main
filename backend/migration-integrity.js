"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "..", "data", "migrations");

const REQUIRED_SCHEMA_TABLES = Object.freeze([
  "app_users",
  "store_products",
  "store_orders",
  "store_order_items",
  "customers",
  "customer_interactions",
  "service_requests",
  "coupon_promotions",
  "auth_sessions",
  "payment_webhook_events",
  "privacy_consents",
  "privacy_data_requests",
]);

const INTEGRITY_QUERIES = Object.freeze([
  {
    name: "orphaned_order_items",
    message: "Phát hiện store_order_items mồ côi không khớp store_orders.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_order_items i
          LEFT JOIN store_orders o ON o.order_id = i.order_id
          WHERE o.order_id IS NULL`,
  },
  {
    name: "orphaned_customer_interactions",
    message: "Phát hiện customer_interactions mồ côi không khớp customers.",
    sql: `SELECT COUNT(*)::int AS count
          FROM customer_interactions ci
          LEFT JOIN customers c ON c.customer_id = ci.customer_id
          WHERE c.customer_id IS NULL`,
  },
  {
    name: "orphaned_order_users",
    message: "Phát hiện store_orders gắn user_id không tồn tại trong app_users.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_orders o
          LEFT JOIN app_users u ON u.user_id = o.user_id
          WHERE o.user_id IS NOT NULL AND u.user_id IS NULL`,
  },
  {
    name: "orders_without_items",
    message: "Phát hiện đơn hàng không có sản phẩm nào trong store_order_items.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_orders o
          WHERE NOT EXISTS (
            SELECT 1 FROM store_order_items i WHERE i.order_id = o.order_id
          )`,
  },
  {
    name: "invalid_user_required_fields",
    message: "Phát hiện bản ghi app_users thiếu email/họ tên/mật khẩu hoặc vai trò không hợp lệ.",
    sql: `SELECT COUNT(*)::int AS count
          FROM app_users
          WHERE COALESCE(TRIM(email), '') = ''
             OR COALESCE(TRIM(full_name), '') = ''
             OR COALESCE(TRIM(password_hash), '') = ''
             OR role NOT IN ('user', 'admin', 'sales', 'support')`,
  },
  {
    name: "duplicate_user_emails",
    message: "Phát hiện email trùng lặp (không phân biệt hoa/thường) trong app_users.",
    sql: `SELECT COUNT(*)::int AS count FROM (
            SELECT lower(email)
            FROM app_users
            GROUP BY lower(email)
            HAVING COUNT(*) > 1
          ) dup`,
  },
  {
    name: "negative_product_prices_or_stock",
    message: "Phát hiện sản phẩm có giá hoặc tồn kho âm trong store_products.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_products
          WHERE price < 0 OR stock < 0`,
  },
  {
    name: "invalid_order_totals",
    message: "Phát hiện đơn hàng có subtotal/discount/total âm hoặc total > subtotal.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_orders
          WHERE subtotal < 0 OR discount < 0 OR total < 0 OR total > subtotal`,
  },
  {
    name: "invalid_order_item_quantities",
    message: "Phát hiện dòng sản phẩm đơn hàng có số lượng <= 0 hoặc đơn giá âm.",
    sql: `SELECT COUNT(*)::int AS count
          FROM store_order_items
          WHERE quantity <= 0 OR unit_price < 0`,
  },
]);

async function listExpectedMigrationVersions(directory = DEFAULT_MIGRATIONS_DIR) {
  const filenames = (await fs.readdir(directory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort((left, right) => {
      const leftVersion = Number(left.slice(0, left.indexOf("_")));
      const rightVersion = Number(right.slice(0, right.indexOf("_")));
      return leftVersion - rightVersion || left.localeCompare(right);
    });
  return filenames.map((filename) => filename.slice(0, filename.indexOf("_")));
}

async function verifyPostMigrationIntegrity(client, { directory = DEFAULT_MIGRATIONS_DIR } = {}) {
  const violations = [];
  const expectedVersions = await listExpectedMigrationVersions(directory);

  const appliedResult = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedVersions = (appliedResult.rows || []).map((row) => String(row.version));
  const appliedSet = new Set(appliedVersions);
  const pendingMigrations = expectedVersions.filter((version) => !appliedSet.has(version));
  if (pendingMigrations.length > 0) {
    violations.push({
      check: "pending_migrations",
      count: pendingMigrations.length,
      message: `Còn ${pendingMigrations.length} migration chưa được áp dụng: ${pendingMigrations.join(", ")}.`,
    });
  }

  const tablesResult = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])`,
    [REQUIRED_SCHEMA_TABLES],
  );
  const existingTables = new Set((tablesResult.rows || []).map((row) => String(row.table_name)));
  const missingTables = REQUIRED_SCHEMA_TABLES.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    violations.push({
      check: "missing_required_tables",
      count: missingTables.length,
      message: `Thiếu bảng dữ liệu bắt buộc sau migration: ${missingTables.join(", ")}.`,
    });
  }

  const counts = {};
  if (missingTables.length === 0) {
    const countResult = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM app_users) AS app_users,
        (SELECT COUNT(*)::int FROM store_products) AS store_products,
        (SELECT COUNT(*)::int FROM store_orders) AS store_orders,
        (SELECT COUNT(*)::int FROM store_order_items) AS store_order_items,
        (SELECT COUNT(*)::int FROM customers) AS customers,
        (SELECT COUNT(*)::int FROM customer_interactions) AS customer_interactions`,
    );
    Object.assign(counts, countResult.rows?.[0] || {});

    for (const check of INTEGRITY_QUERIES) {
      const result = await client.query(check.sql);
      const count = Number(result.rows?.[0]?.count || 0);
      if (count > 0) {
        violations.push({
          check: check.name,
          count,
          message: `${check.message} (${count} bản ghi).`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    appliedMigrations: appliedVersions,
    pendingMigrations,
    missingTables,
    counts,
    violations,
  };
}

async function assertPostMigrationIntegrity(client, options = {}) {
  const report = await verifyPostMigrationIntegrity(client, options);
  if (!report.ok) {
    const summary = report.violations.map((v) => `[${v.check}] ${v.message}`).join(" | ");
    const error = new Error(`Kiểm tra toàn vẹn dữ liệu sau migration thất bại: ${summary}`);
    error.code = "POST_MIGRATION_INTEGRITY_FAILED";
    error.report = report;
    throw error;
  }
  return report;
}

module.exports = {
  INTEGRITY_QUERIES,
  REQUIRED_SCHEMA_TABLES,
  assertPostMigrationIntegrity,
  listExpectedMigrationVersions,
  verifyPostMigrationIntegrity,
};
