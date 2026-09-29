import { readFileSync } from "node:fs";
import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCredentialTyping,
  type CaptureCredentialTarget,
} from "../../src/hooks/security/useCredentialTyping";
import { captureCredentialFocus } from "../../src/utils/security/credentialTyping";
import {
  WebAutomationBridge,
  type WebAutomationContext,
} from "../../src/utils/recording/webAutomationBridge";

// Execute the shared page client read-only, including its real focus listeners.
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_automation_client.js",
  "utf8",
);
function Popup({
  capture,
  disclose,
}: {
  capture: CaptureCredentialTarget;
  disclose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const typing = useCredentialTyping(open, capture);
  return (
    <>
      <iframe title="Session" />
      <input aria-label="Unrelated app input" />
      <button
        onPointerDown={typing.onPointerDown}
        onClick={() => setOpen(!open)}
      >
        Credentials
      </button>
      {open && (
        <div ref={typing.popupRef}>
          <button
            disabled={!typing.target}
            onClick={() => {
              void typing.target?.type("test-password", disclose).then(
                () => setStatus("Typed"),
                () => setStatus("Refused"),
              );
            }}
          >
            Type password
          </button>
          <button onClick={() => setOpen(false)}>Close</button>
          <output>{status}</output>
        </div>
      )}
    </>
  );
}

let bridge: WebAutomationBridge;
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  bridge?.cancel();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  let locked = false;
  const capture: CaptureCredentialTarget = async (contains) => {
    const focus = captureCredentialFocus(iframe, contains);
    try {
      const target = await bridge.captureCredentialTarget("session");
      return {
        sessionId: target.sessionId,
        assertCurrent: () => {
          focus.assertCurrent();
          target.assertCurrent();
        },
        dispose: () => {
          focus.dispose();
          target.dispose();
        },
        type: (value, assertDisclosure) => {
          focus.assertCurrent();
          return target.type(value, assertDisclosure);
        },
      };
    } catch (error) {
      focus.dispose();
      throw error;
    }
  };
  render(
    <Popup
      capture={capture}
      disclose={() => {
        if (locked) throw new Error("Database locked");
      }}
    />,
  );
  const iframe = screen.getByTitle("Session") as HTMLIFrameElement;
  const child = iframe.contentWindow! as Window & typeof globalThis;
  const url = new URL("http://127.0.0.1:43001/signin");
  const context: WebAutomationContext = {
    frame: child,
    document: {
      generation: 1,
      sessionId: "proxy",
      token: "d".repeat(32),
      sequence: 1,
      navigationToken: null,
      url: url.href,
    },
  };
  bridge = new WebAutomationBridge(() => context);
  const reports: unknown[] = [];
  let replyOrigin = url.origin;
  const parentWindow = {
    postMessage: (data: unknown) => {
      reports.push(data);
      queueMicrotask(() =>
        bridge.handleMessage(
          new MessageEvent("message", {
            data,
            source: child,
            origin: replyOrigin,
          }),
        ),
      );
    },
  } as unknown as Window;
  Object.defineProperty(child, "parent", {
    configurable: true,
    value: parentWindow,
  });
  const post = vi.spyOn(child, "postMessage").mockImplementation((data) => {
    queueMicrotask(() =>
      child.dispatchEvent(
        new child.MessageEvent("message", {
          data,
          source: parentWindow,
          origin: window.location.origin,
        }),
      ),
    );
  });
  child.document.body.innerHTML =
    '<form><input type="password" /><input id="other" /><button>Submit</button></form>';
  vi.spyOn(child.HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  const globals = {
    window: child,
    document: child.document,
    location: url,
    getComputedStyle: child.getComputedStyle.bind(child),
    HTMLInputElement: child.HTMLInputElement,
    HTMLTextAreaElement: child.HTMLTextAreaElement,
    HTMLElement: child.HTMLElement,
    Event: child.Event,
    p: {
      sessionId: "proxy",
      documentToken: context.document.token,
      documentSequence: 1,
      navigationToken: null,
    },
    u: url,
  };
  new Function(...Object.keys(globals), source)(...Object.values(globals));
  const watching = bridge.watchCredentialFocus();
  void watching.catch(() => {});
  await act(async () => {});
  expect(reports).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "ok" })]),
  );
  await watching;
  const field = child.document.querySelector("input")!;
  const submit = vi.fn();
  child.document.querySelector("form")!.addEventListener("submit", submit);
  return {
    field,
    child,
    context,
    post,
    reports,
    submit,
    lock: () => {
      locked = true;
    },
    wrongOrigin: () => {
      replyOrigin = "https://untrusted.test";
    },
  };
}

