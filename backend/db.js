const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword } = require("./auth");

const customerStatuses = ["new", "lead", "customer"];
const nextCustomerStatus = new Map([
  ["new", "lead"],
  ["lead", "customer"],
]);

class CustomerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateCustomerData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CustomerError(400, "Dữ liệu khách hàng không hợp lệ.");
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  const phoneDigits = phone.replace(/\D/g, "");

  if (name.length < 2 || name.length > 120) {
    throw new CustomerError(400, "Vui lòng nhập họ tên từ 2 đến 120 ký tự.");
  }
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new CustomerError(400, "Vui lòng nhập địa chỉ email hợp lệ.");
  }
  if (
    phone.length > 20 ||
    !/^\+?(?:\d+|\(\d+\))(?:[ -]?(?:\d+|\(\d+\)))*$/.test(phone) ||
    phoneDigits.length < 8 ||
    phoneDigits.length > 15
  ) {
    throw new CustomerError(400, "Vui lòng nhập số điện thoại hợp lệ.");
  }
  return { name, email, phone };
}

function validateCustomerActor(actorId) {
  if (typeof actorId !== "string" || !actorId.trim()) {
    throw new CustomerError(401, "Không xác định được người thực hiện thao tác.");
  }
  return actorId.trim();
}

const allowedServiceTypes = new Set(["rent", "sell", "exchange"]);
const allowedOrderStatuses = new Set(["received", "processing", "shipping", "completed", "cancelled"]);
const allowedPaymentStatuses = new Set(["pending", "paid", "cod_pending", "refunded"]);
const allowedServiceStatuses = new Set(["pending", "processing", "completed", "cancelled"]);

