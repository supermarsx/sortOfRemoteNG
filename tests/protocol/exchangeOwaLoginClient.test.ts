import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { EXCHANGE_OWA_LOGIN_SELECTORS } from "../../src/utils/connection/exchangeOwaProfile";

// Synthetic native Exchange FBA DOM, not an authenticated Exchange deployment.
const source = loadAutologinClient();
const selectors = {
  username_selector: EXCHANGE_OWA_LOGIN_SELECTORS.usernameSelector,
  password_selector: EXCHANGE_OWA_LOGIN_SELECTORS.passwordSelector,
  submit_selector: EXCHANGE_OWA_LOGIN_SELECTORS.submitSelector,
};
const credentials = {
  username: "CONTOSO\\mailbox",
  password: "fixture+&=secret",
};
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<unknown>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
const originalUrl = location.href;
const entry = "/owa/auth/logon.aspx?replaceCurrent=1&url=%2Fowa%2F";

function mount() {
  document.body.innerHTML = `<form name="logonForm" method="post" action="/owa/auth.owa">
    <input name="destination" type="hidden" value="/owa/?ae=Folder&amp;test=a%26b">
    <input name="flags" type="hidden" value="4"><input name="forcedownlevel" type="hidden" value="0">
    <input name="isUtf8" type="hidden" value="1"><input name="trusted" type="checkbox" checked>
    <input id="username" name="username"><input id="password" name="password" type="password">
    <input id="passwordText" name="passwordText" style="display:none">
    <input id="showPasswordCheck" type="checkbox"><div class="signInError"></div>
    <div onclick="clkLgn()" class="signinbutton" role="button">Sign in</div>
  </form>`;
  for (const element of document.querySelectorAll(
    "input, .signinbutton, .signInError",
  ))
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      get: () =>
        element.closest('[style="display:none"]') ? null : document.body,
    });
  const form = document.querySelector("form")!;
  const user = document.querySelector<HTMLInputElement>("#username")!;
  const pw = document.querySelector<HTMLInputElement>("#password")!;
  const destination = form.elements.namedItem(
    "destination",
  ) as HTMLInputElement;
  const button = document.querySelector<HTMLElement>(".signinbutton")!;
  const submitted: Record<string, FormDataEntryValue>[] = [];
  const login = vi.fn(() =>
    submitted.push(Object.fromEntries(new FormData(form))),
  );
  Object.defineProperty(window, "clkLgn", {
    configurable: true,
    writable: true,
    value: login,
  });
  button.onclick = () => {
    (window as unknown as { clkLgn(): void }).clkLgn();
  };
  return { form, user, pw, destination, button, submitted, login };
}

function mountMailboxSearch(type: "search" | "text" = "search") {
  document.body.innerHTML = `<form role="search" action="/owa/" method="get">
    <input id="mailbox-search" name="search" type="${type}" aria-label="Search mail and people">
    <button type="submit">Search</button>
  </form>
  <form id="unrelated-settings" method="post" action="/owa/options">
    <input name="account"><input type="password" name="account-password">
    <button type="submit">Save settings</button>
  </form>`;
  for (const element of document.querySelectorAll("input, button"))
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      value: document.body,
    });
  const search = document.querySelector<HTMLInputElement>("#mailbox-search")!;
  const submit = vi.fn((event: Event) => event.preventDefault());
  for (const form of document.querySelectorAll("form"))
    form.addEventListener("submit", submit);
  return { search, submit };
}

