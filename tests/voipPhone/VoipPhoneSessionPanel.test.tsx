import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastContext } from "../../src/contexts/ToastContext";
import VoipPhoneSessionPanel from "../../src/components/voipPhone/VoipPhoneSessionPanel";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { VoipPhoneStatus } from "../../src/types/voipPhone";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import type { VoipPhoneRuntimeAdapter } from "../../src/utils/session/voipPhoneRuntimeAdapter";

const dispatch = vi.fn();
const connections: Connection[] = [];
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections }, dispatch }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ): string => {
      const template = typeof fallback === "string" ? fallback : key;
      const vars = (typeof fallback === "object" ? fallback : options) ?? {};
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(vars[name] ?? ""),
      );
    },
  }),
}));

const PASSWORD = "phone-pass-sentinel";

const saved = (overrides: Partial<Connection> = {}): Connection => ({
  id: "phone-1",
  name: "Reception phone",
  protocol: "voip-phone",
  hostname: "10.0.0.50",
  port: 80,
  username: "admin",
  password: PASSWORD,
  isGroup: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  voipPhoneSettings: { vendor: "yealink" },
  ...overrides,
});

const session = (id = "sess-a"): ConnectionSession =>
  ({
    id,
    connectionId: "phone-1",
    name: "Reception phone",
    protocol: "voip-phone",
    hostname: "10.0.0.50",
    status: "disconnected",
    startTime: new Date(),
  }) as ConnectionSession;

const status = (overrides: Partial<VoipPhoneStatus> = {}): VoipPhoneStatus => ({
  vendor: "yealink",
  model: "SIP-T21P_E2",
  firmware: "52.84.0.15",
  mac: "00:15:65:AA:BB:CC",
  ip: "10.0.0.50",
  uptime: "3 days 4:12",
  generation: "servlet",
  authShape: "form-plain",
  accounts: [
    {
      index: 1,
      label: "Account 1",
      user: "201",
      server: "pbx",
      registered: true,
    },
    { index: 2, label: "Account 2", registered: false, rawState: "Disabled" },
  ],
  rawFields: {},
  ...overrides,
});

