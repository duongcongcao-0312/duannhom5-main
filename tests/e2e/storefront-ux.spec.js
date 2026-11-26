const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const storefrontHtml = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8")
  .replace(/<link rel="stylesheet"[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const detailHtml = fs.readFileSync(path.join(__dirname, "../../book.html"), "utf8")
  .replace(/<link rel="stylesheet"[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const storefrontCss = fs.readFileSync(path.join(__dirname, "../../main.css"), "utf8");
const toastCss = fs.readFileSync(path.join(__dirname, "../../assets/toast.css"), "utf8");
const toastScript = fs.readFileSync(path.join(__dirname, "../../assets/toast.js"), "utf8");
const vietQrScript = fs.readFileSync(path.join(__dirname, "../../assets/vietqr.js"), "utf8");
const bookDataScript = fs.readFileSync(path.join(__dirname, "../../books-data.js"), "utf8");
const storefrontScript = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
const bookDetailScript = fs.readFileSync(path.join(__dirname, "../../book-detail.js"), "utf8");

const apiBooks = [
  {
    title: "Orange Book",
    author: "Api Writer",
    price: 120000,
    category: "van-hoc",
    stock: 5,
    tag: "featured",
    image: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  },
  {
    title: "Green Book",
    author: "Api Writer",
    price: 80000,
    category: "kinh-te",
    stock: 5,
    tag: "featured",
    image: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  },
];

const remoteBook = {
  id: "remote-book-1",
  title: "Remote Book",
  author: "Api Writer",
  publisher: "BookNest Press",
  price: 135000,
  category: "van-hoc",
  description: "A description from the catalog API.",
  stock: 0,
  isbn: "978-1-23456-789-0",
  images: [
    { url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="red"/></svg>')}`, alt: "Red cover" },
    { url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="blue"/></svg>')}`, alt: "Blue cover" },
  ],
};
const cartBookTitle = "Nhà giả kim";
const cartBookPrice = 89000;

async function defaultApiHandler(url) {
  if (url.startsWith("/api/books")) {
    return { body: apiBooks, headers: { "x-pagination": JSON.stringify({ totalPages: 1 }) } };
  }
  if (url === "/api/categories") {
    return {
      body: [
        { slug: "van-hoc", label: "Văn học", status: "active" },
        { slug: "kinh-te", label: "Kinh tế", status: "active" },
      ],
    };
  }
  if (url === "/api/payments/config") {
    return {
      body: { bankCode: "970415", bankName: "Test Bank", accountNumber: "1234567890", accountName: "BookNest Test" },
    };
  }
  return { body: {} };
}

function validCartQuote(items) {
  const subtotal = items.reduce((total, item) => total + cartBookPrice * item.quantity, 0);
  return {
    subtotal,
    discount: 0,
    total: subtotal,
    discountRate: 0,
    items: items.map((item) => ({ title: item.title, lineTotal: cartBookPrice * item.quantity })),
  };
}

async function cartApiHandler(url, options = {}) {
  if (url === "/api/orders/quote") {
    const request = JSON.parse(options.body || "{}");
    return { body: validCartQuote(request.items || []) };
  }
  return defaultApiHandler(url);
}

async function openStorefront(page, apiHandler = defaultApiHandler, apiBaseUrl = "http://localhost:8000", prepareStorage) {
  await page.route("https://covers.openlibrary.org/**", (route) => route.abort());
  await page.route("http://booknest.test/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: storefrontHtml,
  }));
  await page.goto("http://booknest.test/index.html");
  if (prepareStorage) await page.evaluate(prepareStorage);
  await page.addStyleTag({ content: storefrontCss });
  await page.addStyleTag({ content: toastCss });
  await page.exposeFunction("__storefrontApiRequest", apiHandler);
  await page.addScriptTag({
    content: `
      window.__storefrontApiCalls = [];
      window.BOOKNEST_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};
      window.booknestAuth = {
        getToken: () => null,
        setToken: () => {},
        clearToken: () => {}
      };
      window.booknestApiFetch = async (url, options = {}) => {
        window.__storefrontApiCalls.push({ url, method: options.method || "GET" });
        const result = await window.__storefrontApiRequest(url, options);
        if (result.throw === "offline") throw new TypeError("Failed to fetch");
        if (result.throw === "timeout") throw new DOMException("Request timed out", "AbortError");
        return new Response(JSON.stringify(result.body), {
          status: result.status || 200,
          headers: { "Content-Type": "application/json", ...(result.headers || {}) }
        });
      };
    `,
  });
  await page.addScriptTag({ content: toastScript });
  await page.addScriptTag({ content: vietQrScript });
  await page.addScriptTag({ content: bookDataScript });
  await page.addScriptTag({ content: storefrontScript });
}

async function openCartWithSavedBook(page, apiHandler = cartApiHandler) {
  await openStorefront(page, apiHandler, "", () => {
    localStorage.setItem("booknest-cart", JSON.stringify(["Nhà giả kim"]));
  });
}

async function openBookDetail(page, apiHandler, title = remoteBook.title) {
  await page.route("http://booknest.test/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml,
  }));
  await page.goto(`http://booknest.test/book.html?title=${encodeURIComponent(title)}`);
  await page.addStyleTag({ content: storefrontCss });
  await page.addStyleTag({ content: toastCss });
  await page.exposeFunction("__bookDetailApiRequest", apiHandler);
  await page.addScriptTag({
    content: `
      window.BOOKNEST_API_BASE_URL = "http://localhost:8000";
      window.booknestAuth = { getToken: () => null };
      window.booknestApiFetch = async (url, options = {}) => {
        const result = await window.__bookDetailApiRequest(url, options);
        if (result.throw === "offline") throw new TypeError("Failed to fetch");
        if (result.throw === "timeout") throw new DOMException("Request timed out", "AbortError");
        return new Response(JSON.stringify(result.body), {
          status: result.status || 200,
          headers: { "Content-Type": "application/json", ...(result.headers || {}) }
        });
      };
    `,
  });
  await page.addScriptTag({ content: toastScript });
  await page.addScriptTag({ content: bookDataScript });
  await page.addScriptTag({ content: bookDetailScript });
}

test("catalog announces loading while configured API data is pending", async ({ page }) => {
  let releaseCatalog;
  let markCatalogRequested;
  const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
  const catalogRequested = new Promise((resolve) => { markCatalogRequested = resolve; });
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books")) {
      markCatalogRequested();
      await catalogGate;
      return { body: [apiBooks[0]] };
    }
    return defaultApiHandler(url);
  };

  await openStorefront(page, apiHandler);
  await catalogRequested;
  await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#catalogStatus")).toContainText(/đang tải/i);
  await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);

  releaseCatalog();
  await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#bookGrid")).toContainText("Orange Book");
});