class Database {
  constructor(options = {}) {
    const root = options.root || path.resolve(__dirname, "..");
    const dataDir = options.dataDir || path.join(root, "data");
    this.usersPath = options.usersPath || path.join(dataDir, "users.json");
    this.customersPath = options.customersPath || path.join(dataDir, "customers.json");
    this.servicesPath = options.servicesPath || path.join(dataDir, "service-requests.jsonl");
    this.booksPath = options.booksPath || path.join(dataDir, "books.json");
    this.ordersPath = options.ordersPath || path.join(dataDir, "orders.jsonl");
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.usersPath), { recursive: true });

    // Seed default admin if users file does not exist
    try {
      await fs.access(this.usersPath);
    } catch {
      const defaultAdmin = {
        id: "admin-master",
        name: process.env.ADMIN_NAME?.trim() || "Quản trị viên BookNest",
        email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || "admin@booknest.vn",
        password: hashPassword(process.env.ADMIN_PASSWORD || "admin123"),
        role: "admin",
        studentType: "other",
        studentId: "",
        createdAt: new Date().toISOString()
      };
      await fs.writeFile(this.usersPath, JSON.stringify([defaultAdmin], null, 2), "utf8");
    }

    this.initialized = true;
  }

  // --- Users ---
  async getUsers() {
    await this.init();
    try {
      const content = await fs.readFile(this.usersPath, "utf8");
      const users = JSON.parse(content);
      return Array.isArray(users) ? users : [];
    } catch {
      return [];
    }
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = String(email).trim().toLowerCase();
    const users = await this.getUsers();
    return users.find((u) => u.email.toLowerCase() === cleanEmail) || null;
  }

  async findUserById(id) {
    if (!id) return null;
    const users = await this.getUsers();
    return users.find((u) => u.id === id) || null;
  }

  async updateCustomerInfo(id, customerInfo, actorName = "system") {
    await this.init();
    const users = await this.getUsers();
    const userIndex = users.findIndex((user) => user.id === id);
    if (userIndex < 0) return null;
    const normalizedActor = String(actorName || "system").trim() || "system";
    users[userIndex].customerInfo = {
      ...(users[userIndex].customerInfo || {}),
      ...customerInfo,
    };
    users[userIndex].updatedBy = normalizedActor;
    users[userIndex].updatedAt = new Date().toISOString();
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), "utf8");
    return users[userIndex];
  }

  async createUser(data) {
    await this.init();
    const users = await this.getUsers();
    const cleanEmail = String(data.email).trim().toLowerCase();
    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("Email này đã được đăng ký trên hệ thống.");
    }

    const normalizedRole = String(data.role || "user").trim().toLowerCase();
    const allowedRoles = new Set(["user", "admin", "sales", "support"]);
    if (!allowedRoles.has(normalizedRole)) {
      throw new Error("Vai trò người dùng không hợp lệ.");
    }

    const actorName = String(data.createdBy || data.updatedBy || "system").trim() || "system";
    const now = new Date().toISOString();

    const newUser = {
      id: crypto.randomUUID(),
      name: String(data.name).trim(),
      email: cleanEmail,
      password: hashPassword(data.password),
      role: normalizedRole,
      studentType: data.studentType || "other",
      studentId: String(data.studentId || "").trim(),
      customerInfo: {},
      createdBy: actorName,
      updatedBy: actorName,
      createdAt: now,
      updatedAt: now
    };

    users.push(newUser);
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), "utf8");
    return newUser;
  }

  // --- CRM Customers ---
  async readCustomers() {
    try {
      const content = await fs.readFile(this.customersPath, "utf8");
      const customers = JSON.parse(content);
      if (!Array.isArray(customers)) {
        throw new Error("Tệp khách hàng phải chứa một danh sách.");
      }
      return customers;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeCustomers(customers) {
    await fs.mkdir(path.dirname(this.customersPath), { recursive: true });
    await fs.writeFile(this.customersPath, JSON.stringify(customers, null, 2), "utf8");
  }

  async getCustomers() {
    return (await this.readCustomers()).filter((customer) => !customer.deletedAt);
  }

  async getCustomerById(id) {
    const customers = await this.readCustomers();
    return customers.find((customer) => customer.id === id && !customer.deletedAt) || null;
  }

  async createCustomer(data, actorId) {
    const customerData = validateCustomerData(data);
    const actor = validateCustomerActor(actorId);
    const customers = await this.readCustomers();
    const phoneDigits = customerData.phone.replace(/\D/g, "");
    const duplicate = customers.some((customer) => (
      !customer.deletedAt &&
      (
        customer.email.toLowerCase() === customerData.email ||
        customer.phone.replace(/\D/g, "") === phoneDigits
      )
    ));
    if (duplicate) {
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
    await this.writeCustomers(customers);
    return customer;
  }

  async updateCustomer(id, data, actorId) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new CustomerError(400, "Dữ liệu khách hàng không hợp lệ.");
    }
    const actor = validateCustomerActor(actorId);
    const customers = await this.readCustomers();
    const customerIndex = customers.findIndex((item) => item.id === id && !item.deletedAt);
    if (customerIndex < 0) return null;

    const existing = customers[customerIndex];
    const nextData = {
      name: data.name !== undefined ? String(data.name).trim() : existing.name,
      email: data.email !== undefined ? String(data.email).trim().toLowerCase() : existing.email,
      phone: data.phone !== undefined ? String(data.phone).trim() : existing.phone,
    };
    const validated = validateCustomerData(nextData);
    const phoneDigits = validated.phone.replace(/\D/g, "");
    const duplicate = customers.some((item) => (
      item.id !== id &&
      !item.deletedAt &&
      (
        item.email.toLowerCase() === validated.email ||
        item.phone.replace(/\D/g, "") === phoneDigits
      )
    ));
    if (duplicate) {
      throw new CustomerError(409, "Email hoặc số điện thoại đã thuộc về khách hàng khác.");
    }

    customers[customerIndex] = {
      ...existing,
      ...validated,
      status: data.status !== undefined ? String(data.status).trim() : existing.status,
      updated_by: actor,
      updatedAt: new Date().toISOString(),
    };

    if (data.status !== undefined) {
      if (!customerStatuses.includes(customers[customerIndex].status)) {
        throw new CustomerError(400, "Trạng thái khách hàng không hợp lệ.");
      }
      if (nextCustomerStatus.get(existing.status) !== customers[customerIndex].status) {
        throw new CustomerError(
          409,
          "Trạng thái chỉ có thể chuyển lần lượt từ mới sang tiềm năng rồi thành khách hàng.",
        );
      }
    }

    await this.writeCustomers(customers);
    return customers[customerIndex];
  }

  async updateCustomerStatus(id, status, actorId) {
    if (!customerStatuses.includes(status)) {
      throw new CustomerError(400, "Trạng thái khách hàng không hợp lệ.");
    }
    const actor = validateCustomerActor(actorId);

    const customers = await this.readCustomers();
    const customer = customers.find((item) => item.id === id && !item.deletedAt);
    if (!customer) return null;
    if (nextCustomerStatus.get(customer.status) !== status) {
      throw new CustomerError(
        409,
        "Trạng thái chỉ có thể chuyển lần lượt từ mới sang tiềm năng rồi thành khách hàng.",
      );
    }

    customer.status = status;
    customer.updated_by = actor;
    customer.updatedAt = new Date().toISOString();
    await this.writeCustomers(customers);
    return customer;
  }

  async softDeleteCustomer(id, actorId) {
    const actor = validateCustomerActor(actorId);
    const customers = await this.readCustomers();
    const customer = customers.find((item) => item.id === id && !item.deletedAt);
    if (!customer) return false;

    const deletedAt = new Date().toISOString();
    customer.deletedAt = deletedAt;
    customer.updated_by = actor;
    customer.updatedAt = deletedAt;
    await this.writeCustomers(customers);
    return true;
  }

  // --- Orders ---
  async getAllOrders(ordersPathOverride) {
    const filePath = ordersPathOverride || this.ordersPath;
    try {
      const content = await fs.readFile(filePath, "utf8");
      const orders = [];
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item && item.orderId) orders.push(item);
        } catch {}
      }
      return orders.reverse(); // Newest first
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async addOrder(order, ordersPathOverride) {
    const filePath = ordersPathOverride || this.ordersPath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(order)}\n`, "utf8");
  }

  async findOrderById(orderId, ordersPathOverride) {
    const orders = await this.getAllOrders(ordersPathOverride);
    return orders.find((order) => order.orderId === orderId) || null;
  }

  async updateOrderStatus(orderId, payload, ordersPathOverride) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }

    const { status, paymentStatus } = payload;
    const filePath = ordersPathOverride || this.ordersPath;
    if (status !== undefined && !allowedOrderStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái đơn hàng không hợp lệ.");
    }
    if (paymentStatus !== undefined && !allowedPaymentStatuses.has(String(paymentStatus).trim())) {
      throw new Error("Trạng thái thanh toán không hợp lệ.");
    }

    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }

    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    let updatedOrder = null;

    const newLines = lines.map((line) => {
      try {
        const order = JSON.parse(line);
        if (order && order.orderId === orderId) {
          if (status) order.status = status;
          if (paymentStatus) order.paymentStatus = paymentStatus;
          order.updatedAt = new Date().toISOString();
          updatedOrder = order;
          return JSON.stringify(order);
        }
        return line;
      } catch {
        return line;
      }
    });

    if (!updatedOrder) return null;
    await fs.writeFile(filePath, newLines.join("\n") + "\n", "utf8");
    return updatedOrder;
  }

  // --- Service Requests (Thuê / Thu mua / Trao đổi sách) ---
  async addServiceRequest(request) {
    await this.init();
    const serviceType = String(request.service || "").trim();
    if (!allowedServiceTypes.has(serviceType)) {
      throw new Error("Loại dịch vụ không hợp lệ.");
    }
    const entry = {
      id: crypto.randomUUID(),
      service: serviceType,
      bookTitle: String(request.bookTitle).trim(),
      condition: request.condition,
      name: String(request.name).trim(),
      phone: String(request.phone).trim(),
      note: String(request.note || "").trim(),
      status: "pending", // pending, processing, completed, cancelled
      createdAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(this.servicesPath), { recursive: true });
    await fs.appendFile(this.servicesPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async getServiceRequests() {
    await this.init();
    try {
      const content = await fs.readFile(this.servicesPath, "utf8");
      const list = [];
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item && item.id) list.push(item);
        } catch {}
      }
      return list.reverse();
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async updateServiceRequestStatus(id, status) {
    await this.init();
    if (status !== undefined && !allowedServiceStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái yêu cầu dịch vụ không hợp lệ.");
    }
    let content;
    try {
      content = await fs.readFile(this.servicesPath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }

    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    let updated = null;

    const newLines = lines.map((line) => {
      try {
        const item = JSON.parse(line);
        if (item && item.id === id) {
          item.status = status;
          item.updatedAt = new Date().toISOString();
          updated = item;
          return JSON.stringify(item);
        }
        return line;
      } catch {
        return line;
      }
    });

    if (!updated) return null;
    await fs.writeFile(this.servicesPath, newLines.join("\n") + "\n", "utf8");
    return updated;
  }

  // --- Custom Books & Catalog Extensions ---
  async getCustomBooks() {
    await this.init();
    try {
      const content = await fs.readFile(this.booksPath, "utf8");
      const books = JSON.parse(content);
      return Array.isArray(books) ? books : [];
    } catch {
      return [];
    }
  }

  async addCustomBook(book) {
    await this.init();
    const books = await this.getCustomBooks();
    const newBook = {
      id: crypto.randomUUID(),
      title: String(book.title).trim(),
      author: String(book.author).trim(),
      category: String(book.category).trim(),
      price: Number(book.price) || 0,
      stock: Number.isInteger(book.stock) ? book.stock : 12,
      cover: String(book.cover || "").trim() || "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80",
      description: String(book.description || "").trim(),
      createdAt: new Date().toISOString()
    };
    books.push(newBook);
    await fs.writeFile(this.booksPath, JSON.stringify(books, null, 2), "utf8");
    return newBook;
  }

  async updateCustomBook(id, updateData) {
    await this.init();
    const books = await this.getCustomBooks();
    const index = books.findIndex((b) => b.id === id || b.title === id);
    if (index === -1) return null;
    books[index] = {
      ...books[index],
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(this.booksPath, JSON.stringify(books, null, 2), "utf8");
    return books[index];
  }

  async deleteCustomBook(id) {
    await this.init();
    const books = await this.getCustomBooks();
    const nextBooks = books.filter((b) => b.id !== id && b.title !== id);
    if (nextBooks.length === books.length) return false;
    await fs.writeFile(this.booksPath, JSON.stringify(nextBooks, null, 2), "utf8");
    return true;
  }

  // --- Statistics ---
  async getStats(ordersPathOverride, totalBaseBooks = 80) {
    const orders = await this.getAllOrders(ordersPathOverride);
    const users = await this.getUsers();
    const customBooks = await this.getCustomBooks();
    const services = await this.getServiceRequests();

    const activeOrders = orders.filter((o) => o.status !== "cancelled");
    const totalRevenue = activeOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    return {
      totalOrders: orders.length,
      activeOrders: activeOrders.length,
      totalRevenue,
      totalBooks: totalBaseBooks + customBooks.length,
      totalUsers: users.length,
      totalServices: services.length,
      recentOrders: orders.slice(0, 5)
    };
  }
}

module.exports = { CustomerError, Database, validateCustomerData };
