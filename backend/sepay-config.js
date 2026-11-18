function normalizeSePayConfig(values = {}) {
  const config = {
    apiKey: typeof values.apiKey === "string" ? values.apiKey.trim() : "",
    bankCode: typeof values.bankCode === "string" ? values.bankCode.trim() : "",
    bankName: typeof values.bankName === "string" ? values.bankName.trim() : "",
    accountNumber: typeof values.accountNumber === "string"
      ? values.accountNumber.trim()
      : "",
    accountName: typeof values.accountName === "string"
      ? values.accountName.trim()
      : "",
  };
  const invalid = [];

  if (Buffer.byteLength(config.apiKey, "utf8") < 16 || /\s/.test(config.apiKey)) {
    invalid.push("SEPAY_API_KEY");
  }
  if (!/^\d{6}$/.test(config.bankCode)) {
    invalid.push("SEPAY_BANK_CODE");
  }
  if (
    config.bankName.length < 2 ||
    config.bankName.length > 128 ||
    /[\u0000-\u001F\u007F]/.test(config.bankName)
  ) {
    invalid.push("SEPAY_BANK_NAME");
  }
  if (!/^\d{6,19}$/.test(config.accountNumber)) {
    invalid.push("SEPAY_ACCOUNT_NUMBER");
  }
  if (
    config.accountName.length < 2 ||
    config.accountName.length > 128 ||
    /[\u0000-\u001F\u007F]/.test(config.accountName)
  ) {
    invalid.push("SEPAY_ACCOUNT_NAME");
  }

  return { config, invalid, valid: invalid.length === 0 };
}

module.exports = { normalizeSePayConfig };