test("catalog distinguishes a successful empty API response from static fallback", async ({ page }) => {
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books")) return { body: [] };
    if (url === "/api/categories") return { body: [] };
    return defaultApiHandler(url);
  };

  await openStorefront(page, apiHandler);
  await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "empty");
  await expect(page.locator("#catalogStatus")).toContainText(/chưa có sách/i);
  await expect(page.locator("#bookGrid .book-card")).toHaveCount(0);
});

for (const failure of [
  { name: "offline", result: { throw: "offline" }, message: /kết nối|mạng/i },
  { name: "timeout", result: { throw: "timeout" }, message: /quá thời gian|phản hồi|thử lại/i },
  { name: "server", result: { status: 503, body: {} }, message: /máy chủ|thử lại/i },
  { name: "permission", result: { status: 403, body: {} }, message: /quyền|đăng nhập/i },
]) {
  test(`catalog labels its static fallback and retries after ${failure.name}`, async ({ page }) => {
    let attempts = 0;
    const apiHandler = async (url) => {
      if (url.startsWith("/api/books")) {
        attempts += 1;
        if (attempts === 1) return failure.result;
        return { body: [apiBooks[0]] };
      }
      return defaultApiHandler(url);
    };

    await openStorefront(page, apiHandler);
    const status = page.locator("#catalogStatus");
    await expect(status).toHaveAttribute("data-state", "error");
    await expect(status).toContainText(failure.message);
    await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
    await expect(status.getByRole("button", { name: /thử lại/i })).toBeVisible();

    await status.getByRole("button", { name: /thử lại/i }).click();
    await expect(status).toHaveAttribute("data-state", "ready");
    await expect(page.locator("#bookGrid")).toContainText("Orange Book");
    expect(attempts).toBe(2);
  });
}

