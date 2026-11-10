const crypto = require("node:crypto");
const fs = require("node:fs");
const { Pool } = require("pg");
const {
  CustomerError,
  isOrderStatusTransitionAllowedForRole,
  validateCustomerActor,
  validateCustomerInteractionData,
  validateCustomerData,
} = require("./db");
const { hashPassword } = require("./auth");
const { hashOrderRequest } = require("./order-idempotency");
const { getCouponUnavailableReason } = require("./coupons");
const {
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
} = require("./business-constants");

const databaseConnectionTimeoutMs = 5_000;
const databaseQueryTimeoutMs = 10_000;
const serviceTypes = new Set(Object.values(SERVICE_TYPES));
const orderStatuses = new Set(Object.values(ORDER_STATUSES));
const paymentStatuses = new Set(Object.values(PAYMENT_STATUSES));
const serviceStatuses = new Set(Object.values(SERVICE_STATUSES));
const customerStatuses = new Set(Object.values(CUSTOMER_STATUSES));
const nextCustomerStatus = new Map([
  [CUSTOMER_STATUSES.NEW, CUSTOMER_STATUSES.LEAD],
  [CUSTOMER_STATUSES.LEAD, CUSTOMER_STATUSES.CUSTOMER],
]);
const collections = new Set(["users", "customers", "orders", "services", "books"]);
const relationalTables = {
  users: "app_users",
  customers: "customers",
  orders: "store_orders",
  services: "service_requests",
  books: "store_products",
};

