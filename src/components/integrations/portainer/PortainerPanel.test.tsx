import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PortainerManager } from "../../../hooks/integration/usePortainer";
import type {
  PortainerContainer,
  PortainerEndpoint,
  PortainerStack,
} from "../../../types/portainer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, dflt?: string) => dflt ?? _key,
  }),
}));

// The insecure-TLS modal is exercised elsewhere; here we just need to see it
// open and be able to acknowledge it.
vi.mock("../../security/InsecureTlsWarningModal", () => ({
  InsecureTlsWarningModal: ({
    isOpen,
    onAcknowledge,
  }: {
    isOpen: boolean;
    onAcknowledge: () => void;
  }) =>
    isOpen ? (
      <div data-testid="tls-modal">
        <button data-testid="tls-modal-ack" onClick={onAcknowledge}>
          ack
        </button>
      </div>
    ) : null,
}));

const store = vi.hoisted(() => ({
  isLoading: false,
  instances: [] as Array<Record<string, unknown>>,
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  readSecret: vi.fn(),
  readNamedSecret: vi.fn(),
}));
vi.mock("../../../hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => store,
}));

const launchMock = vi.hoisted(() => vi.fn());
vi.mock("./webUiLaunch", async () => {
  const actual =
    await vi.importActual<typeof import("./webUiLaunch")>("./webUiLaunch");
  return {
    ...actual,
    launchPortainerWebUi: (
      input: Parameters<typeof actual.launchPortainerWebUi>[0],
    ) => {
      launchMock(input);
      return actual.buildPortainerWebUiConnection({ ...input, id: "web-1" });
    },
  };
});

const mgrState = vi.hoisted(() => ({ current: {} as PortainerManager }));
vi.mock("../../../hooks/integration/usePortainer", () => ({
  usePortainer: () => mgrState.current,
}));

import PortainerPanel from "./PortainerPanel";
import { portainerDescriptor } from "./descriptor";

const endpoints: PortainerEndpoint[] = [
  {
    id: 1,
    name: "local",
    type: 1,
    url: "unix:///var/run/docker.sock",
    status: 1,
    snapshots: [{ runningContainerCount: 2, stoppedContainerCount: 1 }],
  },
  { id: 2, name: "remote", type: 2, url: "tcp://10.0.0.2:9001", status: 2 },
];
const containers: PortainerContainer[] = [
  {
    id: "abc123def456",
    names: ["/portainer"],
    image: "portainer/portainer-ce:lts",
    state: "running",
    status: "Up 3 hours",
  },
  {
    id: "fff000",
    names: ["/nginx"],
    image: "nginx:alpine",
    state: "exited",
    status: "Exited (0) 2 hours ago",
  },
];
const stacks: PortainerStack[] = [
  { id: 7, name: "web", type: 2, endpointId: 1, status: 1 },
  { id: 8, name: "db", type: 2, endpointId: 1, status: 2 },
];

function makeMgr(over: Partial<PortainerManager> = {}): PortainerManager {
  const base = {
    connectionId: null,
    status: "disconnected",
    summary: null,
    endpoints: [],
    containers: [],
    stacks: [],
    logs: [],
    webUiUrl: null,
    error: null,
    busy: false,
    isConnected: false,
    isConnecting: false,
    setError: vi.fn(),
    clearError: vi.fn(),
    clearLogs: vi.fn(),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    refreshSummary: vi.fn(),
    loadEndpoints: vi.fn().mockResolvedValue(endpoints),
    loadContainers: vi.fn().mockResolvedValue(containers),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    restartContainer: vi.fn().mockResolvedValue(undefined),
    loadLogs: vi.fn().mockResolvedValue([]),
    loadStacks: vi.fn().mockResolvedValue(stacks),
    startStack: vi.fn().mockResolvedValue(undefined),
    stopStack: vi.fn().mockResolvedValue(undefined),
    api: {},
    run: vi.fn(async (op: () => Promise<unknown>) => op()),
  };
  return { ...base, ...over } as unknown as PortainerManager;
}