async function openPopup(field: HTMLInputElement) {
  // Model clicking back into the browsing context; jsdom does not restore
  // ancestor focus when focus() is called on an already-active child field.
  (screen.getByTitle("Session") as HTMLIFrameElement).focus();
  field.focus();
  await act(async () => {});
  expect(document.activeElement).toBe(screen.getByTitle("Session"));
  const trigger = screen.getByRole("button", { name: "Credentials" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  await act(async () => {});
  return screen.getByRole("button", { name: "Type password" });
}

describe("real page focus -> credential popup -> Type", () => {
  it("keeps the exact field through popup focus and repeated readiness effects", async () => {
    const fixture = await setup();
    const button = await openPopup(fixture.field);
    expect(button).toBeEnabled();
    // useWebBrowser may re-run its readiness effect while the popup is open.
    await bridge.watchCredentialFocus();
    button.focus();
    fireEvent.click(button);
    await act(async () => {});
    expect(fixture.field.value).toBe("test-password");
    expect(screen.getByText("Typed")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.reports)).not.toContain("test-password");
  });
  it.each([
    "generation",
    "lock",
    "replacement",
    "other-field",
    "other-app-input",
    "cancel",
  ])("refuses %s between open and Type", async (reason) => {
    const fixture = await setup();
    const button = await openPopup(fixture.field);
    expect(button).toBeEnabled();
    if (reason === "generation") fixture.context.document.generation++;
    if (reason === "lock") fixture.lock();
    if (reason === "replacement")
      fixture.field.replaceWith(fixture.field.cloneNode());
    if (reason === "other-field")
      fixture.child.document.querySelector<HTMLInputElement>("#other")!.focus();
    if (reason === "other-app-input") screen.getByRole("textbox").focus();
    if (reason === "cancel") bridge.cancel();
    await act(async () => {});
    button.focus();
    fireEvent.click(button);
    await act(async () => {});
    expect(screen.getByText("Refused")).toBeInTheDocument();
    expect(fixture.field.value).toBe("");
    expect(
      fixture.child.document.querySelector<HTMLInputElement>("#other")!.value,
    ).toBe("");
    expect(fixture.submit).not.toHaveBeenCalled();
  });
  it("never enables typing from a focus report with the wrong origin", async () => {
    const fixture = await setup();
    fixture.wrongOrigin();
    const button = await openPopup(fixture.field);
    expect(button).toBeDisabled();
    expect(
      fixture.post.mock.calls.some(
        ([message]) => message.action === "credentialType",
      ),
    ).toBe(false);
  });
  it("keeps observing focus after a different automation bridge cancels its work", async () => {
    const fixture = await setup();
    const otherBridge = new WebAutomationBridge(() => fixture.context);
    otherBridge.cancel();
    await act(async () => {});
    const button = await openPopup(fixture.field);
    expect(button).toBeEnabled();
    button.focus();
    fireEvent.click(button);
    await act(async () => {});
    expect(fixture.field.value).toBe("test-password");
  });
  it("revokes an old lease on unrelated cancellation but allows an explicit fresh capture", async () => {
    const fixture = await setup();
    const button = await openPopup(fixture.field);
    const otherBridge = new WebAutomationBridge(() => fixture.context);
    otherBridge.cancel();
    await act(async () => {});
    button.focus();
    fireEvent.click(button);
    await act(async () => {});
    expect(screen.getByText("Refused")).toBeInTheDocument();
    expect(fixture.field.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const fresh = await openPopup(fixture.field);
    expect(fresh).toBeEnabled();
    fresh.focus();
    fireEvent.click(fresh);
    await act(async () => {});
    expect(screen.getByText("Typed")).toBeInTheDocument();
    expect(fixture.field.value).toBe("test-password");
  });
});
