import React, { Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import english from "../../src/i18n/locales/en-US.json";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import type {
  Connection,
  ConnectionDatabase,
} from "../../src/types/connection/connection";
import { demoDatabaseId, commandCalls } from "./native";
import { refusedCalls, refuse } from "./failures";
import { installDemoStorage, storageReads } from "./storage";
import "../../app/globals.css";

await i18n.use(initReactI18next).init({
  lng: "en-US",
  fallbackLng: "en-US",
  resources: { "en-US": { translation: english } },
  interpolation: { escapeValue: false },
});
const date = "2026-09-09T09:00:00Z";
const connection: Connection = {
  id: "docs-demo-web",
  name: "Operations dashboard",
  hostname: "dashboard.example.test",
  protocol: "https",
  port: 443,
  username: "demo.operator",
  isGroup: false,
  parentId: "docs-demo-folder",
  tags: ["operations", "demo"],
  icon: "globe",
  createdAt: date,
  updatedAt: date,
};
const connections: Connection[] = [
  {
    id: "docs-demo-folder",
    name: "Example environment",
    protocol: "ssh",
    hostname: "",
    port: 22,
    isGroup: true,
    icon: "folder-network",
    createdAt: date,
    updatedAt: date,
  },
  connection,
  {
    ...connection,
    id: "docs-demo-ssh",
    name: "Application server",
    hostname: "app.example.test",
    protocol: "ssh",
    port: 22,
    icon: "server",
  },
  {
    ...connection,
    id: "docs-demo-rdp",
    name: "Operations desktop",
    hostname: "desktop.example.test",
    protocol: "rdp",
    port: 3389,
    icon: "monitor",
  },
];
const database: ConnectionDatabase = {
  id: demoDatabaseId,
  name: "Documentation demo",
  isEncrypted: true,
  protectionFormat: "sorng-db",
  securityRevision: "demo-revision",
  createdAt: date,
  updatedAt: date,
  lastAccessed: date,
};
// Patch only persistence boundary reads in this isolated fixture. Real UI/hooks remain imported.
const manager = DatabaseManager.getInstance();
manager.getCurrentDatabase = () => database;
manager.getDatabase = async (id) => (id === database.id ? database : null);
manager.getAllDatabases = async () => [database];
installDemoStorage();
// Exercise the real manager's lease bookkeeping against the synthetic boundary.
// This does not access an OS vault or install/use any real cryptographic key.
if (new URLSearchParams(location.search).get("view") === "database") {
  await manager.unlockManagedDatabase(demoDatabaseId, "demo-vault-slot");
}

const views = {
  editor: React.lazy(() =>
    import("../../src/components/connection/ConnectionEditor").then(
      (module) => ({
        default: () => (
          <module.ConnectionEditor
            connection={connection}
            isOpen
            onClose={() => {}}
          />
        ),
      }),
    ),
  ),
  artifacts: React.lazy(() =>
    import("../../src/components/SettingsDialog/sections/security/ArtifactProtectionPanel").then(
      (module) => ({ default: () => <module.default /> }),
    ),
  ),
  database: React.lazy(() =>
    import("../../src/components/SettingsDialog/sections/security/CurrentDatabaseSecuritySection").then(
      (module) => ({ default: () => <module.default /> }),
    ),
  ),
  sessions: React.lazy(() =>
    import("../../src/components/session/sessionManager/SessionManager").then(
      (module) => ({
        default: () => (
          <module.SessionManager
            isVisible
            connections={connections}
            activeBackendSessionIds={["demo-rdp-session"]}
            onClose={() => {}}
          />
        ),
      }),
    ),
  ),
  recordings: React.lazy(() =>
    import("../../src/components/recording/RecordingManager").then(
      (module) => ({
        default: () => <module.RecordingManager isOpen onClose={() => {}} />,
      }),
    ),
  ),
  trust: React.lazy(() =>
    import("../../src/components/security/TrustCenterTab").then((module) => ({
      default: () => <module.default onClose={() => {}} showClose={false} />,
    })),
  ),
};
class DemoBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error) {
    refusedCalls.push(`Component error: ${error.message}`);
  }
  render() {
    return this.state.error ? (
      <pre role="alert">Demo fixture failed: {this.state.error}</pre>
    ) : (
      this.props.children
    );
  }
}
export function Demo() {
  const [state, setState] = useState<ConnectionContextType["state"]>({
    connections,
    sessions: connections
      .filter((item) => !item.isGroup)
      .map((item) => ({
        id: `tab-${item.id}`,
        connectionId: item.id,
        name: item.name,
        status: "connected",
        startTime: new Date(date),
        protocol: item.protocol,
        hostname: item.hostname,
        backendSessionId:
          item.protocol === "ssh"
            ? "demo-ssh-session"
            : item.protocol === "rdp"
              ? "demo-rdp-session"
              : undefined,
      })),
    selectedConnection: connection,
    selectedConnectionIds: new Set(),
    filter: {
      searchTerm: "",
      protocols: [],
      tags: [],
      colorTags: [],
      showRecent: false,
      showFavorites: false,
    },
    isLoading: false,
    sidebarCollapsed: false,
    tabGroups: [],
  });
  const view = new URLSearchParams(location.search).get("view") ?? "editor";
  const View = views[view as keyof typeof views];
  const context: ConnectionContextType = {
    state,
    dispatch: (action) => {
      if (action.type === "SELECT_CONNECTION")
        setState((previous) => ({
          ...previous,
          selectedConnection: action.payload,
        }));
    },
    dispatchAndFlush: async () => refuse("connection save"),
    persistence: { dirty: false, saving: false, error: null },
    saveData: async () => refuse("connection save"),
    flushPendingSave: async () => {},
    loadData: async () => false,
  };
  return (
    <SettingsContext.Provider
      value={{
        settings: { ...defaultSettings, autoSaveEnabled: false },
        settingsReady: true,
        updateSettings: async () => refuse("settings write"),
        reloadSettings: async () => {},
      }}
    >
      <ConnectionContext.Provider value={context}>
        <ToastProvider>
          <div
            style={{
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--color-background)",
              color: "var(--color-text)",
            }}
          >
            <header
              style={{
                padding: "10px 20px",
                borderBottom: "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              <strong>sortOfRemoteNG</strong> · Documentation demo · Synthetic
              data — no live connection
            </header>
            <main
              data-docs-demo={view}
              style={{
                minHeight: 0,
                overflow: "auto",
                flex: 1,
                padding: view === "editor" ? 0 : 20,
              }}
            >
              <DemoBoundary>
                <Suspense fallback={<p>Loading actual app component…</p>}>
                  {View ? <View /> : <p role="alert">Unknown demo view</p>}
                </Suspense>
              </DemoBoundary>
            </main>
            {view === "recordings" && (
              <aside
                style={{
                  position: "fixed",
                  bottom: 8,
                  left: 16,
                  zIndex: 100000,
                  padding: "4px 10px",
                  background: "#111827",
                  color: "#e5e7eb",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                Documentation demo · Synthetic data — no live connection
              </aside>
            )}
          </div>
        </ToastProvider>
      </ConnectionContext.Provider>
    </SettingsContext.Provider>
  );
}
Object.assign(window, {
  __DOCS_DEMO__: {
    commands: commandCalls,
    refused: refusedCalls,
    storageReads,
    views: Object.keys(views),
  },
});
createRoot(document.getElementById("root")!).render(<Demo />);
