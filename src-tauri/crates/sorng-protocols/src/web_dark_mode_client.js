/* Private page-only controller. Included inside the native readiness closure,
 * never exposed as a native API. Dynamic mode uses the pinned local DarkReader
 * API; filter modes use reversible CSS and do not require its dynamic engine.
 */
function createWebDarkModeController() {
  "use strict";
  var desired = null,
    revision = 0,
    disposed = false,
    dynamicOwned = false,
    style = null,
    loading = null,
    abortLoading = null;
  var defaults = {
    mode: "dynamic",
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0,
    backgroundColor: "#181a1b",
    textColor: "#e8e6e3",
    preserveMedia: true,
    customCss: "",
  };
  var safeFunctions =
    /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|calc|min|max|clamp|is|where|not|nth-child|nth-last-child|nth-of-type|nth-last-of-type|linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient)$/i;
  function themeOf(value) {
    if (value === undefined) return Object.assign({}, defaults);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid dark-mode extension theme");
    var keys = Object.keys(defaults);
    if (
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some(function (key) {
        return keys.indexOf(key) < 0;
      }) ||
      ["dynamic", "filter", "dynamicFilter", "customCss"].indexOf(value.mode) <
        0 ||
      typeof value.preserveMedia !== "boolean"
    )
      throw new Error("Invalid dark-mode extension options");
    ["brightness", "contrast", "sepia", "grayscale"].forEach(function (key) {
      var maximum = key === "brightness" || key === "contrast" ? 200 : 100;
      if (
        typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > maximum
      )
        throw new Error("Invalid dark-mode adjustment");
    });
    ["backgroundColor", "textColor"].forEach(function (key) {
      if (typeof value[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(value[key]))
        throw new Error("Invalid dark-mode color");
    });
    var css = value.customCss;
    if (
      typeof css !== "string" ||
      new TextEncoder().encode(css).length > 16384 ||
      /[@\\<]|\/\*|\*\/|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(css) ||
      /(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(css)
    )
      throw new Error("Custom CSS must contain local styles only");
    var functions = /([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(/g,
      match;
    while ((match = functions.exec(css))) {
      if (!safeFunctions.test(match[1]))
        throw new Error("Custom CSS contains an unsupported function");
    }
    return Object.assign({}, value);
  }
  function removeStyles() {
    if (style) style.remove();
    style = null;
    var owned = dynamicOwned;
    dynamicOwned = false;
    if (owned && window.DarkReader) window.DarkReader.disable();
  }
  function adjustments(theme) {
    return (
      "brightness(" +
      theme.brightness +
      "%) contrast(" +
      theme.contrast +
      "%) sepia(" +
      theme.sepia +
      "%) grayscale(" +
      theme.grayscale +
      "%)"
    );
  }
  // The filter engine inverts the whole page. Pre-invert selected base colors
  // with the inverse hue rotation so their displayed neutral values stay dark.
  function inverseColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255,
      g = parseInt(hex.slice(3, 5), 16) / 255,
      b = parseInt(hex.slice(5, 7), 16) / 255;
    // invert + 180-degree hue rotation is its own inverse (before adjustments).
    var rgb = [
      -0.574 * (1 - r) + 1.43 * (1 - g) + 0.144 * (1 - b),
      0.426 * (1 - r) + 0.43 * (1 - g) + 0.144 * (1 - b),
      0.426 * (1 - r) + 1.43 * (1 - g) - 0.856 * (1 - b),
    ];
    return (
      "rgb(" +
      rgb
        .map(function (value) {
          return Math.round(Math.max(0, Math.min(1, value)) * 255);
        })
        .join(",") +
      ")"
    );
  }
  function installStyles(theme) {
    var css = "";
    if (theme.mode === "filter") {
      css =
        "html{color-scheme:dark!important;background-color:" +
        inverseColor(theme.backgroundColor) +
        "!important;color:" +
        inverseColor(theme.textColor) +
        "!important;filter:invert(100%) hue-rotate(180deg) " +
        adjustments(theme) +
        "!important;}";
      if (theme.preserveMedia)
        css +=
          "img,video,canvas,svg image{filter:invert(100%) hue-rotate(180deg)!important;}";
    } else if (theme.mode === "dynamicFilter") {
      // Dynamic conversion already fixes background and text: do NOT invert twice.
      css = "html{filter:" + adjustments(theme) + "!important;}";
    }
    css += "\n" + theme.customCss;
    if (!css.trim()) return;
    style = document.createElement("style");
    style.className = "sorng-website-dark-mode";
    style.setAttribute("data-mode", theme.mode);
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  function loadDynamic() {
    if (window.DarkReader) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var script = document.createElement("script"),
        done = false;
      script.src = location.origin + "/__sortofremoteng_web_darkreader_v1.js";
      var timer = setTimeout(function () {
        finish(new Error("Dark-mode engine timed out"));
      }, 10000);
      function finish(error) {
        if (done) return;
        done = true;
        abortLoading = null;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          loading = null;
          script.remove();
          reject(error);
        } else resolve();
      }
      script.onload = function () {
        finish(
          window.DarkReader ? null : new Error("Dark-mode engine unavailable"),
        );
      };
      script.onerror = function () {
        finish(new Error("Dark-mode engine could not load"));
      };
      abortLoading = function () {
        finish(new Error("The document was closed"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return loading;
  }
  function applyDynamic(theme) {
    var reader = window.DarkReader;
    reader.setFetchMethod(function (url) {
      var target = new URL(url, location.href);
      if (
        target.origin !== location.origin ||
        target.username ||
        target.password
      )
        return Promise.reject(new Error("External dark-mode resource blocked"));
      return fetch(target.href, {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
    });
    var filtered = theme.mode === "dynamicFilter";
    // An engine can install some observers/styles before throwing. Treat that
    // attempt as owned too so the failure path always attempts to undo it.
    dynamicOwned = true;
    reader.enable(
      {
        mode: 1,
        brightness: filtered ? 100 : theme.brightness,
        contrast: filtered ? 100 : theme.contrast,
        sepia: filtered ? 0 : theme.sepia,
        grayscale: filtered ? 0 : theme.grayscale,
        darkSchemeBackgroundColor: theme.backgroundColor,
        darkSchemeTextColor: theme.textColor,
      },
      { ignoreImageAnalysis: theme.preserveMedia ? ["*"] : [] },
    );
  }
  return {
    set: function (payload) {
      if (disposed) return Promise.reject(new Error("The document was closed"));
      var ticket = ++revision;
      desired = null;
      removeStyles();
      if (!payload || typeof payload.enabled !== "boolean")
        return Promise.reject(new Error("Invalid dark-mode extension command"));
      if (!payload.enabled) return Promise.resolve();
      var theme;
      try {
        theme = themeOf(payload.theme);
      } catch (error) {
        return Promise.reject(error);
      }
      desired = theme;
      var dynamic = theme.mode === "dynamic" || theme.mode === "dynamicFilter";
      return (dynamic ? loadDynamic() : Promise.resolve())
        .then(function () {
          if (disposed || ticket !== revision || desired !== theme) return;
          if (dynamic) applyDynamic(theme);
          installStyles(theme);
        })
        .catch(function (error) {
          if (ticket === revision) {
            desired = null;
            removeStyles();
          }
          throw error;
        });
    },
    dispose: function () {
      disposed = true;
      desired = null;
      revision++;
      if (abortLoading) abortLoading();
      try {
        removeStyles();
      } catch (_) {
        // The page may have replaced its own API. Teardown must still let the
        // outer automation bridge remove its listeners and revoke the document.
      }
    },
  };
}
