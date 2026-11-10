const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword } = require("./auth");
const { DEFAULT_COUPONS, getCouponUnavailableReason } = require("./coupons");
const {
  CUSTOMER_STATUSES,
  customerInteractionTypeValues,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  customerStatusValues,
  isOrderStatusTransitionAllowed,
} = require("./business-constants");

async function atomicWriteFile(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, "utf8");
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EEXIST"].includes(error.code)) {
        throw error;
      }
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

const customerStatuses = customerStatusValues;
const nextCustomerStatus = new Map([
  [CUSTOMER_STATUSES.NEW, CUSTOMER_STATUSES.LEAD],
  [CUSTOMER_STATUSES.LEAD, CUSTOMER_STATUSES.CUSTOMER],
]);

class CustomerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SOCIAL_PROVIDERS = new Set(["google.com", "facebook.com"]);

function normalizeSocialAccount(provider, providerId) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedProviderId = String(providerId || "").trim();
  if (
    !SOCIAL_PROVIDERS.has(normalizedProvider) ||
    !normalizedProviderId ||
    normalizedProviderId.length > 128 ||
    /[\u0000-\u001F\u007F]/.test(normalizedProviderId)
  ) {
    throw new CustomerError(400, "Thông tin tài khoản social không hợp lệ.");
  }
  return { provider: normalizedProvider, providerId: normalizedProviderId };
}

function getSocialAccounts(user) {
  const accounts = Array.isArray(user.socialAccounts)
    ? user.socialAccounts.filter((account) => (
      account &&
      SOCIAL_PROVIDERS.has(String(account.provider || "").toLowerCase()) &&
      typeof account.providerId === "string" &&
      account.providerId.trim()
    )).map((account) => ({
      provider: String(account.provider).toLowerCase(),
      providerId: account.providerId.trim(),
    }))
    : [];
  if (
    SOCIAL_PROVIDERS.has(String(user.authProvider || "").toLowerCase()) &&
    typeof user.providerId === "string" &&
    user.providerId.trim()
  ) {
    accounts.push({
      provider: String(user.authProvider).toLowerCase(),
      providerId: user.providerId.trim(),
    });
  }
  return [...new Map(
    accounts.map((account) => [`${account.provider}\0${account.providerId}`, account]),
  ).values()];
}

function sanitizeTextValue(value, { maxLength = 255, allowEmpty = false, fieldName = "dữ liệu" } = {}) {
  const stringValue = typeof value === "string" ? value : String(value ?? "");
  const cleaned = stringValue
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/<\s*script\b[\s\S]*?<\/\s*script\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:javascript\s*:|data\s*:\s*text\/html|vbscript\s*:|on\w+\s*=)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned && !allowEmpty) {
    throw new CustomerError(400, `${fieldName} không hợp lệ.`);
  }

  const trimmed = maxLength > 0 && cleaned.length > maxLength
    ? cleaned.slice(0, maxLength).trim()
    : cleaned;

  if (trimmed.length === 0 && !allowEmpty) {
    throw new CustomerError(400, `${fieldName} không hợp lệ.`);
  }

  return trimmed;
}

function validateCustomerData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CustomerError(400, "Dữ liệu khách hàng không hợp lệ.");
  }

  const name = sanitizeTextValue(data.name, { maxLength: 120, fieldName: "Họ tên" });
  const email = sanitizeTextValue(data.email, { maxLength: 254, fieldName: "Email" }).toLowerCase();
  const phone = sanitizeTextValue(data.phone, { maxLength: 20, fieldName: "Số điện thoại" });
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

function validateCustomerInteractionData(data, { partial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CustomerError(400, "Dữ liệu tương tác khách hàng không hợp lệ.");
  }
  const allowedFields = new Set(["type", "note"]);
  if (Object.keys(data).some((field) => !allowedFields.has(field))) {
    throw new CustomerError(400, "Dữ liệu tương tác khách hàng không hợp lệ.");
  }
  if (!partial && (!Object.hasOwn(data, "type") || !Object.hasOwn(data, "note"))) {
    throw new CustomerError(400, "Vui lòng cung cấp loại và ghi chú tương tác.");
  }
  if (partial && !Object.keys(data).length) {
    throw new CustomerError(400, "Cần có ít nhất một trường để cập nhật tương tác.");
  }
  const result = {};
  if (Object.hasOwn(data, "type")) {
    if (typeof data.type !== "string" || !customerInteractionTypeValues.includes(data.type)) {
      throw new CustomerError(400, "Loại tương tác khách hàng không hợp lệ.");
    }
    result.type = data.type;
  }
  if (Object.hasOwn(data, "note")) {
    if (typeof data.note !== "string" || data.note.length > 2000) {
      throw new CustomerError(400, "Ghi chú tương tác khách hàng không hợp lệ.");
    }
    result.note = sanitizeTextValue(data.note, {
      maxLength: 5000,
      fieldName: "Ghi chú tương tác",
    });
  }
  return result;
}