const connectedMgr = (over: Partial<PortainerManager> = {}) =>
  makeMgr({
    connectionId: "c1",
    status: "connected",
    isConnected: true,
    summary: {
      version: "2.21.4",
      instanceId: "inst-1",
      user: "admin",
      role: 1,
      authMode: "password",
    },
    webUiUrl: "https://pt.example.com:9443",
    endpoints,
    containers,
    stacks,
    ...over,
  });

const renderPanel = () => render(<PortainerPanel isOpen onClose={() => {}} />);

beforeEach(() => {
  launchMock.mockReset();
  store.instances = [];
  store.isLoading = false;
  store.createInstance.mockReset().mockResolvedValue({ id: "saved-1" });
  store.updateInstance.mockReset().mockResolvedValue({ id: "saved-1" });
  store.readSecret.mockReset().mockResolvedValue(null);
  store.readNamedSecret.mockReset().mockResolvedValue(null);
});

describe("portainerDescriptor", () => {
  it("is registered under virtualization with a lazy panel", async () => {
    expect(portainerDescriptor.key).toBe("portainer");
    expect(portainerDescriptor.category).toBe("virtualization");
    expect(portainerDescriptor.defaultConnectionIconKey).toBe("container");
    const mod = await portainerDescriptor.importPanel();
    expect(mod.default).toBe(PortainerPanel);
  });
});

