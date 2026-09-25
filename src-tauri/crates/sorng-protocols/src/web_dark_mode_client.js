/* Private page-only controller. Included inside the native readiness closure,
 * never exposed as a native API. Dynamic mode uses the pinned local DarkReader
 * API; filter modes use reversible CSS and do not require its dynamic engine.
 *
 * The app only ever addresses the outermost proxied document, but a legacy
 * device page keeps what the user sees in child frames and may paint nothing at
 * all itself. Every proxied document therefore installs its own controller at
 * document start and joins a registry owned by the outermost same-origin realm:
 * see sorngWebDarkMode() at the bottom of this file, which is called eagerly so
 * a frame themes itself before the app knows it exists.
 */
function createWebDarkModeController() {
  "use strict";
  var desired = null,
    revision = 0,
    disposed = false,
    dynamicOwned = false,
    runtimeInstalled = false,
    loadingPalette = false,
    // The app says so when the connection's page-script policy forbids loading
    // the engine asset. It is never inferred here and never relaxes a policy:
    // it only decides that this document themes itself with plain CSS.
    cssOnly = false,
    style = null,
    styleText = "",
    bootstrap = document.getElementById("__sorng_dark_bootstrap_v1"),
    bootstrapText = bootstrap ? bootstrap.textContent : "",
    forcedInline = [],
    loading = null,
    abortLoading = null,
    // Only the outermost proxied document carries the filter layer: a filter on
    // its root element composites over every frame below it.
    outermost = isOutermostDocument(),
    framesetStyled = false,
    borders = null,
    adopted = [],
    watched = [],
    observer = null,
    shadowStyles = [],
    originalAttachShadow = null,
    attachShadowHook = null,
    scanQueued = false;
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
  // A frameset document paints no content of its own, and the element is not in
  // the DOM yet while the readiness script runs, so this is asked again later.
  function frameset() {
    try {
      return !!document.querySelector("frameset");
    } catch (_) {
      return false;
    }
  }
  function removeStyles() {
    releaseShadows(false);
    if (style) style.remove();
    style = null;
    framesetStyled = false;
    restoreBorders();
    releaseAdopted();
    var owned = dynamicOwned;
    dynamicOwned = false;
    runtimeInstalled = false;
    if (owned && window.DarkReader) window.DarkReader.disable();
  }
  function removeBootstrap() {
    if (bootstrap) bootstrap.remove();
    bootstrap = null;
    bootstrapText = "";
    loadingPalette = false;
    document.documentElement.removeAttribute("data-sorng-dark-ready");
    restoreInline();
  }
  function installBootstrap(theme) {
    if (!bootstrap || !bootstrap.isConnected) {
      bootstrap = document.createElement("style");
      bootstrap.id = "__sorng_dark_bootstrap_v1";
      var parent = document.head || document.documentElement;
      parent.insertBefore(bootstrap, parent.firstChild);
    }
    // Important declarations in the first layer beat later site layers and
    // unlayered !important rules, independently of their specificity/order.
    // Keep the canvas and cPanel protection for the entire forced-mode session.
    bootstrapText =
      (loadingPalette
        ? "@layer sorng-force-dark,sorng-dark-loading;"
        : "@layer sorng-force-dark;") +
      "@layer sorng-force-dark{" +
      "html:root{color-scheme:dark!important}" +
      "html:root,html:root body,html:root frameset{background-color:" +
      theme.backgroundColor +
      "!important;color:" +
      theme.textColor +
      "!important;transition:none!important}" +
      cpanelCss(theme) +
      "}" +
      (loadingPalette
        ? "@layer sorng-dark-loading{html:root:not([data-sorng-dark-ready]) body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){background-color:transparent!important;color:" +
          theme.textColor +
          "!important;transition:none!important}}"
        : "");
    if (bootstrap.textContent !== bootstrapText)
      bootstrap.textContent = bootstrapText;
  }
  function restoreInline() {
    forcedInline.forEach(function (entry) {
      if (entry.element.style.getPropertyValue(entry.property) === entry.owned)
        entry.element.style.setProperty(
          entry.property,
          entry.value,
          entry.priority,
        );
    });
    forcedInline = [];
  }
  function protectInline(element, property, value) {
    // Inline !important outranks even our first cascade layer. Reapply only
    // properties which explicitly compete with that layer, before the next
    // paint, and restore the site's latest value when forced mode is disabled.
    var inline = element.style;
    if (!inline || inline.getPropertyPriority(property) !== "important") return;
    var entry = forcedInline.find(function (item) {
      return item.element === element && item.property === property;
    });
    var current = inline.getPropertyValue(property);
    if (entry && current === entry.owned) return;
    if (!entry) {
      entry = { element: element, property: property };
      forcedInline.push(entry);
    }
    entry.value = current;
    entry.priority = "important";
    inline.setProperty(property, value, "important");
    entry.owned = inline.getPropertyValue(property);
  }
  function protectPalette(theme) {
    if (!bootstrap) return;
    var nodes = document.querySelectorAll("html,body,frameset");
    for (var index = 0; index < nodes.length; index++) {
      protectInline(nodes[index], "background-color", theme.backgroundColor);
      protectInline(nodes[index], "color", theme.textColor);
      protectInline(nodes[index], "color-scheme", "dark");
    }
    if (document.querySelector(cpanelMarker)) {
      protectCpanelSurfaces(document, theme);
    }
    protectShadows(theme);
    // enable() may return before the engine is active (hidden document, missing
    // head or loading CSS). Its own fallback is cleared after conversion. The
    // transparent loading palette stays until then; the force layer never goes
    // away. CSS-only fallback is already synchronous and must not retain the
    // loading layer indefinitely.
    var fallback = document.querySelector(".darkreader--fallback");
    var userAgent = document.querySelector(".darkreader--user-agent");
    var ready =
      runtimeInstalled &&
      (theme.mode === "customCss" ||
        engineless(theme) ||
        (dynamicOwned &&
          userAgent &&
          userAgent.textContent &&
          document.documentElement.getAttribute("data-darkreader-mode") ===
            "dynamic" &&
          fallback &&
          !fallback.textContent));
    if (ready) {
      if (!document.documentElement.hasAttribute("data-sorng-dark-ready"))
        document.documentElement.setAttribute("data-sorng-dark-ready", "");
    } else if (document.documentElement.hasAttribute("data-sorng-dark-ready"))
      document.documentElement.removeAttribute("data-sorng-dark-ready");
  }
  function protectCpanelSurfaces(root, theme) {
    function protect(element) {
      var background = element.matches(cpanelHeaders)
        ? mixColor(theme.backgroundColor, theme.textColor, 12)
        : element.matches(cpanelPanels)
          ? mixColor(theme.backgroundColor, theme.textColor, 8)
          : theme.backgroundColor;
      protectInline(element, "background-color", background);
      protectInline(element, "color", theme.textColor);
      if (element.matches(cpanelHeaders))
        protectInline(element, "background-image", "none");
    }
    if (root.nodeType === 1 && root.matches(cpanelSurfaces)) protect(root);
    root.querySelectorAll(cpanelSurfaces).forEach(protect);
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
  function borderColor(theme) {
    return mixColor(theme.backgroundColor, theme.textColor, 28);
  }
  function mixColor(background, text, textPercent) {
    var parts = [];
    for (var offset = 1; offset < 7; offset += 2)
      parts.push(
        Math.round(
          (parseInt(background.slice(offset, offset + 2), 16) *
            (100 - textPercent) +
            parseInt(text.slice(offset, offset + 2), 16) * textPercent) /
            100,
        ),
      );
    return "rgb(" + parts.join(",") + ")";
  }
  var cpanelMarker =
    "#cpanel_body,[href*='/frontend/jupiter/'],[src*='/frontend/jupiter/'],[href*='/frontend/meridian/'],[src*='/frontend/meridian/'],[href*='/frontend/paper_lantern/'],[src*='/frontend/paper_lantern/']";
  var cpanelShell =
    "#content,#main-content,.main-content,.page-content,[class*='cpanel-main'],[class*='cpanel-content']";
  var cpanelPanels =
    ".card,.panel,.panel-body,.well,.widget,.list-group-item,.modal-content,.dropdown-menu,.popover,table,thead,tbody,tr,td,th,[class*='cpanel-card'],[class*='cpanel-panel']";
  var cpanelHeaders =
    "div.header,header,[role='banner'],#header,#topbar,#top-bar,.topbar,.top-bar,.navbar,.navbar-header,.navbar-default,.card-header,.card-footer,.panel-heading,.panel-footer,.modal-header,.modal-footer";
  var cpanelSurfaces = cpanelShell + "," + cpanelPanels + "," + cpanelHeaders;
  function cpanelCss(theme, shadow) {
    var root = shadow ? "" : "html:root:has(:is(" + cpanelMarker + ")) ";
    var surface = mixColor(theme.backgroundColor, theme.textColor, 8);
    var header = mixColor(theme.backgroundColor, theme.textColor, 12);
    var border = mixColor(theme.backgroundColor, theme.textColor, 22);
    return (
      root +
      ":is(" +
      cpanelShell +
      "){background-color:" +
      theme.backgroundColor +
      "!important;color:" +
      theme.textColor +
      "!important;transition:none!important}" +
      root +
      ":is(" +
      cpanelPanels +
      "){background-color:" +
      surface +
      "!important;color:" +
      theme.textColor +
      "!important;border-color:" +
      border +
      "!important;transition:none!important}" +
      root +
      ":is(" +
      cpanelHeaders +
      "){background-color:" +
      header +
      "!important;background-image:none!important;color:" +
      theme.textColor +
      "!important;border-color:" +
      border +
      "!important;transition:none!important}"
    );
  }
  function headerHost(host) {
    while (host) {
      if (host.closest(cpanelHeaders)) return true;
      host = host.getRootNode().host;
    }
    return false;
  }
  function themeShadow(root, theme) {
    var entry = shadowStyles.find(function (item) {
      return item.root === root;
    });
    if (!entry) {
      entry = {
        root: root,
        style: document.createElement("style"),
        observer: null,
        repairQueued: false,
        repairTimer: null,
        pendingNodes: [],
        fullRepair: false,
      };
      entry.style.className = "sorng-cpanel-shadow-dark";
      if (typeof MutationObserver === "function") {
        entry.observer = new MutationObserver(function (records) {
          // Shadow mutations are isolated from the document observer. Repair
          // only changed subtrees instead of rescanning the root, document,
          // frames and every other shadow tree. One timer bounds continuously
          // animated dashboards without delaying the first synchronous theme.
          function queueNode(node) {
            if (
              node.nodeType === 1 &&
              node !== entry.style &&
              entry.pendingNodes.length < 256
            )
              entry.pendingNodes.push(node);
          }
          records.forEach(function (record) {
            if (record.target === entry.style) entry.fullRepair = true;
            queueNode(record.target);
            Array.prototype.forEach.call(
              record.addedNodes || [],
              function (node) {
                queueNode(node);
              },
            );
            Array.prototype.forEach.call(
              record.removedNodes || [],
              function (node) {
                if (node === entry.style) entry.fullRepair = true;
              },
            );
          });
          if (
            entry.repairQueued ||
            disposed ||
            !desired ||
            desired.mode === "filter"
          )
            return;
          entry.repairQueued = true;
          entry.repairTimer = root.ownerDocument.defaultView.setTimeout(
            function () {
              entry.repairTimer = null;
              entry.repairQueued = false;
              if (
                disposed ||
                !desired ||
                desired.mode === "filter" ||
                shadowStyles.indexOf(entry) < 0
              )
                return;
              var nodes = entry.pendingNodes.splice(0);
              var fullRepair = entry.fullRepair;
              entry.fullRepair = false;
              try {
                if (fullRepair || entry.style.parentNode !== root)
                  themeShadow(root, desired);
                else {
                  entry.observer.disconnect();
                  nodes
                    .filter(function (node, index, all) {
                      return (
                        node.isConnected &&
                        root.contains(node) &&
                        all.indexOf(node) === index &&
                        !all.some(function (ancestor) {
                          return ancestor !== node && ancestor.contains?.(node);
                        })
                      );
                    })
                    .forEach(function (node) {
                      protectCpanelSurfaces(node, desired);
                    });
                  observeShadow(entry);
                }
              } catch (_) {
                // A page-owned root may disappear while its repair is queued.
                observeShadow(entry);
              }
            },
            16,
          );
        });
      }
      shadowStyles.push(entry);
    }
    // Do not observe our own style/attribute repairs. cPanel's components can
    // react to those records and write again; observing both sides creates a
    // feedback loop that starves the tab and eventually the desktop process.
    if (entry.observer) entry.observer.disconnect();
    try {
      var css =
        "@layer sorng-force-dark;@layer sorng-force-dark{" +
        cpanelCss(theme, true);
      if (headerHost(root.host))
        css +=
          ":host{color-scheme:dark!important;background-color:" +
          mixColor(theme.backgroundColor, theme.textColor, 12) +
          "!important;color:" +
          theme.textColor +
          "!important;transition:none!important}";
      css += "}";
      if (entry.style.textContent !== css) entry.style.textContent = css;
      if (entry.style.parentNode !== root)
        root.insertBefore(entry.style, root.firstChild);
      if (entry.style.disabled) entry.style.disabled = false;
      entry.style.removeAttribute("media");
      entry.style.removeAttribute("disabled");
      protectCpanelSurfaces(root, theme);
    } finally {
      observeShadow(entry);
    }
  }
  function observeShadow(entry) {
    if (
      !entry.observer ||
      disposed ||
      !desired ||
      desired.mode === "filter" ||
      shadowStyles.indexOf(entry) < 0
    )
      return;
    entry.observer.observe(entry.root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "id", "media", "disabled"],
    });
  }
  function scanShadows(node, theme) {
    node.querySelectorAll("*").forEach(function (element) {
      if (element.shadowRoot) {
        themeShadow(element.shadowRoot, theme);
        scanShadows(element.shadowRoot, theme);
      }
    });
  }
  function protectShadows(theme) {
    if (theme.mode === "filter" || !document.querySelector(cpanelMarker))
      return;
    // A root attached to an existing element creates no document mutation.
    // Install its first sheet before attachShadow returns to page code.
    if (
      !attachShadowHook &&
      typeof Element.prototype.attachShadow === "function"
    ) {
      originalAttachShadow = Element.prototype.attachShadow;
      var delegate = originalAttachShadow;
      var hook = function (options) {
        var root = delegate.call(this, options);
        if (
          attachShadowHook === hook &&
          !disposed &&
          desired &&
          desired.mode !== "filter" &&
          root.mode === "open" &&
          document.querySelector(cpanelMarker)
        ) {
          try {
            themeShadow(root, desired);
          } catch (_) {
            // A page-owned root must still be returned if it refuses styling.
          }
        }
        return root;
      };
      attachShadowHook = hook;
      Element.prototype.attachShadow = attachShadowHook;
    }
    scanShadows(document, theme);
  }
  function releaseShadows(keepAppearance) {
    if (attachShadowHook && Element.prototype.attachShadow === attachShadowHook)
      Element.prototype.attachShadow = originalAttachShadow;
    // A page or engine may retain our wrapper underneath its own. Keep its
    // original delegate usable, but make the wrapper inert after disable.
    attachShadowHook = null;
    shadowStyles.forEach(function (entry) {
      if (entry.observer) entry.observer.disconnect();
      if (entry.repairTimer !== null)
        entry.root.ownerDocument.defaultView.clearTimeout(entry.repairTimer);
      if (!keepAppearance) entry.style.remove();
    });
    shadowStyles = [];
  }
  // bgcolor, text, link and font color are presentational attributes, not inline
  // styles, so the dynamic engine's inline-style pass is what normally rewrites
  // them. Without an engine they survive every base rule and leave old device
  // pages black on near-black, so spell them out on the engine-less paths only.
  function legacyCss(theme) {
    return (
      "[bgcolor]{background-color:" +
      theme.backgroundColor +
      "!important;}[background]{background-image:none!important;}" +
      "body[text],body[text] td,body[text] th,body[text] p,body[text] div," +
      "body[text] span,body[text] li{color:" +
      theme.textColor +
      "!important;}font[color],font[color] *{color:inherit!important;}" +
      "table,td,th,hr{border-color:" +
      borderColor(theme) +
      "!important;}"
    );
  }
  // What a document gets when nothing can convert it: flat base colors plus the
  // readability rules above. Used for frames the proxy never served and for the
  // dynamic modes when the engine asset is refused.
  function baseCss(theme) {
    return (
      "html,body{background-color:" +
      theme.backgroundColor +
      "!important;color:" +
      theme.textColor +
      "!important;}" +
      legacyCss(theme)
    );
  }
  // Both dynamic modes are the engine; without it they would leave the page
  // untouched, so they fall back to the CSS path instead of doing nothing.
  function engineless(theme) {
    return (
      cssOnly && (theme.mode === "dynamic" || theme.mode === "dynamicFilter")
    );
  }
  function installStyles(theme) {
    var css = "";
    framesetStyled = frameset();
    if (theme.mode === "filter") {
      if (outermost)
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
    } else if (engineless(theme)) {
      // The adjustment layer post-processes an engine-converted page; over the
      // flat colors below it would only wash them out, so it is left off here.
      css = baseCss(theme);
    } else if (theme.mode === "dynamicFilter") {
      // Dynamic conversion already fixes background and text: do NOT invert twice.
      if (outermost) css = "html{filter:" + adjustments(theme) + "!important;}";
    } else if (theme.mode === "customCss") css = legacyCss(theme);
    // Pure filter mode inverts the whole document, gutters included, and this
    // controller's approximate pre-inversion would tint them instead.
    if (framesetStyled && theme.mode !== "filter")
      css +=
        "html,frameset{background-color:" +
        theme.backgroundColor +
        "!important;}";
    // cPanel's Jupiter, Meridian and legacy shells use opaque Bootstrap-style
    // surfaces which can survive dynamic conversion or be replaced after it.
    // Keep a local, selector-scoped layer for those panels for the document's
    // lifetime. Pure filter mode is excluded because it inverts the page once.
    if (theme.mode !== "filter") css += cpanelCss(theme);
    css += "\n" + theme.customCss;
    if (!css.trim()) return;
    style = document.createElement("style");
    style.className = "sorng-website-dark-mode";
    style.setAttribute("data-mode", theme.mode);
    style.textContent = css;
    styleText = css;
    (document.head || document.documentElement).appendChild(style);
  }
  // The gutters between frames are painted from the frameset's `bordercolor`
  // presentational attribute; no stylesheet reaches them.
  function paintBorders(theme) {
    if (theme.mode === "filter") return;
    var sets;
    try {
      sets = document.querySelectorAll("frameset");
    } catch (_) {
      return;
    }
    if (!sets.length) return;
    if (!borders) borders = [];
    var colour = theme.backgroundColor;
    for (var index = 0; index < sets.length; index++) {
      var element = sets[index],
        known = false;
      for (var seen = 0; seen < borders.length; seen++)
        if (borders[seen].element === element) known = true;
      if (!known)
        borders.push({
          element: element,
          value: element.hasAttribute("bordercolor")
            ? element.getAttribute("bordercolor")
            : null,
        });
      try {
        element.setAttribute("bordercolor", colour);
      } catch (_) {
        // A page may seal its own elements; the frames themselves still theme.
      }
    }
  }
  function restoreBorders() {
    var entries = borders;
    borders = null;
    if (!entries) return;
    for (var index = 0; index < entries.length; index++)
      try {
        if (entries[index].value === null)
          entries[index].element.removeAttribute("bordercolor");
        else
          entries[index].element.setAttribute(
            "bordercolor",
            entries[index].value,
          );
      } catch (_) {
        // The element may already be gone with its document.
      }
  }
  // Frames the proxy never served — document.write, srcdoc, about:blank — carry
  // no controller of their own. The dynamic engine is document-global and cannot
  // be pointed at a foreign document, so their parent styles them with CSS only.
  function adoptedCss(theme) {
    var css = "";
    if (theme.mode === "filter") {
      // The outermost document's inversion already composites over these.
      if (theme.preserveMedia)
        css =
          "img,video,canvas,svg image{filter:invert(100%) hue-rotate(180deg)!important;}";
    } else css = baseCss(theme);
    return css + "\n" + theme.customCss;
  }
  function adopt(target, theme) {
    var node = null;
    for (var index = 0; index < adopted.length; index++)
      if (adopted[index].ownerDocument === target && adopted[index].isConnected)
        node = adopted[index];
    var css = adoptedCss(theme);
    if (!css.trim()) return;
    if (!node) {
      if (adopted.length >= 64) return;
      try {
        node = target.createElement("style");
        node.className = "sorng-website-dark-mode";
        (target.head || target.documentElement).appendChild(node);
      } catch (_) {
        return;
      }
      adopted.push(node);
    }
    try {
      node.setAttribute("data-mode", theme.mode);
      node.textContent = css;
    } catch (_) {
      // The foreign document may have been replaced mid-scan.
    }
  }
  // A frame is styled from here only until its own document takes over, which
  // is what happens when an empty frame is replaced by a proxied navigation.
  function abandon(target) {
    var keep = [];
    for (var index = 0; index < adopted.length; index++)
      if (adopted[index].ownerDocument === target)
        try {
          adopted[index].remove();
        } catch (_) {
          // Its document is gone, which removed the node with it.
        }
      else keep.push(adopted[index]);
    adopted = keep;
  }
  function releaseAdopted() {
    var nodes = adopted;
    adopted = [];
    for (var index = 0; index < nodes.length; index++)
      try {
        nodes[index].remove();
      } catch (_) {
        // Its document is gone, which removed the node with it.
      }
    var elements = watched;
    watched = [];
    for (var frame = 0; frame < elements.length; frame++)
      try {
        elements[frame].removeEventListener("load", rescan);
      } catch (_) {
        // Same: the element went away with the document that held it.
      }
    if (observer) observer.disconnect();
    observer = null;
  }
  function scanFrames(node, depth, budget) {
    var frames;
    try {
      frames = node.querySelectorAll("iframe, frame");
    } catch (_) {
      return budget;
    }
    for (var index = 0; index < frames.length && budget > 0; index++) {
      var element = frames[index],
        target = null,
        realm = null;
      try {
        target = element.contentDocument;
        realm = target ? element.contentWindow : null;
      } catch (_) {
        continue;
      }
      if (!realm || !target || !target.documentElement) continue;
      var owner = null;
      try {
        owner = realm[SORNG_DARK_DOCUMENT_KEY];
      } catch (_) {
        continue;
      }
      // A proxied document themes itself from the registry; never touch it.
      if (owner) {
        abandon(target);
        continue;
      }
      budget--;
      if (watched.indexOf(element) < 0 && watched.length < 64) {
        watched.push(element);
        try {
          element.addEventListener("load", rescan);
        } catch (_) {
          // A load listener is an optimisation; the observer still fires.
        }
      }
      adopt(target, desired);
      if (depth < 8) budget = scanFrames(target, depth + 1, budget);
    }
    return budget;
  }
  function rescan() {
    if (disposed || !desired) return;
    var live = [];
    for (var index = 0; index < adopted.length; index++)
      if (adopted[index].isConnected) live.push(adopted[index]);
    adopted = live;
    scanFrames(document, 1, 64);
  }
  function queueScan() {
    if (scanQueued || disposed || !desired) return;
    scanQueued = true;
    Promise.resolve().then(function () {
      scanQueued = false;
      try {
        refresh();
      } catch (_) {
        // One malformed frame must not stop the rest of the page theming.
      }
    });
  }
  function observe() {
    if (observer || typeof MutationObserver !== "function") return;
    try {
      observer = new MutationObserver(queueScan);
      observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "style",
          "class",
          "id",
          "media",
          "disabled",
          "data-sorng-dark-ready",
          "data-darkreader-mode",
        ],
      });
    } catch (_) {
      observer = null;
    }
  }
  // The document keeps growing after the readiness script runs: the frameset
  // element, the frames, and the documents those frames write themselves all
  // arrive later, so the shape-dependent work is redone as the page settles.
  function refresh() {
    if (disposed || !desired) return;
    var theme = desired;
    // Observe the Document, not a replaceable root/head. Repair removal, edits
    // and disabling of our sheets in the mutation checkpoint before paint.
    if (!(runtimeInstalled && theme.mode === "filter")) installBootstrap(theme);
    if (runtimeInstalled && style && !style.isConnected) {
      style = null;
      installStyles(theme);
    }
    [bootstrap, style].forEach(function (node) {
      if (!node) return;
      if (node.disabled) node.disabled = false;
      if (node.hasAttribute("media")) node.removeAttribute("media");
      if (node.hasAttribute("disabled")) node.removeAttribute("disabled");
    });
    if (style && style.textContent !== styleText) style.textContent = styleText;
    protectPalette(theme);
    if (frameset() !== framesetStyled) {
      if (style) style.remove();
      style = null;
      installStyles(theme);
    }
    paintBorders(theme);
    observe();
    rescan();
  }
  function settle() {
    try {
      refresh();
    } catch (_) {
      // Late theming is best effort; the document itself is already themed.
    }
  }
  // The engine did not install. Marked so the caller can theme the document
  // with CSS instead; a closed document, by contrast, must still reject.
  function unavailable(message) {
    var error = new Error(message);
    error.sorngEngineUnavailable = true;
    return error;
  }
  function loadDynamic() {
    if (window.DarkReader) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var script = document.createElement("script"),
        done = false;
      script.src = location.origin + "/__sortofremoteng_web_darkreader_v1.js";
      // The asset is served by this same proxy session, so this budget only
      // bounds a hung fetch. A refusal — this connection's policy or the
      // website's own CSP — fails in milliseconds through onerror instead.
      var timer = setTimeout(function () {
        finish(unavailable("Dark-mode engine timed out"));
      }, 4000);
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
          window.DarkReader
            ? null
            : unavailable("Dark-mode engine unavailable"),
        );
      };
      script.onerror = function () {
        finish(unavailable("Dark-mode engine could not load"));
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
        immediateModify: true,
      },
      { ignoreImageAnalysis: theme.preserveMedia ? ["*"] : [] },
    );
  }
  document.addEventListener("DOMContentLoaded", settle);
  window.addEventListener("load", settle);
  // The proxy's palette is present before this script on every response,
  // including redirects and child documents. Adopt it immediately, without
  // requesting an engine before the app has supplied its page-script policy.
  if (bootstrap) {
    var background = bootstrap.getAttribute("data-background-color");
    var foreground = bootstrap.getAttribute("data-text-color");
    if (
      /^#[0-9a-f]{6}$/i.test(background || "") &&
      /^#[0-9a-f]{6}$/i.test(foreground || "")
    ) {
      desired = Object.assign({}, defaults, {
        backgroundColor: background,
        textColor: foreground,
      });
      refresh();
    }
  }
  return {
    set: function (payload) {
      if (disposed) return Promise.reject(new Error("The document was closed"));
      var ticket = ++revision;
      desired = null;
      cssOnly = false;
      loadingPalette = false;
      restoreInline();
      removeStyles();
      if (
        !payload ||
        typeof payload.enabled !== "boolean" ||
        (payload.cssOnly !== undefined && typeof payload.cssOnly !== "boolean")
      ) {
        removeBootstrap();
        return Promise.reject(new Error("Invalid dark-mode extension command"));
      }
      if (!payload.enabled) {
        removeBootstrap();
        return Promise.resolve();
      }
      var theme;
      try {
        theme = themeOf(payload.theme);
      } catch (error) {
        removeBootstrap();
        return Promise.reject(error);
      }
      desired = theme;
      loadingPalette = true;
      // The proxy's static palette is already present on first paint. Keep it
      // through engine loading, and protect commands sent after document start
      // synchronously as well. Never await a network request on a light page.
      installBootstrap(theme);
      protectPalette(theme);
      observe();
      cssOnly = payload.cssOnly === true;
      var wanted = theme.mode === "dynamic" || theme.mode === "dynamicFilter";
      // A frameset paints nothing but its gutters, so converting it is wasted
      // work: the content is themed by the controllers inside its frames. A
      // refused engine asset is not requested at all rather than left to fail.
      var dynamic = wanted && !frameset() && !cssOnly;
      // An engine that cannot install — refused by this connection's policy or
      // by the website's own content security policy — leaves the document
      // themed with CSS rather than light. Anything else still rejects.
      var load = dynamic
        ? loadDynamic().then(
            function () {
              return true;
            },
            function (error) {
              if (!error || error.sorngEngineUnavailable !== true) throw error;
              cssOnly = true;
              return false;
            },
          )
        : Promise.resolve(false);
      return load
        .then(function (engine) {
          if (disposed || ticket !== revision || desired !== theme)
            return undefined;
          if (engine) applyDynamic(theme);
          installStyles(theme);
          runtimeInstalled = true;
          paintBorders(theme);
          observe();
          rescan();
          // A filter must not invert our already-dark palette. Dynamic/CSS
          // paths retain it, including after engine conversion and SPA updates.
          if (theme.mode === "filter") removeBootstrap();
          else protectPalette(theme);
          // A frameset root that skipped the engine on purpose reports nothing:
          // its frames answer for the content the user actually sees.
          if (engine) return "engine";
          return wanted && cssOnly ? "cssOnly" : undefined;
        })
        .catch(function (error) {
          if (ticket === revision) {
            removeStyles();
            observe();
            // Keep the explicit dark palette if the engine throws. A later
            // disable/dispose still restores the upstream appearance.
          }
          throw error;
        });
    },
    dispose: function (keepAppearance) {
      disposed = true;
      desired = null;
      revision++;
      if (abortLoading) abortLoading();
      document.removeEventListener("DOMContentLoaded", settle);
      window.removeEventListener("load", settle);
      try {
        if (keepAppearance) {
          // A navigation can still present the outgoing document for a frame.
          // Stop our work but retain its final appearance until it is replaced.
          if (observer) observer.disconnect();
          observer = null;
          releaseShadows(true);
        } else {
          removeBootstrap();
          removeStyles();
        }
      } catch (_) {
        // The page may have replaced its own API. Teardown must still let the
        // outer automation bridge remove its listeners and revoke the document.
      }
    },
  };
}

