const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");

async function startServer(database) {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "booknest-smoke-"));
  const server = createServer({ database });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { directory, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("health and readiness smoke paths return useful status without writes", async (t) => {
  const calls = [];
  const { directory, server, baseUrl } = await startServer({
    async init() { calls.push("init"); },
    async getCustomBooks() { return []; },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "booknest" });
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready", service: "booknest" });
  assert.deepEqual(calls, ["init"]);
  assert.deepEqual(await fsPromises.readdir(directory), []);
});

test("readiness returns 503 when persistence is unavailable", async (t) => {
  const { directory, server, baseUrl } = await startServer({
    async init() { throw new Error("database unavailable"); },
    async getCustomBooks() { return []; },
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "not_ready", service: "booknest" });
});