function interactWithSearch(search: HTMLInputElement) {
  search.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  search.focus();
  search.click();
  search.value = "quarterly report";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  search.dispatchEvent(new Event("change", { bubbles: true }));
  // Model OWA rendering suggestions after focus without invoking a submit.
  search.parentElement!.insertAdjacentHTML(
    "beforeend",
    '<div role="listbox"><div role="option">Search suggestions</div></div>',
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", entry);
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...credentials, selectors }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  window.eval(source);
  client = (window as unknown as { __sorng_autologin: Client })
    .__sorng_autologin;
});
afterEach(() => {
  client.cancel();
  window.removeEventListener("pagehide", client.cancel);
  window.removeEventListener("unload", client.cancel);
  for (const key of [
    "__sorng_autologin",
    "__autologin_last",
    "__sorng_map_navigation",
    "clkLgn",
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  window.history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(9000);
  await pending;
}

describe("Exchange OWA native form assistance", () => {
  it.each(["search", "text"] as const)(
    "leaves mailbox %s-input clicks, typing and suggestion mutations alone while armed",
    async (type) => {
      window.history.replaceState({}, "", "/owa/?ae=Folder#path=/mail");
      const mailbox = mountMailboxSearch(type);
      const url = location.href;
      const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
      await vi.advanceTimersByTimeAsync(500);
      interactWithSearch(mailbox.search);
      await vi.advanceTimersByTimeAsync(9000);
      await pending;
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mailbox.submit).not.toHaveBeenCalled();
      expect(mailbox.search.value).toBe("quarterly report");
      expect(document.activeElement).toBe(mailbox.search);
      expect(
        document.querySelector<HTMLInputElement>('input[type="password"]')!
          .value,
      ).toBe("");
      expect(location.href).toBe(url);
    },
  );

  it("rejects a full FBA lookalike on the mailbox route even when search focus makes it visible", async () => {
    window.history.replaceState({}, "", "/owa/");
    const page = mount();
    page.form.setAttribute("style", "display:none");
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<input id="mailbox-search" type="search">',
    );
    const search = document.querySelector<HTMLInputElement>("#mailbox-search")!;
    search.addEventListener("focus", () => {
      page.form.removeAttribute("style");
    });
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    interactWithSearch(search);
    await vi.advanceTimersByTimeAsync(9000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.login).not.toHaveBeenCalled();
    expect(page.user.value + page.pw.value).toBe("");
    expect(search.value).toBe("quarterly report");
    expect(location.pathname).toBe("/owa/");
  });

  it("does not repeat login or submit search after login, including reinjection and repeated bootstrap", async () => {
    const page = mount();
    await run();
    expect(page.login).toHaveBeenCalledOnce();
    window.history.replaceState({}, "", "/owa/");
    const mailbox = mountMailboxSearch();
    interactWithSearch(mailbox.search);
    window.eval(source);
    await client.fetchCredsAndRun("another-nonce", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.login).toHaveBeenCalledOnce();
    expect(mailbox.submit).not.toHaveBeenCalled();
    expect(mailbox.search.value).toBe("quarterly report");
    expect(location.pathname).toBe("/owa/");
  });

  it("does not fill or submit mailbox search if credentials arrive after the login document was replaced", async () => {
    const page = mount();
    const response = { ...credentials, selectors };
    let deliver!: (value: typeof response) => void;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        new Promise<typeof response>((resolve) => {
          deliver = resolve;
        }),
    });
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    window.history.replaceState({}, "", "/owa/");
    const mailbox = mountMailboxSearch();
    interactWithSearch(mailbox.search);
    deliver(response);
    await vi.advanceTimersByTimeAsync(9000);
    await pending;
    expect(page.login).not.toHaveBeenCalled();
    expect(mailbox.submit).not.toHaveBeenCalled();
    expect(mailbox.search.value).toBe("quarterly report");
    expect(page.user.value + page.pw.value).toBe("");
    expect(response.username).toBeNull();
    expect(response.password).toBeNull();
    expect(location.pathname).toBe("/owa/");
  });

  it("waits for the redirect and native handler, then submits once without changing hidden fields", async () => {
    window.history.replaceState({}, "", "/owa/");
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState({}, "", entry);
    const page = mount();
    const handler = page.button.onclick;
    page.button.onclick = null;
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    page.button.onclick = handler;
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "/__sortofremoteng_autologin?nonce=fixture-nonce",
      { credentials: "same-origin", cache: "no-store" },
    ]);
    expect(page.submitted).toEqual([
      {
        ...credentials,
        destination: "/owa/?ae=Folder&test=a%26b",
        flags: "4",
        forcedownlevel: "0",
        isUtf8: "1",
        trusted: "on",
        passwordText: "",
      },
    ]);
    expect(
      document.querySelector<HTMLInputElement>("#showPasswordCheck")!.checked,
    ).toBe(false);
    await client.fetchCredsAndRun("repeat", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.login).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["relative", "proxy", "upstream"])(
    "preserves the exact %s mailbox destination",
    async (kind) => {
      const page = mount();
      window.history.replaceState({}, "", "/OWA/Auth/Logon.aspx");
      page.form.action = "/OWA/Auth.owa";
      page.destination.value =
        (kind === "relative"
          ? ""
          : kind === "proxy"
            ? location.origin
            : "https://mail.example.test") + "/OWA/?ae=Folder&item=a%26b";
      Object.defineProperty(window, "__sorng_map_navigation", {
        configurable: true,
        value: (url: string) =>
          url.replace("https://mail.example.test", location.origin),
      });
      const before = page.destination.value;
      await run();
      expect(page.login).toHaveBeenCalledOnce();
      expect(page.submitted[0].destination).toBe(before);
    },
  );

  it.each(["shared@example.test", "service+invoices@example.test"])(
    "uses the primary credentials without changing delegated mailbox %s",
    async (mailbox) => {
      const page = mount();
      page.destination.value = `/owa/${mailbox}/?ae=Folder&item=a%26b`;
      const before = page.destination.value;
      await run();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(page.login).toHaveBeenCalledOnce();
      expect(page.submitted[0]).toMatchObject({
        ...credentials,
        destination: before,
      });
      expect(page.user.value).toBe(credentials.username);
    },
  );

  it.each([
    "/ecp/",
    "/owa-other/",
    "/owa/auth.owa",
    "/owa/auth/logon.aspx",
    "/owa/auth/expiredpassword.aspx",
    "/owa/../ecp/",
    "/owa/%2e%2e/ecp/",
    "/owa//mail",
    "/owa/#fragment",
    "",
    "https://other.example.test/owa/",
    "//other.example.test/owa/",
    "https://user:secret@mail.example.test/owa/",
  ])(
    "refuses unsafe or non-mailbox return %s before disclosure",
    async (value) => {
      const page = mount();
      page.destination.value = value;
      await run();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.login).not.toHaveBeenCalled();
      expect(page.user.value + page.pw.value).toBe("");
    },
  );

  it.each([
    "mfa",
    "expired",
    "adfs",
    "error",
    "reason",
    "missing-handler",
    "duplicate",
    "get",
    "foreign-action",
    "top-target",
  ])("leaves %s interactive without credentials", async (kind) => {
    const page = mount();
    if (kind === "mfa")
      page.form.insertAdjacentHTML(
        "beforeend",
        '<input autocomplete="one-time-code">',
      );
    else if (kind === "expired")
      window.history.replaceState({}, "", "/owa/auth/expiredpassword.aspx");
    else if (kind === "adfs") window.history.replaceState({}, "", "/adfs/ls/");
    else if (kind === "reason")
      window.history.replaceState({}, "", entry + "&reason=2");
    else if (kind === "error")
      document.querySelector(".signInError")!.textContent = "Invalid password";
    else if (kind === "missing-handler") page.button.onclick = null;
    else if (kind === "duplicate")
      page.form.appendChild(page.destination.cloneNode(true));
    else if (kind === "get") page.form.method = "get";
    else if (kind === "foreign-action")
      page.form.action = "https://other.example.test/owa/auth.owa";
    else page.form.target = "_top";
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.login).not.toHaveBeenCalled();
  });

  it.each(["destination", "handler", "password-type"])(
    "aborts %s mutation before writing the password",
    async (kind) => {
      const page = mount();
      page.user.addEventListener("input", () => {
        if (kind === "destination") page.destination.value = "/owa/?changed=1";
        else if (kind === "handler") page.button.onclick = vi.fn();
        else page.pw.type = "text";
      });
      await run();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(page.pw.value).toBe("");
      expect(page.login).not.toHaveBeenCalled();
    },
  );

  it("cancels before a delayed form appears without redeeming a nonce", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(100);
    window.dispatchEvent(new Event("pagehide"));
    const page = mount();
    await vi.advanceTimersByTimeAsync(9000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.login).not.toHaveBeenCalled();
  });
});