function rowToRecord(collection, row) {
  const record = row.legacy_record && typeof row.legacy_record === "object"
    ? { ...row.legacy_record }
    : {};
  if (collection === "users") {
    return {
      ...record,
      id: row.user_id,
      name: row.full_name,
      email: row.email,
      password: row.password_hash,
      role: row.role,
      studentType: row.student_type,
      studentId: row.student_id,
      ...(row.auth_provider ? { authProvider: row.auth_provider } : {}),
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      customerInfo: row.customer_info || {},
      ...(row.password_reset ? { passwordReset: row.password_reset } : {}),
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  if (collection === "customers") {
    return {
      ...record,
      id: row.customer_id,
      name: row.full_name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      created_by: row.created_by,
      updated_by: row.updated_by,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      ...(row.deleted_at ? { deletedAt: new Date(row.deleted_at).toISOString() } : {}),
    };
  }
  if (collection === "orders") {
    return {
      ...record,
      orderId: row.order_id,
      ...(row.user_id ? { userId: row.user_id } : {}),
      customerName: row.customer_name,
      phone: row.phone,
      address: row.address,
      paymentMethod: row.payment_method,
      status: row.status,
      paymentStatus: row.payment_status,
      couponCode: row.coupon_code,
      discountRate: Number(row.discount_rate),
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      total: Number(row.total),
      ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
      ...(row.idempotency_hash ? { idempotencyHash: row.idempotency_hash } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      items: row.items || [],
    };
  }
  if (collection === "books") {
    return {
      ...record,
      id: row.product_id,
      title: row.title,
      author: row.author,
      category: row.category,
      price: Number(row.price),
      stock: row.stock,
      isCustom: row.is_custom,
      cover: row.cover,
      description: row.description,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  return {
    ...record,
    id: row.service_id,
    service: row.service_type,
    bookTitle: row.book_title,
    condition: row.condition,
    name: row.customer_name,
    phone: row.phone,
    note: row.note,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function customerInteractionRowToRecord(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    type: row.type,
    note: row.note,
    created_by: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updated_by: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function couponRowToRecord(row) {
  return {
    code: row.code,
    label: row.label,
    rate: Number(row.rate),
    minSubtotal: Number(row.min_subtotal),
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    usedCount: Number(row.used_count),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateActor(actorId) {
  if (typeof actorId !== "string" || !actorId.trim()) {
    throw new CustomerError(401, "Không xác định được người thực hiện thao tác.");
  }
  return actorId.trim();
}

function createDatabaseSslConfig(caPath = process.env.DATABASE_SSL_CA_PATH) {
  if (!caPath) return true;

  let ca;
  try {
    ca = fs.readFileSync(caPath, "utf8");
  } catch (error) {
    throw new Error(`Không thể đọc CA certificate tại DATABASE_SSL_CA_PATH: ${error.message}`);
  }
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("CA certificate trong DATABASE_SSL_CA_PATH không hợp lệ.");
  }
  return { ca, rejectUnauthorized: true };
}

function createDatabasePoolConfig(connectionString, caPath = process.env.DATABASE_SSL_CA_PATH) {
  if (!caPath) {
    const databaseHost = connectionString ? new URL(connectionString).hostname : "";
    const isRenderInternalDatabase =
      Boolean(process.env.RENDER) && !databaseHost.includes(".");
    return {
      connectionString,
      connectionTimeoutMillis: databaseConnectionTimeoutMs,
      statement_timeout: databaseQueryTimeoutMs,
      query_timeout: databaseQueryTimeoutMs,
      ssl: isRenderInternalDatabase
        ? { rejectUnauthorized: false }
        : true,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch (error) {
    throw new Error(`DATABASE_URL không hợp lệ khi dùng CA certificate: ${error.message}`);
  }

  for (const parameter of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ]) {
    parsedUrl.searchParams.delete(parameter);
  }

  return {
    connectionString: parsedUrl.toString(),
    connectionTimeoutMillis: databaseConnectionTimeoutMs,
    statement_timeout: databaseQueryTimeoutMs,
    query_timeout: databaseQueryTimeoutMs,
    ssl: createDatabaseSslConfig(caPath),
  };
}

class PostgresDatabase {
  constructor({ connectionString = process.env.DATABASE_URL, pool } = {}) {
    if (!pool && !connectionString) {
      throw new Error("DATABASE_URL là bắt buộc khi dùng PostgreSQL.");
    }
    this.pool = pool || new Pool(createDatabasePoolConfig(connectionString));
    this.initialization = null;
  }

  async init() {
    if (!this.initialization) {
      this.initialization = this.pool.query(`
        CREATE TABLE IF NOT EXISTS booknest_data (
          collection TEXT PRIMARY KEY CHECK (collection IN ('users', 'customers', 'orders', 'services', 'books')),
          records JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).then(async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS auth_sessions (
            session_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            session_data JSONB NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id)",
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)",
        );
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS payment_webhook_events (
            event_id TEXT PRIMARY KEY,
            event_hash TEXT NOT NULL,
            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        const password = process.env.ADMIN_PASSWORD || "";
        const hasAdminConfig = Boolean(email || password);
        if (
          hasAdminConfig &&
          (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12)
        ) {
          throw new Error(
            "Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD (tối thiểu 12 ký tự) không hợp lệ.",
          );
        }

        let users = await this.readRelationalCollection(this.pool, "users");
        if (users.length === 0 && !hasAdminConfig) {
          throw new Error(
            "Đặt ADMIN_EMAIL và ADMIN_PASSWORD (tối thiểu 12 ký tự) để tạo tài khoản quản trị đầu tiên.",
          );
        }
        if (hasAdminConfig) {
          let admin = users.find(
            (user) => String(user.email || "").trim().toLowerCase() === email,
          );
          if (!admin) {
            admin = {
              id: "admin-master",
              name: "Quản trị viên BookNest",
              email,
              password: hashPassword(password),
              role: ROLES.ADMIN,
              studentType: "other",
              studentId: "",
              customerInfo: {},
              createdAt: new Date().toISOString(),
            };
            users.push(admin);
          } else {
            admin.password = hashPassword(password);
            admin.role = "admin";
          }
          const legacyDefaultAdmin = users.find(
            (user) =>
              user !== admin &&
              String(user.email || "").trim().toLowerCase() === "admin@booknest.vn" &&
              user.role === ROLES.ADMIN,
          );
          if (legacyDefaultAdmin) {
            legacyDefaultAdmin.role = "user";
            legacyDefaultAdmin.password = hashPassword(crypto.randomBytes(32).toString("hex"));
            legacyDefaultAdmin.updatedAt = new Date().toISOString();
          }
          await this.writeRelationalCollection(this.pool, "users", users);
        } else {
          const legacyDefaultAdmin = users.find(
            (user) =>
              String(user.email || "").trim().toLowerCase() === "admin@booknest.vn" &&
              user.role === ROLES.ADMIN,
          );
          if (legacyDefaultAdmin) {
            legacyDefaultAdmin.role = "user";
            legacyDefaultAdmin.password = hashPassword(crypto.randomBytes(32).toString("hex"));
            legacyDefaultAdmin.updatedAt = new Date().toISOString();
            await this.writeRelationalCollection(this.pool, "users", users);
          }
        }
      }).catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  async close() {
    return this.pool.end();
  }

  async saveSessionRecord(sessionHash, session) {
    await this.init();
    const storedSession = { ...session };
    delete storedSession.token;
    await this.pool.query(
      `INSERT INTO auth_sessions (session_hash, user_id, session_data, expires_at)
       VALUES ($1, $2, $3::jsonb, to_timestamp($4::double precision / 1000.0))
       ON CONFLICT (session_hash) DO UPDATE
       SET session_data = EXCLUDED.session_data,
           expires_at = EXCLUDED.expires_at`,
      [
        sessionHash,
        session.userId,
        JSON.stringify(storedSession),
        session.expiresAt,
      ],
    );
  }

  async getSessionRecord(sessionHash) {
    await this.init();
    const { rows } = await this.pool.query(
      `SELECT session_data, expires_at
       FROM auth_sessions
       WHERE session_hash = $1 AND expires_at > NOW()`,
      [sessionHash],
    );
    if (!rows.length) return null;
    return {
      ...rows[0].session_data,
      expiresAt: new Date(rows[0].expires_at).getTime(),
    };
  }

  async deleteSessionRecord(sessionHash) {
    await this.init();
    const { rowCount } = await this.pool.query(
      "DELETE FROM auth_sessions WHERE session_hash = $1",
      [sessionHash],
    );
    return rowCount > 0;
  }

  async deleteUserSessionRecords(userId) {
    await this.init();
    const { rowCount } = await this.pool.query(
      "DELETE FROM auth_sessions WHERE user_id = $1",
      [userId],
    );
    return rowCount;
  }

  async pruneExpiredSessionRecords() {
    await this.init();
    const { rowCount } = await this.pool.query(
      "DELETE FROM auth_sessions WHERE expires_at <= NOW()",
    );
    return rowCount;
  }

  async applyPaymentWebhookEvent({
    eventId,
    eventHash,
    orderId,
    paymentStatus,
    amount,
    occurredAt,
  }) {
    if (!eventId || !/^[a-f0-9]{64}$/.test(eventHash || "")) {
      throw new Error("A valid payment event ID and hash are required.");
    }
    if (!paymentStatuses.has(paymentStatus)) {
      throw new Error("Trạng thái thanh toán không hợp lệ.");
    }
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const insertedEvent = await client.query(
        `INSERT INTO payment_webhook_events (event_id, event_hash)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId, eventHash],
      );
      if (!insertedEvent.rowCount) {
        const existingEvent = await client.query(
          "SELECT event_hash FROM payment_webhook_events WHERE event_id = $1 FOR UPDATE",
          [eventId],
        );
        await client.query("COMMIT");
        return {
          duplicate: existingEvent.rows[0]?.event_hash === eventHash,
          conflict: existingEvent.rows[0]?.event_hash !== eventHash,
        };
      }

      const orders = await this.readRelationalCollection(client, "orders", true);
      const order = orders.find((entry) => entry.orderId === orderId);
      if (!order) throw new CustomerError(404, "Không tìm thấy đơn hàng.");
      if (order.paymentMethod !== "transfer") {
        throw new CustomerError(400, "Đơn hàng này không sử dụng chuyển khoản.");
      }
      if (order.total !== amount) {
        throw new CustomerError(400, "Số tiền thanh toán không khớp với đơn hàng.");
      }

      const eventTime = new Date(occurredAt).getTime();
      const previousEventTime = Date.parse(order.paymentEventAt || "");
      const terminalStatuses = new Set(["paid", "failed", "cancelled", "refunded"]);
      const isStale = Number.isFinite(previousEventTime) &&
        eventTime <= previousEventTime;
      if (!isStale) {
        const canChangeStatus = order.paymentStatus !== "paid" &&
          !(order.paymentStatus === "refunded" && paymentStatus !== "refunded") &&
          !(terminalStatuses.has(order.paymentStatus) && paymentStatus === "pending") &&
          !(order.status === "cancelled" && paymentStatus === "paid");
        if (canChangeStatus) order.paymentStatus = paymentStatus;
        order.paymentEventAt = new Date(eventTime).toISOString();
        order.updatedAt = new Date().toISOString();
        await this.writeRelationalCollection(client, "orders", orders);
        if (order.idempotencyKey) {
          await client.query(
            "UPDATE order_idempotency SET order_record = $2::jsonb WHERE idempotency_key = $1",
            [order.idempotencyKey, JSON.stringify(order)],
          );
        }
      }
      await client.query("COMMIT");
      return { order, duplicate: false, stale: isStale };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCustomerInteractions(customerId, { page = 1, limit = 20 } = {}) {
    if (!await this.getCustomerById(customerId)) return null;
    await this.init();
    const offset = (page - 1) * limit;
    const [countResult, interactionResult] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS total
         FROM customer_interactions
         WHERE customer_id = $1::uuid`,
        [customerId],
      ),
      this.pool.query(
        `SELECT id, customer_id, type, note, created_by, created_at, updated_by, updated_at
         FROM customer_interactions
         WHERE customer_id = $1::uuid
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [customerId, limit, offset],
      ),
    ]);
    return {
      items: interactionResult.rows.map(customerInteractionRowToRecord),
      page,
      limit,
      total: Number(countResult.rows[0]?.total || 0),
    };
  }

  async createCustomerInteraction(customerId, data, actorId) {
    const interaction = validateCustomerInteractionData(data);
    const actor = validateCustomerActor(actorId);
    await this.init();
    const { rows } = await this.pool.query(
      `INSERT INTO customer_interactions (customer_id, type, note, created_by, updated_by)
       SELECT customer_id, $2, $3, $4, $4
       FROM customers
       WHERE customer_id = $1::uuid AND is_active = TRUE
       RETURNING id, customer_id, type, note, created_by, created_at, updated_by, updated_at`,
      [customerId, interaction.type, interaction.note, actor],
    );
    return rows[0] ? customerInteractionRowToRecord(rows[0]) : null;
  }

  async updateCustomerInteraction(customerId, interactionId, data, actorId) {
    const interaction = validateCustomerInteractionData(data, { partial: true });
    const actor = validateCustomerActor(actorId);
    await this.init();
    const { rows } = await this.pool.query(
      `UPDATE customer_interactions AS interaction
       SET type = COALESCE($3, interaction.type),
           note = COALESCE($4, interaction.note),
           updated_by = $5,
           updated_at = NOW()
       WHERE interaction.id = $1::uuid
         AND interaction.customer_id = $2::uuid
         AND EXISTS (
           SELECT 1 FROM customers
           WHERE customer_id = interaction.customer_id AND is_active = TRUE
         )
       RETURNING interaction.id, interaction.customer_id, interaction.type, interaction.note,
         interaction.created_by, interaction.created_at, interaction.updated_by, interaction.updated_at`,
      [interactionId, customerId, interaction.type ?? null, interaction.note ?? null, actor],
    );
    return rows[0] ? customerInteractionRowToRecord(rows[0]) : null;
  }

  async deleteCustomerInteraction(customerId, interactionId) {
    await this.init();
    const { rowCount } = await this.pool.query(
      `DELETE FROM customer_interactions AS interaction
       WHERE interaction.id = $1::uuid
         AND interaction.customer_id = $2::uuid
         AND EXISTS (
           SELECT 1 FROM customers
           WHERE customer_id = interaction.customer_id AND is_active = TRUE
         )`,
      [interactionId, customerId],
    );
    return rowCount > 0;
  }

  async readCollection(name) {
    if (!collections.has(name)) throw new Error(`Unknown data collection: ${name}`);
    await this.init();
    return this.readRelationalCollection(this.pool, name);
  }

  async getCoupons() {
    await this.init();
    const { rows } = await this.pool.query(
      "SELECT * FROM coupon_promotions ORDER BY created_at, code",
    );
    return rows.map(couponRowToRecord);
  }

  async saveCoupon(coupon, expectedUpdatedAt, createOnly = false) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM coupon_promotions WHERE code = $1 FOR UPDATE",
        [coupon.code],
      );
      const existing = current.rows[0] ? couponRowToRecord(current.rows[0]) : null;
      if (existing && createOnly) {
        throw new CustomerError(409, "Mã coupon đã tồn tại.");
      }
      if (expectedUpdatedAt !== undefined && (existing?.updatedAt || "") !== expectedUpdatedAt) {
        throw new CustomerError(
          existing ? 409 : 404,
          existing
            ? "Coupon đã được cập nhật bởi người khác. Vui lòng tải lại dữ liệu."
            : "Không tìm thấy coupon.",
        );
      }
      if (existing && coupon.maxUses !== null && coupon.maxUses < existing.usedCount) {
        throw new CustomerError(409, "Giới hạn lượt dùng không thể thấp hơn số lượt đã sử dụng.");
      }
      const result = await client.query(
        `INSERT INTO coupon_promotions
          (code, label, rate, min_subtotal, max_uses, starts_at, expires_at, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ${createOnly ? "ON CONFLICT (code) DO NOTHING" : `ON CONFLICT (code) DO UPDATE SET
           label = EXCLUDED.label,
           rate = EXCLUDED.rate,
           min_subtotal = EXCLUDED.min_subtotal,
           max_uses = EXCLUDED.max_uses,
           starts_at = EXCLUDED.starts_at,
           expires_at = EXCLUDED.expires_at,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()`}
         RETURNING *`,
        [
          coupon.code,
          coupon.label,
          coupon.rate,
          coupon.minSubtotal,
          coupon.maxUses,
          coupon.startsAt,
          coupon.expiresAt,
          coupon.enabled,
        ],
      );
      if (!result.rows[0]) {
        throw new CustomerError(409, "Mã coupon đã tồn tại.");
      }
      await client.query("COMMIT");
      return couponRowToRecord(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async redeemCoupon(code, subtotal, now = Date.now(), expectedRate) {
    await this.init();
    const result = await this.pool.query(
      `UPDATE coupon_promotions
       SET used_count = used_count + 1
       WHERE code = $1
         AND enabled = TRUE
         AND (starts_at IS NULL OR starts_at <= $3)
         AND (expires_at IS NULL OR expires_at > $3)
         AND min_subtotal <= $2
         AND ($4::numeric IS NULL OR rate = $4)
         AND (max_uses IS NULL OR used_count < max_uses)
       RETURNING *`,
      [code, subtotal, new Date(now).toISOString(), expectedRate],
    );
    if (result.rows[0]) return couponRowToRecord(result.rows[0]);
    const { rows } = await this.pool.query(
      "SELECT * FROM coupon_promotions WHERE code = $1",
      [code],
    );
    const reason = getCouponUnavailableReason(
      rows[0] ? couponRowToRecord(rows[0]) : null,
      { subtotal, now },
    );
    throw new CustomerError(409, reason || "Mã ưu đãi vừa hết lượt sử dụng.");
  }

  async releaseCoupon(code) {
    await this.init();
    const { rowCount } = await this.pool.query(
      `UPDATE coupon_promotions
       SET used_count = GREATEST(used_count - 1, 0)
       WHERE code = $1`,
      [code],
    );
    return rowCount > 0;
  }

  async updateCollection(name, update) {
    if (!collections.has(name)) throw new Error(`Unknown data collection: ${name}`);
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const records = await this.readRelationalCollection(client, name, true);
      const result = await update(records);
      await this.writeRelationalCollection(client, name, records);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readRelationalCollection(queryable, name, forUpdate = false) {
    let query;
    if (name === "orders") {
      query = `SELECT orders.*,
          COALESCE(items.records, '[]'::json) AS items
        FROM store_orders orders
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'title', product_title,
            'author', author,
            'unitPrice', unit_price,
            'quantity', quantity,
            'lineTotal', line_total
          ) ORDER BY product_title) AS records
          FROM store_order_items WHERE order_id = orders.order_id
        ) items ON TRUE
        ORDER BY orders.created_at${forUpdate ? " FOR UPDATE OF orders" : ""}`;
    } else {
      const filter = name === "books" ? " WHERE is_custom = TRUE" : "";
      query = `SELECT * FROM ${relationalTables[name]}${filter} ORDER BY created_at${
        forUpdate ? " FOR UPDATE" : ""
      }`;
    }
    const { rows } = await queryable.query(query);
    return rows.map((row) => rowToRecord(name, row));
  }

  async writeRelationalCollection(client, name, records) {
    const ids = [];
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`PostgreSQL collection "${name}" contains an invalid record.`);
      }
      if (name === "users") {
        const id = String(record.id || "");
        ids.push(id);
        await client.query(
          `INSERT INTO app_users (
            user_id, email, full_name, password_hash, role, student_type, student_id,
            auth_provider, provider_id, customer_info, password_reset, created_by, updated_by,
            created_at, updated_at, legacy_record
          ) VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb)
          ON CONFLICT (user_id) DO UPDATE SET
            email = EXCLUDED.email, full_name = EXCLUDED.full_name,
            password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
            student_type = EXCLUDED.student_type, student_id = EXCLUDED.student_id,
            auth_provider = EXCLUDED.auth_provider, provider_id = EXCLUDED.provider_id,
            customer_info = EXCLUDED.customer_info, password_reset = EXCLUDED.password_reset,
            created_by = EXCLUDED.created_by, updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at, legacy_record = EXCLUDED.legacy_record`,
          [
            id, record.email || "", record.name || "", record.password || "", record.role || "user",
            record.studentType || "other", record.studentId || "", record.authProvider || null,
            record.providerId || null, JSON.stringify(record.customerInfo || {}),
            record.passwordReset ? JSON.stringify(record.passwordReset) : null,
            record.createdBy || "system", record.updatedBy || "system",
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString(),
            JSON.stringify(record),
          ],
        );
      } else if (name === "customers") {
        const id = String(record.id || "");
        ids.push(id);
        await client.query(
          `INSERT INTO customers (
            customer_id, full_name, phone, email, address, city, status, source,
            created_by, updated_by, created_at, updated_at, is_active, deleted_at, legacy_record
          ) VALUES ($1::uuid, $2, $3, lower($4), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
          ON CONFLICT (customer_id) DO UPDATE SET
            full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, email = EXCLUDED.email,
            address = EXCLUDED.address, city = EXCLUDED.city, status = EXCLUDED.status,
            source = EXCLUDED.source, updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at, is_active = EXCLUDED.is_active,
            deleted_at = EXCLUDED.deleted_at, legacy_record = EXCLUDED.legacy_record`,
          [
            id, record.name || "", record.phone || "", record.email || "", record.address || null,
            record.city || null, record.status || "new", record.source || "web",
            record.created_by || record.createdBy || "system",
            record.updated_by || record.updatedBy || "system",
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString(),
            !record.deletedAt, record.deletedAt || null, JSON.stringify(record),
          ],
        );
      } else if (name === "orders") {
        const id = String(record.orderId || "");
        ids.push(id);
        const items = Array.isArray(record.items) ? record.items : [];
        for (const item of items) {
          await client.query(
            `INSERT INTO store_products (product_id, title, author, price, stock, is_custom)
             VALUES ($1, $2, $3, $4, 0, FALSE) ON CONFLICT (title) DO NOTHING`,
            [`order-${id}-${item.title}`, item.title, item.author || "", item.unitPrice || item.price || 0],
          );
        }
        await client.query(
          `INSERT INTO store_orders (
            order_id, user_id, customer_name, phone, address, payment_method, status, payment_status,
            coupon_code, discount_rate, subtotal, discount, total, idempotency_key, idempotency_hash,
            created_at, updated_at, legacy_record
          ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
          ON CONFLICT (order_id) DO UPDATE SET
            user_id = EXCLUDED.user_id, customer_name = EXCLUDED.customer_name,
            phone = EXCLUDED.phone, address = EXCLUDED.address,
            payment_method = EXCLUDED.payment_method, status = EXCLUDED.status,
            payment_status = EXCLUDED.payment_status, coupon_code = EXCLUDED.coupon_code,
            discount_rate = EXCLUDED.discount_rate, subtotal = EXCLUDED.subtotal,
            discount = EXCLUDED.discount, total = EXCLUDED.total,
            idempotency_key = EXCLUDED.idempotency_key, idempotency_hash = EXCLUDED.idempotency_hash,
            updated_at = EXCLUDED.updated_at, legacy_record = EXCLUDED.legacy_record`,
          [
            id, record.userId || null, record.customerName || "", record.phone || "",
            record.address || "", record.paymentMethod || "cod", record.status || "received",
            record.paymentStatus || "cod_pending", record.couponCode || null,
            record.discountRate || 0, record.subtotal || 0, record.discount || 0, record.total || 0,
            record.idempotencyKey || null, record.idempotencyHash || null,
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString(),
            JSON.stringify(record),
          ],
        );
        await client.query("DELETE FROM store_order_items WHERE order_id = $1::uuid", [id]);
        for (const item of items) {
          const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
          const quantity = Number(item.quantity || 0);
          await client.query(
            `INSERT INTO store_order_items
              (order_id, product_title, author, unit_price, quantity, line_total)
             VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
            [id, item.title, item.author || "", unitPrice, quantity, unitPrice * quantity],
          );
        }
      } else if (name === "books") {
        const id = String(record.id || "");
        ids.push(id);
        await client.query(
          `INSERT INTO store_products (
            product_id, title, author, category, price, stock, is_custom, cover, description,
            created_at, updated_at, legacy_record
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
          ON CONFLICT (product_id) DO UPDATE SET
            title = EXCLUDED.title, author = EXCLUDED.author, category = EXCLUDED.category,
            price = EXCLUDED.price, stock = EXCLUDED.stock, is_custom = EXCLUDED.is_custom,
            cover = EXCLUDED.cover, description = EXCLUDED.description,
            updated_at = EXCLUDED.updated_at, legacy_record = EXCLUDED.legacy_record`,
          [
            id, record.title || "", record.author || "", record.category || "van-hoc",
            record.price || 0, record.stock || 0, true, record.cover || "",
            record.description || "", record.createdAt || new Date().toISOString(),
            record.updatedAt || new Date().toISOString(), JSON.stringify(record),
          ],
        );
      } else {
        const id = String(record.id || "");
        ids.push(id);
        await client.query(
          `INSERT INTO service_requests (
            service_id, service_type, book_title, condition, customer_name, phone, note, status,
            created_at, updated_at, legacy_record
          ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
          ON CONFLICT (service_id) DO UPDATE SET
            service_type = EXCLUDED.service_type, book_title = EXCLUDED.book_title,
            condition = EXCLUDED.condition, customer_name = EXCLUDED.customer_name,
            phone = EXCLUDED.phone, note = EXCLUDED.note, status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at, legacy_record = EXCLUDED.legacy_record`,
          [
            id, record.service || "rent", record.bookTitle || "", record.condition || "",
            record.name || "", record.phone || "", record.note || "", record.status || "pending",
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString(),
            JSON.stringify(record),
          ],
        );
      }
    }
    const tableKey = {
      users: "user_id",
      customers: "customer_id",
      orders: "order_id",
      services: "service_id",
      books: "product_id",
    }[name];
    const idType = name === "customers" || name === "orders" || name === "services" ? "uuid" : "text";
    const customBookFilter = name === "books" ? " AND is_custom = TRUE" : "";
    await client.query(
      `DELETE FROM ${relationalTables[name]} WHERE ${tableKey} <> ALL($1::${idType}[])${customBookFilter}`,
      [ids],
    );
  }

  async getUsers() {
    return this.readCollection("users");
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const normalized = String(email).trim().toLowerCase();
    return (await this.getUsers()).find((user) => user.email.toLowerCase() === normalized) || null;
  }

  async findUserById(id) {
    if (!id) return null;
    return (await this.getUsers()).find((user) => user.id === id) || null;
  }

  async createPasswordResetToken(email, tokenHash, expiresAt) {
    return this.updateCollection("users", (users) => {
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
      if (!user) return null;
      user.passwordReset = { tokenHash, expiresAt };
      return { id: user.id, name: user.name, email: user.email };
    });
  }

  async clearPasswordResetToken(tokenHash) {
    return this.updateCollection("users", (users) => {
      const user = users.find((entry) => entry.passwordReset?.tokenHash === tokenHash);
      if (!user) return false;
      delete user.passwordReset;
      return true;
    });
  }

  async resetPassword(tokenHash, password) {
    return this.updateCollection("users", (users) => {
      const user = users.find((entry) => (
        entry.passwordReset?.tokenHash === tokenHash &&
        Date.parse(entry.passwordReset.expiresAt) > Date.now()
      ));
      if (!user) return null;
      user.password = hashPassword(password);
      delete user.passwordReset;
      user.updatedAt = new Date().toISOString();
      return user.id;
    });
  }

  async createUser(data) {
    return this.updateCollection("users", (users) => {
      const email = String(data.email).trim().toLowerCase();
      if (users.some((user) => user.email.toLowerCase() === email)) {
        throw new Error("Email này đã được đăng ký trên hệ thống.");
      }
      const role = String(data.role || "user").trim().toLowerCase();
      if (!new Set(["user", "admin", "sales", "support"]).has(role)) {
        throw new Error("Vai trò người dùng không hợp lệ.");
      }
      const actor = String(data.createdBy || data.updatedBy || "system").trim() || "system";
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        name: String(data.name).trim(),
        email,
        password: hashPassword(data.password),
        role,
        isActive: true,
        studentType: data.studentType || "other",
        studentId: String(data.studentId || "").trim(),
        customerInfo: {},
        createdBy: actor,
        updatedBy: actor,
        createdAt: now,
        updatedAt: now,
      };
      users.push(user);
      return user;
    });
  }

  async getStaffUsers() {
    return (await this.getUsers())
      .filter((user) => ["sales", "support"].includes(user.role))
      .map(({ password, passwordReset, ...user }) => user)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createStaffUser(data, actorId) {
    const actor = validateActor(actorId);
    if (!["sales", "support"].includes(data.role)) {
      throw new CustomerError(400, "Nhân viên chỉ có thể được gán vai trò sales hoặc support.");
    }
    try {
      return await this.createUser({
        ...data,
        createdBy: actor,
        updatedBy: actor,
      });
    } catch (error) {
      if (error.message.includes("đã được đăng ký")) {
        throw new CustomerError(409, error.message);
      }
      if (error.message.includes("Vai trò người dùng không hợp lệ")) {
        throw new CustomerError(400, error.message);
      }
      throw error;
    }
  }

  async updateStaffUser(id, { name, email, role, isActive }, actorId) {
    const actor = validateActor(actorId);
    const updatedName = name === undefined ? undefined : String(name).trim();
    const updatedEmail = email === undefined ? undefined : String(email).trim().toLowerCase();
    if ((role !== undefined && !["sales", "support"].includes(role)) ||
        (isActive !== undefined && typeof isActive !== "boolean") ||
        (name === undefined && email === undefined && role === undefined && isActive === undefined) ||
        (updatedName !== undefined && (!updatedName || updatedName.length > 120)) ||
        (updatedEmail !== undefined && (!updatedEmail || updatedEmail.length > 254))) {
      throw new CustomerError(400, "Cập nhật nhân viên không hợp lệ.");
    }
    try {
      return await this.updateCollection("users", (users) => {
        const user = users.find((entry) => entry.id === id);
        if (!user || !["sales", "support"].includes(user.role)) return null;
        if (updatedEmail && users.some((entry) => entry.id !== id && entry.email.toLowerCase() === updatedEmail)) {
          throw new CustomerError(409, "Email này đã được đăng ký trên hệ thống.");
        }
        if (updatedName !== undefined) user.name = updatedName;
        if (updatedEmail !== undefined) user.email = updatedEmail;
        if (role !== undefined) user.role = role;
        if (isActive !== undefined) user.isActive = isActive;
        user.updatedBy = actor;
        user.updatedAt = new Date().toISOString();
        const { password, passwordReset, ...safeUser } = user;
        return safeUser;
      });
    } catch (error) {
      if (error.code === "23505") {
        throw new CustomerError(409, "Email này đã được đăng ký trên hệ thống.");
      }
      throw error;
    }
  }

  async updateCustomerInfo(id, customerInfo, actorName = "system") {
    return this.updateCollection("users", (users) => {
      const user = users.find((entry) => entry.id === id);
      if (!user) return null;
      user.customerInfo = { ...(user.customerInfo || {}), ...customerInfo };
      user.updatedBy = String(actorName || "system").trim() || "system";
      user.updatedAt = new Date().toISOString();
      return user;
    });
  }

  async findOrCreateSocialUser(data) {
    return this.updateCollection("users", (users) => {
      const email = String(data.email || "").trim().toLowerCase();
      let user = email ? users.find((u) => u.email.toLowerCase() === email) : null;
      const now = new Date().toISOString();
      if (user) {
        user.authProvider = data.authProvider || user.authProvider || "google";
        if (data.providerId) user.providerId = data.providerId;
        user.updatedAt = now;
        return user;
      }
      const actor = String(data.authProvider || "social").trim();
      const newUser = {
        id: crypto.randomUUID(),
        name: String(data.name || email.split("@")[0] || "Thành viên BookNest").trim(),
        email,
        password: hashPassword(crypto.randomBytes(24).toString("hex")),
        role: ROLES.USER,
        studentType: data.studentType || "other",
        studentId: String(data.studentId || "").trim(),
        authProvider: data.authProvider || "google",
        providerId: String(data.providerId || "").trim(),
        customerInfo: {},
        createdBy: actor,
        updatedBy: actor,
        createdAt: now,
        updatedAt: now
      };
      users.push(newUser);
      return newUser;
    });
  }

  async readCustomers() {
    return this.readCollection("customers");
  }

  async writeCustomers(customers) {
    return this.updateCollection("customers", (records) => {
      records.splice(0, records.length, ...customers);
    });
  }

  async getCustomers() {
    return (await this.readCustomers()).filter((customer) => !customer.deletedAt);
  }

  async getCustomerById(id) {
    return (await this.readCustomers()).find((customer) => customer.id === id && !customer.deletedAt) || null;
  }

  async createCustomer(data, actorId) {
    const customerData = validateCustomerData(data);
    const actor = validateActor(actorId);
    return this.updateCollection("customers", (customers) => {
      const phoneDigits = customerData.phone.replace(/\D/g, "");
      if (customers.some((customer) => !customer.deletedAt && (
        customer.email.toLowerCase() === customerData.email ||
        customer.phone.replace(/\D/g, "") === phoneDigits
      ))) {
        throw new CustomerError(409, "Email hoặc số điện thoại đã thuộc về khách hàng khác.");
      }
      const customer = {
        id: crypto.randomUUID(),
        ...customerData,
        status: "new",
        created_by: actor,
        updated_by: actor,
        createdAt: new Date().toISOString(),
      };
      customers.push(customer);
      return customer;
    });
  }

  async updateCustomer(id, data, actorId) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new CustomerError(400, "Dữ liệu khách hàng không hợp lệ.");
    }
    const actor = validateActor(actorId);
    return this.updateCollection("customers", (customers) => {
      const index = customers.findIndex((item) => item.id === id && !item.deletedAt);
      if (index < 0) return null;
      const existing = customers[index];
      const validated = validateCustomerData({
        name: data.name !== undefined ? String(data.name).trim() : existing.name,
        email: data.email !== undefined ? String(data.email).trim().toLowerCase() : existing.email,
        phone: data.phone !== undefined ? String(data.phone).trim() : existing.phone,
      });
      const phoneDigits = validated.phone.replace(/\D/g, "");
      if (customers.some((item) => item.id !== id && !item.deletedAt && (
        item.email.toLowerCase() === validated.email ||
        item.phone.replace(/\D/g, "") === phoneDigits
      ))) {
        throw new CustomerError(409, "Email hoặc số điện thoại đã thuộc về khách hàng khác.");
      }
      const updatedStatus = data.status !== undefined ? String(data.status).trim() : existing.status;
      if (data.status !== undefined && !customerStatuses.has(updatedStatus)) {
        throw new CustomerError(400, "Trạng thái khách hàng không hợp lệ.");
      }
      if (data.status !== undefined && nextCustomerStatus.get(existing.status) !== updatedStatus) {
        throw new CustomerError(409, "Trạng thái chỉ có thể chuyển lần lượt từ mới sang tiềm năng rồi thành khách hàng.");
      }
      const updated = {
        ...existing,
        ...validated,
        status: updatedStatus,
        updated_by: actor,
        updatedAt: new Date().toISOString(),
      };
      customers[index] = updated;
      return updated;
    });
  }

  async updateCustomerStatus(id, status, actorId) {
    if (!customerStatuses.has(status)) throw new CustomerError(400, "Trạng thái khách hàng không hợp lệ.");
    const actor = validateActor(actorId);
    return this.updateCollection("customers", (customers) => {
      const customer = customers.find((item) => item.id === id && !item.deletedAt);
      if (!customer) return null;
      if (nextCustomerStatus.get(customer.status) !== status) {
        throw new CustomerError(409, "Trạng thái chỉ có thể chuyển lần lượt từ mới sang tiềm năng rồi thành khách hàng.");
      }
      customer.status = status;
      customer.updated_by = actor;
      customer.updatedAt = new Date().toISOString();
      return customer;
    });
  }

  async softDeleteCustomer(id, actorId) {
    const actor = validateActor(actorId);
    return this.updateCollection("customers", (customers) => {
      const customer = customers.find((item) => item.id === id && !item.deletedAt);
      if (!customer) return false;
      const now = new Date().toISOString();
      customer.deletedAt = now;
      customer.updated_by = actor;
      customer.updatedAt = now;
      return true;
    });
  }

  async getAllOrders() {
    return (await this.readCollection("orders")).reverse();
  }

  async addOrder(order) {
    return this.updateCollection("orders", (orders) => {
      const duplicate = orders.find((entry) => (
        entry.orderId === order.orderId ||
        (order.idempotencyKey && entry.idempotencyKey === order.idempotencyKey)
      ));
      if (duplicate) return duplicate;
      orders.push(order);
      return order;
    });
  }

  async addOrderIdempotently(
    order,
    requestHash,
    inventory = [],
    validateOrder = () => {},
    couponCode = null,
  ) {
    if (!order?.idempotencyKey || !/^[a-f0-9]{64}$/.test(requestHash || "") ||
        !Array.isArray(inventory)) {
      throw new Error("A valid idempotency key, request hash, and inventory are required.");
    }
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO order_idempotency (idempotency_key, request_hash, order_record)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING order_record`,
        [order.idempotencyKey, requestHash, JSON.stringify(order)],
      );
      if (!inserted.rowCount) {
        const existing = await client.query(
          `SELECT request_hash, order_record
           FROM order_idempotency
           WHERE idempotency_key = $1
           FOR UPDATE`,
          [order.idempotencyKey],
        );
        const existingRecord = existing.rows[0];
        const existingHash = existingRecord.request_hash ||
          hashOrderRequest(existingRecord.order_record);
        if (existingHash !== requestHash) {
          await client.query("COMMIT");
          return { order: existingRecord.order_record, replayed: false, conflict: true };
        }
        if (!existingRecord.request_hash) {
          await client.query(
            "UPDATE order_idempotency SET request_hash = $2 WHERE idempotency_key = $1",
            [order.idempotencyKey, requestHash],
          );
        }
        await client.query("COMMIT");
        return { order: existingRecord.order_record, replayed: true, conflict: false };
      }

      const orders = await this.readRelationalCollection(client, "orders", true);
      await validateOrder(orders);
      if (couponCode) {
        const coupon = await client.query(
          `UPDATE coupon_promotions
           SET used_count = used_count + 1
           WHERE code = $1
             AND enabled = TRUE
             AND (starts_at IS NULL OR starts_at <= NOW())
             AND (expires_at IS NULL OR expires_at > NOW())
             AND min_subtotal <= $2
             AND rate = $3
             AND (max_uses IS NULL OR used_count < max_uses)
           RETURNING code`,
          [couponCode, order.subtotal, order.couponRate],
        );
        if (!coupon.rowCount) {
          throw new CustomerError(409, "Mã ưu đãi vừa hết lượt sử dụng hoặc không còn áp dụng được.");
        }
      }
      for (const item of [...inventory].sort((left, right) => left.title.localeCompare(right.title))) {
        await client.query(
          `INSERT INTO store_products (product_id, title, author, price, stock, is_custom)
           VALUES ($1, $2, $3, 0, $4, FALSE) ON CONFLICT (title) DO NOTHING`,
          [`inventory-${item.title}`, item.title, "", item.stock],
        );
        const legacyReserved = orders.reduce((quantity, existingOrder) => (
          existingOrder.status === "cancelled"
            ? quantity
            : quantity + (existingOrder.items || [])
              .filter((entry) => entry.title === item.title)
              .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
        ), 0);
        await client.query(
          `INSERT INTO book_inventory (book_title, stock, reserved)
           VALUES ($1, $2, $3)
           ON CONFLICT (book_title) DO NOTHING`,
          [item.title, item.stock, Math.min(legacyReserved, item.stock)],
        );
        await client.query(
          `UPDATE book_inventory
           SET stock = GREATEST($2, reserved), updated_at = NOW()
           WHERE book_title = $1`,
          [item.title, item.stock],
        );
        const reservation = await client.query(
          `UPDATE book_inventory
           SET reserved = reserved + $2, updated_at = NOW()
           WHERE book_title = $1 AND reserved + $2 <= stock
           RETURNING book_title`,
          [item.title, item.quantity],
        );
        if (!reservation.rowCount) {
          throw new CustomerError(400, "Số lượng sách vượt quá tồn kho.");
        }
      }
      if (!orders.some((entry) => entry.orderId === order.orderId)) orders.push(order);
      await this.writeRelationalCollection(client, "orders", orders);
      await client.query(
        "UPDATE order_idempotency SET order_record = $2::jsonb WHERE idempotency_key = $1",
        [order.idempotencyKey, JSON.stringify(order)],
      );
      await client.query("COMMIT");
      return { order, replayed: false, conflict: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findOrderById(orderId) {
    return (await this.readCollection("orders")).find((order) => order.orderId === orderId) || null;
  }

  async updateOrderStatus(orderId, payload, _ordersPathOverride, options = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }
    const { status, paymentStatus } = payload;
    if (Object.keys(payload).some((field) => !["status", "paymentStatus", "items"].includes(field))) {
      throw new CustomerError(400, "Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }
    if (status !== undefined && !orderStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái đơn hàng không hợp lệ.");
    }
    if (paymentStatus !== undefined && !paymentStatuses.has(String(paymentStatus).trim())) {
      throw new Error("Trạng thái thanh toán không hợp lệ.");
    }
    const actorRole = String(options.actorRole || "").trim().toLowerCase();
    if (!actorRole) {
      throw new CustomerError(403, "Không xác định được vai trò thực hiện cập nhật đơn hàng.");
    }
    if (actorRole === ROLES.USER && (paymentStatus !== undefined || payload.items !== undefined)) {
      throw new CustomerError(403, "Người mua chỉ được phép hủy đơn hàng ở trạng thái phù hợp.");
    }
    if (payload.items !== undefined) {
      if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 50) {
        throw new CustomerError(400, "Danh sách sản phẩm cập nhật không hợp lệ.");
      }
      const titles = new Set();
      for (const item of payload.items) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          !Number.isSafeInteger(item.unitPrice) ||
          item.unitPrice < 0 ||
          !Number.isSafeInteger(item.lineTotal) ||
          item.lineTotal !== item.unitPrice * item.quantity ||
          titles.has(item.title)
        ) {
          throw new CustomerError(400, "Danh sách sản phẩm cập nhật không hợp lệ.");
        }
        titles.add(item.title);
      }
      if (
        !options.totals ||
        !Number.isSafeInteger(options.totals.subtotal) ||
        !Number.isSafeInteger(options.totals.discount) ||
        !Number.isSafeInteger(options.totals.total) ||
        options.totals.discount < 0 ||
        options.totals.discount > options.totals.subtotal ||
        options.totals.subtotal !== payload.items.reduce((sum, item) => sum + item.lineTotal, 0) ||
        options.totals.total !== options.totals.subtotal - options.totals.discount
      ) {
        throw new CustomerError(400, "Tổng giá trị đơn hàng không hợp lệ.");
      }
      if (!Array.isArray(options.inventory)) {
        throw new CustomerError(400, "Thông tin tồn kho cập nhật không hợp lệ.");
      }
    }
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const orders = await this.readRelationalCollection(client, "orders", true);
      const order = orders.find((entry) => entry.orderId === orderId);
      if (!order) {
        await client.query("COMMIT");
        return null;
      }
      if (
        status !== undefined &&
        !isOrderStatusTransitionAllowedForRole(order.status, status, actorRole)
      ) {
        throw new CustomerError(
          actorRole === ROLES.USER ? 403 : 400,
          "Vai trò hiện tại không được phép chuyển trạng thái đơn hàng.",
        );
      }
      if (payload.items !== undefined) {
        if (order.status === "cancelled" || status === "cancelled") {
          throw new CustomerError(409, "Không thể cập nhật sản phẩm của đơn hàng đã hủy.");
        }
        if (typeof options.validateOrder === "function") {
          options.validateOrder(orders, order);
        }

        const previousQuantities = new Map();
        const nextQuantities = new Map();
        for (const item of order.items || []) {
          previousQuantities.set(
            item.title,
            (previousQuantities.get(item.title) || 0) + Number(item.quantity || 0),
          );
        }
        for (const item of payload.items) {
          nextQuantities.set(item.title, item.quantity);
        }
        const inventoryByTitle = new Map(
          options.inventory.map((item) => [item.title, item]),
        );
        const changedTitles = [...new Set([
          ...previousQuantities.keys(),
          ...nextQuantities.keys(),
        ])].sort((left, right) => left.localeCompare(right));

        for (const title of changedTitles) {
          const delta = (nextQuantities.get(title) || 0) - (previousQuantities.get(title) || 0);
          if (!delta) continue;
          const itemInventory = inventoryByTitle.get(title);
          if (!itemInventory || !Number.isInteger(itemInventory.stock) || itemInventory.stock < 0) {
            if (delta > 0) {
              throw new CustomerError(400, "Một hoặc nhiều sách trong giỏ hàng không hợp lệ.");
            }
            const released = await client.query(
              `UPDATE book_inventory
               SET reserved = reserved - $2, updated_at = NOW()
               WHERE book_title = $1 AND reserved >= $2
               RETURNING book_title`,
              [title, -delta],
            );
            if (!released.rowCount) {
              throw new Error(`Tồn kho đặt trước không nhất quán cho sách "${title}".`);
            }
            continue;
          }

          await client.query(
            `INSERT INTO store_products (product_id, title, author, price, stock, is_custom)
             VALUES ($1, $2, $3, 0, $4, FALSE) ON CONFLICT (title) DO NOTHING`,
            [`inventory-${title}`, title, "", itemInventory.stock],
          );
          const legacyReserved = orders.reduce((quantity, existingOrder) => (
            existingOrder.status === "cancelled"
              ? quantity
              : quantity + (existingOrder.items || [])
                .filter((entry) => entry.title === title)
                .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
          ), 0);
          await client.query(
            `INSERT INTO book_inventory (book_title, stock, reserved)
             VALUES ($1, $2, $3)
             ON CONFLICT (book_title) DO NOTHING`,
            [title, itemInventory.stock, Math.min(legacyReserved, itemInventory.stock)],
          );
          await client.query(
            `UPDATE book_inventory
             SET stock = GREATEST($2, reserved), updated_at = NOW()
             WHERE book_title = $1`,
            [title, itemInventory.stock],
          );

          const reservation = delta > 0
            ? await client.query(
              `UPDATE book_inventory
               SET reserved = reserved + $2, updated_at = NOW()
               WHERE book_title = $1 AND reserved + $2 <= stock
               RETURNING book_title`,
              [title, delta],
            )
            : await client.query(
              `UPDATE book_inventory
               SET reserved = reserved - $2, updated_at = NOW()
               WHERE book_title = $1 AND reserved >= $2
               RETURNING book_title`,
              [title, -delta],
            );
          if (!reservation.rowCount) {
            if (delta > 0) {
              throw new CustomerError(400, "Số lượng sách vượt quá tồn kho.");
            }
            throw new Error(`Tồn kho đặt trước không nhất quán cho sách "${title}".`);
          }
        }
        order.items = payload.items;
        order.subtotal = options.totals.subtotal;
        order.discount = options.totals.discount;
        order.total = options.totals.total;
      }
      if (status === "cancelled" && order.status !== "cancelled") {
        for (const item of order.items || []) {
          await client.query(
            `UPDATE book_inventory
             SET reserved = GREATEST(reserved - $2, 0), updated_at = NOW()
             WHERE book_title = $1`,
            [item.title, item.quantity],
          );
        }
      }
      if (status) order.status = status;
      if (paymentStatus) order.paymentStatus = paymentStatus;
      order.updatedAt = new Date().toISOString();
      await this.writeRelationalCollection(client, "orders", orders);
      if (order.idempotencyKey) {
        await client.query(
          `UPDATE order_idempotency
           SET order_record = $2::jsonb
           WHERE idempotency_key = $1`,
          [order.idempotencyKey, JSON.stringify(order)],
        );
      }
      await client.query("COMMIT");
      return order;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addServiceRequest(request) {
    const service = String(request.service || "").trim();
    if (!serviceTypes.has(service)) throw new Error("Loại dịch vụ không hợp lệ.");
    return this.updateCollection("services", (services) => {
      const entry = {
        id: crypto.randomUUID(),
        service,
        bookTitle: String(request.bookTitle).trim(),
        condition: request.condition,
        name: String(request.name).trim(),
        phone: String(request.phone).trim(),
        note: String(request.note || "").trim(),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      services.push(entry);
      return entry;
    });
  }

  async getServiceRequests() {
    return (await this.readCollection("services")).reverse();
  }

  async updateServiceRequestStatus(id, status) {
    if (status !== undefined && !serviceStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái yêu cầu dịch vụ không hợp lệ.");
    }
    return this.updateCollection("services", (services) => {
      const service = services.find((entry) => entry.id === id);
      if (!service) return null;
      service.status = status;
      service.updatedAt = new Date().toISOString();
      return service;
    });
  }

  async getCustomBooks() {
    return (await this.readCollection("books")).filter((book) => !book.catalogOverride);
  }

  async getCatalogBookOverrides() {
    return (await this.readCollection("books")).filter((book) => book.catalogOverride);
  }

  async persistAdminBookUpdate(id, updateData, expectedUpdatedAt, catalogOverride, baseBook) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const records = await this.readRelationalCollection(client, "books", true);
      const index = records.findIndex(
        (record) => record.id === id && Boolean(record.catalogOverride) === catalogOverride,
      );
      const stored = index < 0 ? null : records[index];
      const current = stored || (catalogOverride ? baseBook : null);
      if (expectedUpdatedAt !== undefined && (stored?.updatedAt || "") !== expectedUpdatedAt) {
        throw new CustomerError(409, "Sách đã được cập nhật bởi người khác. Vui lòng tải lại dữ liệu.");
      }
      if (!current && !catalogOverride) {
        await client.query("ROLLBACK");
        return null;
      }

      const now = new Date().toISOString();
      const updated = {
        ...current,
        ...updateData,
        id,
        ...(catalogOverride ? { catalogOverride: true } : {}),
        createdAt: current?.createdAt || now,
        updatedAt: now,
      };
      if (index < 0) records.push(updated);
      else records[index] = updated;

      if (current?.title) {
        const inventory = await client.query(
          "SELECT reserved FROM book_inventory WHERE book_title = $1 FOR UPDATE",
          [current.title],
        );
        if (inventory.rows[0] && updated.stock < inventory.rows[0].reserved) {
          throw new CustomerError(409, "Tồn kho không thể thấp hơn số sách đã được đặt trước.");
        }
        if (current.title !== updated.title && inventory.rows[0]) {
          const targetInventory = await client.query(
            "SELECT book_title FROM book_inventory WHERE book_title = $1 FOR UPDATE",
            [updated.title],
          );
          if (targetInventory.rowCount) {
            throw new CustomerError(409, "Không thể đổi tên sách vì tên mới đã có tồn kho.");
          }
          await client.query(
            `UPDATE book_inventory
             SET book_title = $2, stock = $3, updated_at = NOW()
             WHERE book_title = $1`,
            [current.title, updated.title, updated.stock],
          );
        } else if (inventory.rows[0]) {
          await client.query(
            `UPDATE book_inventory
             SET stock = $2, updated_at = NOW()
             WHERE book_title = $1`,
            [current.title, updated.stock],
          );
        }
        await client.query(
          "UPDATE store_products SET stock = $2, updated_at = NOW() WHERE product_id = $1",
          [`inventory-${current.title}`, updated.stock],
        );
      }

      await this.writeRelationalCollection(client, "books", records);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateCatalogBook(id, book, expectedUpdatedAt, baseBook) {
    return this.persistAdminBookUpdate(id, book, expectedUpdatedAt, true, baseBook);
  }

  async addCustomBook(book) {
    return this.updateCollection("books", (books) => {
      const entry = {
        id: crypto.randomUUID(),
        title: String(book.title).trim(),
        author: String(book.author).trim(),
        category: String(book.category).trim(),
        price: Number(book.price) || 0,
        stock: Number.isInteger(book.stock) ? book.stock : 12,
        cover: String(book.cover || "").trim() || "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80",
        description: String(book.description || "").trim(),
        createdAt: new Date().toISOString(),
      };
      books.push(entry);
      return entry;
    });
  }

  async updateCustomBook(id, updateData, expectedUpdatedAt) {
    return this.persistAdminBookUpdate(id, updateData, expectedUpdatedAt, false);
  }

  async deleteCustomBook(id) {
    return this.updateCollection("books", (books) => {
      const remaining = books.filter((book) => book.id !== id && book.title !== id);
      const deleted = remaining.length !== books.length;
      books.splice(0, books.length, ...remaining);
      return deleted;
    });
  }

  async getStats(_ordersPathOverride, totalBaseBooks = 80) {
    const [orders, users, books, services] = await Promise.all([
      this.getAllOrders(),
      this.getUsers(),
      this.getCustomBooks(),
      this.getServiceRequests(),
    ]);
    const activeOrders = orders.filter((order) => order.status !== "cancelled");
    return {
      totalOrders: orders.length,
      activeOrders: activeOrders.length,
      totalRevenue: activeOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
      totalBooks: totalBaseBooks + books.length,
      totalUsers: users.length,
      totalServices: services.length,
      recentOrders: orders.slice(0, 5),
    };
  }
}

module.exports = {
  createDatabasePoolConfig,
  createDatabaseSslConfig,
  PostgresDatabase,
};
