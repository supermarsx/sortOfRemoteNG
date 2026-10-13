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

const events = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
  stop: vi.fn(),
}));
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
  { id: "s1", connectionId: "c1" },
  { id: "s2", connectionId: "c2" },
] as ConnectionSession[];
const emit = (
  sessionId: string,
  connectionId: string,
  stage: string,
  timestampMs = 100,
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
      },
    }),
  );
beforeEach(() => {
  events.listener = undefined;
  events.stop.mockClear();
});
describe("active native login status", () => {
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
