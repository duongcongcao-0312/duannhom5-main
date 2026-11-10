const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../server");

test("book list pagination returns stable metadata and rejects unsupported sorting", async (t) => {
  const server = createServer();
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/books?page=1&limit=2&sort=title&order=asc`);
  assert.equal(response.status, 200);
  const books = await response.json();
  const pagination = JSON.parse(response.headers.get("x-pagination"));
  assert.equal(books.length, 2);
  assert.equal(pagination.page, 1);
  assert.equal(pagination.limit, 2);
  assert.ok(pagination.total >= books.length);
  assert.equal(pagination.sort, "title");
  assert.equal(pagination.order, "asc");
  assert.ok(books[0].title.localeCompare(books[1].title, "vi") <= 0);

  const invalidSort = await fetch(`${baseUrl}/api/books?sort=createdAt`);
  assert.equal(invalidSort.status, 400);
  const oversizedPage = await fetch(`${baseUrl}/api/books?limit=101`);
  assert.equal(oversizedPage.status, 400);
});