describe("PortainerPanel — connect form", () => {
  it("renders nothing when closed", () => {
    mgrState.current = makeMgr();
    const { container } = render(
      <PortainerPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("connects in password mode with the form values", async () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    renderPanel();
    expect(screen.getByTestId("portainer-panel")).toBeInTheDocument();
    expect(screen.getByTestId("portainer-connection-form")).toBeInTheDocument();
    expect(screen.getByTestId("portainer-connect-btn")).toBeDisabled();

    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "http://127.0.0.1:19000" },
    });
    fireEvent.change(screen.getByTestId("portainer-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("portainer-password"), {
      target: { value: "adminadmin123" },
    });
    fireEvent.change(screen.getByTestId("portainer-timeout"), {
      target: { value: "15" },
    });
    expect(screen.getByTestId("portainer-connect-btn")).toBeEnabled();
    fireEvent.click(screen.getByTestId("portainer-connect-btn"));

    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    const [id, config] = (mgr.connect as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(typeof id).toBe("string");
    expect(config).toEqual({
      baseUrl: "http://127.0.0.1:19000",
      username: "admin",
      password: "adminadmin123",
      skipTlsVerify: false,
      acknowledge_invalid_cert_risk: false,
      timeoutSecs: 15,
    });
    expect(config).not.toHaveProperty("apiKey");
  });

  it("switching auth mode hides password fields, shows the key and sends apiKey only", async () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    renderPanel();
    expect(screen.getByTestId("portainer-username")).toBeInTheDocument();
    expect(screen.queryByTestId("portainer-api-key")).toBeNull();

    fireEvent.click(screen.getByTestId("portainer-auth-mode-apikey"));
    expect(screen.queryByTestId("portainer-username")).toBeNull();
    expect(screen.queryByTestId("portainer-password")).toBeNull();
    expect(screen.getByTestId("portainer-api-key")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "https://pt.example.com:9443" },
    });
    fireEvent.change(screen.getByTestId("portainer-api-key"), {
      target: { value: "ptr_abc" },
    });
    fireEvent.click(screen.getByTestId("portainer-connect-btn"));
    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    const config = (mgr.connect as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(config.apiKey).toBe("ptr_abc");
    expect(config).not.toHaveProperty("password");
    expect(config).not.toHaveProperty("username");

    // Back to password mode restores the fields.
    fireEvent.click(screen.getByTestId("portainer-auth-mode-password"));
    expect(screen.getByTestId("portainer-username")).toBeInTheDocument();
    expect(screen.queryByTestId("portainer-api-key")).toBeNull();
  });

  it("TLS skip over https requires the acknowledgement modal before connecting", async () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    renderPanel();
    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "https://pt.example.com:9443" },
    });
    fireEvent.change(screen.getByTestId("portainer-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("portainer-password"), {
      target: { value: "adminadmin123" },
    });
    fireEvent.click(screen.getByTestId("portainer-tls-skip"));
    fireEvent.click(screen.getByTestId("portainer-connect-btn"));

    // Not connected yet — the modal gates it.
    expect(mgr.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId("tls-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tls-modal-ack"));

    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    const config = (mgr.connect as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(config.skipTlsVerify).toBe(true);
    expect(config.acknowledge_invalid_cert_risk).toBe(true);
  });

  it("TLS skip over plain http does not prompt", async () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    renderPanel();
    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "http://pt.example.com:9000" },
    });
    fireEvent.change(screen.getByTestId("portainer-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("portainer-password"), {
      target: { value: "adminadmin123" },
    });
    fireEvent.click(screen.getByTestId("portainer-tls-skip"));
    fireEvent.click(screen.getByTestId("portainer-connect-btn"));
    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("tls-modal")).toBeNull();
    const config = (mgr.connect as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(config.acknowledge_invalid_cert_risk).toBe(false);
  });

  it("saves an instance with non-secret fields and the secret routed to the vault", async () => {
    mgrState.current = makeMgr();
    renderPanel();
    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "https://pt.example.com:9443" },
    });
    fireEvent.change(screen.getByTestId("portainer-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("portainer-password"), {
      target: { value: "adminadmin123" },
    });
    fireEvent.click(screen.getByTestId("portainer-save-btn"));
    await waitFor(() => expect(store.createInstance).toHaveBeenCalledTimes(1));
    const input = store.createInstance.mock.calls[0][0];
    expect(input.integrationKey).toBe("portainer");
    expect(input.host).toBe("https://pt.example.com:9443");
    expect(input.fields).toEqual({
      baseUrl: "https://pt.example.com:9443",
      authMode: "password",
      tlsVerify: "true",
      skipTlsVerify: "false",
      timeoutSecs: "",
      username: "admin",
    });
    expect(input.secret).toBe("adminadmin123");
    expect(input.secrets).toEqual({ password: "adminadmin123" });
    expect(JSON.stringify(input.fields)).not.toContain("adminadmin123");

    // Second save updates rather than creating again.
    fireEvent.click(screen.getByTestId("portainer-save-btn"));
    await waitFor(() => expect(store.updateInstance).toHaveBeenCalledTimes(1));
    expect(store.updateInstance.mock.calls[0][0]).toBe("saved-1");
  });

  it("prefills from a saved instance including the vault secret", async () => {
    store.instances = [
      {
        id: "inst-9",
        integrationKey: "portainer",
        name: "Prod",
        host: "https://pt.example.com:9443",
        fields: {
          baseUrl: "https://pt.example.com:9443",
          authMode: "apiKey",
          skipTlsVerify: "true",
          timeoutSecs: "30",
        },
        credentialRefIds: { apiKey: "ref-1" },
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.readNamedSecret.mockResolvedValue("ptr_saved");
    mgrState.current = makeMgr();
    render(<PortainerPanel isOpen onClose={() => {}} instanceId="inst-9" />);
    await waitFor(() =>
      expect(screen.getByTestId("portainer-api-key")).toHaveValue("ptr_saved"),
    );
    expect(screen.getByTestId("portainer-base-url")).toHaveValue(
      "https://pt.example.com:9443",
    );
    expect(screen.getByTestId("portainer-tls-skip")).toBeChecked();
    expect(screen.getByTestId("portainer-timeout")).toHaveValue("30");
    expect(store.readNamedSecret).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inst-9" }),
      "apiKey",
    );
  });

  it("surfaces hook errors and adds the Trust Center hint for tls_untrusted", () => {
    mgrState.current = makeMgr({
      error: "tls_untrusted: certificate chain is not trusted",
    });
    renderPanel();
    expect(screen.getByTestId("portainer-error")).toHaveTextContent(
      "tls_untrusted",
    );
    expect(screen.getByTestId("portainer-error")).toHaveTextContent(
      "Trust Center",
    );
  });
});

