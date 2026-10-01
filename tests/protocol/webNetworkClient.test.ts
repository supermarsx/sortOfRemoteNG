import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
// Execute the URL cleanup from the native readiness template, not a duplicate
// implementation. The routing token must remain in native configuration only.
const readinessSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/http_response.rs",
  "utf8",
);
function cleanDocumentUrl() {
  const prefix = readinessSource.match(
    /var u=new URL\(location.href\),q=[\s\S]*?(?=\r?\nfunction emit)/,
  )?.[0];
  if (!prefix) throw new Error("Native readiness URL cleanup is unavailable");
  window.eval(
    `(function(){${prefix
      .replace("{NAVIGATION_MARKER}", "__sorng_navigation_v1")
      .replace(/\{\{/g, "{")
      .replace(/\}\}/g, "}")}})()`,
  );
}
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const otherProxy = "http://p1123456789abcdef0123456789abcdef.localhost:43124";
const upstream = "https://device.example";
const config = () => ({
  version: 1,
  sessionId: "session-one",
  documentSequence: 3,
  requestGeneration: null as string | null,
  sourceOrigin: upstream,
  proxyOrigin: proxy,
  mappings: [] as Array<{ upstreamOrigin: string; proxyOrigin: string }>,
});
interface ClientConfiguration extends ReturnType<typeof config> {
  browserCompatibility?: { hideWebdriver: boolean };
  exchangeCookies?: boolean;
  ptispApi?: { version: number; apiOrigins: string[]; proxyUrl: string };
  cloudflareChallenge?: {
    version: number;
    upstreamOrigin: string;
    proxyOrigin: string;
  };
  tacticalRmmMesh?: {
    version: number;
    upstreamOrigin: string;
    proxyOrigin: string;
  };
  popupParentDocument?: number;
  fontAssets?: Array<{ upstreamUrl: string; proxyUrl: string }>;
  externalFonts?: null | {
    version: number;
    origins: string[];
    proxyEndpoint: string;
  };
  synologyQuickConnect?: {
    version: number;
    navigationOrigins: string[];
    redirectEndpoint: string;
    rpc?: { upstreamUrl: string; proxyUrl: string };
    discovered?: { version: number; alias: string; proxyUrl: string };
    directNavigation?: { version: number; alias: string };
    regionalNavigation?: { version: number; alias: string };
  };
  tacticalRmmApi?: {
    version: number;
    apiOrigins: string[];
    proxyUrl: string;
  };
  googleSession?: {
    version: number;
    nativeCookies: boolean;
    routes: Array<{
      upstreamOrigin: string;
      proxyOrigin: string;
      documents: boolean;
    }>;
  };
}
interface Controller {
  mapUrl(value: unknown, kind: string, local?: boolean): string;
  dispose(): void;
  capabilities: {
    version: number;
    browserCompatibility: {
      hideWebdriverRequested: boolean;
      webdriverMasked: boolean;
    };
    tacticalRmmApi: boolean;
    tacticalRmmApiOrigins: readonly string[];
    fetchInterception: boolean;
    xhrInterception: boolean;
    pageNetworkInterception: boolean;
    quickConnectNavigation: boolean;
    quickConnectDiscovery: boolean;
    quickConnectDiscovered: boolean;
    quickConnectDirectNavigation: boolean;
    quickConnectRegionalNavigation: boolean;
    googleSession?: {
      version: number;
      origins: readonly string[];
      nativeCookies: boolean;
      nativeUserAgent: boolean;
      documentCookieBridge: boolean;
    };
  };
}
let controller: Controller | undefined;
let install: (
  configuration: unknown,
  report: (value: unknown) => void,
) => Controller;
let report: ReturnType<typeof vi.fn<(value: unknown) => void>>;
let fetch: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let beacon: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let xhrOpen: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let xhrHeader: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let xhrSend: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let constructed: Array<{ kind: string; args: unknown[] }>;
const RealRequest = globalThis.Request;
const nativeLinkAs = Object.getOwnPropertyDescriptor(
  HTMLLinkElement.prototype,
  "as",
);

