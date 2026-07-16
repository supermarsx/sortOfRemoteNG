import React from "react";
import dynamic from "next/dynamic";
import { Monitor, AlertCircle } from "lucide-react";
import { LoadingElement } from "../ui/display/loadingElement";
import {
  ConnectionSession,
  INTEGRATION_PROTOCOL_PREFIX,
  isIntegrationConnectionProtocol,
} from "../../types/connection/connection";
import { isToolProtocol } from "../app/toolSession";
import { isWinmgmtProtocol } from "../windows/WindowsToolPanel.helpers";
import { FeatureErrorBoundary } from "../app/FeatureErrorBoundary";
import { getDirectSessionUnavailableMessage } from "../../utils/session/protocolAvailability";

const ToolTabViewer = dynamic(
  () => import("../app/ToolPanel").then((module) => module.ToolTabViewer),
  { ssr: false },
);
const WindowsToolPanel = dynamic(() => import("../windows/WindowsToolPanel"), {
  ssr: false,
});
const IntegrationPanelHost = dynamic(
  () =>
    import("../integrations/IntegrationPanelHost").then(
      (module) => module.IntegrationPanelHost,
    ),
  { ssr: false },
);
const WebTerminal = dynamic(() => import("../ssh/WebTerminal"), { ssr: false });
const RawSocketClient = dynamic(() => import("../protocol/RawSocketClient"), {
  ssr: false,
});
const RloginClient = dynamic(() => import("../protocol/RloginClient"), {
  ssr: false,
});
const ArdClient = dynamic(
  () => import("../protocol/ArdClient").then((module) => module.ArdClient),
  { ssr: false },
);
const PowerShellSessionViewer = dynamic(
  () => import("../protocol/PowerShellSessionViewer"),
  { ssr: false },
);
const WebBrowser = dynamic(
  () => import("../protocol/WebBrowser").then((module) => module.WebBrowser),
  { ssr: false },
);
const SFTPClient = dynamic(
  () => import("../protocol/SFTPClient").then((module) => module.SFTPClient),
  { ssr: false },
);
const FTPClient = dynamic(
  () => import("../protocol/FTPClient").then((module) => module.FTPClient),
  { ssr: false },
);
const ScpClient = dynamic(
  () => import("../protocol/ScpClient").then((module) => module.ScpClient),
  { ssr: false },
);
const TelnetClient = dynamic(
  () =>
    import("../protocol/TelnetClient").then((module) => module.TelnetClient),
  { ssr: false },
);
const SerialClient = dynamic(
  () =>
    import("../protocol/SerialClient").then((module) => module.SerialClient),
  { ssr: false },
);
const MySQLClient = dynamic(
  () => import("../protocol/MySQLClient").then((module) => module.MySQLClient),
  { ssr: false },
);
const PostgreSQLClient = dynamic(
  () =>
    import("../protocol/PostgreSQLClient").then(
      (module) => module.PostgreSQLClient,
    ),
  { ssr: false },
);
const SMBClient = dynamic(
  () => import("../protocol/SMBClient").then((module) => module.SMBClient),
  { ssr: false },
);
const RDPClient = dynamic(() => import("../rdp/RDPClient"), { ssr: false });
const AnyDeskClient = dynamic(
  () =>
    import("../protocol/AnyDeskClient").then((module) => module.AnyDeskClient),
  { ssr: false },
);
const VNCClient = dynamic(
  () => import("../protocol/VNCClient").then((module) => module.VNCClient),
  { ssr: false },
);
const RustDeskClient = dynamic(
  () =>
    import("../protocol/RustDeskClient").then(
      (module) => module.RustDeskClient,
    ),
  { ssr: false },
);
const RDPErrorScreen = dynamic(() => import("../rdp/RDPErrorScreen"), {
  ssr: false,
});

interface SessionViewerProps {
  session: ConnectionSession;
  onCloseSession?: (sessionId: string) => void;
  onActivateSession?: (sessionId: string) => void;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onReconnect?: (
    connection: import("../../types/connection/connection").Connection,
  ) => void;
  onEditConnection?: (
    connection: import("../../types/connection/connection").Connection,
  ) => void;
  onDatabaseSelect?: (
    databaseId: string,
    password?: string,
  ) => Promise<void> | void;
  onDatabaseClose?: () => Promise<void> | void;
}

/** Generic themed error view for non-RDP protocols. */
const GenericErrorView: React.FC<{ session: ConnectionSession }> = ({
  session,
}) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)]">
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
      style={{
        background: "color-mix(in srgb, var(--color-error) 14%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--color-error) 22%, transparent)",
      }}
    >
      <AlertCircle size={28} style={{ color: "var(--color-error)" }} />
    </div>
    <h3 className="text-base font-semibold text-[var(--color-text)] mb-1">
      Connection Failed
    </h3>
    <p className="text-sm text-[var(--color-textSecondary)] mb-1">
      {session.protocol.toUpperCase()} to {session.hostname}
    </p>
    {session.errorMessage && (
      <pre
        className="mt-3 mx-auto max-w-lg text-xs whitespace-pre-wrap break-all font-mono leading-relaxed rounded-lg p-3 text-center"
        style={{
          background: "color-mix(in srgb, var(--color-error) 8%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--color-error) 18%, transparent)",
          color: "var(--color-textSecondary)",
        }}
      >
        {session.errorMessage}
      </pre>
    )}
    <p className="text-xs text-[var(--color-textMuted)] mt-4">
      Check your network connection and server settings
    </p>
  </div>
);