describe("PortainerPanel — connected", () => {
  it("shows status, tabs and disconnects", async () => {
    const mgr = connectedMgr();
    mgrState.current = mgr;
    renderPanel();
    expect(screen.queryByTestId("portainer-connection-form")).toBeNull();
    const status = screen.getByTestId("portainer-status");
    expect(status).toHaveTextContent("Connected");
    expect(status).toHaveTextContent("v2.21.4");
    expect(status).toHaveTextContent("inst-1");
    expect(status).toHaveTextContent("admin (administrator)");
    expect(screen.getByTestId("portainer-tab-endpoints")).toBeInTheDocument();
    expect(screen.getByTestId("portainer-tab-containers")).toBeInTheDocument();
    expect(screen.getByTestId("portainer-tab-stacks")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("portainer-disconnect-btn"));
    await waitFor(() => expect(mgr.disconnect).toHaveBeenCalledTimes(1));
  });

  it("renders environments with status and snapshot counts", () => {
    mgrState.current = connectedMgr();
    renderPanel();
    const rows = screen.getAllByTestId("portainer-endpoint-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("local");
    expect(rows[0]).toHaveTextContent("Docker");
    expect(rows[0]).toHaveTextContent("Up");
    expect(rows[0]).toHaveTextContent("2 / 3");
    expect(rows[1]).toHaveTextContent("Down");
  });

  it("Browse containers jumps to the containers tab for that endpoint", async () => {
    const mgr = connectedMgr();
    mgrState.current = mgr;
    renderPanel();
    fireEvent.click(
      screen.getAllByText("Browse containers")[1] as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("portainer-containers-tab"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("portainer-endpoint-select")).toHaveValue("2");
    await waitFor(() =>
      expect(mgr.loadContainers).toHaveBeenCalledWith(2, true),
    );
  });

  it("containers tab: lists rows, start/stop/restart call the hook, logs drawer opens", async () => {
    const mgr = connectedMgr({
      loadLogs: vi
        .fn()
        .mockResolvedValue([{ stream: "stdout", text: "hello" }]),
    });
    mgrState.current = mgr;
    renderPanel();
    fireEvent.click(screen.getByTestId("portainer-tab-containers"));
    await waitFor(() =>
      expect(mgr.loadContainers).toHaveBeenCalledWith(1, true),
    );
    const rows = screen.getAllByTestId("portainer-container-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("portainer");
    expect(rows[0]).toHaveTextContent("running");

    // Running container: start disabled, stop enabled.
    const stops = screen.getAllByTestId("portainer-container-stop");
    const starts = screen.getAllByTestId("portainer-container-start");
    expect(starts[0]).toBeDisabled();
    expect(stops[0]).toBeEnabled();
    expect(starts[1]).toBeEnabled();
    expect(stops[1]).toBeDisabled();

    fireEvent.click(stops[0]);
    await waitFor(() =>
      expect(mgr.stopContainer).toHaveBeenCalledWith(1, "abc123def456"),
    );
    fireEvent.click(starts[1]);
    await waitFor(() =>
      expect(mgr.startContainer).toHaveBeenCalledWith(1, "fff000"),
    );
    fireEvent.click(screen.getAllByTestId("portainer-container-restart")[0]);
    await waitFor(() =>
      expect(mgr.restartContainer).toHaveBeenCalledWith(1, "abc123def456"),
    );

    // "Show stopped" toggle re-queries with all=false.
    fireEvent.click(screen.getByTestId("portainer-containers-all"));
    await waitFor(() =>
      expect(mgr.loadContainers).toHaveBeenCalledWith(1, false),
    );

    fireEvent.click(screen.getAllByTestId("portainer-container-logs")[0]);
    await waitFor(() =>
      expect(mgr.loadLogs).toHaveBeenCalledWith(1, "abc123def456", 100),
    );
    expect(screen.getByTestId("portainer-logs-drawer")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("portainer-logs-tail"), {
      target: { value: "500" },
    });
    await waitFor(() =>
      expect(mgr.loadLogs).toHaveBeenCalledWith(1, "abc123def456", 500),
    );
    fireEvent.click(screen.getByTestId("portainer-logs-close"));
    expect(screen.queryByTestId("portainer-logs-drawer")).toBeNull();
    expect(mgr.clearLogs).toHaveBeenCalled();
  });

  it("stacks tab: lists stacks and start/stop call the hook with endpoint id", async () => {
    const mgr = connectedMgr();
    mgrState.current = mgr;
    renderPanel();
    fireEvent.click(screen.getByTestId("portainer-tab-stacks"));
    await waitFor(() => expect(mgr.loadStacks).toHaveBeenCalled());
    const rows = screen.getAllByTestId("portainer-stack-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("web");
    expect(rows[0]).toHaveTextContent("Compose");
    expect(rows[0]).toHaveTextContent("local");
    expect(rows[0]).toHaveTextContent("Active");
    const starts = screen.getAllByTestId("portainer-stack-start");
    const stops = screen.getAllByTestId("portainer-stack-stop");
    expect(starts[0]).toBeDisabled();
    expect(stops[0]).toBeEnabled();
    fireEvent.click(stops[0]);
    await waitFor(() => expect(mgr.stopStack).toHaveBeenCalledWith(7, 1));
    fireEvent.click(starts[1]);
    await waitFor(() => expect(mgr.startStack).toHaveBeenCalledWith(8, 1));
  });
});

describe("PortainerPanel — Open web UI (auto-login)", () => {
  const fillPasswordForm = () => {
    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "https://pt.example.com:9443" },
    });
    fireEvent.change(screen.getByTestId("portainer-username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("portainer-password"), {
      target: { value: "adminadmin123" },
    });
  };

  it("is hidden while disconnected", () => {
    mgrState.current = makeMgr();
    renderPanel();
    expect(screen.queryByTestId("portainer-open-web-ui")).toBeNull();
  });

  it("builds an auto-login HTTP connection from the password-mode form", async () => {
    // Start disconnected so the form holds the credentials, then flip the
    // (mocked) hook to connected and re-render — the panel keeps the form.
    const mgr = makeMgr();
    mgrState.current = mgr;
    const view = renderPanel();
    fillPasswordForm();

    mgrState.current = connectedMgr();
    view.rerender(<PortainerPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("portainer-open-web-ui"));

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0]).toMatchObject({
      baseUrl: "https://pt.example.com:9443",
      authMode: "password",
      username: "admin",
      password: "adminadmin123",
      skipTlsVerify: false,
    });
    expect(screen.queryByTestId("portainer-web-ui-notice")).toBeNull();
  });

  it("prefers the backend-normalised webUiUrl over the typed base URL", () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    const view = renderPanel();
    fillPasswordForm();
    mgrState.current = connectedMgr({ webUiUrl: "https://pt.example.com" });
    view.rerender(<PortainerPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("portainer-open-web-ui"));
    expect(launchMock.mock.calls[0][0].baseUrl).toBe("https://pt.example.com");
  });

  it("never passes a password in API-key mode and explains no auto-login", () => {
    const mgr = makeMgr();
    mgrState.current = mgr;
    const view = renderPanel();
    fireEvent.click(screen.getByTestId("portainer-auth-mode-apikey"));
    fireEvent.change(screen.getByTestId("portainer-base-url"), {
      target: { value: "https://pt.example.com:9443" },
    });
    fireEvent.change(screen.getByTestId("portainer-api-key"), {
      target: { value: "ptr_abc" },
    });
    mgrState.current = connectedMgr({
      summary: { version: "2.21.4", authMode: "apiKey" },
    });
    view.rerender(<PortainerPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("portainer-open-web-ui"));

    expect(launchMock).toHaveBeenCalledTimes(1);
    const input = launchMock.mock.calls[0][0];
    expect(input.authMode).toBe("apiKey");
    expect(input.password).toBe("");
    expect(JSON.stringify(input)).not.toContain("ptr_abc");
    expect(screen.getByTestId("portainer-web-ui-notice")).toHaveTextContent(
      "without auto-login",
    );
  });
});
