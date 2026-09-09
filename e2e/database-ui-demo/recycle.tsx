import React, { useEffect } from "react";
import { demo, refuse } from "./boundary";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import ConnectionRecycleBinTab from "../../src/components/connection/ConnectionRecycleBinTab";
import ConnectionRecycleBinSection from "../../src/components/SettingsDialog/sections/security/ConnectionRecycleBinSection";
import type {
  ConnectionRecycleBinApi,
  RecycleBinReview,
} from "../../src/types/connection/recycleBin";

const scope = {
  databaseId: "demo-1",
  generation: 1,
  revision: "synthetic-review-1",
};
const review = (
  kind: "purge" | "retention",
  count: number,
): RecycleBinReview => ({
  kind,
  scope,
  token: "synthetic-no-persistence",
  entryCount: count,
  expiresAt: Date.now() + 120_000,
});
const api: ConnectionRecycleBinApi = {
  snapshot: {
    scope,
    policy: { mode: "days", days: 15 },
    entries: Array.from({ length: 64 }, (_, index) => ({
      id: `deleted-${index}`,
      connectionId: `example-${index}`,
      batchId: `batch-${index}`,
      name: `${["Operations jump host", "Office workstation", "Network dashboard", "Retired lab folder"][index % 4]} ${index + 1}`,
      protocol: ["ssh", "rdp", "https", "ssh"][index % 4],
      isGroup: index % 4 === 3,
      parentName: ["Infrastructure", "Service desk", "Networking", "Lab"][
        index % 4
      ],
      deletedAt: Date.UTC(2026, 8, 1 + (index % 7), 10, 30),
      expiresAt: Date.UTC(2026, 8, 16 + (index % 7), 10, 30),
      descendantCount: index % 4 === 3 ? 4 : 0,
    })),
  },
  busy: false,
  archive: async () => refuse("archive mutation"),
  restore: async () => refuse("restore mutation"),
  commitReview: async () => refuse("review commit"),
  cancelReview: () => {},
  reviewPurge: async (ids) => review("purge", ids?.length ?? 64),
  reviewRetention: async (policy) => ({
    ...review("retention", policy.mode === "days" && policy.days < 15 ? 12 : 0),
    policy,
  }),
};
const context = { recycleBin: api } as ConnectionContextType;
export function RecycleDemo({ retention }: { retention: boolean }) {
  useEffect(() => {
    demo.ready = true;
  }, []);
  return (
    <ConnectionContext.Provider value={context}>
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
          height: "100vh",
          padding: "30px 0 0",
          minWidth: 0,
          background: "var(--color-background)",
          color: "var(--color-text)",
        }}
      >
        {retention ? (
          <div className="p-4 max-w-3xl mx-auto">
            <ConnectionRecycleBinSection />
          </div>
        ) : (
          <ConnectionRecycleBinTab databaseId="demo-1" />
        )}
      </main>
    </ConnectionContext.Provider>
  );
}