/* Per-document delivery. The app posts the `dark` command to the outermost
 * proxied document only, and the page-side identity check makes a relay to a
 * frame impossible by design. Every proxied document instead walks `parent`
 * while it stays same-origin, joins a registry owned by the document it lands
 * on, and applies whatever that registry already holds — so frames that load
 * later theme themselves before they paint, and the outermost document fans a
 * change out to the frames that are already open.
 */
var SORNG_DARK_REGISTRY_KEY = "__sorngWebDarkMode_v1";
var SORNG_DARK_DOCUMENT_KEY = "__sorngWebDarkModeDocument_v1";

/* Is this the document the app addresses, i.e. the top of the proxied tree? */
function isOutermostDocument() {
  try {
    return sorngDarkRoot() === window;
  } catch (_) {
    return true;
  }
}

/* The outermost proxied document. The only cross-realm read is the guarded
 * `location.href` probe, and the first hop that fails it is the app window.
 * Never reads `top`: with t95's `parent` override the walk stops one step
 * earlier, on `p === w`, and lands on the same document either way.
 */
function sorngDarkRoot() {
  var w = window;
  for (var depth = 0; depth < 32; depth++) {
    var p;
    try {
      p = w.parent;
    } catch (_) {
      break;
    }
    if (!p || p === w) break;
    try {
      void p.location.href;
    } catch (_) {
      break;
    }
    w = p;
  }
  return w;
}

