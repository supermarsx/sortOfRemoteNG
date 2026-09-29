import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Compatibility behavior only. CSP, native egress and upstream credential
// isolation are independent boundaries, not established by this jsdom suite.
const helperSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_popup_client.js",
  "utf8",
);
const networkSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const sibling = "http://p1123456789abcdef0123456789abcdef.localhost:43123";
const upstream = "https://cpanel.example:2083";
const generation = "0123456789abcdef0123456789abcdef";
const destination = "/cpsess1234567890/frontend/jupiter/filemanager/index.html";
type PopupHandle = {
  location:
    | string
    | {
        href: string;
        assign(value: string): void;
        replace(value: string): void;
      };
  document: Document;
  closed: boolean;
  focus(): void;
  close(): void;
};
type PopupClient = {
  open(url?: string, target?: string, features?: string): PopupHandle | null;
  prepareTarget(target: string): string;
  closeAll(): void;
  dispose(): void;
  closeSelf: (() => void) | null;
};
let helper: PopupClient | undefined;
let network: { dispose(): void } | undefined;
let active: boolean;
let blocked: ReturnType<typeof vi.fn>;
let nativeOpen: ReturnType<typeof vi.fn>;
const frames = () =>
  Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-sorng-website-popup]",
    ),
  );

beforeEach(() => {
  active = true;
  blocked = vi.fn(
    (kind: string, reason: string) => new Error(`${kind}:${reason}`),
  );
  nativeOpen = vi.fn();
  vi.stubGlobal("open", nativeOpen);
  vi.stubGlobal("location", new URL(`${proxy}/cpsess1234567890/index.html`));
  vi.spyOn(document, "baseURI", "get").mockReturnValue(location.href);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  network?.dispose();
  helper?.dispose();
  network = undefined;
  helper = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function startHelper(tabBridge?: object) {
  const install = window.eval(
    `(function(){${helperSource}\nreturn installWebPopupClient;})()`,
  );
  helper = install({
    proxyOrigin: proxy,
    isActive: () => active,
    blocked,
    tabBridge,
    // Deliberately permit arbitrary origins here: the helper must independently
    // reject even an already-mapped, otherwise approved sibling proxy route.
    mapUrl(value: string) {
      const url = new URL(value, `${proxy}/cpsess1234567890/index.html`);
      return url.origin === upstream && !url.username && !url.password
        ? proxy + url.pathname + url.search + url.hash
        : url.href;
    },
  }) as PopupClient;
  return helper;
}
function startNetwork(withHelper = true, extra = {}, reportPopup = vi.fn()) {
  const install = window.eval(
    `(function(){${withHelper ? helperSource : ""}\n${networkSource}\nreturn installWebNetworkClient;})()`,
  );
  network = install(
    {
      version: 1,
      sessionId: "popup-fixture",
      documentSequence: 3,
      requestGeneration: generation,
      sourceOrigin: upstream,
      proxyOrigin: proxy,
      mappings: [
        { upstreamOrigin: "https://sibling.example", proxyOrigin: sibling },
      ],
      ...extra,
    },
    blocked,
    reportPopup,
  );
}

describe("Tactical RMM shared-session tabs", () => {
  it("reuses a contained named blank context before promoting a reviewed tool", () => {
    const report = vi.fn();
    const client = startHelper({
      sessionId: "popup-fixture",
      documentSequence: 3,
      report,
    });
    const first = client.open("", "reuse");
    expect(client.open(`${upstream}/takecontrol/a`, "reuse")).toBe(first);
    expect(frames()).toHaveLength(1);
    expect(frames()[0].src).toBe(`${proxy}/takecontrol/a`);
    expect(report).not.toHaveBeenCalled();
  });
  it("opens reviewed tools as tabs with parent proof, preserves query bytes and reuses named handles", () => {
    const report = vi.fn();
    const client = startHelper({
      sessionId: "popup-fixture",
      documentSequence: 3,
      report,
    });
    const first = client.open(
      `${upstream}/takecontrol/agent-one?token=a%20b%2Fc`,
      "control",
    )!;
    expect(frames()).toHaveLength(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "open",
        title: "Take Control",
        destination: `${proxy}/takecontrol/agent-one?token=a%20b%2Fc&__sorng_popup_parent_v1=3`,
      }),
    );
    expect(first.document).toBeUndefined();
    expect(client.open(`${upstream}/takecontrol/agent-two`, "control")).toBe(
      first,
    );
    expect(report.mock.calls.map(([value]) => value.action)).toEqual([
      "open",
      "navigate",
      "focus",
    ]);
    first.close();
    expect(first.closed).toBe(true);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "close" }),
    );
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("keeps unrelated and blank-then-navigate popups contained, rejects tab origin and route escapes", () => {
    const client = startHelper({
      sessionId: "popup-fixture",
      documentSequence: 3,
      report: vi.fn(),
    });
    const control = client.open(`${upstream}/takecontrol/a`)!;
    expect(() => {
      control.location = `${sibling}/takecontrol/a`;
    }).toThrow();
    expect(() => {
      control.location = `${upstream}/__sortofremoteng_credentials_v1`;
    }).toThrow();
    expect(() => {
      control.location = `${upstream}/ordinary`;
    }).toThrow();
    client.open(destination);
    client.open("");
    expect(frames()).toHaveLength(2);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("bounds tabs and ignores forged close messages", () => {
    const report = vi.fn();
    const client = startHelper({
      sessionId: "popup-fixture",
      documentSequence: 3,
      report,
    });
    const handles = Array.from({ length: 8 }, () =>
      client.open(`${upstream}/takecontrol/a`)!,
    );
    expect(() => client.open(`${upstream}/takecontrol/a`)).toThrow();
    const id = report.mock.calls[0][0].id;
    const close = {
      type: "sorng_web_popup",
      version: 1,
      action: "closed",
      sessionId: "popup-fixture",
      documentSequence: 3,
      id,
    };
    window.dispatchEvent(
      new MessageEvent("message", { data: close, source: null }),
    );
    expect(handles[0].closed).toBe(false);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...close, documentSequence: 2 },
        source: window.parent,
      }),
    );
    expect(handles[0].closed).toBe(false);
    window.dispatchEvent(
      new MessageEvent("message", { data: close, source: window.parent }),
    );
    expect(handles[0].closed).toBe(true);
    client.dispose();
    expect(handles.every((handle) => handle.closed)).toBe(true);
  });

  it("wires the native popup reporter only for an enabled Tactical source", () => {
    const report = vi.fn();
    startNetwork(
      true,
      {
        popupTabs: true,
        sourceOrigin: "https://rmm.example",
        tacticalRmmApi: {
          version: 2,
          apiOrigins: ["https://api.rmm.example"],
          proxyUrl: `${proxy}/__sortofremoteng_tactical_rmm_api_v1`,
        },
      },
      report,
    );
    window.open("https://rmm.example/takecontrol/agent", "_blank");
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ action: "open" }),
    );
    expect(frames()).toHaveLength(0);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("keeps child navigation scoped to its root without adding document proof to background resources", () => {
    const report = vi.fn();
    startNetwork(
      true,
      {
        popupTabs: true,
        popupParentDocument: 3,
        sourceOrigin: "https://rmm.example",
        tacticalRmmApi: {
          version: 2,
          apiOrigins: ["https://api.rmm.example"],
          proxyUrl: `${proxy}/__sortofremoteng_tactical_rmm_api_v1`,
        },
      },
      report,
    );
    const frame = document.createElement("iframe");
    frame.src = "https://rmm.example/takecontrol/agent?token=a%20b";
    expect(frame.src).toContain("token=a%20b");
    expect(new URL(frame.src).searchParams.get("__sorng_popup_parent_v1")).toBe(
      "3",
    );
    const image = document.createElement("img");
    image.src = "https://rmm.example/image.png?__sorng_popup_parent_v1=3";
    expect(new URL(image.src).searchParams.has("__sorng_popup_parent_v1")).toBe(
      false,
    );
    window.open("https://rmm.example/takecontrol/another");
    expect(report).not.toHaveBeenCalled();
    expect(frames()).toHaveLength(1);
  });
});
function expectLocalFrame(frame = frames()[0]) {
  expect(frame).toBeDefined();
  const url = new URL(frame.src);
  expect(url.origin).toBe(proxy);
  expect(url.pathname).toBe(destination);
  expect(url.searchParams.get("__sorng_generation_v1")).toBe(generation);
  expect(nativeOpen).not.toHaveBeenCalled();
}
function cancelAfterRouting(element: Element, type = "click") {
  element.addEventListener(type, (event) => event.preventDefault());
}

