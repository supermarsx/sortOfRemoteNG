import { demo, refuse } from "./boundary";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { ManagedDatabaseUnlockDialog } from "../../src/components/encryption/DatabaseUnlockDialog";
import { DatabaseBulkControls } from "../../src/components/database/list/DatabaseBulkControls";
import { useDatabaseBulkActions } from "../../src/hooks/connection/useDatabaseBulkActions";
import type { DatabaseActionManager } from "../../src/utils/connection/databaseActions";
import type { Mgr } from "../../src/components/database/list/types";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const view = new URL(location.href).searchParams.get("view") ?? "unlock";
if (!["unlock", "bulk", "progress"].includes(view)) refuse("unknown view");
const collections: ConnectionDatabase[] = Array.from(
  { length: 18 },
  (_, index) => ({
    id: `demo-${index + 1}`,
    name: `${["Operations", "Engineering", "Production", "Quality assurance", "Service desk", "Infrastructure"][index % 6]} ${index + 1}`,
    isEncrypted: view === "bulk",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    lastAccessed: "2026-01-01",
  }),
);
let release: (() => void) | undefined;
const manager = {
  getCurrentDatabase: () => null,
  getDatabase: async (id: string) =>
    collections.find((entry) => entry.id === id) ?? null,
  isDatabaseUnlocked: () => false,
  duplicateDatabase: async (id: string) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    demo.completed++;
    return {
      ...collections.find((entry) => entry.id === id)!,
      id: `${id}-copy`,
    };
  },
  unlockManagedDatabase: async () => refuse("unexpected authentication"),
} as unknown as DatabaseActionManager;
demo.advance = () => {
  const next = release;
  release = undefined;
  next?.();
};
DatabaseManager.getInstance = () => manager as unknown as DatabaseManager;
SettingsManager.getInstance = () =>
  ({ getSettings: () => defaultSettings }) as SettingsManager;
const guard = { current: false };
export function View() {
  const initialized = useRef(false);
  const bulk = useDatabaseBulkActions({
    collections,
    context: { manager, flushCurrent: async () => {} },
    refresh: async () => {},
    transitionGuard: guard,
    blocked: false,
  });
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    bulk.select("all");
    demo.ready = true;
  }, [bulk]);
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 3,
          right: 8,
          zIndex: 2147483647,
          padding: "3px 8px",
          fontSize: 11,
          borderRadius: 4,
          background: "#171717",
          color: "#ddd",
        }}
      >
        Demo data — no live connection
      </div>
      <main
        style={{
          padding: "64px 24px",
          minHeight: "100vh",
          background: "var(--color-background)",
          color: "var(--color-text)",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Database Center</h1>
        <p style={{ marginBottom: 20 }}>
          Synthetic databases for interface review. No native storage,
          credentials or vault access.
        </p>
        {view === "unlock" ? (
          <ManagedDatabaseUnlockDialog
            databaseId="demo-1"
            databaseName="Operations database"
            status={{
              kind: "managed",
              securityRevision: "demo-r1",
              dataCipher: "aes-256-gcm",
              unlocked: false,
              slots: [
                {
                  id: "password",
                  type: "password",
                  label: "Recovery password",
                  deviceBound: false,
                },
                {
                  id: "vault",
                  type: "os-vault",
                  label: "This computer",
                  deviceBound: true,
                },
              ],
            }}
            onClose={() => {}}
          />
        ) : (
          <DatabaseBulkControls
            mgr={
              {
                bulk,
                collections,
                isDatabaseUnlocked: () => false,
              } as unknown as Mgr
            }
            visible={collections}
            disabled={false}
          />
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <SettingsContext.Provider
    value={{
      settings: defaultSettings,
      settingsReady: true,
      updateSettings: async () => refuse("settings update"),
      reloadSettings: async () => {},
    }}
  >
    <ToastProvider>
      <View />
    </ToastProvider>
  </SettingsContext.Provider>,
);
