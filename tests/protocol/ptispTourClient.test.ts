import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve("src-tauri/crates/sorng-protocols/src/ptisp_tour_client.js"),
  "utf8",
);
const confirmation =
  '<button type="submit" class="btn btn-primary btn-md">Não mostrar todas</button>';

function mount(markup: string) {
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.append(container);
  return container;
}

function tour(onClose = () => {}) {
  const container = mount(
    '<button type="button" class="my-tour-close">Close tour</button>',
  );
  const button = container.querySelector("button")!;
  const clicked = vi.fn(onClose);
  button.addEventListener("click", clicked);
  return { container, button, clicked };
}

function dialog(markup = confirmation) {
  const container = mount(`<form>${markup}</form>`);
  const submit = vi.fn((event: Event) => event.preventDefault());
  container.querySelector("form")!.addEventListener("submit", submit);
  const button = container.querySelector("button")!;
  const clicked = vi.fn();
  button?.addEventListener("click", clicked);
  return { container, button, clicked, submit };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(100);
}

const unavailable = [
  "hidden",
  "display",
  "ancestor-display",
  "visibility",
  "opacity",
  "aria-hidden",
  "disabled",
  "fieldset",
  "aria-disabled",
  "inert",
  "no-layout",
] as const;

function makeUnavailable(
  fixture: { container: HTMLElement; button: HTMLButtonElement },
  reason: (typeof unavailable)[number],
) {
  const { container, button } = fixture;
  switch (reason) {
    case "hidden":
      container.hidden = true;
      return () => (container.hidden = false);
    case "display":
      button.style.display = "none";
      return () => (button.style.display = "");
    case "ancestor-display":
      container.style.display = "none";
      return () => (container.style.display = "");
    case "visibility":
      container.style.visibility = "hidden";
      return () => (container.style.visibility = "");
    case "opacity":
      container.style.opacity = "0";
      return () => (container.style.opacity = "");
    case "aria-hidden":
      container.setAttribute("aria-hidden", "true");
      return () => container.removeAttribute("aria-hidden");
    case "disabled":
      button.disabled = true;
      return () => (button.disabled = false);
    case "fieldset": {
      const fieldset = document.createElement("fieldset");
      fieldset.disabled = true;
      button.replaceWith(fieldset);
      fieldset.append(button);
      return () => (fieldset.disabled = false);
    }
    case "aria-disabled":
      container.setAttribute("aria-disabled", "true");
      return () => container.removeAttribute("aria-disabled");
    case "inert":
      container.setAttribute("inert", "");
      return () => container.removeAttribute("inert");
    case "no-layout":
      button.setAttribute("data-no-layout", "");
      return () => {
        button.removeAttribute("data-no-layout");
        window.dispatchEvent(new Event("resize"));
      };
  }
}