const allowedServiceTypes = new Set(Object.values(SERVICE_TYPES));
const allowedOrderStatuses = new Set(Object.values(ORDER_STATUSES));
const allowedPaymentStatuses = new Set(Object.values(PAYMENT_STATUSES));
const allowedServiceStatuses = new Set(Object.values(SERVICE_STATUSES));

class Database {
  constructor(options = {}) {
    const root = options.root || path.resolve(__dirname, "..");
    const dataDir = options.dataDir || path.join(root, "data");
    this.usersPath = options.usersPath || path.join(dataDir, "users.json");
    this.customersPath = options.customersPath || path.join(dataDir, "customers.json");
    this.servicesPath = options.servicesPath || path.join(dataDir, "service-requests.jsonl");
    this.booksPath = options.booksPath || path.join(dataDir, "books.json");
    this.couponsPath = options.couponsPath || path.join(dataDir, "coupons.json");
    this.customerInteractionsPath = options.customerInteractionsPath ||
      path.join(dataDir, "customer-interactions.json");
    this.ordersPath = options.ordersPath || path.join(dataDir, "orders.jsonl");
    this.initialized = false;
    this.initializationPromise = null;
    this.userWriteQueue = Promise.resolve();
    this.fileWriteQueues = new Map();
  }

  enqueueFileWrite(filePath, operation) {
    const previous = this.fileWriteQueues.get(filePath) || Promise.resolve();
    const next = previous.then(operation);
    this.fileWriteQueues.set(filePath, next.catch(() => {}));
    return next;
  }

