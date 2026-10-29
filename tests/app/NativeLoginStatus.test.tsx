import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { NativeLoginStatus } from "../../src/components/app/NativeLoginStatus";
import { nativeLoginAdapterStopReasonCodes } from "../../src/hooks/protocol/useNativeLoginActivity";
import enUS from "../../src/i18n/locales/en-US.json";

const events = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: events.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, listener) => {
    events.listener = listener;
    return events.stop;
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      values?: { count?: number; seconds?: number },
    ) =>
      fallback
        .replace("{{count}}", String(values?.count))
        .replace("{{seconds}}", String(values?.seconds)),
  }),
}));

const connections = [
  {
    id: "c1",
    httpApplication: { version: 1, id: "portainer", loginMode: "form" },
  },
  {
    id: "c2",
    httpApplication: { version: 1, id: "grafana", loginMode: "form" },
  },
] as Connection[];
const sessions = [
  { id: "s1", connectionId: "c1", ownerDatabaseId: "db" },
  { id: "s2", connectionId: "c2", ownerDatabaseId: "db" },
] as ConnectionSession[];
const emit = (
  sessionId: string,
  connectionId: string,
  stage: string,
  timestampMs = 100,
  extra: Record<string, unknown> = {},
) =>
  act(() =>
    events.listener?.({
      payload: {
        sessionId,
        connectionId,
        stage,
        timestampMs,
        elapsedMs: 2500,
        attemptId: `a-${sessionId}`,
        ...extra,
      },
    }),
  );
