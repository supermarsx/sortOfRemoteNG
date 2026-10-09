import { describe, expect, it } from "vitest";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { selectDetachedSessionConnections } from "../../src/utils/session/detachedSessionConnections";

const session: ConnectionSession = {
  id: "session-a",
  connectionId: "shared-id",
  ownerDatabaseId: "database-a",
  name: "Website",
  protocol: "https",
  hostname: "https://fixture.invalid/",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
};
const connection: Connection = {
  id: session.connectionId,
  name: "Website",
  protocol: "https",
  hostname: session.hostname,
  port: 443,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const available: DatabaseAvailability = {
  databaseId: "database-a",
  status: "ready",
  generation: 1,
};

describe("detached session connection ownership", () => {
  it("sends only the exact owner's requested rows, including multiple tabs of one connection", () => {
    expect(
      selectDetachedSessionConnections(
        [session, { ...session, id: "second-tab" }],
        [connection, { ...connection, id: "unrelated" }],
        available,
      ),
    ).toEqual([connection]);
  });

  it.each(["none", "loading", "suspended", "error"] as const)(
    "withholds saved rows while database availability is %s",
    (status) => {
      expect(
        selectDetachedSessionConnections([session], [connection], {
          ...available,
          status,
        }),
      ).toEqual([]);
    },
  );

  it("does not substitute another database's local credential row with the same ID", () => {
    const foreign = {
      ...connection,
      credentialSource: { kind: "local" as const },
      password: "fixture-other-database-secret",
    };
    expect(
      selectDetachedSessionConnections([session], [foreign], {
        ...available,
        databaseId: "database-b",
      }),
    ).toEqual([]);
  });

  it("requires both an explicit session owner and authoritative availability", () => {
    expect(
      selectDetachedSessionConnections([session], [connection], undefined),
    ).toEqual([]);
    expect(
      selectDetachedSessionConnections(
        [{ ...session, ownerDatabaseId: undefined }],
        [connection],
        available,
      ),
    ).toEqual([]);
  });

  it("withholds ambiguous IDs shared by tabs from different databases", () => {
    expect(
      selectDetachedSessionConnections(
        [
          session,
          { ...session, id: "foreign-tab", ownerDatabaseId: "database-b" },
        ],
        [connection],
        available,
      ),
    ).toEqual([]);
  });

  it("does not select one of multiple saved rows with the same ID", () => {
    expect(
      selectDetachedSessionConnections(
        [session],
        [connection, { ...connection, hostname: "https://other.invalid/" }],
        available,
      ),
    ).toEqual([]);
  });
});
