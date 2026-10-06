const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword } = require("./auth");

class Database {
  constructor(options = {}) {
    const root = options.root || path.resolve(__dirname, "..");
    const dataDir = options.dataDir || path.join(root, "data");
    this.usersPath = options.usersPath || path.join(dataDir, "users.json");
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
        name: "Quản trị viên BookNest",
        email: "admin@booknest.vn",
        password: hashPassword("admin123"),
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

  async createUser(data) {
    await this.init();
    const users = await this.getUsers();
    const cleanEmail = String(data.email).trim().toLowerCase();
    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("Email này đã được đăng ký trên hệ thống.");
    }

    const newUser = {
      id: crypto.randomUUID(),
      name: String(data.name).trim(),
      email: cleanEmail,
      password: hashPassword(data.password),
      role: data.role || "user",
      studentType: data.studentType || "other",
      studentId: String(data.studentId || "").trim(),
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), "utf8");
    return newUser;
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

  async updateOrderStatus(orderId, { status, paymentStatus }, ordersPathOverride) {
    const filePath = ordersPathOverride || this.ordersPath;
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
    const entry = {
      id: crypto.randomUUID(),
      service: request.service,
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

module.exports = { Database };

