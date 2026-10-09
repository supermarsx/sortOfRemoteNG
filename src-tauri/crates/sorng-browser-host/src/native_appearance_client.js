/* Native-only factory(engine, notify) -> { apply(config, revision, main), dispose }.
 * cef_appearance_renderer.rs owns the sole vendored DarkReader initialization,
 * including private CommonJS exports and private window/chrome shims. Retain the
 * returned controller in CEF only. No page bridge or content scanning. */
(function (reader, notify) {
  "use strict";
  const nativeWindow = globalThis.window;
  const doc = nativeWindow.document;
  const pageOrigin = nativeWindow.location.origin;
  const nativeFetch = typeof nativeWindow.fetch === "function"
    ? nativeWindow.fetch.bind(nativeWindow) : null;
  const addEvent = nativeWindow.addEventListener.bind(nativeWindow);
  const removeEvent = nativeWindow.removeEventListener.bind(nativeWindow);
  const functions = new Set([
    "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch",
    "color", "color-mix", "calc", "min", "max", "clamp", "linear-gradient",
    "radial-gradient", "conic-gradient", "repeating-linear-gradient",
    "repeating-radial-gradient", "repeating-conic-gradient", "is", "where",
    "not", "nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type",
  ]);
  const themeKeys = ["followAppTheme", "mode", "brightness", "contrast", "sepia",
    "grayscale", "backgroundColor", "textColor", "preserveMedia", "customCss"];
  let readerReady = false;
  let dynamicOwned = false;
  let style = null;
  let activeKey = null;
  let enabled = false;
  let disposed = false;
  let epoch = 0;
  let lastRevision = null;
  let mainFrame = null;
  let pendingRoot = null;
  const fetching = new Set();

  function cancelRootWait() {
    if (!pendingRoot) return;
    doc.removeEventListener("readystatechange", pendingRoot.ready);
    doc.removeEventListener("DOMContentLoaded", pendingRoot.ready);
    nativeWindow.clearTimeout(pendingRoot.timer);
    pendingRoot.observer.disconnect();
    pendingRoot = null;
  }

  function ownData(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !keys.includes(key)
      || !Object.hasOwn(descriptors[key], "value"))) throw Error();
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  }

  function localCss(css) {
    if (typeof css !== "string" || css.length > 16384) throw Error();
    let bytes = 0;
    for (const char of css) {
      const code = char.codePointAt(0);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) throw Error();
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    }
    if (bytes > 16384 || /@|\\|\/\*|\*\/|</.test(css)
      || /(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(css)) throw Error();
    for (const match of css.matchAll(/([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(/g)) {
      if (!functions.has(match[1].toLowerCase())) throw Error();
    }
    return css;
  }

  function normalize(config) {
    const input = ownData(config, ["enabled", "theme"]);
    if (typeof input.enabled !== "boolean") throw Error();
    if (!input.enabled && input.theme === undefined) return { enabled: false };
    const theme = ownData(input.theme, themeKeys);
    if (theme.followAppTheme !== undefined && typeof theme.followAppTheme !== "boolean") throw Error();
    if (!["dynamic", "filter", "dynamicFilter", "customCss"].includes(theme.mode)
      || typeof theme.preserveMedia !== "boolean") throw Error();
    for (const [key, limit] of [["brightness", 200], ["contrast", 200], ["sepia", 100], ["grayscale", 100]]) {
      if (typeof theme[key] !== "number" || !Number.isFinite(theme[key]) || theme[key] < 0 || theme[key] > limit) throw Error();
    }
    for (const key of ["backgroundColor", "textColor"]) {
      if (typeof theme[key] !== "string" || !/^#[a-f0-9]{6}$/i.test(theme[key])) throw Error();
      theme[key] = theme[key].toLowerCase();
    }
    theme.customCss = localCss(theme.customCss);
    // Stable order keeps repeated native snapshots from restarting DarkReader.
    return { enabled: input.enabled, theme: Object.fromEntries(themeKeys.map(key => [key,
      key === "followAppTheme" ? theme[key] !== false : theme[key]])) };
  }

  function cancelFetches() {
    epoch++;
    for (const controller of fetching) controller.abort();
    fetching.clear();
  }

  function cleanup() {
    cancelRootWait();
    cancelFetches();
    enabled = false;
    activeKey = null;
    let ok = true;
    if (dynamicOwned) {
      // enable() can partially install before throwing, so ownership is set
      // before calling it. Never disable a page's unrelated DarkReader object.
      try { reader.disable(); dynamicOwned = false; } catch { ok = false; }
    }
    if (style) {
      try { style.remove(); } catch { ok = false; }
      style = null;
    }
    return ok;
  }

  async function fetchLocal(rawUrl) {
    const unavailable = () => Error("Native appearance resource unavailable");
    if (!enabled || disposed || !nativeFetch || typeof rawUrl !== "string" || rawUrl.length > 16384
      || fetching.size >= 16 || typeof nativeWindow.AbortController !== "function") throw unavailable();
    let url;
    try { url = new URL(rawUrl, nativeWindow.location.href); } catch { throw unavailable(); }
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== pageOrigin
      || nativeWindow.location.origin !== pageOrigin || url.username || url.password) throw unavailable();
    const generation = epoch;
    const controller = new nativeWindow.AbortController();
    fetching.add(controller);
    const release = () => { nativeWindow.clearTimeout(timeout); fetching.delete(controller); };
    const timeout = nativeWindow.setTimeout(() => { controller.abort(); release(); }, 15000);
    const current = () => enabled && !disposed && generation === epoch && !controller.signal.aborted;
    try {
      // Ordinary page fetch only: native request admission, route, TLS and CSP
      // remain authoritative. No app fetch service or privileged native bridge.
      const response = await nativeFetch(url.href, {
        credentials: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal,
      });
      if (!current()) throw unavailable();
      // Keep cancellation live through body consumption, not just headers.
      // The pinned bundle consumes text()/blob(); no replacement network path.
      return new Proxy(response, {
        get(target, key) {
          if (["text", "blob", "arrayBuffer", "json"].includes(key)) return async () => {
            try {
              if (!current()) throw unavailable();
              const result = await target[key]();
              if (!current()) throw unavailable();
              return result;
            } catch { throw unavailable(); }
            finally { release(); }
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    } catch { controller.abort(); release(); throw unavailable(); }
  }

  function adjustments(theme) {
    return `brightness(${theme.brightness}%) contrast(${theme.contrast}%) sepia(${theme.sepia}%) grayscale(${theme.grayscale}%)`;
  }

  function inverseColor(hex) {
    const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const values = [
      -0.574 * (1 - r) + 1.43 * (1 - g) + 0.144 * (1 - b),
      0.426 * (1 - r) + 0.43 * (1 - g) + 0.144 * (1 - b),
      0.426 * (1 - r) + 1.43 * (1 - g) - 0.856 * (1 - b),
    ];
    return `rgb(${values.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(",")})`;
  }

  function cssFor(theme, main) {
    let css = "";
    if (theme.mode === "filter") {
      css = `html:root{color-scheme:dark!important;background-color:${inverseColor(theme.backgroundColor)}!important;color:${inverseColor(theme.textColor)}!important;${main ? `filter:invert(100%) hue-rotate(180deg) ${adjustments(theme)}!important;` : ""}}`;
      if (theme.preserveMedia) css += "img,video,canvas,svg image,object,embed{filter:invert(100%) hue-rotate(180deg)!important;}";
    } else if (theme.mode === "dynamicFilter") {
      // Dynamic conversion already darkens colors. This is one adjustment
      // layer, never another inversion or a second set of engine adjustments.
      if (main) css = `html:root{filter:${adjustments(theme)}!important;}`;
    } else if (theme.mode === "customCss") {
      css = `html:root{color-scheme:dark!important;${main ? `filter:${adjustments(theme)}!important;` : ""}}html:root,body{background-color:${theme.backgroundColor}!important;color:${theme.textColor}!important;}`;
    }
    return css + "\n" + theme.customCss;
  }

  function applyTheme(config, main) {
    if (disposed) return false;
    if (config === null) return cleanup();
    let next;
    try { next = normalize(config); } catch { cleanup(); return false; }
    if (!next.enabled) return cleanup();
    const key = JSON.stringify(next);
    if (key === activeKey && (!style || style.isConnected)) return true;
    if (!cleanup()) return false;
    if (doc !== nativeWindow.document || nativeWindow.location.origin !== pageOrigin || !doc.documentElement) return false;
    // Do not take over or invert another DarkReader conversion. These are
    // targeted markers, not an observer or an all-elements content scan.
    if (doc.querySelector('meta[name="darkreader"],meta[name="darkreader-lock"]')
      || doc.documentElement.hasAttribute("data-darkreader-mode")) return false;
    const theme = next.theme;
    try {
      enabled = true;
      if (theme.mode === "dynamic" || theme.mode === "dynamicFilter") {
        if (!readerReady) {
          if (!reader || typeof reader.enable !== "function" || typeof reader.disable !== "function"
            || typeof reader.setFetchMethod !== "function") throw Error();
          reader.setFetchMethod(fetchLocal);
          readerReady = true;
        }
        const filtered = theme.mode === "dynamicFilter";
        dynamicOwned = true;
        reader.enable({
          mode: 1, brightness: filtered ? 100 : theme.brightness,
          contrast: filtered ? 100 : theme.contrast, sepia: filtered ? 0 : theme.sepia,
          grayscale: filtered ? 0 : theme.grayscale,
          darkSchemeBackgroundColor: theme.backgroundColor, darkSchemeTextColor: theme.textColor,
          immediateModify: true,
        }, { ignoreImageAnalysis: theme.preserveMedia ? ["*"] : [] });
      }
      const css = cssFor(theme, main);
      if (css.trim()) {
        style = doc.createElement("style");
        style.className = "sorng-native-appearance darkreader";
        style.setAttribute("data-mode", theme.mode);
        style.textContent = css;
        (doc.head || doc.documentElement).appendChild(style);
      }
      activeKey = key;
      return true;
    } catch { cleanup(); return false; }
  }

  function apply(config, revision, main) {
    if (disposed || typeof notify !== "function" || typeof revision !== "string"
      || !/^\d{1,20}$/.test(revision) || typeof main !== "boolean"
      || (mainFrame !== null && mainFrame !== main)) return false;
    const sequence = BigInt(revision);
    if (lastRevision !== null && sequence < lastRevision) return false;
    if (lastRevision === sequence) return true;
    lastRevision = sequence;
    mainFrame = main;
    cancelRootWait();
    const finish = value => {
      if (disposed || lastRevision !== sequence) return false;
      const ok = applyTheme(value, main);
      const status = ok ? enabled ? "applied" : "off" : "fallback";
      try { notify(revision, status); } catch { cleanup(); return false; }
      return ok;
    };
    let normalized;
    try { normalized = config === null ? null : normalize(config); }
    catch { return finish(config); }
    if (normalized?.enabled && !doc.documentElement) {
      // CEF can create V8 before the HTML parser has created a root. Preserve
      // styling before the parser can paint. Native auto-dark may already be
      // off after the previous document's successful enhancement. Waiting for
      // DOMContentLoaded/readystatechange would leave this document unthemed.
      // Observe only the root insertion, then disconnect; never scan content.
      cleanup();
      const ready = () => {
        if (!pendingRoot || !doc.documentElement) return;
        cancelRootWait();
        finish(normalized);
      };
      const timer = nativeWindow.setTimeout(() => {
        if (!pendingRoot || disposed || lastRevision !== sequence) return;
        cancelRootWait();
        if (doc.documentElement) finish(normalized);
        else { try { notify(revision, "fallback"); } catch { cleanup(); } }
      }, 4000);
      const observer = new nativeWindow.MutationObserver(ready);
      pendingRoot = { ready, timer, observer };
      observer.observe(doc, { childList: true });
      doc.addEventListener("readystatechange", ready);
      doc.addEventListener("DOMContentLoaded", ready);
      return true; // accepted, not yet acknowledged
    }
    return finish(normalized);
  }

  function dispose() {
    cleanup();
    disposed = true;
    removeEvent("pagehide", pagehide);
  }
  function pagehide(event) {
    // BFCache keeps this exact context and controller alive. Removing styles
    // here restores a light document on Back, with no new CEF context install.
    // Cancel in-flight resource reads but preserve the owned palette/revision.
    if (event.persisted) cancelFetches();
    else dispose();
  }
  addEvent("pagehide", pagehide);
  return Object.freeze({ apply, dispose });
})
