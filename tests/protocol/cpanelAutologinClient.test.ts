import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
const selectors = {
  username_selector: 'form#login_form input#user[name="user"]',
  password_selector: 'form#login_form input#pass[name="pass"][type="password"]',
  submit_selector:
    'form#login_form button#login_submit[name="login"][type="submit"]',
};
type Result = { ok: boolean; reason: string; via?: string };
type Credentials = { username: string | null; password: string | null };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: object,
    flow: "cpanel",
  ): Promise<Result | undefined>;
  bootstrap(
    credentials: Credentials,
    selectors: object,
    options: object | undefined,
    flow: "cpanel",
  ): Promise<Result>;
  cancel(): void;
};

let client: Client;
let readyState: DocumentReadyState;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const createSubmitSpy = () => vi.fn((event: Event) => event.preventDefault());
let submit: ReturnType<typeof createSubmitSpy>;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const start = () => client.fetchCredsAndRun("nonce", selectors, "cpanel");

function installForm(disabled = false, target = "") {
  document.body.innerHTML = `<form id="login_form" action="/login/" method="post" ${target ? `target="${target}"` : ""}>
    <input id="user" name="user">
    <input id="pass" name="pass" type="password">
    <input id="session" name="session" type="hidden" value="initial-session">
    <button id="login_submit" name="login" type="submit" data-testid="login_submit" ${disabled ? "disabled" : ""}>Log in</button>
  </form>`;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  submit = createSubmitSpy();
  const form = document.querySelector("form")!;
  // cPanel attaches do_login through the form's onsubmit property once its
  // AJAX login module is ready. Auto-login must wait for that exact boundary.
  form.onsubmit = submit;
  return submit;
}

async function paint() {
  // rAF runs only callbacks queued before that frame, then yields to tasks.
  // Do not drain recursively: that hid timing bugs in the previous fixture.
  const batch = [...frames.entries()];
  for (const [id, callback] of batch) {
    if (!frames.delete(id)) continue;
    callback(performance.now());
  }
  await vi.advanceTimersByTimeAsync(1);
}

async function settle() {
  for (let i = 0; i < 20; ++i) {
    await vi.advanceTimersByTimeAsync(250);
    await paint();
  }
}

async function settleAfterReplacement() {
  for (let i = 0; i < 28; ++i) {
    await vi.advanceTimersByTimeAsync(250);
    await paint();
  }
}

async function fill() {
  for (let i = 0; i < 16 && !field("pass").value; ++i) {
    await vi.advanceTimersByTimeAsync(250);
    await paint();
  }
  expect(field("pass").value).toBe("cp-secret");
  expect(submit).not.toHaveBeenCalled();
}