test("intentionally unconfigured API keeps the static catalog without making a request", async ({ page }) => {
  await openStorefront(page, defaultApiHandler, "");

  await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "static");
  await expect(page.locator("#catalogStatus")).toContainText(/mẫu|tĩnh/i);
  await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  await expect(page.locator("#bookCount")).toHaveText("80");
  expect(await page.evaluate(() => window.__storefrontApiCalls)).toEqual([]);
});

test("catalog search, category selection, and product detail links stay connected", async ({ page }) => {
  await openStorefront(page);
  await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "ready");

  const mobileNavToggle = page.locator("#mobileNavToggle");
  if (await mobileNavToggle.isVisible()) await mobileNavToggle.click();
  await expect(page.locator('.main-nav a[href="#books"]')).toBeVisible();
  await expect(page.locator('.main-nav a[href="#categories"]')).toBeVisible();
  await expect(page.locator("#bookGrid .details-link").first()).toHaveAttribute("href", /book\.html\?/);

  await page.locator("#searchInput").fill("Orange Book");
  await expect(page.locator("#bookGrid .book-card")).toHaveCount(1);
  await expect(page.locator("#bookGrid")).toContainText("Orange Book");

  await page.locator("#searchInput").fill("");
  await page.locator("#categoryFilter").selectOption("kinh-te");
  await expect(page.locator("#bookGrid .book-card")).toHaveCount(1);
  await expect(page.locator("#bookGrid")).toContainText("Green Book");
});

test("mobile navigation opens from the keyboard and Escape returns focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-safari", "iPhone viewport emulation does not provide hardware-keyboard Tab traversal");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStorefront(page, defaultApiHandler, "");

  const toggle = page.locator("#mobileNavToggle");
  const navigation = page.locator("#mainNavigation");
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("mobile navigation remains operable by touch in the iPhone profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-safari", "Touch navigation is exercised in the iPhone profile");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStorefront(page, defaultApiHandler, "");

  const toggle = page.locator("#mobileNavToggle");
  const navigation = page.locator("#mainNavigation");
  await toggle.click();
  await expect(navigation).toBeVisible();
  await navigation.locator('a[href="#books"]').click();
  await expect(page).toHaveURL(/#books$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("catalog no-match results can reset the filters", async ({ page }) => {
  await openStorefront(page, defaultApiHandler, "");
  const search = page.locator("#searchInput");
  await search.fill("No such book");
  await expect(page.locator("#emptyState")).toBeVisible();
  await page.locator("#emptyState").getByRole("button", { name: /đặt lại bộ lọc/i }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
});

test("empty favorite results can clear the favorites filter", async ({ page }) => {
  await openStorefront(page, defaultApiHandler, "");
  await page.locator("#favoritesFilter").click();
  await expect(page.locator("#emptyState")).toBeVisible();
  await page.locator("#emptyState").getByRole("button", { name: /bỏ lọc yêu thích/i }).click();
  await expect(page.locator("#favoritesFilter")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
});

test("book details expose API metadata and disable purchases for out-of-stock books", async ({ page }) => {
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
    if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
    if (url.endsWith("/related")) return { body: [] };
    return { body: {} };
  };
  await openBookDetail(page, apiHandler);

  const detail = page.locator("#bookDetail");
  await expect(detail.getByRole("heading", { name: "Remote Book" })).toBeVisible();
  await expect(detail.locator(".detail-author")).toContainText("Api Writer");
  await expect(detail.locator(".detail-publisher")).toContainText("BookNest Press");
  await expect(detail.locator(".detail-price")).toContainText("135.000");
  await expect(detail.locator(".detail-description")).toHaveText(remoteBook.description);
  await expect(detail.locator(".detail-isbn")).toContainText(remoteBook.isbn);
  await expect(detail.locator(".detail-stock")).toContainText(/hết hàng/i);
  await expect(detail.locator("#buyBook")).toBeDisabled();
});

