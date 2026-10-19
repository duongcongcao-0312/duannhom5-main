const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

const customers = [
  ["11111111-1111-4111-8111-111111111111", "Nguyễn Minh Anh", "minh.anh@example.com", "0901000001", "Hà Nội", "customer"],
  ["22222222-2222-4222-8222-222222222222", "Trần Quốc Bảo", "quoc.bao@example.com", "0901000002", "Đà Nẵng", "lead"],
  ["33333333-3333-4333-8333-333333333333", "Lê Hoàng Chi", "hoang.chi@example.com", "0901000003", "Hồ Chí Minh", "customer"],
  ["44444444-4444-4444-8444-444444444444", "Phạm Gia Hân", "gia.han@example.com", "0901000004", "Hải Phòng", "lead"],
  ["55555555-5555-4555-8555-555555555555", "Võ Thành Đạt", "thanh.dat@example.com", "0901000005", "Cần Thơ", "customer"],
  ["66666666-6666-4666-8666-666666666666", "Đỗ Ngọc Hà", "ngoc.ha@example.com", "0901000006", "Huế", "active"],
  ["77777777-7777-4777-8777-777777777777", "Bùi Khánh Linh", "khanh.linh@example.com", "0901000007", "Hà Nội", "vip"],
  ["88888888-8888-4888-8888-888888888888", "Ngô Đức Minh", "duc.minh@example.com", "0901000008", "Nha Trang", "customer"],
  ["99999999-9999-4999-8999-999999999999", "Huỳnh Thảo My", "thao.my@example.com", "0901000009", "Hồ Chí Minh", "lead"],
  ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Đặng Tuấn Nam", "tuan.nam@example.com", "0901000010", "Vũng Tàu", "customer"],
  ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Mai Phương Oanh", "phuong.oanh@example.com", "0901000011", "Hà Nội", "active"],
  ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Vũ Anh Tuấn", "anh.tuan@example.com", "0901000012", "Biên Hòa", "customer"],
].map(([id, full_name, email, phone, city, status]) => ({
  id, full_name, email, phone, city, status,
  name: full_name,
  address: `Số ${Number.parseInt(id.slice(0, 2), 16) || 1}, Đường Sách`,
}));

async function seedFile() {
  const filePath = path.join(__dirname, "..", "data", "customers.json");
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!Array.isArray(existing)) existing = [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const byEmail = new Map(existing.map((customer) => [customer.email, customer]));
  for (const customer of customers) {
    if (!byEmail.has(customer.email)) {
      byEmail.set(customer.email, {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        status: customer.status === "active" || customer.status === "vip" ? "new" : customer.status,
        address: customer.address,
        created_by: "seed",
        updated_by: "seed",
        createdAt: new Date().toISOString(),
      });
    }
  }
  await fs.writeFile(filePath, JSON.stringify([...byEmail.values()], null, 2) + "\n", "utf8");
  console.log(`Seeded ${customers.length} customer records into ${filePath}.`);
}

async function seedPostgres() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const customer of customers) {
      await client.query(
        `INSERT INTO customers
          (customer_id, full_name, phone, email, address, city, source, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7, 'seed', 'seed')
         ON CONFLICT (email) DO UPDATE SET
           full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, city = EXCLUDED.city,
           status = EXCLUDED.status, updated_at = NOW(), updated_by = 'seed'`,
        [customer.id, customer.full_name, customer.phone, customer.email, customer.address, customer.city, customer.status],
      );
      await client.query(
        `INSERT INTO customer_interactions (id, customer_id, type, note, created_by)
         VALUES ($1, $1, 'feedback', 'Bản ghi mẫu dùng cho môi trường phát triển.', 'seed')
         ON CONFLICT DO NOTHING`,
        [customer.id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Seeded ${customers.length} customer records into PostgreSQL.`);
}

async function main() {
  if (process.env.DATABASE_URL) {
    await seedPostgres();
  } else {
    await seedFile();
  }
}

main().catch((error) => {
  console.error("Customer seed failed:", error.message);
  process.exitCode = 1;
});
