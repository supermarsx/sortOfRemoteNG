/* Compatibility routing, NOT a security boundary. Native request/navigation
 * denial and response CSP must remain effective if a page removes this code.
 * No origin is approved here; only the native document's immutable map is used.
 */
function installWebNetworkClient(configuration, reportBlocked, reportPopup) {
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
    externalFontOrigins = new Set(),
    externalFontEndpoint = null,
    externalResourceOrigins = new Map(),
    externalResourceEndpoint = null,
    allowAllScripts = false,
    publicRequests = null,
    navigationOrigins = new Set(),
    quickConnectRpc = null,
    quickConnectDiscovered = null,
    tacticalRmmApi = null,
    ptispApi = null,
    tacticalRmmMesh = null,
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
    hideWebdriver = false,
    webdriverMasked = false,
    popupClient = null,
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
    (configuration.popupParentDocument != null &&
      (!Number.isSafeInteger(configuration.popupParentDocument) ||
        configuration.popupParentDocument !==
          configuration.documentSequence)) ||
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
  var allowBlobWorkers = configuration.blobWorkers === true;
  if (
    (configuration.blobWorkers !== undefined &&
      typeof configuration.blobWorkers !== "boolean") ||
    (allowBlobWorkers &&
      sourceOrigin !== "https://dash.cloudflare.com" &&
      sourceOrigin !== "https://porkbun.com" &&
      sourceOrigin !== "https://challenges.cloudflare.com")
  )
    throw new TypeError("Invalid blob worker capability");
  if (configuration.browserCompatibility !== undefined) {
    var compatibility = configuration.browserCompatibility;
    if (
      !compatibility ||
      typeof compatibility !== "object" ||
      Array.isArray(compatibility) ||
      typeof compatibility.hideWebdriver !== "boolean" ||
      Object.keys(compatibility).some(function (key) {
        return key !== "hideWebdriver";
      })
    )
      throw new TypeError("Invalid browser compatibility configuration");
    hideWebdriver = compatibility.hideWebdriver;
  }
  var exchangeCookies = configuration.exchangeCookies === true;
  if (
    (configuration.exchangeCookies !== undefined &&
      typeof configuration.exchangeCookies !== "boolean") ||
    (exchangeCookies && new NativeURL(sourceOrigin).protocol !== "https:")
  )
    throw new TypeError("Invalid Exchange cookie bridge configuration");
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
  // Cloudflare's challenge is a separate, credential-free native route, never
  // a wildcard permission for Cloudflare services or an external network exit.
  if (configuration.cloudflareChallenge !== undefined) {
    var challenge = configuration.cloudflareChallenge;
    if (
      !challenge ||
      challenge.version !== 1 ||
      // Keep the closed source set aligned with Rust's reviewed_source().
      (sourceOrigin !== "https://dash.cloudflare.com" &&
        sourceOrigin !== "https://porkbun.com") ||
      challenge.upstreamOrigin !== "https://challenges.cloudflare.com"
    )
      throw new TypeError("Invalid Cloudflare challenge route");
    var challengeProxy = new NativeURL(origin(challenge.proxyOrigin, true));
    if (challengeProxy.port !== new NativeURL(proxyOrigin).port)
      throw new TypeError("Invalid Cloudflare challenge route");
    addRoute(challenge.upstreamOrigin, challengeProxy.origin);
  }
  // An exact, native-issued MeshCentral alias is isolated from dashboard
  // cookies and belongs to this root document's network lifetime.
  if (configuration.tacticalRmmMesh !== undefined) {
    var mesh = configuration.tacticalRmmMesh;
    if (!mesh || mesh.version !== 1)
      throw new TypeError("Invalid Tactical RMM MeshCentral route");
    var meshUpstream = new NativeURL(origin(mesh.upstreamOrigin, false));
    var meshProxy = new NativeURL(origin(mesh.proxyOrigin, true));
    if (
      meshUpstream.protocol !== "https:" ||
      meshProxy.port !== new NativeURL(proxyOrigin).port
    )
      throw new TypeError("Invalid Tactical RMM MeshCentral route");
    if (meshUpstream.origin === sourceOrigin) {
      if (meshProxy.origin !== proxyOrigin)
        throw new TypeError("MeshCentral document route mismatch");
    } else {
      addRoute(meshUpstream.origin, meshProxy.origin);
    }
    tacticalRmmMesh = {
      upstreamOrigin: meshUpstream.origin,
      proxyOrigin: meshProxy.origin,
    };
  }
  if (configuration.googleSession !== undefined) {
    var google = configuration.googleSession;
    if (
      !google ||
      google.version !== 1 ||
      google.nativeCookies !== true ||
      !Array.isArray(google.routes) ||
      google.routes.length < 2 ||
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
  // A copied, closed font/stylesheet capability, never a general origin route.
  // Native suppresses this manifest when external fonts are off or same-origin
  // policy is active, and independently checks destinations and response bytes.
  if (configuration.externalFonts != null) {
    var externalFonts = configuration.externalFonts;
    if (
      typeof externalFonts !== "object" ||
      Array.isArray(externalFonts) ||
      Object.keys(externalFonts).some(function (key) {
        return !["version", "origins", "proxyEndpoint"].includes(key);
      }) ||
      externalFonts.version !== 1 ||
      !Array.isArray(externalFonts.origins) ||
      externalFonts.origins.length > 16 ||
      externalFonts.proxyEndpoint !==
        proxyOrigin + "/__sortofremoteng_assets_v1/external-font"
    )
      throw new TypeError("Invalid external font configuration");
    for (var externalOrigin of externalFonts.origins) {
      var canonicalFontOrigin = origin(externalOrigin, false);
      if (
        !canonicalFontOrigin.startsWith("https://") ||
        canonicalFontOrigin.includes("*") ||
        externalFontOrigins.has(canonicalFontOrigin)
      )
        throw new TypeError("Invalid external font configuration");
      externalFontOrigins.add(canonicalFontOrigin);
    }
    externalFontEndpoint = externalFonts.proxyEndpoint;
  }
  if (configuration.externalResources != null) {
    var externalResources = configuration.externalResources;
    if (
      typeof externalResources !== "object" ||
      Array.isArray(externalResources) ||
      Object.keys(externalResources).some(function (key) {
        return ![
          "version",
          "origins",
          "proxyEndpoint",
          "allowAllScripts",
        ].includes(key);
      }) ||
      externalResources.version !== 1 ||
      (externalResources.allowAllScripts !== undefined &&
        typeof externalResources.allowAllScripts !== "boolean") ||
      !Array.isArray(externalResources.origins) ||
      externalResources.origins.length > 16 ||
      externalResources.proxyEndpoint !==
        proxyOrigin + "/__sortofremoteng_assets_v1/external-resource"
    )
      throw new TypeError("Invalid external resource configuration");
    for (var resourceOrigin of externalResources.origins) {
      if (
        !resourceOrigin ||
        typeof resourceOrigin !== "object" ||
        Object.keys(resourceOrigin).some(function (key) {
          return !["origin", "kinds"].includes(key);
        }) ||
        !Array.isArray(resourceOrigin.kinds) ||
        !resourceOrigin.kinds.length ||
        resourceOrigin.kinds.length > 2 ||
        new Set(resourceOrigin.kinds).size !== resourceOrigin.kinds.length ||
        resourceOrigin.kinds.some(function (kind) {
          return kind !== "script" && kind !== "stylesheet";
        })
      )
        throw new TypeError("Invalid external resource configuration");
      var canonicalResourceOrigin = origin(resourceOrigin.origin, false);
      if (
        !canonicalResourceOrigin.startsWith("https://") ||
        canonicalResourceOrigin.includes("*") ||
        externalResourceOrigins.has(canonicalResourceOrigin)
      )
        throw new TypeError("Invalid external resource configuration");
      externalResourceOrigins.set(
        canonicalResourceOrigin,
        new Set(resourceOrigin.kinds),
      );
    }
    externalResourceEndpoint = externalResources.proxyEndpoint;
    allowAllScripts = externalResources.allowAllScripts === true;
  }
  if (configuration.publicRequests !== undefined) {
    var publicCapability = configuration.publicRequests;
    if (
      !publicCapability ||
      typeof publicCapability !== "object" ||
      Array.isArray(publicCapability) ||
      publicCapability.version !== 1 ||
      Object.keys(publicCapability).some(function (key) {
        return ![
          "version",
          "proxyEndpoint",
          "navigationEndpoint",
          "httpsOnly",
          "allowHttpDowngrade",
          "scripts",
        ].includes(key);
      }) ||
      publicCapability.proxyEndpoint !==
        proxyOrigin + "/__sortofremoteng_public_request_v1" ||
      publicCapability.navigationEndpoint !==
        proxyOrigin + "/__sortofremoteng_public_navigation_v1" ||
      ["httpsOnly", "allowHttpDowngrade", "scripts"].some(function (key) {
        return typeof publicCapability[key] !== "boolean";
      })
    )
      throw new TypeError("Invalid public request capability configuration");
    publicRequests = Object.freeze(Object.assign({}, publicCapability));
    allowAllScripts = allowAllScripts || publicRequests.scripts;
  }
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

  // PTisp has one reviewed first-party HTTP API, not a Tactical capability.
  if (configuration.ptispApi !== undefined) {
    var ptisp = configuration.ptispApi;
    if (
      !ptisp ||
      ptisp.version !== 2 ||
      sourceOrigin !== "https://my.ptisp.pt" ||
      configuration.tacticalRmmApi !== undefined ||
      configuration.tacticalRmmMesh !== undefined ||
      !Array.isArray(ptisp.apiOrigins) ||
      ptisp.apiOrigins.length !== 1 ||
      ptisp.apiOrigins[0] !== "https://api3.ptisp.pt" ||
      ptisp.proxyUrl !== proxyOrigin + "/__sortofremoteng_ptisp_api_v1"
    )
      throw new TypeError("Invalid PTisp API route configuration");
    ptispApi = {
      apiOrigins: new Set(ptisp.apiOrigins),
      proxyUrl: ptisp.proxyUrl,
    };
  }

  // Best-effort, explicitly opted-in page compatibility. This does not conceal
  // the embedded engine or alter network permissions. Validate the entire route
  // manifest above before changing page state. Leave native false/absent alone.
  if (hideWebdriver) {
    try {
      var browserNavigator = window.navigator;
      if (browserNavigator && browserNavigator.webdriver === true) {
        var originalWebdriver = Object.getOwnPropertyDescriptor(
          browserNavigator,
          "webdriver",
        );
        var webdriverGetter = function () {
          return false;
        };
        Object.defineProperty(browserNavigator, "webdriver", {
          configurable: true,
          enumerable: originalWebdriver ? originalWebdriver.enumerable : true,
          get: webdriverGetter,
        });
        webdriverMasked = true;
        restores.push(function () {
          var current = Object.getOwnPropertyDescriptor(
            browserNavigator,
            "webdriver",
          );
          if (!current || current.get !== webdriverGetter) return;
          try {
            if (originalWebdriver)
              Object.defineProperty(
                browserNavigator,
                "webdriver",
                originalWebdriver,
              );
            else delete browserNavigator.webdriver;
          } catch (_) {
            // A site may lock the installed descriptor. Continue other cleanup.
          }
        });
      }
    } catch (_) {
      // A locked native property is not a reason to break proxy initialization.
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
  function externalFontKind(kind) {
    return kind === "stylesheet"
      ? "stylesheet"
      : kind === "font" || kind === "css"
        ? "font"
        : null;
  }
  function approvedExternalFont(target) {
    return (
      target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      target.href.indexOf("#") === -1 &&
      externalFontOrigins.has(target.origin)
    );
  }
  function approvedExternalResource(target, kind) {
    return (
      target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      target.href.indexOf("#") === -1 &&
      target.href.length <= 8192 &&
      ((allowAllScripts && kind === "script") ||
        (externalResourceOrigins.has(target.origin) &&
          externalResourceOrigins.get(target.origin).has(kind)))
    );
  }
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
    if (
      navigationReference ||
      (!requestGeneration && configuration.popupParentDocument == null)
    )
      return mapped;
    var url = new NativeURL(mapped);
    // A blob can carry the proxy's origin, but it is local bytes, not an HTTP
    // request. Appending a document proof would change its opaque lookup key.
    if (url.protocol === "data:" || url.protocol === "blob:") return mapped;
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
          return (
            pair &&
            pair.split("=")[0] !== generationKey &&
            (configuration.popupParentDocument == null ||
              pair.split("=")[0] !== "__sorng_popup_parent_v1")
          );
        });
      if (requestGeneration)
        pairs.push(generationKey + "=" + requestGeneration);
      if (
        configuration.popupParentDocument != null &&
        (kind === "navigation" || kind === "document")
      )
        pairs.push(
          "__sorng_popup_parent_v1=" + configuration.popupParentDocument,
        );
      url.search = pairs.join("&");
    }
    return url.href;
  }
  function routeUrl(value, kind, localData, method, navigationReference) {
    if (!active) throw blocked(kind, "document-closed");
    var target;
    try {
      var input = String(value);
      // MeshCentral renders each desktop tile by assigning an in-memory JPEG
      // data URL to Image.src. Those payloads routinely exceed the network URL
      // limit, but cannot cause egress from this image-only sink.
      var meshDesktopTile =
        localData === "mesh-desktop-image" &&
        // This only checks the expected prefix and character shape. The native
        // image decoder remains responsible for validating the actual content.
        /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(input);
      if (input.length > 16_384 && !meshDesktopTile)
        throw new Error("URL is too long");
      target = new NativeURL(input, document.baseURI || rootLocation);
      if (input.startsWith("//") && !proxies.has(target.origin))
        target = new NativeURL(new NativeURL(sourceOrigin).protocol + input);
    } catch (_) {
      throw blocked(kind, "invalid-url");
    }
    if (target.username || target.password)
      throw blocked(kind, "url-credentials");
    var publicNavigation = kind === "navigation";
    if (
      publicRequests &&
      target.origin === proxyOrigin &&
      [
        "/__sortofremoteng_public_request_v1",
        "/__sortofremoteng_public_navigation_v1",
      ].includes(target.pathname)
    ) {
      var publicParameters = target.searchParams,
        publicKeys = new Set();
      for (var publicKey of publicParameters.keys()) {
        if (
          !["destination", "kind", "document", generationKey].includes(
            publicKey,
          ) ||
          publicKeys.has(publicKey)
        )
          throw blocked(kind, "invalid-url");
        publicKeys.add(publicKey);
      }
      if (
        publicParameters.get("document") !== String(sequence) ||
        (publicParameters.has(generationKey) &&
          publicParameters.get(generationKey) !== requestGeneration) ||
        (publicNavigation
          ? publicParameters.has("kind") ||
            target.pathname !== "/__sortofremoteng_public_navigation_v1"
          : (publicParameters.get("kind") !== kind &&
              !(
                ["resource", "font", "css"].includes(
                  publicParameters.get("kind"),
                ) && ["resource", "font", "css"].includes(kind)
              )) ||
            target.pathname !== "/__sortofremoteng_public_request_v1") ||
        target.hash
      )
        throw blocked(kind, "invalid-url");
      return routeUrl(
        publicParameters.get("destination"),
        kind,
        localData,
        method,
        navigationReference,
      );
    }
    if (
      googleSession &&
      !(publicRequests && publicNavigation) &&
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
      publicRequests &&
      target.origin !== sourceOrigin &&
      target.origin !== proxyOrigin &&
      !fontAssets.has(target.href) &&
      !(
        (ptispApi || tacticalRmmApi) &&
        (kind === "fetch" || kind === "xhr" || kind === "websocket") &&
        (ptispApi || tacticalRmmApi).apiOrigins.has(
          target.origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
        )
      ) &&
      ((!routes.has(target.origin) && !proxies.has(target.origin)) ||
        (publicNavigation &&
          googleSession &&
          !googleDocuments.has(target.origin)))
    ) {
      // A resource-only hosted alias is not a document grant. Convert it back
      // to its upstream identity before creating an anonymous review receipt.
      if (proxies.has(target.origin)) {
        for (var route of routes) {
          if (route[1] === target.origin) {
            target = new NativeURL(
              route[0] + target.pathname + target.search + target.hash,
            );
            break;
          }
        }
      }
      if (
        (target.protocol === "data:" || target.protocol === "blob:") &&
        (localData || (publicRequests.scripts && kind === "script"))
      )
        return target.href;
      if (!/^https?:$/.test(target.protocol))
        throw blocked(kind, "unsupported-scheme", target.origin);
      if (target.href.length > 4096)
        throw blocked(kind, "invalid-url", target.origin);
      if (
        target.protocol === "http:" &&
        (publicRequests.httpsOnly ||
          (new NativeURL(sourceOrigin).protocol === "https:" &&
            !publicRequests.allowHttpDowngrade))
      )
        throw blocked(kind, "policy-blocked-resource", target.origin);
      if (kind === "script" && !publicRequests.scripts)
        throw blocked(kind, "policy-blocked-resource", target.origin);
      if (
        !publicNavigation &&
        ![
          "fetch",
          "xhr",
          "beacon",
          "resource",
          "font",
          "css",
          "stylesheet",
          "script",
        ].includes(kind)
      )
        throw blocked(kind, "unsupported-network-context", target.origin);
      if (publicNavigation && navigationReference) return target.href;
      var publicRoute = new NativeURL(
        publicNavigation
          ? publicRequests.navigationEndpoint
          : publicRequests.proxyEndpoint,
      );
      publicRoute.searchParams.set("destination", target.href);
      if (!publicNavigation) publicRoute.searchParams.set("kind", kind);
      publicRoute.searchParams.set("document", String(sequence));
      return publicRoute.href;
    }
    if (fontAssets.has(target.href)) {
      if (kind === "font" || kind === "css") return fontAssets.get(target.href);
      if (kind === "fetch" || kind === "xhr") {
        if (String(method).toUpperCase() !== "GET")
          throw blocked("font", "font-read-only", target.origin);
        return fontAssets.get(target.href);
      }
    }
    var resourceKind = kind === "script" || kind === "stylesheet" ? kind : null;
    if (
      target.origin === proxyOrigin &&
      target.pathname === "/__sortofremoteng_assets_v1/external-resource"
    ) {
      var resourceParameters = target.searchParams,
        resourceKeys = new Set(),
        resourceDestination;
      try {
        resourceDestination = new NativeURL(
          resourceParameters.get("destination"),
        );
      } catch (_) {
        throw blocked(kind, "invalid-resource-route");
      }
      for (var resourceKey of resourceParameters.keys()) {
        if (
          !["destination", "kind", generationKey].includes(resourceKey) ||
          resourceKeys.has(resourceKey)
        )
          throw blocked(kind, "invalid-resource-route");
        resourceKeys.add(resourceKey);
      }
      if (
        !externalResourceEndpoint ||
        !resourceKind ||
        resourceParameters.get("kind") !== resourceKind ||
        target.href.indexOf("#") !== -1 ||
        !approvedExternalResource(resourceDestination, resourceKind) ||
        (resourceParameters.has(generationKey) &&
          resourceParameters.get(generationKey) !== requestGeneration)
      )
        throw blocked(kind, "invalid-resource-route");
      return target.href;
    }
    if (
      resourceKind &&
      !routes.has(target.origin) &&
      !proxies.has(target.origin) &&
      approvedExternalResource(target, resourceKind)
    ) {
      var resourceRoute = new NativeURL(externalResourceEndpoint);
      resourceRoute.searchParams.set("destination", target.href);
      resourceRoute.searchParams.set("kind", resourceKind);
      return resourceRoute.href;
    }
    var fontKind = externalFontKind(kind);
    if (
      target.origin === proxyOrigin &&
      target.pathname === "/__sortofremoteng_assets_v1/external-font"
    ) {
      // Static rewrites and repeated dynamic setters may already contain the
      // endpoint. Keep them idempotent without admitting it to other contexts.
      var parameters = target.searchParams,
        seenParameters = new Set(),
        destination;
      try {
        destination = new NativeURL(parameters.get("destination"));
      } catch (_) {
        throw blocked(kind, "invalid-font-route");
      }
      for (var parameter of parameters.keys()) {
        if (
          !["destination", "kind", generationKey].includes(parameter) ||
          seenParameters.has(parameter)
        )
          throw blocked(kind, "invalid-font-route");
        seenParameters.add(parameter);
      }
      if (
        !externalFontEndpoint ||
        !fontKind ||
        parameters.get("kind") !== fontKind ||
        target.href.indexOf("#") !== -1 ||
        !approvedExternalFont(destination) ||
        (parameters.has(generationKey) &&
          parameters.get(generationKey) !== requestGeneration)
      )
        throw blocked(kind, "invalid-font-route");
      return target.href;
    }
    if (
      fontKind &&
      !routes.has(target.origin) &&
      !proxies.has(target.origin) &&
      approvedExternalFont(target)
    ) {
      var fontRoute = new NativeURL(externalFontEndpoint);
      fontRoute.searchParams.set("destination", target.href);
      fontRoute.searchParams.set("kind", fontKind);
      // mapUrl adds the document generation after this capability is mapped.
      return fontRoute.href;
    }
    if (
      (localData || (allowAllScripts && kind === "script")) &&
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
    var applicationApi = ptispApi || tacticalRmmApi;
    if (
      applicationApi &&
      (kind === "fetch" ||
        kind === "xhr" ||
        (!ptispApi && kind === "websocket")) &&
      applicationApi.apiOrigins.has(lookup.origin)
    ) {
      if (lookup.hash || lookup.href.length > 16_384)
        throw blocked(kind, "invalid-url", lookup.origin);
      if (socket && lookup.searchParams.has("__sorng_ws_document_v1"))
        throw blocked(kind, "reserved-url-parameter");
      // Native revalidates this exact HTTPS destination and uses the API's
      // certificate-verifying proxy client for both HTTP and WSS upgrades.
      var tacticalApiUrl = new NativeURL(applicationApi.proxyUrl);
      tacticalApiUrl.searchParams.set("destination", lookup.href);
      tacticalApiUrl.searchParams.set(
        ptispApi ? "__sorng_ptisp_document_v1" : "__sorng_tactical_document_v1",
        String(sequence),
      );
      if (socket) {
        tacticalApiUrl.protocol = "ws:";
        tacticalApiUrl.searchParams.set(
          "__sorng_ws_document_v1",
          String(sequence),
        );
      }
      return tacticalApiUrl.href;
    }
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
    // URL.hash is empty both for no fragment and for the explicit empty '#'.
    // Preserve the latter: FreePBX and other modal launchers use href="#".
    // Dropping it makes mapUrl stamp a new request proof and turns an in-page
    // activation into a document reload before the user can submit the dialog.
    result.hash = target.hash || (target.href.indexOf("#") !== -1 ? "#" : "");
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
    (googleSession || exchangeCookies) &&
    typeof NativeXMLHttpRequest === "function" &&
    typeof nativeXhrOpen === "function" &&
    typeof nativeXhrSetRequestHeader === "function" &&
    typeof nativeXhrSend === "function"
  ) {
    var cookieBridgeName = googleSession ? "Google" : "Exchange",
      cookieEndpoint =
        proxyOrigin +
        (googleSession
          ? "/__sortofremoteng_google_cookie_v1"
          : "/__sortofremoteng_exchange_cookie_v1" +
            (requestGeneration
              ? "?__sorng_generation_v1=" + requestGeneration
              : "")),
      ownCookieDescriptor = Object.getOwnPropertyDescriptor(document, "cookie");
    function documentCookieRequest(method, value) {
      if (
        !googleSession &&
        (!active || new NativeURL(location.href).origin !== proxyOrigin)
      )
        throw new DOMException(
          "The Exchange cookie bridge is unavailable",
          "SecurityError",
        );
      var xhr = new NativeXMLHttpRequest(),
        currentPath = new NativeURL(location.href).pathname;
      Reflect.apply(nativeXhrOpen, xhr, [method, cookieEndpoint, false]);
      Reflect.apply(nativeXhrSetRequestHeader, xhr, [
        "X-Sorng-" + cookieBridgeName + "-Cookie-Path",
        currentPath,
      ]);
      Reflect.apply(nativeXhrSend, xhr, [value]);
      if (xhr.status < 200 || xhr.status >= 300)
        throw new DOMException(
          "The " + cookieBridgeName + " cookie bridge is unavailable",
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
    function nativeCookieRequestOptions(url, options, credentials) {
      if (!googleSession && !exchangeCookies) return options;
      var target = new NativeURL(url);
      if (
        googleSession
          ? !proxies.has(target.origin)
          : target.origin !== proxyOrigin
      )
        return options;
      var headers = new Headers(options?.headers);
      var mode = credentials || options?.credentials || "same-origin";
      var include =
        mode === "include" ||
        (mode === "same-origin" && target.origin === location.origin);
      headers.set(
        googleSession
          ? "X-Sorng-Google-Credentials"
          : "X-Sorng-Exchange-Credentials",
        include ? "include" : "omit",
      );
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
            requestOptions = nativeCookieRequestOptions(
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
          if (
            exchangeCookies &&
            !googleSession &&
            new NativeURL(url).origin === proxyOrigin
          ) {
            input = new NativeRequest(input, init);
            init = nativeCookieRequestOptions(
              url,
              { headers: input.headers },
              input.credentials,
            );
          }
        } else {
          input = mapUrl(input, "fetch", false, init?.method ?? "GET");
          init = controlRequestOptions(input, init);
          init = nativeCookieRequestOptions(input, init, init?.credentials);
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
      nativeCookieXhr = new WeakMap();
    xhrInterception = replace(xhrPrototype, "open", function () {
      var args = Array.prototype.slice.call(arguments);
      args[1] = mapUrl(args[1], "xhr", false, args[0]);
      var control = isQuickConnectRelay(args[1]);
      var mapped = new NativeURL(args[1]);
      var cookieControl = googleSession
        ? proxies.has(mapped.origin)
        : exchangeCookies && mapped.origin === proxyOrigin;
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
      nativeCookieXhr.delete(this);
      if (cookieControl)
        nativeCookieXhr.set(this, mapped.origin === location.origin);
      return result;
    });
    if (typeof nativeSend === "function")
      replace(xhrPrototype, "send", function () {
        if (nativeCookieXhr.has(this)) {
          Reflect.apply(nativeSetRequestHeader, this, [
            googleSession
              ? "X-Sorng-Google-Credentials"
              : "X-Sorng-Exchange-Credentials",
            this.withCredentials || nativeCookieXhr.get(this)
              ? "include"
              : "omit",
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
  // A blob worker inherits the response CSP of its creator. Only native-issued
  // challenge documents opt in, with worker-src blob: and connect/script sources
  // still confined to local proxy aliases. Network-backed worker scripts remain
  // denied by worker-src blob:. Preserve the real native API: a constructor
  // wrapper is not needed for containment and changes the browser environment.
  // Native route revocation still ends access to the owning proxy session.
  (allowBlobWorkers
    ? ["SharedWorker", "WebTransport"]
    : ["Worker", "SharedWorker", "WebTransport"]
  ).forEach(function (name) {
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
  if (typeof installWebPopupClient === "function") {
    popupClient = installWebPopupClient({
      tabBridge:
        tacticalRmmApi &&
        configuration.popupTabs === true &&
        !configuration.popupParentDocument &&
        typeof reportPopup === "function"
          ? {
              sessionId: sessionId,
              documentSequence: sequence,
              report: reportPopup,
            }
          : null,
      proxyOrigin: proxyOrigin,
      mapUrl: mapUrl,
      isActive: function () {
        return active;
      },
      blocked: blocked,
    });
    if (popupClient.closeSelf) {
      replace(window, "close", popupClient.closeSelf);
      // The immediate parent is the same-origin website, never the app shell.
      // Editors can refresh their file-manager opener without exposing Tauri.
      if (!window.frameElement?.hasAttribute("data-sorng-popup-noopener"))
        replace(window, "opener", window.parent);
    }
  }
  if (typeof window.open === "function")
    restrictedContextInterception =
      replace(window, "open", function (url, target, features) {
        if (popupClient) {
          try {
            return popupClient.open(url, target, features);
          } catch (_) {
            return null;
          }
        }
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
      (String(value).trim() === "" || String(value).trim() === "about:blank")
    )
      // An empty frame src is a blank document, not a relative URL. Resolving
      // it against this page recursively nests SPA popup/status/control UI
      // while the application is still waiting for its real frame address.
      return "about:blank";
    var mapped = mapUrl(
      value,
      /^(A|AREA)$/.test(element.tagName)
        ? "navigation"
        : element.tagName === "FORM" || name.toLowerCase() === "formaction"
          ? "form"
          : /^(IFRAME|FRAME)$/.test(element.tagName) &&
              (configuration.popupParentDocument != null || publicRequests)
            ? "document"
            : element.tagName === "SCRIPT"
              ? "script"
              : element.tagName === "LINK"
                ? linkKind(
                    element.getAttribute("rel"),
                    element.getAttribute("as"),
                  )
                : "resource",
      element.tagName === "IMG" && name.toLowerCase() === "src"
        ? "mesh-desktop-image"
        : /^(SOURCE|AUDIO|VIDEO)$/.test(element.tagName),
      undefined,
      /^(A|AREA)$/.test(element.tagName),
    );
    if (/^(A|AREA)$/.test(element.tagName)) {
      var literal = String(value);
      // Legacy SPA routers read getAttribute('href'), not the resolved href.
      // Keep local root-relative routes literal; assignment is not navigation.
      // A foreign <base> or a protocol-relative URL must still be rewritten.
      if (/^\/(?!\/)/.test(literal)) {
        var resolved = new NativeURL(literal, document.baseURI || rootLocation);
        if (resolved.origin === proxyOrigin && resolved.href === mapped)
          return literal;
      }
    }
    return mapped;
  }
  var nativeSetAttribute = Element.prototype.setAttribute,
    nativeRemoveAttribute = Element.prototype.removeAttribute,
    fontLinks = new WeakMap();
  function linkKind(rel, as) {
    var tokens = String(rel || "")
      .toLowerCase()
      .trim()
      .split(/\s+/);
    if (tokens.includes("stylesheet")) return "stylesheet";
    if (
      tokens.includes("modulepreload") ||
      (tokens.includes("preload") && String(as).toLowerCase() === "script")
    )
      return "script";
    if (tokens.includes("preload") && String(as).toLowerCase() === "style")
      return "stylesheet";
    if (tokens.includes("preload") && String(as).toLowerCase() === "font")
      return "font";
    return "resource";
  }
  function setLinkAttribute(element, name, value, remove) {
    value = remove ? null : String(value);
    if (name === "href" && remove) {
      fontLinks.delete(element);
      return Reflect.apply(nativeRemoveAttribute, element, [name]);
    }
    var current = element.getAttribute("href"),
      previous = fontLinks.get(element),
      original =
        name === "href"
          ? value
          : previous && previous.mapped === current
            ? previous.original
            : current,
      rel = name === "rel" ? value : element.getAttribute("rel"),
      as = name === "as" ? value : element.getAttribute("as"),
      kind = linkKind(rel, as),
      mapped = null;
    if (original !== null) {
      // href is often assigned before rel/as. Hold approved font capabilities
      // inert until the load context is known, never expose the remote href.
      var target = new NativeURL(original, document.baseURI || rootLocation);
      if (original.startsWith("//") && !proxies.has(target.origin))
        target = new NativeURL(new NativeURL(sourceOrigin).protocol + original);
      var incomplete =
        !String(rel || "").trim() ||
        (String(rel).toLowerCase().trim() === "preload" && !as);
      if (
        kind === "resource" &&
        incomplete &&
        !routes.has(target.origin) &&
        !proxies.has(target.origin) &&
        (publicRequests ||
          approvedExternalFont(target) ||
          fontAssets.has(target.href) ||
          approvedExternalResource(target, "script") ||
          approvedExternalResource(target, "stylesheet"))
      )
        mapUrl(
          original,
          approvedExternalResource(target, "stylesheet")
            ? "stylesheet"
            : approvedExternalResource(target, "script")
              ? "script"
              : "font",
        ); // Validate lifetime even while deferred.
      else mapped = mapUrl(original, kind);
      // Remove before a rel/as transition to avoid loading with the old kind.
      Reflect.apply(nativeRemoveAttribute, element, ["href"]);
    }
    if (name !== "href")
      Reflect.apply(
        remove ? nativeRemoveAttribute : nativeSetAttribute,
        element,
        remove ? [name] : [name, value],
      );
    if (mapped !== null)
      Reflect.apply(nativeSetAttribute, element, ["href", mapped]);
    if (original !== null)
      fontLinks.set(element, { original: original, mapped: mapped });
  }
  // relList mutations do not invoke the reflected rel setter. Validate a
  // proposed token-list mutation on a detached link, then route the href before
  // changing the live relationship. Keep token-list identity/native return
  // values and leave unrelated classList/token-list operations untouched.
  var linkPrototype = window.HTMLLinkElement?.prototype,
    relListDescriptor =
      linkPrototype &&
      Object.getOwnPropertyDescriptor(linkPrototype, "relList"),
    linkTokenOwners = new WeakMap();
  if (
    relListDescriptor?.get &&
    relListDescriptor.configurable &&
    window.DOMTokenList
  ) {
    var relListGetter = function () {
      var tokens = Reflect.apply(relListDescriptor.get, this, []);
      linkTokenOwners.set(tokens, this);
      return tokens;
    };
    Object.defineProperty(
      linkPrototype,
      "relList",
      Object.assign({}, relListDescriptor, {
        get: relListGetter,
        ...(relListDescriptor.set
          ? {
              set: function (value) {
                // Preserve native brand checking, but do not change the live rel first.
                Reflect.apply(relListDescriptor.get, this, []);
                setLinkAttribute(this, "rel", value);
              },
            }
          : {}),
      }),
    );
    restores.push(function () {
      if (
        Object.getOwnPropertyDescriptor(linkPrototype, "relList")?.get ===
        relListGetter
      )
        Object.defineProperty(linkPrototype, "relList", relListDescriptor);
    });
    ["add", "remove", "toggle", "replace"].forEach(function (name) {
      var native = DOMTokenList.prototype[name];
      if (typeof native !== "function") return;
      replace(DOMTokenList.prototype, name, function () {
        var owner = linkTokenOwners.get(this);
        if (!owner) return Reflect.apply(native, this, arguments);
        var proposed = document.createElement("link");
        Reflect.apply(nativeSetAttribute, proposed, [
          "rel",
          owner.getAttribute("rel") || "",
        ]);
        var tokens = Reflect.apply(relListDescriptor.get, proposed, []);
        var result = Reflect.apply(native, tokens, arguments);
        var nextRel = proposed.getAttribute("rel") || "";
        if (nextRel !== (owner.getAttribute("rel") || ""))
          setLinkAttribute(owner, "rel", nextRel);
        return result;
      });
    });
    var tokenValue = Object.getOwnPropertyDescriptor(
      DOMTokenList.prototype,
      "value",
    );
    if (tokenValue?.set && tokenValue.configurable) {
      var tokenValueSetter = function (value) {
        var owner = linkTokenOwners.get(this);
        if (owner) return setLinkAttribute(owner, "rel", value);
        return Reflect.apply(tokenValue.set, this, [value]);
      };
      Object.defineProperty(
        DOMTokenList.prototype,
        "value",
        Object.assign({}, tokenValue, { set: tokenValueSetter }),
      );
      restores.push(function () {
        if (
          Object.getOwnPropertyDescriptor(DOMTokenList.prototype, "value")
            ?.set === tokenValueSetter
        )
          Object.defineProperty(DOMTokenList.prototype, "value", tokenValue);
      });
    }
  }
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
    // Match each complete import before generic url() in one pass: a rewritten
    // stylesheet endpoint must never be routed again as a binary font.
    return value.replace(
      /(@import\s+)(?:url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s()"']+))\s*\)|"([^"\n]+)"|'([^'\n]+)')|url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s()"']+))\s*\)/gi,
      function (
        _,
        imported,
        importDouble,
        importSingle,
        importPlain,
        quotedDouble,
        quotedSingle,
        double,
        single,
        plain,
      ) {
        var reference = imported
          ? (importDouble ??
            importSingle ??
            importPlain ??
            quotedDouble ??
            quotedSingle)
          : (double ?? single ?? plain);
        // Modernizr's multiple-background/font-face tests use url(https://).
        // This is valid CSS syntax but an unresolvable, hostless network URL.
        // Leave only these exact inert probes to the native CSS parser; do not
        // exempt malformed real URLs, imports, or any network API from routing.
        if (!imported && /^(?:https?):\/\/$/i.test(reference)) {
          if (!active) throw blocked(kind, "document-closed");
          return _;
        }
        return (
          (imported || "") +
          'url("' +
          mapUrl(reference, imported ? "stylesheet" : kind, true).replace(
            /"/g,
            "%22",
          ) +
          '")'
        );
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
      if (this.tagName === "LINK" && ["href", "rel", "as"].includes(lower))
        return setLinkAttribute(this, lower, value);
      if (lower === "srcset" && /^(IMG|SOURCE)$/.test(this.tagName))
        value = srcset(value);
      else if (lower === "style") value = css(value);
      else value = resourceUrl(this, String(name), value);
      return Reflect.apply(nativeSetAttribute, this, [name, value]);
    },
  );
  replace(Element.prototype, "removeAttribute", function (name) {
    var lower = String(name).toLowerCase();
    if (this.tagName === "LINK" && ["href", "rel", "as"].includes(lower))
      return setLinkAttribute(this, lower, null, true);
    return Reflect.apply(nativeRemoveAttribute, this, [name]);
  });
  function externalScriptSource(value) {
    // SDKs read currentScript.src to recover public configuration and asset
    // bases. Reflect the upstream identity only for an authorized script
    // route; the underlying src attribute and browser request remain local.
    if (!active || !externalResourceEndpoint || !value) return value;
    try {
      var url = new NativeURL(value);
      if (
        url.origin === proxyOrigin &&
        url.pathname === "/__sortofremoteng_assets_v1/external-resource"
      ) {
        routeUrl(value, "script"); // Validate kind, origin and generation.
        return new NativeURL(url.searchParams.get("destination")).href;
      }
    } catch (_) {
      // Invalid URLs keep native reflection; this read never grants routing.
    }
    return value;
  }
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
    ["HTMLLinkElement", "rel"],
    ["HTMLLinkElement", "as"],
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
      if (entry[0] === "HTMLLinkElement")
        return setLinkAttribute(this, name, value);
      return Reflect.apply(descriptor.set, this, [
        resourceUrl(this, name, value),
      ]);
    };
    var getter = descriptor.get;
    if (entry[0] === "HTMLScriptElement" && getter)
      getter = function () {
        return externalScriptSource(Reflect.apply(descriptor.get, this, []));
      };
    Object.defineProperty(
      object,
      name,
      Object.assign({}, descriptor, { get: getter, set: setter }),
    );
    restores.push(function () {
      if (Object.getOwnPropertyDescriptor(object, name)?.set === setter)
        Object.defineProperty(object, name, descriptor);
    });
  });
  var preparedTargets = new WeakMap();
  function originalTarget(element, attribute) {
    var current = element.getAttribute(attribute),
      previous = preparedTargets.get(element);
    return previous &&
      previous.attribute === attribute &&
      current === previous.mapped
      ? previous.original
      : current;
  }
  function preparePopupTarget(
    element,
    attribute,
    target,
    submitting,
    activationEvent,
  ) {
    var previous = preparedTargets.get(element);
    if (
      submitting &&
      previous?.pending &&
      previous.attribute === attribute &&
      element.getAttribute(attribute) === previous.mapped
    )
      return;
    var originalAttribute = element.getAttribute(attribute);
    var mapped = popupClient.prepareTarget(target, {
      noopener: /(?:^|\s)(?:noopener|noreferrer)(?:\s|$)/i.test(
        element.getAttribute("rel") || "",
      ),
      activationEvent: activationEvent,
    });
    Reflect.apply(nativeSetAttribute, element, [attribute, mapped]);
    var preparation = {
      attribute: attribute,
      original: target,
      mapped: mapped,
      pending: !!submitting,
    };
    preparedTargets.set(element, preparation);
    if (submitting)
      window.setTimeout(function () {
        if (preparedTargets.get(element) !== preparation) return;
        preparation.pending = false;
        if (element.getAttribute(attribute) !== mapped) return;
        if (originalAttribute === null) element.removeAttribute(attribute);
        else
          Reflect.apply(nativeSetAttribute, element, [
            attribute,
            originalAttribute,
          ]);
        preparedTargets.delete(element);
      }, 0);
  }
  function prepareForm(form, submitter, activationEvent) {
    var overridden = submitter && submitter.hasAttribute("formaction"),
      element = overridden ? submitter : form,
      attr = overridden ? "formaction" : "action",
      url = element.getAttribute(attr) || location.href;
    Reflect.apply(nativeSetAttribute, element, [attr, mapUrl(url, "form")]);
    if (popupClient) {
      var overrideTarget = submitter && submitter.hasAttribute("formtarget"),
        targetElement = overrideTarget ? submitter : form,
        targetAttribute = overrideTarget ? "formtarget" : "target",
        target =
          originalTarget(targetElement, targetAttribute) ||
          document.querySelector("base[target]")?.getAttribute("target") ||
          "_self";
      if (target.toLowerCase() !== "_self") {
        var destination = new NativeURL(element.getAttribute(attr));
        if (
          destination.origin !== proxyOrigin ||
          destination.pathname.startsWith("/__sortofremoteng_")
        )
          throw blocked(
            "window",
            "popup-origin-not-approved",
            destination.origin,
          );
        preparePopupTarget(
          targetElement,
          targetAttribute,
          target,
          true,
          activationEvent,
        );
      }
    }
  }
  if (window.HTMLFormElement) {
    ["submit", "requestSubmit"].forEach(function (name) {
      var native = window.HTMLFormElement.prototype[name];
      if (typeof native !== "function") return;
      formInterception =
        replace(window.HTMLFormElement.prototype, name, function (submitter) {
          // requestSubmit runs constraint validation before emitting submit.
          // Let capture route connected valid forms exactly once; otherwise an
          // invalid cPanel form would open an empty popup with no submission.
          if (popupClient && name === "requestSubmit" && this.isConnected)
            return Reflect.apply(native, this, arguments);
          prepareForm(this, submitter);
          return Reflect.apply(native, this, arguments);
        }) && formInterception;
    });
  }
  function submit(event) {
    if (!(event.target instanceof HTMLFormElement)) return;
    try {
      prepareForm(event.target, event.submitter, event);
    } catch (_) {
      event.preventDefault();
    }
  }
  var preparedAnchors = new WeakMap(),
    deferredAnchors = new WeakMap();
  function prepareAnchor(anchor, event, allowApplicationHandler) {
    var target =
      originalTarget(anchor, "target") ||
      document.querySelector("base[target]")?.getAttribute("target") ||
      "_self";
    var sameContext =
      target.toLowerCase() === "_self" &&
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
    if (
      allowApplicationHandler &&
      sameContext &&
      event.type === "click" &&
      event.bubbles
    ) {
      var resolved = new NativeURL(original, document.baseURI || rootLocation);
      if (
        resolved.origin === proxyOrigin &&
        !resolved.pathname.startsWith("/__sortofremoteng_")
      ) {
        // Validate in capture, but don't turn /nginx/proxy into an absolute
        // capability URL before Backbone/Marionette reads its route. Only an
        // unhandled browser navigation needs a document proof. Native request
        // admission remains authoritative if the page stops propagation.
        if (previous && href === previous.mapped) {
          Reflect.apply(nativeSetAttribute, anchor, ["href", original]);
          preparedAnchors.delete(anchor);
        }
        deferredAnchors.set(event, anchor);
        return;
      }
    }
    Reflect.apply(nativeSetAttribute, anchor, ["href", mapped]);
    preparedAnchors.set(anchor, { original: original, mapped: mapped });
    if (
      popupClient &&
      !anchor.hasAttribute("download") &&
      event.type !== "contextmenu"
    ) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button === 1
      ) {
        // Modifiers force a native new window regardless of target. Handle the
        // activation in the contained session instead; don't invoke native open.
        event.preventDefault?.();
        popupClient.open(
          mapped,
          target.toLowerCase() === "_self" ? "_blank" : target,
        );
      } else if (target.toLowerCase() !== "_self") {
        // Validate the destination before creating a native form/link target.
        // open() and target preparation share the same exact-session scope.
        var popupUrl = new NativeURL(mapped);
        if (
          popupUrl.origin !== proxyOrigin ||
          popupUrl.pathname.startsWith("/__sortofremoteng_")
        )
          throw blocked("window", "popup-origin-not-approved", popupUrl.origin);
        preparePopupTarget(anchor, "target", target, false, event);
      }
    }
  }
  function click(event) {
    var anchor = event.target?.closest?.("a[href],area[href]");
    if (!anchor) return;
    try {
      prepareAnchor(anchor, event, true);
    } catch (_) {
      event.preventDefault();
    }
  }
  function finishClick(event) {
    var anchor = deferredAnchors.get(event);
    deferredAnchors.delete(event);
    if (!anchor || event.defaultPrevented || !anchor.hasAttribute("href"))
      return;
    try {
      // Re-read URL/target: application handlers may have changed either.
      prepareAnchor(anchor, event, false);
    } catch (_) {
      event.preventDefault();
    }
  }
  document.addEventListener("submit", submit, true);
  document.addEventListener("click", click, true);
  document.addEventListener("auxclick", click, true);
  document.addEventListener("contextmenu", click, true);
  window.addEventListener("click", finishClick);
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
    // Report-only policies did not block execution or a resource request.
    if (event.disposition !== "enforce") return;
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
      /^script-src(?:-elem|-attr)?$/.test(event.effectiveDirective)
        ? "script"
        : event.effectiveDirective === "font-src"
          ? "font"
          : "resource",
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
    if (popupClient) popupClient.closeAll();
    pendingReaders.forEach(function (reader) {
      reader.cancel().catch(function () {});
    });
    routes.clear();
    fontAssets.clear();
    externalFontOrigins.clear();
    externalFontEndpoint = null;
    externalResourceOrigins.clear();
    externalResourceEndpoint = null;
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
    if (popupClient) popupClient.dispose();
    document.removeEventListener("submit", submit, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("auxclick", click, true);
    document.removeEventListener("contextmenu", click, true);
    window.removeEventListener("click", finishClick);
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
      browserCompatibility: Object.freeze({
        hideWebdriverRequested: hideWebdriver,
        webdriverMasked: webdriverMasked,
      }),
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
      ...(tacticalRmmMesh
        ? { tacticalRmmMeshOrigin: tacticalRmmMesh.upstreamOrigin }
        : {}),
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
