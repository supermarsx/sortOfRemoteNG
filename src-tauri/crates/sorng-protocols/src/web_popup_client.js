/* Contained website windows. These are same-session child frames, never native
 * windows or new proxy sessions. Native navigation denial and inherited CSP
 * remain the boundary even if the publisher replaces this compatibility code.
 */
function installWebPopupClient(options) {
  "use strict";
  var nativeSetAttribute = Element.prototype.setAttribute,
    entries = new Map(),
    nextName = 0,
    namePrefix =
      "sorng_website_popup_" + Math.random().toString(36).slice(2) + "_",
    disposed = false,
    closeProperty = "__sorngCloseWebsitePopup_v1";

  function fail(reason) {
    throw options.blocked("window", reason);
  }
  function alive() {
    if (disposed || !options.isActive()) fail("document-closed");
  }
  function targetName(value) {
    var name = value == null || value === "" ? "_blank" : String(value);
    if (name.length > 256 || /[\u0000-\u001f\u007f]/.test(name))
      fail("invalid-popup-target");
    if (/^_(?:top|parent)$/i.test(name)) fail("unsupported-popup-target");
    return /^_(?:blank|self)$/i.test(name) ? name.toLowerCase() : name;
  }
  function mappedUrl(value) {
    var mapped = options.mapUrl(value, "navigation"),
      url = new URL(mapped);
    // Other session aliases, including approved background routes, do not grant
    // a document context. No source cookies or window handle cross an origin.
    if (
      url.origin !== options.proxyOrigin ||
      url.username ||
      url.password ||
      url.pathname.startsWith("/__sortofremoteng_")
    )
      fail("popup-origin-not-approved");
    return url.href;
  }
  function style(element, rules) {
    Object.keys(rules).forEach(function (name) {
      element.style.setProperty(name, rules[name], "important");
    });
  }
  function close(entry) {
    if (entry.closed) return;
    entry.closed = true;
    entries.delete(entry.key);
    delete entry.frame[closeProperty];
    entry.root.remove();
    if (entry.returnFocus?.isConnected) entry.returnFocus.focus?.();
  }
  function focus(entry) {
    alive();
    if (entry.closed || !entry.root.isConnected) return;
    // Bring the existing window forward without resetting its iframe or session.
    var layer = 2147483000;
    for (var other of entries.values()) {
      if (other !== entry)
        other.root.style.setProperty("z-index", String(layer++), "important");
    }
    entry.root.style.setProperty("z-index", String(layer), "important");
    entry.frame.focus();
  }
  function navigate(entry, value, replaceHistory) {
    alive();
    if (entry.closed || !entry.root.isConnected) fail("document-closed");
    var mapped = mappedUrl(value);
    entry.url = mapped;
    if (replaceHistory) entry.frame.contentWindow.location.replace(mapped);
    else Reflect.apply(nativeSetAttribute, entry.frame, ["src", mapped]);
    focus(entry);
  }
  function create(name, noOpener) {
    alive();
    for (var pair of entries) {
      if (!pair[1].root.isConnected) close(pair[1]);
    }
    var existing = name !== "_blank" && entries.get(name);
    if (existing) return existing;
    if (entries.size >= 8) fail("popup-limit");
    var key = name === "_blank" ? Symbol("website-popup") : name;
    var root = document.createElement("sorng-website-popup"),
      bar = document.createElement("div"),
      title = document.createElement("span"),
      dismiss = document.createElement("button"),
      frame = document.createElement("iframe"),
      palette = document.getElementById("__sorng_dark_bootstrap_v1"),
      background = palette?.getAttribute("data-background-color") || "#ffffff",
      color = palette?.getAttribute("data-text-color") || "#1f2937";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Website popup");
    style(root, {
      position: "fixed",
      inset: "12px",
      display: "flex",
      "flex-direction": "column",
      background: background,
      color: color,
      border: "1px solid #64748b",
      "border-radius": "8px",
      overflow: "hidden",
      "box-shadow": "0 12px 40px #0006",
      "font-family": "system-ui, sans-serif",
      "font-size": "13px",
      "text-align": "left",
      "min-width": "0",
      "min-height": "0",
    });
    style(bar, {
      display: "flex",
      "align-items": "center",
      gap: "12px",
      padding: "8px 12px",
      background: background,
      color: color,
      "flex-shrink": "0",
      "border-bottom": "1px solid #64748b",
    });
    title.textContent = "Website popup";
    style(title, {
      flex: "1",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    });
    dismiss.type = "button";
    dismiss.textContent = "Close ×";
    dismiss.setAttribute("aria-label", "Close website popup");
    style(dismiss, {
      color: color,
      background: "transparent",
      border: "1px solid #64748b",
      "border-radius": "4px",
      padding: "4px 8px",
      cursor: "pointer",
      font: "inherit",
    });
    // A unique light-DOM browsing-context name lets ordinary native form
    // submission target this frame, retaining multipart bodies and submitters.
    frame.name = namePrefix + ++nextName;
    frame.setAttribute("data-sorng-website-popup", "");
    if (noOpener) frame.setAttribute("data-sorng-popup-noopener", "");
    frame.setAttribute("title", "Website popup");
    // Inherit the proxy parent's sandbox and CSP; never add allow-popups or
    // allow-popups-to-escape-sandbox. about:blank inherits only the proxy origin.
    style(frame, {
      display: "block",
      flex: "1",
      width: "100%",
      "min-height": "0",
      border: "0",
      background: background,
    });
    bar.append(title, dismiss);
    root.append(bar, frame);
    var entry = {
      key: key,
      root: root,
      frame: frame,
      closed: false,
      url: "about:blank",
      returnFocus: document.activeElement,
      handle: null,
    };
    frame[closeProperty] = function () {
      close(entry);
    };
    dismiss.addEventListener("click", function () {
      close(entry);
    });
    frame.addEventListener("load", function () {
      if (entry.closed) return;
      try {
        var child = frame.contentWindow;
        if (
          child.location.href !== "about:blank" &&
          child.location.origin !== options.proxyOrigin
        )
          return;
        title.textContent =
          child.document.title.trim().slice(0, 120) || "Website popup";
        frame.title = title.textContent;
        entry.url = child.location.href;
      } catch (_) {
        /* Native boundary may have rejected a navigation. */
      }
    });
    // A bounded Window-like handle supports blank-then-navigate vendor flows.
    // Location setters always revalidate; a raw WindowProxy would bypass mapping.
    var locationHandle = {};
    function currentUrl() {
      alive();
      try {
        var actual = frame.contentWindow.location;
        if (actual.origin === options.proxyOrigin) return actual.href;
      } catch (_) {}
      return entry.url;
    }
    Object.defineProperty(locationHandle, "href", {
      get: currentUrl,
      set: function (value) {
        navigate(entry, value, false);
      },
    });
    locationHandle.assign = function (value) {
      navigate(entry, value, false);
    };
    locationHandle.replace = function (value) {
      navigate(entry, value, true);
    };
    locationHandle.toString = currentUrl;
    var handle = {
      focus: function () {
        focus(entry);
      },
      close: function () {
        close(entry);
      },
    };
    Object.defineProperties(handle, {
      closed: {
        get: function () {
          return (
            entry.closed || !root.isConnected || disposed || !options.isActive()
          );
        },
      },
      location: {
        get: function () {
          return locationHandle;
        },
        set: function (value) {
          navigate(entry, value, false);
        },
      },
      document: {
        get: function () {
          alive();
          if (entry.closed) fail("document-closed");
          return frame.contentDocument;
        },
      },
      window: {
        get: function () {
          return handle;
        },
      },
      self: {
        get: function () {
          return handle;
        },
      },
    });
    entry.handle = handle;
    entries.set(key, entry);
    (document.body || document.documentElement).append(root);
    focus(entry);
    return entry;
  }
  return {
    open: function (value, target, features) {
      alive();
      var name = targetName(target),
        empty = value == null || value === "" || value === "about:blank";
      // Validate first: a rejected destination must not leave an empty popup.
      var mapped = empty ? null : mappedUrl(value);
      if (name === "_self") {
        if (mapped) window.location.assign(mapped);
        return window;
      }
      var noOpener =
        /(?:^|[,\s])(?:noopener|noreferrer)(?:\s*=\s*(?:1|yes|true))?(?=[,\s]|$)/i.test(
          String(features || ""),
        );
      var entry = create(noOpener ? "_blank" : name, noOpener);
      if (mapped) navigate(entry, mapped, false);
      else focus(entry);
      // Browser open with noopener/noreferrer has no usable WindowProxy result.
      return noOpener ? null : entry.handle;
    },
    prepareTarget: function (target, flags) {
      alive();
      var name = targetName(target);
      if (name === "_self") return name;
      // A previous prepare pass already assigned this managed browsing context.
      for (var entry of entries.values())
        if (entry.frame.name === name) return name;
      // Preserve publisher-owned framesets and named panels. They already live
      // under this proxy's sandbox; don't replace them with an unrelated popup.
      for (var frame of document.querySelectorAll("iframe[name],frame[name]"))
        if (frame.getAttribute("name") === name) return name;
      var existing = name !== "_blank" && !flags?.noopener && entries.has(name);
      var popup = create(flags?.noopener ? "_blank" : name, flags?.noopener);
      if (!existing && flags?.activationEvent)
        window.setTimeout(function () {
          // Site handlers may cancel native activation and open their own tool.
          // Remove only our still-unused placeholder, never an existing window.
          if (
            !popup.closed &&
            flags.activationEvent.defaultPrevented &&
            popup.url === "about:blank"
          ) {
            try {
              if (popup.frame.contentWindow.location.href === "about:blank")
                close(popup);
            } catch (_) {
              /* A navigation already owns this context. */
            }
          }
        }, 0);
      return popup.frame.name;
    },
    closeSelf: (function () {
      try {
        var frame = window.frameElement;
        return frame?.hasAttribute("data-sorng-website-popup") &&
          typeof frame[closeProperty] === "function"
          ? function () {
              frame[closeProperty]?.();
            }
          : null;
      } catch (_) {
        return null;
      }
    })(),
    closeAll: function () {
      Array.from(entries.values()).forEach(close);
    },
    dispose: function () {
      disposed = true;
      Array.from(entries.values()).forEach(close);
    },
  };
}