export const SessionViewer: React.FC<SessionViewerProps> = ({
  session,
  onCloseSession,
  onActivateSession,
  onReattachSession,
  onDetachToWindow,
  onReconnect,
  onEditConnection,
  onDatabaseSelect,
  onDatabaseClose,
}) => {
  const renderContent = () => {
    // Tool tabs render their own component
    if (isToolProtocol(session.protocol)) {
      return (
        <ToolTabViewer
          session={session}
          onClose={() => onCloseSession?.(session.id)}
          onCloseManagedSession={onCloseSession}
          onReattachSession={onReattachSession}
          onDetachToWindow={onDetachToWindow}
          onReconnect={onReconnect}
          onEditConnection={onEditConnection}
          onDatabaseSelect={onDatabaseSelect}
          onDatabaseClose={onDatabaseClose}
        />
      );
    }

    // Windows management tools (connection-scoped)
    if (isWinmgmtProtocol(session.protocol)) {
      return (
        <WindowsToolPanel
          session={session}
          onClose={() => onCloseSession?.(session.id)}
        />
      );
    }

    if (isIntegrationConnectionProtocol(session.protocol)) {
      const descriptorKey = session.protocol.slice(
        INTEGRATION_PROTOCOL_PREFIX.length,
      );
      return (
        <IntegrationPanelHost
          descriptorKey={descriptorKey}
          protocol={session.protocol}
          instanceId={session.backendSessionId}
          integrationSettings={session.integration}
          onClose={() => onCloseSession?.(session.id)}
        />
      );
    }

    // RDP handles its own connection lifecycle internally — mount the
    // client for both 'connecting' and 'connected' status so there is a
    // single stable component instance (no unmount/remount on status change).
    if (
      session.protocol === "rdp" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return (
        <RDPClient session={session} onActivateSession={onActivateSession} />
      );
    }

    if (
      session.protocol === "ssh" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <WebTerminal session={session} />;
    }

    if (
      session.protocol === "ard" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <ArdClient session={session} />;
    }

    if (
      session.protocol === "serial" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <SerialClient session={session} />;
    }

    if (
      session.protocol === "raw" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <RawSocketClient session={session} />;
    }

    if (
      session.protocol === "rlogin" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <RloginClient session={session} />;
    }

    if (
      session.protocol === "winrm" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <PowerShellSessionViewer session={session} />;
    }

    if (
      (session.protocol === "http" || session.protocol === "https") &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <WebBrowser session={session} />;
    }

    if (
      session.protocol === "anydesk" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <AnyDeskClient session={session} />;
    }

    if (
      session.protocol === "sftp" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <SFTPClient session={session} />;
    }

    if (
      session.protocol === "ftp" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <FTPClient session={session} />;
    }

    if (
      session.protocol === "scp" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <ScpClient session={session} />;
    }

    if (
      session.protocol === "telnet" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <TelnetClient session={session} />;
    }

    if (
      session.protocol === "vnc" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <VNCClient session={session} />;
    }

    if (
      session.protocol === "rustdesk" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <RustDeskClient session={session} />;
    }

    if (
      session.protocol === "mysql" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <MySQLClient session={session} />;
    }

    if (
      session.protocol === "postgresql" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <PostgreSQLClient session={session} />;
    }

    if (
      session.protocol === "smb" &&
      (session.status === "connecting" ||
        session.status === "connected" ||
        session.status === "reconnecting")
    ) {
      return <SMBClient session={session} />;
    }

    // Debug/mock RDP error sessions — render the rich RDP error screen directly
    if (
      session.protocol === "rdp" &&
      session.status === "error" &&
      session.errorMessage
    ) {
      return (
        <RDPErrorScreen
          sessionId={session.id}
          hostname={session.hostname}
          errorMessage={session.errorMessage}
        />
      );
    }

    switch (session.status) {
      case "connecting":
        return (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-textSecondary)]">
            <div className="mb-4">
              <LoadingElement size={48} ariaLabel="Connecting" />
            </div>
            <h3 className="text-lg font-medium mb-2">Connecting...</h3>
            <p className="text-sm text-center">
              Establishing {session.protocol.toUpperCase()} connection to{" "}
              {session.hostname}
            </p>
          </div>
        );

      case "connected":
        return (
          <GenericErrorView
            session={{
              ...session,
              errorMessage:
                getDirectSessionUnavailableMessage(session.protocol) ??
                `${session.protocol.toUpperCase()} is marked connected, but no frontend session viewer is registered.`,
            }}
          />
        );

      case "error":
        return <GenericErrorView session={session} />;

      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-textSecondary)]">
            <Monitor size={48} className="mb-4" />
            <h3 className="text-lg font-medium mb-2">Disconnected</h3>
            <p className="text-sm text-center">Session ended</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full bg-[var(--color-background)]">
      <FeatureErrorBoundary
        boundaryKey={`${session.id}:${session.status}:${session.protocol}:${session.backendSessionId ?? ""}`}
        title={`${session.protocol.toUpperCase()} panel failed`}
        message={`The ${session.protocol.toUpperCase()} view for ${session.hostname || session.name} crashed. Retry the panel without restarting the full app.`}
      >
        {renderContent()}
      </FeatureErrorBoundary>
    </div>
  );
};
