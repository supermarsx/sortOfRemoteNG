import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionViewer } from "../../src/components/session/SessionViewer";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mockState = vi.hoisted(() => ({
  throwWebTerminal: false,
  toolTabViewerProps: vi.fn(),
  windowsToolPanelProps: vi.fn(),
  webTerminalProps: vi.fn(),
  webBrowserProps: vi.fn(),
  rdpClientProps: vi.fn(),
  anyDeskClientProps: vi.fn(),
  rdpErrorScreenProps: vi.fn(),
  integrationPanelHostProps: vi.fn(),
  rawSocketClientProps: vi.fn(),
  rloginClientProps: vi.fn(),
}));

vi.mock("../../src/components/app/ToolPanel", () => ({
  ToolTabViewer: (props: any) => {
    mockState.toolTabViewerProps(props);
    return (
      <button type="button" onClick={() => props.onClose?.()}>
        Mock Tool Viewer
      </button>
    );
  },
}));

vi.mock("../../src/components/windows/WindowsToolPanel", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.windowsToolPanelProps(props);
    return <div data-testid="mock-windows-tool-panel">Windows Tool Panel</div>;
  },
}));

vi.mock("../../src/components/windows/WindowsToolPanel.helpers", () => ({
  __esModule: true,
  isWinmgmtProtocol: (protocol: string) => protocol.startsWith("winmgmt:"),
}));

vi.mock("../../src/components/integrations/IntegrationPanelHost", () => ({
  IntegrationPanelHost: (props: any) => {
    mockState.integrationPanelHostProps(props);
    return (
      <button type="button" onClick={() => props.onClose?.()}>
        Mock Integration Panel
      </button>
    );
  },
}));

vi.mock("../../src/components/ssh/WebTerminal", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.webTerminalProps(props);
    if (mockState.throwWebTerminal) {
      throw new Error("Mock terminal renderer crashed");
    }
    return <div data-testid="mock-web-terminal">Web Terminal</div>;
  },
}));

vi.mock("../../src/components/protocol/WebBrowser", () => ({
  WebBrowser: (props: any) => {
    mockState.webBrowserProps(props);
    return <div data-testid="mock-web-browser">Web Browser</div>;
  },
}));

vi.mock("../../src/components/protocol/RawSocketClient", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.rawSocketClientProps(props);
    return <div data-testid="mock-raw-socket-client">Raw Socket Client</div>;
  },
}));

vi.mock("../../src/components/protocol/RloginClient", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.rloginClientProps(props);
    return <div data-testid="mock-rlogin-client">RLogin Client</div>;
  },
}));

vi.mock("../../src/components/rdp/RDPClient", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.rdpClientProps(props);
    return <div data-testid="mock-rdp-client">RDP Client</div>;
  },
}));

vi.mock("../../src/components/protocol/AnyDeskClient", () => ({
  AnyDeskClient: (props: any) => {
    mockState.anyDeskClientProps(props);
    return <div data-testid="mock-anydesk-client">AnyDesk Client</div>;
  },
}));

vi.mock("../../src/components/rdp/RDPErrorScreen", () => ({
  __esModule: true,
  default: (props: any) => {
    mockState.rdpErrorScreenProps(props);
    return (
      <div data-testid="mock-rdp-error-screen">
        RDP Error: {props.errorMessage}
      </div>
    );
  },
}));

const createSession = (
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "session-1",
  connectionId: "connection-1",
  name: "Session 1",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "ssh",
  hostname: "example-host",
  ...overrides,
});

