import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
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

describe("manual focused credential typing", () => {
  const nonce = "b".repeat(32);
  function capture(type = "password") {
    setupPage(
      `<form><input type="${type}" value="${type === "number" ? "42" : "before"}" /><input id="other" /><button>Submit</button></form>`,
    );
    const field = document.querySelector("input")!;
    field.focus();
    if (type !== "number") field.setSelectionRange(0, 6);
    command("credentialWatch");
    const observation = reports().find(
      (report) => report.status === "credentialFocusState",
    );
    command("credentialFocus", {
      nonce,
      focusRevision: observation.focusRevision,
      focusToken: observation.focusToken,
    });
    expect(reports().slice(-1)[0].status).toBe("ok");
    return field;
  }
  it("fills only the captured selection without clicking, submitting, or echoing secrets", () => {
    const field = capture();
    const submit = vi.fn();
    document.querySelector("form")!.addEventListener("submit", submit);
    const key = vi.fn();
    field.addEventListener("keydown", key);
    command("credentialType", { nonce, value: "päss!" });
    expect(field.value).toBe("päss!");
    expect(submit).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    expect(JSON.stringify(reports())).not.toContain("päss!");
    command("credentialType", { nonce, value: "again" });
    expect(reports().slice(-1)[0].status).toBe("failed");
    expect(field.value).toBe("päss!");
  });
  it("types a current numeric OTP without invoking selection APIs or submitting", () => {
    const field = capture("number");
    const selection = vi.spyOn(field, "setSelectionRange");
    const submit = vi.fn();
    document.querySelector("form")!.addEventListener("submit", submit);
    command("credentialType", {
      nonce,
      value: "012345",
      validity: { starts: Date.now() - 1000, expires: Date.now() + 10000 },
    });
    expect(reports().slice(-1)[0].status).toBe("ok");
    expect(field.value).toBe("012345");
    expect(selection).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each([
    "username",
    "password",
    "numeric-password",
    "non-digits",
    "expired",
    "future",
  ])("rejects %s in a numeric OTP control", (reason) => {
    const field = capture("number");
    const payload: Record<string, unknown> = {
      nonce,
      value:
        reason === "username"
          ? "user"
          : reason === "password"
            ? "password!"
            : "123456",
    };
    if (["non-digits", "expired", "future"].includes(reason)) {
      payload.validity = {
        starts: Date.now() - 1000,
        expires: Date.now() + 10000,
      };
      if (reason === "non-digits") payload.value = "123e45";
      if (reason === "expired")
        payload.validity = {
          starts: Date.now() - 10000,
          expires: Date.now() - 1,
        };
      if (reason === "future")
        payload.validity = {
          starts: Date.now() + 1000,
          expires: Date.now() + 10000,
        };
    }
    command("credentialType", payload);
    expect(reports().slice(-1)[0].status).toBe("failed");
    expect(field.value).toBe("42");
  });
  it.each([
    "missing",
    "disabled",
    "readonly",
    "removed",
    "replacement",
    "focus",
    "selection",
    "navigation",
    "nonce",
    "origin",
    "expired",
    "future",
    "control",
    "type",
  ])("refuses %s before writing", (reason) => {
    const field = capture();
    let payload: Record<string, unknown> = { nonce, value: "secret" };
    if (reason === "missing") command("credentialCancel");
    if (reason === "disabled") field.disabled = true;
    if (reason === "readonly") field.readOnly = true;
    if (reason === "removed") field.remove();
    if (reason === "replacement") {
      const replacement = field.cloneNode() as HTMLInputElement;
      field.replaceWith(replacement);
      replacement.focus();
    }
    if (reason === "focus")
      document.querySelector<HTMLInputElement>("#other")!.focus();
    if (reason === "selection") field.setSelectionRange(1, 2);
    if (reason === "navigation") history.replaceState({}, "", "/other");
    if (reason === "nonce") payload.nonce = "c".repeat(32);
    if (reason === "expired")
      payload = {
        nonce,
        value: "123456",
        validity: { starts: Date.now() - 30000, expires: Date.now() - 1 },
      };
    if (reason === "future")
      payload = {
        nonce,
        value: "123456",
        validity: { starts: Date.now() + 1e4, expires: Date.now() + 3e4 },
      };
    if (reason === "control") payload.value = "secret\n";
    if (reason === "type") field.type = "text";
    command(
      "credentialType",
      payload,
      reason === "navigation"
        ? { url: `${location.origin}/v3/signin/challenge/totp` }
        : {},
      reason === "origin" ? { origin: "https://other.test" } : {},
    );
    expect(reports().slice(-1)[0].status).toBe("failed");
    expect(field.value).toBe("before");
  });
  it("refuses non-editable active elements", () => {
    setupPage("<button>Submit</button>");
    document.querySelector("button")!.focus();
    command("credentialFocus", { nonce });
    expect(reports().slice(-1)[0].status).toBe("failed");
  });
  it.each([false, true])(
    "rejects focus changes between the popup gesture and asynchronous capture delivery (restore=%s)",
    (restore) => {
      setupPage('<input id="password" type="password" /><input id="other" />');
      const password = document.querySelector<HTMLInputElement>("#password")!;
      const other = document.querySelector<HTMLInputElement>("#other")!;
      password.focus();
      command("credentialWatch");
      const reported = reports().find(
        (report) => report.status === "credentialFocusState",
      );
      // Parent has recorded this report at pointer-down. Autofocus runs before
      // the queued capture message is delivered to the actual page client.
      other.focus();
      for (const handler of documentHandlers.get("focusin") ?? [])
        handler({ target: other } as unknown as Event);
      if (restore) {
        password.focus();
        for (const handler of documentHandlers.get("focusin") ?? [])
          handler({ target: password } as unknown as Event);
      }
      command("credentialFocus", {
        nonce,
        focusRevision: reported.focusRevision,
        focusToken: reported.focusToken,
      });
      expect(reports().slice(-1)[0].status).toBe("failed");
      command("credentialType", { nonce, value: "secret" });
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(password.value).toBe("");
      expect(other.value).toBe("");
    },
  );
});
beforeEach(() => {
  history.replaceState({}, "", "/v3/signin/challenge/totp");
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
  Reflect.deleteProperty(window, "logInExec");
  Reflect.deleteProperty(window, "logIn");
  document.body.innerHTML = "";
  document.head.querySelectorAll("script").forEach((script) => script.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("actual injected page-only automation client", () => {
  describe("Porkbun public login authenticator contract", () => {
    const probe = {
      nonce: "b".repeat(32),
      codeSelector:
        'form#loginForm #twoFactorLoginContainer input#twoFactorLoginCode[autocomplete="one-time-code"]',
      submitSelector: "#accountLoginButtonContainer button#accountLoginButton",
      submission: "porkbun",
    };
    const code = () => ({
      nonce: probe.nonce,
      code: "123456",
      expires: Date.now() + 20_000,
    });
    function fixture(path = "/account/login") {
      vi.useFakeTimers();
      history.replaceState({}, "", path);
      pageHandlers.clear();
      documentHandlers.clear();
      window.eval(
        `(function(){var p=${JSON.stringify(identity)},u=new URL(location.href);${darkSource}\n${source}\n})();`,
      );
      // Sanitized from the public page; real AJAX keeps credentials in this
      // form and uses the external button for both password and app-code steps.
      setupPage(`<div id="accountLoginContainer">
        <form id="loginForm" action="/blank" target="lame_login_iframe" method="POST">
          <input id="loginUsername" name="loginUsername" value="fixture-user">
          <input id="loginPassword" name="loginPassword" type="password" value="fixture-password">
          <div id="twoFactorLoginContainer"><input id="twoFactorLoginCode" autocomplete="one-time-code"></div>
          <div id="twoFactorLoginContainerEmail" hidden><input id="twoFactorLoginCodeEmail" autocomplete="one-time-code"></div>
        </form>
        <div id="modal_forceCcaptcha" hidden>Complete verification</div>
        <div id="accountLoginButtonContainer"><button id="accountLoginButton" onclick="logInExec();">Continue</button></div>
      </div>`);
      const field = document.querySelector<HTMLInputElement>(
        "#twoFactorLoginCode",
      )!;
      const button = document.querySelector<HTMLButtonElement>(
        "#accountLoginButton",
      )!;
      const form = document.querySelector<HTMLFormElement>("#loginForm")!;
      const submitted = vi.fn();
      const nativeSubmit = vi.fn();
      form.addEventListener("submit", nativeSubmit);
      const site = window as unknown as {
        logInExec: () => void;
        logIn: () => void;
      };
      site.logIn = () => {
        submitted(field.value);
      };
      site.logInExec = () => site.logIn();
      button.onclick = () => site.logInExec();
      const send = (action: string, payload?: unknown) =>
        command(action, payload);
      return { field, button, form, submitted, nativeSubmit, send };
    }
    it("fills one app code and clicks the outside AJAX button without native submission", async () => {
      const { field, submitted, nativeSubmit, send } = fixture();
      send("totpProbe", probe);
      expect(reports().slice(-1)[0].status).toBe("ok");
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(field.value).toBe("123456");
      expect(submitted).toHaveBeenCalledExactlyOnceWith("123456");
      expect(nativeSubmit).not.toHaveBeenCalled();
      expect(JSON.stringify(reports())).not.toMatch(
        /123456|fixture-password|fixture-user/,
      );
      send("totpSubmit", code());
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(submitted).toHaveBeenCalledOnce();
    });
    it("uses the catalog's exact authenticator challenge", () => {
      const challenge =
        getHttpApplicationProfile("porkbun")!.totpChallenges![0];
      expect(challenge).toMatchObject({
        codeSelector: probe.codeSelector,
        submitSelector: probe.submitSelector,
        submission: "porkbun",
        paths: ["/account/login"],
      });
    });
    it.each([
      "hidden",
      "disabled",
      "email",
      "recovery",
      "captcha",
      "external-action",
      "form-button",
      "missing-handler",
      "wrong-path",
    ])("does not arm the %s challenge", (variant) => {
      const { field, button, form, send, submitted } = fixture(
        variant === "wrong-path" ? "/account/recovery" : "/account/login",
      );
      if (variant === "hidden") field.parentElement!.hidden = true;
      if (variant === "disabled") button.disabled = true;
      if (variant === "captcha")
        document.getElementById("modal_forceCcaptcha")!.hidden = false;
      if (variant === "email")
        document.getElementById("twoFactorLoginContainerEmail")!.hidden = false;
      if (variant === "recovery") {
        const input = document.createElement("input");
        input.id = "bypassTwoFactor2FACode";
        form.append(input);
      }
      if (variant === "external-action")
        form.action = "https://unapproved.example/blank";
      if (variant === "form-button") button.setAttribute("form", "loginForm");
      if (variant === "missing-handler") button.onclick = null;
      send("totpProbe", probe);
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(field.value).toBe("");
      expect(submitted).not.toHaveBeenCalled();
    });
    it.each([
      "account",
      "password",
      "button",
      "email",
      "callback",
      "login-handler",
      "captcha",
    ])("revokes the captured challenge when %s changes", async (variant) => {
      const { field, button, submitted, send } = fixture();
      send("totpProbe", probe);
      if (variant === "account")
        document.querySelector<HTMLInputElement>("#loginUsername")!.value =
          "another-account";
      if (variant === "password")
        document.querySelector<HTMLInputElement>("#loginPassword")!.value =
          "another-password";
      if (variant === "button") button.replaceWith(button.cloneNode(true));
      if (variant === "callback") button.onclick = () => {};
      if (variant === "login-handler")
        Object.assign(window, { logIn: () => {} });
      if (variant === "captcha")
        document.getElementById("modal_forceCcaptcha")!.hidden = false;
      if (variant === "email")
        document.getElementById("twoFactorLoginContainerEmail")!.hidden = false;
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(field.value).toBe("");
      expect(submitted).not.toHaveBeenCalled();
    });
    it("clears a code if its handler switches to another verification step during input", async () => {
      const { field, send, submitted } = fixture();
      field.addEventListener("input", () => {
        document.getElementById("twoFactorLoginContainerEmail")!.hidden = false;
      });
      send("totpProbe", probe);
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(field.value).toBe("");
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(submitted).not.toHaveBeenCalled();
    });
  });
  describe("Cloudflare synthetic authenticator contract (not live DOM)", () => {
    const probe = {
      nonce: "b".repeat(32),
      codeSelector: 'form input[autocomplete="one-time-code"]',
      submitSelector:
        'form:has(input[autocomplete="one-time-code"]) button[type="submit"]',
      submission: "cloudflare",
    };
    const code = () => ({
      nonce: probe.nonce,
      code: "123456",
      expires: Date.now() + 20_000,
    });
    function fixture(path = "/login") {
      vi.useFakeTimers();
      history.replaceState({}, "", path);
      // Install with the actual challenge URL as the document identity.
      pageHandlers.clear();
      documentHandlers.clear();
      window.eval(
        `(function(){var p=${JSON.stringify(identity)},u=new URL(location.href);${darkSource}\n${source}\n})();`,
      );
      setupPage(`<form id="challenge"><h1>Two-factor authentication</h1>
        <label for="cf-code">Code from your authenticator app</label>
        <input id="cf-code" autocomplete="one-time-code" inputmode="numeric">
        <button type="submit" disabled>Verify</button></form>`);
      const form = document.querySelector("form")!;
      const field = document.querySelector("input")!;
      const button = document.querySelector("button")!;
      const label = document.querySelector("label")!;
      let model = "";
      field.addEventListener("input", () => {
        const next = field.value;
        void Promise.resolve().then(() => {
          model = next;
          button.disabled = !model;
        });
      });
      const submitted: string[] = [];
      const prevented: boolean[] = [];
      form.addEventListener("submit", (event) => {
        prevented.push(event.defaultPrevented);
        event.preventDefault();
        submitted.push(model);
      });
      const clicked = vi.spyOn(button, "click");
      const send = (action: string, payload?: unknown) =>
        command(action, payload, { url: new URL(path, location.origin).href });
      return {
        form,
        field,
        button,
        label,
        submitted,
        prevented,
        clicked,
        send,
      };
    }
    it.each(["/login", "/login/"])(
      "commits the authenticator model at %s before one SPA submission",
      async (path) => {
        const { field, button, clicked, submitted, prevented, send } =
          fixture(path);
        send("recordStart");
        send("totpProbe", probe);
        expect(reports().slice(-1)[0].status).toBe("ok");
        expect(button.disabled).toBe(true);
        send("totpSubmit", code());
        expect(clicked).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(submitted).toEqual(["123456"]);
        expect(prevented).toEqual([true]);
        expect(clicked).toHaveBeenCalledOnce();
        expect(reports().slice(-1)[0].status).toBe("ok");
        gesture("change", field);
        send("totpSubmit", code());
        send("totpProbe", { ...probe, nonce: "c".repeat(32) });
        expect(reports().slice(-1)[0].status).toBe("failed");
        expect(clicked).toHaveBeenCalledOnce();
        expect(reports().filter((report) => report.status === "step")).toEqual(
          [],
        );
        expect(JSON.stringify(reports())).not.toContain("123456");
      },
    );
    it("permits an explicit same-origin login POST", async () => {
      const { form, submitted, prevented, send } = fixture();
      form.action = `${location.origin}/login/`;
      form.method = "post";
      send("totpProbe", probe);
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(submitted).toEqual(["123456"]);
      expect(prevented).toEqual([false]);
    });
    it.each(["aria-label", "aria-labelledby", "aria-describedby", "heading"])(
      "accepts scoped authenticator evidence from %s",
      async (kind) => {
        const { form, field, label, submitted, send } = fixture();
        label.textContent = "Verification code";
        if (kind === "aria-label") field.setAttribute(kind, "TOTP code");
        else if (kind === "heading")
          form.querySelector("h1")!.textContent =
            "Time-based one-time password";
        else {
          form.insertAdjacentHTML(
            "afterbegin",
            '<p id="hint">Code from your authenticator app</p>',
          );
          field.setAttribute(kind, "hint");
        }
        send("totpProbe", probe);
        send("totpSubmit", code());
        await vi.advanceTimersByTimeAsync(0);
        expect(submitted).toEqual(["123456"]);
      },
    );
    it("ignores hidden other factors and unrelated alternative links", async () => {
      const { form, submitted, send } = fixture();
      form.insertAdjacentHTML(
        "beforeend",
        `<div hidden>Email recovery <input type="password"><input autocomplete="one-time-code"><button type="submit">Backup</button></div>
        <p style="display:none">Set up your authenticator app</p>
        <a href="#email">Use email instead</a><button type="button">Use a backup code</button>`,
      );
      document.body.insertAdjacentHTML("beforeend", "<h2>Email recovery</h2>");
      send("totpProbe", probe);
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(submitted).toEqual(["123456"]);
    });
    it.each([
      "Enter the code sent to your email",
      "Enter the SMS code",
      "Enter a recovery code",
      "Enter a backup code",
      "Set-up authenticator app",
      "Enable two-factor authentication",
      "Register your authenticator app",
      "Reconfigure TOTP",
      "Use your security key",
    ])("rejects conflicting visible instructions: %s", (instruction) => {
      const { form, send } = fixture();
      const hint = document.createElement("p");
      hint.textContent = instruction;
      form.append(hint);
      send("totpProbe", probe);
      expect(reports().slice(-1)[0].status).toBe("failed");
    });
    it("rejects an email-code input despite an authenticator heading", () => {
      const { field, send } = fixture();
      field.name = "email_code";
      send("totpProbe", probe);
      expect(reports().slice(-1)[0].status).toBe("failed");
    });
    it.each([
      "generic",
      "email",
      "sms",
      "recovery",
      "backup",
      "security-key",
      "enrollment",
      "qr",
      "password",
      "captcha",
      "hidden-evidence",
      "foreign-evidence",
      "alternative-evidence",
      "ambiguous-code",
      "ambiguous-button",
      "foreign-form",
      "foreign-action",
      "foreign-submit",
      "target",
      "formtarget",
      "formmethod",
      "get",
      "method-only",
      "empty-action",
      "other-action",
      "base",
      "readonly",
      "disabled",
      "hidden",
      "path",
      "selector",
      "manual",
    ])("refuses %s before writing a saved code", async (reason) => {
      const { form, field, button, label, clicked, submitted, send } =
        fixture();
      let metadata = probe;
      if (reason === "generic")
        label.textContent = "One-time verification code";
      if (["email", "sms", "recovery", "backup"].includes(reason))
        label.textContent = `Enter your ${reason} code`;
      if (reason === "security-key")
        label.textContent = "Security key authenticator";
      if (reason === "enrollment")
        form.querySelector("h1")!.textContent = "Set up your authenticator app";
      if (reason === "qr")
        form.insertAdjacentHTML("beforeend", "<p>Scan the QR code</p>");
      if (reason === "password")
        form.insertAdjacentHTML("beforeend", '<input type="password">');
      if (reason === "captcha")
        form.insertAdjacentHTML(
          "beforeend",
          '<div class="cf-turnstile"></div>',
        );
      if (reason === "hidden-evidence")
        label.innerHTML =
          "Code <span hidden>from your authenticator app</span>";
      if (reason === "foreign-evidence") {
        label.remove();
        document.body.append(label);
        field.setAttribute("aria-labelledby", "foreign-label");
        label.id = "foreign-label";
      }
      if (reason === "alternative-evidence")
        label.innerHTML = 'Code <a href="#totp">Use an authenticator app</a>';
      if (reason === "ambiguous-code") form.append(field.cloneNode());
      if (reason === "ambiguous-button") form.append(button.cloneNode(true));
      if (reason === "foreign-form") {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<form id="other"></form>',
        );
        button.setAttribute("form", "other");
      }
      if (reason === "foreign-action") {
        form.action = "https://foreign.example/login";
        form.method = "post";
      }
      if (reason === "foreign-submit")
        button.setAttribute("formaction", "https://foreign.example/login");
      if (reason === "target") form.target = "_blank";
      if (reason === "formtarget") button.setAttribute("formtarget", "_self");
      if (reason === "formmethod") button.setAttribute("formmethod", "post");
      if (reason === "get") {
        form.action = "/login";
        form.method = "get";
      }
      if (reason === "method-only") form.method = "post";
      if (reason === "empty-action") form.setAttribute("action", "");
      if (reason === "other-action") {
        form.action = "/settings";
        form.method = "post";
      }
      if (reason === "base")
        form.insertAdjacentHTML(
          "beforeend",
          '<base href="https://foreign.example/">',
        );
      if (reason === "readonly") field.readOnly = true;
      if (reason === "disabled") field.disabled = true;
      if (reason === "hidden") form.style.display = "none";
      if (reason === "path") history.replaceState({}, "", "/login/reset");
      if (reason === "selector")
        metadata = { ...probe, codeSelector: "#cf-code" };
      if (reason === "manual") field.value = "654321";
      send("totpProbe", metadata);
      expect(reports().slice(-1)[0].status).toBe("failed");
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(0);
      expect(clicked).not.toHaveBeenCalled();
      expect(submitted).toEqual([]);
      expect(field.value).toBe(reason === "manual" ? "654321" : "");
    });
    it.each([
      "field",
      "button",
      "form",
      "label",
      "action",
      "type",
      "name",
      "url",
      "expired",
      "nonce",
      "lock",
    ])("refuses a stale %s between probe and code delivery", async (reason) => {
      const { field, button, form, label, clicked, submitted, send } =
        fixture();
      send("totpProbe", probe);
      expect(reports().slice(-1)[0].status).toBe("ok");
      if (reason === "field") field.replaceWith(field.cloneNode());
      if (reason === "button") button.replaceWith(button.cloneNode(true));
      if (reason === "form") form.replaceWith(form.cloneNode(true));
      if (reason === "label") label.textContent = "TOTP code";
      if (reason === "action") {
        form.action = "/login/";
        form.method = "post";
      }
      if (reason === "type") field.type = "tel";
      if (reason === "name") field.name = "changed";
      if (reason === "url") history.replaceState({}, "", "/login?step=other");
      if (reason === "lock") send("totpCancel");
      send("totpSubmit", {
        ...code(),
        ...(reason === "expired" ? { expires: Date.now() } : {}),
        ...(reason === "nonce" ? { nonce: "c".repeat(32) } : {}),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(reports().slice(-1)[0].status).toBe("failed");
      expect(clicked).not.toHaveBeenCalled();
      expect(submitted).toEqual([]);
      expect(field.value).toBe("");
    });
    it.each([
      "field",
      "button",
      "form",
      "email",
      "action",
      "target",
      "url",
      "expired",
      "lease",
      "lock",
      "pagehide",
      "manual",
      "manual-lock",
      "disabled",
    ])("cancels %s during async settling", async (reason) => {
      const {
        field,
        button,
        form,
        label,
        clicked,
        submitted,
        prevented,
        send,
      } = fixture();
      send("totpProbe", probe);
      send("totpSubmit", code());
      expect(field.value).toBe("123456");
      await Promise.resolve();
      if (reason === "field") field.replaceWith(field.cloneNode());
      if (reason === "button") button.replaceWith(button.cloneNode(true));
      if (reason === "form") form.replaceWith(form.cloneNode(true));
      if (reason === "email") label.textContent = "Email code";
      if (reason === "action") {
        form.action = "/login/";
        form.method = "post";
      }
      if (reason === "target") button.setAttribute("formtarget", "_blank");
      if (reason === "url") history.replaceState({}, "", "/login?step=other");
      if (reason === "expired") vi.setSystemTime(Date.now() + 21_000);
      if (reason === "lease") vi.setSystemTime(Date.now() + 15_001);
      if (reason.startsWith("manual")) field.value = "654321";
      if (reason === "lock" || reason === "manual-lock") send("totpCancel");
      if (reason === "pagehide")
        for (const handler of pageHandlers.get("pagehide") ?? [])
          handler(new Event("pagehide"));
      if (reason === "disabled") button.disabled = true;
      await vi.advanceTimersByTimeAsync(3100);
      expect(clicked).not.toHaveBeenCalled();
      expect(submitted).toEqual([]);
      expect(field.value).toBe(reason.startsWith("manual") ? "654321" : "");
      // Cancellation must not leave a preventDefault listener on manual submit.
      const event = new Event("submit", { cancelable: true });
      form.dispatchEvent(event);
      expect(prevented).toEqual([false]);
      send("totpProbe", { ...probe, nonce: "c".repeat(32) });
      expect(clicked).not.toHaveBeenCalled();
    });
    it("waits for a delayed enabled state, then revalidates and clicks once", async () => {
      const { button, clicked, submitted, send } = fixture();
      button.setAttribute("aria-disabled", "true");
      send("totpProbe", probe);
      send("totpSubmit", code());
      await vi.advanceTimersByTimeAsync(50);
      expect(clicked).not.toHaveBeenCalled();
      button.removeAttribute("aria-disabled");
      await vi.advanceTimersByTimeAsync(25);
      expect(clicked).toHaveBeenCalledOnce();
      expect(submitted).toEqual(["123456"]);
    });
  });
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
  it("submits the exact Google Account authenticator challenge once", () => {
    setupPage(
      '<form><input id="totpPin" name="totpPin" type="tel" autocomplete="one-time-code"><div id="totpNext"><button type="button">Next</button></div></form>',
    );
    const button =
      document.querySelector<HTMLButtonElement>("#totpNext button")!;
    const click = vi.spyOn(button, "click");
    const challenge = {
      nonce: "b".repeat(32),
      codeSelector:
        'input#totpPin[name="totpPin"][autocomplete="one-time-code"]',
      submitSelector:
        '#totpNext button[type="button"], button#totpNext[type="button"]',
      submission: "google",
    };
    command("totpProbe", challenge);
    command("totpSubmit", {
      nonce: challenge.nonce,
      code: "123456",
      expires: Date.now() + 20_000,
    });
    expect(document.querySelector<HTMLInputElement>("#totpPin")!.value).toBe(
      "123456",
    );
    expect(click).toHaveBeenCalledOnce();
    command("totpSubmit", {
      nonce: challenge.nonce,
      code: "654321",
      expires: Date.now() + 20_000,
    });
    expect(click).toHaveBeenCalledOnce();
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
  it("allows reviewed SPA handlers but prevents implicit GET fallback navigation", async () => {
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([true]);
    expect(reports().slice(-1)[0].status).toBe("ok");
  });
  function tacticalChallenge() {
    setupPage(`<div class="q-dialog"><div class="q-card q-card--dark q-dark">
      <form class="q-form"><div class="q-card__section">Two-Factor Token</div>
        <label class="q-field q-input q-field--error">
          <input class="q-field__native" autocomplete="one-time-code" inputmode="numeric" type="text" value="">
          <div role="alert">This field is required</div>
        </label>
        <div class="q-card__actions"><button type="button">Cancel</button><button type="submit">Submit</button></div>
      </form></div></div>`);
    const challenge =
      getHttpApplicationProfile("tacticalrmm")!.totpChallenges![0];
    const field = document.querySelector<HTMLInputElement>(
      challenge.codeSelector,
    )!;
    const button = document.querySelector<HTMLButtonElement>(
      challenge.submitSelector,
    )!;
    const form = field.form!;
    let model = "";
    // Quasar's input emits its model update, then Vue updates QInput's props on
    // a microtask. QForm validation reads those props, not the raw DOM value.
    field.addEventListener("input", () => {
      const next = field.value;
      void Promise.resolve().then(() => {
        model = next;
        if (model) document.querySelector('[role="alert"]')?.remove();
      });
    });
    const submitted: string[] = [];
    form.addEventListener("submit", (event) => {
      expect(event.defaultPrevented).toBe(true);
      if (model) submitted.push(model);
    });
    const clicked = vi.spyOn(button, "click");
    command("totpProbe", { ...challenge, nonce: otpProbe.nonce });
    expect(reports().slice(-1)[0].status).toBe("ok");
    return { field, button, submitted, clicked };
  }
  it("lets Tactical RMM commit its token model before clicking Submit once", async () => {
    vi.useFakeTimers();
    const { field, submitted, clicked } = tacticalChallenge();
    command("totpSubmit", otpCode());
    expect(clicked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(field.value).toBe("123456");
    expect(submitted).toEqual(["123456"]);
    expect(clicked).toHaveBeenCalledOnce();
    expect(reports().slice(-1)[0].status).toBe("ok");
    expect(JSON.stringify(reports())).not.toContain("123456");
    command("totpSubmit", otpCode());
    expect(clicked).toHaveBeenCalledOnce();
  });
  it.each(["cancel", "replace", "disable", "action", "expire", "edit"])(
    "does not submit Tactical RMM after %s during model settling",
    async (change) => {
      vi.useFakeTimers();
      const { field, button, submitted, clicked } = tacticalChallenge();
      command("totpSubmit", otpCode());
      if (change === "cancel") command("totpCancel");
      if (change === "replace") field.replaceWith(field.cloneNode());
      if (change === "disable") button.disabled = true;
      if (change === "action") field.form!.action = "https://other.example/otp";
      if (change === "expire") vi.setSystemTime(Date.now() + 21000);
      if (change === "edit") field.value = "654321";
      await vi.advanceTimersByTimeAsync(0);
      expect(clicked).not.toHaveBeenCalled();
      expect(submitted).toEqual([]);
      expect(field.value).toBe(change === "edit" ? "654321" : "");
    },
  );
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
    const sheets: HTMLStyleElement[] = [];
    const dark = {
      enable: vi.fn(() => {
        for (const [kind, css] of [
          ["user-agent", "html{color:white}"],
          ["fallback", ""],
        ]) {
          const style = document.createElement("style");
          style.className = `darkreader darkreader--${kind}`;
          style.textContent = css;
          document.head.append(style);
          sheets.push(style);
        }
        document.documentElement.setAttribute(
          "data-darkreader-mode",
          "dynamic",
        );
      }),
      disable: vi.fn(() => {
        sheets.splice(0).forEach((style) => style.remove());
        document.documentElement.removeAttribute("data-darkreader-mode");
      }),
      setFetchMethod: vi.fn(),
    };
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
