const crypto = require("node:crypto");
const fs = require("node:fs");
const { Pool } = require("pg");
const { CustomerError, validateCustomerData } = require("./db");
const { hashPassword } = require("./auth");

const serviceTypes = new Set(["rent", "sell", "exchange"]);
const orderStatuses = new Set(["received", "processing", "shipping", "completed", "cancelled"]);
const paymentStatuses = new Set(["pending", "paid", "cod_pending", "refunded"]);
const serviceStatuses = new Set(["pending", "processing", "completed", "cancelled"]);
const customerStatuses = new Set(["new", "lead", "customer"]);
const nextCustomerStatus = new Map([["new", "lead"], ["lead", "customer"]]);
const collections = new Set(["users", "customers", "orders", "services", "books"]);

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
        const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        const password = process.env.ADMIN_PASSWORD || "";
        const hasAdminConfig = Boolean(email || password);
        if (hasAdminConfig && (!email || password.length < 12)) {
          throw new Error(
            "Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD (tối thiểu 12 ký tự) không hợp lệ.",
          );
        }

        const { rows } = await this.pool.query(
          "SELECT records FROM booknest_data WHERE collection = 'users'",
        );
        let users = rows.length ? rows[0].records : [];
        if (!Array.isArray(users)) {
          throw new Error('PostgreSQL collection "users" must contain a JSON array.');
        }
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
              role: "admin",
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
          await this.pool.query(
            "INSERT INTO booknest_data (collection, records) VALUES ('users', $1::jsonb) ON CONFLICT (collection) DO UPDATE SET records = EXCLUDED.records, updated_at = NOW()",
            [JSON.stringify(users)],
          );
        }
      }).catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  async readCollection(name) {
    if (!collections.has(name)) throw new Error(`Unknown data collection: ${name}`);
    await this.init();
    const { rows } = await this.pool.query(
      "SELECT records FROM booknest_data WHERE collection = $1",
      [name],
    );
    const records = rows.length ? rows[0].records : [];
    if (!Array.isArray(records)) {
      throw new Error(`PostgreSQL collection "${name}" must contain a JSON array.`);
    }
    return records;
  }

  async updateCollection(name, update) {
    if (!collections.has(name)) throw new Error(`Unknown data collection: ${name}`);
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO booknest_data (collection, records) VALUES ($1, '[]'::jsonb) ON CONFLICT (collection) DO NOTHING",
        [name],
      );
      const { rows } = await client.query(
        "SELECT records FROM booknest_data WHERE collection = $1 FOR UPDATE",
        [name],
      );
      const records = rows[0].records;
      if (!Array.isArray(records)) {
        throw new Error(`PostgreSQL collection "${name}" must contain a JSON array.`);
      }
      const result = await update(records);
      await client.query(
        "UPDATE booknest_data SET records = $2::jsonb, updated_at = NOW() WHERE collection = $1",
        [name, JSON.stringify(records)],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      orders.push(order);
    });
  }

  async findOrderById(orderId) {
    return (await this.readCollection("orders")).find((order) => order.orderId === orderId) || null;
  }

  async updateOrderStatus(orderId, payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }
    const { status, paymentStatus } = payload;
    if (status !== undefined && !orderStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái đơn hàng không hợp lệ.");
    }
    if (paymentStatus !== undefined && !paymentStatuses.has(String(paymentStatus).trim())) {
      throw new Error("Trạng thái thanh toán không hợp lệ.");
    }
    return this.updateCollection("orders", (orders) => {
      const order = orders.find((entry) => entry.orderId === orderId);
      if (!order) return null;
      if (status) order.status = status;
      if (paymentStatus) order.paymentStatus = paymentStatus;
      order.updatedAt = new Date().toISOString();
      return order;
    });
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
    return this.readCollection("books");
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

  async updateCustomBook(id, updateData) {
    return this.updateCollection("books", (books) => {
      const index = books.findIndex((book) => book.id === id || book.title === id);
      if (index < 0) return null;
      books[index] = { ...books[index], ...updateData, updatedAt: new Date().toISOString() };
      return books[index];
    });
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