test("API metadata replaces static book details without losing inventory or publisher", async ({ page }) => {
  const updatedBook = {
    ...remoteBook,
    title: "Nhà giả kim",
    author: "Updated Writer",
    publisher: "Updated Press",
    price: 125000,
    description: "Updated description from the catalog API.",
    stock: 4,
  };
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [updatedBook] };
    if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
    if (url.endsWith("/related")) return { body: [] };
    return { body: {} };
  };
  await openBookDetail(page, apiHandler, updatedBook.title);

  const detail = page.locator("#bookDetail");
  await expect(detail.getByRole("heading", { name: updatedBook.title })).toBeVisible();
  await expect(detail.locator(".detail-author")).toContainText(updatedBook.author);
  await expect(detail.locator(".detail-publisher")).toContainText(updatedBook.publisher);
  await expect(detail.locator(".detail-price")).toContainText("125.000");
  await expect(detail.locator(".detail-stock")).toContainText("Còn 4 cuốn");
});

test("book gallery thumbnails can be changed with the keyboard", async ({ page }) => {
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
    if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
    if (url.endsWith("/related")) return { body: [] };
    return { body: {} };
  };
  await openBookDetail(page, apiHandler);

  const secondImage = page.getByRole("button", { name: "Xem ảnh 2" });
  await expect(secondImage).toBeVisible();
  await secondImage.focus();
  await page.keyboard.press("Enter");
  await expect(secondImage).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".detail-gallery-main")).toHaveAttribute("src", remoteBook.images[1].url);
});

test("a book removed from the configured catalog is not shown from the static fallback", async ({ page }) => {
  await openBookDetail(page, async () => ({ body: [] }), "Nhà giả kim");

  await expect(page.locator(".detail-empty h1")).toContainText(/không còn|không tìm thấy|không hợp lệ/i);
  await expect(page.locator(".detail-empty a[href='index.html#books']")).toBeVisible();
  await expect(page.locator("#bookDetail .detail-author")).toHaveCount(0);
});

for (const failure of [
  { name: "offline", result: { throw: "offline" } },
  { name: "server", result: { status: 503, body: {} } },
]) {
  test(`book detail failures expose a scoped retry after ${failure.name}`, async ({ page }) => {
    let attempts = 0;
    await openBookDetail(page, async (url) => {
      if (url.startsWith("/api/books?search=")) {
        attempts += 1;
        if (attempts === 1) return failure.result;
        return { body: [remoteBook] };
      }
      if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
      if (url.endsWith("/related")) return { body: [] };
      return { body: {} };
    });

    const error = page.locator("#detailStatus[role='alert']");
    await expect(error).toBeVisible();
    await expect(error.getByRole("button", { name: /thử lại/i })).toBeVisible();
    await error.getByRole("button", { name: /thử lại/i }).click();
    await expect(page.locator("#bookDetail h1")).toHaveText(remoteBook.title);
    expect(attempts).toBe(2);
  });
}

test("book detail refresh failures preserve already-rendered fallback product data", async ({ page }) => {
  await openBookDetail(page, async (url) => {
    if (url.startsWith("/api/books?search=")) return { throw: "offline" };
    return { body: {} };
  }, "Nhà giả kim");

  await expect(page.locator("#bookDetail h1")).toHaveText("Nhà giả kim");
  await expect(page.locator("#detailStatus[role='alert']")).toBeVisible();
  await expect(page.locator("#detailStatus").getByRole("button", { name: /thử lại/i })).toBeVisible();
});