describe("contained popup helper", () => {
  it("creates an accessible light-DOM frame and reuses named windows", () => {
    const client = startHelper();
    const first = client.open("", "FileManager")!;
    expect(first).not.toBeNull();
    expect(client.open("", "FileManager")).toBe(first);
    const [frame] = frames();
    expect(frames()).toHaveLength(1);
    expect(frame.getRootNode()).toBe(document);
    expect(frame.name).not.toBe("FileManager");
    expect(frame.closest('[role="dialog"]')).not.toBeNull();
    expect(frame.getAttribute("sandbox") || "").not.toContain("allow-popups");
    expect(first.document).toBe(frame.contentDocument);
    expect(first.document).not.toBe(document);
    expect(client.closeSelf).toBeNull();
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close website popup"]')!
      .click();
    expect(first.closed).toBe(true);
    expect(frames()).toHaveLength(0);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it.each(["location", "href", "assign"])(
    "supports blank-then-delayed %s navigation without replacing the parent",
    async (mode) => {
      const handle = startHelper().open("", "FileManager")!;
      const parent = document;
      handle.document.body.innerHTML = "<p>Loading fixture</p>";
      await Promise.resolve();
      if (mode === "location") handle.location = upstream + destination;
      else {
        const location = handle.location as Exclude<
          PopupHandle["location"],
          string
        >;
        if (mode === "href") location.href = upstream + destination;
        else location.assign(upstream + destination);
      }
      expect(frames()[0].src).toBe(proxy + destination);
      expect(document).toBe(parent);
      expect(handle.closed).toBe(false);
    },
  );

  it("gives every blank target a fresh context and bounds live contexts to eight", () => {
    const client = startHelper();
    const handles = Array.from({ length: 8 }, () => client.open("", "_blank")!);
    expect(new Set(frames().map((frame) => frame.name)).size).toBe(8);
    expect(() => client.open("", "ninth")).toThrow();
    expect(frames()).toHaveLength(8);
    handles[0].close();
    expect(client.open("", "replacement")!.closed).toBe(false);
    expect(frames()).toHaveLength(8);
    client.closeAll();
    expect(frames()).toHaveLength(0);
    expect(handles.every((handle) => handle.closed)).toBe(true);
  });

  it("maps repeated target preparation to the same existing light-DOM name", () => {
    const client = startHelper();
    const target = client.prepareTarget("UploadWindow");
    expect(client.prepareTarget("UploadWindow")).toBe(target);
    expect(client.prepareTarget(target)).toBe(target);
    expect(frames()).toHaveLength(1);
    expect(frames()[0].name).toBe(target);
    expect(client.prepareTarget("_self")).toBe("_self");
    expect(frames()).toHaveLength(1);
  });

  it("keeps context names unique without crypto.randomUUID, including after close", () => {
    vi.stubGlobal("crypto", {});
    const client = startHelper();
    const handles = Array.from({ length: 8 }, () => client.open("", "_blank")!);
    const names = frames().map((frame) => frame.name);
    expect(new Set(names).size).toBe(8);
    handles[0].close();
    const target = client.prepareTarget("FileManager");
    expect(names).not.toContain(target);
    expect(client.prepareTarget("FileManager")).toBe(target);
    expect(frames()).toHaveLength(8);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("preserves publisher-owned named iframe targets", () => {
    const panel = document.createElement("iframe");
    panel.name = "ExistingPanel";
    document.body.append(panel);
    expect(startHelper().prepareTarget("ExistingPanel")).toBe("ExistingPanel");
    expect(frames()).toHaveLength(0);
    expect(panel.isConnected).toBe(true);
  });

  it.each([
    "https://foreign.example/private?token=fixture-secret",
    "https://cpanel.example.attacker.test/",
    `${sibling}/private`,
    `${proxy.replace(":43123", ":43124")}/private`,
    "javascript:alert(1)",
    "data:text/html,<p>foreign</p>",
    "https://user:password@cpanel.example:2083/private",
    `${proxy}/__sortofremoteng_autologin?nonce=fixture-secret`,
  ])("rejects unsafe popup destination %s before creating a frame", (url) => {
    const client = startHelper();
    expect(() => client.open(url, "unsafe")).toThrow();
    expect(frames()).toHaveLength(0);
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(JSON.stringify(blocked.mock.calls)).not.toMatch(
      /fixture-secret|password|private/,
    );
  });

  it("revalidates every delayed location operation", () => {
    const handle = startHelper().open("", "FileManager")!;
    const location = handle.location as Exclude<
      PopupHandle["location"],
      string
    >;
    for (const attempt of [
      () => {
        handle.location = `${sibling}/private`;
      },
      () => {
        location.href = "https://foreign.example/private";
      },
      () => location.assign("javascript:alert(1)"),
      () => location.replace("https://foreign.example/private"),
    ])
      expect(attempt).toThrow();
    expect(frames()[0].getAttribute("src")).toBeNull();
  });

  it.each(["_parent", "_top", "bad\u0000name", "x".repeat(257)])(
    "refuses unsafe target %s",
    (target) => {
      expect(() => startHelper().prepareTarget(target)).toThrow();
      expect(frames()).toHaveLength(0);
    },
  );

  it("revokes retained handles and cleans up on dispose", () => {
    const client = startHelper();
    const handle = client.open("", "FileManager")!;
    active = false;
    expect(handle.closed).toBe(true);
    expect(() => {
      handle.location = destination;
    }).toThrow();
    expect(() => handle.document).toThrow();
    expect(() => handle.focus()).toThrow();
    client.dispose();
    client.dispose();
    expect(frames()).toHaveLength(0);
    active = true;
    expect(() => client.open(destination)).toThrow();
  });
});

describe("production popup helper composed with network routing", () => {
  it("retains the null popup guard when the helper is absent", () => {
    startNetwork(false);
    expect(window.open(upstream + destination, "FileManager")).toBeNull();
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(frames()).toHaveLength(0);
  });

  it("routes window.open through the exact session with generation proof", () => {
    startNetwork();
    expect(window.open(upstream + destination, "FileManager")).not.toBeNull();
    expectLocalFrame();
  });

  it.each(["blank", "named", "base", "ctrl", "meta", "middle", "detached"])(
    "contains %s link activation in a managed target",
    (mode) => {
      startNetwork();
      const anchor = document.createElement("a");
      anchor.href = upstream + destination;
      if (mode === "base") {
        const base = document.createElement("base");
        base.target = "_blank";
        document.body.append(base);
      } else if (mode === "named") anchor.target = "FileManager";
      else if (mode === "blank" || mode === "detached")
        anchor.target = "_blank";
      const type = mode === "middle" ? "auxclick" : "click";
      cancelAfterRouting(anchor, type);
      if (mode === "detached") anchor.click();
      else {
        document.body.append(anchor);
        anchor.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: mode === "middle" ? 1 : 0,
            ctrlKey: mode === "ctrl",
            metaKey: mode === "meta",
          }),
        );
      }
      expect(frames()).toHaveLength(1);
      if (["ctrl", "meta", "middle"].includes(mode)) expectLocalFrame();
      else expect(anchor.target).toBe(frames()[0].name);
      expect(new URL(anchor.href).origin).toBe(proxy);
      expect(
        new URL(anchor.href).searchParams.get("__sorng_generation_v1"),
      ).toBe(generation);
      expect(nativeOpen).not.toHaveBeenCalled();
    },
  );

  it.each(["submit", "requestSubmit", "event"])(
    "preserves POST fields and submitter overrides through %s",
    (mode) => {
      const originalSubmit = vi
        .spyOn(HTMLFormElement.prototype, "submit")
        .mockImplementation(() => {});
      const originalRequest = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(function (this: HTMLFormElement, submitter) {
          this.dispatchEvent(
            new SubmitEvent("submit", {
              bubbles: true,
              cancelable: true,
              submitter,
            }),
          );
        });
      startNetwork();
      const form = document.createElement("form");
      form.innerHTML =
        '<input name="token" value="fixture-only"><input name="choice" value="one"><input name="choice" value="two"><button name="action" value="upload" formtarget="UploadWindow" formaction="/cpsess1234567890/upload">Upload</button>';
      form.method = "post";
      form.enctype = "multipart/form-data";
      form.action = upstream + destination;
      form.target = "FileManager";
      document.body.append(form);
      const submitter = form.querySelector("button")!;
      if (mode === "submit") form.submit();
      else if (mode === "requestSubmit") form.requestSubmit(submitter);
      else
        form.dispatchEvent(
          new SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
            submitter,
          }),
        );
      const target =
        mode === "submit" ? form.target : submitter.getAttribute("formtarget");
      expect(frames()).toHaveLength(1);
      expect(target).toBe(frames()[0].name);
      expect(form.method).toBe("post");
      expect(form.enctype).toBe("multipart/form-data");
      expect(new FormData(form).getAll("choice")).toEqual(["one", "two"]);
      expect(new FormData(form).get("token")).toBe("fixture-only");
      const action =
        mode === "submit" ? form.action : submitter.getAttribute("formaction")!;
      expect(new URL(action).origin).toBe(proxy);
      expect(new URL(action).searchParams.get("__sorng_generation_v1")).toBe(
        generation,
      );
      if (mode === "submit") expect(originalSubmit).toHaveBeenCalledOnce();
      if (mode === "requestSubmit")
        expect(originalRequest).toHaveBeenCalledWith(submitter);
      expect(nativeOpen).not.toHaveBeenCalled();
    },
  );

  it("blocks even approved sibling proxy documents before link or form activation", () => {
    startNetwork();
    document.body.innerHTML = `<a target="_blank" href="${sibling}/private">Foreign</a><form target="FileManager" action="${sibling}/private"><input name="secret" value="fixture-only"></form>`;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    document.querySelector("form")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(frames()).toHaveLength(0);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("closes managed windows and rejects retained facades on pagehide", () => {
    startNetwork();
    const handle = window.open("", "FileManager")!;
    window.dispatchEvent(new Event("pagehide"));
    expect(handle.closed).toBe(true);
    expect(frames()).toHaveLength(0);
    expect(() => {
      handle.location.href = upstream + destination;
    }).toThrow();
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it.each(["click", "submit"])(
    "removes a newly created blank context after a publisher cancels %s",
    async (type) => {
      startNetwork();
      const element = document.createElement(type === "click" ? "a" : "form");
      element.setAttribute(
        type === "click" ? "href" : "action",
        upstream + destination,
      );
      element.setAttribute("target", "_blank");
      element.addEventListener(type, (event) => event.preventDefault());
      document.body.append(element);
      element.dispatchEvent(
        new Event(type, { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(frames()).toHaveLength(0);
      expect(nativeOpen).not.toHaveBeenCalled();
    },
  );
});