beforeEach(() => {
  events.listener = undefined;
  events.stop.mockClear();
  events.invoke.mockReset().mockResolvedValue(true);
});
describe("active native login status", () => {
  it("clears its elapsed display timer when the attempt completes and on unmount", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const view = render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "waiting-page");
    const runningTimer =
      interval.mock.results[interval.mock.results.length - 1].value;
    emit("s1", "c1", "completed", 200);
    expect(clear).toHaveBeenCalledWith(runningTimer);
    emit("s1", "c1", "waiting-2fa", 300);
    const resumedTimer =
      interval.mock.results[interval.mock.results.length - 1].value;
    view.unmount();
    expect(clear).toHaveBeenCalledWith(resumedTimer);
    interval.mockRestore();
    clear.mockRestore();
  });
  it("offers actual attempt cancellation in running details while Close only dismisses the popup", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "waiting-page");
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(events.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel automatic login" }),
    );
    await waitFor(() =>
      expect(events.invoke).toHaveBeenCalledWith(
        "origin_browser_cancel_login",
        {
          request: {
            identity: {
              ownerDatabaseId: "db",
              connectionId: "c1",
              sessionId: "s1",
              attemptId: "a-s1",
            },
            reason: "user-cancelled",
          },
        },
      ),
    );
    emit("s1", "c1", "cancelled", 200, { reasonCode: "user-cancelled" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You cancelled this automatic-login attempt",
    );
    expect(
      screen.queryByRole("button", { name: "Cancel automatic login" }),
    ).toBeNull();
  });
  it("explains the native 3600-second expiry and never retries it", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "cancelled", 100, {
      reasonCode: "attempt-timeout",
      elapsedMs: 3600000,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "expired after 3600 seconds",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "will not retry automatically",
    );
    expect(events.invoke).not.toHaveBeenCalled();
  });
  it("focuses the Close action and restores the details trigger on keyboard dismissal", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "cancelled", 100);
    const trigger = screen.getByRole("button", {
      name: "Portainer: Login cancelled",
    });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close" })).toHaveFocus(),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Portainer: Login cancelled",
    );
  });
  it("keeps the concrete native cause across generic rejection and stop events, but clears it when a fresh step resumes", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "filling-password", 100);
    emit("s1", "c1", "cancelled", 200, {
      reasonCode: "navigation-scope-rejected",
    });
    emit("s1", "c1", "cancelled", 300, { reasonCode: "adapter-rejected" });
    emit("s1", "c1", "stopped", 400, { reasonCode: "attempt-stopped" });
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "outside the approved saved-login navigation scope",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Last reported step: Typing password",
    );
    emit("s1", "c1", "waiting-page", 500);
    emit("s1", "c1", "cancelled", 600);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "No specific cancellation reason was reported",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Last reported step: Waiting for page",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "approved saved-login navigation scope",
    );
  });
  it.each([
    [
      "cancelled",
      "current-context-rejected",
      /page, login step or browser context no longer matched/,
    ],
    [
      "cancelled",
      "navigation-scope-rejected",
      /outside the approved saved-login navigation scope/,
    ],
    ["cancelled", "adapter-rejected", /did not report a more specific cause/],
    [
      "stopped",
      "challenge-timeout",
      /security-check wait reached its time limit/,
    ],
    ["held", "grant-rejected", /did not authorize credential delivery/],
    ["held", "address-mismatch", /not one of this connection's saved login/],
    ["held", "consent-expired", /automatic-login permission had expired/],
    // The page adapter's own fixed stop causes.
    [
      "held",
      "verification-required",
      /verification check, such as a CAPTCHA, that automatic login never answers/,
    ],
    [
      "stopped",
      "credentials-rejected",
      /showed an error after the login was submitted/,
    ],
    [
      "cancelled",
      "focus-unavailable",
      /Another text field kept the keyboard focus/,
    ],
    [
      "cancelled",
      "user-input",
      /you typed or clicked in the page while it was running/,
    ],
    [
      "cancelled",
      "page-changed",
      /login page changed while automatic login was running/,
    ],
    ["cancelled", "field-not-empty", /A login field already contained a value/],
    [
      "cancelled",
      "submit-unavailable",
      /sign-in button never became available/,
    ],
    [
      "cancelled",
      "step-not-found",
      /next sign-in step, such as the password page after the email/,
    ],
    ["cancelled", "expired", /ran out of time for this step/],
  ])(
    "explains %s/%s with the actual prior checkpoint and a usable Close action",
    async (stage, reasonCode, expected) => {
      render(
        <NativeLoginStatus
          connections={connections}
          sessions={sessions}
          activeSessionId="s1"
        />,
      );
      await waitFor(() => expect(events.listener).toBeDefined());
      emit("s1", "c1", "filling-password", 100);
      emit("s1", "c1", stage, 200, { reasonCode, elapsedMs: 79_000 });
      fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
      const dialog = screen.getByRole("dialog", {
        name: "Automatic login details",
      });
      expect(dialog).toHaveTextContent(expected);
      expect(dialog).toHaveTextContent("Last reported step: Typing password");
      expect(dialog).toHaveTextContent("Elapsed: 79 s");
      const close = screen.getByRole("button", { name: "Close" });
      expect(close).toHaveClass("sor-btn", "sor-btn-primary", "min-w-24");
      fireEvent.click(close);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent(/^Portainer:/);
      fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
      expect(screen.getByRole("dialog")).toHaveTextContent(expected);
    },
  );
  it.each([...nativeLoginAdapterStopReasonCodes])(
    "shows the en-US catalog message for the %s stop cause",
    async (reasonCode) => {
      render(
        <NativeLoginStatus
          connections={connections}
          sessions={sessions}
          activeSessionId="s1"
        />,
      );
      await waitFor(() => expect(events.listener).toBeDefined());
      emit("s1", "c1", "filling-password", 100);
      emit("s1", "c1", "cancelled", 200, { reasonCode });
      fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
      expect(screen.getByRole("dialog")).toHaveTextContent(
        enUS.statusBar.loginReasons[reasonCode],
      );
      expect(screen.getByRole("dialog")).not.toHaveTextContent(
        "No specific cancellation reason",
      );
    },
  );
  it("keeps a native cause over a later page-adapter cause in the same failure chain, but shows a refusal reported after completion", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "filling-password", 100);
    emit("s1", "c1", "cancelled", 200, {
      reasonCode: "current-context-rejected",
    });
    emit("s1", "c1", "cancelled", 300, { reasonCode: "page-changed" });
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "page, login step or browser context no longer matched",
    );
    // A causeless report never hides the adapter's own cause either.
    emit("s1", "c1", "filling-password", 400);
    emit("s1", "c1", "cancelled", 500, { reasonCode: "focus-unavailable" });
    emit("s1", "c1", "cancelled", 600, { reasonCode: "adapter-rejected" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Another text field kept the keyboard focus",
    );
    // After a submitted login, the page's refusal is the new outcome.
    emit("s1", "c1", "completed", 700);
    emit("s1", "c1", "stopped", 800, { reasonCode: "credentials-rejected" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "showed an error after the login was submitted",
    );
  });
  it("provides an honest fallback without leaking unknown codes or inheriting another attempt's checkpoint", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "typing-code", 100);
    emit("s1", "c1", "cancelled", 200, {
      attemptId: "fresh-attempt",
      reasonCode: "PRIVATE_TOKEN",
      reason: "PRIVATE_ACCOUNT",
    });
    fireEvent.click(screen.getByRole("button", { name: /^Portainer:/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "No specific cancellation reason was reported",
    );
    expect(dialog).not.toHaveTextContent("Last reported step");
    expect(dialog).not.toHaveTextContent("PRIVATE_");
  });
  it("follows the active tab, counts concurrent activity and opens secret-free details", async () => {
    const view = render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "filling-password");
    emit("s2", "c2", "waiting-page");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Portainer: Typing password",
    );
    expect(screen.getByLabelText("2 active logins")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Portainer: Typing password" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Automatic login details" }),
    ).toHaveTextContent("Elapsed: 2 s");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    view.rerender(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s2"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Grafana: Waiting for page",
    );
  });
  it("rejects stale observations, unknown sessions and mismatched connections", async () => {
    render(
      <NativeLoginStatus
        connections={connections}
        sessions={sessions}
        activeSessionId="s1"
      />,
    );
    await waitFor(() => expect(events.listener).toBeDefined());
    emit("s1", "c1", "submitting", 200);
    emit("s1", "c1", "filling-password", 100);
    expect(screen.getByRole("status")).toHaveTextContent("Submitting login");
    emit("unknown", "c1", "filling-password", 300);
    expect(screen.getByRole("status")).toHaveTextContent("Submitting login");
    emit("s1", "c2", "filling-password", 300);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
