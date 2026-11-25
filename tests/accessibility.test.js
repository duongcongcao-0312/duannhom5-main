"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const themes = [
  {
    name: "storefront",
    file: "main.css",
    legacy: {
      "--color-text": "--ink",
      "--color-text-muted": "--muted",
      "--color-text-placeholder": "--muted",
      "--color-background": "--cream",
      "--color-surface": "--paper",
      "--color-primary": "--green",
      "--color-success": "--green",
      "--color-warning": "--gold",
      "--color-info": "--ink",
      "--color-danger": "--coral",
      "--color-disabled-text": "--muted",
      "--color-focus": "--coral",
      "--color-control-border": "#e1e5de",
      "--color-shipping": "#6b21a8",
      "--color-shipping-surface": "#f3e8ff",
    },
  },
  {
    name: "admin",
    file: "admin.css",
    legacy: {
      "--color-text": "--text-main",
      "--color-text-muted": "--text-muted",
      "--color-text-placeholder": "--text-muted",
      "--color-background": "--bg-main",
      "--color-surface": "--bg-card",
      "--color-primary": "--primary",
      "--color-success": "--success",
      "--color-warning": "--warning",
      "--color-info": "--info",
      "--color-danger": "--danger",
      "--color-disabled-text": "--text-muted",
      "--color-focus": "--primary",
      "--color-control-border": "#e5e7eb",
    },
  },
];

const requiredColorTokens = [
  "--color-text",
  "--color-text-muted",
  "--color-text-placeholder",
  "--color-background",
  "--color-surface",
  "--color-primary",
  "--color-on-primary",
  "--color-success",
  "--color-warning",
  "--color-info",
  "--color-danger",
  "--color-disabled-text",
  "--color-focus",
  "--color-control-border",
  "--color-success-surface",
  "--color-warning-surface",
  "--color-info-surface",
  "--color-danger-surface",
  "--color-shipping",
  "--color-shipping-surface",
];

function getRootTokens(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const rootBlock = source.match(/:root\s*\{([^}]*)\}/s);
  assert.ok(rootBlock, `${file} must define a :root token block`);
  return new Map(
    [...rootBlock[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
}

function getColor(tokens, semanticName, legacyName) {
  return tokens.get(semanticName) ||
    (legacyName?.startsWith("#") ? legacyName : tokens.get(legacyName)) ||
    (semanticName === "--color-on-primary" ? "#ffffff" : undefined);
}

function parseHex(value, name) {
  const match = value?.match(/^#([0-9a-f]{6})$/i);
  assert.ok(match, `${name} must resolve to a six-digit hex color, got ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
}

function luminance(color) {
  const [red, green, blue] = parseHex(color, "color").map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const theme of themes) {
  test(`${theme.name} theme defines the shared semantic color roles`, () => {
    const tokens = getRootTokens(theme.file);
    for (const token of requiredColorTokens) {
      assert.ok(tokens.has(token), `${theme.file} is missing ${token}`);
    }
  });

  test(`${theme.name} text, controls, status, disabled, and focus colors meet contrast thresholds`, async (t) => {
    const tokens = getRootTokens(theme.file);
    const pairs = [
      ["normal text", "--color-text", "--color-background", 4.5],
      ["large text", "--color-text", "--color-background", 3],
      ["muted text", "--color-text-muted", "--color-surface", 4.5],
      ["placeholder text", "--color-text-placeholder", "--color-surface", 4.5],
      ["button label", "--color-on-primary", "--color-primary", 4.5],
      ["success status", "--color-success", "--color-success-surface", 4.5],
      ["warning status", "--color-warning", "--color-warning-surface", 4.5],
      ["information status", "--color-info", "--color-info-surface", 4.5],
      ["shipping status", "--color-shipping", "--color-shipping-surface", 4.5],
      ["error status", "--color-danger", "--color-danger-surface", 4.5],
      ["disabled label", "--color-disabled-text", "--color-surface", 4.5],
      ["focus indicator", "--color-focus", "--color-background", 3],
      ["control boundary", "--color-control-border", "--color-surface", 3],
    ];

    for (const [label, foregroundName, backgroundName, minimum] of pairs) {
      await t.test(label, () => {
        const foreground = getColor(tokens, foregroundName, theme.legacy[foregroundName]);
        const background = getColor(tokens, backgroundName, theme.legacy[backgroundName]);
        const ratio = contrastRatio(foreground, background);
        assert.ok(
          ratio >= minimum,
          `${theme.file}: ${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1; expected at least ${minimum}:1`,
        );
      });
    }
  });
}
