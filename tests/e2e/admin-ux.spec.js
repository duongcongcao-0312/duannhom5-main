const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const adminHtml = fs.readFileSync(path.join(__dirname, "../../admin.html"), "utf8")
  .replace(/<link rel="stylesheet"[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const adminCss = fs.readFileSync(path.join(__dirname, "../../admin.css"), "utf8");
const toastCss = fs.readFileSync(path.join(__dirname, "../../assets/toast.css"), "utf8");
const toastScript = fs.readFileSync(path.join(__dirname, "../../assets/toast.js"), "utf8");
const adminScript = fs.readFileSync(path.join(__dirname, "../../admin.js"), "utf8");

const order = {
  orderId: "order-ux-1",
  createdAt: "2026-01-15T10:00:00.000Z",
  customerName: "Test Customer",
  phone: "0900000000",
  address: "Test address",
  items: [],
  paymentMethod: "cod",
  paymentStatus: "pending",
  total: 100000,
  status: "received",
};

async function defaultApiHandler(url) {
  if (url === "/api/auth/me") {
    return { body: { user: { role: "admin", name: "E2E Admin" } } };
  }
  if (url === "/api/admin/stats") {
    return {
      body: {
        totalRevenue: 0,
        totalOrders: 0,
        totalBooks: 0,
        totalUsers: 0,
        recentOrders: [],
      },
    };
  }
  if (url === "/api/admin/monitoring") {
    return {
      body: {
        generatedAt: "2026-01-15T10:00:00.000Z",
        uptimeSeconds: 1,
        requests: {
          serverErrorsLast5m: 0,
          requestsLast5m: 0,
          errorRatePct: 0,
          p95LatencyMs: 0,
          payments: {
            webhookFailuresLast5m: 0,
            webhookConflictsLast5m: 0,
            orderConflictsLast5m: 0,
            webhookRequestsLast5m: 0,
            duplicatesSinceStart: 0,
          },
        },
        database: { status: "healthy", storage: "memory" },
        backup: { status: "none", lastAttemptAt: null },
      },
    };
  }
  if (url === "/api/admin/orders") return { body: [] };
  if (url === "/api/admin/categories") return { body: [] };
  return { body: [] };
}

async function openAdmin(page, apiHandler = defaultApiHandler) {
  await page.setContent(adminHtml);
  await page.addStyleTag({ content: adminCss });
  await page.addStyleTag({ content: toastCss });
  await page.exposeFunction("__adminApiRequest", apiHandler);
  await page.addScriptTag({
    content: `
      window.__adminApiCalls = [];
      window.booknestAuth = {
        getToken: () => "test-admin-token",
        setToken: () => {},
        clearToken: () => {}
      };
      window.booknestApiFetch = async (url, options = {}) => {
        window.__adminApiCalls.push({ url, method: options.method || "GET" });
        const result = await window.__adminApiRequest(url, options);
        if (result.throw === "offline") throw new TypeError("Failed to fetch");
        if (result.throw === "timeout") throw new DOMException("Request timed out", "AbortError");
        return new Response(JSON.stringify(result.body), {
          status: result.status || 200,
          headers: { "Content-Type": "application/json" }
        });
      };
    `,
  });
  await page.addScriptTag({ content: toastScript });
  await page.addScriptTag({ content: adminScript });
  await expect(page.locator("#adminUserName")).toHaveText("E2E Admin");
}

test("admin navigation exposes skip-link focus and keyboard-selected views", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-safari", "iPhone viewport emulation does not provide hardware-keyboard Tab traversal");
  await openAdmin(page);

  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toHaveAttribute("href", "#adminMain");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("outline-style", "solid");
  await expect(skipLink).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Enter");
  await expect(page.locator("#adminMain")).toBeFocused();

  const ordersTab = page.locator('.nav-tab[data-view="orders"]');
  await ordersTab.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#viewOrders")).toHaveClass(/active/);
  await expect(ordersTab).toHaveAttribute("aria-current", "page");
});

test("admin navigation and tables remain horizontally reachable on portrait and landscape screens", async ({ page }) => {
  const longOrder = { ...order, customerName: "UnbrokenCustomerName".repeat(12) };
  await openAdmin(page, async (url) => {
    if (url === "/api/admin/orders") return { body: [longOrder] };
    return defaultApiHandler(url);
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const navigation = page.locator("#adminNav");
    const navSize = await navigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(navSize.scrollWidth).toBeGreaterThan(navSize.clientWidth);
    await navigation.locator(".nav-tab").last().scrollIntoViewIfNeeded();
    expect(await navigation.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await page.locator('.nav-tab[data-view="orders"]').click();
    const tableScroller = page.locator("#viewOrders .table-responsive").first();
    const tableSize = await tableScroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tableSize.scrollWidth).toBeGreaterThan(tableSize.clientWidth);
    await tableScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    expect(await tableScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
  }
});

test("admin list announces delayed loading and distinguishes a successful empty result", async ({ page }) => {
  let releaseOrders;
  let markOrdersRequested;
  const ordersGate = new Promise((resolve) => { releaseOrders = resolve; });
  const requested = new Promise((resolve) => { markOrdersRequested = resolve; });
  const apiHandler = async (url) => {
    if (url === "/api/admin/orders") {
      markOrdersRequested();
      await ordersGate;
      return { body: [] };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="orders"]').click();
  await requested;

  const tbody = page.locator("#ordersTableBody");
  await expect(tbody).toHaveAttribute("aria-busy", "true");
  await expect(tbody.locator('[role="status"][data-state="loading"]')).toContainText("Đang tải đơn hàng");
  releaseOrders();

  await expect(tbody).toHaveAttribute("aria-busy", "false");
  await expect(tbody.locator('[role="status"][data-state="empty"]')).toContainText("Chưa có đơn hàng");
});

for (const failure of [
  { name: "offline", result: { throw: "offline" }, message: /kết nối|mạng/i },
  { name: "timeout", result: { status: 408, body: {} }, message: /quá thời gian|thử lại/i },
  { name: "server", result: { status: 503, body: {} }, message: /máy chủ|thử lại/i },
  { name: "permission", result: { status: 403, body: {} }, message: /quyền|đăng nhập/i },
]) {
  test(`admin list reports ${failure.name} as a recoverable error`, async ({ page }) => {
    const apiHandler = async (url) => {
      if (url === "/api/admin/orders") return failure.result;
      return defaultApiHandler(url);
    };
    await openAdmin(page, apiHandler);
    await page.locator('.nav-tab[data-view="orders"]').click();

    const state = page.locator('#ordersTableBody [data-state="error"]');
    await expect(state).toContainText(failure.message);
    await expect(state).toHaveAttribute("role", "alert");
    await expect(page.locator("#ordersTableBody")).toHaveAttribute("aria-busy", "false");
    await expect(state.getByRole("button", { name: /thử lại/i })).toBeVisible();
    await expect(page.locator("#toastContainer .toast--success")).toHaveCount(0);
  });
}

test("order status updates announce progress, block duplicate requests, and confirm only after success", async ({ page }) => {
  let releaseUpdate;
  let markUpdateRequested;
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const updateRequested = new Promise((resolve) => { markUpdateRequested = resolve; });
  const apiHandler = async (url, options = {}) => {
    if (url === "/api/admin/orders") return { body: [order] };
    if (url === `/api/admin/orders/${order.orderId}` && options.method === "PATCH") {
      markUpdateRequested();
      await updateGate;
      return { body: { ...order, status: "processing" } };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="orders"]').click();
  const statusSelect = page.locator(`.order-status-select[data-id="${order.orderId}"]`);
  await statusSelect.selectOption("processing");
  await updateRequested;

  await expect(statusSelect).toBeDisabled();
  await expect(statusSelect).toHaveAttribute("aria-busy", "true");
  await statusSelect.evaluate((select) => select.dispatchEvent(new Event("change", { bubbles: true })));
  await expect.poll(() => page.evaluate(() =>
    window.__adminApiCalls.filter((call) =>
      call.url === "/api/admin/orders/order-ux-1" && call.method === "PATCH").length,
  )).toBe(1);

  releaseUpdate();
  await expect(page.locator("#toastContainer .toast--success")).toContainText("Đã cập nhật trạng thái đơn");
  await expect(page.locator(`.order-status-select[data-id="${order.orderId}"]`)).toBeEnabled();
  await expect(page.locator("#ordersTableBody")).toContainText("processing");
});

test("staff role updates keep role options available while the request is pending", async ({ page }) => {
  let releaseUpdate;
  let markUpdateRequested;
  let role = "sales";
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const updateRequested = new Promise((resolve) => { markUpdateRequested = resolve; });
  const apiHandler = async (url, options = {}) => {
    if (url === "/api/admin/staff/staff-ux-1" && options.method === "PATCH") {
      role = JSON.parse(options.body).role;
      markUpdateRequested();
      await updateGate;
      return { body: { id: "staff-ux-1", role } };
    }
    if (url === "/api/admin/staff") {
      return {
        body: {
          staff: [{ id: "staff-ux-1", name: "Test Staff", email: "staff@example.test", role, isActive: true }],
          rolePermissions: { sales: [], support: [] },
        },
      };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="users"]').click();
  const roleSelect = page.locator('.staff-role-select[data-id="staff-ux-1"]');
  await roleSelect.selectOption("support");
  await updateRequested;

  await expect(roleSelect).toBeDisabled();
  await expect(roleSelect).toHaveAttribute("aria-busy", "true");
  await expect(roleSelect.locator("option")).toHaveCount(2);
  await expect(roleSelect).toHaveValue("support");

  releaseUpdate();
  await expect(page.locator('.staff-role-select[data-id="staff-ux-1"]')).toHaveValue("support");
});

test("category form announces saving, rejects duplicate submits, and closes after success", async ({ page }) => {
  let releaseCreate;
  let markCreateRequested;
  let createRequests = 0;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const createRequested = new Promise((resolve) => { markCreateRequested = resolve; });
  const apiHandler = async (url, options = {}) => {
    if (url === "/api/admin/categories" && options.method === "POST") {
      createRequests += 1;
      markCreateRequested();
      await createGate;
      return { body: { slug: "philosophy" } };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="categories"]').click();
  await page.locator("#openAddCategoryBtn").click();
  const form = page.locator("#categoryForm");
  await form.locator('[name="name"]').fill("Triết học");
  await form.locator('[name="categorySlug"]').fill("triet-hoc");
  const submit = form.locator('button[type="submit"]');
  await submit.click();
  await createRequested;

  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(submit).toBeDisabled();
  await form.evaluate((element) => element.dispatchEvent(new Event("submit", {
    bubbles: true,
    cancelable: true,
  })));
  expect(createRequests).toBe(1);

  releaseCreate();
  await expect(page.locator("#categoryModal")).not.toHaveAttribute("open", "");
  await expect(submit).toBeEnabled();
  await expect(page.locator("#toastContainer .toast--success")).toContainText("Đã tạo danh mục");
});

test("failed order status updates restore the saved status and show no success notification", async ({ page }) => {
  const apiHandler = async (url, options = {}) => {
    if (url === "/api/admin/orders") return { body: [order] };
    if (url === `/api/admin/orders/${order.orderId}` && options.method === "PATCH") {
      return { status: 503, body: {} };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="orders"]').click();
  const statusSelect = page.locator(`.order-status-select[data-id="${order.orderId}"]`);
  await statusSelect.selectOption("processing");

  await expect(page.locator("#toastContainer .toast--error")).toContainText(/Máy chủ.*trạng thái đơn hàng/i);
  await expect(page.locator("#ordersTableBody .status-badge")).toHaveText("received");
  await expect(page.locator("#toastContainer .toast--success")).toHaveCount(0);
  await expect(page.locator(`.order-status-select[data-id="${order.orderId}"]`)).toBeEnabled();
});

test("dashboard refresh only reports success after the statistics request succeeds", async ({ page }) => {
  let statsRequests = 0;
  const apiHandler = async (url) => {
    if (url === "/api/admin/stats") {
      statsRequests += 1;
      return statsRequests === 1
        ? defaultApiHandler(url)
        : { status: 503, body: {} };
    }
    return defaultApiHandler(url);
  };

  await openAdmin(page, apiHandler);
  await expect.poll(() => statsRequests).toBe(1);
  await page.locator("#refreshStatsBtn").click();

  await expect(page.locator("#toastContainer .toast--error")).toContainText(/máy chủ|thử lại/i);
  await expect(page.locator("#toastContainer .toast--success")).toHaveCount(0);
  await expect(page.locator("#refreshStatsBtn")).toBeEnabled();
});

test("cancelling a destructive category action sends no delete request", async ({ page }) => {
  const apiHandler = async (url) => {
    if (url === "/api/admin/categories") {
      return {
        body: [{ name: "Văn học", label: "Văn học", slug: "van-hoc", status: "active" }],
      };
    }
    return defaultApiHandler(url);
  };
  await openAdmin(page, apiHandler);
  await page.locator('.nav-tab[data-view="categories"]').click();
  let confirmationMessage = "";
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    confirmationMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.locator(".delete-category-btn").click();
  expect(confirmationMessage).toContain("Xóa danh mục này");

  await expect.poll(() => page.evaluate(() =>
    window.__adminApiCalls.filter((call) => call.method === "DELETE").length,
  )).toBe(0);
  await expect(page.locator("#toastContainer .toast--success")).toHaveCount(0);
});
