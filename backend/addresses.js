"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (process.platform === "win32" && (error.code === "EPERM" || error.code === "EEXIST")) {
      await fs.rm(filePath, { force: true }).catch(() => {});
      await fs.rename(tempPath, filePath);
    } else {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

class AddressStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.writeQueue = Promise.resolve();
  }

  enqueue(operation) {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  async readAll() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async listByUser(userId) {
    if (!userId) return [];
    const all = await this.readAll();
    return all.filter((entry) => entry && entry.userId === userId);
  }

  async findById(id) {
    if (!id) return null;
    const all = await this.readAll();
    return all.find((entry) => entry && entry.id === id) || null;
  }

  async createForUser(userId, input) {
    return this.enqueue(async () => {
      const all = await this.readAll();
      const now = new Date().toISOString();
      const userAddresses = all.filter((entry) => entry.userId === userId);
      const isDefault = input.isDefault === true || userAddresses.length === 0;
      if (isDefault) {
        for (const entry of all) {
          if (entry.userId === userId) entry.isDefault = false;
        }
      }
      const record = {
        id: crypto.randomUUID(),
        userId,
        recipientName: input.recipientName,
        phone: input.phone,
        addressLine: input.addressLine,
        ward: input.ward || "",
        district: input.district || "",
        city: input.city || "",
        label: input.label || "Nhà riêng",
        isDefault,
        createdAt: now,
        updatedAt: now,
      };
      all.push(record);
      await atomicWriteJson(this.filePath, all);
      return record;
    });
  }

  async updateById(id, patch) {
    return this.enqueue(async () => {
      const all = await this.readAll();
      const index = all.findIndex((entry) => entry && entry.id === id);
      if (index === -1) return null;
      const existing = all[index];
      if (patch.isDefault === true) {
        for (const entry of all) {
          if (entry.userId === existing.userId) entry.isDefault = false;
        }
      }
      const updated = {
        ...existing,
        ...(patch.recipientName !== undefined ? { recipientName: patch.recipientName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.addressLine !== undefined ? { addressLine: patch.addressLine } : {}),
        ...(patch.ward !== undefined ? { ward: patch.ward } : {}),
        ...(patch.district !== undefined ? { district: patch.district } : {}),
        ...(patch.city !== undefined ? { city: patch.city } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        id: existing.id,
        userId: existing.userId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      all[index] = updated;
      await atomicWriteJson(this.filePath, all);
      return updated;
    });
  }

  async deleteById(id) {
    return this.enqueue(async () => {
      const all = await this.readAll();
      const index = all.findIndex((entry) => entry && entry.id === id);
      if (index === -1) return null;
      const [removed] = all.splice(index, 1);
      if (removed.isDefault) {
        const nextDefault = all.find((entry) => entry.userId === removed.userId);
        if (nextDefault) nextDefault.isDefault = true;
      }
      await atomicWriteJson(this.filePath, all);
      return removed;
    });
  }
}

module.exports = { AddressStore };
