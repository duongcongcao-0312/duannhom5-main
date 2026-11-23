"use strict";

function normalizeIsbn(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  if (!isbn) return true;
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, character, index) => {
      const digit = character === "X" ? 10 : Number(character);
      return total + digit * (10 - index);
    }, 0);
    return sum % 11 === 0;
  }
  if (/^(978|979)\d{10}$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, character, index) => total + Number(character) * (index % 2 ? 3 : 1),
      0,
    );
    return sum % 10 === 0;
  }
  return false;
}

function normalizeBookImages(images, cover, title, sanitizePlainText) {
  const entries = Array.isArray(images) ? images : [];
  let normalized = entries.map((entry) => {
    const url = sanitizePlainText(
      typeof entry === "string" ? entry : entry?.url || entry?.src || "",
      500,
    );
    const alt = sanitizePlainText(
      typeof entry === "object" && entry ? entry.alt || "" : "",
      200,
    );
    const rawVariants = typeof entry === "object" && entry ? entry.variants : null;
    const uploadId = url.match(/^\/api\/uploads\/book-covers\/([0-9a-f-]{36})\.webp$/i)?.[1];
    const variants = uploadId && rawVariants && typeof rawVariants === "object"
      ? Object.fromEntries(
        ["small", "medium"].flatMap((size) => {
          const variantUrl = sanitizePlainText(rawVariants[size] || "", 500);
          const expectedWidth = size === "small" ? "320" : "640";
          return new RegExp(
            `^/api/uploads/book-covers/${uploadId}-${expectedWidth}\\.webp$`,
            "i",
          ).test(variantUrl)
            ? [[size, variantUrl]]
            : [];
        }),
      )
      : null;
    return url
      ? {
        url,
        alt: alt || `Ảnh sách ${title}`,
        ...(variants && Object.keys(variants).length ? { variants } : {}),
      }
      : null;
  });
  if (cover && !/^cover-[1-5]$/.test(cover)) {
    const coverImage = normalized.find((image) => image.url === cover)
      || { url: cover, alt: `Bìa sách ${title}` };
    normalized = [coverImage, ...normalized.filter((image) => image.url !== cover)].slice(0, 8);
  }
  return normalized;
}

module.exports = { isValidIsbn, normalizeBookImages, normalizeIsbn };
