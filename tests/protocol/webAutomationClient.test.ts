import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_automation_client.js",
  "utf8",
);
const darkSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
  "utf8",
);
const identity = {
  sessionId: "demo-proxy",
  documentToken: "d".repeat(32),
  documentSequence: 1,
  navigationToken: null,
};
const parentOrigin = "http://localhost:3000";
type Callback = (event: Event) => void;
let pageHandlers: Map<string, Callback[]>;
let documentHandlers: Map<string, Callback[]>;
let parentWindow: Window;
let post: ReturnType<typeof vi.fn>;
let originalParent: PropertyDescriptor | undefined;
let nativePrint: ReturnType<typeof vi.fn>;
let nativeFocus: ReturnType<typeof vi.fn>;
function command(
  action: string,
  payload?: unknown,
  overrides: Record<string, unknown> = {},
  event: Partial<MessageEvent> = {},
) {
  const data = {
    type: "sorng_web_automation",
    version: 1,
    ...identity,
    url: location.href,
    requestId: "a".repeat(32),
    action,
    payload,
    ...overrides,
  };
  for (const handler of pageHandlers.get("message") ?? [])
    handler({
      data,
      origin: parentOrigin,
      source: parentWindow,
      ...event,
    } as MessageEvent);
}
function gesture(type: "click" | "change", target: Element, trusted = true) {
  for (const handler of documentHandlers.get(type) ?? [])
    handler({ type, target, isTrusted: trusted } as unknown as Event);
}
function reports() {
  return post.mock.calls.map(([data]) => data);
}
function setupPage(html: string) {
  document.body.innerHTML = html;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
}
beforeEach(() => {
  pageHandlers = new Map();
  documentHandlers = new Map();
  post = vi.fn();
  originalParent = Object.getOwnPropertyDescriptor(window, "parent");
  parentWindow = { postMessage: post } as unknown as Window;
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parentWindow,
  });
  nativePrint = vi.fn();
  nativeFocus = vi.fn();
  Object.defineProperty(window, "print", {
    configurable: true,
    writable: true,
    value: nativePrint,
  });
  Object.defineProperty(window, "focus", {
    configurable: true,
    writable: true,
    value: nativeFocus,
  });
  vi.spyOn(window, "addEventListener").mockImplementation((name, callback) => {
    pageHandlers.set(name, [
      ...(pageHandlers.get(name) ?? []),
      callback as Callback,
    ]);
  });
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name, callback) => {
      documentHandlers.set(name, [
        ...(documentHandlers.get(name) ?? []),
        callback as Callback,
      ]);
    },
  );
  window.eval(
    `(function(){var p=${JSON.stringify(identity)},u=new URL(location.href);${darkSource}\n${source}\n})();`,
  );
});
afterEach(() => {
  for (const handler of pageHandlers.get("pagehide") ?? [])
    handler(new Event("pagehide"));
  if (originalParent) Object.defineProperty(window, "parent", originalParent);
  Reflect.deleteProperty(window, "DarkReader");
  Reflect.deleteProperty(window, "automationFixture");
  document.body.innerHTML = "";
  document.head.querySelectorAll("script").forEach((script) => script.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("actual injected page-only automation client", () => {
  it("prints inside the accepted page without trusting a later page override", () => {
    const hostilePrint = vi.fn();
    window.print = hostilePrint;
    command("print");
    expect(nativeFocus).toHaveBeenCalledOnce();
    expect(nativePrint).toHaveBeenCalledOnce();
    expect(hostilePrint).not.toHaveBeenCalled();
    expect(reports()[0]).toMatchObject({ status: "ok" });
  });
  const otpProbe = {
    nonce: "b".repeat(32),
    codeSelector: "#otp",
    submitSelector: "#otp-submit",
    submission: "post",
  };
  const otpCode = () => ({
    nonce: otpProbe.nonce,
    code: "123456",
    expires: Date.now() + 20000,
  });
  function otpPage(extra = "") {
    setupPage(
      `<form method="post" action="/verify"><input id="otp" name="otp" autocomplete="one-time-code"><button id="otp-submit" type="submit">Verify</button>${extra}</form>`,
    );
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    return submit;
  }
  it("submits one matching OTP challenge without recording values or echoing its code", () => {
    const submit = otpPage();
    command("recordStart");
    command("totpProbe", otpProbe);
    command("totpSubmit", otpCode());
    expect(submit).toHaveBeenCalledOnce();
    gesture("change", document.querySelector("#otp")!);
    command("totpSubmit", otpCode());
    command("totpProbe", { ...otpProbe, nonce: "c".repeat(32) });
    expect(submit).toHaveBeenCalledOnce();
    expect(reports().filter((item) => item.status === "step")).toEqual([]);
    expect(JSON.stringify(reports())).not.toContain("123456");
  });
  it.each([
    "hidden",
    "ambiguous",
    "disabled",
    "password",
    "get",
    "external",
    "empty",
    "foreign-submit",
  ])("refuses unsupported OTP %s forms", (variant) => {
    const submit = otpPage(
      variant === "password" ? '<input type="password">' : "",
    );
    const field = document.querySelector<HTMLInputElement>("#otp")!,
      button = document.querySelector<HTMLButtonElement>("#otp-submit")!,
      form = document.querySelector("form")!;
    if (variant === "hidden") field.hidden = true;
    if (variant === "ambiguous") form.append(field.cloneNode());
    if (variant === "disabled") button.disabled = true;
    if (variant === "get") form.method = "get";
    if (variant === "external") form.action = "https://other.example/otp";
    if (variant === "empty") field.value = "manual-value";
    if (variant === "foreign-submit")
      button.setAttribute("formaction", "https://other.example/otp");
    command("totpProbe", otpProbe);
    command("totpSubmit", otpCode());
    expect(submit).not.toHaveBeenCalled();
    expect(field.value).not.toBe("123456");
    expect(reports().slice(-1)[0].status).toBe("failed");
  });
  it.each(["action", "replacement", "expired", "cancel", "nonce"])(
    "rejects a stale OTP challenge after %s",
    (variant) => {
      const submit = otpPage();
      command("totpProbe", otpProbe);
      if (variant === "action")
        document.querySelector("form")!.action = "/changed";
      if (variant === "replacement")
        document
          .querySelector("#otp")!
          .replaceWith(document.querySelector("#otp")!.cloneNode());
      if (variant === "cancel") command("totpCancel");
      command("totpSubmit", {
        ...otpCode(),
        ...(variant === "expired" ? { expires: Date.now() - 1 } : {}),
        ...(variant === "nonce" ? { nonce: "c".repeat(32) } : {}),
      });
      expect(submit).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLInputElement>("#otp")!.value).toBe("");
    },
  );
  it("allows reviewed SPA handlers but prevents implicit GET fallback navigation", () => {
    setupPage(
      '<form><input id="otp" autocomplete="one-time-code"><button id="otp-submit" type="submit">Verify</button></form>',
    );
    const observed: boolean[] = [];
    document
      .querySelector("form")!
      .addEventListener("submit", (event) =>
        observed.push(event.defaultPrevented),
      );
    command("totpProbe", { ...otpProbe, submission: "spa" });
    command("totpSubmit", otpCode());
    expect(observed).toEqual([true]);
    expect(reports().slice(-1)[0].status).toBe("ok");
  });
  it("blocks a public-looking form when an external password control belongs to it", () => {
    setupPage(
      '<form id="linked"><input type="submit"></form><input form="linked" type="password" value="external-secret">',
    );
    const submit = document.querySelector('input[type="submit"]')!;
    command("recordStart");
    gesture("click", submit);
    expect(reports().filter((report) => report.status === "step")).toEqual([]);
    const clicked = vi.fn();
    submit.addEventListener("click", clicked);
    command("step", {
      step: {
        kind: "click",
        selector: "html > body > form:nth-of-type(1) > input:nth-of-type(1)",
      },
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(reports().slice(-1)[0].status).toBe("failed");
    expect(JSON.stringify(reports())).not.toContain("external-secret");
  });
  it("excludes reset buttons from capture and replay", () => {
    setupPage('<button type="reset">Reset</button>');
    const button = document.querySelector("button")!;
    command("recordStart");
    gesture("click", button);
    expect(reports().filter((report) => report.status === "step")).toEqual([]);
    command("step", {
      step: { kind: "click", selector: "html > body > button:nth-of-type(1)" },
    });
    expect(reports().slice(-1)[0].status).toBe("failed");
  });
  it.each(["submit", "button"])(
    "records and replays public input[type=%s] clicks without copying its value",
    (type) => {
      setupPage(
        `<form><input type="${type}" value="private-button-label"></form>`,
      );
      const control = document.querySelector("input")!;
      document
        .querySelector("form")!
        .addEventListener("submit", (event) => event.preventDefault());
      command("recordStart");
      gesture("click", control);
      const step = reports().find((report) => report.status === "step").step;
      expect(step).toEqual({
        kind: "click",
        selector: "html > body > form:nth-of-type(1) > input:nth-of-type(1)",
      });
      command("recordStop");
      const clicked = vi.fn();
      control.addEventListener("click", clicked);
      command("step", { step });
      expect(clicked).toHaveBeenCalledOnce();
      expect(reports().slice(-1)[0].status).toBe("ok");
      expect(JSON.stringify(reports())).not.toContain("private-button-label");
    },
  );
  it.each([
    ["text", "demo-value"],
    ["search", "demo-value"],
    ["email", "demo@example.test"],
    ["url", "https://example.test/demo"],
    ["tel", "123456"],
    ["number", "42"],
    ["date", "2026-09-09"],
    ["datetime-local", "2026-09-09T12:30"],
    ["month", "2026-09"],
    ["week", "2026-W37"],
    ["time", "12:30"],
    ["range", "42"],
    ["color", "#12ab34"],
  ])("records and replays value-free %s input steps", (type, value) => {
    setupPage(`<input type="${type}">`);
    const control = document.querySelector("input")!;
    command("recordStart");
    gesture("change", control);
    const step = reports().find((report) => report.status === "step").step;
    expect(step).toEqual({
      kind: "fill",
      selector: "html > body > input:nth-of-type(1)",
    });
    command("recordStop");
    const changed = vi.fn();
    control.addEventListener("change", changed);
    command("step", { step, value });
    expect(control.value).toBe(value);
    expect(changed).toHaveBeenCalledOnce();
    expect(reports().slice(-1)[0].status).toBe("ok");
    expect(JSON.stringify(reports())).not.toContain(value);
  });
  it.each(["reset", "image", "hidden", "password", "file"])(
    "does not record or replay unsupported/secret input[type=%s]",
    (type) => {
      setupPage(`<input type="${type}">`);
      const control = document.querySelector("input")!;
      command("recordStart");
      gesture("click", control);
      gesture("change", control);
      expect(reports().filter((report) => report.status === "step")).toEqual(
        [],
      );
      command("step", {
        step: { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
        value: "never-fill",
      });
      expect(reports().slice(-1)[0].status).toBe("failed");
      command("step", {
        step: { kind: "click", selector: "html > body > input:nth-of-type(1)" },
      });
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(JSON.stringify(reports())).not.toContain("never-fill");
    },
  );
  it.each([false, true])(
    "blocks login submit inputs, including external form association=%s",
    (external) => {
      setupPage(
        `<form id="login"><input type="password" value="fixture-secret">${external ? "" : '<input type="submit">'}</form>${external ? '<input type="submit" form="login">' : ""}`,
      );
      const submit = document.querySelector('input[type="submit"]')!;
      command("recordStart");
      gesture("click", submit);
      expect(reports().filter((report) => report.status === "step")).toEqual(
        [],
      );
      const clicked = vi.fn();
      submit.addEventListener("click", clicked);
      command("step", {
        step: {
          kind: "click",
          selector: external
            ? "html > body > input:nth-of-type(1)"
            : "html > body > form:nth-of-type(1) > input:nth-of-type(2)",
        },
      });
      expect(clicked).not.toHaveBeenCalled();
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(JSON.stringify(reports())).not.toContain("fixture-secret");
    },
  );
  it("records public controls with hidden CSRF without capturing any value, label, ID or URL", () => {
    setupPage(
      '<form><input type="hidden" name="csrf_token" value="secret-csrf"><input id="public-name" value="private-person-name"><button type="button">Private label</button></form>',
    );
    command("recordStart");
    gesture("change", document.querySelectorAll("input")[1]);
    gesture("click", document.querySelector("button")!);
    const steps = reports()
      .filter((report) => report.status === "step")
      .map((report) => report.step);
    expect(steps).toEqual([
      {
        kind: "fill",
        selector: "html > body > form:nth-of-type(1) > input:nth-of-type(2)",
      },
      {
        kind: "click",
        selector: "html > body > form:nth-of-type(1) > button:nth-of-type(1)",
      },
    ]);
    expect(JSON.stringify(steps)).not.toMatch(
      /csrf|secret|private|public-name/i,
    );
    gesture("change", document.querySelectorAll("input")[0]);
    expect(reports().filter((report) => report.status === "step")).toHaveLength(
      2,
    );
  });
  it.each([
    'type="password"',
    'autocomplete="one-time-code"',
    'name="otp"',
    'name="api_key"',
    'type="file"',
  ])(
    "does not record authentication/secret forms containing %s",
    (attributes) => {
      setupPage(
        `<form><input ${attributes}><input name="username"><button type="button">Submit</button></form>`,
      );
      command("recordStart");
      gesture("click", document.querySelector("button")!);
      gesture("change", document.querySelectorAll("input")[1]);
      expect(reports().filter((report) => report.status === "step")).toEqual(
        [],
      );
    },
  );
  it("ignores programmatic events, unarmed events and commands from the wrong parent or document", () => {
    setupPage('<button type="button">Action</button>');
    gesture("click", document.querySelector("button")!);
    command("recordStart", undefined, {}, { source: window });
    command("recordStart", undefined, { documentToken: "old" });
    gesture("click", document.querySelector("button")!);
    expect(post).not.toHaveBeenCalled();
    command("recordStart");
    gesture("click", document.querySelector("button")!, false);
    expect(reports().filter((report) => report.status === "step")).toEqual([]);
  });
  it("replays a prompted nonsecret value without returning it and refuses password targets", () => {
    setupPage('<input type="text"><input type="password">');
    command("step", {
      step: { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
      value: "ephemeral-demo",
    });
    expect((document.querySelector("input") as HTMLInputElement).value).toBe(
      "ephemeral-demo",
    );
    expect(reports()[0].status).toBe("ok");
    expect(JSON.stringify(reports())).not.toContain("ephemeral-demo");
    command("step", {
      step: { kind: "fill", selector: "html > body > input:nth-of-type(2)" },
      value: "never-fill",
    });
    expect(reports()[1].status).toBe("failed");
    expect(
      (document.querySelectorAll("input")[1] as HTMLInputElement).value,
    ).toBe("");
  });
  it("runs only explicitly sent page JavaScript and returns no result or exception text", async () => {
    expect(
      (window as unknown as { automationFixture?: number }).automationFixture,
    ).toBeUndefined();
    command("script", {
      code: "window.automationFixture = 7; return 'private-result'",
    });
    await Promise.resolve();
    expect(
      (window as unknown as { automationFixture: number }).automationFixture,
    ).toBe(7);
    expect(reports()[0].status).toBe("ok");
    command("script", { code: "throw new Error('private-exception')" });
    expect(reports()[1].status).toBe("failed");
    expect(JSON.stringify(reports())).not.toMatch(
      /private-result|private-exception/,
    );
  });
  it("loads the bundled dark API only after enable, and cancellation defeats deferred loading", async () => {
    expect(document.querySelector("script")).toBeNull();
    command("dark", { enabled: false });
    await Promise.resolve();
    expect(document.querySelector("script")).toBeNull();
    command("dark", { enabled: true });
    const script = document.querySelector("script")!;
    expect(script.src).toBe(
      `${location.origin}/__sortofremoteng_web_darkreader_v1.js`,
    );
    command("dark", { enabled: false });
    const dark = { enable: vi.fn(), disable: vi.fn(), setFetchMethod: vi.fn() };
    Object.defineProperty(window, "DarkReader", {
      configurable: true,
      value: dark,
    });
    script.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(dark.enable).not.toHaveBeenCalled();
  });
  it("restricts dark resource fetches to same-origin with redirect refusal and disables on command", async () => {
    const dark = { enable: vi.fn(), disable: vi.fn(), setFetchMethod: vi.fn() };
    Object.defineProperty(window, "DarkReader", {
      configurable: true,
      value: dark,
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    command("dark", { enabled: true });
    // The engine load is resolved but still asynchronous: the controller now
    // answers it with which path themed the page, which costs one more tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fetchResource = dark.setFetchMethod.mock.calls[0][0];
    await expect(
      fetchResource("https://external.example.test/style.css"),
    ).rejects.toThrow(/External/);
    expect(fetch).not.toHaveBeenCalled();
    await fetchResource("/style.css");
    expect(fetch).toHaveBeenCalledWith(`${location.origin}/style.css`, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    command("dark", { enabled: false });
    expect(dark.disable).toHaveBeenCalledOnce();
  });
  it("acknowledges dark mode with which path themed the page, and nothing else", async () => {
    const dark = { enable: vi.fn(), disable: vi.fn(), setFetchMethod: vi.fn() };
    Object.defineProperty(window, "DarkReader", {
      configurable: true,
      value: dark,
    });
    command("dark", { enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports()[0]).toMatchObject({ status: "ok", darkOutcome: "engine" });

    command("dark", { enabled: true, cssOnly: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports()[1]).toMatchObject({
      status: "ok",
      darkOutcome: "cssOnly",
    });

    // Turning it off themed nothing, so the acknowledgement carries no outcome.
    command("dark", { enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports()[2].status).toBe("ok");
    expect(reports()[2]).not.toHaveProperty("darkOutcome");
  });
  it("stops all recording and commands after pagehide", () => {
    setupPage('<button type="button">Action</button>');
    command("recordStart");
    for (const handler of pageHandlers.get("pagehide") ?? [])
      handler(new Event("pagehide"));
    gesture("click", document.querySelector("button")!);
    command("recordStart");
    expect(post).toHaveBeenCalledOnce();
  });
});