const adapter = (
  overrides: Partial<VoipPhoneRuntimeAdapter> = {},
): VoipPhoneRuntimeAdapter => ({
  protocol: "voip-phone",
  displayName: "VoIP Phone",
  buildConfig: vi.fn(),
  connect: vi.fn().mockResolvedValue({
    id: "sess-a",
    host: "10.0.0.50",
    generation: "servlet",
    authShape: "form-plain",
    webUiUrl: "http://10.0.0.50:80/",
  }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  loadStatus: vi.fn().mockResolvedValue(status()),
  reboot: vi.fn().mockResolvedValue({ method: "action-uri", accepted: true }),
  webLoginHint: vi.fn().mockResolvedValue({
    formLogin: true,
    selectors: {
      usernameSelector: "input[name=username]",
      passwordSelector: "input[name=pwd]",
      submitSelector: "#login",
    },
  }),
  ...overrides,
});

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

function renderPanel(
  runtime: VoipPhoneRuntimeAdapter,
  props: Partial<React.ComponentProps<typeof VoipPhoneSessionPanel>> = {},
) {
  return render(
    <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
      <VoipPhoneSessionPanel
        session={session()}
        onClose={vi.fn()}
        adapter={runtime}
        {...props}
      />
    </ToastContext.Provider>,
  );
}

describe("VoipPhoneSessionPanel", () => {
  beforeEach(() => {
    dispatch.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    connections.splice(0, connections.length);
    clearRuntimeConnectionsForTests();
  });
  afterEach(() => clearRuntimeConnectionsForTests());

  it("connects with the saved connection and renders status + accounts", async () => {
    const connection = saved();
    connections.push(connection);
    const runtime = adapter();
    renderPanel(runtime);

    await waitFor(() =>
      expect(runtime.connect).toHaveBeenCalledWith("sess-a", connection),
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: { id: "sess-a", status: "connected", errorMessage: undefined },
      }),
    );
    expect(await screen.findByTestId("voip-phone-accounts")).toBeTruthy();
    const statusCard = screen.getByTestId("voip-phone-status");
    expect(statusCard).toHaveTextContent("SIP-T21P_E2");
    expect(statusCard).toHaveTextContent("52.84.0.15");
    expect(statusCard).toHaveTextContent("00:15:65:AA:BB:CC");
    expect(statusCard).toHaveTextContent("3 days 4:12");
    expect(screen.getByTestId("voip-phone-generation")).toHaveTextContent(
      "servlet",
    );
    expect(screen.getByTestId("voip-phone-account-1")).toHaveTextContent(
      "Registered",
    );
    expect(screen.getByTestId("voip-phone-account-2")).toHaveTextContent(
      "Not registered (Disabled)",
    );
    expect(screen.getByTestId("voip-phone-panel").textContent).not.toContain(
      PASSWORD,
    );
  });

  it("reports validation and connect errors on the session", async () => {
    const runtime = adapter();
    const first = renderPanel(runtime);
    expect(await screen.findByTestId("voip-phone-error")).toHaveTextContent(
      "unavailable",
    );
    expect(runtime.connect).not.toHaveBeenCalled();
    first.unmount();

    connections.push(saved());
    const failing = adapter({
      connect: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
    });
    renderPanel(failing);
    expect(await screen.findByTestId("voip-phone-error")).toHaveTextContent(
      "401 Unauthorized",
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ id: "sess-a", status: "error" }),
      }),
    );
    expect(screen.getByTestId("voip-phone-reboot")).toBeDisabled();
  });

  it("refreshes status on demand", async () => {
    connections.push(saved());
    const runtime = adapter();
    renderPanel(runtime);
    await screen.findByTestId("voip-phone-status");
    expect(runtime.loadStatus).toHaveBeenCalledTimes(1);
    vi.mocked(runtime.loadStatus).mockResolvedValueOnce(
      status({ uptime: "0 days 0:01" }),
    );
    fireEvent.click(screen.getByTestId("voip-phone-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("voip-phone-status")).toHaveTextContent(
        "0 days 0:01",
      ),
    );
    expect(runtime.loadStatus).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before rebooting and toasts the method", async () => {
    connections.push(saved());
    const runtime = adapter();
    renderPanel(runtime);
    await screen.findByTestId("voip-phone-status");

    fireEvent.click(screen.getByTestId("voip-phone-reboot"));
    expect(screen.getByTestId("voip-phone-reboot-dialog")).toBeTruthy();
    expect(runtime.reboot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("voip-phone-reboot-cancel"));
    expect(screen.queryByTestId("voip-phone-reboot-dialog")).toBeNull();
    expect(runtime.reboot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("voip-phone-reboot"));
    fireEvent.click(screen.getByTestId("voip-phone-reboot-confirm"));
    await waitFor(() => expect(runtime.reboot).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Reboot requested via Action URI.",
      ),
    );

    vi.mocked(runtime.reboot).mockResolvedValueOnce({
      method: "web-form",
      accepted: false,
    });
    fireEvent.click(screen.getByTestId("voip-phone-reboot"));
    fireEvent.click(screen.getByTestId("voip-phone-reboot-confirm"));
    expect(await screen.findByTestId("voip-phone-error")).toHaveTextContent(
      "web form",
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("opens the web UI through the app connect path with a runtime http connection carrying auto-login", async () => {
    connections.push(saved());
    const runtime = adapter();
    const onOpenConnection = vi.fn().mockResolvedValue("web-session");
    renderPanel(runtime, { onOpenConnection });
    await screen.findByTestId("voip-phone-status");

    fireEvent.click(screen.getByTestId("voip-phone-open-web"));
    await waitFor(() => expect(onOpenConnection).toHaveBeenCalledTimes(1));
    expect(runtime.webLoginHint).toHaveBeenCalledWith("sess-a");
    const web = onOpenConnection.mock.calls[0][0] as Connection;
    expect(web).toMatchObject({
      protocol: "http",
      hostname: "10.0.0.50",
      port: 80,
      httpAutoLogin: true,
      httpAutoLoginSelectors: {
        usernameSelector: "input[name=username]",
        passwordSelector: "input[name=pwd]",
        submitSelector: "#login",
      },
    });
    expect(web.id).not.toBe("phone-1");
    // Registered for the proxy to resolve; never persisted.
    expect(resolveRuntimeConnection([], web.id)).toBe(web);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_SESSION" }),
    );
  });

  it("falls back to dispatching an http session without credentials", async () => {
    connections.push(
      saved({
        port: 443,
        voipPhoneSettings: { vendor: "yealink", useSsl: true },
      }),
    );
    const runtime = adapter({
      webLoginHint: vi.fn().mockResolvedValue({ formLogin: false }),
    });
    renderPanel(runtime);
    await screen.findByTestId("voip-phone-status");
    dispatch.mockClear();

    fireEvent.click(screen.getByTestId("voip-phone-open-web"));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ADD_SESSION" }),
      ),
    );
    const added = dispatch.mock.calls.find(
      ([action]) => action.type === "ADD_SESSION",
    )![0].payload as ConnectionSession;
    expect(added).toMatchObject({
      protocol: "https",
      hostname: "10.0.0.50",
      status: "connecting",
    });
    expect(JSON.stringify(added)).not.toContain(PASSWORD);
    expect("password" in added).toBe(false);
    expect("username" in added).toBe(false);
    const web = resolveRuntimeConnection([], added.connectionId)!;
    expect(web).toMatchObject({
      protocol: "https",
      authType: "basic",
      basicAuthUsername: "admin",
      basicAuthPassword: PASSWORD,
      httpAutoLogin: false,
    });
  });

  it("disconnects on close and on unmount", async () => {
    connections.push(saved());
    const runtime = adapter();
    const onClose = vi.fn();
    renderPanel(runtime, { onClose });
    await screen.findByTestId("voip-phone-status");

    fireEvent.click(screen.getByTestId("voip-phone-close"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(runtime.disconnect).toHaveBeenCalledWith("sess-a");
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: {
        id: "sess-a",
        status: "disconnected",
        errorMessage: undefined,
      },
    });
  });

  it("resolves runtime (unsaved) connections too", async () => {
    registerRuntimeConnection(saved({ id: "runtime-1" }));
    const runtime = adapter();
    render(
      <VoipPhoneSessionPanel
        session={{ ...session(), connectionId: "runtime-1" }}
        adapter={runtime}
      />,
    );
    await waitFor(() => expect(runtime.connect).toHaveBeenCalled());
  });
});
