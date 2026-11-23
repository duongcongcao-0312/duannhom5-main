const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { after, test } = require("node:test");
const { createServer } = require("../server");
const { Database } = require("../backend/db");

const previousAdminEnvironment = {
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

after(() => {
  for (const [key, value] of Object.entries(previousAdminEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("catalog APIs validate ISBN, persist images/history, verify reviews, and isolate favorites", async (t) => {
  process.env.ADMIN_EMAIL = "catalog-admin@example.com";
  process.env.ADMIN_PASSWORD = "catalog-admin-password-123";
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-catalog-"));
  const ordersPath = path.join(directory, "orders.jsonl");
  const usersPath = path.join(directory, "users.json");
  const booksPath = path.join(directory, "books.json");
  const database = new Database({ ordersPath, usersPath, booksPath });
  await database.init();
  const reviewer = await database.createUser({
    name: "Catalog Reviewer",
    email: "reviewer@example.com",
    password: "catalog-review-password-123",
    role: "user",
  });
  const otherUser = await database.createUser({
    name: "Other Reader",
    email: "other-reader@example.com",
    password: "catalog-other-password-123",
    role: "user",
  });
  const server = createServer({ database, ordersPath, usersPath, booksPath });
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  const adminToken = await login("catalog-admin@example.com", "catalog-admin-password-123");
  const reviewerToken = await login("reviewer@example.com", "catalog-review-password-123");
  const otherToken = await login("other-reader@example.com", "catalog-other-password-123");
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const createBook = (data) => fetch(`${baseUrl}/api/admin/books`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify(data),
  });
  const primaryResponse = await createBook({
    title: "Catalog ISBN Test Book",
    author: "Catalog Writer",
    category: "van-hoc",
    price: 75000,
    stock: 5,
    isbn: "978-0-306-40615-7",
    images: [
      {
        url: "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc.webp",
        alt: "Bìa trước",
        variants: {
          small: "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-320.webp",
          medium: "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-640.webp",
        },
      },
      { url: "https://images.example.test/back.webp", alt: "Bìa sau" },
    ],
    description: "<script>alert(1)</script><b>Nội dung an toàn</b>",
  });
  assert.equal(primaryResponse.status, 201);
  const primaryBook = await primaryResponse.json();
  assert.equal(primaryBook.isbn, "9780306406157");
  assert.equal(primaryBook.description, "Nội dung an toàn");
  assert.deepEqual(primaryBook.images.map((image) => image.alt), ["Bìa trước", "Bìa sau"]);
  assert.deepEqual(primaryBook.images[0].variants, {
    small: "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-320.webp",
    medium: "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc-640.webp",
  });
  assert.equal(primaryBook.cover, "/api/uploads/book-covers/12345678-1234-4234-8234-123456789abc.webp");

  const invalidIsbn = await createBook({
    title: "Invalid ISBN Book",
    category: "van-hoc",
    price: 10000,
    stock: 1,
    isbn: "9780306406158",
  });
  assert.equal(invalidIsbn.status, 400);
  const duplicateIsbn = await createBook({
    title: "Duplicate ISBN Book",
    category: "van-hoc",
    price: 10000,
    stock: 1,
    isbn: "9780306406157",
  });
  assert.equal(duplicateIsbn.status, 409);
  const isbn10Response = await createBook({
    title: "ISBN-10 Leading Zero Book",
    author: "ISBN Test Writer",
    category: "van-hoc",
    price: 25000,
    stock: 1,
    isbn: "0-306-40615-2",
  });
  assert.equal(isbn10Response.status, 201, await isbn10Response.clone().text());
  assert.equal((await isbn10Response.json()).isbn, "0306406152");
  const unsafeImage = await createBook({
    title: "Unsafe Image Book",
    author: "ISBN Test Writer",
    category: "van-hoc",
    price: 25000,
    stock: 1,
    images: [{ url: "javascript:alert(1)" }],
  });
  assert.equal(unsafeImage.status, 400);

  const isbnSearch = await fetch(`${baseUrl}/api/books?search=978-0-306-40615-7&limit=10`);
  assert.equal(isbnSearch.status, 200);
  assert.ok((await isbnSearch.json()).some((book) => book.id === primaryBook.id));
  const filtered = await fetch(
    `${baseUrl}/api/books?search=Catalog&category=van-hoc&minPrice=70000&maxPrice=80000&limit=2`,
  );
  assert.equal(filtered.status, 200);
  const filterMeta = JSON.parse(filtered.headers.get("x-pagination"));
  assert.equal(filterMeta.total, 1);
  assert.equal((await filtered.json())[0].id, primaryBook.id);
  const reversedPriceRange = await fetch(`${baseUrl}/api/books?minPrice=80000&maxPrice=70000`);
  assert.equal(reversedPriceRange.status, 400);

  const secondaryResponse = await createBook({
    title: "Catalog Related Book",
    author: "Another Writer",
    category: "van-hoc",
    price: 82000,
    stock: 2,
  });
  assert.equal(secondaryResponse.status, 201);
  const secondaryBook = await secondaryResponse.json();
  const relatedResponse = await fetch(`${baseUrl}/api/books/${primaryBook.id}/related`);
  assert.equal(relatedResponse.status, 200);
  assert.ok((await relatedResponse.json()).some((book) => book.id === secondaryBook.id));

  const favoriteRequest = (token, method, bookId) => fetch(`${baseUrl}/api/favorites`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify({ bookId }) }),
  });
  assert.equal((await favoriteRequest(reviewerToken, "POST", primaryBook.id)).status, 200);
  assert.equal((await favoriteRequest(reviewerToken, "POST", primaryBook.id)).status, 200);
  const reviewerFavorites = await (await favoriteRequest(reviewerToken, "GET")).json();
  assert.deepEqual(reviewerFavorites.bookIds, [primaryBook.id]);
  const otherFavorites = await (await favoriteRequest(otherToken, "GET")).json();
  assert.deepEqual(otherFavorites.bookIds, []);
  assert.equal((await favoriteRequest(reviewerToken, "DELETE", primaryBook.id)).status, 200);
  assert.deepEqual(
    (await (await favoriteRequest(reviewerToken, "GET")).json()).bookIds,
    [],
  );
  assert.equal((await fetch(`${baseUrl}/api/favorites`)).status, 401);

  const reviewUrl = `${baseUrl}/api/books/${primaryBook.id}/reviews`;
  const submitReview = (rating = 5) => fetch(reviewUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${reviewerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rating, content: "<img src=x onerror=alert(1)>Đọc rất hay" }),
  });
  assert.equal((await submitReview()).status, 403);
  await database.addOrder({
    orderId: randomUUID(),
    userId: reviewer.id,
    status: "completed",
    paymentStatus: "paid",
    items: [{ title: primaryBook.title, quantity: 1 }],
    createdAt: new Date().toISOString(),
  }, ordersPath);
  const popularBooks = await (await fetch(`${baseUrl}/api/books?sort=popularity&order=desc&limit=100`)).json();
  assert.equal(popularBooks[0].id, primaryBook.id);
  assert.equal((await submitReview(4.5)).status, 400);
  const submitted = await submitReview();
  assert.equal(submitted.status, 201);
  assert.equal((await submitReview()).status, 409);
  assert.equal((await (await fetch(reviewUrl)).json()).reviewCount, 0);

  const pendingReviewsResponse = await fetch(`${baseUrl}/api/admin/reviews?status=pending`, {
    headers: adminHeaders,
  });
  assert.equal(pendingReviewsResponse.status, 200);
  const [pendingReview] = await pendingReviewsResponse.json();
  const moderation = await fetch(`${baseUrl}/api/admin/reviews/${pendingReview.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "visible" }),
  });
  assert.equal(moderation.status, 200);
  const visibleReviews = await (await fetch(reviewUrl)).json();
  assert.equal(visibleReviews.reviewCount, 1);
  assert.equal(visibleReviews.reviews[0].content, "Đọc rất hay");
  const report = await fetch(`${baseUrl}/api/reviews/${pendingReview.id}/report`, {
    method: "POST",
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(report.status, 200);
  const reportedReviews = await fetch(`${baseUrl}/api/admin/reviews?status=reported`, {
    headers: adminHeaders,
  });
  assert.equal(reportedReviews.status, 200);
  assert.equal((await reportedReviews.json())[0].reportCount, 1);
  assert.equal((await fetch(`${baseUrl}/api/admin/books/${primaryBook.id}/history`, {
    headers: adminHeaders,
  })).status, 200);

  const update = await fetch(`${baseUrl}/api/admin/books/${primaryBook.id}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      title: primaryBook.title,
      author: primaryBook.author,
      category: primaryBook.category,
      price: 70000,
      stock: 0,
      isbn: primaryBook.isbn,
      images: primaryBook.images,
      description: primaryBook.description,
    }),
  });
  assert.equal(update.status, 200);
  const history = await (await fetch(`${baseUrl}/api/admin/books/${primaryBook.id}/history`, {
    headers: adminHeaders,
  })).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].actorId, (await (await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json()).user.id);
  assert.equal(history[0].changes.price.after, 70000);
  assert.equal(history[0].changes.stock.after, 0);
  const currentBook = (await (await fetch(`${baseUrl}/api/books?search=Catalog%20ISBN%20Test&limit=5`)).json())
    .find((book) => book.id === primaryBook.id);
  assert.equal(currentBook.availability, "out_of_stock");
  const hideReview = await fetch(`${baseUrl}/api/admin/reviews/${pendingReview.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "hidden" }),
  });
  assert.equal(hideReview.status, 200);
  assert.equal((await (await fetch(reviewUrl)).json()).reviewCount, 0);
});
