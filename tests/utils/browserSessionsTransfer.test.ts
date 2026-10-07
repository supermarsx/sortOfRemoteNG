import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseProtection } from "../../src/utils/connection/databaseProtection";
import { normalizeBrowserSessionDeletions } from "../../src/utils/security/browserSessions";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));

const selected = {
  version: 1 as const,
  records: [{ connectionId: "kept", revision: "a".repeat(64) }],
};
const empty = { version: 1 as const, records: [] };
const body = () => ({ connections: [], settings: {}, timestamp: 0 });
const request = () => ({
  databaseId: "destination",
  sessionId: "grant",
  expectedSecurityRevision: "revision",
  selected: structuredClone(selected),
  expected: structuredClone(empty),
  data: { ...body(), browserSessions: structuredClone(selected) },
  expectedData: body(),
  transfer: { version: 1 as const, ciphertext: "SYNTHETIC_SEALED_CAPSULE" },
  password: "archive-transfer-password",
});
const committed = () => ({
  committed: true,
  cleanupPending: false,
  warnings: [],
  securityRevision: "revision",
});
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(committed());
});

describe("native combined browser-session transfer adapter (mocked IPC, not runtime acceptance)", () => {
  it("describes only the frozen public metadata with an explicit owner grant", async () => {
    bridge.invoke.mockResolvedValue(selected);
    await expect(
      databaseProtection.describeBrowserSessions("db", "grant", "revision"),
    ).resolves.toEqual(selected);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      "database_browser_sessions_describe",
      {
        databaseId: "db",
        sessionId: "grant",
        expectedSecurityRevision: "revision",
      },
    );
    bridge.invoke.mockResolvedValue({
      ...selected,
      cookies: "SYNTHETIC_PRIVATE",
    });
    await expect(
      databaseProtection.describeBrowserSessions("db", "grant", "revision"),
    ).rejects.toThrow(/Browser session data/);
  });
  it("submits body, exact public CAS baseline and opaque capsule in one command", async () => {
    const input = request();
    await expect(
      databaseProtection.importBrowserSessions(input),
    ).resolves.toEqual(committed());
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_import",
      {
        ...input,
        deletedConnectionIds: [],
      },
    );
  });

  it("freezes selection, capsule and both bodies before awaiting IPC", async () => {
    const input = request();
    const before = structuredClone(input);
    const pending = databaseProtection.importBrowserSessions(input);
    input.selected.records[0].revision = "b".repeat(64);
    input.transfer.ciphertext = "CHANGED_CAPSULE";
    input.data.timestamp = 999;
    input.expectedData.timestamp = 888;
    await pending;
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_import",
      { ...before, deletedConnectionIds: [] },
    );
  });

  it("carries explicit authenticated deletion and its destination revision in the same CAS", async () => {
    const input = {
      ...request(),
      selected: empty,
      data: body(),
      expected: selected,
      deletedConnectionIds: ["kept"],
    };
    await databaseProtection.importBrowserSessions(input);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_import",
      input,
    );
  });

  it.each([["kept"], ["deleted", "deleted"], ["__proto__"], ["bad\u0000id"]])(
    "rejects ambiguous/unsafe deletion lists before IPC (%j)",
    async (...ids) => {
      // Vitest expands each table row; wrap it back into the candidate ID list.
      const deletedConnectionIds = ids.flat() as string[];
      await expect(
        databaseProtection.importBrowserSessions({
          ...request(),
          deletedConnectionIds,
        }),
      ).rejects.toThrow();
      expect(bridge.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects sparse and accessor deletion arrays without running accessors", () => {
    const getter = vi.fn(() => "deleted");
    const ids = Object.defineProperty(["deleted"], "0", { get: getter });
    expect(() => normalizeBrowserSessionDeletions(ids, empty)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      normalizeBrowserSessionDeletions(new Array(2), empty),
    ).toThrow();
  });

  it("does not accept expected revisions for untouched connections", async () => {
    await expect(
      databaseProtection.importBrowserSessions({
        ...request(),
        expected: {
          version: 1,
          records: [{ connectionId: "untouched", revision: "b".repeat(64) }],
        },
      }),
    ).rejects.toThrow();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it.each(["data", "expectedData"] as const)(
    "blocks private fields in %s before IPC",
    async (field) => {
      const input = request();
      Object.assign(input[field], {
        _nativeBrowserSessions: "SYNTHETIC_SECRET",
      });
      await expect(
        databaseProtection.importBrowserSessions(input),
      ).rejects.toThrow(/Native-private/);
      expect(bridge.invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { ...committed(), committed: false },
    { ...committed(), securityRevision: "stale" },
  ])(
    "never reports an unconfirmed native response as success (%j)",
    async (response) => {
      bridge.invoke.mockResolvedValue(response);
      await expect(
        databaseProtection.importBrowserSessions(request()),
      ).rejects.toMatchObject({ kind: "partial" });
      expect(bridge.invoke).toHaveBeenCalledTimes(1);
    },
  );

  it("sanitizes a failed/lost response without claiming no commit occurred or falling back", async () => {
    bridge.invoke.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_COOKIE"));
    await expect(
      databaseProtection.importBrowserSessions(request()),
    ).rejects.toThrow(/could not be confirmed/);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves committed-with-cleanup status but does not expose arbitrary native diagnostics", async () => {
    bridge.invoke.mockResolvedValue({
      ...committed(),
      cleanupPending: true,
      warnings: ["SYNTHETIC_PRIVATE_PATH"],
    });
    const result = await databaseProtection.importBrowserSessions(request());
    expect(result.committed).toBe(true);
    expect(result.cleanupPending).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
  });

  it("passes sorted explicit deletion IDs to native export, never a cookie field", async () => {
    const transfer = request().transfer;
    bridge.invoke.mockResolvedValue(transfer);
    await databaseProtection.exportBrowserSessions(
      "source",
      "grant",
      "revision",
      selected,
      "transfer-password",
      ["z", "a"],
    );
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_export",
      {
        databaseId: "source",
        sessionId: "grant",
        expectedSecurityRevision: "revision",
        selected,
        password: "transfer-password",
        deletedConnectionIds: ["a", "z"],
      },
    );
  });
});