describe("PTisp tour readiness helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    // jsdom has no layout. Supply geometry; visibility/disabled semantics are
    // still evaluated against the actual DOM and computed styles by the helper.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      function (this: HTMLElement) {
        return (this.hasAttribute("data-no-layout")
          ? []
          : [{ width: 80, height: 24 }]) as unknown as DOMRectList;
      },
    );
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(XMLHttpRequest.prototype, "open");
    vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    Reflect.deleteProperty(window, "__sorng_ptisp_tour_v1");
    Reflect.deleteProperty(document, "readyState");
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses the site's close, click and form handlers once, including synchronous confirmation", async () => {
    let shown!: ReturnType<typeof dialog>;
    const close = tour(() => (shown = dialog()));
    window.eval(source);
    await flush();
    expect(close.clicked).toHaveBeenCalledOnce();
    expect(shown.clicked).toHaveBeenCalledOnce();
    expect(shown.submit).toHaveBeenCalledOnce();
    expect(close.button.isConnected).toBe(true);
    expect(shown.button.isConnected).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    window.eval(source);
    const reopened = tour();
    dialog();
    await vi.advanceTimersByTimeAsync(30000);
    expect(close.clicked).toHaveBeenCalledOnce();
    expect(reopened.clicked).not.toHaveBeenCalled();
    expect(shown.clicked).toHaveBeenCalledOnce();
  });

  it("waits across manual SPA login without touching credentials or needing an auto-login client", async () => {
    const login = mount('<input type="password" value="fixture-secret">');
    window.eval(source);
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
    const close = tour(() => dialog());
    await flush();
    expect(close.clicked).toHaveBeenCalledOnce();
    expect(login.querySelector("input")!.value).toBe("fixture-secret");
    expect(Reflect.get(window, "__sorng_autologin")).toBeUndefined();
  });

  it("waits for DOM readiness so page handlers can be installed", async () => {
    Object.defineProperty(document, "readyState", { value: "loading" });
    const close = tour(() => dialog());
    window.eval(source);
    await flush();
    expect(close.clicked).not.toHaveBeenCalled();
    Object.defineProperty(document, "readyState", { value: "interactive" });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await flush();
    expect(close.clicked).toHaveBeenCalledOnce();
  });

  it.each(unavailable)(
    "waits for a %s close control to become usable",
    async (reason) => {
      const close = tour(() => dialog());
      const reveal = makeUnavailable(close, reason);
      window.eval(source);
      await flush();
      expect(close.clicked).not.toHaveBeenCalled();
      reveal();
      await flush();
      expect(close.clicked).toHaveBeenCalledOnce();
    },
  );

  it.each(unavailable)(
    "waits for a newly appearing %s confirmation to become usable",
    async (reason) => {
      tour();
      window.eval(source);
      await flush();
      const shown = dialog();
      const reveal = makeUnavailable(shown, reason);
      await flush();
      expect(shown.clicked).not.toHaveBeenCalled();
      reveal();
      await flush();
      expect(shown.clicked).toHaveBeenCalledOnce();
      expect(shown.submit).toHaveBeenCalledOnce();
    },
  );

  it("allows a previously hidden confirmation revealed by our close", async () => {
    const shown = dialog();
    shown.container.hidden = true;
    tour(() => (shown.container.hidden = false));
    window.eval(source);
    await flush();
    expect(shown.submit).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "excludes matching buttons already visible before close (disabled=%s)",
    async (disabled) => {
      const old = dialog();
      old.button.disabled = disabled;
      tour(() => (old.button.disabled = false));
      window.eval(source);
      await flush();
      old.container.hidden = true;
      await flush();
      old.container.hidden = false;
      const shown = dialog();
      await flush();
      expect(old.clicked).not.toHaveBeenCalled();
      expect(shown.clicked).toHaveBeenCalledOnce();
    },
  );

  it.each([
    '<button type="submit" class="btn btn-primary btn-md">Não mostrar</button>',
    '<button type="submit" class="btn btn-primary btn-md">Não mostrar todas agora</button>',
    '<button type="submit" class="btn btn-primary btn-md">Cancelar</button>',
    '<button type="submit" class="btn btn-primary">Não mostrar todas</button>',
    '<button type="submit" class="btn btn-md">Não mostrar todas</button>',
    '<button type="submit" class="btn-primary btn-md">Não mostrar todas</button>',
    '<button type="button" class="btn btn-primary btn-md">Não mostrar todas</button>',
    '<button class="btn btn-primary btn-md">Não mostrar todas</button>',
    '<a class="btn btn-primary btn-md">Não mostrar todas</a>',
  ])("leaves wrong confirmation markup untouched: %s", async (markup) => {
    tour();
    window.eval(source);
    await flush();
    const wrong = dialog(markup);
    await vi.advanceTimersByTimeAsync(15000);
    expect(wrong.clicked).not.toHaveBeenCalled();
    expect(wrong.submit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not guess between multiple new matching confirmations", async () => {
    tour(() => {
      dialog();
      dialog();
    });
    const clicked = vi.spyOn(HTMLButtonElement.prototype, "click");
    window.eval(source);
    await vi.advanceTimersByTimeAsync(16000);
    expect(clicked).toHaveBeenCalledOnce(); // Close only.
  });

  it("expires 15 seconds after close, without retries or later confirmation/reopening clicks", async () => {
    const close = tour();
    window.eval(source);
    await vi.advanceTimersByTimeAsync(15050);
    expect(close.clicked).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const late = dialog();
    const reopened = tour();
    await flush();
    expect(late.clicked).not.toHaveBeenCalled();
    expect(reopened.clicked).not.toHaveBeenCalled();
  });

  it("accepts a delayed confirmation just before the deadline", async () => {
    tour();
    window.eval(source);
    await vi.advanceTimersByTimeAsync(14900);
    const shown = dialog();
    await flush();
    expect(shown.submit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never clicks confirmation before finding a usable close", async () => {
    const close = tour();
    close.button.disabled = true;
    const shown = dialog();
    window.eval(source);
    await vi.advanceTimersByTimeAsync(16000);
    expect(close.clicked).not.toHaveBeenCalled();
    expect(shown.clicked).not.toHaveBeenCalled();
  });

  it("disconnects its observer and event listeners when confirmation completes", async () => {
    tour(() => dialog());
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    window.eval(source);
    await flush();
    expect(disconnect).toHaveBeenCalledOnce();
    for (const event of [
      "click",
      "keydown",
      "transitionend",
      "animationend",
      "load",
    ])
      expect(removeDocument).toHaveBeenCalledWith(
        event,
        expect.any(Function),
        true,
      );
    for (const event of ["resize", "pagehide", "unload"])
      expect(removeWindow).toHaveBeenCalledWith(event, expect.any(Function));
    const close = tour();
    document.dispatchEvent(new Event("transitionend"));
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(close.clicked).not.toHaveBeenCalled();
  });

  it.each(["click", "Escape"])(
    "yields permanently to cancellation by %s",
    async (action) => {
      tour();
      window.eval(source);
      await flush();
      const shown = dialog();
      shown.button.disabled = true;
      await flush();
      if (action === "click") {
        mount('<button type="button">Cancelar</button>')
          .querySelector("button")!
          .click();
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      }
      shown.button.disabled = false;
      const reopened = tour();
      await flush();
      expect(shown.clicked).not.toHaveBeenCalled();
      expect(reopened.clicked).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(
    ["pagehide", "unload"].flatMap((event) => [
      { event, pendingConfirmation: false },
      { event, pendingConfirmation: true },
    ]),
  )(
    "cleans up on $event (confirmation=$pendingConfirmation)",
    async ({ event, pendingConfirmation }) => {
      if (pendingConfirmation) tour();
      window.eval(source);
      await flush();
      window.dispatchEvent(new Event(event));
      const close = tour();
      const shown = dialog();
      await flush();
      expect(close.clicked).not.toHaveBeenCalled();
      expect(shown.clicked).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("coalesces DOM mutation bursts and remains idle without polling", async () => {
    window.eval(source);
    await flush();
    const query = vi.spyOn(document, "querySelectorAll");
    for (let index = 0; index < 50; index++) {
      mount("<span>Update</span>");
      await Promise.resolve();
    }
    expect(query).not.toHaveBeenCalled();
    await flush();
    expect(query).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(query).toHaveBeenCalledOnce();
  });
});