describe("SessionViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.throwWebTerminal = false;
  });

  it("routes tool protocol sessions and wires close callback", async () => {
    const onCloseSession = vi.fn();

    render(
      <SessionViewer
        session={createSession({ protocol: "tool:scriptManager" })}
        onCloseSession={onCloseSession}
      />,
    );

    const toolButton = await screen.findByRole("button", {
      name: /mock tool viewer/i,
    });
    fireEvent.click(toolButton);

    expect(onCloseSession).toHaveBeenCalledWith("session-1");
    expect(mockState.toolTabViewerProps).toHaveBeenCalled();
  });

  it("routes winmgmt sessions to the windows tool panel", async () => {
    render(
      <SessionViewer
        session={createSession({ protocol: "winmgmt:services" })}
      />,
    );

    expect(
      await screen.findByTestId("mock-windows-tool-panel"),
    ).toBeInTheDocument();
    expect(mockState.windowsToolPanelProps).toHaveBeenCalled();
  });

  it("routes integration protocol sessions to the integration panel host", async () => {
    const onCloseSession = vi.fn();

    render(
      <SessionViewer
        session={createSession({
          protocol: "integration:netbox",
          backendSessionId: "netbox-prod",
          integration: {
            descriptorKey: "netbox",
            descriptorLabel: "NetBox",
            category: "infra",
            instanceId: "netbox-prod",
            host: "netbox.internal",
            providerFields: {
              site: "prod",
            },
          },
        })}
        onCloseSession={onCloseSession}
      />,
    );

    const panelButton = await screen.findByRole("button", {
      name: /mock integration panel/i,
    });
    fireEvent.click(panelButton);

    expect(mockState.integrationPanelHostProps).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptorKey: "netbox",
        protocol: "integration:netbox",
        instanceId: "netbox-prod",
        integrationSettings: expect.objectContaining({
          descriptorKey: "netbox",
          providerFields: { site: "prod" },
        }),
      }),
    );
    expect(onCloseSession).toHaveBeenCalledWith("session-1");
  });

  it("routes SSH connected sessions to the web terminal", async () => {
    render(
      <SessionViewer
        session={createSession({ protocol: "ssh", status: "connected" })}
      />,
    );

    expect(await screen.findByTestId("mock-web-terminal")).toBeInTheDocument();
    expect(mockState.webTerminalProps).toHaveBeenCalled();
  });

  it("routes RDP connected and RDP error sessions to their dedicated views", async () => {
    const { rerender } = render(
      <SessionViewer
        session={createSession({ protocol: "rdp", status: "connected" })}
      />,
    );

    expect(await screen.findByTestId("mock-rdp-client")).toBeInTheDocument();

    rerender(
      <SessionViewer
        session={createSession({
          protocol: "rdp",
          status: "error",
          errorMessage: "RDP handshake failed",
        })}
      />,
    );

    expect(
      await screen.findByTestId("mock-rdp-error-screen"),
    ).toBeInTheDocument();
    expect(screen.getByText(/rdp handshake failed/i)).toBeInTheDocument();
  });

  it("mounts runtime-owned non-RDP connecting sessions so clients report real status", () => {
    render(
      <SessionViewer
        session={createSession({ protocol: "ssh", status: "connecting" })}
      />,
    );

    expect(screen.getByTestId("mock-web-terminal")).toBeInTheDocument();
    expect(mockState.webTerminalProps).toHaveBeenCalled();
  });

  it.each([
    ["raw", "mock-raw-socket-client"],
    ["rlogin", "mock-rlogin-client"],
  ])(
    "routes %s reconnecting sessions to the real protocol client",
    async (protocol, testId) => {
      render(
        <SessionViewer
          session={createSession({ protocol, status: "reconnecting" })}
        />,
      );

      expect(await screen.findByTestId(testId)).toBeInTheDocument();
      expect(screen.queryByTestId("mock-web-terminal")).not.toBeInTheDocument();
    },
  );

  it("renders generic error view for non-RDP error sessions", () => {
    render(
      <SessionViewer
        session={createSession({
          protocol: "ssh",
          status: "error",
          errorMessage: "Network path unreachable",
        })}
      />,
    );

    expect(screen.getByText("Connection Failed")).toBeInTheDocument();
    expect(screen.getByText("SSH to example-host")).toBeInTheDocument();
    expect(screen.getByText("Network path unreachable")).toBeInTheDocument();
  });

  it("shows feature boundary fallback when a child view crashes", async () => {
    mockState.throwWebTerminal = true;
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <SessionViewer
        session={createSession({ protocol: "ssh", status: "connected" })}
      />,
    );

    expect(await screen.findByText("SSH panel failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry panel/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/mock terminal renderer crashed/i),
    ).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