function sorngDarkRegistry(root) {
  var existing = null;
  try {
    existing = root[SORNG_DARK_REGISTRY_KEY];
  } catch (_) {
    return null;
  }
  if (existing && typeof existing === "object") return existing;
  // Build the registry with the root realm's constructors so it outlives any
  // frame that happened to install first.
  var object = Object,
    list = Array;
  try {
    if (root !== window && typeof root.Object === "function")
      object = root.Object;
    if (root !== window && typeof root.Array === "function") list = root.Array;
  } catch (_) {
    object = Object;
    list = Array;
  }
  var registry = new object();
  registry.payload = null;
  registry.revision = 0;
  registry.subscribers = new list();
  try {
    Object.defineProperty(root, SORNG_DARK_REGISTRY_KEY, { value: registry });
  } catch (_) {
    try {
      existing = root[SORNG_DARK_REGISTRY_KEY];
    } catch (_) {
      existing = null;
    }
    return existing && typeof existing === "object" ? existing : null;
  }
  return registry;
}

/* Called eagerly as this file's last statement, inside the readiness closure
 * and ahead of the automation client, so it must never throw: a failure here
 * would take the whole page-side bridge down with it.
 */
function sorngWebDarkMode() {
  var installed = null;
  try {
    installed = window[SORNG_DARK_DOCUMENT_KEY];
  } catch (_) {
    installed = null;
  }
  // A disposed controller belongs to a document that is on its way out; the
  // marker outlives it only where a realm is reused, never after a navigation.
  if (installed && !installed.disposed) return installed;
  try {
    return sorngInstallWebDarkMode();
  } catch (_) {
    // Fall back to this document theming only itself, as it did before.
    return createWebDarkModeController();
  }
}