test("empty related-books responses explain that no recommendations are available", async ({ page }) => {
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
    if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
    if (url.endsWith("/related")) return { body: [] };
    return { body: {} };
  };
  await openBookDetail(page, apiHandler);

  await expect(page.locator(".related-book-grid")).toContainText(/chưa có sách phù hợp/i);
});

test("review failures stay in the review section and do not block related books", async ({ page }) => {
  let reviewAttempts = 0;
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
    if (url.endsWith("/reviews")) {
      reviewAttempts += 1;
      return reviewAttempts === 1
        ? { status: 503, body: {} }
        : { body: { averageRating: 5, reviewCount: 1, reviews: [] } };
    }
    if (url.endsWith("/related")) return { body: [apiBooks[0]] };
    return { body: {} };
  };
  await openBookDetail(page, apiHandler);

  const reviews = page.locator(".book-reviews");
  await expect(reviews.locator("[role='alert']")).toBeVisible();
  await expect(reviews.getByRole("button", { name: /thử lại/i })).toBeVisible();
  await expect(page.locator("#bookDetail h1")).toHaveText(remoteBook.title);
  await expect(page.locator(".related-book-grid")).toContainText(apiBooks[0].title);
  await reviews.getByRole("button", { name: /thử lại/i }).click();
  await expect(reviews.locator(".review-summary")).toContainText("5 / 5");
  expect(reviewAttempts).toBe(2);
});

test("related-book failures stay scoped and can retry without hiding product details", async ({ page }) => {
  let relatedAttempts = 0;
  const apiHandler = async (url) => {
    if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
    if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
    if (url.endsWith("/related")) {
      relatedAttempts += 1;
      return relatedAttempts === 1 ? { status: 503, body: {} } : { body: [] };
    }
    return { body: {} };
  };
  await openBookDetail(page, apiHandler);

  const related = page.locator(".related-books");
  await expect(related.locator("[role='alert']")).toBeVisible();
  await expect(related.getByRole("button", { name: /thử lại/i })).toBeVisible();
  await expect(page.locator("#bookDetail h1")).toHaveText(remoteBook.title);
  await related.getByRole("button", { name: /thử lại/i }).click();
  await expect(related.locator("[role='alert']")).toBeHidden();
  await expect(related.locator(".related-book-grid")).toContainText(/chưa có sách phù hợp/i);
  expect(relatedAttempts).toBe(2);
});

test("cart clearly reports its empty state and keeps checkout disabled", async ({ page }) => {
  await openStorefront(page, cartApiHandler, "");

  await expect(page.locator("#cartQuoteStatus")).toHaveAttribute("data-state", "empty");
  await expect(page.locator("#cartItems .cart-empty")).toBeVisible();
  await expect(page.locator("#checkoutButton")).toBeDisabled();
});