  async init() {
    if (this.initialized) return;
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }
    try {
      await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.usersPath), { recursive: true });

    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const configuredPassword = process.env.ADMIN_PASSWORD || "";
    const hasAdminConfig = Boolean(configuredEmail || configuredPassword);
    if (
      hasAdminConfig &&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail) ||
        configuredPassword.length < 12)
    ) {
      throw new Error(
        "Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD (tối thiểu 12 ký tự) không hợp lệ.",
      );
    }

    let users;
    try {
      users = JSON.parse(await fs.readFile(this.usersPath, "utf8"));
      if (!Array.isArray(users)) {
        throw new Error("Tệp tài khoản phải chứa một danh sách.");
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        users = [];
      } else if (error instanceof SyntaxError) {
        throw new Error(`Tệp tài khoản bị hỏng: ${error.message}`);
      } else {
        throw error;
      }
    }

    const defaultAdminEmail = "admin@booknest.vn";
    const configuredAdminName = String(process.env.ADMIN_NAME || "").trim() || "Quản trị viên BookNest";

    if (hasAdminConfig) {
      let admin = users.find(
        (user) => String(user.email || "").trim().toLowerCase() === configuredEmail,
      );
      if (!admin) {
        admin = {
          id: "admin-master",
          name: configuredAdminName,
          email: configuredEmail,
          role: ROLES.ADMIN,
          studentType: "other",
          studentId: "",
          createdAt: new Date().toISOString(),
        };
        users.push(admin);
      }
      admin.name = admin.name || configuredAdminName;
      admin.email = configuredEmail;
      admin.role = "admin";
      admin.password = hashPassword(configuredPassword);
      admin.passwordAuthEnabled = true;
      admin.studentType = admin.studentType || "other";
      admin.studentId = String(admin.studentId || "").trim();
      admin.updatedAt = new Date().toISOString();
      const legacyDefaultAdmin = users.find(
        (user) =>
          user !== admin &&
          String(user.email || "").trim().toLowerCase() === defaultAdminEmail &&
          user.role === ROLES.ADMIN,
      );
      if (legacyDefaultAdmin) {
        legacyDefaultAdmin.role = "user";
        legacyDefaultAdmin.password = hashPassword(crypto.randomBytes(32).toString("hex"));
        legacyDefaultAdmin.updatedAt = new Date().toISOString();
      }
    } else {
      const defaultAdmin = users.find(
        (user) =>
          String(user.email || "").trim().toLowerCase() === defaultAdminEmail &&
          user.role === ROLES.ADMIN,
      );
      if (defaultAdmin) {
        defaultAdmin.role = "user";
        defaultAdmin.password = hashPassword(crypto.randomBytes(32).toString("hex"));
        defaultAdmin.passwordAuthEnabled = false;
        defaultAdmin.updatedAt = new Date().toISOString();
      }
    }

    if (users.length > 0) {
      await atomicWriteFile(this.usersPath, JSON.stringify(users, null, 2));
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
    } catch (error) {
      if (error.code === "ENOENT") return [];
      if (error instanceof SyntaxError) {
        throw new Error(`Tệp tài khoản bị hỏng: ${error.message}`);
      }
      throw error;
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

  async updateUsers(update) {
    const operation = this.userWriteQueue.then(async () => {
      await this.init();
      const users = await this.getUsers();
      const result = await update(users);
      await atomicWriteFile(this.usersPath, JSON.stringify(users, null, 2));
      return result;
    });
    this.userWriteQueue = operation.catch(() => {});
    return operation;
  }

  async createPasswordResetToken(email, tokenHash, expiresAt) {
    return this.updateUsers((users) => {
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
      if (!user) return null;
      user.passwordReset = { tokenHash, expiresAt };
      return { id: user.id, name: user.name, email: user.email };
    });
  }

  async clearPasswordResetToken(tokenHash) {
    return this.updateUsers((users) => {
      const user = users.find((entry) => entry.passwordReset?.tokenHash === tokenHash);
      if (!user) return false;
      delete user.passwordReset;
      return true;
    });
  }

  async resetPassword(tokenHash, password) {
    return this.updateUsers((users) => {
      const user = users.find((entry) => (
        entry.passwordReset?.tokenHash === tokenHash &&
        Date.parse(entry.passwordReset.expiresAt) > Date.now()
      ));
      if (!user) return null;
      user.password = hashPassword(password);
      user.passwordAuthEnabled = true;
      delete user.passwordReset;
      user.updatedAt = new Date().toISOString();
      return user.id;
    });
  }

  async updateCustomerInfo(id, customerInfo, actorName = "system") {
    return this.updateUsers((users) => {
      const user = users.find((entry) => entry.id === id);
      if (!user) return null;
      const normalizedActor = String(actorName || "system").trim() || "system";
      const safeCustomerInfo = {};
      for (const [key, value] of Object.entries(customerInfo || {})) {
        if (typeof value === "string" || typeof value === "number") {
          safeCustomerInfo[key] = sanitizeTextValue(value, { maxLength: 300, allowEmpty: true, fieldName: key });
        }
      }
      user.customerInfo = { ...(user.customerInfo || {}), ...safeCustomerInfo };
      user.updatedBy = normalizedActor;
      user.updatedAt = new Date().toISOString();
      return user;
    });
  }

  async createUser(data) {
    return this.updateUsers((users) => {
      const cleanEmail = sanitizeTextValue(data.email, { maxLength: 254, fieldName: "Email" }).toLowerCase();
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
        name: sanitizeTextValue(data.name, { maxLength: 120, fieldName: "Họ tên" }),
        email: cleanEmail,
        password: hashPassword(data.password),
        passwordAuthEnabled: true,
        role: normalizedRole,
        isActive: true,
        studentType: sanitizeTextValue(data.studentType || "other", { maxLength: 32, allowEmpty: true, fieldName: "Loại học sinh" }) || "other",
        studentId: sanitizeTextValue(data.studentId || "", { maxLength: 64, allowEmpty: true, fieldName: "Mã sinh viên" }),
        customerInfo: {},
        createdBy: actorName,
        updatedBy: actorName,
        createdAt: now,
        updatedAt: now
      };
      users.push(newUser);
      return newUser;
    });
  }

  async findOrCreateSocialUser(data) {
    return this.updateUsers((users) => {
      const email = sanitizeTextValue(data.email || "", { maxLength: 254, fieldName: "Email" }).toLowerCase();
      const socialAccount = normalizeSocialAccount(data.authProvider, data.providerId);
      if (data.emailVerified !== true) {
        throw new CustomerError(401, "Thông tin tài khoản social chưa được xác minh.");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new CustomerError(400, "Email social không hợp lệ.");
      }
      const matches = users.filter((entry) => getSocialAccounts(entry).some((account) => (
        account.providerId === socialAccount.providerId
      )));
      if (matches.length > 1) {
        throw new CustomerError(409, "Không thể hoàn tất đăng nhập social. Hãy liên hệ hỗ trợ.");
      }
      let user = matches[0] || null;
      const now = new Date().toISOString();
      if (user) {
        if (user.isActive === false) {
          throw new CustomerError(403, "Tài khoản đã bị vô hiệu hóa.");
        }
        return user;
      }
      user = users.find((entry) => String(entry.email || "").toLowerCase() === email) || null;
      if (user) {
        throw new CustomerError(
          409,
          "Không thể hoàn tất đăng nhập social với thông tin đã cung cấp. Hãy đăng nhập bằng phương thức hiện tại để liên kết tài khoản.",
        );
      }
      const actor = sanitizeTextValue(data.authProvider || "social", { maxLength: 32, allowEmpty: true, fieldName: "Nhà cung cấp" }) || "social";
      const newUser = {
        id: crypto.randomUUID(),
        name: sanitizeTextValue(data.name || email.split("@")[0] || "Thành viên BookNest", { maxLength: 120, allowEmpty: true, fieldName: "Họ tên" }),
        email,
        password: hashPassword(crypto.randomBytes(24).toString("hex")),
        passwordAuthEnabled: false,
        role: ROLES.USER,
        isActive: true,
        studentType: sanitizeTextValue(data.studentType || "other", { maxLength: 32, allowEmpty: true, fieldName: "Loại học sinh" }) || "other",
        studentId: sanitizeTextValue(data.studentId || "", { maxLength: 64, allowEmpty: true, fieldName: "Mã sinh viên" }),
        authProvider: socialAccount.provider,
        providerId: socialAccount.providerId,
        socialAccounts: [socialAccount],
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

  async linkSocialAccount(userId, provider, providerId) {
    const socialAccount = normalizeSocialAccount(provider, providerId);
    return this.updateUsers((users) => {
      const matches = users.filter((entry) => getSocialAccounts(entry).some((account) => (
        account.providerId === socialAccount.providerId
      )));
      const user = users.find((entry) => entry.id === userId);
      if (!user || user.isActive === false || user.role === ROLES.ADMIN || matches.some((entry) => entry.id !== userId)) {
        throw new CustomerError(409, "Không thể hoàn tất liên kết tài khoản social.");
      }
      const accounts = getSocialAccounts(user);
      if (accounts.some((account) => (
        account.provider === socialAccount.provider &&
        account.providerId !== socialAccount.providerId
      ))) {
        throw new CustomerError(409, "Không thể hoàn tất liên kết tài khoản social.");
      }
      if (!accounts.some((account) => (
        account.provider === socialAccount.provider &&
        account.providerId === socialAccount.providerId
      ))) {
        accounts.push(socialAccount);
      }
      user.socialAccounts = accounts;
      if (!user.providerId) {
        user.authProvider = accounts[0].provider;
        user.providerId = accounts[0].providerId;
      }
      user.updatedAt = new Date().toISOString();
      return user;
    });
  }

  async unlinkSocialAccount(userId, provider) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (!SOCIAL_PROVIDERS.has(normalizedProvider)) {
      throw new CustomerError(400, "Nhà cung cấp social không hợp lệ.");
    }
    return this.updateUsers((users) => {
      const user = users.find((entry) => entry.id === userId);
      if (!user || user.isActive === false || user.role === ROLES.ADMIN) {
        throw new CustomerError(409, "Không thể hoàn tất thao tác với tài khoản social.");
      }
      const remainingAccounts = getSocialAccounts(user).filter(
        (account) => account.provider !== normalizedProvider,
      );
      if (remainingAccounts.length === getSocialAccounts(user).length) {
        throw new CustomerError(409, "Không thể hoàn tất thao tác với tài khoản social.");
      }
      user.socialAccounts = remainingAccounts;
      const primary = remainingAccounts[0];
      if (String(user.authProvider || "").toLowerCase() === normalizedProvider) {
        if (primary) {
          user.authProvider = primary.provider;
          user.providerId = primary.providerId;
        } else {
          delete user.authProvider;
          delete user.providerId;
        }
      }
      user.updatedAt = new Date().toISOString();
      return user;
    });
  }

  async getStaffUsers() {
    return (await this.getUsers())
      .filter((user) => ["sales", "support"].includes(user.role))
      .map(({ password, passwordAuthEnabled, passwordReset, ...user }) => user)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createStaffUser(data, actorId) {
    const actor = validateCustomerActor(actorId);
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
    const actor = validateCustomerActor(actorId);
    const updatedName = name === undefined
      ? undefined
      : sanitizeTextValue(name, { maxLength: 120, fieldName: "Họ tên" });
    const updatedEmail = email === undefined
      ? undefined
      : sanitizeTextValue(email, { maxLength: 254, fieldName: "Email" }).toLowerCase();
    if ((role !== undefined && !["sales", "support"].includes(role)) ||
        (isActive !== undefined && typeof isActive !== "boolean") ||
        (name === undefined && email === undefined && role === undefined && isActive === undefined)) {
      throw new CustomerError(400, "Cập nhật nhân viên không hợp lệ.");
    }
    return this.updateUsers((users) => {
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
      const { password, passwordAuthEnabled, passwordReset, ...safeUser } = user;
      return safeUser;
    });
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
    await atomicWriteFile(this.customersPath, JSON.stringify(customers, null, 2));
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

  async readCustomerInteractions() {
    try {
      const content = await fs.readFile(this.customerInteractionsPath, "utf8");
      const interactions = JSON.parse(content);
      if (!Array.isArray(interactions)) {
        throw new Error("Tệp lịch sử tương tác phải chứa một danh sách.");
      }
      return interactions;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      if (error instanceof SyntaxError) {
        throw new Error(`Tệp lịch sử tương tác bị hỏng: ${error.message}`);
      }
      throw error;
    }
  }

  async getCustomerInteractions(customerId, { page = 1, limit = 20 } = {}) {
    if (!await this.getCustomerById(customerId)) return null;
    const interactions = (await this.readCustomerInteractions())
      .filter((interaction) => interaction.customerId === customerId)
      .sort((left, right) => (
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.id.localeCompare(left.id)
      ));
    const offset = (page - 1) * limit;
    return {
      items: interactions.slice(offset, offset + limit),
      page,
      limit,
      total: interactions.length,
    };
  }

  async createCustomerInteraction(customerId, data, actorId) {
    const interactionData = validateCustomerInteractionData(data);
    const actor = validateCustomerActor(actorId);
    return this.enqueueFileWrite(this.customerInteractionsPath, async () => {
      if (!await this.getCustomerById(customerId)) return null;
      const interactions = await this.readCustomerInteractions();
      const now = new Date().toISOString();
      const interaction = {
        id: crypto.randomUUID(),
        customerId,
        ...interactionData,
        created_by: actor,
        createdAt: now,
        updated_by: actor,
        updatedAt: now,
      };
      interactions.push(interaction);
      await fs.mkdir(path.dirname(this.customerInteractionsPath), { recursive: true });
      await atomicWriteFile(
        this.customerInteractionsPath,
        JSON.stringify(interactions, null, 2),
      );
      return interaction;
    });
  }

  async updateCustomerInteraction(customerId, interactionId, data, actorId) {
    const interactionData = validateCustomerInteractionData(data, { partial: true });
    const actor = validateCustomerActor(actorId);
    return this.enqueueFileWrite(this.customerInteractionsPath, async () => {
      if (!await this.getCustomerById(customerId)) return null;
      const interactions = await this.readCustomerInteractions();
      const interaction = interactions.find((entry) => (
        entry.id === interactionId && entry.customerId === customerId
      ));
      if (!interaction) return null;
      Object.assign(interaction, interactionData, {
        updated_by: actor,
        updatedAt: new Date().toISOString(),
      });
      await atomicWriteFile(
        this.customerInteractionsPath,
        JSON.stringify(interactions, null, 2),
      );
      return interaction;
    });
  }

  async deleteCustomerInteraction(customerId, interactionId) {
    return this.enqueueFileWrite(this.customerInteractionsPath, async () => {
      if (!await this.getCustomerById(customerId)) return false;
      const interactions = await this.readCustomerInteractions();
      const index = interactions.findIndex((entry) => (
        entry.id === interactionId && entry.customerId === customerId
      ));
      if (index < 0) return false;
      interactions.splice(index, 1);
      await atomicWriteFile(
        this.customerInteractionsPath,
        JSON.stringify(interactions, null, 2),
      );
      return true;
    });
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

  async readCouponRecords() {
    try {
      const content = await fs.readFile(this.couponsPath, "utf8");
      const records = JSON.parse(content);
      if (!Array.isArray(records)) throw new Error("Tệp coupon phải chứa một danh sách.");
      return records;
    } catch (error) {
      if (error.code === "ENOENT") return DEFAULT_COUPONS.map((coupon) => ({ ...coupon }));
      if (error instanceof SyntaxError) {
        throw new Error(`Tệp coupon bị hỏng: ${error.message}`);
      }
      throw error;
    }
  }

  async getCoupons() {
    return this.readCouponRecords();
  }

  async saveCoupon(coupon, expectedUpdatedAt, createOnly = false) {
    return this.enqueueFileWrite(this.couponsPath, async () => {
      const coupons = await this.readCouponRecords();
      const index = coupons.findIndex((entry) => entry.code === coupon.code);
      const existing = index < 0 ? null : coupons[index];
      if (existing && createOnly) {
        throw new CustomerError(409, "Mã coupon đã tồn tại.");
      }
      if (expectedUpdatedAt !== undefined && (existing?.updatedAt || "") !== expectedUpdatedAt) {
        throw new CustomerError(409, "Coupon đã được cập nhật bởi người khác. Vui lòng tải lại dữ liệu.");
      }
      if (!existing && expectedUpdatedAt !== undefined) {
        throw new CustomerError(404, "Không tìm thấy coupon.");
      }
      if (existing && coupon.maxUses !== null && coupon.maxUses < existing.usedCount) {
        throw new CustomerError(409, "Giới hạn lượt dùng không thể thấp hơn số lượt đã sử dụng.");
      }
      const now = new Date().toISOString();
      const saved = {
        ...existing,
        ...coupon,
        usedCount: existing?.usedCount || 0,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      if (index < 0) coupons.push(saved);
      else coupons[index] = saved;
      await fs.mkdir(path.dirname(this.couponsPath), { recursive: true });
      await atomicWriteFile(this.couponsPath, JSON.stringify(coupons, null, 2));
      return saved;
    });
  }

  async redeemCoupon(code, subtotal, now = Date.now(), expectedRate) {
    return this.enqueueFileWrite(this.couponsPath, async () => {
      const coupons = await this.readCouponRecords();
      const coupon = coupons.find((entry) => entry.code === code);
      const reason = getCouponUnavailableReason(coupon, { subtotal, now });
      if (reason) throw new CustomerError(409, reason);
      if (expectedRate !== undefined && coupon.rate !== expectedRate) {
        throw new CustomerError(409, "Điều kiện coupon vừa được cập nhật. Vui lòng tải lại báo giá.");
      }
      coupon.usedCount += 1;
      await fs.mkdir(path.dirname(this.couponsPath), { recursive: true });
      await atomicWriteFile(this.couponsPath, JSON.stringify(coupons, null, 2));
      return coupon;
    });
  }

  async releaseCoupon(code) {
    return this.enqueueFileWrite(this.couponsPath, async () => {
      const coupons = await this.readCouponRecords();
      const coupon = coupons.find((entry) => entry.code === code);
      if (!coupon) return false;
      coupon.usedCount = Math.max(0, coupon.usedCount - 1);
      await fs.mkdir(path.dirname(this.couponsPath), { recursive: true });
      await atomicWriteFile(this.couponsPath, JSON.stringify(coupons, null, 2));
      return true;
    });
  }

  async addOrder(order, ordersPathOverride) {
    const filePath = ordersPathOverride || this.ordersPath;
    return this.enqueueFileWrite(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const existingOrders = await this.getAllOrders(filePath);
      const duplicate = existingOrders.find((entry) => (
        entry.orderId === order.orderId ||
        (order.idempotencyKey && entry.idempotencyKey === order.idempotencyKey)
      ));
      if (duplicate) return duplicate;
      await fs.appendFile(filePath, `${JSON.stringify(order)}\n`, "utf8");
      return order;
    });
  }

  async findOrderById(orderId, ordersPathOverride) {
    const orders = await this.getAllOrders(ordersPathOverride);
    return orders.find((order) => order.orderId === orderId) || null;
  }

  async updateOrderStatus(orderId, payload, ordersPathOverride, options = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }

    const { status, paymentStatus } = payload;
    const filePath = ordersPathOverride || this.ordersPath;
    if (Object.keys(payload).some((field) => !["status", "paymentStatus", "items"].includes(field))) {
      throw new CustomerError(400, "Dữ liệu cập nhật đơn hàng không hợp lệ.");
    }
    if (status !== undefined && !allowedOrderStatuses.has(String(status).trim())) {
      throw new Error("Trạng thái đơn hàng không hợp lệ.");
    }
    if (paymentStatus !== undefined && !allowedPaymentStatuses.has(String(paymentStatus).trim())) {
      throw new Error("Trạng thái thanh toán không hợp lệ.");
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
    }

    return this.enqueueFileWrite(filePath, async () => {
      let content;
      try {
        content = await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }

      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      const orders = [];
      const parsedLines = lines.map((line) => {
        try {
          const order = JSON.parse(line);
          if (order && order.orderId) orders.push(order);
          return order;
        } catch {
          return null;
        }
      });
      let updatedOrder = null;
      const nextLines = lines.map((line, index) => {
        const order = parsedLines[index];
        if (order && order.orderId === orderId) {
          if (
            status !== undefined &&
            !isOrderStatusTransitionAllowed(order.status, status)
          ) {
            throw new CustomerError(400, "Không thể chuyển trạng thái đơn hàng.");
          }
          if (payload.items !== undefined) {
            if (order.status === "cancelled" || status === "cancelled") {
              throw new CustomerError(409, "Không thể cập nhật sản phẩm của đơn hàng đã hủy.");
            }
            if (typeof options.validateOrder === "function") {
              options.validateOrder(orders, order);
            }
            order.items = payload.items;
            order.subtotal = options.totals.subtotal;
            order.discount = options.totals.discount;
            order.total = options.totals.total;
          }
          if (status) order.status = status;
          if (paymentStatus) order.paymentStatus = paymentStatus;
          order.updatedAt = new Date().toISOString();
          updatedOrder = order;
          return JSON.stringify(order);
        }
        return line;
      });

      if (!updatedOrder) return null;
      await atomicWriteFile(filePath, `${nextLines.join("\n")}\n`);
      return updatedOrder;
    });
  }

  // --- Service Requests (Thuê / Thu mua / Trao đổi sách) ---
  async addServiceRequest(request) {
    await this.init();
    const serviceType = sanitizeTextValue(request.service || "", { maxLength: 32, fieldName: "Loại dịch vụ" });
    if (!allowedServiceTypes.has(serviceType)) {
      throw new Error("Loại dịch vụ không hợp lệ.");
    }
    const entry = {
      id: crypto.randomUUID(),
      service: serviceType,
      bookTitle: sanitizeTextValue(request.bookTitle || "", { maxLength: 200, fieldName: "Tên sách" }),
      condition: sanitizeTextValue(request.condition || "", { maxLength: 64, allowEmpty: true, fieldName: "Tình trạng sách" }),
      name: sanitizeTextValue(request.name || "", { maxLength: 120, fieldName: "Tên khách hàng" }),
      phone: sanitizeTextValue(request.phone || "", { maxLength: 20, fieldName: "Số điện thoại" }),
      note: sanitizeTextValue(request.note || "", { maxLength: 500, allowEmpty: true, fieldName: "Ghi chú" }),
      status: "pending", // pending, processing, completed, cancelled
      createdAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(this.servicesPath), { recursive: true });
    await this.enqueueFileWrite(this.servicesPath, async () => {
      await fs.mkdir(path.dirname(this.servicesPath), { recursive: true });
      await fs.appendFile(this.servicesPath, `${JSON.stringify(entry)}\n`, "utf8");
    });
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
    await this.enqueueFileWrite(this.servicesPath, () =>
      atomicWriteFile(this.servicesPath, newLines.join("\n") + "\n"),
    );
    return updated;
  }

  // --- Custom Books & Catalog Extensions ---
  async readBookRecords() {
    await this.init();
    let content;
    try {
      content = await fs.readFile(this.booksPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    let records;
    try {
      records = JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
    return Array.isArray(records) ? records : [];
  }

  async getCustomBooks() {
    return (await this.readBookRecords()).filter((book) => !book.catalogOverride);
  }

  async getCatalogBookOverrides() {
    return (await this.readBookRecords()).filter((book) => book.catalogOverride);
  }

  async updateCatalogBook(id, book, expectedUpdatedAt, baseBook) {
    return this.enqueueFileWrite(this.booksPath, async () => {
      const records = await this.readBookRecords();
      const index = records.findIndex(
        (record) => record.catalogOverride && record.id === id,
      );
      const stored = index < 0 ? null : records[index];
      const current = stored || baseBook;
      if (expectedUpdatedAt !== undefined && (stored?.updatedAt || "") !== expectedUpdatedAt) {
        throw new CustomerError(409, "Sách đã được cập nhật bởi người khác. Vui lòng tải lại dữ liệu.");
      }

      const now = new Date().toISOString();
      const updated = {
        ...current,
        ...book,
        id,
        catalogOverride: true,
        createdAt: current?.createdAt || now,
        updatedAt: now,
      };
      if (index < 0) records.push(updated);
      else records[index] = updated;
      await atomicWriteFile(this.booksPath, JSON.stringify(records, null, 2));
      return updated;
    });
  }

  async addCustomBook(book) {
    return this.enqueueFileWrite(this.booksPath, async () => {
      const books = await this.readBookRecords();
      const newBook = {
        id: crypto.randomUUID(),
        title: sanitizeTextValue(book.title || "", { maxLength: 200, fieldName: "Tên sách" }),
        author: sanitizeTextValue(book.author || "", { maxLength: 200, fieldName: "Tác giả" }),
        category: sanitizeTextValue(book.category || "", { maxLength: 64, allowEmpty: true, fieldName: "Thể loại" }) || "van-hoc",
        price: Number(book.price) || 0,
        stock: Number.isInteger(book.stock) ? book.stock : 12,
        cover: sanitizeTextValue(book.cover || "", { maxLength: 500, allowEmpty: true, fieldName: "Link ảnh bìa" }) || "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80",
        description: sanitizeTextValue(book.description || "", { maxLength: 1000, allowEmpty: true, fieldName: "Mô tả" }),
        createdAt: new Date().toISOString()
      };
      books.push(newBook);
      await atomicWriteFile(this.booksPath, JSON.stringify(books, null, 2));
      return newBook;
    });
  }

  async updateCustomBook(id, updateData, expectedUpdatedAt) {
    return this.enqueueFileWrite(this.booksPath, async () => {
      const records = await this.readBookRecords();
      const index = records.findIndex(
        (book) => !book.catalogOverride && (book.id === id || book.title === id),
      );
      if (index === -1) return null;
      const current = records[index];
      if (expectedUpdatedAt !== undefined && (current.updatedAt || "") !== expectedUpdatedAt) {
        throw new CustomerError(409, "Sách đã được cập nhật bởi người khác. Vui lòng tải lại dữ liệu.");
      }
      const safeUpdate = { ...updateData };
      if (safeUpdate.title !== undefined) safeUpdate.title = sanitizeTextValue(safeUpdate.title, { maxLength: 200, fieldName: "Tên sách" });
      if (safeUpdate.author !== undefined) safeUpdate.author = sanitizeTextValue(safeUpdate.author, { maxLength: 200, fieldName: "Tác giả" });
      if (safeUpdate.category !== undefined) safeUpdate.category = sanitizeTextValue(safeUpdate.category, { maxLength: 64, allowEmpty: true, fieldName: "Thể loại" }) || "van-hoc";
      if (safeUpdate.description !== undefined) safeUpdate.description = sanitizeTextValue(safeUpdate.description, { maxLength: 1000, allowEmpty: true, fieldName: "Mô tả" });
      if (safeUpdate.cover !== undefined) safeUpdate.cover = sanitizeTextValue(safeUpdate.cover, { maxLength: 500, allowEmpty: true, fieldName: "Link ảnh bìa" }) || "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80";
      records[index] = {
        ...current,
        ...safeUpdate,
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteFile(this.booksPath, JSON.stringify(records, null, 2));
      return records[index];
    });
  }

  async deleteCustomBook(id) {
    return this.enqueueFileWrite(this.booksPath, async () => {
      const records = await this.readBookRecords();
      const nextRecords = records.filter(
        (book) => book.catalogOverride || (book.id !== id && book.title !== id),
      );
      if (nextRecords.length === records.length) return false;
      await atomicWriteFile(this.booksPath, JSON.stringify(nextRecords, null, 2));
      return true;
    });
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

module.exports = {
  CustomerError,
  Database,
  getSocialAccounts,
  isOrderStatusTransitionAllowed,
  normalizeSocialAccount,
  SOCIAL_PROVIDERS,
  validateCustomerActor,
  validateCustomerInteractionData,
  validateCustomerData,
};