beforeEach(() => {
  // jsdom omits this browser IDL attribute. Supply its native reflection so the
  // property interceptor is tested as well as the real setAttribute path.
  if (!nativeLinkAs)
    Object.defineProperty(HTMLLinkElement.prototype, "as", {
      configurable: true,
      get() {
        return this.getAttribute("as") || "";
      },
      set(value) {
        this.setAttribute("as", String(value));
      },
    });
  vi.stubGlobal("location", new URL(`${proxy}/portal/page`));
  vi.spyOn(document, "baseURI", "get").mockReturnValue(`${proxy}/portal/page`);
  report = vi.fn();
  fetch = vi.fn().mockResolvedValue({ ok: true });
  beacon = vi.fn().mockReturnValue(true);
  xhrOpen = vi.fn();
  xhrHeader = vi.fn();
  xhrSend = vi.fn();
  constructed = [];
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Request", RealRequest);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = 200;
      responseText = "native-cookie=ready";
      open(...args: unknown[]) {
        xhrOpen(...args);
      }
      setRequestHeader(...args: unknown[]) {
        xhrHeader(...args);
      }
      send(...args: unknown[]) {
        xhrSend(...args);
      }
    },
  );
  vi.stubGlobal("navigator", {
    sendBeacon: beacon,
    serviceWorker: { register: vi.fn() },
  });
  for (const kind of [
    "WebSocket",
    "EventSource",
    "FontFace",
    "Worker",
    "SharedWorker",
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "WebTransport",
  ]) {
    vi.stubGlobal(
      kind,
      class {
        static OPEN = 1;
        constructor(...args: unknown[]) {
          constructed.push({ kind, args });
        }
      },
    );
  }
  install = window.eval(
    `(function(){${source}\nreturn installWebNetworkClient;})()`,
  );
});
afterEach(() => {
  controller?.dispose();
  if (!nativeLinkAs) Reflect.deleteProperty(HTMLLinkElement.prototype, "as");
  controller = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
function start(value: ClientConfiguration = config()) {
  return (controller = install(value, report));
}
function cancelBrowserDefaultAfterRouting() {
  // Run after the network client's window-bubble finalizer, not as a site
  // handler that intentionally consumes the link as an in-document SPA route.
  window.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
}

describe("opt-in browser indicator compatibility", () => {
  function driver(value: unknown, configurable = true) {
    Object.defineProperty(navigator, "webdriver", {
      configurable,
      enumerable: true,
      get: () => value,
    });
    return Object.getOwnPropertyDescriptor(navigator, "webdriver");
  }

  it("does not alter the automation indicator by default", () => {
    const original = driver(true);
    expect(start().capabilities.browserCompatibility).toEqual({
      hideWebdriverRequested: false,
      webdriverMasked: false,
    });
    expect(Object.getOwnPropertyDescriptor(navigator, "webdriver")).toEqual(
      original,
    );
  });

  it("masks only a true indicator, keeps proxy enforcement, and restores on disposal", () => {
    const original = driver(true);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    expect(navigator.webdriver).toBe(false);
    expect(client.capabilities.browserCompatibility).toEqual({
      hideWebdriverRequested: true,
      webdriverMasked: true,
    });
    expect(() =>
      client.mapUrl("https://unapproved.example/script.js", "resource"),
    ).toThrow(/origin-not-approved/);
    expect(client.mapUrl("/asset.js", "resource")).toBe(`${proxy}/asset.js`);
    client.dispose();
    expect(Object.getOwnPropertyDescriptor(navigator, "webdriver")).toEqual(
      original,
    );
    expect(navigator.webdriver).toBe(true);
  });

  it.each([false, undefined])("leaves native %s unchanged", (value) => {
    const original = driver(value);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    expect(client.capabilities.browserCompatibility.webdriverMasked).toBe(
      false,
    );
    expect(Object.getOwnPropertyDescriptor(navigator, "webdriver")).toEqual(
      original,
    );
  });

  it("does not fail routing when the native indicator is non-configurable", () => {
    driver(true, false);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    expect(navigator.webdriver).toBe(true);
    expect(client.capabilities.browserCompatibility.webdriverMasked).toBe(
      false,
    );
    expect(client.mapUrl("/asset.js", "resource")).toBe(`${proxy}/asset.js`);
  });

  it("does not overwrite a later site-owned descriptor during cleanup", () => {
    driver(true);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    const replacement = driver("site-owned");
    client.dispose();
    expect(Object.getOwnPropertyDescriptor(navigator, "webdriver")).toEqual(
      replacement,
    );
  });

  it("continues cleanup if the site freezes the installed descriptor", () => {
    driver(true);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    Object.defineProperty(navigator, "webdriver", { configurable: false });
    expect(() => client.dispose()).not.toThrow();
    expect(window.fetch).toBe(fetch);
  });

  it("restores an inherited indicator without leaving an own property", () => {
    const prototype = Object.create(Object.getPrototypeOf(navigator));
    Object.defineProperty(prototype, "webdriver", { get: () => true });
    Object.setPrototypeOf(navigator, prototype);
    const client = start({
      ...config(),
      browserCompatibility: { hideWebdriver: true },
    });
    expect(navigator.webdriver).toBe(false);
    client.dispose();
    expect(Object.prototype.hasOwnProperty.call(navigator, "webdriver")).toBe(
      false,
    );
    expect(navigator.webdriver).toBe(true);
  });

  it.each([
    null,
    true,
    {},
    { hideWebdriver: "true" },
    { hideWebdriver: true, unrestricted: true },
  ])("rejects invalid configuration before changing identity: %j", (value) => {
    driver(true);
    expect(() =>
      install({ ...config(), browserCompatibility: value }, report),
    ).toThrow(/browser compatibility/);
    expect(navigator.webdriver).toBe(true);
  });

  it("validates routes before changing identity", () => {
    driver(true);
    expect(() =>
      start({
        ...config(),
        browserCompatibility: { hideWebdriver: true },
        mappings: [{ upstreamOrigin: upstream, proxyOrigin: proxy }],
      }),
    ).toThrow(/Duplicate/);
    expect(navigator.webdriver).toBe(true);
  });
});

describe("proxy routing compatibility client (not native egress proof)", () => {
  const controlUrl = "https://global.quickconnect.to/Serv.php";
  const controlProxy = proxy + "/__sortofremoteng_quickconnect_control_v1";
  const redirectProxy = proxy + "/__sortofremoteng_quickconnect_redirect_v1";
  const quickConfig = () => ({
    ...config(),
    synologyQuickConnect: {
      version: 1,
      navigationOrigins: [
        "http://example-nas.quickconnect.to",
        "https://example-nas.quickconnect.to",
        "https://global.quickconnect.to",
        "https://www.quickconnect.to",
      ],
      redirectEndpoint: redirectProxy,
      rpc: { upstreamUrl: controlUrl, proxyUrl: controlProxy },
    },
  });
  const discoveredProxy =
    proxy + "/__sortofremoteng_quickconnect_discovered_v1";
  const discoveryConfig = () => {
    const base = quickConfig();
    return {
      ...base,
      synologyQuickConnect: {
        ...base.synologyQuickConnect,
        discovered: {
          version: 1,
          alias: "example-nas",
          proxyUrl: discoveredProxy,
        },
        directNavigation: { version: 1, alias: "example-nas" },
        regionalNavigation: { version: 1, alias: "example-nas" },
      },
    };
  };
  const tacticalApiProxy = proxy + "/__sortofremoteng_tactical_rmm_api_v1";
  const ptispConfig = (): ClientConfiguration => ({
    ...config(),
    sourceOrigin: "https://my.ptisp.pt",
    requestGeneration: "0123456789abcdef0123456789abcdef",
    ptispApi: {
      version: 2,
      apiOrigins: ["https://api3.ptisp.pt"],
      proxyUrl: proxy + "/__sortofremoteng_ptisp_api_v1",
    },
  });
  it("routes PTisp login and page-owned Basic authorization through only its API alias", async () => {
    start(ptispConfig());
    const destination =
      "https://api3.ptisp.pt/user/security/fixture%40example.test/login?raw=%2F+";
    const expected = new URL(ptispConfig().ptispApi!.proxyUrl);
    expected.searchParams.set("destination", destination);
    expected.searchParams.set("__sorng_ptisp_document_v1", "3");
    expected.searchParams.set(
      "__sorng_generation_v1",
      ptispConfig().requestGeneration!,
    );
    const body = JSON.stringify({
      password: "fixture-password",
      authcode: "",
      remmemberme: false,
    });
    await window.fetch(destination, { method: "POST", body });
    expect(fetch).toHaveBeenCalledWith(expected.href, { method: "POST", body });
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api3.ptisp.pt/user/info");
    xhr.setRequestHeader("Authorization", "Basic Zml4dHVyZTpoYXNo");
    xhr.send();
    expect(
      new URL(xhrOpen.mock.calls[0][1] as string).searchParams.get(
        "destination",
      ),
    ).toBe("https://api3.ptisp.pt/user/info");
    expect(xhrHeader).toHaveBeenCalledWith(
      "Authorization",
      "Basic Zml4dHVyZTpoYXNo",
    );
    expect(controller!.capabilities.tacticalRmmApi).toBe(false);
    expect(controller!.capabilities.tacticalRmmApiOrigins).toEqual([]);
  });
  it("denies PTisp API grant on generic profiles and denies other transports/origins without leaking login paths", () => {
    start();
    expect(() =>
      controller!.mapUrl("https://api3.ptisp.pt/user/info", "fetch"),
    ).toThrow("origin-not-approved");
    controller!.dispose();
    start(ptispConfig());
    for (const destination of [
      "http://api3.ptisp.pt/user/info",
      "https://api3.ptisp.pt:8443/user/info",
      "https://api3.ptisp.pt.evil.test/user/info",
      "https://api.ptisp.pt/user/info",
      "https://api3.ptisp.pt./user/info",
      "https://api4.ptisp.pt/user/info",
    ])
      expect(() => controller!.mapUrl(destination, "xhr")).toThrow(
        "origin-not-approved",
      );
    for (const kind of [
      "navigation",
      "resource",
      "form",
      "websocket",
      "eventsource",
      "beacon",
    ])
      expect(() =>
        controller!.mapUrl(
          "https://api3.ptisp.pt/user/security/secret-email/login?token=secret-query",
          kind,
        ),
      ).toThrow("origin-not-approved");
    expect(() =>
      controller!.mapUrl(
        "https://user:secret@api3.ptisp.pt/user/info",
        "fetch",
      ),
    ).toThrow("url-credentials");
    expect(() =>
      controller!.mapUrl("https://api3.ptisp.pt/user/info#secret", "fetch"),
    ).toThrow("invalid-url");
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /secret-email|secret-query|user:secret/,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    controller!.dispose();
    expect(() =>
      controller!.mapUrl("https://api3.ptisp.pt/user/info", "fetch"),
    ).toThrow("document-closed");
  });
  it("rejects forged PTisp manifests and Tactical co-grants", () => {
    for (const sourceOrigin of [
      "https://other.ptisp.pt",
      "http://my.ptisp.pt",
      "https://my.ptisp.pt:8443",
      "https://my.ptisp.pt.evil.test",
    ])
      expect(() => start({ ...ptispConfig(), sourceOrigin })).toThrow(
        "Invalid PTisp API route configuration",
      );
    for (const apiOrigins of [
      [],
      ["https://api4.ptisp.pt"],
      ["https://api3.ptisp.pt", "https://evil.test"],
      ["https://api3.ptisp.pt/"],
    ])
      expect(() =>
        start({
          ...ptispConfig(),
          ptispApi: { ...ptispConfig().ptispApi!, apiOrigins },
        }),
      ).toThrow("Invalid PTisp API route configuration");
    expect(() =>
      start({
        ...ptispConfig(),
        tacticalRmmApi: {
          version: 2,
          apiOrigins: ["https://api3.ptisp.pt"],
          proxyUrl: tacticalApiProxy,
        },
      }),
    ).toThrow("Invalid PTisp API route configuration");
    expect(() =>
      start({
        ...ptispConfig(),
        ptispApi: { ...ptispConfig().ptispApi!, proxyUrl: tacticalApiProxy },
      }),
    ).toThrow("Invalid PTisp API route configuration");
  });
  const tacticalConfig = (): ClientConfiguration => ({
    ...config(),
    tacticalRmmApi: {
      version: 2,
      apiOrigins: ["https://api.device.example", "https://api.example"],
      proxyUrl: tacticalApiProxy,
    },
  });
  const meshOrigin = "https://mesh.example:8443";
  const challengeProxy =
    "http://p33333333333333333333333333333333.localhost:43123";
  const cloudflareConfig = (): ClientConfiguration => ({
    ...config(),
    sourceOrigin: "https://dash.cloudflare.com",
    cloudflareChallenge: {
      version: 1,
      upstreamOrigin: "https://challenges.cloudflare.com",
      proxyOrigin: challengeProxy,
    },
  });
  it.each(["https://dash.cloudflare.com", "https://porkbun.com"])(
    "installs the native challenge route for %s and proxies scripts, frames, fetch and XHR",
    async (sourceOrigin) => {
      start({ ...cloudflareConfig(), sourceOrigin });
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      expect(script.getAttribute("src")).toBe(
        `${challengeProxy}/turnstile/v0/api.js?render=explicit`,
      );
      expect(script.src).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      );
      const frame = document.createElement("iframe");
      frame.src =
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/widget";
      expect(frame.src).toBe(
        `${challengeProxy}/cdn-cgi/challenge-platform/widget`,
      );
      expect(
        controller!.mapUrl(
          "https://challenges.cloudflare.com/check?q=a%2Fb",
          "fetch",
        ),
      ).toBe(`${challengeProxy}/check?q=a%2Fb`);
      await window.fetch("https://challenges.cloudflare.com/check?q=a%2Fb");
      expect(fetch).toHaveBeenCalledWith(
        `${challengeProxy}/check?q=a%2Fb`,
        undefined,
      );
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://challenges.cloudflare.com/turnstile/response");
      xhr.send("fixture");
      expect(xhrOpen).toHaveBeenCalledWith(
        "POST",
        `${challengeProxy}/turnstile/response`,
      );
      await window.fetch(`${sourceOrigin}/login`);
      expect(fetch).toHaveBeenLastCalledWith(`${proxy}/login`, undefined);
      for (const denied of [
        "http://challenges.cloudflare.com/",
        "https://challenges.cloudflare.com:8443/",
        "https://challenges.cloudflare.com.evil.test/",
        "https://api.cloudflare.com/",
        "https://challenges.fed.cloudflare.com/",
        "https://challenges.cloudflare-cn.com/",
        "https://js.stripe.com/v3/",
        "https://fonts.googleapis.com/css2?family=Roboto",
      ])
        expect(() => controller!.mapUrl(denied, "fetch")).toThrow(
          "origin-not-approved",
        );
    },
  );
  it.each(["https://dash.cloudflare.com", "https://porkbun.com"])(
    "never invents challenge routing from %s alone",
    (sourceOrigin) => {
      start({ ...config(), sourceOrigin });
      expect(() =>
        controller!.mapUrl(
          "https://challenges.cloudflare.com/turnstile/v0/api.js",
          "resource",
        ),
      ).toThrow("origin-not-approved");
    },
  );
  it.each([
    { version: 2 },
    { upstreamOrigin: "https://api.cloudflare.com" },
    { upstreamOrigin: "https://challenges.cloudflare.com:8443" },
    { proxyOrigin: proxy },
    { proxyOrigin: "http://p33333333333333333333333333333333.localhost:43124" },
    { proxyOrigin: "https://challenges.cloudflare.com" },
  ])("rejects an unsafe Cloudflare manifest %j", (extra) => {
    const settings = cloudflareConfig();
    settings.cloudflareChallenge = {
      ...settings.cloudflareChallenge!,
      ...extra,
    };
    expect(() => start(settings)).toThrow();
  });
  it.each([
    upstream,
    "http://porkbun.com",
    "https://porkbun.com:444",
    "https://www.porkbun.com",
    "https://api.porkbun.com",
    "https://porkbun.com.attacker.test",
    "https://challenges.cloudflare.com",
    "https://dash.cloudflare.com.attacker.test",
  ])(
    "rejects granting Cloudflare routes to unreviewed source %s",
    (sourceOrigin) => {
      expect(() => start({ ...cloudflareConfig(), sourceOrigin })).toThrow(
        "Cloudflare",
      );
    },
  );
  it.each(["parser", "property", "attribute"])(
    "preserves Turnstile %s script discovery while the native src stays proxied",
    async (insertion) => {
      const nativeSrc = Object.getOwnPropertyDescriptor(
        HTMLScriptElement.prototype,
        "src",
      )!;
      const path =
        "/turnstile/v0/g/fixture/api.js?render=explicit&onload=ready&opaque=a%2Fb+space";
      const canonical = `https://challenges.cloudflare.com${path}`;
      const local = `${challengeProxy}${path}`;
      start(cloudflareConfig());
      let script: HTMLScriptElement;
      if (insertion === "parser") {
        document.body.innerHTML = `<script src="${local}"></script>`;
        script = document.querySelector("script")!;
      } else {
        script = document.createElement("script");
        if (insertion === "property") script.src = canonical;
        else script.setAttribute("src", canonical);
        document.body.appendChild(script);
      }
      script.async = true;
      // Turnstile first checks currentScript.src, then scans script elements
      // with the same HTTPS host/path matcher (api.js inspected 2026-10-01).
      const apiSource =
        /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0(?:\/.*)?\/api\.js/u;
      vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
      expect(
        apiSource.test((document.currentScript as HTMLScriptElement).src),
      ).toBe(true);
      expect(
        [...document.querySelectorAll("script")].find((candidate) =>
          apiSource.test(candidate.src),
        ),
      ).toBe(script);
      expect(script.src).toBe(canonical);
      expect(new URL(script.src).searchParams.get("onload")).toBe("ready");
      expect(script.async).toBe(true);
      expect(script.getAttribute("src")).toBe(local);
      expect(nativeSrc.get!.call(script)).toBe(local);
      const clone = script.cloneNode(true) as HTMLScriptElement;
      expect(clone.src).toBe(canonical);
      expect(clone.getAttribute("src")).toBe(local);
      clone.src = script.src;
      expect(nativeSrc.get!.call(clone)).toBe(local);
      await window.fetch(script.src);
      expect(fetch).toHaveBeenCalledWith(local, undefined);
      controller!.dispose();
      expect(script.src).toBe(local);
      expect(
        Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src"),
      ).toEqual(nativeSrc);
    },
  );
  it.each(["challenge-frame", "hosted-session"])(
    "uses the existing %s route for Turnstile discovery and keeps its source isolated",
    async (context) => {
      const sourceOrigin =
        context === "challenge-frame"
          ? "https://challenges.cloudflare.com"
          : "https://claude.ai";
      const alias = context === "challenge-frame" ? proxy : challengeProxy;
      start({
        ...config(),
        sourceOrigin,
        ...(context === "hosted-session"
          ? {
              googleSession: {
                version: 1,
                nativeCookies: true,
                routes: [
                  {
                    upstreamOrigin: sourceOrigin,
                    proxyOrigin: proxy,
                    documents: true,
                  },
                  {
                    upstreamOrigin: "https://challenges.cloudflare.com",
                    proxyOrigin: alias,
                    documents: false,
                  },
                ],
              },
            }
          : {}),
      });
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      expect(script.src).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      );
      expect(script.getAttribute("src")).toBe(
        `${alias}/turnstile/v0/api.js?render=explicit`,
      );
      await window.fetch(script.src);
      expect(fetch.mock.calls[0][0]).toBe(
        `${alias}/turnstile/v0/api.js?render=explicit`,
      );
      expect(() =>
        controller!.mapUrl("https://porkbun.com/login", "fetch"),
      ).toThrow("origin-not-approved");
    },
  );
  it("projects only the exact granted Turnstile API script, never another resource or alias", () => {
    start(cloudflareConfig());
    for (const url of [
      `${challengeProxy}/turnstile/v0/api.js.map`,
      `${challengeProxy}/turnstile/v1/api.js`,
      `${challengeProxy}/cdn-cgi/challenge-platform/script.js`,
      `${proxy}/turnstile/v0/api.js`,
      `${otherProxy}/turnstile/v0/api.js`,
    ]) {
      document.body.innerHTML = `<script src="${url}"></script>`;
      expect(document.querySelector("script")!.src).toBe(url);
    }
    const image = document.createElement("img");
    image.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    expect(image.src).toBe(`${challengeProxy}/turnstile/v0/api.js`);
    controller!.dispose();
    start();
    document.body.innerHTML = `<script src="${challengeProxy}/turnstile/v0/api.js"></script>`;
    expect(document.querySelector("script")!.src).toBe(
      `${challengeProxy}/turnstile/v0/api.js`,
    );
  });
  const meshProxy = "http://p22222222222222222222222222222222.localhost:43123";
  const meshConfig = (): ClientConfiguration => ({
    ...tacticalConfig(),
    tacticalRmmMesh: {
      version: 1,
      upstreamOrigin: meshOrigin,
      proxyOrigin: meshProxy,
    },
  });
  it.each(["property", "attribute"])(
    "keeps Tactical's empty %s iframe blank while its Mesh URL is loading",
    (setter) => {
      vi.stubGlobal("location", new URL(`${proxy}/takecontrol/agent-one`));
      vi.spyOn(document, "baseURI", "get").mockReturnValue(
        `${proxy}/takecontrol/agent-one`,
      );
      start({ ...meshConfig(), popupParentDocument: 3 });
      const frame = document.createElement("iframe");
      const assign = (value: string) => {
        if (setter === "property") frame.src = value;
        else frame.setAttribute("src", value);
      };
      // Vue's initial control ref is empty. Mapping it to the current URL
      // recursively loads another Take Control/status bar inside the first.
      for (const blank of ["", " \t\r\n", "about:blank"]) {
        assign(blank);
        expect(frame.getAttribute("src")).toBe("about:blank");
      }
      assign(`${meshOrigin}/?auth=synthetic%2Ftoken&viewmode=11`);
      expect(frame.src).toBe(
        `${meshProxy}/?auth=synthetic%2Ftoken&viewmode=11`,
      );
      // Restart/Recover resets control to empty before requesting a new URL.
      assign("");
      expect(frame.src).toBe("about:blank");
      expect(report).not.toHaveBeenCalled();
      frame.remove();
    },
  );
  it("maps the configured MeshCentral iframe, assets and websocket onto its isolated exact alias", () => {
    start(meshConfig());
    const frame = document.createElement("iframe");
    frame.src = `${meshOrigin}/?auth=synthetic%2Ftoken&viewmode=11`;
    expect(frame.src).toBe(`${meshProxy}/?auth=synthetic%2Ftoken&viewmode=11`);
    expect(
      controller!.mapUrl(`${meshOrigin}/styles/style.css`, "resource"),
    ).toBe(`${meshProxy}/styles/style.css`);
    new WebSocket(
      "wss://mesh.example:8443/meshrelay.ashx?auth=synthetic%20token",
    );
    expect(constructed[constructed.length - 1]?.args[0]).toBe(
      `${meshProxy.replace("http:", "ws:")}/meshrelay.ashx?auth=synthetic%20token&__sorng_ws_document_v1=3`,
    );
    expect(() =>
      controller!.mapUrl("https://unconfigured.example/", "resource"),
    ).toThrow("origin-not-approved");
    expect(() =>
      controller!.mapUrl("https://mesh.example/", "resource"),
    ).toThrow("origin-not-approved");
    expect(() =>
      controller!.mapUrl("http://mesh.example:8443/", "resource"),
    ).toThrow("origin-not-approved");
  });
  it("does not invent a MeshCentral route when no native capability was supplied", () => {
    start(tacticalConfig());
    expect(() =>
      controller!.mapUrl(`${meshOrigin}/?auth=synthetic`, "resource"),
    ).toThrow("origin-not-approved");
  });
  it.each([
    { version: 2 },
    { upstreamOrigin: "http://mesh.example" },
    { upstreamOrigin: "https://mesh.example/path" },
    { upstreamOrigin: "https://user:password@mesh.example" },
    { proxyOrigin: "https://mesh.example" },
    { proxyOrigin: "http://p22222222222222222222222222222222.localhost:43124" },
    { proxyOrigin: proxy },
  ])("refuses malformed or non-isolated MeshCentral manifests %j", (extra) => {
    const settings = meshConfig();
    settings.tacticalRmmMesh = { ...settings.tacticalRmmMesh!, ...extra };
    expect(() => start(settings)).toThrow();
  });
  it("keeps a MeshCentral child under its pinned root sequence without routing dashboard API requests", () => {
    vi.stubGlobal("location", new URL(`${meshProxy}/?auth=synthetic`));
    vi.spyOn(document, "baseURI", "get").mockReturnValue(
      `${meshProxy}/?auth=synthetic`,
    );
    start({
      ...config(),
      sourceOrigin: meshOrigin,
      proxyOrigin: meshProxy,
      popupParentDocument: 3,
      tacticalRmmMesh: {
        version: 1,
        upstreamOrigin: meshOrigin,
        proxyOrigin: meshProxy,
      },
    });
    const socket = controller!.mapUrl(
      "wss://mesh.example:8443/meshrelay.ashx?auth=synthetic",
      "websocket",
    );
    expect(new URL(socket).searchParams.get("__sorng_ws_document_v1")).toBe(
      "3",
    );
    expect(() =>
      controller!.mapUrl("https://api.device.example/core/dashinfo/", "fetch"),
    ).toThrow("origin-not-approved");
    expect(controller!.mapUrl(`${meshOrigin}/image.png`, "resource")).toBe(
      `${meshProxy}/image.png`,
    );
  });
  const googleConfig = (): ClientConfiguration => ({
    ...config(),
    sourceOrigin: "https://analytics.google.com",
    googleSession: {
      version: 1,
      nativeCookies: true,
      routes: [
        {
          upstreamOrigin: "https://analytics.google.com",
          proxyOrigin: proxy,
          documents: true,
        },
        {
          upstreamOrigin: "https://accounts.google.com",
          proxyOrigin:
            "http://p11111111111111111111111111111111.localhost:43123",
          documents: true,
        },
        {
          upstreamOrigin: "https://www.gstatic.com",
          proxyOrigin:
            "http://p22222222222222222222222222222222.localhost:43123",
          documents: false,
        },
      ],
    },
  });
  it.each([
    ["https://www.canva.com", "https://static.canva.com"],
    ["https://www.instagram.com", "https://static.cdninstagram.com"],
  ])(
    "routes the two-origin hosted catalog for %s without granting CDN navigation or foreign login",
    async (sourceOrigin, assetOrigin) => {
      const assetProxy =
        "http://p22222222222222222222222222222222.localhost:43123";
      start({
        ...config(),
        sourceOrigin,
        googleSession: {
          version: 1,
          nativeCookies: true,
          routes: [
            {
              upstreamOrigin: sourceOrigin,
              proxyOrigin: proxy,
              documents: true,
            },
            {
              upstreamOrigin: assetOrigin,
              proxyOrigin: assetProxy,
              documents: false,
            },
          ],
        },
      });
      expect(controller!.capabilities.googleSession).toMatchObject({
        nativeCookies: true,
        documentCookieBridge: true,
        origins: [sourceOrigin, assetOrigin],
      });
      expect(controller!.mapUrl(`${assetOrigin}/login.js`, "resource")).toBe(
        `${assetProxy}/login.js`,
      );
      for (const origin of [
        assetOrigin,
        "https://accounts.google.com",
        "https://www.facebook.com",
      ]) {
        expect(() =>
          controller!.mapUrl(`${origin}/login`, "navigation"),
        ).toThrow("origin-not-approved");
      }
      await window.fetch(`${sourceOrigin}/api/session`, {
        credentials: "include",
      });
      const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${proxy}/api/session`);
      expect(
        new Headers(options.headers).get("X-Sorng-Google-Credentials"),
      ).toBe("include");
    },
  );
  it("carries the native-issued document generation onto same-proxy navigation", () => {
    const generation = "0123456789abcdef0123456789abcdef";
    start({ ...config(), requestGeneration: generation });

    expect(
      controller!.mapUrl(
        "/cpsess1234567890/frontend/jupiter/index.html?login=1",
        "navigation",
      ),
    ).toBe(
      `${proxy}/cpsess1234567890/frontend/jupiter/index.html?login=1&__sorng_generation_v1=${generation}`,
    );
  });
  it.each(["property", "attribute"] as const)(
    "does not stamp request proofs onto inert anchor %s parsing",
    (assignment) => {
      start({
        ...config(),
        requestGeneration: "0123456789abcdef0123456789abcdef",
      });
      const anchor = document.createElement("a");
      const destination = `${proxy}/portal/page?return=%2Fhome+page#!/auth`;
      if (assignment === "property") anchor.href = destination;
      else anchor.setAttribute("href", destination);
      expect(anchor.href).toBe(destination);
      expect(anchor.search).toBe("?return=%2Fhome+page");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["", "?__sorng_navigation_v1=fixture-navigation"])(
    "keeps same-document hash navigation local with existing query %s",
    (query) => {
      const current = `${proxy}/portal/page${query}#!/auth`;
      vi.stubGlobal("location", new URL(current));
      vi.spyOn(document, "baseURI", "get").mockReturnValue(current);
      start({
        ...config(),
        requestGeneration: "0123456789abcdef0123456789abcdef",
      });
      const anchor = document.createElement("a");
      anchor.href = "#!/home";
      document.body.append(anchor);
      anchor.addEventListener("click", (event) => event.preventDefault());
      anchor.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      expect(anchor.href).toBe(`${proxy}/portal/page${query}#!/home`);
      expect(controller!.mapUrl(current.split("#")[0], "navigation")).toContain(
        "__sorng_generation_v1=0123456789abcdef0123456789abcdef",
      );
      expect(controller!.mapUrl("#!/home", "fetch")).toContain(
        "__sorng_generation_v1=0123456789abcdef0123456789abcdef",
      );
    },
  );
  it("still stamps a real link navigation at click time", () => {
    start({
      ...config(),
      requestGeneration: "0123456789abcdef0123456789abcdef",
    });
    const anchor = document.createElement("a");
    anchor.href = "/other-page?return=%2Fhome+page";
    expect(anchor.search).toBe("?return=%2Fhome+page");
    document.body.append(anchor);
    cancelBrowserDefaultAfterRouting();
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(anchor.href).toBe(
      `${proxy}/other-page?return=%2Fhome+page&__sorng_generation_v1=0123456789abcdef0123456789abcdef`,
    );
  });
  it("stamps a different query even when the path and fragment stay local", () => {
    start({
      ...config(),
      requestGeneration: "0123456789abcdef0123456789abcdef",
    });
    const anchor = document.createElement("a");
    anchor.href = "/portal/page?changed=1#!/home";
    document.body.append(anchor);
    cancelBrowserDefaultAfterRouting();
    anchor.click();
    expect(anchor.search).toBe(
      "?changed=1&__sorng_generation_v1=0123456789abcdef0123456789abcdef",
    );
  });
  it.each(["a", "area"])(
    "routes a detached %s script click without relying on referrers",
    (tag) => {
      start({
        ...config(),
        requestGeneration: "0123456789abcdef0123456789abcdef",
      });
      const anchor = document.createElement(tag) as HTMLAnchorElement;
      anchor.href = "/other-page";
      anchor.setAttribute("referrerpolicy", "no-referrer");
      anchor.addEventListener("click", (event) => event.preventDefault());
      anchor.click();
      expect(anchor.search).toBe(
        "?__sorng_generation_v1=0123456789abcdef0123456789abcdef",
      );
    },
  );
  it.each(["contextmenu", "auxclick"])(
    "prepares %s but preserves the next ordinary hash click",
    (type) => {
      start({
        ...config(),
        requestGeneration: "0123456789abcdef0123456789abcdef",
      });
      const anchor = document.createElement("a");
      anchor.href = "#!/home";
      document.body.append(anchor);
      anchor.addEventListener(type, (event) => event.preventDefault());
      anchor.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 }),
      );
      expect(anchor.search).toBe(
        "?__sorng_generation_v1=0123456789abcdef0123456789abcdef",
      );
      cancelBrowserDefaultAfterRouting();
      anchor.click();
      expect(anchor.href).toBe(`${proxy}/portal/page#!/home`);
      anchor.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 }),
      );
      anchor.href = "/changed-by-app#!/home";
      cancelBrowserDefaultAfterRouting();
      anchor.click();
      expect(anchor.pathname).toBe("/changed-by-app");
      expect(anchor.search).toBe(
        "?__sorng_generation_v1=0123456789abcdef0123456789abcdef",
      );
    },
  );
  it.each(["_blank", "_parent", "modifier", "download", "base-target"])(
    "keeps the generation proof for fragment links opening another context: %s",
    (mode) => {
      start({
        ...config(),
        requestGeneration: "0123456789abcdef0123456789abcdef",
      });
      const anchor = document.createElement("a");
      if (mode === "base-target") {
        const base = document.createElement("base");
        base.target = "_blank";
        document.body.append(base);
      } else if (mode === "download") anchor.setAttribute("download", "file");
      else if (mode !== "modifier") anchor.target = mode;
      anchor.href = "#!/home";
      document.body.append(anchor);
      anchor.addEventListener("click", (event) => event.preventDefault());
      anchor.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: mode === "modifier",
        }),
      );
      expect(
        new URL(anchor.href).searchParams.get("__sorng_generation_v1"),
      ).toBe("0123456789abcdef0123456789abcdef");
    },
  );
  describe("Exchange native request credential signalling", () => {
    const header = "X-Sorng-Exchange-Credentials";

    it.each([undefined, "same-origin", "include", "omit"] as const)(
      "preserves fetch credential mode %s and signals the native jar",
      async (credentials) => {
        start({ ...config(), exchangeCookies: true });
        await window.fetch(`${upstream}/owa/auth.owa`, {
          method: "POST",
          body: "fixture=value",
          credentials,
          headers: { [header]: "include", "Content-Type": "text/plain" },
        });
        const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${proxy}/owa/auth.owa`);
        expect(options.credentials).toBe(credentials);
        expect(options.body).toBe("fixture=value");
        expect(new Headers(options.headers).get(header)).toBe(
          credentials === "omit" ? "omit" : "include",
        );
        expect(
          new Headers(options.headers).has("X-Sorng-Google-Credentials"),
        ).toBe(false);
        expect(xhrSend).not.toHaveBeenCalled();
      },
    );

    it.each([upstream, proxy])(
      "preserves Request bodies and effective init credentials for %s",
      async (origin) => {
        start({ ...config(), exchangeCookies: true });
        const input = new Request(`${origin}/owa/auth.owa`, {
          method: "POST",
          body: "fixture=value",
          credentials: "include",
          headers: { "X-Fixture": "retained" },
        });
        await window.fetch(input, { credentials: "omit" });
        const [request, options] = fetch.mock.calls[0] as [
          Request,
          RequestInit | undefined,
        ];
        expect(request.url).toBe(`${proxy}/owa/auth.owa`);
        expect(request.credentials).toBe("omit");
        expect(await request.text()).toBe("fixture=value");
        const headers = new Headers(options?.headers ?? request.headers);
        expect(headers.get(header)).toBe("omit");
        expect(headers.get("X-Fixture")).toBe("retained");
      },
    );

    it.each([false, true])(
      "includes same-origin XHR cookies with withCredentials=%s",
      (withCredentials) => {
        start({ ...config(), exchangeCookies: true });
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${upstream}/owa/auth.owa`, false);
        xhr.withCredentials = withCredentials;
        xhr.send("fixture=value");
        expect(xhrOpen).toHaveBeenLastCalledWith(
          "POST",
          `${proxy}/owa/auth.owa`,
          false,
        );
        expect(xhrHeader).toHaveBeenLastCalledWith(header, "include");
        expect(xhrSend).toHaveBeenLastCalledWith("fixture=value");
      },
    );

    it.each([undefined, false])(
      "does not activate request signalling when flag=%s",
      async (exchangeCookies) => {
        start({ ...config(), exchangeCookies });
        await window.fetch("/ecp/");
        expect(
          (fetch.mock.calls[0][1] as RequestInit | undefined)?.headers,
        ).toBeUndefined();
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/ecp/");
        xhr.send();
        expect(xhrHeader).not.toHaveBeenCalled();
      },
    );

    it("does not signal other approved proxies, including a reused XHR", async () => {
      start({
        ...config(),
        exchangeCookies: true,
        mappings: [
          { upstreamOrigin: "https://other.example", proxyOrigin: otherProxy },
        ],
      });
      await window.fetch("https://other.example/api", {
        credentials: "include",
      });
      expect((fetch.mock.calls[0][1] as RequestInit).headers).toBeUndefined();
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/ecp/");
      xhr.send();
      expect(xhrHeader).toHaveBeenLastCalledWith(header, "include");
      xhrHeader.mockClear();
      xhr.open("GET", "https://other.example/api");
      xhr.withCredentials = true;
      xhr.send();
      expect(xhrHeader).not.toHaveBeenCalled();
      await expect(
        window.fetch("https://unapproved.example/api"),
      ).rejects.toThrow("origin-not-approved");
    });
  });

  describe("explicit native Exchange cookie bridge", () => {
    function rejectingBrowserCookies() {
      vi.spyOn(document, "cookie", "get").mockReturnValue("");
      const rejected = vi
        .spyOn(document, "cookie", "set")
        .mockImplementation(() => {});
      Object.defineProperty(navigator, "cookieEnabled", {
        configurable: true,
        value: false,
      });
      return rejected;
    }
    function nativeJar() {
      const calls: Array<{
        method: string;
        url: string;
        async: boolean;
        path: string;
        body: unknown;
      }> = [];
      const jar = new Map<string, string>();
      const failure = { mode: "" };
      vi.stubGlobal(
        "XMLHttpRequest",
        class {
          method = "";
          url = "";
          async = true;
          path = "";
          status = 200;
          responseText = "";
          open(method: string, url: string, async: boolean) {
            this.method = method;
            this.url = url;
            this.async = async;
          }
          setRequestHeader(name: string, value: string) {
            expect(name).toBe("X-Sorng-Exchange-Cookie-Path");
            this.path = value;
          }
          send(body: unknown) {
            calls.push({
              method: this.method,
              url: this.url,
              async: this.async,
              path: this.path,
              body,
            });
            if (failure.mode === "throw")
              throw new Error("native endpoint unavailable");
            if (failure.mode === "reject") {
              this.status = 403;
              return;
            }
            if (this.method === "POST") {
              const assignment = String(body);
              const pair = assignment.split(";", 1)[0];
              const index = pair.indexOf("=");
              if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(assignment))
                jar.delete(pair.slice(0, index));
              else jar.set(pair.slice(0, index), pair.slice(index + 1));
            }
            this.responseText = [...jar]
              .map(([key, value]) => `${key}=${value}`)
              .join("; ");
          }
        },
      );
      return { calls, jar, failure };
    }
    it.each([null, "0123456789abcdef0123456789abcdef"])(
      "roundtrips the cookie probe synchronously via the native jar, generation=%s",
      (generation) => {
        const rejected = rejectingBrowserCookies();
        document.cookie = "browser-probe=lost";
        expect(document.cookie).toBe("");
        rejected.mockClear();
        const native = nativeJar();
        vi.stubGlobal(
          "location",
          new URL(`${proxy}/owa/auth/logon.aspx?url=%2Fecp%2F`),
        );
        start({
          ...config(),
          exchangeCookies: true,
          requestGeneration: generation,
        });
        // This is the first site-script work after installation, not an async repair.
        window.eval(
          "document.cookie='ecp-probe=accepted; Path=/owa/; Secure';",
        );
        expect(document.cookie).toBe("ecp-probe=accepted");
        document.cookie = "ecp-probe=; Path=/owa/; Max-Age=0";
        expect(document.cookie).toBe("");
        expect(native.jar.size).toBe(0);
        expect(rejected).not.toHaveBeenCalled();
        expect(navigator.cookieEnabled).toBe(false);
        const endpoint = `${proxy}/__sortofremoteng_exchange_cookie_v1${generation ? `?__sorng_generation_v1=${generation}` : ""}`;
        expect(native.calls.map((c) => c.method)).toEqual([
          "POST",
          "GET",
          "POST",
          "GET",
        ]);
        for (const call of native.calls)
          expect(call).toMatchObject({
            url: endpoint,
            async: false,
            path: "/owa/auth/logon.aspx",
          });
        expect(native.calls[0].body).toBe(
          "ecp-probe=accepted; Path=/owa/; Secure",
        );
        expect(native.calls[1].body).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
        // Existing origin restrictions are unchanged by enabling a cookie jar.
        expect(() =>
          controller!.mapUrl("https://foreign.example/ecp/", "fetch"),
        ).toThrow("origin-not-approved");
      },
    );
    it("reads the current document path on each operation and restores the original descriptor", () => {
      const rejected = rejectingBrowserCookies();
      const original = Object.getOwnPropertyDescriptor(document, "cookie");
      const native = nativeJar();
      start({ ...config(), exchangeCookies: true });
      const bridge = Object.getOwnPropertyDescriptor(document, "cookie")!;
      document.cookie = "fixture=one";
      vi.stubGlobal("location", new URL(`${proxy}/ecp/`));
      expect(document.cookie).toBe("fixture=one");
      expect(native.calls[native.calls.length - 1]?.path).toBe("/ecp/");
      controller!.dispose();
      expect(Object.getOwnPropertyDescriptor(document, "cookie")).toEqual(
        original,
      );
      document.cookie = "fixture=ignored";
      expect(document.cookie).toBe("");
      expect(rejected).toHaveBeenCalledWith("fixture=ignored");
      const count = native.calls.length;
      expect(bridge.get!.call(document)).toBe("");
      expect(() => bridge.set!.call(document, "late=ignored")).not.toThrow();
      expect(native.calls).toHaveLength(count);
    });
    it.each(["throw", "reject"])(
      "keeps native failures silent without browser or upstream fallback: %s",
      (mode) => {
        const rejected = rejectingBrowserCookies();
        const native = nativeJar();
        native.failure.mode = mode;
        start({ ...config(), exchangeCookies: true });
        expect(() => {
          document.cookie = "fixture=not-stored";
        }).not.toThrow();
        expect(document.cookie).toBe("");
        expect(native.jar.size).toBe(0);
        expect(rejected).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
      },
    );
    it.each([undefined, false])(
      "does not infer activation from Exchange paths when flag=%s",
      (exchangeCookies) => {
        const rejected = rejectingBrowserCookies();
        const native = nativeJar();
        vi.stubGlobal("location", new URL(`${proxy}/ecp/`));
        start({ ...config(), exchangeCookies });
        document.cookie = "fixture=lost";
        expect(document.cookie).toBe("");
        expect(rejected).toHaveBeenCalled();
        expect(native.calls).toHaveLength(0);
      },
    );
    it("rejects insecure sources and non-boolean activation", () => {
      expect(() =>
        start({
          ...config(),
          sourceOrigin: "http://device.example",
          exchangeCookies: true,
        }),
      ).toThrow("Invalid Exchange cookie");
      expect(() =>
        start({ ...config(), exchangeCookies: "true" as unknown as boolean }),
      ).toThrow("Invalid Exchange cookie");
    });
    it("rejects a document from another proxy origin", () => {
      vi.stubGlobal("location", new URL(`${otherProxy}/ecp/`));
      expect(() => start({ ...config(), exchangeCookies: true })).toThrow(
        "document mismatch",
      );
    });
  });
  it("routes exact Google origins with credential mode markers and no direct fallback", async () => {
    start(googleConfig());
    expect(controller!.capabilities.googleSession).toMatchObject({
      version: 1,
      origins: [
        "https://analytics.google.com",
        "https://accounts.google.com",
        "https://www.gstatic.com",
      ],
      nativeCookies: true,
      nativeUserAgent: true,
      documentCookieBridge: true,
    });
    xhrOpen.mockClear();
    xhrHeader.mockClear();
    xhrSend.mockClear();
    expect(document.cookie).toBe("native-cookie=ready");
    expect(xhrOpen).toHaveBeenLastCalledWith(
      "GET",
      `${proxy}/__sortofremoteng_google_cookie_v1`,
      false,
    );
    expect(xhrHeader).toHaveBeenLastCalledWith(
      "X-Sorng-Google-Cookie-Path",
      "/portal/page",
    );
    document.cookie = "probe=accepted; Path=/";
    expect(xhrOpen).toHaveBeenLastCalledWith(
      "POST",
      `${proxy}/__sortofremoteng_google_cookie_v1`,
      false,
    );
    expect(xhrSend).toHaveBeenLastCalledWith("probe=accepted; Path=/");
    const account = "http://p11111111111111111111111111111111.localhost:43123";
    expect(
      controller!.mapUrl(
        "https://accounts.google.com/v3/signin/identifier?continue=analytics",
        "navigation",
      ),
    ).toBe(`${account}/v3/signin/identifier?continue=analytics`);
    expect(() =>
      controller!.mapUrl(
        "https://accounts.google.com.attacker.test/",
        "navigation",
      ),
    ).toThrow("origin-not-approved");
    expect(() =>
      controller!.mapUrl("https://www.gstatic.com/document", "navigation"),
    ).toThrow("origin-not-approved");

    await window.fetch("https://accounts.google.com/session", {
      credentials: "include",
    });
    const [url, init] = fetch.mock.calls[fetch.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${account}/session`);
    expect(new Headers(init.headers).get("X-Sorng-Google-Credentials")).toBe(
      "include",
    );

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://accounts.google.com/session");
    xhr.withCredentials = true;
    xhr.send();
    expect(xhrOpen).toHaveBeenLastCalledWith("GET", `${account}/session`);
    expect(xhrHeader).toHaveBeenLastCalledWith(
      "X-Sorng-Google-Credentials",
      "include",
    );
  });
  it("keeps native generation proofs out of Google page state and a subsequent manual POST", () => {
    const generation = "0123456789abcdef0123456789abcdef";
    const options = googleConfig();
    options.sourceOrigin = "https://accounts.google.com";
    options.googleSession!.routes[0].upstreamOrigin = options.sourceOrigin;
    options.googleSession!.routes[1].upstreamOrigin =
      "https://analytics.google.com";
    options.requestGeneration = generation;
    vi.spyOn(history, "replaceState").mockImplementation(
      (_state, _unused, url) => {
        vi.stubGlobal("location", new URL(String(url)));
      },
    );
    vi.spyOn(document, "baseURI", "get").mockImplementation(
      () => location.href,
    );
    vi.stubGlobal(
      "location",
      new URL(`${proxy}/ServiceLogin?__sorng_navigation_v1=${generation}`),
    );
    cleanDocumentUrl();
    start(options);
    const query =
      "continue=https%3A%2F%2Fanalytics.google.com%2F&token=a%2fb%20c+d~&key=one&key=two&empty=";
    const next = controller!.mapUrl(
      `/v3/signin/identifier?${query}`,
      "navigation",
    );
    expect(next).toBe(
      `${proxy}/v3/signin/identifier?${query}&__sorng_generation_v1=${generation}`,
    );
    controller!.dispose();
    controller = undefined;

    // The browser navigates; readiness must remove the local admission proof
    // before Google reads location into its next request or the browser Referer.
    vi.stubGlobal("location", new URL(next));
    cleanDocumentUrl();
    expect(location.href).toBe(`${proxy}/v3/signin/identifier?${query}`);
    start({ ...options, documentSequence: 4 });
    const body = JSON.stringify({
      source: location.href,
      identifier: "fixture",
    });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/_/signin/data/batchexecute");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(body);
    expect(xhrOpen).toHaveBeenLastCalledWith(
      "POST",
      `${proxy}/_/signin/data/batchexecute?__sorng_generation_v1=${generation}`,
    );
    expect(xhrSend).toHaveBeenLastCalledWith(body);
    expect(body).not.toContain("__sorng_");
    expect(xhrHeader).toHaveBeenLastCalledWith(
      "X-Sorng-Google-Credentials",
      "include",
    );
    expect(report).not.toHaveBeenCalled();
  });
  it("retains the native Synology continuation fence when readiness cleans a generation URL", () => {
    const generation = "0123456789abcdef0123456789abcdef";
    const nativeFence = readFileSync(
      "src-tauri/crates/sorng-protocols/src/http_synology_continuation.rs",
      "utf8",
    ).match(
      /r#"<script>([\s\S]*?var key='__sorng_navigation_v1'[\s\S]*?)<\/script>"#/,
    )?.[1];
    if (!nativeFence)
      throw new Error("Native continuation fence is unavailable");
    vi.spyOn(history, "replaceState").mockImplementation(
      (_state, _unused, url) => {
        vi.stubGlobal("location", new URL(String(url)));
      },
    );
    vi.spyOn(history, "pushState").mockImplementation(
      (_state, _unused, url) => {
        vi.stubGlobal("location", new URL(String(url)));
      },
    );
    vi.stubGlobal(
      "location",
      new URL(
        `${proxy}/webman/?keep=a%2Fb&__sorng_generation_v1=${generation}`,
      ),
    );
    window.eval(
      nativeFence
        .split("{token}")
        .join(generation)
        .split("{GENERATION_MARKER}")
        .join("__sorng_generation_v1")
        .replace(/\{\{/g, "{")
        .replace(/\}\}/g, "}"),
    );
    cleanDocumentUrl();
    expect(location.href).toBe(
      `${proxy}/webman/?keep=a%2Fb&__sorng_navigation_v1=${generation}`,
    );
    history.pushState(null, "", "/webman/?keep=b%2Fc");
    expect(location.href).toBe(
      `${proxy}/webman/?keep=b%2Fc&__sorng_navigation_v1=${generation}`,
    );
  });
  it("routes only the exact Tactical API origins through its document-fenced endpoint", async () => {
    start(tacticalConfig());
    expect(controller!.capabilities).toMatchObject({
      version: 6,
      tacticalRmmApi: true,
      tacticalRmmApiOrigins: [
        "https://api.device.example",
        "https://api.example",
      ],
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
    });
    const destination =
      "https://api.device.example/accounts/login/?next=agents";
    const expected = new URL(tacticalApiProxy);
    expected.searchParams.set("destination", destination);
    expected.searchParams.set("__sorng_tactical_document_v1", "3");

    expect(controller!.mapUrl(destination, "fetch")).toBe(expected.href);
    await window.fetch(destination, {
      method: "POST",
      body: "synthetic",
    });
    expect(fetch).toHaveBeenCalledWith(expected.href, {
      method: "POST",
      body: "synthetic",
    });
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", destination);
    expect(xhrOpen).toHaveBeenCalledWith("PATCH", expected.href);

    for (const blocked of [
      "http://api.device.example/accounts/",
      "https://api.device.example:8443/accounts/",
      "https://other.device.example/accounts/",
      "https://api.device.example.evil.test/accounts/",
    ])
      expect(() => controller!.mapUrl(blocked, "fetch")).toThrow(
        "origin-not-approved",
      );
    expect(() =>
      controller!.mapUrl("https://user@api.device.example/accounts/", "fetch"),
    ).toThrow("url-credentials");
    for (const kind of ["navigation", "resource", "form"])
      expect(() => controller!.mapUrl(destination, kind)).toThrow(
        "origin-not-approved",
      );
  });
  it("rejects malformed renderer-supplied Tactical exact-origin sets", () => {
    for (const apiOrigins of [
      ["http://api.device.example"],
      ["https://api.device.example:8443"],
      ["https://user@api.device.example"],
      ["https://api.device.example/path"],
      ["https://api.device.example", "https://api.device.example"],
      [],
      [
        "https://api.one.example",
        "https://api.two.example",
        "https://api.three.example",
        "https://api.four.example",
      ],
    ]) {
      expect(() =>
        start({
          ...tacticalConfig(),
          tacticalRmmApi: {
            version: 2,
            apiOrigins,
            proxyUrl: tacticalApiProxy,
          },
        }),
      ).toThrow("Invalid Tactical RMM API route configuration");
      controller = undefined;
    }
  });
  it("routes a configured exact Tactical origin without widening other contexts", () => {
    const input = tacticalConfig();
    input.tacticalRmmApi!.apiOrigins.push("https://api.vendor.example");
    start(input);
    const destination = "https://api.vendor.example/v3/checkin";
    expect(controller!.mapUrl(destination, "xhr")).toContain(
      encodeURIComponent(destination),
    );
    expect(() => controller!.mapUrl(destination, "resource")).toThrow(
      "origin-not-approved",
    );
  });
  it.each(["wss:", "https:"])(
    "routes saved Tactical API %s sockets only through the app proxy",
    (scheme) => {
      const input = tacticalConfig();
      input.tacticalRmmApi!.apiOrigins.push(
        "https://api.rmm.apps.vogue-homes.com",
      );
      start(input);
      const destination = `${scheme}//api.rmm.apps.vogue-homes.com/ws/agents/?token=a%2Fb+`;
      new WebSocket(destination, ["tactical"]);
      const expected = new URL(tacticalApiProxy);
      expected.protocol = "ws:";
      expected.searchParams.set(
        "destination",
        "https://api.rmm.apps.vogue-homes.com/ws/agents/?token=a%2Fb+",
      );
      expected.searchParams.set("__sorng_tactical_document_v1", "3");
      expected.searchParams.set("__sorng_ws_document_v1", "3");
      expect(constructed).toEqual([
        { kind: "WebSocket", args: [expected.href, ["tactical"]] },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("blocks unconfigured, downgraded and ambiguous Tactical sockets before native construction", () => {
    start(tacticalConfig());
    for (const destination of [
      "wss://api.rmm.apps.vogue-homes.com/ws/",
      "wss://other.device.example/ws/",
      "wss://api.device.example.evil.test/ws/",
      "wss://child.api.device.example/ws/",
      "wss://api.device.example:8443/ws/",
      "ws://api.device.example/ws/",
    ])
      expect(() => new WebSocket(destination)).toThrow("origin-not-approved");
    expect(() => new WebSocket("wss://user@api.device.example/ws/")).toThrow(
      "url-credentials",
    );
    expect(
      () => new WebSocket("wss://api.device.example/ws/#fragment"),
    ).toThrow("invalid-url");
    expect(
      () =>
        new WebSocket("wss://api.device.example/ws/?__sorng_ws_document_v1=3"),
    ).toThrow("reserved-url-parameter");
    expect(constructed).toEqual([]);
  });
  const directProbe =
    "https://192-168-50-100.example-nas.direct.quickconnect.to:5002/webman/pingpong.cgi?action=cors&quickconnect=true";
  const relayProbe =
    "https://example-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true";
  it("uses a separate immutable regional hint only for selected-NAS HTTPS receipt navigation", () => {
    const input = discoveryConfig();
    start(input);
    for (const destination of [
      "https://example-nas.fr3.quickconnect.to/",
      "https://example-nas.de2.quickconnect.to/webman/",
    ]) {
      const anchor = document.createElement("a");
      anchor.href = destination;
      expect(anchor.href).toBe(destination);
      document.body.append(anchor);
      anchor.addEventListener("click", (event) => event.preventDefault());
      anchor.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      expect(new URL(anchor.href).searchParams.get("destination")).toBe(
        destination,
      );
      expect(() => controller!.mapUrl(destination, "fetch")).toThrow();
    }
    for (const destination of [
      "http://example-nas.fr3.quickconnect.to/",
      "https://example-nas.fr3.quickconnect.to:5001/",
      "https://other-nas.fr3.quickconnect.to/",
      "https://example-nas.fr.quickconnect.to/",
      "https://example-nas.fr3x.quickconnect.to/",
      "https://example-nas.x.fr3.quickconnect.to/",
    ])
      expect(() => controller!.mapUrl(destination, "navigation")).toThrow();
    input.synologyQuickConnect.regionalNavigation.alias = "other-nas";
    expect(() =>
      controller!.mapUrl(
        "https://other-nas.fr3.quickconnect.to/",
        "navigation",
      ),
    ).toThrow();
    window.dispatchEvent(new Event("pagehide"));
    expect(() =>
      controller!.mapUrl(
        "https://example-nas.fr3.quickconnect.to/",
        "navigation",
      ),
    ).toThrow("document-closed");
  });
  it("preserves the exact singleton tunnel body and content type through regional fetch and XHR", async () => {
    const body = JSON.stringify([
      {
        version: 1,
        command: "request_tunnel",
        stop_when_error: false,
        stop_when_success: true,
        id: "mainapp_https",
        serverID: "example-nas",
        is_gofile: false,
        path: "",
      },
    ]);
    const mime = "application/x-www-form-urlencoded; charset=UTF-8";
    const destination = "https://dec.quickconnect.to/Serv.php";
    const expected =
      discoveredProxy + "?destination=" + encodeURIComponent(destination);
    start(discoveryConfig());
    await window.fetch(destination, {
      method: "POST",
      body,
      credentials: "include",
      headers: { "Content-Type": mime },
    });
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(fetch.mock.calls[0][0]).toBe(expected);
    expect(options.body).toBe(body);
    expect(options.credentials).toBe("omit");
    expect(new Headers(options.headers).get("content-type")).toBe(mime);
    expect(
      new Headers(options.headers).get("X-Sorng-QuickConnect-Document"),
    ).toBe("3");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", destination, true);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.send(body);
    expect(xhrOpen).toHaveBeenCalledWith("POST", expected, true);
    expect(xhrHeader.mock.calls).toEqual([
      ["X-Sorng-QuickConnect-Document", "3"],
      ["Content-Type", mime],
    ]);
    expect(xhrSend).toHaveBeenCalledExactlyOnceWith(body);
    await window.fetch(
      new RealRequest(destination, {
        method: "POST",
        body,
        headers: { "Content-Type": mime },
      }),
    );
    const replay = fetch.mock.calls[1][0] as Request;
    expect(replay.url).toBe(expected);
    expect(await replay.text()).toBe(body);
    expect(replay.headers.get("content-type")).toBe(mime);
    expect(replay.headers.get("X-Sorng-QuickConnect-Document")).toBe("3");
    expect(replay.credentials).toBe("omit");
    expect(report).not.toHaveBeenCalled();
  });
  it.each(["/Serv.php", proxy + "/Serv.php"])(
    "keeps source-global discovery %s on the protected control route after URL rewriting",
    async (destination) => {
      start({
        ...discoveryConfig(),
        sourceOrigin: "https://global.quickconnect.to",
      });
      await window.fetch(destination, { method: "POST", body: "discovery" });
      expect(fetch.mock.calls[0][0]).toBe(controlProxy);
      const options = fetch.mock.calls[0][1] as RequestInit;
      expect(
        new Headers(options.headers).get("X-Sorng-QuickConnect-Document"),
      ).toBe("3");
      expect(options.credentials).toBe("omit");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", destination, true);
      expect(xhrOpen).toHaveBeenCalledWith("POST", controlProxy, true);
      expect(xhrHeader).toHaveBeenCalledWith(
        "X-Sorng-QuickConnect-Document",
        "3",
      );
    },
  );
  it("keeps a newly selected direct host's own requests on its ordinary proxy route", async () => {
    start({ ...discoveryConfig(), sourceOrigin: new URL(directProbe).origin });
    await window.fetch(directProbe);
    expect(fetch.mock.calls[0][0]).toBe(
      proxy + "/webman/pingpong.cgi?action=cors&quickconnect=true",
    );
    const options = fetch.mock.calls[0][1] as RequestInit | undefined;
    expect(
      new Headers(options?.headers).has("X-Sorng-QuickConnect-Document"),
    ).toBe(false);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", directProbe, true);
    expect(xhrOpen).toHaveBeenLastCalledWith(
      "GET",
      proxy + "/webman/pingpong.cgi?action=cors&quickconnect=true",
      true,
    );
    expect(xhrHeader).not.toHaveBeenCalled();
    await window.fetch(
      "https://example-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
    );
    expect(String(fetch.mock.calls[1][0])).toContain(
      discoveredProxy + "?destination=",
    );
    expect(report).not.toHaveBeenCalled();
  });
  it("does not reinterpret other local sources or nonexact global RPC paths", async () => {
    start(discoveryConfig());
    await window.fetch("/Serv.php", { method: "POST" });
    expect(fetch.mock.calls[0][0]).toBe(proxy + "/Serv.php");
    controller!.dispose();
    start({
      ...discoveryConfig(),
      sourceOrigin: "https://global.quickconnect.to",
    });
    for (const path of [
      "/Serv.php?x=1",
      "/Serv.php#fragment",
      "/serv.php",
      "/other/Serv.php",
    ]) {
      await window.fetch(path, { method: "POST" });
      expect(fetch.mock.calls[fetch.mock.calls.length - 1][0]).toBe(
        proxy + path,
      );
    }
    await expect(window.fetch("/Serv.php", { method: "GET" })).rejects.toThrow(
      "quickconnect-control-method",
    );
  });
  it("keeps same-current regional relay traffic on its ordinary protected route", async () => {
    start({ ...discoveryConfig(), sourceOrigin: new URL(relayProbe).origin });
    await window.fetch(relayProbe);
    expect(fetch.mock.calls[0][0]).toBe(
      proxy + "/webman/pingpong.cgi?action=cors&quickconnect=true",
    );
    const options = fetch.mock.calls[0][1] as RequestInit | undefined;
    expect(
      new Headers(options?.headers).has("X-Sorng-QuickConnect-Document"),
    ).toBe(false);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", relayProbe, true);
    expect(xhrOpen).toHaveBeenCalledWith(
      "GET",
      proxy + "/webman/pingpong.cgi?action=cors&quickconnect=true",
      true,
    );
    expect(xhrHeader).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
  it.each([
    ["POST", "https://dec.quickconnect.to/Serv.php"],
    ["GET", directProbe],
    ["GET", relayProbe],
    ["GET", relayProbe.replace("fr3", "de2")],
    [
      "GET",
      "https://example-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
    ],
  ])(
    "routes candidate %s %s only to native request validation with document fencing",
    async (method, destination) => {
      start(discoveryConfig());
      const response = { status: 403, ok: false };
      fetch.mockResolvedValueOnce(response);
      expect(await window.fetch(destination, { method })).toBe(response);
      const [target, options] = fetch.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(target);
      expect(parsed.origin + parsed.pathname).toBe(discoveredProxy);
      expect([...parsed.searchParams.keys()]).toEqual(["destination"]);
      expect(parsed.searchParams.get("destination")).toBe(destination);
      expect(
        new Headers(options.headers).get("X-Sorng-QuickConnect-Document"),
      ).toBe("3");
      expect(options.credentials).toBe("omit");
      const xhr = new XMLHttpRequest();
      xhr.open(method, destination, true);
      expect(xhrOpen).toHaveBeenCalledWith(method, target, true);
      expect(xhrHeader).toHaveBeenCalledWith(
        "X-Sorng-QuickConnect-Document",
        "3",
      );
      expect(fetch).toHaveBeenCalledOnce();
      expect(report).not.toHaveBeenCalled();
    },
  );
  it("keeps explicit direct-navigation permission separate from closed same-NAS probe candidates", () => {
    const input = discoveryConfig();
    const { directNavigation: _direct, ...candidateOnly } =
      input.synologyQuickConnect;
    start({ ...input, synologyQuickConnect: candidateOnly });
    expect(() =>
      controller!.mapUrl(new URL(directProbe).origin + "/", "navigation"),
    ).toThrow();
    controller!.dispose();
    start(input);
    const link = document.createElement("a");
    link.href = new URL(directProbe).origin + "/webman/";
    expect(link.hostname).toBe(
      "192-168-50-100.example-nas.direct.quickconnect.to",
    );
    document.body.append(link);
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
    expect(new URL(link.href).searchParams.get("destination")).toBe(
      new URL(directProbe).origin + "/webman/",
    );
    for (const kind of [
      "form",
      "resource",
      "websocket",
      "beacon",
      "eventsource",
    ])
      expect(() => controller!.mapUrl(directProbe, kind)).toThrow();
  });
  it.each([
    "https://other-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
    "https://x.y.example-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
    "https://example-nas.direct.quickconnect.to:5003/webman/pingpong.cgi?action=cors&quickconnect=true",
    "http://example-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
    directProbe + "&_cache=private",
    directProbe + "#private",
    directProbe.replace("pingpong.cgi", "entry.cgi"),
    relayProbe.replace("example-nas", "other-nas"),
    relayProbe.replace(".fr3", ".x.fr3"),
    relayProbe.replace(".fr3", ".fr"),
    relayProbe.replace(".fr3", ".fr3x"),
    relayProbe.replace("https:", "http:"),
    relayProbe.replace(".to/", ".to:5001/"),
    relayProbe.replace(".to/", ".to.evil.invalid/"),
    relayProbe.replace("pingpong.cgi", "entry.cgi"),
    relayProbe + "&private=hidden",
    relayProbe + "#private",
    "https://x.dec.quickconnect.to/Serv.php",
    "https://dec.quickconnect.to:5001/Serv.php",
  ])(
    "does not turn candidate routing into wildcard access: %s",
    async (url) => {
      start(discoveryConfig());
      await expect(window.fetch(url)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(report.mock.calls)).not.toContain("private");
    },
  );
  it("enforces discovered method, metadata and teardown without direct fallbacks", async () => {
    const input = discoveryConfig();
    start(input);
    await expect(window.fetch(directProbe, { method: "POST" })).rejects.toThrow(
      "quickconnect-probe-method",
    );
    await expect(
      window.fetch("https://dec.quickconnect.to/Serv.php"),
    ).rejects.toThrow("quickconnect-control-method");
    input.synologyQuickConnect.discovered.alias = "other-nas";
    input.synologyQuickConnect.discovered.proxyUrl = "https://attacker.invalid";
    await window.fetch(directProbe);
    expect(String(fetch.mock.calls[0][0])).toContain(discoveredProxy);
    window.dispatchEvent(new Event("pagehide"));
    await expect(window.fetch(directProbe)).rejects.toThrow("document-closed");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not widen relay probes into other methods, resource contexts or disabled defaults", async () => {
    start(discoveryConfig());
    await expect(window.fetch(relayProbe, { method: "POST" })).rejects.toThrow(
      "quickconnect-probe-method",
    );
    for (const kind of [
      "resource",
      "form",
      "websocket",
      "beacon",
      "eventsource",
    ])
      expect(() => controller!.mapUrl(relayProbe, kind)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    await expect(window.fetch(relayProbe)).rejects.toThrow("document-closed");
    controller!.dispose();
    start(config());
    await expect(window.fetch(relayProbe)).rejects.toThrow(
      "origin-not-approved",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("acknowledges only installed capabilities and routes the HTTPS alias without broad origin permission", () => {
    start(quickConfig());
    expect(controller!.capabilities).toEqual({
      version: 6,
      browserCompatibility: {
        hideWebdriverRequested: false,
        webdriverMasked: false,
      },
      tacticalRmmApi: false,
      tacticalRmmApiOrigins: [],
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
      quickConnectNavigation: true,
      quickConnectDiscovery: true,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    });
    expect(Object.isFrozen(controller!.capabilities)).toBe(true);
    expect(
      new URL(
        controller!.mapUrl(
          "https://example-nas.quickconnect.to/",
          "navigation",
        ),
      ).searchParams.get("destination"),
    ).toBe("https://example-nas.quickconnect.to/");
    expect(() =>
      controller!.mapUrl(
        "https://example-nas.quickconnect.to:5001/",
        "navigation",
      ),
    ).toThrow();
    expect(() =>
      controller!.mapUrl("https://other-nas.quickconnect.to/", "navigation"),
    ).toThrow();
    controller!.dispose();
    start();
    expect(controller!.capabilities).toEqual({
      version: 6,
      browserCompatibility: {
        hideWebdriverRequested: false,
        webdriverMasked: false,
      },
      tacticalRmmApi: false,
      tacticalRmmApiOrigins: [],
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    });
  });
  it("rejects forged capability paths and keeps navigation-only capability free of RPC authority", async () => {
    for (const change of [
      { version: 2 },
      { navigationOrigins: ["https://attacker.invalid"] },
      { redirectEndpoint: proxy + "/wrong" },
      {
        rpc: {
          upstreamUrl: "https://www.quickconnect.to/Serv.php",
          proxyUrl: controlProxy,
        },
      },
      {
        rpc: {
          upstreamUrl: controlUrl,
          proxyUrl: otherProxy + "/__sortofremoteng_quickconnect_control_v1",
        },
      },
    ]) {
      const input = quickConfig();
      expect(() =>
        install(
          {
            ...input,
            synologyQuickConnect: { ...input.synologyQuickConnect, ...change },
          },
          report,
        ),
      ).toThrow("Invalid QuickConnect");
    }
    const input = quickConfig();
    const { rpc: _rpc, ...navigationOnly } = input.synologyQuickConnect;
    start({ ...input, synologyQuickConnect: navigationOnly });
    await expect(window.fetch(controlUrl, { method: "POST" })).rejects.toThrow(
      "origin-not-approved",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(() => {
      document.createElement("a").href = "https://www.quickconnect.to/";
    }).not.toThrow();
  });
  it.each(["a", "area"])(
    "preserves permitted %s URL parsing and routes only its click to native review",
    (tag) => {
      start(quickConfig());
      const link = document.createElement(tag) as HTMLAnchorElement;
      const destination =
        "https://www.quickconnect.to/portal/?token=private#fragment";
      link.href = destination;
      expect(link.href).toBe(destination);
      expect(link.hostname).toBe("www.quickconnect.to");
      expect(report).not.toHaveBeenCalled();
      document.body.append(link);
      const clicked = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link.addEventListener("click", (event) => event.preventDefault());
      link.dispatchEvent(clicked);
      const routed = new URL(link.href);
      expect(routed.origin + routed.pathname).toBe(redirectProxy);
      expect(routed.searchParams.get("destination")).toBe(destination);
      expect(fetch).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    },
  );
  describe.each(["a", "area"] as const)("inert %s references", (tag) => {
    it.each(["property", "attribute"] as const)(
      "accepts foreign href %s assignment but blocks its click without a request",
      async (assignment) => {
        start();
        for (const destination of [
          "https://sy.to",
          "https://foreign.example/help?token=private#section",
          "http://foreign.example/help",
        ]) {
          report.mockClear();
          const link = document.createElement(tag);
          document.body.append(link);
          expect(() => {
            if (assignment === "property") link.href = destination;
            else link.setAttribute("href", destination);
          }).not.toThrow();
          const parsed = new URL(destination);
          expect(link.getAttribute("href")).toBe(parsed.href);
          expect(link.href).toBe(parsed.href);
          expect(link.hostname).toBe(parsed.hostname);
          expect(link.pathname).toBe(parsed.pathname);
          expect(link.search).toBe(parsed.search);
          expect(link.hash).toBe(parsed.hash);
          expect(report).not.toHaveBeenCalled();
          expect(fetch).not.toHaveBeenCalled();
          expect(xhrOpen).not.toHaveBeenCalled();
          expect(xhrSend).not.toHaveBeenCalled();
          expect(beacon).not.toHaveBeenCalled();
          expect(constructed).toEqual([]);

          // No test listener cancels this event: the installed capture handler
          // must stop the browser's default navigation and report the origin.
          const clicked = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          });
          expect(link.dispatchEvent(clicked)).toBe(false);
          expect(clicked.defaultPrevented).toBe(true);
          expect(link.href).toBe(parsed.href);
          expect(report).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              kind: "navigation",
              reason: "origin-not-approved",
              origin: parsed.origin,
            }),
          );
          expect(JSON.stringify(report.mock.calls)).not.toContain("private");
          expect(() => controller!.mapUrl(destination, "navigation")).toThrow(
            "origin-not-approved",
          );
          await expect(window.fetch(destination)).rejects.toThrow(
            "origin-not-approved",
          );
          expect(fetch).not.toHaveBeenCalled();
          expect(xhrOpen).not.toHaveBeenCalled();
          expect(xhrSend).not.toHaveBeenCalled();
          expect(beacon).not.toHaveBeenCalled();
          expect(constructed).toEqual([]);
          link.remove();
        }
      },
    );
    it.each(["property", "attribute"] as const)(
      "still rejects unsafe href %s assignments before changing the link",
      (assignment) => {
        start();
        const link = document.createElement(tag);
        link.href = `${upstream}/help`;
        expect(link.href).toBe(`${proxy}/help`);
        for (const [destination, reason] of [
          ["https://user:private@sy.to/", "url-credentials"],
          ["https://[invalid", "invalid-url"],
          ["https://sy.to/" + "x".repeat(16_384), "invalid-url"],
          ["javascript:alert(1)", "unsupported-scheme"],
          ["file:///private", "unsupported-scheme"],
          ["ftp://sy.to/", "unsupported-scheme"],
          ["data:text/html,private", "unsupported-scheme"],
          ["blob:https://sy.to/private", "unsupported-scheme"],
          ["wss://sy.to/socket", "unsupported-scheme"],
        ]) {
          expect(() => {
            if (assignment === "property") link.href = destination;
            else link.setAttribute("href", destination);
          }).toThrow(reason);
          expect(link.href).toBe(`${proxy}/help`);
        }
        expect(JSON.stringify(report.mock.calls)).not.toContain("private");
        expect(fetch).not.toHaveBeenCalled();
        expect(xhrOpen).not.toHaveBeenCalled();
        expect(xhrSend).not.toHaveBeenCalled();
        expect(beacon).not.toHaveBeenCalled();
        expect(constructed).toEqual([]);
      },
    );
  });
  it("also routes parser-created permitted links but does not grant resource or form authority", () => {
    start(quickConfig());
    document.body.innerHTML =
      '<a href="https://global.quickconnect.to/">Portal</a>';
    const link = document.querySelector("a")!;
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
    expect(link.href.startsWith(redirectProxy + "?destination=")).toBe(true);
    for (const kind of [
      "resource",
      "css",
      "form",
      "beacon",
      "websocket",
      "eventsource",
    ])
      expect(() =>
        controller!.mapUrl("https://www.quickconnect.to/", kind),
      ).toThrow();
    expect(() => {
      document.createElement("a").href =
        "https://user:private@www.quickconnect.to/";
    }).toThrow();
    expect(JSON.stringify(report.mock.calls)).not.toContain("private");
  });
  it("routes only the exact discovery POST with an immutable document header and untouched body", async () => {
    start(quickConfig());
    const body = '[{"command":"get_server_info"}]';
    const options = {
      method: "POST",
      body,
      credentials: "include" as const,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Sorng-QuickConnect-Document": "999",
      },
    };
    await window.fetch(controlUrl, options);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(controlProxy);
    expect(init.body).toBe(body);
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("X-Sorng-QuickConnect-Document")).toBe(
      "3",
    );
    expect(options.headers["X-Sorng-QuickConnect-Document"]).toBe("999");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", controlUrl, true);
    expect(xhrOpen).toHaveBeenCalledWith("POST", controlProxy, true);
    expect(xhrHeader).toHaveBeenCalledWith(
      "X-Sorng-QuickConnect-Document",
      "3",
    );
    expect(report).not.toHaveBeenCalled();
  });
  it("preserves Request input and init overrides while adding the RPC document fence", async () => {
    start(quickConfig());
    const input = new Request(controlUrl, { method: "POST", body: "original" });
    await window.fetch(input, {
      body: "override",
      headers: { "Content-Type": "application/json" },
    });
    const routed = fetch.mock.calls[0][0] as Request;
    expect(routed.url).toBe(controlProxy);
    expect(await routed.text()).toBe("override");
    expect(routed.headers.get("X-Sorng-QuickConnect-Document")).toBe("3");
    expect(routed.credentials).toBe("omit");
  });
  it.each(["GET", "PUT", "DELETE"])(
    "denies %s on the POST-only control capability",
    async (method) => {
      start(quickConfig());
      await expect(window.fetch(controlUrl, { method })).rejects.toThrow(
        "quickconnect-control-method",
      );
      expect(() => new XMLHttpRequest().open(method, controlUrl)).toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
    },
  );
  it.each([
    "https://global.quickconnect.to/",
    "https://global.quickconnect.to/Serv.php?token=private",
    "https://global.quickconnect.to/serv.php",
    "https://www.quickconnect.to/Serv.php",
    "http://global.quickconnect.to/Serv.php",
    "https://global.quickconnect.to.attacker.invalid/Serv.php",
  ])("does not broaden the discovery route to %s", async (url) => {
    start(quickConfig());
    await expect(
      window.fetch(url, { method: "POST", body: "private" }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toContain("private");
  });
  it("keeps copied capabilities immutable, revokes them on pagehide and leaves missing capabilities absent", async () => {
    const config = quickConfig();
    start(config);
    config.synologyQuickConnect.rpc.proxyUrl = "https://attacker.invalid/";
    config.synologyQuickConnect.navigationOrigins.push(
      "https://attacker.invalid",
    );
    await window.fetch(controlUrl, { method: "POST" });
    expect(fetch.mock.calls[0][0]).toBe(controlProxy);
    expect(() =>
      controller!.mapUrl("https://attacker.invalid", "navigation"),
    ).toThrow();
    window.dispatchEvent(new Event("pagehide"));
    await expect(window.fetch(controlUrl, { method: "POST" })).rejects.toThrow(
      "document-closed",
    );
    expect(() => {
      document.createElement("a").href = "https://www.quickconnect.to/";
    }).toThrow();
    controller!.dispose();
    start();
    await expect(window.fetch(controlUrl, { method: "POST" })).rejects.toThrow(
      "origin-not-approved",
    );
    expect(() => {
      document.createElement("a").href = "https://www.quickconnect.to/";
    }).not.toThrow();
    expect(() =>
      controller!.mapUrl("https://www.quickconnect.to/", "navigation"),
    ).toThrow("origin-not-approved");
  });
  const rtcNames = [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
  ];
  function optionalAddressProbe(host: Record<string, unknown>) {
    const addresses: string[] = [];
    const Peer = host.webkitRTCPeerConnection || host.mozRTCPeerConnection;
    if (Peer)
      new (Peer as new (options: unknown) => unknown)({ iceServers: [] });
    const local = addresses.length === 1 ? addresses[0] : "";
    return { local, preferHttpsWan: local === "" };
  }
  function isolatedHost() {
    const host = Object.create(window) as Window & Record<string, unknown>;
    Object.defineProperties(host, {
      addEventListener: { value: window.addEventListener.bind(window) },
      removeEventListener: { value: window.removeEventListener.bind(window) },
    });
    return host;
  }
  function installInHost(host: Window & Record<string, unknown>) {
    const factory = window.eval(
      `(function(window){${source}\nreturn installWebNetworkClient;})`,
    );
    controller = factory(host)(config(), report);
  }
  it("does not advertise Tactical or page interception when a required hook cannot install", () => {
    const host = isolatedHost();
    Object.defineProperty(host, "fetch", {
      configurable: false,
      writable: false,
      value: fetch,
    });
    const factory = window.eval(
      `(function(window){${source}\nreturn installWebNetworkClient;})`,
    );
    controller = factory(host)(tacticalConfig(), report);
    expect(controller!.capabilities).toMatchObject({
      version: 6,
      tacticalRmmApi: false,
      tacticalRmmApiOrigins: [
        "https://api.device.example",
        "https://api.example",
      ],
      fetchInterception: false,
      xhrInterception: true,
      pageNetworkInterception: false,
    });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "compatibility",
        reason: "unavailable-interceptor",
      }),
    );
  });
  it("makes all RTC feature checks unavailable and skips optional local-IP discovery", () => {
    const control = vi.fn(function () {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() =>
      optionalAddressProbe({ webkitRTCPeerConnection: control }),
    ).toThrow();
    expect(control).toHaveBeenCalledOnce();
    start();
    for (const name of rtcNames) {
      expect(
        (window as unknown as Record<string, unknown>)[name],
      ).toBeUndefined();
      expect(name in window).toBe(false);
    }
    expect(
      optionalAddressProbe(window as unknown as Record<string, unknown>),
    ).toEqual({ local: "", preferHttpsWan: true });
    expect(constructed).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });
  it("keeps RTC unavailable on pagehide/BFCache and restores only at explicit cleanup", () => {
    const original = rtcNames.map((name) =>
      Object.getOwnPropertyDescriptor(window, name),
    );
    start();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    for (const name of rtcNames) expect(name in window).toBe(false);
    controller!.dispose();
    rtcNames.forEach((name, index) =>
      expect(Object.getOwnPropertyDescriptor(window, name)).toEqual(
        original[index],
      ),
    );
    controller = undefined;
  });
  it("does not overwrite a page replacement after deleting an RTC global", () => {
    start();
    Object.defineProperty(window, "webkitRTCPeerConnection", {
      configurable: true,
      value: undefined,
    });
    const replacement = Object.getOwnPropertyDescriptor(
      window,
      "webkitRTCPeerConnection",
    );
    controller!.dispose();
    controller = undefined;
    expect(
      Object.getOwnPropertyDescriptor(window, "webkitRTCPeerConnection"),
    ).toEqual(replacement);
  });
  it("shadows inherited RTC constructors and preserves a replaced mask descriptor", () => {
    const host = isolatedHost();
    installInHost(host);
    for (const name of rtcNames) {
      expect(host[name]).toBeUndefined();
      expect(
        Object.getOwnPropertyDescriptor(host, name)?.value,
      ).toBeUndefined();
    }
    const get = () => undefined;
    Object.defineProperty(host, "webkitRTCPeerConnection", {
      configurable: true,
      get,
    });
    controller!.dispose();
    controller = undefined;
    expect(
      Object.getOwnPropertyDescriptor(host, "webkitRTCPeerConnection")?.get,
    ).toBe(get);
    expect(
      Object.getOwnPropertyDescriptor(host, "RTCPeerConnection"),
    ).toBeUndefined();
  });
  it("masks a nonconfigurable writable RTC value without changing its flags", () => {
    const host = isolatedHost();
    const original = vi.fn();
    Object.defineProperty(host, "RTCPeerConnection", {
      value: original,
      writable: true,
      configurable: false,
    });
    const descriptor = Object.getOwnPropertyDescriptor(
      host,
      "RTCPeerConnection",
    );
    installInHost(host);
    expect(host.RTCPeerConnection).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(host, "RTCPeerConnection")?.configurable,
    ).toBe(false);
    controller!.dispose();
    controller = undefined;
    expect(Object.getOwnPropertyDescriptor(host, "RTCPeerConnection")).toEqual(
      descriptor,
    );
    expect(original).not.toHaveBeenCalled();
  });
  it("reports immutable RTC host limits without invoking a peer or aborting other routing", async () => {
    const host = isolatedHost();
    const original = vi.fn();
    Object.defineProperty(host, "RTCPeerConnection", {
      value: original,
      writable: false,
      configurable: false,
    });
    expect(() => installInHost(host)).not.toThrow();
    expect(host.RTCPeerConnection).toBe(original);
    expect(original).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "compatibility",
        reason: "unavailable-interceptor",
      }),
    );
    await host.fetch(`${upstream}/safe`);
    expect(fetch).toHaveBeenCalledWith(`${proxy}/safe`, undefined);
    await expect(
      host.fetch("https://foreign.example/private"),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not create RTC globals when native aliases are already absent", () => {
    rtcNames.forEach((name) => Reflect.deleteProperty(window, name));
    start();
    rtcNames.forEach((name) => expect(name in window).toBe(false));
    expect(report).not.toHaveBeenCalled();
    controller!.dispose();
    controller = undefined;
    rtcNames.forEach((name) => expect(name in window).toBe(false));
  });
  const fontUrl =
    "https://synostatic.synology.com/font/inter/inter-w400-1.woff2";
  const fontPath =
    "/__sortofremoteng_assets_v1/synology-inter/inter-w400-1.woff2";
  const withFonts = () => ({
    ...config(),
    fontAssets: [{ upstreamUrl: fontUrl, proxyUrl: proxy + fontPath }],
  });
  describe("native external font manifest", () => {
    const fontOrigin = "https://fonts.example";
    const stylesheetOrigin = "https://styles.example:8443";
    const externalFont = `${fontOrigin}/face.woff?v=a%2Fb+one&v=two`;
    const stylesheet = `${stylesheetOrigin}/css?family=Example:wght@400;700`;
    const endpoint = proxy + "/__sortofremoteng_assets_v1/external-font";
    const generation = "0123456789abcdef0123456789abcdef";
    const manifest = () => ({
      version: 1,
      origins: [fontOrigin, stylesheetOrigin],
      proxyEndpoint: endpoint,
    });
    const options = () => ({ ...config(), externalFonts: manifest() });
    function routed(destination: string, kind = "font", proof?: string) {
      const url = new URL(endpoint);
      url.searchParams.set("destination", destination);
      url.searchParams.set("kind", kind);
      if (proof) url.searchParams.set("__sorng_generation_v1", proof);
      return url.href;
    }
    it("preserves all 28 built-in Synology font paths alongside the external manifest and generation", () => {
      const fontAssets = [400, 500, 600, 700].flatMap((weight) =>
        Array.from({ length: 7 }, (_, index) => {
          const name = `inter-w${weight}-${index + 1}.woff2`;
          return {
            upstreamUrl: `https://synostatic.synology.com/font/inter/${name}`,
            proxyUrl: `${proxy}/__sortofremoteng_assets_v1/synology-inter/${name}`,
          };
        }),
      );
      start({ ...options(), fontAssets, requestGeneration: generation });
      for (const asset of fontAssets) {
        const expected = `${asset.proxyUrl}?__sorng_generation_v1=${generation}`;
        expect(controller!.mapUrl(asset.upstreamUrl, "font")).toBe(expected);
        expect(controller!.mapUrl(asset.proxyUrl, "font")).toBe(expected);
      }
      expect(controller!.mapUrl(externalFont, "font")).toBe(
        routed(externalFont, "font", generation),
      );
    });
    it.each([undefined, null, { ...manifest(), origins: [] }])(
      "keeps omitted, off/null and empty manifests closed: %j",
      (externalFonts) => {
        start({ ...withFonts(), externalFonts });
        expect(
          () => new FontFace("Denied", `url('${externalFont}')`),
        ).toThrow();
        expect(() => controller!.mapUrl(stylesheet, "stylesheet")).toThrow();
        expect(() =>
          controller!.mapUrl(routed(externalFont), "font"),
        ).toThrow();
        // The closed built-in table remains available independently of opt-in.
        new FontFace("Inter", `url('${fontUrl}')`);
        expect(constructed[constructed.length - 1]?.args[1]).toBe(
          `url("${proxy + fontPath}")`,
        );
      },
    );
    it.each([
      false,
      "on",
      [],
      {},
      { ...manifest(), version: 2 },
      { ...manifest(), unknown: true },
      { ...manifest(), origins: null },
      { ...manifest(), origins: [fontOrigin, fontOrigin] },
      {
        ...manifest(),
        origins: Array.from({ length: 17 }, (_, i) => `https://f${i}.example`),
      },
      { ...manifest(), origins: new Array(1) },
      ...[
        "http://fonts.example",
        "//fonts.example",
        "https://*.example",
        "https://fonts.example/",
        "https://FONTS.example",
        "https://fonts.example:443",
        "https://fonts.example/path",
        "https://fonts.example?",
        "https://fonts.example#",
        "https://user:password@fonts.example",
        "https://@fonts.example",
        "https://fonts.example\n",
        "data:font/woff;base64,eA==",
        null,
      ].map((value) => ({ ...manifest(), origins: [value] })),
      ...[
        otherProxy + "/__sortofremoteng_assets_v1/external-font",
        endpoint + "?kind=font",
        endpoint + "#",
        endpoint + "/",
        proxy + "/api",
        fontOrigin + "/__sortofremoteng_assets_v1/external-font",
      ].map((proxyEndpoint) => ({ ...manifest(), proxyEndpoint })),
    ])(
      "rejects malformed/unknown manifest fields before installing hooks: %j",
      (externalFonts) => {
        const originalFontFace = window.FontFace;
        expect(() => install({ ...config(), externalFonts }, report)).toThrow();
        expect(window.fetch).toBe(fetch);
        expect(window.FontFace).toBe(originalFontFace);
      },
    );
    it("copies grants, accepts 16 exact origins and never widens generic routes", async () => {
      const input = options();
      input.externalFonts.origins = Array.from(
        { length: 15 },
        (_, i) => `https://f${i}.example`,
      );
      input.externalFonts.origins.push(fontOrigin);
      start(input);
      input.externalFonts.origins[15] = "https://evil.example";
      input.externalFonts.origins.push("https://another.example");
      input.externalFonts.proxyEndpoint = "https://evil.example/";
      input.externalFonts.version = 2;
      expect(controller!.mapUrl(externalFont, "font")).toBe(
        routed(externalFont),
      );
      expect(controller!.mapUrl("https://f14.example/font", "font")).toBe(
        routed("https://f14.example/font"),
      );
      expect(() =>
        controller!.mapUrl("https://evil.example/font", "font"),
      ).toThrow();
      await expect(window.fetch(externalFont)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });
    it("routes FontFace, binary-free descriptors, extensionless URLs and document generations", () => {
      start({ ...options(), requestGeneration: generation });
      const descriptors = { weight: "400", display: "swap" as const };
      new FontFace(
        "Example",
        `local(Example), url('${externalFont}') format('woff')`,
        descriptors,
      );
      expect(constructed[constructed.length - 1]?.args).toEqual([
        "Example",
        `local(Example), url("${routed(externalFont, "font", generation)}") format('woff')`,
        descriptors,
      ]);
      const extensionless = `${fontOrigin}/download?id=1`;
      const mapped = controller!.mapUrl(extensionless, "font");
      expect(mapped).toBe(routed(extensionless, "font", generation));
      expect(controller!.mapUrl(mapped, "font")).toBe(mapped);
      expect(
        new URL(mapped).searchParams.getAll("__sorng_generation_v1"),
      ).toEqual([generation]);
      expect(xhrHeader).not.toHaveBeenCalled();
    });
    it.each(["https:", "http:"])(
      "resolves protocol-relative fonts using source scheme %s",
      (scheme) => {
        start({ ...options(), sourceOrigin: `${scheme}//device.example` });
        const relative = "//fonts.example/face.woff";
        if (scheme === "https:")
          expect(controller!.mapUrl(relative, "font")).toBe(
            routed(`${fontOrigin}/face.woff`),
          );
        else expect(() => controller!.mapUrl(relative, "font")).toThrow();
        expect(controller!.mapUrl(externalFont, "font")).toBe(
          routed(externalFont),
        );
      },
    );
    it.each([
      "https://fonts.example.evil/face.woff",
      "https://sub.fonts.example/face.woff",
      "https://fonts.example:444/face.woff",
      "http://fonts.example/face.woff",
      "https://user:password@fonts.example/face.woff",
      externalFont + "#part",
      externalFont + "#",
      "file:///font.woff",
      "javascript:alert(1)",
      "wss://fonts.example/face.woff",
    ])("denies unapproved or malformed font destination %s", (url) => {
      start(options());
      expect(() => new FontFace("Denied", `url('${url}')`)).toThrow();
      expect(constructed).toHaveLength(0);
      expect(fetch).not.toHaveBeenCalled();
    });
    it("routes imports once as stylesheets before font URLs and preserves CSS modifiers", () => {
      const insertRule = vi
        .spyOn(CSSStyleSheet.prototype, "insertRule")
        .mockReturnValue(0);
      start(options());
      const sheet = new CSSStyleSheet();
      for (const source of [
        `url('${stylesheet}')`,
        `url(${stylesheet})`,
        `"${stylesheet}"`,
        `'${stylesheet}'`,
      ]) {
        sheet.insertRule(
          `@import ${source} layer(theme) supports(display: grid) screen;`,
        );
        expect(insertRule).toHaveBeenLastCalledWith(
          `@import url("${routed(stylesheet, "stylesheet")}") layer(theme) supports(display: grid) screen;`,
        );
      }
      sheet.insertRule(
        `@import "${stylesheet}"; @font-face {src: url('${externalFont}') format('woff')}`,
      );
      expect(insertRule).toHaveBeenLastCalledWith(
        `@import url("${routed(stylesheet, "stylesheet")}"); @font-face {src: url("${routed(externalFont)}") format('woff')}`,
      );
      sheet.insertRule(`@import url("${routed(stylesheet, "stylesheet")}");`);
      expect(insertRule).toHaveBeenLastCalledWith(
        `@import url("${routed(stylesheet, "stylesheet")}");`,
      );
      expect(() =>
        sheet.insertRule('@import "https://unapproved.example/style.css";'),
      ).toThrow();
      expect(() =>
        sheet.insertRule('@import/**/"https://styles.example/style.css";'),
      ).toThrow();
      expect(() =>
        sheet.insertRule('a{src:url("https://fonts.example/\\66ont")}'),
      ).toThrow();
    });
    it("routes CSS src, setProperty, cssText, style attributes and all stylesheet mutation APIs", async () => {
      const setProperty = vi
        .spyOn(CSSStyleDeclaration.prototype, "setProperty")
        .mockImplementation(() => {});
      const cssText = vi
        .spyOn(CSSStyleDeclaration.prototype, "cssText", "set")
        .mockImplementation(() => {});
      const insertRule = vi.fn(),
        replaceSync = vi.fn(),
        replace = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("CSSStyleSheet", class {});
      Object.assign(CSSStyleSheet.prototype, {
        insertRule,
        replaceSync,
        replace,
      });
      start(options());
      const source = `url('${externalFont}')`;
      const mapped = `url("${routed(externalFont)}")`;
      const element = document.createElement("div");
      (element.style as CSSStyleDeclaration & { src: string }).src = source;
      expect(setProperty).toHaveBeenLastCalledWith("src", mapped);
      element.style.setProperty("src", source, "important");
      expect(setProperty).toHaveBeenLastCalledWith("src", mapped, "important");
      element.style.setProperty("background-image", source);
      expect(setProperty).toHaveBeenLastCalledWith(
        "background-image",
        mapped,
        undefined,
      );
      element.style.cssText = `src: ${source}`;
      expect(cssText).toHaveBeenLastCalledWith(`src: ${mapped}`);
      element.setAttribute("style", `src: ${source}`);
      expect(element.getAttribute("style")).toBe(`src: ${mapped}`);
      // Call the captured prototype methods: the client wraps all three sinks.
      const sheet = Object.create(CSSStyleSheet.prototype) as CSSStyleSheet;
      const rule = `@font-face {src: ${source}}`;
      sheet.insertRule(rule, 0);
      sheet.replaceSync(rule);
      await sheet.replace(rule);
      expect(insertRule).toHaveBeenCalledWith(`@font-face {src: ${mapped}}`, 0);
      expect(replaceSync).toHaveBeenCalledWith(`@font-face {src: ${mapped}}`);
      expect(replace).toHaveBeenCalledWith(`@font-face {src: ${mapped}}`);
      await expect(
        sheet.replace('a{src:url("https://unapproved.example/font")}'),
      ).rejects.toThrow();
      expect(replace).toHaveBeenCalledTimes(1);
    });
    it.each(["attributes", "properties"])(
      "routes stylesheet and preload links through %s, including href-first ordering",
      (api) => {
        start({ ...options(), requestGeneration: generation });
        const set = (
          link: HTMLLinkElement,
          name: "href" | "rel" | "as",
          value: string,
        ) => {
          if (api === "attributes") link.setAttribute(name, value);
          else link[name] = value;
        };
        for (const hrefFirst of [false, true]) {
          const link = document.createElement("link");
          if (hrefFirst) {
            set(link, "href", stylesheet);
            expect(link.getAttribute("href")).toBeNull();
          }
          set(link, "rel", "alternate STYLESHEET");
          if (!hrefFirst) set(link, "href", stylesheet);
          expect(link.getAttribute("href")).toBe(
            routed(stylesheet, "stylesheet", generation),
          );
          set(link, "rel", "preload");
          expect(link.getAttribute("href")).toBeNull();
          set(link, "as", "font");
          expect(link.getAttribute("href")).toBe(
            routed(stylesheet, "font", generation),
          );
          set(link, "href", externalFont);
          expect(link.getAttribute("href")).toBe(
            routed(externalFont, "font", generation),
          );
          expect(() => set(link, "as", "script")).toThrow();
          expect(() => set(link, "rel", "modulepreload")).toThrow();
          expect(link.getAttribute("as")).toBe("font");
          link.removeAttribute("as");
          expect(link.getAttribute("href")).toBeNull();
          set(link, "as", "font");
          expect(link.getAttribute("href")).toBe(
            routed(externalFont, "font", generation),
          );
          link.removeAttribute("href");
          set(link, "rel", "stylesheet");
          expect(link.getAttribute("href")).toBeNull();
        }
      },
    );
    it("denies other network/load contexts, including reused local endpoints", async () => {
      start(options());
      for (const url of [externalFont, routed(externalFont)]) {
        for (const kind of [
          "fetch",
          "xhr",
          "websocket",
          "eventsource",
          "beacon",
          "resource",
          "script",
          "document",
          "form",
          "navigation",
        ])
          expect(() => controller!.mapUrl(url, kind)).toThrow();
        await expect(window.fetch(url)).rejects.toThrow();
        expect(() => new XMLHttpRequest().open("GET", url)).toThrow();
        expect(() => new WebSocket(url)).toThrow();
        expect(() => new EventSource(url)).toThrow();
        expect(navigator.sendBeacon(url)).toBe(false);
        for (const tag of ["script", "iframe", "img"] as const)
          expect(() => {
            document.createElement(tag).src = url;
          }).toThrow();
        expect(() => {
          document.createElement("form").action = url;
        }).toThrow();
        const link = document.createElement("link");
        link.rel = "preload";
        link.setAttribute("as", "script");
        expect(() => {
          link.href = url;
        }).toThrow();
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
      expect(constructed).toHaveLength(0);
    });
    it("rejects malformed, mismatched and stale local endpoint queries", () => {
      start({ ...options(), requestGeneration: generation });
      for (const url of [
        endpoint,
        routed(externalFont) + "&unknown=1",
        routed(externalFont) + "&kind=font",
        routed(externalFont) +
          "&destination=" +
          encodeURIComponent(externalFont),
        routed(externalFont, "script"),
        routed(externalFont, "stylesheet"),
        routed("https://unapproved.example/font"),
        routed(externalFont) + "#",
        routed(externalFont, "font", "a".repeat(32)),
        routed(externalFont, "font", generation) +
          "&__sorng_generation_v1=" +
          generation,
      ])
        expect(() => controller!.mapUrl(url, "font")).toThrow();
    });
    it("revokes retained FontFace, CSS and pending links on pagehide", () => {
      const insertRule = vi
        .spyOn(CSSStyleSheet.prototype, "insertRule")
        .mockReturnValue(0);
      start(options());
      const Face = window.FontFace;
      const sheet = new CSSStyleSheet();
      const link = document.createElement("link");
      link.href = externalFont;
      window.dispatchEvent(new Event("pagehide"));
      expect(() => new Face("Expired", `url('${externalFont}')`)).toThrow(
        "document-closed",
      );
      expect(() => sheet.insertRule(`@import "${stylesheet}";`)).toThrow(
        "document-closed",
      );
      expect(() => {
        link.rel = "stylesheet";
      }).toThrow("document-closed");
      expect(() => controller!.mapUrl(routed(externalFont), "font")).toThrow(
        "document-closed",
      );
      expect(insertRule).not.toHaveBeenCalled();
      expect(constructed).toHaveLength(0);
      expect(link.getAttribute("href")).toBeNull();
    });
  });
  it("routes FontFace string sources only and preserves native binary/descriptors/subclasses", () => {
    const original = window.FontFace;
    const configuration = withFonts();
    start(configuration);
    configuration.fontAssets[0].proxyUrl = "https://evil.example/";
    const descriptors = { weight: "400", display: "swap" as const };
    const face = new FontFace(
      "Inter",
      `url('${fontUrl}') format('woff2')`,
      descriptors,
    );
    expect(face).toBeInstanceOf(original);
    expect(constructed[constructed.length - 1]?.args).toEqual([
      "Inter",
      `url("${proxy + fontPath}") format('woff2')`,
      descriptors,
    ]);
    const bytes = new Uint8Array([1, 2]);
    class CustomFont extends FontFace {}
    expect(new CustomFont("Binary", bytes)).toBeInstanceOf(CustomFont);
    expect(constructed[constructed.length - 1]?.args[1]).toBe(bytes);
    new FontFace("Buffer", bytes.buffer);
    expect(constructed[constructed.length - 1]?.args[1]).toBe(bytes.buffer);
    new FontFace("Boxed", Object(`url(${fontUrl})`) as string);
    expect(constructed[constructed.length - 1]?.args[1]).toBe(
      `url("${proxy + fontPath}")`,
    );
    expect(() =>
      Reflect.apply(FontFace, undefined, ["Bad", "local(Arial)"]),
    ).toThrow();
  });
  it("routes dynamic font CSS and preloads without granting writes, socket or frame access", async () => {
    const insertRule = vi.spyOn(CSSStyleSheet.prototype, "insertRule");
    start(withFonts());
    const style = document.createElement("style");
    document.head.append(style);
    try {
      style.sheet!.insertRule(
        `@font-face {font-family: Inter; src: url('${fontUrl}');}`,
      );
      // The DOM emulator drops font src descriptors during serialization.
      // Real FontFace/CSS loading is separately exercised by the Edge smoke.
      expect(insertRule).toHaveBeenCalledWith(
        expect.stringContaining(`url("${proxy + fontPath}")`),
      );
      const link = document.createElement("link");
      link.setAttribute("rel", "preload");
      link.setAttribute("as", "font");
      link.setAttribute("href", fontUrl);
      expect(link.getAttribute("href")).toBe(proxy + fontPath);
      await expect(
        window.fetch(fontUrl, { method: "POST", body: "private" }),
      ).rejects.toMatchObject({
        name: "SecurityError",
      });
      expect(() => new WebSocket(fontUrl)).toThrow();
      expect(() =>
        document.createElement("iframe").setAttribute("src", fontUrl),
      ).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      style.remove();
    }
  });
  it("maps exact font GET fetch/Request/XHR binary loaders but rejects other methods and contexts", async () => {
    start(withFonts());
    await window.fetch(fontUrl);
    expect(fetch).toHaveBeenLastCalledWith(proxy + fontPath, undefined);
    await window.fetch(new Request(fontUrl));
    expect(
      (fetch.mock.calls[fetch.mock.calls.length - 1][0] as Request).url,
    ).toBe(proxy + fontPath);
    expect(
      (fetch.mock.calls[fetch.mock.calls.length - 1][0] as Request).method,
    ).toBe("GET");
    const xhr = new XMLHttpRequest();
    xhr.open("GET", fontUrl, true);
    expect(xhrOpen).toHaveBeenCalledWith("GET", proxy + fontPath, true);
    fetch.mockClear();
    xhrOpen.mockClear();
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      await expect(window.fetch(fontUrl, { method })).rejects.toMatchObject({
        name: "SecurityError",
      });
      await expect(
        window.fetch(new Request(fontUrl), { method }),
      ).rejects.toMatchObject({ name: "SecurityError" });
      expect(() => xhr.open(method, fontUrl)).toThrow();
    }
    expect(() => new EventSource(fontUrl)).toThrow();
    expect(navigator.sendBeacon(fontUrl, "private")).toBe(false);
    expect(() => controller!.mapUrl(fontUrl, "navigation")).toThrow();
    expect(() => controller!.mapUrl(fontUrl, "form")).toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toContain("private");
  });
  it("rejects unknown or query-bearing font sources and keeps expired wrappers closed", () => {
    start(withFonts());
    for (const url of [
      fontUrl + "?token=private",
      fontUrl.replace("400", "900"),
      "https://other.example/private?token=private",
    ]) {
      try {
        new FontFace("Inter", `url('${url}')`);
        throw new Error("Expected refusal");
      } catch (error) {
        expect(error).toMatchObject({ name: "SecurityError" });
        expect((error as Error).message).toContain(
          "Blocked font request (origin-not-approved)",
        );
        expect((error as Error).message).toContain(
          "Review Website network restrictions",
        );
        expect((error as Error).message).not.toMatch(/private|woff2|token=/);
      }
    }
    expect(constructed).toHaveLength(0);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "font", reason: "origin-not-approved" }),
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain("private");
    window.dispatchEvent(new Event("pagehide"));
    expect(() => new FontFace("Inter", `url('${fontUrl}')`)).toThrow();
  });
  it("validates the closed immutable font asset table before installing wrappers", () => {
    for (const fontAssets of [
      null,
      {},
      Array.from({ length: 29 }, () => withFonts().fontAssets[0]),
      [withFonts().fontAssets[0], withFonts().fontAssets[0]],
      [{ upstreamUrl: fontUrl + "?token=x", proxyUrl: proxy + fontPath }],
      [{ upstreamUrl: fontUrl, proxyUrl: otherProxy + fontPath }],
      [{ upstreamUrl: fontUrl, proxyUrl: proxy + "/api" }],
      [
        {
          upstreamUrl:
            "http://synostatic.synology.com/font/inter/inter-w400-1.woff2",
          proxyUrl: proxy + fontPath,
        },
      ],
    ]) {
      expect(() => install({ ...config(), fontAssets }, report)).toThrow();
      expect(window.fetch).toBe(fetch);
    }
  });
  it("keeps routing installed when the host refuses the font src interceptor", async () => {
    const defineProperty = Object.defineProperty;
    vi.spyOn(Object, "defineProperty").mockImplementation(
      (target, name, descriptor) => {
        if (target === CSSStyleDeclaration.prototype && name === "src")
          throw new TypeError("Synthetic restricted host prototype");
        return defineProperty(target, name, descriptor);
      },
    );
    expect(() => start(withFonts())).not.toThrow();
    expect(
      report.mock.calls.filter(
        ([value]) =>
          (value as { reason: string }).reason === "unavailable-interceptor",
      ),
    ).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "compatibility",
        reason: "unavailable-interceptor",
        origin: null,
      }),
    );
    await window.fetch(`${upstream}/still-routed`);
    expect(fetch).toHaveBeenCalledWith(`${proxy}/still-routed`, undefined);
    fetch.mockClear();
    await expect(
      window.fetch("https://foreign.example/private?token=private"),
    ).rejects.toMatchObject({ name: "SecurityError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|Synthetic/);
  });
  it("maps exact, protocol-relative and dynamic URLs without changing global URL", async () => {
    const URLBefore = window.URL;
    start();
    for (const url of [
      `${upstream}/api?q=a%20b#part`,
      "//device.example/api?q=a%20b#part",
      new URL(`${upstream}/api?q=a%20b#part`),
    ]) {
      await window.fetch(url);
      expect(fetch).toHaveBeenLastCalledWith(
        `${proxy}/api?q=a%20b#part`,
        undefined,
      );
    }
    await window.fetch("../status");
    expect(fetch).toHaveBeenLastCalledWith(`${proxy}/status`, undefined);
    await window.fetch(`//${new URL(proxy).host}/api`);
    expect(fetch).toHaveBeenLastCalledWith(`${proxy}/api`, undefined);
    expect(window.URL).toBe(URLBefore);
  });
  it.each([
    "https://foreign.example/secret?token=secret",
    "https://device.example.evil/path",
    "https://device.example:444/",
    "http://device.example/",
    "https://user:secret@device.example/",
    "file:///secret",
    "javascript:alert(1)",
  ])("refuses %s without native fetch", async (url) => {
    start();
    await expect(window.fetch(url)).rejects.toMatchObject({
      name: "SecurityError",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret");
  });
  it("keeps explicitly provided routes distinct and ignores later configuration mutation", async () => {
    const input = config();
    input.mappings.push({
      upstreamOrigin: "https://cdn.example",
      proxyOrigin: otherProxy,
    });
    start(input);
    input.mappings.push({
      upstreamOrigin: "https://evil.example",
      proxyOrigin: proxy,
    });
    await window.fetch("https://cdn.example/image");
    expect(fetch).toHaveBeenCalledWith(`${otherProxy}/image`, undefined);
    await expect(window.fetch("https://evil.example/image")).rejects.toThrow();
  });
  it("rejects origin collapse and mismatched document configuration before installing hooks", () => {
    for (const changed of [
      { proxyOrigin: otherProxy },
      {
        mappings: [
          { upstreamOrigin: "https://cdn.example", proxyOrigin: proxy },
        ],
      },
      { sourceOrigin: upstream + "/path" },
      { documentSequence: 0 },
    ]) {
      expect(() => install({ ...config(), ...changed }, report)).toThrow();
      expect(window.fetch).toBe(fetch);
    }
  });
  it("preserves a real Request body, method, signal and fetch overrides", async () => {
    expect(RealRequest).toBeTypeOf("function");
    start();
    const abort = new AbortController();
    const request = new RealRequest(`${upstream}/save`, {
      method: "POST",
      body: "opaque-body",
      headers: { "X-Fixture": "value" },
      credentials: "include",
      signal: abort.signal,
    });
    const options = { cache: "no-store" as const };
    await window.fetch(request, options);
    const mapped = fetch.mock.calls[0][0] as Request;
    expect(mapped).toBeInstanceOf(RealRequest);
    expect(mapped.url).toBe(`${proxy}/save`);
    expect(mapped.method).toBe("POST");
    expect(mapped.credentials).toBe("include");
    expect(mapped.headers.get("X-Fixture")).toBe("value");
    expect(await mapped.text()).toBe("opaque-body");
    abort.abort();
    expect(mapped.signal.aborted).toBe(true);
    expect(mapped.cache).toBe("no-store");
    expect(fetch.mock.calls[0][1]).toBeUndefined();
    expect(JSON.stringify(report.mock.calls)).not.toContain("opaque-body");
  });
  it("retains XHR sync arguments and beacon body without a blocked fallback", () => {
    start();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${upstream}/api`, false, "user", "password");
    expect(xhrOpen).toHaveBeenCalledWith(
      "POST",
      `${proxy}/api`,
      false,
      "user",
      "password",
    );
    expect(() => xhr.open("GET", "https://foreign.example/")).toThrow();
    const body = new Blob(["opaque"]);
    expect(navigator.sendBeacon(`${upstream}/log`, body)).toBe(true);
    expect(beacon).toHaveBeenCalledWith(`${proxy}/log`, body);
    expect(navigator.sendBeacon("https://foreign.example/log", body)).toBe(
      false,
    );
    expect(beacon).toHaveBeenCalledTimes(1);
  });
  it("rejects and cancels a Request exceeding 16 MiB without sending a truncated body", async () => {
    start();
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
      },
      cancel,
    });
    const request = new RealRequest(`${upstream}/large`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(window.fetch(request)).rejects.toMatchObject({
      name: "SecurityError",
    });
    expect(cancel).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "request-body-too-large",
        origin: null,
      }),
    );
  });
  it("snapshots stream chunks when the producer reuses one mutable buffer", async () => {
    start();
    const reused = new Uint8Array(1);
    let count = 0;
    const body = new ReadableStream(
      {
        pull(stream) {
          reused[0] = ++count;
          stream.enqueue(reused);
          if (count === 3) stream.close();
        },
      },
      { highWaterMark: 0 },
    );
    await window.fetch(
      new RealRequest(`${upstream}/reused`, {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
    );
    const mapped = fetch.mock.calls[0][0] as Request;
    expect([...new Uint8Array(await mapped.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it.each(["abort", "pagehide"])(
    "cancels a pending Request read on %s with no network fallback",
    async (action) => {
      start();
      const abort = new AbortController(),
        cancel = vi.fn();
      const body = new ReadableStream({
        start(stream) {
          stream.enqueue(new Uint8Array([1]));
        },
        cancel,
      });
      const request = new RealRequest(`${upstream}/pending`, {
        method: "POST",
        body,
        signal: abort.signal,
        duplex: "half",
      } as RequestInit);
      const pending = window.fetch(request);
      if (action === "abort") abort.abort();
      else window.dispatchEvent(new Event("pagehide"));
      await expect(pending).rejects.toThrow();
      expect(cancel).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "wss://device.example/socket",
    "https://device.example/socket",
    "/socket",
    "//device.example/socket",
  ])("maps WebSocket constructor URL %s and retains protocols", (url) => {
    start();
    const protocols = ["json", "v2"];
    const socket = new WebSocket(url, protocols);
    expect(socket).toBeInstanceOf(WebSocket);
    expect(WebSocket.OPEN).toBe(1);
    expect(constructed).toEqual([
      {
        kind: "WebSocket",
        args: [
          `${proxy.replace("http:", "ws:")}/socket?__sorng_ws_document_v1=3`,
          protocols,
        ],
      },
    ]);
  });
  it("rejects unapproved sockets and spoofed document markers; retains EventSource credentials", () => {
    start();
    expect(() => new WebSocket("wss://evil.example/socket")).toThrow();
    expect(
      () => new WebSocket(`${upstream}/socket?__sorng_ws_document_v1=9`),
    ).toThrow();
    new EventSource(`${upstream}/events`, { withCredentials: true });
    expect(constructed).toEqual([
      {
        kind: "EventSource",
        args: [`${proxy}/events`, { withCredentials: true }],
      },
    ]);
  });
  it("preserves signed socket query bytes when adding the lifecycle marker", () => {
    start();
    const query = "token=a%2fb%20c+d~&&key=one&key=two&empty=";
    new WebSocket(`${upstream}/socket?${query}`);
    expect(constructed[0].args[0]).toBe(
      `${proxy.replace("http:", "ws:")}/socket?${query}&__sorng_ws_document_v1=3`,
    );
    expect(
      () => new WebSocket(`${upstream}/socket?%5f%5fsorng_ws_document_v1=1`),
    ).toThrow();
  });
  it("blocks unsupported new network contexts rather than constructing them", async () => {
    start();
    for (const kind of [
      "Worker",
      "SharedWorker",
      "RTCPeerConnection",
      "WebTransport",
    ])
      expect(() =>
        Reflect.construct(
          (
            window as unknown as Record<
              string,
              new (...args: unknown[]) => object
            >
          )[kind],
          [upstream],
        ),
      ).toThrow();
    await expect(
      navigator.serviceWorker.register(`${upstream}/worker.js`),
    ).rejects.toThrow();
    expect(window.open(upstream)).toBeNull();
    expect(constructed).toEqual([]);
  });
  it("rewrites supported resource properties, attributes, srcset and CSS before their native setter", () => {
    start();
    const image = document.createElement("img");
    image.src = `${upstream}/one.png`;
    expect(image.getAttribute("src")).toBe(`${proxy}/one.png`);
    image.setAttribute(
      "srcset",
      `//device.example/one.png 1x, ${upstream}/two.png 2x`,
    );
    expect(image.srcset).toContain(`${proxy}/two.png 2x`);
    expect(() =>
      image.setAttribute("src", "https://foreign.example/image"),
    ).toThrow();
    const frame = document.createElement("iframe");
    frame.src = `${upstream}/nested`;
    expect(frame.src).toBe(`${proxy}/nested`);
    frame.src = "about:blank";
    expect(frame.src).toBe("about:blank");
    expect(() => {
      frame.src = "data:text/html,unsafe";
    }).toThrow();
    image.style.setProperty(
      "background-image",
      `url('${upstream}/background')`,
    );
    expect(image.style.backgroundImage).toContain(`${proxy}/background`);
    expect(() =>
      image.style.setProperty(
        "background-image",
        "url('https://foreign.example/image')",
      ),
    ).toThrow();
  });
  it("preserves small data and blob IMG sources without admitting them to srcset", () => {
    start();
    const dataImage = "data:image/png;base64,iVBORw0KGgo=";
    const blobImage = `blob:${proxy}/synthetic-image`;
    const image = new Image();

    image.src = dataImage;
    expect(image.src).toBe(dataImage);
    image.setAttribute("src", blobImage);
    expect(image.getAttribute("src")).toBe(blobImage);

    expect(() => {
      image.srcset = dataImage;
    }).toThrow("unsupported-srcset");
    expect(() => {
      image.setAttribute("srcset", blobImage);
    }).toThrow("unsupported-scheme");
  });
  it("accepts a multi-MiB Mesh desktop JPEG data tile through Image.src", () => {
    start();
    const tile = `data:image/jpeg;base64,/9j/${"AQID".repeat(512 * 1_024)}`;
    expect(tile.length).toBeGreaterThan(2 * 1_024 * 1_024);

    const propertyImage = new Image();
    propertyImage.src = tile;
    expect(propertyImage.src).toBe(tile);
  });
  it("does not extend oversized local image handling to scripts, navigation, frames or other data", () => {
    start();
    const tile = `data:image/jpeg;base64,/9j/${"AQID".repeat(5_000)}`;
    const nonImageData = `data:text/html;base64,${"AQID".repeat(5_000)}`;

    expect(() => {
      document.createElement("script").src = tile;
    }).toThrow("invalid-url");
    expect(() => {
      document.createElement("a").href = tile;
    }).toThrow("invalid-url");
    expect(() => {
      document.createElement("iframe").src = tile;
    }).toThrow("invalid-url");
    expect(() => {
      document.createElement("img").src = nonImageData;
    }).toThrow("invalid-url");
    expect(() => {
      document.createElement("img").src =
        `${upstream}/image.jpg?payload=${"A".repeat(20_000)}`;
    }).toThrow("invalid-url");
  });
  it("stops foreign form submissions and preserves original form method/body fields", () => {
    const form = document.createElement("form");
    form.method = "post";
    form.setAttribute("action", `${upstream}/login`);
    form.innerHTML = '<input name="password" value="unchanged">';
    document.body.appendChild(form);
    start();
    expect(
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    ).toBe(true);
    expect(form.action).toBe(`${proxy}/login`);
    expect(form.method).toBe("post");
    expect(new FormData(form).get("password")).toBe("unchanged");
    // Parser-created attributes are not evidence of JS containment; the capture
    // handler still prevents this submission, with native denial as backstop.
    form.innerHTML =
      '<button formaction="https://foreign.example/submit">Save</button>';
    const event = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "submitter", {
      value: form.querySelector("button"),
    });
    expect(form.dispatchEvent(event)).toBe(false);
  });
  it("caps origin-only reports, suppresses duplicates and revokes retained wrappers on pagehide", async () => {
    start();
    const retained = window.fetch;
    for (let i = 0; i < 40; i++)
      await expect(
        retained(`https://blocked${i}.example/private?q=secret`),
      ).rejects.toThrow();
    await expect(
      retained("https://blocked0.example/other?q=secret"),
    ).rejects.toThrow();
    expect(report).toHaveBeenCalledTimes(32);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|secret|\?q/);
    window.dispatchEvent(new Event("pagehide"));
    await expect(retained(`${upstream}/ok`)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(window.fetch).toBe(retained);
    controller?.dispose();
    expect(window.fetch).toBe(fetch);
  });
  it("keeps a BFCache-restored document closed and reports an explicit reload requirement", async () => {
    start();
    const retained = window.fetch;
    window.dispatchEvent(new Event("pagehide"));
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    expect(window.fetch).toBe(retained);
    await expect(window.fetch(`${upstream}/api`)).rejects.toThrow();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "document-expired", origin: null }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports browser CSP denials from parser/CSS resources using origin only", () => {
    start();
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "blockedURI", {
      value: "https://cdn.example/private?token=secret",
    });
    document.dispatchEvent(event);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "resource",
        reason: "policy-blocked-resource",
        origin: "https://cdn.example",
      }),
    );
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|secret/);
  });
});