function sorngInstallWebDarkMode() {
  var root = window,
    registry = null;
  try {
    root = sorngDarkRoot();
    registry = sorngDarkRegistry(root);
  } catch (_) {
    registry = null;
  }
  var controller = createWebDarkModeController(),
    released = false;
  var entry = {
    apply: function (payload) {
      return controller.set(payload);
    },
  };
  function release() {
    if (released || !registry) return;
    released = true;
    try {
      var subscribers = registry.subscribers;
      for (var index = subscribers.length - 1; index >= 0; index--)
        if (subscribers[index] === entry) subscribers.splice(index, 1);
    } catch (_) {
      // The root document is unloading too; its registry goes with it.
    }
  }
  var facade = {
    // A parent scan reads this to tell a document that themes itself from one
    // the proxy never served, so the flag stays readable after teardown.
    disposed: false,
    // Record the command where every frame can read it, then drive the frames
    // that are already open. One odd frame is reported but must not fail the
    // whole request, or a single broken panel would disable the toggle.
    set: function (payload) {
      if (!registry) return controller.set(payload);
      try {
        registry.payload = payload;
        registry.revision++;
      } catch (_) {
        // A sealed registry still drives this document.
      }
      var targets = [];
      try {
        for (var index = 0; index < registry.subscribers.length; index++)
          targets.push(registry.subscribers[index]);
      } catch (_) {
        targets = [entry];
      }
      var mine = null,
        others = [],
        failure = null,
        outcomes = [];
      function record(value) {
        if (value === "engine" || value === "cssOnly") outcomes.push(value);
      }
      for (var target = 0; target < targets.length; target++) {
        var result;
        try {
          result = Promise.resolve(targets[target].apply(payload));
        } catch (error) {
          result = Promise.reject(error);
        }
        if (targets[target] === entry) mine = result;
        else
          others.push(
            result.then(record, function () {
              // Reported by the frame itself; the page keeps its theme.
            }),
          );
      }
      if (!mine) mine = controller.set(payload);
      return Promise.all(
        [
          mine.then(record, function (error) {
            failure = error;
          }),
        ].concat(others),
      ).then(function () {
        if (failure) throw failure;
        // One frame falling back is the whole page's answer: a page where any
        // document missed the engine is never reported as fully converted.
        if (outcomes.indexOf("cssOnly") >= 0) return "cssOnly";
        return outcomes.indexOf("engine") >= 0 ? "engine" : undefined;
      });
    },
    dispose: function (keepAppearance) {
      if (facade.disposed) return;
      facade.disposed = true;
      release();
      controller.dispose(keepAppearance);
    },
  };
  if (registry)
    try {
      registry.subscribers.push(entry);
    } catch (_) {
      registry = null;
    }
  try {
    Object.defineProperty(window, SORNG_DARK_DOCUMENT_KEY, {
      value: facade,
      configurable: true,
    });
  } catch (_) {
    // Without the marker a parent would style this document twice; both are
    // reversible, so keep the controller rather than dropping the document.
  }
  window.addEventListener("pagehide", function () {
    facade.dispose(true);
  });
  if (registry && registry.payload)
    try {
      controller.set(registry.payload).then(null, function () {
        // The outermost document already reported this theme's failure.
      });
    } catch (_) {
      // Same: a late frame never turns a settled command back into an error.
    }
  return facade;
}

sorngWebDarkMode();
