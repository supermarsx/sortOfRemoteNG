/* Compatibility routing, NOT a security boundary. Native request/navigation
 * denial and response CSP must remain effective if a page removes this code.
 * No origin is approved here; only the native document's immutable map is used.
 */
function installWebNetworkClient(configuration, reportBlocked) {
  "use strict";
  var NativeURL = window.URL,
    NativeRequest = window.Request,
    nativeFetch = window.fetch,
    NativeXMLHttpRequest = window.XMLHttpRequest,
    nativeXhrPrototype = NativeXMLHttpRequest && NativeXMLHttpRequest.prototype,
    nativeXhrOpen = nativeXhrPrototype && nativeXhrPrototype.open,
    nativeXhrSetRequestHeader =
      nativeXhrPrototype && nativeXhrPrototype.setRequestHeader,
    nativeXhrSend = nativeXhrPrototype && nativeXhrPrototype.send,
    rootLocation = location.href,
    routes = new Map(),
    fontAssets = new Map(),
    navigationOrigins = new Set(),
    quickConnectRpc = null,
    quickConnectDiscovered = null,
    tacticalRmmApi = null,
    googleSession = null,
    googleDocuments = new Set(),
    regionalNavigationAlias = null,
    directNavigationAlias = null,
    redirectEndpoint = null,
    proxies = new Set(),
    reports = new Set(),
    restores = [],
    pendingReaders = new Set(),
    fetchInterception = false,
    xhrInterception = false,
    beaconInterception = true,
    eventSourceInterception = true,
    websocketInterception = true,
    restrictedContextInterception = true,
    resourceAttributeInterception = false,
    formInterception = true,
    documentCookieBridge = false,
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
    (configuration.requestGeneration !== null &&
      configuration.requestGeneration !== undefined &&
      (typeof configuration.requestGeneration !== "string" ||
        !/^[0-9a-f]{32}$/.test(configuration.requestGeneration))) ||
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
  if (configuration.googleSession !== undefined) {
    var google = configuration.googleSession;
    if (
      !google ||
      google.version !== 1 ||
      google.nativeCookies !== true ||
      !Array.isArray(google.routes) ||
      google.routes.length < 3 ||
      google.routes.length > 20
    )
      throw new TypeError("Invalid Google session configuration");
    var googleOrigins = new Set();
    google.routes.forEach(function (entry) {
      if (!entry || typeof entry.documents !== "boolean")
        throw new TypeError("Invalid Google session route");
      var upstream = new NativeURL(origin(entry.upstreamOrigin, false));
      var local = new NativeURL(origin(entry.proxyOrigin, true));
      if (
        upstream.protocol !== "https:" ||
        upstream.port ||
        googleOrigins.has(upstream.origin) ||
        local.port !== new NativeURL(proxyOrigin).port
      )
        throw new TypeError("Invalid Google session route");
      googleOrigins.add(upstream.origin);
      if (upstream.origin === sourceOrigin) {
        if (local.origin !== proxyOrigin)
          throw new TypeError("Google document route mismatch");
      } else addRoute(upstream.origin, local.origin);
      if (entry.documents) {
        googleDocuments.add(upstream.origin);
        googleDocuments.add(local.origin);
      }
    });
    if (!googleOrigins.has(sourceOrigin))
      throw new TypeError("Missing Google document route");
    googleSession = { origins: Array.from(googleOrigins) };
  }
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
      quickConnect.navigationOrigins.length > 4 ||
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
          !/^https?:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.quickconnect\.to$/.test(
            canonical,
          ))
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      navigationOrigins.add(canonical);
    });
    redirectEndpoint = quickConnect.redirectEndpoint;
    if (quickConnect.regionalNavigation !== undefined) {
      var regionalNavigation = quickConnect.regionalNavigation;
      if (
        !regionalNavigation ||
        regionalNavigation.version !== 1 ||
        typeof regionalNavigation.alias !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(regionalNavigation.alias)
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      regionalNavigationAlias = regionalNavigation.alias;
    }
    if (quickConnect.directNavigation !== undefined) {
      var directNavigation = quickConnect.directNavigation;
      if (
        !directNavigation ||
        directNavigation.version !== 1 ||
        typeof directNavigation.alias !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(directNavigation.alias)
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      directNavigationAlias = directNavigation.alias;
    }
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
    if (quickConnect.discovered !== undefined) {
      var discovered = quickConnect.discovered;
      if (
        !discovered ||
        discovered.version !== 1 ||
        typeof discovered.alias !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(discovered.alias) ||
        discovered.proxyUrl !==
          proxyOrigin + "/__sortofremoteng_quickconnect_discovered_v1"
      )
        throw new TypeError("Invalid QuickConnect capability configuration");
      quickConnectDiscovered = {
        alias: discovered.alias,
        proxyUrl: discovered.proxyUrl,
      };
    }
  }
  // Closed Tactical RMM background-request capability. Native independently
  // validates this bounded exact-origin set on every request; this client
  // mapping is compatibility only and never grants a network destination.
  if (configuration.tacticalRmmApi !== undefined) {
    var tactical = configuration.tacticalRmmApi,
      source = new NativeURL(sourceOrigin),
      tacticalOrigins = new Set();
    if (
      !tactical ||
      tactical.version !== 2 ||
      source.protocol !== "https:" ||
      source.port ||
      !Array.isArray(tactical.apiOrigins) ||
      tactical.apiOrigins.length < 1 ||
      tactical.apiOrigins.length > 3 ||
      tactical.proxyUrl !==
        proxyOrigin + "/__sortofremoteng_tactical_rmm_api_v1"
    )
      throw new TypeError("Invalid Tactical RMM API route configuration");
    tactical.apiOrigins.forEach(function (value) {
      if (typeof value !== "string")
        throw new TypeError("Invalid Tactical RMM API route configuration");
      var api = new NativeURL(value);
      if (
        api.protocol !== "https:" ||
        api.port ||
        api.username ||
        api.password ||
        api.origin !== value ||
        !api.hostname.includes(".") ||
        api.hostname === "localhost" ||
        api.hostname.endsWith(".") ||
        api.pathname !== "/" ||
        api.search ||
        api.hash ||
        tacticalOrigins.has(api.origin)
      )
        throw new TypeError("Invalid Tactical RMM API route configuration");
      tacticalOrigins.add(api.origin);
    });
    tacticalRmmApi = {
      apiOrigins: tacticalOrigins,
      proxyUrl: tactical.proxyUrl,
    };
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
  function sameNasDirect(target, alias) {
    if (
      !alias ||
      target.protocol !== "https:" ||
      (target.port !== "5001" && target.port !== "5002")
    )
      return false;
    var suffix = alias + ".direct.quickconnect.to";
    var prefix = target.hostname.endsWith("." + suffix)
      ? target.hostname.slice(0, -(suffix.length + 1))
      : "";
    return (
      target.hostname === suffix ||
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix)
    );
  }
  function sameNasRegional(target, alias) {
    if (
      !alias ||
      target.protocol !== "https:" ||
      target.port ||
      target.hostname.length > 253
    )
      return false;
    var prefix = alias + ".",
      suffix = ".quickconnect.to";
    return (
      target.hostname.startsWith(prefix) &&
      target.hostname.endsWith(suffix) &&
      /^[a-z]{2}[0-9]{1,61}$/.test(
        target.hostname.slice(prefix.length, -suffix.length),
      )
    );
  }
  // Immutable per-document capability supplied by the native continuation
  // response. Native admission rejects missing/stale tokens independently.
  var generationKey = "__sorng_generation_v1",
    requestGeneration = configuration.requestGeneration;
  function mapUrl(
    value,
    kind,
    localData,
    method,
    navigationReference,
    sameDocumentNavigation,
  ) {
    var mapped = routeUrl(value, kind, localData, method, navigationReference);
    // Angular and other routers use detached anchors as URL parsers. An href
    // assignment sends no request: adding a proof here changes their application
    // query and can make a hash route look like a different document. Actual
    // Link activation is prepared separately below, including detached clicks
    // and browser-menu/auxiliary activation.
    if (!requestGeneration || navigationReference) return mapped;
    var url = new NativeURL(mapped);
    if (
      sameDocumentNavigation &&
      kind === "navigation" &&
      mapped.indexOf("#") !== -1
    ) {
      var current = new NativeURL(location.href);
      if (
        url.origin === current.origin &&
        url.pathname === current.pathname &&
        url.search === current.search
      )
        // Fragment-only navigation makes no network request. Preserve the
        // current query (including any existing navigation proof) byte-for-byte
        // so the browser keeps the document, its SPA state, and login session.
        return mapped;
    }
    var comparable = new NativeURL(url.href);
    if (comparable.protocol === "ws:") comparable.protocol = "http:";
    if (comparable.origin === proxyOrigin) {
      // Preserve exact application query encoding when adding the local proof.
      var pairs = url.search
        .slice(1)
        .split("&")
        .filter(function (pair) {
          return pair && pair.split("=")[0] !== generationKey;
        });
      pairs.push(generationKey + "=" + requestGeneration);
      url.search = pairs.join("&");
    }
    return url.href;
  }
  function routeUrl(value, kind, localData, method, navigationReference) {
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
      googleSession &&
      (kind === "navigation" || kind === "form" || kind === "document") &&
      !googleDocuments.has(target.origin)
    ) {
      throw blocked(kind, "origin-not-approved", target.origin);
    }
    if (
      quickConnectRpc &&
      (target.href === quickConnectRpc.upstreamUrl ||
        (sourceOrigin === "https://global.quickconnect.to" &&
          target.href === proxyOrigin + "/Serv.php")) &&
      (kind === "fetch" || kind === "xhr")
    ) {
      if (String(method).toUpperCase() !== "POST")
        throw blocked(kind, "quickconnect-control-method", target.origin);
      return quickConnectRpc.proxyUrl;
    }
    if (
      quickConnectDiscovered &&
      target.origin !== sourceOrigin &&
      target.origin !== proxyOrigin &&
      (kind === "fetch" || kind === "xhr") &&
      target.protocol === "https:" &&
      !target.hash
    ) {
      var regional =
        !target.port &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.quickconnect\.to$/.test(
          target.hostname,
        ) &&
        target.pathname === "/Serv.php" &&
        !target.search;
      var probe =
        (sameNasDirect(target, quickConnectDiscovered.alias) ||
          sameNasRegional(target, quickConnectDiscovered.alias)) &&
        target.pathname === "/webman/pingpong.cgi" &&
        target.search === "?action=cors&quickconnect=true";
      if (regional || probe) {
        if (String(method).toUpperCase() !== (regional ? "POST" : "GET"))
          throw blocked(
            kind,
            regional
              ? "quickconnect-control-method"
              : "quickconnect-probe-method",
            target.origin,
          );
        // Native validates the opted-in provider namespace, original alias,
        // exact control body and current document. Direct and regional relay
        // probes remain fixed anonymous GETs with native TLS/CORS/identity checks.
        var discoveredUrl = new NativeURL(quickConnectDiscovered.proxyUrl);
        discoveredUrl.searchParams.set("destination", target.href);
        return discoveredUrl.href;
      }
    }
    if (
      kind === "navigation" &&
      (navigationOrigins.has(target.origin) ||
        sameNasRegional(target, regionalNavigationAlias) ||
        sameNasDirect(target, directNavigationAlias))
    ) {
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
    if (
      tacticalRmmApi &&
      (kind === "fetch" || kind === "xhr") &&
      tacticalRmmApi.apiOrigins.has(target.origin)
    ) {
      if (target.hash || target.href.length > 16_384)
        throw blocked(kind, "invalid-url", target.origin);
      var tacticalApiUrl = new NativeURL(tacticalRmmApi.proxyUrl);
      tacticalApiUrl.searchParams.set("destination", target.href);
      tacticalApiUrl.searchParams.set(
        "__sorng_tactical_document_v1",
        String(sequence),
      );
      return tacticalApiUrl.href;
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
    if (!mapped) {
      // Anchor/area href assignment is inert and supports router URL parsing.
      // URL validation still applies; click capture omits navigationReference
      // and enforces origin approval before allowing actual navigation.
      if (kind === "navigation" && navigationReference) return target.href;
      throw blocked(kind, "origin-not-approved", lookup.origin);
    }
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
    if (!object) return false;
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
      return true;
    } catch (_) {
      blocked("compatibility", "unavailable-interceptor");
      return false;
    }
  }
  function wrapConstructor(name, kind) {
    var Native = window[name];
    if (typeof Native !== "function") return true;
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
    return replace(window, name, Wrapped);
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
  function isQuickConnectRelay(url) {
    if (requestGeneration) {
      var clean = new NativeURL(url);
      clean.searchParams.delete(generationKey);
      url = clean.href;
    }
    return (
      (quickConnectRpc && url === quickConnectRpc.proxyUrl) ||
      (quickConnectDiscovered &&
        (url === quickConnectDiscovered.proxyUrl ||
          url.startsWith(quickConnectDiscovered.proxyUrl + "?")))
    );
  }
  if (
    googleSession &&
    typeof NativeXMLHttpRequest === "function" &&
    typeof nativeXhrOpen === "function" &&
    typeof nativeXhrSetRequestHeader === "function" &&
    typeof nativeXhrSend === "function"
  ) {
    var cookieEndpoint = proxyOrigin + "/__sortofremoteng_google_cookie_v1",
      ownCookieDescriptor = Object.getOwnPropertyDescriptor(document, "cookie");
    function documentCookieRequest(method, value) {
      var xhr = new NativeXMLHttpRequest(),
        currentPath = new NativeURL(location.href).pathname;
      Reflect.apply(nativeXhrOpen, xhr, [method, cookieEndpoint, false]);
      Reflect.apply(nativeXhrSetRequestHeader, xhr, [
        "X-Sorng-Google-Cookie-Path",
        currentPath,
      ]);
      Reflect.apply(nativeXhrSend, xhr, [value]);
      if (xhr.status < 200 || xhr.status >= 300)
        throw new DOMException(
          "The Google cookie bridge is unavailable",
          "SecurityError",
        );
      return xhr.responseText || "";
    }
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        enumerable: true,
        get: function () {
          try {
            return documentCookieRequest("GET", null);
          } catch (_) {
            return "";
          }
        },
        set: function (value) {
          try {
            documentCookieRequest("POST", String(value));
          } catch (_) {
            // Browsers silently ignore rejected document.cookie assignments.
          }
        },
      });
      documentCookieBridge = true;
      restores.push(function () {
        if (ownCookieDescriptor)
          Object.defineProperty(document, "cookie", ownCookieDescriptor);
        else delete document.cookie;
      });
    } catch (_) {
      documentCookieBridge = false;
    }
  }
  if (typeof nativeFetch === "function") {
    function googleRequestOptions(url, options, credentials) {
      if (!googleSession) return options;
      var target = new NativeURL(url);
      if (!proxies.has(target.origin)) return options;
      var headers = new Headers(options?.headers);
      var mode = credentials || options?.credentials || "same-origin";
      var include =
        mode === "include" ||
        (mode === "same-origin" && target.origin === location.origin);
      headers.set("X-Sorng-Google-Credentials", include ? "include" : "omit");
      return Object.assign({}, options, { headers: headers });
    }
    function controlRequestOptions(url, options) {
      if (!isQuickConnectRelay(url)) return options;
      var headers = new Headers(options?.headers);
      headers.set("X-Sorng-QuickConnect-Document", String(sequence));
      return Object.assign({}, options, {
        headers: headers,
        credentials: "omit",
      });
    }
    fetchInterception = replace(window, "fetch", function (input, init) {
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
            requestOptions = googleRequestOptions(
              url,
              requestOptions,
              input.credentials,
            );
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
          init = googleRequestOptions(input, init, init?.credentials);
        }
        return Reflect.apply(nativeFetch, window, [input, init]);
      } catch (error) {
        return Promise.reject(error);
      }
    });
  }
  if (nativeXhrPrototype) {
    var xhrPrototype = nativeXhrPrototype,
      nativeOpen = nativeXhrOpen,
      nativeSetRequestHeader = nativeXhrSetRequestHeader,
      nativeSend = nativeXhrSend,
      googleXhr = new WeakMap();
    xhrInterception = replace(xhrPrototype, "open", function () {
      var args = Array.prototype.slice.call(arguments);
      args[1] = mapUrl(args[1], "xhr", false, args[0]);
      var control = isQuickConnectRelay(args[1]);
      var mapped = new NativeURL(args[1]);
      var googleControl = googleSession && proxies.has(mapped.origin);
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
      if (googleControl) googleXhr.set(this, mapped.origin === location.origin);
      return result;
    });
    if (typeof nativeSend === "function")
      replace(xhrPrototype, "send", function () {
        if (googleXhr.has(this)) {
          Reflect.apply(nativeSetRequestHeader, this, [
            "X-Sorng-Google-Credentials",
            this.withCredentials || googleXhr.get(this) ? "include" : "omit",
          ]);
        }
        return Reflect.apply(nativeSend, this, arguments);
      });
  }
  if (typeof navigator.sendBeacon === "function") {
    var nativeBeacon = navigator.sendBeacon;
    beaconInterception = replace(navigator, "sendBeacon", function (url, data) {
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
  eventSourceInterception = wrapConstructor("EventSource", "eventsource");
  websocketInterception = wrapConstructor("WebSocket", "websocket");
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
      restrictedContextInterception = false;
    }
  });
  ["Worker", "SharedWorker", "WebTransport"].forEach(function (name) {
    if (typeof window[name] === "function")
      restrictedContextInterception =
        replace(window, name, function () {
          throw blocked(name, "unsupported-network-context");
        }) && restrictedContextInterception;
  });
  if (navigator.serviceWorker)
    restrictedContextInterception =
      replace(navigator.serviceWorker, "register", function () {
        return Promise.reject(
          blocked("serviceworker", "unsupported-network-context"),
        );
      }) && restrictedContextInterception;
  if (window.Worklet)
    restrictedContextInterception =
      replace(window.Worklet.prototype, "addModule", function () {
        return Promise.reject(
          blocked("worklet", "unsupported-network-context"),
        );
      }) && restrictedContextInterception;
  if (typeof window.open === "function")
    restrictedContextInterception =
      replace(window, "open", function () {
        blocked("window", "unsupported-network-context");
        return null;
      }) && restrictedContextInterception;

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
  resourceAttributeInterception = replace(
    Element.prototype,
    "setAttribute",
    function (name, value) {
      var lower = String(name).toLowerCase();
      if (lower === "srcset" && /^(IMG|SOURCE)$/.test(this.tagName))
        value = srcset(value);
      else if (lower === "style") value = css(value);
      else value = resourceUrl(this, String(name), value);
      return Reflect.apply(nativeSetAttribute, this, [name, value]);
    },
  );
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
      formInterception =
        replace(window.HTMLFormElement.prototype, name, function (submitter) {
          prepareForm(this, submitter);
          return Reflect.apply(native, this, arguments);
        }) && formInterception;
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
  var preparedAnchors = new WeakMap();
  function prepareAnchor(anchor, event) {
    var target = (
      anchor.getAttribute("target") ||
      document.querySelector("base[target]")?.getAttribute("target") ||
      "_self"
    ).toLowerCase();
    var sameContext =
      target === "_self" &&
      !anchor.hasAttribute("download") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.button &&
      event.type !== "contextmenu";
    var href = anchor.getAttribute("href");
    var previous = preparedAnchors.get(anchor);
    // A cancelled context menu must not turn the next normal hash click into
    // a reload. Reuse the pre-activation URL only while our own write remains;
    // any application-owned href change takes precedence.
    var original =
      previous && href === previous.mapped ? previous.original : href;
    var mapped = mapUrl(
      original,
      "navigation",
      false,
      undefined,
      false,
      sameContext,
    );
    Reflect.apply(nativeSetAttribute, anchor, ["href", mapped]);
    preparedAnchors.set(anchor, { original: original, mapped: mapped });
  }
  function click(event) {
    var anchor = event.target?.closest?.("a[href],area[href]");
    if (!anchor) return;
    try {
      prepareAnchor(anchor, event);
    } catch (_) {
      event.preventDefault();
    }
  }
  document.addEventListener("submit", submit, true);
  document.addEventListener("click", click, true);
  document.addEventListener("auxclick", click, true);
  document.addEventListener("contextmenu", click, true);
  [window.HTMLAnchorElement, window.HTMLAreaElement].forEach(function (Native) {
    var nativeClick = Native && Native.prototype.click;
    if (typeof nativeClick !== "function") return;
    replace(Native.prototype, "click", function () {
      // Detached anchors never reach document capture listeners.
      if (!this.isConnected && this.hasAttribute("href"))
        prepareAnchor(this, { type: "click", button: 0 });
      return Reflect.apply(nativeClick, this, arguments);
    });
  });
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
    quickConnectDiscovered = null;
    regionalNavigationAlias = null;
    directNavigationAlias = null;
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
    document.removeEventListener("auxclick", click, true);
    document.removeEventListener("contextmenu", click, true);
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
  return Object.freeze({
    mapUrl: mapUrl,
    dispose: dispose,
    // Advisory installation receipt only; this does not prove engine-wide
    // interception and must never create permission in the parent application.
    capabilities: Object.freeze({
      version: 6,
      ...(googleSession
        ? {
            googleSession: Object.freeze({
              version: 1,
              origins: Object.freeze(googleSession.origins),
              documents: true, // Native-issued exact local aliases + response rewriting.
              forms: formInterception && resourceAttributeInterception,
              fetch: fetchInterception,
              xhr: xhrInterception,
              resources: resourceAttributeInterception,
              nativeCookies: true,
              nativeUserAgent: true,
              documentCookieBridge: documentCookieBridge,
            }),
          }
        : {}),
      tacticalRmmApi:
        tacticalRmmApi !== null && fetchInterception && xhrInterception,
      tacticalRmmApiOrigins: Object.freeze(
        tacticalRmmApi ? Array.from(tacticalRmmApi.apiOrigins) : [],
      ),
      fetchInterception: fetchInterception,
      xhrInterception: xhrInterception,
      pageNetworkInterception:
        fetchInterception &&
        xhrInterception &&
        beaconInterception &&
        eventSourceInterception &&
        websocketInterception &&
        restrictedContextInterception &&
        resourceAttributeInterception &&
        formInterception,
      quickConnectNavigation:
        navigationOrigins.size > 0 ||
        directNavigationAlias !== null ||
        regionalNavigationAlias !== null,
      quickConnectDiscovery:
        quickConnectRpc !== null || quickConnectDiscovered !== null,
      quickConnectDiscovered: quickConnectDiscovered !== null,
      quickConnectDirectNavigation: directNavigationAlias !== null,
      quickConnectRegionalNavigation: regionalNavigationAlias !== null,
    }),
  });
}
