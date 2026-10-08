import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import type { ConnectionContextType } from "../../src/contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import type { StorageData } from "../../src/utils/storage/storage";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { emptyDatabaseCredentialVault } from "../../src/utils/security/databaseCredentialVault";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import OriginMfaOriginRepair from "../../src/components/protocol/webBrowser/OriginMfaOriginRepair";

const h = vi.hoisted(() => ({
  currentId: "db-a",
  epoch: 1,
  locked: false,
  active: true,
  saved: null as StorageData | null,
  context: null as ConnectionContextType | null,
  manager: {} as Record<string, unknown>,
  read: vi.fn(),
  save: vi.fn(),
  repaired: vi.fn(),
  overlay: vi.fn(),
  owner: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));

const oldOrigin = "https://analytics.google.com";
const expectedOrigin = "https://accounts.google.com";
const session = {
  id: "tab-a",
  connectionId: "analytics",
  ownerDatabaseId: "db-a",
  protocol: "https",
} as ConnectionSession;
const row = (): Connection => ({
  id: session.connectionId,
  name: "Analytics",
  hostname: "analytics.google.com",
  protocol: "https",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  username: "SYNTHETIC-PRIVATE-USER",
  password: "SYNTHETIC-PRIVATE-PASSWORD",
  basicAuthPassword: "SYNTHETIC-BASIC-PASSWORD",
  httpVerifySsl: true,
  httpApplication: { version: 1, id: "google-analytics", loginMode: "form" },
  httpAutoMfa: {
    version: 1,
    enabled: true,
    totpConfigId: "auth-a",
    challengeId: "google-account-totp",
    origin: oldOrigin,
  },
  totpConfigs: [
    {
      id: "auth-a",
      secret: "SYNTHETIC-TOTP-SECRET",
      issuer: "SYNTHETIC-ISSUER",
      account: "SYNTHETIC-ACCOUNT",
      algorithm: "sha1",
      digits: 6,
      period: 30,
    },
  ],
  credentialSource: { kind: "local" },
});
function Harness({ owner = session }: { owner?: ConnectionSession }) {
  const context = useConnections();
  h.context = context;
  const load = context.loadData;
  useEffect(() => {
    void load("db-a");
  }, [load]);
  const connection = context.state.connections[0];
  return connection ? (
    <OriginMfaOriginRepair
      session={owner}
      connection={connection}
      assertOwner={h.owner}
      onRepaired={h.repaired}
      onOverlayChange={h.overlay}
    />
  ) : null;
}
async function mount(owner = session) {
  const view = render(
    <ConnectionProvider>
      <Harness owner={owner} />
    </ConnectionProvider>,
  );
  await waitFor(() =>
    expect(h.context?.databaseAvailability?.status).toBe("ready"),
  );
  return view;
}
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Review and fix MFA origin" }),
  );
}
function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Approve and save origin" }),
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  h.currentId = "db-a";
  h.epoch = 1;
  h.locked = false;
  h.active = true;
  h.context = null;
  h.saved = {
    connections: [row()],
    settings: {},
    timestamp: 1,
    documents: emptyDatabaseDocuments(),
    credentialVault: emptyDatabaseCredentialVault(),
  };
  h.read.mockReset().mockImplementation(async () => structuredClone(h.saved));
  h.save.mockReset().mockImplementation(async (data: StorageData) => {
    h.saved = JSON.parse(JSON.stringify(data)) as StorageData;
  });
  h.repaired.mockReset();
  h.overlay.mockReset();
  h.owner.mockReset().mockImplementation(() => {
    if (!h.active) throw new Error("inactive");
  });
  h.manager = {
    getCurrentDatabase: () => ({ id: h.currentId }),
    getDatabaseAccessState: () => ({
      status: h.locked ? "suspended" : "ready",
    }),
    onCurrentDatabaseChange: () => () => undefined,
    onDatabaseAccessChange: () => () => undefined,
    registerBeforeDatabaseTransition: () => () => undefined,
    captureCurrentDatabaseDataTarget: (): DatabaseDataTarget => {
      const id = h.currentId,
        epoch = h.epoch;
      let baseline: StorageData | null = null;
      const assertAccessible = () => {
        if (h.locked || h.currentId !== id || h.epoch !== epoch)
          throw new Error("SYNTHETIC-PRIVATE-LEASE");
      };
      return {
        databaseId: id,
        assertAccessible,
        load: async () => {
          assertAccessible();
          baseline = structuredClone(h.saved);
          return structuredClone(h.saved);
        },
        readCurrent: async () => {
          assertAccessible();
          const data = await h.read();
          assertAccessible();
          return data;
        },
        save: async (data) => {
          assertAccessible();
          if (stableJsonStringify(h.saved) !== stableJsonStringify(baseline))
            throw new Error("SYNTHETIC-PRIVATE-CAS");
          await h.save(data);
          assertAccessible();
          baseline = structuredClone(data);
        },
      };
    },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("explicit same-owner MFA origin repair", () => {
  it("shows only validated origins, initially focuses Cancel, and cancellation never saves", async () => {
    await mount();
    open();
    expect(
      screen.getByRole("dialog", { name: "Fix automatic MFA origin" }),
    ).toBeTruthy();
    expect(screen.getByText(oldOrigin)).toBeTruthy();
    expect(screen.getByText(expectedOrigin)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Cancel" }),
      ),
    );
    expect(document.body.textContent).not.toMatch(
      /SYNTHETIC|auth-a|google-account-totp/,
    );
    expect(h.overlay).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.overlay).toHaveBeenLastCalledWith(false);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.repaired).not.toHaveBeenCalled();
  });

  it.each(["local", "vault"] as const)(
    "durably changes only the origin through real Provider normalization/ledger (%s)",
    async (source) => {
      // The loaded row is normalized; protected readback may still contain
      // legacy fields until the next save. Use the real ledger reconciler too.
      h.saved!.connections[0].httpApplication!.realm = "legacy-unused-realm";
      h.save.mockImplementation(async (data: StorageData) => {
        const previous = await reconcileRecordLedger(h.saved!, undefined, {
          mode: "migrate",
        });
        data.recordMetadata = await reconcileRecordLedger(data, previous, {
          mode: "write",
        });
        h.saved = JSON.parse(JSON.stringify(data)) as StorageData;
      });
      if (source === "vault")
        h.saved!.connections[0].credentialSource = {
          kind: "vault",
          credentialId: "00000000-0000-4000-8000-000000000001",
          totpId: "auth-a",
        };
      await mount();
      const original = h.context!.state.connections[0];
      expect(original.httpApplication).not.toHaveProperty("realm");
      const expected = {
        ...original,
        httpAutoMfa: { ...original.httpAutoMfa!, origin: expectedOrigin },
      };
      // Parent's captured UI closure becomes invalid because of this very save.
      h.owner.mockImplementation(() => {
        if (h.context!.state.connections[0] !== original)
          throw new Error("old owner closure");
      });
      h.repaired.mockImplementation(() => {
        expect(h.saved!.connections[0]).toEqual(expected);
        expect(h.context!.state.connections[0]).toEqual(expected);
      });
      open();
      expect(h.save).not.toHaveBeenCalled();
      confirm();
      await waitFor(() => expect(h.repaired).toHaveBeenCalledTimes(1));
      expect(h.save).toHaveBeenCalledTimes(1);
      expect(h.read).toHaveBeenCalledTimes(2);
      expect(h.saved!.connections[0]).toEqual(expected);
      expect(h.saved!.recordMetadata).toBeDefined();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.textContent).not.toContain("SYNTHETIC");
    },
  );

  it.each([
    [
      "disabled consent",
      (c: Connection) => {
        c.httpAutoMfa = { version: 1, enabled: false };
      },
    ],
    [
      "invalid origin",
      (c: Connection) => {
        c.httpAutoMfa!.origin = "https://user:SYNTHETIC@analytics.google.com";
      },
    ],
    [
      "origin with query",
      (c: Connection) => {
        c.httpAutoMfa!.origin = `${oldOrigin}/?token=SYNTHETIC`;
      },
    ],
    [
      "wildcard origin",
      (c: Connection) => {
        c.httpAutoMfa!.origin = "https://*.google.com";
      },
    ],
    [
      "already correct",
      (c: Connection) => {
        c.httpAutoMfa!.origin = expectedOrigin;
      },
    ],
    [
      "unreviewed challenge",
      (c: Connection) => {
        c.httpAutoMfa!.challengeId = "unknown";
      },
    ],
    [
      "invalid profile",
      (c: Connection) => {
        c.httpApplication!.invalid = true;
      },
    ],
    [
      "wrong profile",
      (c: Connection) => {
        c.httpApplication!.id = "grafana";
      },
    ],
    [
      "wrong profile host",
      (c: Connection) => {
        c.hostname = "unreviewed.invalid";
      },
    ],
    [
      "wrong profile port",
      (c: Connection) => {
        c.port = 8443;
      },
    ],
    [
      "manual login",
      (c: Connection) => {
        c.httpApplication!.loginMode = "manual";
      },
    ],
    [
      "HTTP",
      (c: Connection) => {
        c.protocol = "http";
        c.port = 80;
      },
    ],
    [
      "TLS checks disabled",
      (c: Connection) => {
        c.httpVerifySsl = false;
      },
    ],
    [
      "missing authenticator",
      (c: Connection) => {
        c.totpConfigs = [];
      },
    ],
    [
      "duplicate authenticator",
      (c: Connection) => {
        c.totpConfigs!.push({ ...c.totpConfigs![0] });
      },
    ],
    [
      "wrong vault authenticator",
      (c: Connection) => {
        c.credentialSource = {
          kind: "vault",
          credentialId: "00000000-0000-4000-8000-000000000001",
          totpId: "other",
        };
      },
    ],
  ] as const)("does not offer repair for %s", async (_name, invalidate) => {
    invalidate(h.saved!.connections[0]);
    await mount();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).not.toContain("SYNTHETIC");
    expect(h.save).not.toHaveBeenCalled();
  });

  it.each([
    { ...session, ownerDatabaseId: undefined },
    { ...session, ownerDatabaseId: "db-b" },
    { ...session, connectionId: "unsaved" },
    { ...session, reattachOnly: true },
  ])(
    "rejects temporary, wrong-owner, missing saved row and reattachment sessions",
    async (owner) => {
      await mount(owner);
      expect(screen.queryByRole("button")).toBeNull();
      expect(h.save).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "epoch", "lock", "inactive", "row", "unmount"] as const)(
    "rejects %s drift while protected pre-write read is pending",
    async (kind) => {
      const gate = deferred();
      const view = await mount();
      h.read.mockImplementationOnce(async () => {
        await gate.promise;
        return structuredClone(h.saved);
      });
      open();
      confirm();
      await waitFor(() => expect(h.read).toHaveBeenCalledTimes(1));
      if (kind === "owner") h.currentId = "db-b";
      if (kind === "epoch") h.epoch++;
      if (kind === "lock") h.locked = true;
      if (kind === "inactive") h.active = false;
      if (kind === "unmount") view.unmount();
      if (kind === "row")
        act(() =>
          h.context!.dispatch({
            type: "UPDATE_CONNECTION",
            payload: {
              ...h.context!.state.connections[0],
              name: "Concurrent rename",
            },
          }),
        );
      await act(async () => {
        gate.resolve();
        await gate.promise;
      });
      expect(h.save).not.toHaveBeenCalled();
      expect(h.repaired).not.toHaveBeenCalled();
      expect(h.context!.state.connections[0].httpAutoMfa!.origin).toBe(
        oldOrigin,
      );
    },
  );

  it("rejects a protected saved row that differs from the reviewed in-memory row", async () => {
    await mount();
    open();
    h.saved!.connections[0].password = "CONCURRENT-PRIVATE-PASSWORD";
    confirm();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be confirmed saved",
      ),
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(h.repaired).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("CONCURRENT");
  });

  it.each([
    "rejected",
    "missing write",
    "readback rejected",
    "owner after write",
  ] as const)("never reports success after %s", async (kind) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await mount();
    open();
    if (kind === "rejected")
      h.save.mockRejectedValue(new Error("SYNTHETIC-PRIVATE-WRITE"));
    if (kind === "missing write") h.save.mockResolvedValue(undefined);
    if (kind === "readback rejected")
      h.read
        .mockImplementationOnce(async () => structuredClone(h.saved))
        .mockRejectedValue(new Error("SYNTHETIC-PRIVATE-READ"));
    if (kind === "owner after write")
      h.save.mockImplementation(async (data: StorageData) => {
        h.saved = structuredClone(data);
        h.currentId = "db-b";
      });
    confirm();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be confirmed saved",
      ),
    );
    expect(h.repaired).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("SYNTHETIC");
  });

  it("ignores a double approval and waits for durable readback before dismissing", async () => {
    await mount();
    open();
    const gate = deferred();
    h.read
      .mockImplementationOnce(async () => structuredClone(h.saved))
      .mockImplementationOnce(async () => {
        await gate.promise;
        return structuredClone(h.saved);
      });
    confirm();
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.repaired).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(h.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(h.repaired).toHaveBeenCalledTimes(1));
  });
});