describe("cPanel auto-login readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    readyState = "complete";
    frames = new Map();
    frameId = 0;
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: "cp-user", password: "cp-secret" }),
      }),
    );
    window.eval(source);
    client = (window as unknown as { __sorng_autologin: Client })
      .__sorng_autologin;
  });

  afterEach(() => {
    client.cancel();
    window.removeEventListener("pagehide", client.cancel);
    window.removeEventListener("unload", client.cancel);
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    for (const name of [
      "login_form",
      "login_username_el",
      "login_password_el",
      "login_submit_el",
      "login_button",
      "LOGIN_SUBMIT_OK",
    ])
      Reflect.deleteProperty(window, name);
    Reflect.deleteProperty(document, "readyState");
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for page load and late load-handler hydration before filling and submitting", async () => {
    readyState = "interactive";
    const initial = installForm();
    const pending = start();
    await settle();
    expect(field("pass").value).toBe("");
    expect(initial).not.toHaveBeenCalled();
    readyState = "complete";
    document.dispatchEvent(new Event("readystatechange"));
    setTimeout(() => installForm(), 180);
    await vi.advanceTimersByTimeAsync(200);
    await paint();
    expect(field("pass").value).toBe("");
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(initial).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("lets a stable cPanel page sit for three seconds before filling", async () => {
    installForm();
    const pending = start();

    await vi.advanceTimersByTimeAsync(2999);
    await paint();
    expect(field("user").value).toBe("");
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await paint();
    expect(field("user").value).toBe("cp-user");
    expect(field("pass").value).toBe("cp-secret");
    expect(submit).not.toHaveBeenCalled();

    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("rebinds cPanel's cached controls before its stock AJAX login runs", async () => {
    installForm(false, "_top");
    const staleForm = document.createElement("form");
    const staleUser = document.createElement("input");
    const stalePassword = document.createElement("input");
    const staleSubmit = document.createElement("button");
    Object.assign(window, {
      login_form: staleForm,
      login_username_el: staleUser,
      login_password_el: stalePassword,
      login_submit_el: staleSubmit,
      login_button: { button: staleSubmit },
      LOGIN_SUBMIT_OK: false,
    });
    let submittedTarget = "";
    let submittedBody: URLSearchParams | undefined;
    let submittedUrl = "";
    let submittedContentType = "";
    let submittedMethod = "";
    let sentBody = "";
    const routedAction = `${window.location.origin}/login/?__sorng_generation_v1=document-token`;
    const routeForm = (event: Event) => {
      (event.target as HTMLFormElement).setAttribute("action", routedAction);
    };
    document.addEventListener("submit", routeForm, true);
    document.querySelector("form")!.setAttribute("action", routedAction);
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open(method: string, url: string) {
          submittedMethod = method;
          submittedUrl = url;
        }
        setRequestHeader(name: string, value: string) {
          if (name.toLowerCase() === "content-type")
            submittedContentType = value;
        }
        send(body: string) {
          sentBody = body;
        }
      },
    );
    const stockButtonClick = vi.fn();
    field("login_submit").addEventListener("click", stockButtonClick);
    const stockAjaxSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
      const cpanelWindow = window as typeof window & {
        login_form: HTMLFormElement;
        login_username_el: HTMLInputElement;
        login_password_el: HTMLInputElement;
        LOGIN_SUBMIT_OK: boolean;
      };
      if (!cpanelWindow.LOGIN_SUBMIT_OK) return;
      cpanelWindow.LOGIN_SUBMIT_OK = false;
      submittedTarget = cpanelWindow.login_form.target;
      submittedBody = new URLSearchParams({
        user: cpanelWindow.login_username_el.value,
        pass: cpanelWindow.login_password_el.value,
      });
      submittedUrl = cpanelWindow.login_form.action + "?login_only=1";
      const xhr = new XMLHttpRequest();
      xhr.open("POST", submittedUrl, true);
      xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      xhr.send(submittedBody.toString());
    });
    document.querySelector("form")!.onsubmit = stockAjaxSubmit;

    const pending = start();
    await settle();
    document.removeEventListener("submit", routeForm, true);

    await expect(pending).resolves.toMatchObject({
      reason: "submitted",
      via: "cpanel-ajax-button-click",
    });
    expect(submittedTarget).toBe("_self");
    expect(submittedBody?.get("user")).toBe("cp-user");
    expect(submittedBody?.get("pass")).toBe("cp-secret");
    expect(stockAjaxSubmit).toHaveBeenCalledOnce();
    expect(stockButtonClick).toHaveBeenCalledOnce();
    expect(new URL(submittedUrl).pathname).toBe("/login/");
    expect(new URL(submittedUrl).search).toBe("?login_only=1");
    expect(submittedMethod).toBe("POST");
    expect(submittedContentType).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(sentBody).get("user")).toBe("cp-user");
    expect(new URLSearchParams(sentBody).get("pass")).toBe("cp-secret");
    expect((window as any).login_form).toBe(document.querySelector("form"));
    expect((window as any).login_username_el).toBe(field("user"));
    expect((window as any).login_password_el).toBe(field("pass"));
    expect((window as any).login_button.button).toBe(field("login_submit"));
    expect((window as any).LOGIN_SUBMIT_OK).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("continues a successful cPanel AJAX login in the same proxied tab", async () => {
    installForm(false, "_top");
    let requestUrl = "";
    let navigationUrl = "";
    let navigationTarget = "";
    let stockSuccessHandlerRan = false;
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends EventTarget {
        readyState = 0;
        status = 0;
        responseText = "";
        responseType = "";
        response = null;
        onreadystatechange: ((event: Event) => unknown) | null = null;
        open(_method: string, url: string) {
          requestUrl = url;
        }
        setRequestHeader() {}
        send() {
          this.readyState = 4;
          this.status = 200;
          this.responseText = JSON.stringify({
            status: 1,
            security_token: "/cpsess1234567890",
            redirect:
              "/cpsess1234567890/frontend/jupiter/index.html?login=1&post_login=42",
          });
          this.onreadystatechange?.(new Event("readystatechange"));
        }
      },
    );
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(
      function () {
        const query = new URLSearchParams(
          Array.from(new FormData(this).entries()).map(([name, value]) => [
            name,
            String(value),
          ]),
        );
        const encoded = query.toString();
        navigationUrl = `${this.action}${encoded ? `?${encoded}` : ""}`;
        navigationTarget = this.target;
      },
    );
    document.querySelector("form")!.onsubmit = (event) => {
      event.preventDefault();
      const action = (event.currentTarget as HTMLFormElement).action;
      // Custom cPanel themes may queue their login request after submit returns.
      setTimeout(() => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${action}?login_only=1`);
        xhr.onreadystatechange = () => {
          stockSuccessHandlerRan = true;
          throw new DOMException(
            "Blocked cross-origin top navigation",
            "SecurityError",
          );
        };
        xhr.setRequestHeader(
          "Content-Type",
          "application/x-www-form-urlencoded",
        );
        xhr.send("user=cp-user&pass=cp-secret");
      }, 100);
      return false;
    };

    const pending = start();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await paint();

    await expect(pending).resolves.toMatchObject({
      reason: "submitted",
      via: "cpanel-ajax-button-click",
    });
    expect(new URL(requestUrl).search).toBe("?login_only=1");
    expect(new URL(navigationUrl).pathname).toBe(
      "/cpsess1234567890/frontend/jupiter/index.html",
    );
    expect(new URL(navigationUrl).search).toBe("?login=1&post_login=42");
    expect(navigationTarget).toBe("_self");
    expect(stockSuccessHandlerRan).toBe(false);
    expect(document.querySelector("form[action*='cpsess']")).toBeNull();
  });

  it("waits for cPanel's AJAX handler instead of falling through to native login", async () => {
    installForm();
    const form = document.querySelector("form")!;
    form.onsubmit = null;
    const buttonClick = vi.spyOn(field("login_submit"), "click");
    let wasCancelledBeforeHandler = true;

    const pending = start();
    await settle();
    expect(field("user").value).toBe("");
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    expect(buttonClick).not.toHaveBeenCalled();

    const stockAjaxSubmit = vi.fn((event: SubmitEvent) => {
      wasCancelledBeforeHandler = event.defaultPrevented;
      return true;
    });
    form.onsubmit = stockAjaxSubmit;
    await settle();

    await expect(pending).resolves.toMatchObject({
      reason: "submitted",
      via: "cpanel-ajax-button-click",
    });
    expect(wasCancelledBeforeHandler).toBe(false);
    expect(stockAjaxSubmit).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(buttonClick).toHaveBeenCalledOnce();
  });

  it("does not fill or submit while cPanel disables its login control", async () => {
    installForm(true);
    const pending = start();
    await settle();
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    field("login_submit").disabled = false;
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each(["aria-busy", "inert", "aria-disabled"])(
    "waits for the form's ancestor %s readiness signal",
    async (attribute) => {
      installForm();
      document.body.setAttribute(attribute, "true");
      const pending = start();
      await settle();
      expect(field("pass").value).toBe("");
      document.body.removeAttribute(attribute);
      await settle();
      await expect(pending).resolves.toMatchObject({ reason: "submitted" });
      expect(submit).toHaveBeenCalledOnce();
    },
  );

  it("debounces continuing form hydration instead of counting two frames", async () => {
    installForm();
    const pending = start();
    for (let i = 0; i < 8; ++i) {
      await vi.advanceTimersByTimeAsync(100);
      field("session").setAttribute("value", `session-${i}`);
      await paint();
      expect(field("pass").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    }
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(field("session").value).toBe("session-7");
  });

  it("reacquires a form replaced after filling without submitting stale controls", async () => {
    const oldSubmit = installForm();
    const pending = start();
    await fill();
    const oldPassword = field("pass");
    installForm();
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(oldPassword.isConnected).toBe(false);
    expect(oldSubmit).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(field("user").value).toBe("cp-user");
    expect(field("pass").value).toBe("cp-secret");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("recovers from a synchronous input handler replacing the form", async () => {
    const oldSubmit = installForm();
    field("user").addEventListener("input", () => installForm(), {
      once: true,
    });
    const pending = start();
    await settleAfterReplacement();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(oldSubmit).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("re-fills values reset by late hydration before the only submit", async () => {
    installForm();
    const pending = start();
    await fill();
    setTimeout(() => {
      field("user").value = "";
      field("pass").value = "";
    }, 150);
    await settleAfterReplacement();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(field("user").value).toBe("cp-user");
    expect(field("pass").value).toBe("cp-secret");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("waits through validation disabling controls after an input event", async () => {
    installForm();
    field("pass").addEventListener(
      "input",
      () => {
        field("login_submit").disabled = true;
        setTimeout(() => {
          field("login_submit").disabled = false;
        }, 600);
      },
      { once: true },
    );
    const pending = start();
    await vi.advanceTimersByTimeAsync(250);
    await paint();
    await vi.advanceTimersByTimeAsync(400);
    await paint();
    expect(submit).not.toHaveBeenCalled();
    await settleAfterReplacement();
    await vi.advanceTimersByTimeAsync(1000);
    await paint();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("lets asynchronous field handlers settle and retains their hidden session value", async () => {
    installForm();
    const observed = { username: "", password: "" };
    field("user").addEventListener("input", () => {
      setTimeout(() => {
        observed.username = field("user").value;
      }, 150);
    });
    field("pass").addEventListener("input", () => {
      document.querySelector("form")!.setAttribute("aria-busy", "true");
      setTimeout(() => {
        observed.password = field("pass").value;
        field("session").value = "hydrated-session";
        document.querySelector("form")!.removeAttribute("aria-busy");
      }, 400);
    });
    let submittedState: typeof observed | undefined;
    let session: string | undefined;
    document.querySelector("form")!.onsubmit = (event) => {
      submittedState = { ...observed };
      session = field("session").value;
      return submit(event);
    };
    const pending = start();
    await settleAfterReplacement();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submittedState).toEqual({
      username: "cp-user",
      password: "cp-secret",
    });
    expect(session).toBe("hydrated-session");
  });

  it("invalidates queued submission if the form changes at the paint boundary", async () => {
    installForm();
    const pending = start();
    await fill();
    await vi.advanceTimersByTimeAsync(1000);
    expect(frames.size).toBe(1);
    const [id, callback] = [...frames.entries()][0];
    frames.delete(id);
    callback(performance.now());
    field("session").setAttribute("value", "fresh-session");
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).not.toHaveBeenCalled();
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("enforces the cPanel settling floor and honors the configured submit delay", async () => {
    installForm();
    const pending = client.bootstrap(
      { username: "cp-user", password: "cp-secret" },
      { username: "#user", password: "#pass", submit: "#login_submit" },
      {
        version: 1,
        fillDelayMs: 700,
        submitDelayMs: 1200,
        detectionTimeoutMs: 8000,
        fields: [],
        submit: true,
      },
      "cpanel",
    );
    await fill();
    await vi.advanceTimersByTimeAsync(1198);
    await paint();
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await paint();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
  });

  it.each(["https://other.example/collect", "/different-login/"])(
    "does not reacquire a form with changed action %s",
    async (action) => {
      installForm();
      const pending = start();
      await fill();
      document.querySelector("form")!.action = action;
      await settle();
      await expect(pending).resolves.toMatchObject({
        ok: false,
        reason: "form-changed-or-unsafe",
      });
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("does not resubmit a rejected login even when cPanel shows the form again", async () => {
    const attempted = installForm();
    document.querySelector("form")!.onsubmit = (event) => {
      attempted(event);
      installForm();
      return false;
    };
    const pending = start();
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    await settle();
    expect(attempted).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(field("pass").value).toBe("");
  });

  it.each(["cancel", "pagehide", "unload"])(
    "cancels queued cPanel work and clears credentials on %s",
    async (event) => {
      installForm();
      const credentials = { username: "cp-user", password: "cp-secret" };
      const pending = client.bootstrap(
        credentials,
        { username: "#user", password: "#pass", submit: "#login_submit" },
        undefined,
        "cpanel",
      );
      await vi.advanceTimersByTimeAsync(250);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      if (event === "cancel") client.cancel();
      else window.dispatchEvent(new Event(event));
      await expect(pending).resolves.toMatchObject({ reason: "cancelled" });
      expect(credentials).toEqual({ username: null, password: null });
      expect(frames.size).toBe(0);
      // jsdom queues delivery of the final diagnostic postMessage as a task.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      field("session").setAttribute("value", "late");
      await settle();
      expect(field("pass").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("bounds continuous hydration by the original timeout", async () => {
    installForm();
    const pending = start();
    const activity = setInterval(
      () => field("session").setAttribute("value", String(Date.now())),
      100,
    );
    await vi.advanceTimersByTimeAsync(12000);
    await expect(pending).resolves.toMatchObject({
      reason: "form-not-found-timeout",
    });
    clearInterval(activity);
    await settle();
    expect(submit).not.toHaveBeenCalled();
    expect(field("pass").value).toBe("");
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps readiness checks when requestAnimationFrame is unavailable", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    installForm();
    const pending = start();
    await vi.advanceTimersByTimeAsync(200);
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("keeps fill-only mode and clears its private credentials", async () => {
    installForm();
    const credentials = { username: "cp-user", password: "cp-secret" };
    const pending = client.bootstrap(
      credentials,
      { username: "#user", password: "#pass", submit: "#login_submit" },
      {
        version: 1,
        fillDelayMs: 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 8000,
        fields: [],
        submit: false,
      },
      "cpanel",
    );
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "filled-only" });
    expect(field("pass").value).toBe("cp-secret");
    expect(submit).not.toHaveBeenCalled();
    expect(credentials).toEqual({ username: null, password: null });
    expect(frames.size).toBe(0);
  });

  it("stops before writing the password if an input handler changes the action", async () => {
    installForm();
    field("user").addEventListener("input", () => {
      document.querySelector("form")!.action = "https://other.example/collect";
    });
    const pending = start();
    await settle();
    await expect(pending).resolves.toMatchObject({
      reason: "form-changed-or-unsafe",
    });
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit while the form is busy even after credentials have settled", async () => {
    installForm();
    const pending = start();
    await fill();
    document.querySelector("form")!.setAttribute("aria-busy", "true");
    await settle();
    expect(submit).not.toHaveBeenCalled();
    document.querySelector("form")!.removeAttribute("aria-busy");
    await settle();
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not let unrelated page animations starve login readiness", async () => {
    installForm();
    const clock = document.createElement("span");
    document.body.appendChild(clock);
    const animation = setInterval(() => {
      clock.textContent = String(Date.now());
    }, 50);
    const pending = start();
    await settle();
    clearInterval(animation);
    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });
});
