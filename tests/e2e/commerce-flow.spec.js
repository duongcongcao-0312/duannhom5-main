const { createHmac, randomUUID } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const { E2E_PAYMENT_WEBHOOK_SECRET } = require("../../scripts/e2e-config");

async function registerCustomer(page, name, email) {
  await page.locator("#accountButton").click();
  await page.locator('#accountDialog [data-account-view="register"]').click();
  const form = page.locator("#registerForm");
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="email"]').fill(email);
  await form.locator('[name="password"]').fill("BookNest-E2E-password-123!");
  await form.locator('[name="studentType"]').selectOption("other");
  await form.locator('[type="submit"]').click();
  await expect(page.locator("#accountDialog")).not.toBeVisible();
}

async function sendPaymentEvent(request, order, status, occurredAt) {
  const body = JSON.stringify({
    id: `e2e-${status}-${randomUUID()}`,
    orderId: order.orderId,
    status,
    amount: order.total,
    currency: "VND",
    occurredAt,
  });
  const signature = createHmac("sha256", E2E_PAYMENT_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return request.post("/api/payments/webhook", {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "x-booknest-signature": `sha256=${signature}`,
    },
  });
}

test("customer can register, search, checkout, receive payment callbacks, and only view their order", async ({
  page,
  browser,
  request,
}) => {
  const email = `e2e-${randomUUID()}@example.test`;
  await page.goto("/");

  await registerCustomer(page, "E2E Customer", email);
  await page.locator("#accountButton").click();
  await page.locator("#logoutButton").click();
  const loginForm = page.locator("#loginForm");
  await loginForm.locator('[name="email"]').fill(email);
  await loginForm.locator('[name="password"]').fill("BookNest-E2E-password-123!");
  await loginForm.locator('[type="submit"]').click();
  await expect(page.locator("#accountDialog")).not.toBeVisible();

  await page.locator("#searchInput").fill("Nhà giả kim");
  const bookCard = page.locator(".book-card").filter({ hasText: "Nhà giả kim" });
  await expect(bookCard).toHaveCount(1);
  await bookCard.locator(".add-button").click();
  await expect(page.locator("#cartCount")).toHaveText("1");

  await page.locator("#cartButton").click();
  await page.locator("#couponInput").fill("BOOKNEST10");
  await page.locator("#applyCoupon").click();
  await expect(page.locator("#couponMessage")).toContainText("giảm 10%");
  await expect(page.locator("#checkoutButton")).toBeEnabled();
  await page.locator("#checkoutButton").click();

  const paymentDialog = page.locator("#paymentDialog");
  await expect(paymentDialog).toBeVisible();
  const paymentForm = page.locator("#paymentForm");
  await paymentForm.locator('[name="customerName"]').fill("E2E Customer");
  await paymentForm.locator('[name="phone"]').fill("0901234567");
  await paymentForm.locator('[name="address"]').fill("12 Test Street, Test City");

  const orderResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/orders" &&
    response.request().method() === "POST",
  );
  await paymentForm.locator('[type="submit"]').click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();
  expect(order.paymentMethod).toBe("transfer");

  await expect(page.locator("#paymentConfirmation")).toContainText(order.orderId);

  const failedPaymentResponse = await sendPaymentEvent(
    request,
    order,
    "failed",
    new Date(Date.now() - 1000).toISOString(),
  );
  expect(failedPaymentResponse.status()).toBe(200);
  expect((await failedPaymentResponse.json()).order.paymentStatus).toBe("failed");

  const successfulPaymentResponse = await sendPaymentEvent(
    request,
    order,
    "succeeded",
    new Date(Date.now() + 1000).toISOString(),
  );
  expect(successfulPaymentResponse.status()).toBe(200);
  expect((await successfulPaymentResponse.json()).order.paymentStatus).toBe("paid");

  await page.locator("#closePayment").click();
  await page.locator("#trackOrderButton").click();
  const tracker = page.locator("#trackOrderForm");
  await tracker.locator('[name="orderId"]').fill(order.orderId);
  await tracker.locator('[type="submit"]').click();
  await expect(page.locator("#orderResult")).toBeVisible();
  await expect(page.locator("#orderResult")).toContainText(order.orderId);

  const otherCustomer = await browser.newContext();
  try {
    const otherPage = await otherCustomer.newPage();
    await otherPage.goto("/");
    await registerCustomer(
      otherPage,
      "E2E Other Customer",
      `e2e-other-${randomUUID()}@example.test`,
    );
    await otherPage.locator("#trackOrderButton").click();
    const otherTracker = otherPage.locator("#trackOrderForm");
    await otherTracker.locator('[name="orderId"]').fill(order.orderId);
    await otherTracker.locator('[type="submit"]').click();
    await expect(otherPage.locator("#trackOrderError")).toBeVisible();
    await expect(otherPage.locator("#trackOrderError")).toContainText("không có quyền");
  } finally {
    await otherCustomer.close();
  }
});
