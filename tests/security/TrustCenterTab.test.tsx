import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TrustRecord,
  TrustExportRecord,
} from "../../src/utils/auth/trustStore";

const fixture = vi.hoisted(() => ({
  databaseId: "db-a" as string | null,
  records: [] as TrustRecord[],
  connectionRecords: [] as Array<{
    connectionId: string;
    records: TrustRecord[];
  }>,
  changed: undefined as undefined | (() => void),
  invoke: vi.fn(),
  revoke: vi.fn(),
  remove: vi.fn(),
  policy: vi.fn(),
  tags: vi.fn(),
  rename: vi.fn(),
  hydrate: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("../../src/utils/auth/trustStore", () => ({
  getAllTrustRecords: () => fixture.records,
  getAllPerConnectionTrustRecords: () => fixture.connectionRecords,
  getTrustStoreScope: () => ({
    databaseId: fixture.databaseId,
    resolved: true,
  }),
  refreshTrustStoreScope: vi.fn().mockResolvedValue(undefined),
  retryTrustStoreHydration: fixture.hydrate,
  refreshTrustStoreRecords: fixture.hydrate,
  getTrustRecordStorageKey: (record: TrustRecord) =>
    `${record.type}:${record.host}`,
  parseTrustRecordAddress: (record: TrustRecord) => ({
    host: record.host.split(":")[0],
    port: 443,
  }),
  removeIdentity: fixture.remove,
  setTrustRecordRevoked: fixture.revoke,
  setTrustRecordPolicy: fixture.policy,
  setTrustRecordTags: fixture.tags,
  updateTrustRecordNickname: fixture.rename,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () =>
        fixture.databaseId
          ? { id: fixture.databaseId, name: "Team database" }
          : null,
    }),
  },
  onCurrentDatabaseChange: (callback: () => void) => {
    fixture.changed = callback;
    return () => {
      fixture.changed = undefined;
    };
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [{ id: "connection-1", name: "Production gateway" }],
    },
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => fixture.invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: fixture.open,
  save: fixture.save,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: fixture.read,
  writeTextFile: fixture.write,
  stat: fixture.stat,
}));
import TrustCenterTab from "../../src/components/security/TrustCenterTab";

const record = (host: string, revoked = false): TrustRecord => ({
  host,
  type: "tls",
  revoked,
  userApproved: true,
  identity: {
    fingerprint: `FP-${host}`,
    firstSeen: "2026-01-01",
    lastSeen: "2026-09-01",
    subject: "Internal service",
    issuer: "Company CA",
  },
});
const nativeRecord = (
  host: string,
  fingerprint: string,
  revoked = false,
): TrustExportRecord => ({
  host,
  record_type: "tls",
  identity: {
    kind: "tls",
    fingerprint,
    first_seen: "2026-01-01",
    last_seen: "2026-09-01",
  },
  user_approved: true,
  revoked,
});
async function mount() {
  render(<TrustCenterTab onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.databaseId = "db-a";
  fixture.records = [record("alpha:443"), record("beta:443", true)];
  fixture.connectionRecords = [
    { connectionId: "connection-1", records: [record("gateway:443")] },
  ];
  fixture.hydrate.mockResolvedValue(undefined);
  fixture.revoke.mockResolvedValue(undefined);
  fixture.remove.mockResolvedValue(undefined);
  fixture.rename.mockResolvedValue(undefined);
  fixture.policy.mockResolvedValue(undefined);
  fixture.tags.mockResolvedValue(undefined);
  fixture.stat.mockResolvedValue({ size: 100 });
  fixture.open.mockResolvedValue("fixture-import.json");
  fixture.save.mockResolvedValue("fixture-export.json");
  fixture.read.mockResolvedValue(
    JSON.stringify({
      version: 1,
      records: [nativeRecord("alpha:443", "NEW-FP")],
    }),
  );
  fixture.invoke.mockImplementation(
    async (command: string, args?: { targets?: unknown[] }) => {
      if (command === "trust_apply_reviewed_batch")
        return { updated: args?.targets?.length ?? 0 };
      if (command === "trust_get_summary")
        return {
          total_records: 3,
          revoked_count: 1,
          expired_count: 0,
          total_verifications: 7,
          total_mismatches: 2,
          average_trust_score: 80,
          records_with_history: 1,
        };
      if (command === "trust_get_identity_history")
        return [{ reason: "user_accepted", note: "Verified with operator" }];
      if (command === "trust_get_verification_stats")
        return { total_checks: 7, mismatch_count: 2 };
      if (command === "trust_preview_known_hosts")
        return {
          version: 1,
          records: [nativeRecord("alpha:443", "KNOWN-FP")],
          skipped: 2,
          warnings: [
            "Hashed hosts and certificate-authority entries were skipped.",
          ],
        };
      if (command === "trust_export_database")
        return { version: 1, records: [nativeRecord("alpha:443", "OLD-FP")] };
      return { imported: 1, skipped: 0 };
    },
  );
});
afterEach(cleanup);

