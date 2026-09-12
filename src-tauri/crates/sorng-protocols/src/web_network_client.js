/* Compatibility routing, NOT a security boundary. Native request/navigation
 * denial and response CSP must remain effective if a page removes this code.
 * No origin is approved here; only the native document's immutable map is used.
 */
function installWebNetworkClient(configuration, reportBlocked) {
  "use strict";
  var NativeURL = window.URL,
    NativeRequest = window.Request,
    nativeFetch = window.fetch,
    rootLocation = location.href,
    routes = new Map(),
    fontAssets = new Map(),
    navigationOrigins = new Set(),
    quickConnectRpc = null,
    redirectEndpoint = null,
    proxies = new Set(),
    reports = new Set(),
    restores = [],
    pendingReaders = new Set(),
    active = true,
    disposed = false;

  function origin(value, proxy) {
    if (typeof value !== "string" || value.length > 2048)
      throw new TypeError("Invalid network route configuration");
    var parsed = new NativeURL(value);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== value ||
      (proxy &&
        (parsed.protocol !== "http:" ||
          !/^p[0-9a-f]{32}\.localhost$/.test(parsed.hostname) ||
          !parsed.port))
    )
      throw new TypeError("Invalid network route configuration");
    return parsed.origin;
  }
  if (
    !configuration ||
    configuration.version !== 1 ||
    typeof configuration.sessionId !== "string" ||
    !configuration.sessionId ||
    configuration.sessionId.length > 256 ||
    !Number.isSafeInteger(configuration.documentSequence) ||
    configuration.documentSequence < 1 ||
    !Array.isArray(configuration.mappings) ||
    configuration.mappings.length > 32
  )
    throw new TypeError("Invalid network route configuration");
  var sessionId = configuration.sessionId,
    sequence = configuration.documentSequence,
    sourceOrigin = origin(configuration.sourceOrigin, false),
    proxyOrigin = origin(configuration.proxyOrigin, true);
  if (new NativeURL(rootLocation).origin !== proxyOrigin)
    throw new TypeError("Network route document mismatch");
  function addRoute(upstream, proxy) {
    upstream = origin(upstream, false);
    proxy = origin(proxy, true);
    if (routes.has(upstream) || proxies.has(proxy))
      throw new TypeError("Duplicate network route configuration");
    routes.set(upstream, proxy);
    proxies.add(proxy);
  }
  addRoute(sourceOrigin, proxyOrigin);
  configuration.mappings.forEach(function (entry) {
    if (!entry) throw new TypeError("Invalid network route configuration");
    addRoute(entry.upstreamOrigin, entry.proxyOrigin);
  });
  // These are closed binary asset routes, NOT permission to fetch from a CDN
  // origin. Native independently validates the path, response and anonymous route.
  var configuredFonts =
    configuration.fontAssets === undefined ? [] : configuration.fontAssets;
  if (!Array.isArray(configuredFonts) || configuredFonts.length > 28)
    throw new TypeError("Invalid font asset configuration");
  configuredFonts.forEach(function (entry) {
    if (!entry || typeof entry.upstreamUrl !== "string")
      throw new TypeError("Invalid font asset configuration");
    var match = entry.upstreamUrl.match(
      /^https:\/\/synostatic\.synology\.com\/font\/inter\/(inter-w(?:400|500|600|700)-[1-7]\.woff2)$/,
    );
    if (
      !match ||
      entry.proxyUrl !==
        proxyOrigin +
          "/__sortofremoteng_assets_v1/synology-inter/" +
          match[1] ||
      fontAssets.has(entry.upstreamUrl)
    )
      throw new TypeError("Invalid font asset configuration");
    fontAssets.set(entry.upstreamUrl, entry.proxyUrl);
  });
  // Closed native capabilities, not a foreign-origin route. The control
  // endpoint independently validates discovery commands and never forwards
  // source authentication, cookies, arbitrary headers or arbitrary URLs.
  if (configuration.synologyQuickConnect !== undefined) {
    var quickConnect = configuration.synologyQuickConnect;
    if (
      !quickConnect ||
      quickConnect.version !== 1 ||
      !Array.isArray(quickConnect.navigationOrigins) ||
      quickConnect.navigationOrigins.length > 3 ||
      quickConnect.redirectEndpoint !==
        proxyOrigin + "/__sortofremoteng_quickconnect_redirect_v1"
    )
      throw new TypeError("Invalid QuickConnect capability configuration");
    quickConnect.navigationOrigins.forEach(function (value) {
      var canonical = origin(value, false);
      if (
        navigationOrigins.has(canonical) ||
        (canonical !== "https://global.quickconnect.to" &&
          canonical !== "https://www.quickconnect.to" &&
          !/^http:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.quickconnect\.to$/.test(
            canonical,
          ))
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      navigationOrigins.add(canonical);
    });
    redirectEndpoint = quickConnect.redirectEndpoint;
    if (quickConnect.rpc !== undefined) {
      if (
        !quickConnect.rpc ||
        quickConnect.rpc.upstreamUrl !==
          "https://global.quickconnect.to/Serv.php" ||
        quickConnect.rpc.proxyUrl !==
          proxyOrigin + "/__sortofremoteng_quickconnect_control_v1"
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      quickConnectRpc = {
        upstreamUrl: quickConnect.rpc.upstreamUrl,
        proxyUrl: quickConnect.rpc.proxyUrl,
      };
    }
  }

  function blocked(kind, reason, destination) {
    var key = kind + ":" + reason + ":" + (destination || "");
    if (
      (active || reason === "document-expired") &&
      reports.size < 32 &&
      !reports.has(key)
    ) {
      reports.add(key);
      if (typeof reportBlocked === "function") {
        try {
          reportBlocked({
            type: "sorng_web_network_blocked",
            version: 1,
            sessionId: sessionId,
            documentSequence: sequence,
            kind: kind,
            reason: reason,
            origin: destination || null,
          });
        } catch (_) {
          // Reporting is advisory. Its failure never permits a request.
        }
      }
    }
    return new DOMException(
      "Blocked " +
        kind +
        " request (" +
        reason +
        ")" +
        (destination ? " to " + destination : "") +
        ". Review Website network restrictions.",
      "SecurityError",
    );
  }
  function mapUrl(value, kind, localData, method, navigationReference) {
    if (!active) throw blocked(kind, "document-closed");
    var target;
    try {
      var input = String(value);
      if (input.length > 16_384) throw new Error("URL is too long");
      target = new NativeURL(input, document.baseURI || rootLocation);
      if (input.startsWith("//") && !proxies.has(target.origin))
        target = new NativeURL(new NativeURL(sourceOrigin).protocol + input);
    } catch (_) {
      throw blocked(kind, "invalid-url");
    }
    if (target.username || target.password)
      throw blocked(kind, "url-credentials");
    if (
      quickConnectRpc &&
      target.href === quickConnectRpc.upstreamUrl &&
      (kind === "fetch" || kind === "xhr")
    ) {
      if (String(method).toUpperCase() !== "POST")
        throw blocked(kind, "quickconnect-control-method", target.origin);
      return quickConnectRpc.proxyUrl;
    }
    if (kind === "navigation" && navigationOrigins.has(target.origin)) {
      if (target.href.length > 4096) throw blocked(kind, "invalid-url");
      // Setting href does not send a request. Preserve anchor-based URL
      // parsing; the capture click handler performs the actual handoff.
      if (navigationReference) return target.href;
      if (target.origin !== sourceOrigin) {
        var reviewUrl = new NativeURL(redirectEndpoint);
        reviewUrl.searchParams.set("destination", target.href);
        return reviewUrl.href;
      }
    }
    if (fontAssets.has(target.href)) {
      if (kind === "font" || kind === "css") return fontAssets.get(target.href);
      if (kind === "fetch" || kind === "xhr") {
        if (String(method).toUpperCase() !== "GET")
          throw blocked("font", "font-read-only", target.origin);
        return fontAssets.get(target.href);
      }
    }
    if (
      localData &&
      (target.protocol === "data:" || target.protocol === "blob:")
    )
      return target.href;
    if (kind === "websocket" && /^https?:$/.test(target.protocol))
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    var socket = target.protocol === "ws:" || target.protocol === "wss:";
    if (socket && kind !== "websocket")
      throw blocked(kind, "unsupported-scheme");
    if (!socket && !/^https?:$/.test(target.protocol))
      throw blocked(kind, "unsupported-scheme");
    if (kind === "websocket" && !socket)
      throw blocked(kind, "unsupported-scheme");
    var lookup = new NativeURL(target.href);
    if (socket)
      lookup.protocol = target.protocol === "wss:" ? "https:" : "http:";
    var mapped = proxies.has(lookup.origin)
      ? lookup.origin
      : routes.get(lookup.origin);
    if (!mapped) throw blocked(kind, "origin-not-approved", lookup.origin);
    var result = new NativeURL(mapped);
    if (socket) result.protocol = "ws:";
    result.pathname = target.pathname;
    result.search = target.search;
    result.hash = target.hash;
    if (socket) {
      if (result.searchParams.has("__sorng_ws_document_v1"))
        throw blocked(kind, "reserved-url-parameter");
      result.search +=
        (result.search ? "&" : "?") +
        "__sorng_ws_document_v1=" +
        String(sequence);
    }
    return result.href;
  }
  function replace(object, name, value) {
    if (!object) return;
    var descriptor = Object.getOwnPropertyDescriptor(object, name);
    try {
      Object.defineProperty(object, name, {
        configurable: true,
        writable: true,
        value: value,
      });
      restores.push(function () {
        if (object[name] !== value) return;
        if (descriptor) Object.defineProperty(object, name, descriptor);
        else delete object[name];
      });
    } catch (_) {
      blocked("compatibility", "unavailable-interceptor");
    }
  }
  function wrapConstructor(name, kind) {
    var Native = window[name];
    if (typeof Native !== "function") return;
    var Wrapped = function () {
      if (!new.target) throw new TypeError("Constructor requires new");
      var args = Array.prototype.slice.call(arguments);
      args[0] = mapUrl(args[0], kind);
      return Reflect.construct(
        Native,
        args,
        new.target === Wrapped ? Native : new.target,
      );
    };
    Object.setPrototypeOf(Wrapped, Native);
    Wrapped.prototype = Native.prototype;
    replace(window, name, Wrapped);
  }
  async function requestBody(request) {
    if (!request.body) return null;
    var reader = request.body.getReader(),
      chunks = [],
      bytes = 0;
    function abortError() {
      return (
        request.signal.reason ||
        new DOMException("Request aborted", "AbortError")
      );
    }
    function cancel() {
      reader.cancel(abortError()).catch(function () {});
    }
    pendingReaders.add(reader);
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        if (!active) throw blocked("fetch", "document-closed");
        if (request.signal.aborted) throw abortError();
        var next = await reader.read();
        if (!active) throw blocked("fetch", "document-closed");
        if (request.signal.aborted) throw abortError();
        if (next.done) break;
        if (
          !ArrayBuffer.isView(next.value) ||
          Object.prototype.toString.call(next.value) !== "[object Uint8Array]"
        )
          throw blocked("fetch", "unsupported-request-body");
        bytes += next.value.byteLength;
        if (bytes > 16 * 1024 * 1024)
          throw blocked("fetch", "request-body-too-large");
        chunks.push(new Uint8Array(next.value));
      }
      var body = new Uint8Array(bytes),
        offset = 0;
      chunks.forEach(function (chunk) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return body;
    } catch (error) {
      reader.cancel().catch(function () {});
      throw error;
    } finally {
      pendingReaders.delete(reader);
      request.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }
  if (typeof nativeFetch === "function") {
    function controlRequestOptions(url, options) {
      if (!quickConnectRpc || url !== quickConnectRpc.proxyUrl) return options;
      var headers = new Headers(options?.headers);
      headers.set("X-Sorng-QuickConnect-Document", String(sequence));
      return Object.assign({}, options, {
        headers: headers,
        credentials: "omit",
      });
    }
    replace(window, "fetch", function (input, init) {
      try {
        if (NativeRequest && input instanceof NativeRequest) {
          var url = mapUrl(
            input.url,
            "fetch",
            false,
            init?.method ?? input.method,
          );
          if (url !== input.url) {
            input = new NativeRequest(input, init);
            var requestOptions = {
              method: input.method,
              headers: input.headers,
              mode: input.mode,
              credentials: input.credentials,
              cache: input.cache,
              redirect: input.redirect,
              referrer: input.referrer,
              referrerPolicy: input.referrerPolicy,
              integrity: input.integrity,
              keepalive: input.keepalive,
              signal: input.signal,
            };
            requestOptions = controlRequestOptions(url, requestOptions);
            // Chromium refuses streaming uploads over this HTTP/1.1 mediator.
            // Bounded buffering preserves Request bodies, never a direct fallback.
            return requestBody(input).then(function (body) {
              if (!active) throw blocked("fetch", "document-closed");
              if (input.signal.aborted)
                throw (
                  input.signal.reason ||
                  new DOMException("Request aborted", "AbortError")
                );
              if (body !== null) requestOptions.body = body;
              return Reflect.apply(nativeFetch, window, [
                new NativeRequest(url, requestOptions),
              ]);
            });
          }
        } else {
          input = mapUrl(input, "fetch", false, init?.method ?? "GET");
          init = controlRequestOptions(input, init);
        }
        return Reflect.apply(nativeFetch, window, [input, init]);
      } catch (error) {
        return Promise.reject(error);
      }
    });
  }
  if (window.XMLHttpRequest) {
    var xhrPrototype = window.XMLHttpRequest.prototype,
      nativeOpen = xhrPrototype.open,
      nativeSetRequestHeader = xhrPrototype.setRequestHeader;
    replace(xhrPrototype, "open", function () {
      var args = Array.prototype.slice.call(arguments);
      args[1] = mapUrl(args[1], "xhr", false, args[0]);
      var control = quickConnectRpc && args[1] === quickConnectRpc.proxyUrl;
      if (control && (args[3] || args[4]))
        throw blocked("xhr", "url-credentials");
      if (control && typeof nativeSetRequestHeader !== "function")
        throw blocked("xhr", "unavailable-interceptor");
      var result = Reflect.apply(nativeOpen, this, args);
      if (control)
        Reflect.apply(nativeSetRequestHeader, this, [
          "X-Sorng-QuickConnect-Document",
          String(sequence),
        ]);
      return result;
    });
  }
  if (typeof navigator.sendBeacon === "function") {
    var nativeBeacon = navigator.sendBeacon;
    replace(navigator, "sendBeacon", function (url, data) {
      try {
        return Reflect.apply(nativeBeacon, navigator, [
          mapUrl(url, "beacon"),
          data,
        ]);
      } catch (_) {
        return false;
      }
    });
  }
  wrapConstructor("EventSource", "eventsource");
  wrapConstructor("WebSocket", "websocket");
  [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
  ].forEach(function (name) {
    // Optional browser feature detection must see an unavailable API, not a
    // truthy constructor which throws when a vendor probes local addresses.
    // This remains compatibility handling, never a native WebRTC firewall.
    var original = Object.getOwnPropertyDescriptor(window, name);
    try {
      if (original?.configurable) Reflect.deleteProperty(window, name);
      if (window[name] !== undefined) {
        var remaining = Object.getOwnPropertyDescriptor(window, name);
        if (remaining && !remaining.configurable) {
          Object.defineProperty(window, name, { value: undefined });
        } else {
          // Deleting an own property can expose an inherited constructor.
          Object.defineProperty(window, name, {
            configurable: true,
            writable: true,
            value: undefined,
          });
        }
      }
      if (window[name] !== undefined)
        throw new TypeError("RTC capability could not be masked");
      var masked = Object.getOwnPropertyDescriptor(window, name);
      restores.push(function () {
        var current = Object.getOwnPropertyDescriptor(window, name);
        var stillOwned = masked
          ? current &&
            current.value === undefined &&
            current.get === masked.get &&
            current.set === masked.set &&
            current.configurable === masked.configurable &&
            current.writable === masked.writable &&
            current.enumerable === masked.enumerable
          : !current && window[name] === undefined;
        if (!stillOwned) return;
        if (original) Object.defineProperty(window, name, original);
        else Reflect.deleteProperty(window, name);
      });
    } catch (_) {
      // An immutable native host cannot be masked by this JS layer. Preserve
      // the other routing hooks and report the known containment limitation.
      blocked("compatibility", "unavailable-interceptor");
    }
  });
  ["Worker", "SharedWorker", "WebTransport"].forEach(function (name) {
    if (typeof window[name] === "function")
      replace(window, name, function () {
        throw blocked(name, "unsupported-network-context");
      });
  });
  if (navigator.serviceWorker)
    replace(navigator.serviceWorker, "register", function () {
      return Promise.reject(
        blocked("serviceworker", "unsupported-network-context"),
      );
    });
  if (window.Worklet)
    replace(window.Worklet.prototype, "addModule", function () {
      return Promise.reject(blocked("worklet", "unsupported-network-context"));
    });
  if (typeof window.open === "function")
    replace(window, "open", function () {
      blocked("window", "unsupported-network-context");
      return null;
    });

  // Synchronous property/attribute hooks help dynamic resources before insertion.
  // Parser-created resources, cached native setters, HTML strings, CSS escapes,
  // and Location assignment STILL require the independent native/CSP boundary.
  var attributes = {
    A: ["href"],
    AREA: ["href"],
    LINK: ["href"],
    SCRIPT: ["src"],
    IMG: ["src"],
    SOURCE: ["src"],
    AUDIO: ["src"],
    VIDEO: ["src", "poster"],
    IFRAME: ["src"],
    FRAME: ["src"],
    INPUT: ["src", "formaction"],
    BUTTON: ["formaction"],
    FORM: ["action"],
    EMBED: ["src"],
    OBJECT: ["data"],
  };
  function resourceUrl(element, name, value) {
    var allowed = attributes[element.tagName];
    if (!allowed || allowed.indexOf(name.toLowerCase()) === -1) return value;
    if (
      /^(IFRAME|FRAME)$/.test(element.tagName) &&
      String(value).trim() === "about:blank"
    )
      return "about:blank";
    return mapUrl(
      value,
      /^(A|AREA)$/.test(element.tagName)
        ? "navigation"
        : element.tagName === "FORM" || name.toLowerCase() === "formaction"
          ? "form"
          : element.tagName === "LINK" &&
              element.getAttribute("rel")?.toLowerCase() === "preload" &&
              element.getAttribute("as")?.toLowerCase() === "font"
            ? "font"
            : "resource",
      /^(IMG|SOURCE|AUDIO|VIDEO)$/.test(element.tagName),
      undefined,
      /^(A|AREA)$/.test(element.tagName),
    );
  }
  var nativeSetAttribute = Element.prototype.setAttribute;
  // srcset descriptors remain native-validated. Complex data-URL candidates
  // are intentionally not guessed; ordinary src still supports local data.
  function srcset(value) {
    value = String(value);
    if (!value.trim()) return value;
    if (/data:|\\/i.test(value))
      throw blocked("resource", "unsupported-srcset");
    return value
      .split(",")
      .map(function (candidate) {
        var match = candidate
          .trim()
          .match(/^(\S+)(\s+(?:\d+(?:\.\d+)?[wx]))?$/);
        if (!match) throw blocked("resource", "unsupported-srcset");
        return mapUrl(match[1], "resource") + (match[2] || "");
      })
      .join(", ");
  }
  function css(value, kind) {
    kind = kind || "css";
    value = String(value);
    if (!/url\s*\(|@import/i.test(value)) return value;
    // This intentionally small compatibility parser must not guess CSS escapes.
    // Native policy covers CSS loaded without these dynamic API hooks.
    if (/\\|\/\*/.test(value))
      throw blocked(kind, "unsupported-css-url-syntax");
    value = value.replace(
      /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s()"']+))\s*\)/gi,
      function (_, double, single, plain) {
        return (
          'url("' +
          mapUrl(double ?? single ?? plain, kind, true).replace(/"/g, "%22") +
          '")'
        );
      },
    );
    return value.replace(
      /(@import\s+)(["'])([^"'\n]+)\2/gi,
      function (_, prefix, quote, url) {
        return prefix + quote + mapUrl(url, "css") + quote;
      },
    );
  }
  if (typeof window.FontFace === "function") {
    var NativeFontFace = window.FontFace;
    var RoutedFontFace = function () {
      if (!new.target) throw new TypeError("Constructor requires new");
      if (!active) throw blocked("font", "document-closed");
      var args = Array.prototype.slice.call(arguments);
      // BufferSource is not a URL; preserve native validation and binary identity.
      if (
        args.length >= 2 &&
        !ArrayBuffer.isView(args[1]) &&
        Object.prototype.toString.call(args[1]) !== "[object ArrayBuffer]"
      )
        args[1] = css(String(args[1]), "font");
      return Reflect.construct(
        NativeFontFace,
        args,
        new.target === RoutedFontFace ? NativeFontFace : new.target,
      );
    };
    Object.setPrototypeOf(RoutedFontFace, NativeFontFace);
    RoutedFontFace.prototype = NativeFontFace.prototype;
    replace(window, "FontFace", RoutedFontFace);
  }
  replace(Element.prototype, "setAttribute", function (name, value) {
    var lower = String(name).toLowerCase();
    if (lower === "srcset" && /^(IMG|SOURCE)$/.test(this.tagName))
      value = srcset(value);
    else if (lower === "style") value = css(value);
    else value = resourceUrl(this, String(name), value);
    return Reflect.apply(nativeSetAttribute, this, [name, value]);
  });
  function mapSetter(object, name, mapper) {
    if (!object) return;
    var descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (!descriptor?.set || !descriptor.configurable) return;
    var setter = function (value) {
      return Reflect.apply(descriptor.set, this, [mapper(value)]);
    };
    Object.defineProperty(
      object,
      name,
      Object.assign({}, descriptor, { set: setter }),
    );
    restores.push(function () {
      if (Object.getOwnPropertyDescriptor(object, name)?.set === setter)
        Object.defineProperty(object, name, descriptor);
    });
  }
  mapSetter(window.HTMLImageElement?.prototype, "srcset", srcset);
  mapSetter(window.HTMLSourceElement?.prototype, "srcset", srcset);
  mapSetter(window.CSSStyleDeclaration?.prototype, "cssText", css);
  mapSetter(window.CSSStyleDeclaration?.prototype, "src", function (value) {
    return css(value, "font");
  });
  if (
    window.CSSStyleDeclaration &&
    !Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "src")
  ) {
    // Chromium exposes this descriptor through named CSS properties, not an
    // ordinary prototype setter. Keep native get/set semantics for this one
    // URL-bearing font descriptor; do not proxy all CSS declarations.
    var fontStylePrototype = CSSStyleDeclaration.prototype;
    var nativeFontGet = fontStylePrototype.getPropertyValue;
    var nativeFontSet = fontStylePrototype.setProperty;
    var fontSrcSetter = function (value) {
      return Reflect.apply(nativeFontSet, this, ["src", css(value, "font")]);
    };
    try {
      Object.defineProperty(fontStylePrototype, "src", {
        configurable: true,
        get: function () {
          return Reflect.apply(nativeFontGet, this, ["src"]);
        },
        set: fontSrcSetter,
      });
      restores.push(function () {
        if (
          Object.getOwnPropertyDescriptor(fontStylePrototype, "src")?.set ===
          fontSrcSetter
        )
          delete fontStylePrototype.src;
      });
    } catch (_) {
      // A restricted host prototype must not abort the other routing hooks.
      // Native response policy still blocks this unsupported font setter.
      blocked("compatibility", "unavailable-interceptor");
    }
  }
  if (window.CSSStyleDeclaration) {
    var setProperty = CSSStyleDeclaration.prototype.setProperty;
    replace(
      CSSStyleDeclaration.prototype,
      "setProperty",
      function (name, value, priority) {
        return Reflect.apply(setProperty, this, [name, css(value), priority]);
      },
    );
  }
  if (window.CSSStyleSheet) {
    ["insertRule", "replace", "replaceSync"].forEach(function (name) {
      var native = CSSStyleSheet.prototype[name];
      if (typeof native !== "function") return;
      replace(CSSStyleSheet.prototype, name, function () {
        var args = Array.prototype.slice.call(arguments);
        try {
          args[0] = css(args[0]);
        } catch (error) {
          if (name === "replace") return Promise.reject(error);
          throw error;
        }
        return Reflect.apply(native, this, args);
      });
    });
  }
  [
    ["HTMLAnchorElement", "href"],
    ["HTMLAreaElement", "href"],
    ["HTMLLinkElement", "href"],
    ["HTMLScriptElement", "src"],
    ["HTMLImageElement", "src"],
    ["HTMLSourceElement", "src"],
    ["HTMLMediaElement", "src"],
    ["HTMLVideoElement", "poster"],
    ["HTMLIFrameElement", "src"],
    ["HTMLFrameElement", "src"],
    ["HTMLInputElement", "src"],
    ["HTMLInputElement", "formAction"],
    ["HTMLButtonElement", "formAction"],
    ["HTMLFormElement", "action"],
    ["HTMLEmbedElement", "src"],
    ["HTMLObjectElement", "data"],
  ].forEach(function (entry) {
    var Native = window[entry[0]],
      name = entry[1];
    if (!Native) return;
    var object = Native.prototype,
      descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (!descriptor || !descriptor.set || !descriptor.configurable) return;
    var setter = function (value) {
      return Reflect.apply(descriptor.set, this, [
        resourceUrl(this, name, value),
      ]);
    };
    Object.defineProperty(
      object,
      name,
      Object.assign({}, descriptor, { set: setter }),
    );
    restores.push(function () {
      if (Object.getOwnPropertyDescriptor(object, name)?.set === setter)
        Object.defineProperty(object, name, descriptor);
    });
  });
  function prepareForm(form, submitter) {
    var overridden = submitter && submitter.hasAttribute("formaction"),
      element = overridden ? submitter : form,
      attr = overridden ? "formaction" : "action",
      url = element.getAttribute(attr) || location.href;
    Reflect.apply(nativeSetAttribute, element, [attr, mapUrl(url, "form")]);
  }
  if (window.HTMLFormElement) {
    ["submit", "requestSubmit"].forEach(function (name) {
      var native = window.HTMLFormElement.prototype[name];
      if (typeof native !== "function") return;
      replace(window.HTMLFormElement.prototype, name, function (submitter) {
        prepareForm(this, submitter);
        return Reflect.apply(native, this, arguments);
      });
    });
  }
  function submit(event) {
    if (!(event.target instanceof HTMLFormElement)) return;
    try {
      prepareForm(event.target, event.submitter);
    } catch (_) {
      event.preventDefault();
    }
  }
  function click(event) {
    var anchor = event.target?.closest?.("a[href],area[href]");
    if (!anchor) return;
    try {
      Reflect.apply(nativeSetAttribute, anchor, [
        "href",
        mapUrl(anchor.getAttribute("href"), "navigation"),
      ]);
    } catch (_) {
      event.preventDefault();
    }
  }
  document.addEventListener("submit", submit, true);
  document.addEventListener("click", click, true);
  function policyViolation(event) {
    var destination = null;
    try {
      var url = new NativeURL(event.blockedURI);
      if (/^https?:$/.test(url.protocol)) destination = url.origin;
      else if (/^wss?:$/.test(url.protocol)) {
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        destination = url.origin;
      }
    } catch (_) {}
    blocked(
      event.effectiveDirective === "font-src" ? "font" : "resource",
      "policy-blocked-resource",
      destination,
    );
  }
  document.addEventListener("securitypolicyviolation", policyViolation);
  // BFCache may restore this exact JS realm. Keep revoked wrappers installed;
  // restoring native APIs on pagehide would silently remove compatibility guards.
  function revoke() {
    if (!active) return;
    active = false;
    pendingReaders.forEach(function (reader) {
      reader.cancel().catch(function () {});
    });
    routes.clear();
    fontAssets.clear();
    navigationOrigins.clear();
    quickConnectRpc = null;
    proxies.clear();
  }
  function restored(event) {
    if (event.persisted && !active) blocked("document", "document-expired");
  }
  // Explicit owner teardown/test cleanup restores only hooks still owned here.
  function dispose() {
    if (disposed) return;
    disposed = true;
    revoke();
    document.removeEventListener("submit", submit, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("securitypolicyviolation", policyViolation);
    window.removeEventListener("pagehide", revoke);
    window.removeEventListener("pageshow", restored);
    restores.reverse().forEach(function (restore) {
      restore();
    });
    reports.clear();
  }
  window.addEventListener("pagehide", revoke, { once: true });
  window.addEventListener("pageshow", restored);
  return Object.freeze({ mapUrl: mapUrl, dispose: dispose });
}
