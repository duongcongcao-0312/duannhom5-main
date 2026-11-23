const DEFAULT_TTL_MS = 2_000;

class CatalogCache {
  constructor({ loader, ttlMs = DEFAULT_TTL_MS, clock = Date.now } = {}) {
    if (typeof loader !== "function") throw new TypeError("CatalogCache requires a loader.");
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new RangeError("ttlMs must be positive.");
    this.loader = loader;
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.entry = null;
    this.inFlight = null;
    this.generation = 0;
    this.stats = { hits: 0, misses: 0, loads: 0, loadErrors: 0, loadDurationMs: 0, invalidations: 0 };
  }

  async get() {
    const now = this.clock();
    if (this.entry && this.entry.expiresAt > now) {
      this.stats.hits += 1;
      return this.entry.value.map((book) => ({ ...book }));
    }
    this.stats.misses += 1;
    if (this.inFlight) return (await this.inFlight).map((book) => ({ ...book }));
    const generation = this.generation;
    const startedAt = this.clock();
    const pending = Promise.resolve().then(() => this.loader()).then((books) => {
      const snapshot = books.map((book) => ({ ...book }));
      this.stats.loads += 1;
      this.stats.loadDurationMs += Math.max(0, this.clock() - startedAt);
      if (generation === this.generation) this.entry = { value: snapshot, expiresAt: this.clock() + this.ttlMs };
      return snapshot;
    }, (error) => {
      this.stats.loadErrors += 1;
      this.stats.loadDurationMs += Math.max(0, this.clock() - startedAt);
      throw error;
    }).finally(() => { if (this.inFlight === pending) this.inFlight = null; });
    this.inFlight = pending;
    return (await pending).map((book) => ({ ...book }));
  }

  invalidate() {
    this.generation += 1;
    this.entry = null;
    this.inFlight = null;
    this.stats.invalidations += 1;
  }

  getSnapshot() {
    const requests = this.stats.hits + this.stats.misses;
    return {
      ttlMs: this.ttlMs,
      entries: this.entry ? 1 : 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatePct: requests ? Number((this.stats.hits / requests * 100).toFixed(2)) : 0,
      loads: this.stats.loads,
      loadErrors: this.stats.loadErrors,
      averageLoadDurationMs: this.stats.loads + this.stats.loadErrors
        ? Math.round(this.stats.loadDurationMs / (this.stats.loads + this.stats.loadErrors)) : 0,
      invalidations: this.stats.invalidations,
    };
  }
}

module.exports = { CatalogCache, DEFAULT_TTL_MS };