test("cart announces a pending quote and enables checkout only after it resolves", async ({ page }) => {
  let releaseQuote;
  let markQuoteRequested;
  const quoteGate = new Promise((resolve) => { releaseQuote = resolve; });
  const quoteRequested = new Promise((resolve) => { markQuoteRequested = resolve; });
  const apiHandler = async (url, options) => {
    if (url === "/api/orders/quote") {
      markQuoteRequested();
      await quoteGate;
      const request = JSON.parse(options.body || "{}");
      return { body: validCartQuote(request.items || []) };
    }
    return defaultApiHandler(url);
  };
  await openCartWithSavedBook(page, apiHandler);
  await quoteRequested;

  await expect(page.locator("#cartQuoteStatus")).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#cartQuoteStatus")).toContainText(/đang tính|đang xác minh/i);
  await expect(page.locator("#checkoutButton")).toBeDisabled();

  releaseQuote();
  await expect(page.locator("#cartQuoteStatus")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#checkoutButton")).toBeEnabled();
});

for (const failure of [
  { name: "offline", result: { throw: "offline" } },
  { name: "server", result: { status: 503, body: { error: "Máy chủ chưa thể báo giá." } } },
]) {
  test(`cart quote errors offer a working retry after ${failure.name}`, async ({ page }) => {
    let attempts = 0;
    const apiHandler = async (url, options) => {
      if (url === "/api/orders/quote") {
        attempts += 1;
        if (attempts === 1) return failure.result;
        const request = JSON.parse(options.body || "{}");
        return { body: validCartQuote(request.items || []) };
      }
      return defaultApiHandler(url);
    };
    await openCartWithSavedBook(page, apiHandler);
    const cartButton = page.locator("#cartButton");
    await cartButton.click();

    const status = page.locator("#cartQuoteStatus");
    await expect(status).toHaveAttribute("data-state", "error");
    await expect(status.getByRole("button", { name: /thử lại/i })).toBeVisible();
    await expect(page.locator("#checkoutButton")).toBeDisabled();
    await status.getByRole("button", { name: /thử lại/i }).click();
    await expect(status).toHaveAttribute("data-state", "ready");
    await expect(page.locator("#checkoutButton")).toBeEnabled();
    expect(attempts).toBe(2);
  });
}

test("cart surfaces rejected out-of-stock quotes and prevents checkout", async ({ page }) => {
  await openCartWithSavedBook(page, async (url) => {
    if (url === "/api/orders/quote") {
      return { status: 400, body: { error: "Không đủ tồn kho cho Nhà giả kim." } };
    }
    return defaultApiHandler(url);
  });

  const status = page.locator("#cartQuoteStatus");
  await expect(status).toHaveAttribute("data-state", "error");
  await expect(status).toContainText(/tồn kho/i);
  await expect(page.locator("#checkoutButton")).toBeDisabled();
});

test("cart quantity controls update the quote and line totals", async ({ page }) => {
  await openCartWithSavedBook(page);
  await expect(page.locator("#cartQuoteStatus")).toHaveAttribute("data-state", "ready");
  await page.locator("#cartButton").click();

  const quantity = page.locator("#cartItems .quantity-control");
  await expect(quantity.locator("span")).toHaveText("1");
  await quantity.getByRole("button", { name: /tăng số lượng/i }).click();
  await expect(quantity.locator("span")).toHaveText("2");
  await expect(page.locator("#cartSubtotal")).toContainText("178.000");
  await expect(page.locator("#cartQuoteStatus")).toHaveAttribute("data-state", "ready");
});

test("invalid saved-cart data is reported without replacing the stored value", async ({ page }) => {
  await openStorefront(page, defaultApiHandler, "", () => localStorage.setItem("booknest-cart", "{broken"));

  const storageStatus = page.locator("#cartStorageStatus");
  await expect(storageStatus).toHaveAttribute("data-state", "error");
  await expect(storageStatus).toContainText(/không thể đọc|định dạng/i);
  expect(await page.evaluate(() => localStorage.getItem("booknest-cart"))).toBe("{broken");
});

test("unavailable cart storage is reported to the shopper", async ({ page }) => {
  await openStorefront(page, defaultApiHandler, "", () => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "booknest-cart") throw new Error("storage unavailable");
      return originalGetItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "booknest-cart") throw new Error("storage unavailable");
      return originalSetItem.call(this, key, value);
    };
  });

  await expect(page.locator("#cartStorageStatus")).toHaveAttribute("data-state", "error");
});

test("cart dialog receives focus, closes with Escape, and restores focus", async ({ page }) => {
  await openStorefront(page, cartApiHandler, "");
  const cartButton = page.locator("#cartButton");
  await cartButton.click();

  const cart = page.getByRole("dialog", { name: "Giỏ hàng" });
  await expect(cart).toBeVisible();
  await expect(cart).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#closeCart")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cart).toBeHidden();
  await expect(cartButton).toBeFocused();
});
