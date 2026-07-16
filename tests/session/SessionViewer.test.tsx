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
  ardClientProps: vi.fn(),
  serialClientProps: vi.fn(),
  telnetClientProps: vi.fn(),
  vncClientProps: vi.fn(),
  sftpClientProps: vi.fn(),
  ftpClientProps: vi.fn(),
  scpClientProps: vi.fn(),
  rustDeskClientProps: vi.fn(),
  mySqlClientProps: vi.fn(),
  postgreSqlClientProps: vi.fn(),
  spiceClientProps: vi.fn(),
  xdmcpClientProps: vi.fn(),
  x2goNativeClientProps: vi.fn(),
  nxNativeClientProps: vi.fn(),
  smbClientProps: vi.fn(),
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

vi.mock("../../src/components/protocol/ArdClient", () => ({
  ArdClient: (props: any) => {
    mockState.ardClientProps(props);
    return <div data-testid="mock-ard-client">ARD Client</div>;
  },
}));

vi.mock("../../src/components/protocol/SerialClient", () => ({
  SerialClient: (props: any) => {
    mockState.serialClientProps(props);
    return <div data-testid="mock-serial-client">Serial Client</div>;
  },
}));

vi.mock("../../src/components/protocol/TelnetClient", () => ({
  TelnetClient: (props: any) => {
    mockState.telnetClientProps(props);
    return <div data-testid="mock-telnet-client">Telnet Client</div>;
  },
}));

vi.mock("../../src/components/protocol/VNCClient", () => ({
  VNCClient: (props: any) => {
    mockState.vncClientProps(props);
    return <div data-testid="mock-vnc-client">VNC Client</div>;
  },
}));

vi.mock("../../src/components/protocol/SFTPClient", () => ({
  SFTPClient: (props: any) => {
    mockState.sftpClientProps(props);
    return <div data-testid="mock-sftp-client">SFTP Client</div>;
  },
}));

vi.mock("../../src/components/protocol/FTPClient", () => ({
  FTPClient: (props: any) => {
    mockState.ftpClientProps(props);
    return <div data-testid="mock-ftp-client">FTP Client</div>;
  },
}));

vi.mock("../../src/components/protocol/ScpClient", () => ({
  ScpClient: (props: any) => {
    mockState.scpClientProps(props);
    return <div data-testid="mock-scp-client">SCP Client</div>;
  },
}));

vi.mock("../../src/components/protocol/RustDeskClient", () => ({
  RustDeskClient: (props: any) => {
    mockState.rustDeskClientProps(props);
    return <div data-testid="mock-rustdesk-client">RustDesk Client</div>;
  },
}));

vi.mock("../../src/components/protocol/MySQLClient", () => ({
  MySQLClient: (props: any) => {
    mockState.mySqlClientProps(props);
    return <div data-testid="mock-mysql-client">MySQL Client</div>;
  },
}));

vi.mock("../../src/components/protocol/PostgreSQLClient", () => ({
  PostgreSQLClient: (props: any) => {
    mockState.postgreSqlClientProps(props);
    return <div data-testid="mock-postgresql-client">PostgreSQL Client</div>;
  },
}));

vi.mock("../../src/components/protocol/SpiceClient", () => ({
  SpiceClient: (props: any) => {
    mockState.spiceClientProps(props);
    return <div data-testid="mock-spice-client">SPICE native handoff</div>;
  },
}));

vi.mock("../../src/components/protocol/XdmcpClient", () => ({
  XdmcpClient: (props: any) => {
    mockState.xdmcpClientProps(props);
    return <div data-testid="mock-xdmcp-client">XDMCP native handoff</div>;
  },
}));

vi.mock("../../src/components/protocol/X2goNativeClient", () => ({
  X2goNativeClient: (props: any) => {
    mockState.x2goNativeClientProps(props);
    return <div data-testid="mock-x2go-client">X2Go native handoff</div>;
  },
}));

vi.mock("../../src/components/protocol/NxNativeClient", () => ({
  NxNativeClient: (props: any) => {
    mockState.nxNativeClientProps(props);
    return <div data-testid="mock-nx-client">NoMachine native handoff</div>;
  },
}));

vi.mock("../../src/components/protocol/SMBClient", () => ({
  SMBClient: (props: any) => {
    mockState.smbClientProps(props);
    return <div data-testid="mock-smb-client">SMB Client</div>;
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

  it.each([
    ["ard", "mock-ard-client"],
    ["serial", "mock-serial-client"],
    ["telnet", "mock-telnet-client"],
    ["vnc", "mock-vnc-client"],
    ["ftp", "mock-ftp-client"],
    ["sftp", "mock-sftp-client"],
    ["scp", "mock-scp-client"],
    ["rustdesk", "mock-rustdesk-client"],
    ["mysql", "mock-mysql-client"],
    ["postgresql", "mock-postgresql-client"],
    ["spice", "mock-spice-client"],
    ["xdmcp", "mock-xdmcp-client"],
    ["x2go", "mock-x2go-client"],
    ["nx", "mock-nx-client"],
    ["smb", "mock-smb-client"],
  ])(
    "mounts the %s protocol client while the real connection is pending",
    async (protocol, testId) => {
      const { rerender } = render(
        <SessionViewer
          session={createSession({ protocol, status: "connecting" })}
        />,
      );

      expect(await screen.findByTestId(testId)).toBeInTheDocument();

      rerender(
        <SessionViewer
          session={createSession({ protocol, status: "reconnecting" })}
        />,
      );
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
      expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
    },
  );

  it("does not claim that an unrouted protocol is connected", () => {
    render(
      <SessionViewer
        session={createSession({ protocol: "gcp", status: "connected" })}
      />,
    );

    expect(screen.getByText("Connection Failed")).toBeInTheDocument();
    expect(
      screen.getByText(/available through its management panel/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
  });

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
