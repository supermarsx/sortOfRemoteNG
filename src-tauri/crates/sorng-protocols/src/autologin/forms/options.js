/* Private auto-login forms/options.js. Assembled inside the coordinator IIFE. */
// The form on a device UI may render after DOMContentLoaded (SPA). Retry
// detection a few times with backoff, then give up. We only ever SUBMIT
// once — the retries are purely to *find* the form, not to resubmit.
function normalizeFormOptions(raw) {
  if (raw === undefined)
    return {
      version: 1,
      fillDelayMs: 0,
      submitDelayMs: 0,
      detectionTimeoutMs: 8000,
      submit: true,
      fields: [],
    };
  var keys = [
    "version",
    "formSelector",
    "fillDelayMs",
    "submitDelayMs",
    "detectionTimeoutMs",
    "submit",
    "fields",
  ];
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some(function (key) {
      return keys.indexOf(key) < 0;
    }) ||
    raw.version !== 1 ||
    typeof raw.submit !== "boolean"
  )
    throw new Error("invalid-form-options");
  function selector(value) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 512 ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw new Error("invalid-form-options");
    document.createDocumentFragment().querySelector(value);
    return value;
  }
  ["fillDelayMs", "submitDelayMs", "detectionTimeoutMs"].forEach(
    function (key) {
      var min = key === "detectionTimeoutMs" ? 1000 : 0;
      var max = key === "detectionTimeoutMs" ? 60000 : 30000;
      if (!Number.isInteger(raw[key]) || raw[key] < min || raw[key] > max)
        throw new Error("invalid-form-options");
    },
  );
  if (
    raw.detectionTimeoutMs < raw.fillDelayMs + raw.submitDelayMs ||
    !Array.isArray(raw.fields) ||
    raw.fields.length > 16
  )
    throw new Error("invalid-form-options");
  var seen = new Set();
  var bytes = 0;
  var fields = raw.fields.map(function (field) {
    if (
      !field ||
      typeof field !== "object" ||
      Array.isArray(field) ||
      Object.keys(field).some(function (key) {
        return key !== "selector" && key !== "value";
      })
    )
      throw new Error("invalid-form-options");
    var target = selector(field.selector);
    if (
      seen.has(target) ||
      typeof field.value !== "string" ||
      field.value.length > 4096 ||
      field.value.indexOf("\0") !== -1
    )
      throw new Error("invalid-form-options");
    seen.add(target);
    bytes += new TextEncoder().encode(field.value).length;
    if (bytes > 16384) throw new Error("invalid-form-options");
    return { selector: target, value: field.value };
  });
  return {
    version: 1,
    formSelector:
      raw.formSelector === undefined ? undefined : selector(raw.formSelector),
    fillDelayMs: raw.fillDelayMs,
    submitDelayMs: raw.submitDelayMs,
    detectionTimeoutMs: raw.detectionTimeoutMs,
    submit: raw.submit,
    fields: fields,
  };
}
