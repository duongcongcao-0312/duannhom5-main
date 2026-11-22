"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

function configureAdminEnv(t) {
  const previous = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@booknest.vn";
  process.env.ADMIN_PASSWORD = "address-idor-admin-pass-123";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booknest-address-idor-"));
  const server = createServer({
    ordersPath: path.join(directory, "orders.jsonl"),
    usersPath: path.join(directory, "users.json"),
    servicesPath: path.join(directory, "services.jsonl"),
    booksPath: path.join(directory, "books.json"),
    addressesPath: path.join(directory, "addresses.json"),
    auditLogPath: path.join(directory, "admin-audit.jsonl"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("shipping address CRUD prevents IDOR across accounts and embedded order addresses", async (t) => {
  configureAdminEnv(t);
  const { baseUrl } = await withServer(t);

  const registerUser = async (name, email) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: "user-idor-password-123" }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const userA = await registerUser("User A", "user-a-addr@example.com");
  const userB = await registerUser("User B", "user-b-addr@example.com");

  // Unauthenticated access rejected with 401
  assert.equal((await fetch(`${baseUrl}/api/v1/addresses`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientName: "Anon",
        phone: "0901234567",
        addressLine: "12 Đường Sách",
      }),
    })).status,
    401,
  );

  // User B creates their shipping address
  const createB = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({
      recipientName: "Người Nhận B",
      phone: "0908887776",
      addressLine: "99 Đường Bảo Mật, Quận 3, TP.HCM",
      city: "TP.HCM",
      label: "Văn phòng B",
    }),
  });
  assert.equal(createB.status, 201);
  const { address: addressB } = await createB.json();
  assert.equal(addressB.userId, userB.user.id);
  assert.equal(addressB.isDefault, true);

  // User A creates their own address (cannot spoof userId)
  const spoofCreate = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      userId: userB.user.id,
      recipientName: "Attacker",
      phone: "0901112223",
      addressLine: "12 Đường A",
    }),
  });
  assert.equal(spoofCreate.status, 400);

  const createA = await fetch(`${baseUrl}/api/v1/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      recipientName: "Người Nhận A",
      phone: "0901112223",
      addressLine: "12 Đường Sách A, Quận 1",
    }),
  });
  assert.equal(createA.status, 201);
  const { address: addressA } = await createA.json();

  // Listing addresses returns ONLY User A's addresses and rejects ?userId=...
  const listA = await fetch(`${baseUrl}/api/v1/addresses`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(listA.status, 200);
  const { addresses: listAItems } = await listA.json();
  assert.equal(listAItems.length, 1);
  assert.equal(listAItems[0].id, addressA.id);

  const querySpoof = await fetch(`${baseUrl}/api/v1/addresses?userId=${userB.user.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(querySpoof.status, 400);

  // IDOR tests: User A tries GET / PUT / PATCH / DELETE on User B's address ID -> 403
  const idorGet = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(idorGet.status, 403);
  assert.doesNotMatch(await idorGet.text(), /99 Đường Bảo Mật|0908887776/);

  const idorPut = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      recipientName: "Hacked B",
      phone: "0900000000",
      addressLine: "Hacked Address 12345",
    }),
  });
  assert.equal(idorPut.status, 403);

  const idorPatch = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ addressLine: "Hacked Patch Address" }),
  });
  assert.equal(idorPatch.status, 403);

  const idorDelete = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(idorDelete.status, 403);

  // IDOR on embedded order address: User A cannot attach User B's addressId when creating an order
  const idorOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      customerName: "User A",
      address: "12 Đường Sách A, Quận 1",
      addressId: addressB.id,
      phone: "0901112223",
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(idorOrder.status, 403);

  // User A CAN create an order using their own addressId
  const ownOrder = await fetch(`${baseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({
      customerName: "User A",
      address: addressA.addressLine,
      addressId: addressA.id,
      phone: addressA.phone,
      paymentMethod: "cod",
      items: [{ title: "Nhà giả kim", quantity: 1 }],
    }),
  });
  assert.equal(ownOrder.status, 201);

  // Verify User B's address is completely intact and User B can still read/update/delete their own address
  const verifyB = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(verifyB.status, 200);
  const { address: intactB } = await verifyB.json();
  assert.equal(intactB.addressLine, "99 Đường Bảo Mật, Quận 3, TP.HCM");

  const updateB = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({ label: "Nhà mới B" }),
  });
  assert.equal(updateB.status, 200);
  assert.equal((await updateB.json()).address.label, "Nhà mới B");

  const deleteB = await fetch(`${baseUrl}/api/v1/addresses/${addressB.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(deleteB.status, 200);
});
