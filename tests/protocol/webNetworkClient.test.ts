import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const otherProxy = "http://p1123456789abcdef0123456789abcdef.localhost:43124";
const upstream = "https://device.example";
const config = () => ({
  version: 1,
  sessionId: "session-one",
  documentSequence: 3,
  sourceOrigin: upstream,
  proxyOrigin: proxy,
  mappings: [] as Array<{ upstreamOrigin: string; proxyOrigin: string }>,
});
interface Controller {
  mapUrl(value: unknown, kind: string, local?: boolean): string;
  dispose(): void;
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
let constructed: Array<{ kind: string; args: unknown[] }>;
const RealRequest = globalThis.Request;

beforeEach(() => {
  vi.stubGlobal("location", new URL(`${proxy}/portal/page`));
  vi.spyOn(document, "baseURI", "get").mockReturnValue(`${proxy}/portal/page`);
  report = vi.fn();
  fetch = vi.fn().mockResolvedValue({ ok: true });
  beacon = vi.fn().mockReturnValue(true);
  xhrOpen = vi.fn();
  constructed = [];
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Request", RealRequest);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      open(...args: unknown[]) {
        xhrOpen(...args);
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
    "Worker",
    "SharedWorker",
    "RTCPeerConnection",
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
  controller = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
function start(value = config()) {
  return (controller = install(value, report));
}

describe("proxy routing compatibility client (not native egress proof)", () => {
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