describe("dedicated Trust Center", () => {
  it("preserves the Close action for a standalone manager", async () => {
    const onClose = vi.fn();
    render(<TrustCenterTab onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Trust Center" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides only the manager Close action when the tab owns closing", async () => {
    const onClose = vi.fn();
    render(<TrustCenterTab onClose={onClose} showClose={false} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Close Trust Center" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Inspect alpha:443" }),
      );
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bounds large tables and preserves distinct page/all-filtered selection scopes", async () => {
    fixture.records = Array.from({ length: 1_005 }, (_, index) =>
      record(`host-${String(index).padStart(4, "0")}:443`),
    );
    fixture.connectionRecords = [];
    await mount();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    fireEvent.click(screen.getByRole("button", { name: "Select page" }));
    expect(screen.getByText(/100 selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      screen.getByRole("checkbox", { name: "Select identities on this page" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    expect(screen.getByText(/1005 selected/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    fireEvent.click(screen.getByRole("button", { name: "Revoke selected" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1005 identities in Team database",
    );
    expect(fixture.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "1005 identities updated",
      ),
    );
    const batches = fixture.invoke.mock.calls.filter(
      (call) => call[0] === "trust_apply_reviewed_batch",
    );
    expect(batches).toHaveLength(1);
    expect(batches[0][1].targets).toHaveLength(1005);
    expect(
      fixture.invoke.mock.calls.filter(
        (call) => call[0] === "trust_get_summary",
      ),
    ).toHaveLength(2);
  });
  it("searches certificate and connection names, selects visible without selecting hidden records", async () => {
    await mount();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Production gateway" },
    });
    expect(screen.getByText("gateway:443")).toBeInTheDocument();
    expect(screen.queryByText("alpha:443")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Company CA" },
    });
    expect(screen.getByText("alpha:443")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });

  it("does not reinstate before explicit confirmation and binds the reviewed fingerprint", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Reinstate beta:443" }));
    expect(fixture.revoke).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(fixture.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reinstate" }));
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_apply_reviewed_batch",
        {
          databaseId: "db-a",
          action: "reinstate",
          targets: [
            { host: "beta:443", recordType: "tls", fingerprint: "FP-beta:443" },
          ],
        },
      ),
    );
  });

  it("clears selection, details and confirmation when databases switch even with identical names", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect alpha:443" }));
    expect(screen.getByText("Identity — alpha:443")).toBeInTheDocument();
    act(() => {
      fixture.databaseId = "db-b";
      fixture.records = [];
      fixture.connectionRecords = [];
      fixture.changed?.();
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Identity — alpha:443"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
    expect(fixture.revoke).not.toHaveBeenCalled();
  });

  it("reports a rejected atomic batch without claiming partial completion", async () => {
    await mount();
    fixture.invoke.mockRejectedValueOnce(
      new Error("Identity changed; no batch changes were written"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "no batch changes were written",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Identity changed");
    expect(fixture.revoke).not.toHaveBeenCalled();
    expect(
      fixture.invoke.mock.calls.filter(
        (call) => call[0] === "trust_apply_reviewed_batch",
      ),
    ).toHaveLength(1);
  });

  it("reviews conflicting fingerprints and requires acknowledgment before scoped import", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Import identities" }));
    await screen.findByText("Different fingerprint — possible replacement");
    expect(screen.getByText("OLD-FP")).toBeInTheDocument();
    expect(screen.getByText("NEW-FP")).toBeInTheDocument();
    const apply = screen.getByRole("button", {
      name: "Merge reviewed identities",
    });
    expect(apply).toBeDisabled();
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed these fingerprints/ }),
    );
    fireEvent.click(apply);
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_import_database",
        expect.objectContaining({
          databaseId: "db-a",
          mode: "merge",
          expectedRecords: [nativeRecord("alpha:443", "OLD-FP")],
        }),
      ),
    );
    const args = fixture.invoke.mock.calls.find(
      (call) => call[0] === "trust_import_database",
    )?.[1];
    expect(args.document).not.toHaveProperty("policy");
  });

  it("cancels file dialogs without importing, exporting or changing trust", async () => {
    fixture.open.mockResolvedValue(null);
    fixture.save.mockResolvedValue(null);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Import identities" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export all" })).toBeEnabled(),
    );
    expect(fixture.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export all" }));
    await waitFor(() => expect(fixture.save).toHaveBeenCalled());
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
  });

  it("exports only selected identities and no global policy", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select tls alpha:443 Database-wide",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
    await waitFor(() => expect(fixture.write).toHaveBeenCalledTimes(1));
    expect(fixture.invoke).toHaveBeenCalledWith("trust_export_database", {
      databaseId: "db-a",
    });
    expect(JSON.parse(fixture.write.mock.calls[0][1])).toEqual({
      version: 1,
      records: [nativeRecord("alpha:443", "OLD-FP")],
    });
  });

  it("requires review for per-host policy changes and never defaults to trust-all", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Inspect alpha:443" }));
    expect(
      screen.getByRole("combobox", { name: "Per-host verification policy" }),
    ).toHaveValue("inherit");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Per-host verification policy" }),
      { target: { value: "strict" } },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review policy change" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review policy change" }),
    );
    expect(fixture.policy).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Change policy",
      }),
    );
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_apply_reviewed_batch",
        {
          databaseId: "db-a",
          action: "policy",
          targets: [
            {
              host: "alpha:443",
              recordType: "tls",
              fingerprint: "FP-alpha:443",
            },
          ],
          policy: "strict",
        },
      ),
    );
  });

  it("loads native statistics and supports reviewed individual and bulk tag replacement", async () => {
    await mount();
    expect(screen.getByLabelText("Native trust summary")).toHaveTextContent(
      "7 verifications",
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect alpha:443" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review tag replacement" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("list")).toHaveTextContent(
      "Verified with operator",
    );
    expect(fixture.invoke).toHaveBeenCalledWith(
      "trust_get_verification_stats",
      {
        host: "alpha:443",
        recordType: "tls",
        expectedDatabaseId: "db-a",
        expectedFingerprint: "FP-alpha:443",
      },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Identity tags" }), {
      target: { value: "production, reviewed" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review tag replacement" }),
    );
    expect(fixture.tags).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace tags" }));
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_apply_reviewed_batch",
        {
          databaseId: "db-a",
          action: "tags",
          targets: [
            {
              host: "alpha:443",
              recordType: "tls",
              fingerprint: "FP-alpha:443",
            },
          ],
          tags: ["production", "reviewed"],
        },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select all filtered" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Tags for selected identities" }),
      { target: { value: "fleet" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replace selected tags" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace tags" }));
    await waitFor(() =>
      expect(
        fixture.invoke.mock.calls.filter(
          (call) => call[0] === "trust_apply_reviewed_batch",
        ),
      ).toHaveLength(2),
    );
    expect(
      fixture.invoke.mock.calls.filter(
        (call) => call[0] === "trust_apply_reviewed_batch",
      )[1][1],
    ).toEqual(
      expect.objectContaining({
        action: "tags",
        tags: ["fleet"],
        targets: expect.any(Array),
      }),
    );
  });

  it("previews known_hosts without mutating, shows skips and requires reviewed merge", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose known_hosts file" }),
    );
    await screen.findByText("KNOWN-FP");
    expect(fixture.invoke).toHaveBeenCalledWith("trust_preview_known_hosts", {
      path: "fixture-import.json",
    });
    expect(screen.getByText(/2 unsupported or unnamed/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hashed hosts and certificate-authority entries were skipped.",
      ),
    ).toBeInTheDocument();
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_import_known_hosts",
      expect.anything(),
    );
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed these fingerprints/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Merge reviewed identities" }),
    );
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_import_database",
        expect.objectContaining({
          databaseId: "db-a",
          expectedRecords: [nativeRecord("alpha:443", "OLD-FP")],
        }),
      ),
    );
  });

  it("accepts a nested trust export only after review, rejects malformed imports", async () => {
    fixture.read.mockResolvedValueOnce(
      JSON.stringify({
        connections: [],
        trustRecords: {
          version: 1,
          records: [nativeRecord("alpha:443", "NESTED-FP")],
        },
      }),
    );
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Import identities" }));
    await screen.findByText("NESTED-FP");
    fireEvent.click(
      within(screen.getByTestId("trust-import-review")).getByRole("button", {
        name: "Cancel",
      }),
    );
    fixture.read.mockResolvedValueOnce(JSON.stringify({ not: "an export" }));
    fireEvent.click(screen.getByRole("button", { name: "Import identities" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "valid version 1 trust identity export",
      ),
    );
    expect(fixture.invoke).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
  });
});
