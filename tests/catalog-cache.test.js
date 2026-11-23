const assert = require("node:assert/strict");
const test = require("node:test");
const { CatalogCache } = require("../backend/catalog-cache");

test("catalog cache serves copies until its TTL expires and records hit rate", async () => {
  let now = 100;
  let loads = 0;
  const cache = new CatalogCache({
    ttlMs: 50,
    clock: () => now,
    async loader() { loads += 1; return [{ id: "book", price: loads }]; },
  });

  const first = await cache.get();
  first[0].price = -1;
  assert.equal((await cache.get())[0].price, 1);
  assert.equal(loads, 1);
  now += 51;
  assert.equal((await cache.get())[0].price, 2);
  assert.deepEqual(cache.getSnapshot(), {
    ttlMs: 50, entries: 1, hits: 1, misses: 2, hitRatePct: 33.33,
    loads: 2, loadErrors: 0, averageLoadDurationMs: 0, invalidations: 0,
  });
});

test("catalog cache coalesces concurrent loads and invalidation prevents stale repopulation", async () => {
  let release;
  let loads = 0;
  let records = [{ id: "book", price: 10 }];
  const cache = new CatalogCache({
    async loader() {
      loads += 1;
      const snapshot = records.map((book) => ({ ...book }));
      if (loads === 1) await new Promise((resolve) => { release = resolve; });
      return snapshot;
    },
  });

  const first = cache.get();
  const concurrent = cache.get();
  await new Promise((resolve) => setImmediate(resolve));
  records = [{ id: "book", price: 12 }];
  cache.invalidate();
  const fresh = await cache.get();
  release();
  assert.equal((await first)[0].price, 10);
  assert.equal((await concurrent)[0].price, 10);
  assert.equal((await cache.get())[0].price, 12);
  assert.equal(fresh[0].price, 12);
  assert.equal(loads, 2);
});

test("catalog cache does not retain loader failures and retries successfully", async () => {
  let attempts = 0;
  const cache = new CatalogCache({
    async loader() {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database failure");
      return [{ id: "book", stock: 4 }];
    },
  });

  await assert.rejects(cache.get(), /temporary database failure/);
  assert.deepEqual(await cache.get(), [{ id: "book", stock: 4 }]);
  assert.equal(cache.getSnapshot().loadErrors, 1);
  assert.equal(attempts, 2);
});
