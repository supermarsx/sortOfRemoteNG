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
import { Profiler } from "react";
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
  reassign: vi.fn(),
}));
vi.mock("../../src/utils/auth/trustStore", async (importOriginal) => ({
  decodeNativeHost: (
    await importOriginal<typeof import("../../src/utils/auth/trustStore")>()
  ).decodeNativeHost,
  getAllTrustRecords: () => fixture.records,
  getAllPerConnectionTrustRecords: () => fixture.connectionRecords,
  getTrustStoreScope: () => ({
    databaseId: fixture.databaseId,
    resolved: true,
  }),
  refreshTrustStoreScope: vi.fn().mockResolvedValue(undefined),
  retryTrustStoreHydration: fixture.hydrate,
  refreshTrustStoreRecords: fixture.hydrate,
  // Fixture native keys mirror the cache entries supplied by mocked hydration.
  getTrustRecordStorageKey: (record: TrustRecord, connectionId?: string) =>
    `${record.type}:${connectionId ? `@sorng/connection/v1/${encodeURIComponent(connectionId)}/${encodeURIComponent(record.host.split(":")[0])}/${record.host.split(":")[1]}` : record.host}`,
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
      reassignTrustScope: fixture.reassign,
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
      connections: [
        {
          id: "connection-1",
          name: "Production gateway",
          protocol: "https",
          hostname: "gateway",
          port: 443,
          isGroup: false,
        },
      ],
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
vi.mock("../../src/hooks/security/useTrustedRedirectDestinations", () => ({
  useTrustedRedirectDestinations: () => ({
    rows: [
      {
        id: "redirect",
        connectionId: "connection-1",
        connectionName: "Production gateway",
        sourceOrigin: "https://gateway",
        origin: "https://relay.example",
      },
    ],
    connections: [
      {
        id: "connection-1",
        name: "Production gateway",
        sourceOrigin: "https://gateway",
      },
    ],
    available: true,
    databaseId: "db-a",
    scopeKey: "db-a:1",
    loading: false,
    busy: false,
    error: null,
    notice: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    forget: vi.fn().mockResolvedValue(undefined),
  }),
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
  scopeDecision: {
    userApproved: true,
    revoked,
    trustExpires: null,
    hostPolicy: null,
    hostPolicyConfig: null,
  },
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
/**
 * The import dialog clears its acknowledgment in a passive effect whenever the
 * review changes. When React yields before that effect (a slow frame on a
 * loaded worker), a click made as soon as the review renders is undone by it,
 * so acknowledge again until the checkbox stays checked.
 */
async function acknowledgeReview() {
  const acknowledgment = screen.getByRole<HTMLInputElement>("checkbox", {
    name: /I reviewed these fingerprints/,
  });
  await waitFor(() => {
    if (!acknowledgment.checked) fireEvent.click(acknowledgment);
    expect(acknowledgment).toBeChecked();
  });
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
  fixture.reassign
    .mockReset()
    .mockImplementation(async (_id: string, targets: unknown[]) => ({
      updated: targets.length,
    }));
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
  it("preserves tags and descriptions through native identity export and reviewed import", async () => {
    const exported = {
      ...nativeRecord("alpha:443", "OLD-FP"),
      tags: ["office"],
      description: "Verified cabinet owner",
    };
    const invoke = fixture.invoke.getMockImplementation()!;
    fixture.invoke.mockImplementation(async (command, args) =>
      command === "trust_export_database"
        ? { version: 1, records: [exported] }
        : invoke(command, args),
    );
    fixture.read.mockResolvedValue(
      JSON.stringify({ version: 1, records: [exported] }),
    );
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Export all" }));
    await waitFor(() => expect(fixture.write).toHaveBeenCalledOnce());
    expect(JSON.parse(fixture.write.mock.calls[0][1]).records[0]).toEqual(
      exported,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import identities" }));
    await screen.findByRole("button", { name: "Merge reviewed identities" });
    await acknowledgeReview();
    fireEvent.click(
      screen.getByRole("button", { name: "Merge reviewed identities" }),
    );
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_import_database",
        expect.objectContaining({
          document: { version: 1, records: [exported] },
        }),
      ),
    );
  });
  it.each(["https", "ssh"] as const)(
    "edits searchable %s tags and description atomically without a trust warning",
    async (type) => {
      fixture.records = [
        {
          ...record("alpha:443"),
          type,
          tags: ["old"],
          description: "Old note",
        },
      ];
      const invoke = fixture.invoke.getMockImplementation()!;
      fixture.invoke.mockImplementation(async (command, args) => {
        if (
          command === "trust_apply_reviewed_batch" &&
          args.action === "metadata"
        ) {
          fixture.records = [
            {
              ...fixture.records[0],
              tags: args.metadata.tags,
              description: args.metadata.description ?? undefined,
            },
          ];
          return { updated: 1 };
        }
        return invoke(command, args);
      });
      await mount();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Edit tags and description for alpha:443",
        }),
      );
      const dialog = screen.getByRole("dialog", {
        name: "Edit identity tags and description",
      });
      expect(dialog.querySelector(".sor-modal-body")).toHaveClass(
        "px-5",
        "py-4",
      );
      expect(
        within(dialog).getByLabelText("Identity metadata tags"),
      ).toHaveClass("sor-form-input");
      expect(within(dialog).getByLabelText("Identity description")).toHaveClass(
        "sor-form-textarea",
      );
      fireEvent.change(
        within(dialog).getByLabelText("Identity metadata tags"),
        { target: { value: "production, office, production" } },
      );
      fireEvent.change(within(dialog).getByLabelText("Identity description"), {
        target: { value: "Rack seven owner" },
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save metadata" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", {
            name: "Edit identity tags and description",
          }),
        ).toBeNull(),
      );
      expect(fixture.invoke).toHaveBeenCalledWith(
        "trust_apply_reviewed_batch",
        expect.objectContaining({
          databaseId: "db-a",
          action: "metadata",
          targets: [
            expect.objectContaining({
              recordType: type,
              fingerprint: "FP-alpha:443",
            }),
          ],
          metadata: {
            expectedTags: ["old"],
            expectedDescription: "Old note",
            expectedDecision: record("alpha:443").scopeDecision,
            tags: ["production", "office"],
            description: "Rack seven owner",
          },
        }),
      );
      expect(
        screen.getByText(/Identity tags and description saved/),
      ).toBeVisible();
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.change(screen.getByPlaceholderText(/Search/), {
        target: { value: "rack seven" },
      });
      expect(
        screen.getByRole("button", {
          name: "Edit tags and description for alpha:443",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Inspect gateway:443" }),
      ).toBeNull();
    },
  );
  it("keeps the metadata draft on rejected stale-record save without a success message", async () => {
    const invoke = fixture.invoke.getMockImplementation()!;
    fixture.invoke.mockImplementation(async (command, args) => {
      if (
        command === "trust_apply_reviewed_batch" &&
        args.action === "metadata"
      )
        throw new Error("Identity changed. Refresh and review metadata again.");
      return invoke(command, args);
    });
    await mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit tags and description for alpha:443",
      }),
    );
    fireEvent.change(screen.getByLabelText("Identity description"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("Identity changed"),
    );
    expect(screen.getByLabelText("Identity description")).toHaveValue(
      "Keep this draft",
    );
    expect(
      screen.queryByText(/Identity tags and description saved/),
    ).toBeNull();
  });
  it("discards a metadata editor across database ABA without submitting its draft", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit tags and description for alpha:443",
      }),
    );
    fireEvent.change(screen.getByLabelText("Identity description"), {
      target: { value: "Private old owner note" },
    });
    await act(async () => {
      fixture.databaseId = "db-b";
      fixture.changed?.();
      fixture.databaseId = "db-a";
      fixture.changed?.();
    });
    expect(
      screen.queryByRole("dialog", {
        name: "Edit identity tags and description",
      }),
    ).toBeNull();
    expect(
      fixture.invoke.mock.calls.some(
        ([command, args]) =>
          command === "trust_apply_reviewed_batch" &&
          args.action === "metadata",
      ),
    ).toBe(false);
  });
  it("keeps redirect management independent of a certificate backend failure and shares one close action", async () => {
    fixture.hydrate.mockRejectedValue(
      new Error("Certificate backend unavailable"),
    );
    const close = vi.fn();
    render(<TrustCenterTab onClose={close} />);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Redirect destinations" }),
    );
    expect(screen.getByRole("table")).toHaveTextContent(
      "https://relay.example",
    );
    expect(screen.queryByText("Certificate backend unavailable")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review add" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Close Trust Center" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Certificates & host keys" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Certificate backend unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Trust Center" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("moves a reviewed connection identity to database-wide scope through one captured manager call", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Change scope for gateway:443" }),
    );
    expect(fixture.reassign).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("combobox", { name: "New identity scope" }),
    );
    fireEvent.mouseDown(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: /Database-wide/,
      }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Review identity scope change" }),
      ).getByRole("checkbox"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed scope" }),
    );
    await waitFor(() =>
      expect(fixture.reassign).toHaveBeenCalledExactlyOnceWith(
        "db-a",
        [
          {
            host: "@sorng/connection/v1/connection-1/gateway/443",
            recordType: "tls",
            fingerprint: "FP-gateway:443",
            expectedDecision: {
              userApproved: true,
              revoked: false,
              trustExpires: null,
              hostPolicy: null,
              hostPolicyConfig: null,
            },
          },
        ],
        null,
      ),
    );
    expect(
      fixture.invoke.mock.calls.some(
        ([name]) => name === "trust_apply_reviewed_batch",
      ),
    ).toBe(false);
    await screen.findByText(/1 of 1 reviewed identities changed scope/);
  });
  it("applies the whole selected batch once, surfaces destination conflicts and accepts honest no-op counts", async () => {
    fixture.reassign.mockRejectedValueOnce(
      new Error(
        "Destination already contains a different identity; nothing changed",
      ),
    );
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    const choose = () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Change selected scope" }),
      );
      fireEvent.click(
        screen.getByRole("combobox", { name: "New identity scope" }),
      );
      fireEvent.mouseDown(
        screen.getByRole("option", {
          name: /Production gateway — HTTPS · gateway:443/,
        }),
      );
      fireEvent.click(
        within(
          screen.getByRole("dialog", { name: "Review identity scope change" }),
        ).getByRole("checkbox"),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Apply reviewed scope" }),
      );
    };
    choose();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Destination already contains a different identity",
    );
    expect(fixture.reassign).toHaveBeenCalledTimes(1);
    expect(fixture.reassign.mock.calls[0][1]).toHaveLength(3);
    expect(fixture.reassign.mock.calls[0][2]).toBe("connection-1");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change selected scope" }),
      ).toBeEnabled(),
    );
    fixture.reassign.mockResolvedValueOnce({ updated: 0 });
    choose();
    await screen.findByText(
      /0 of 3 reviewed identities changed scope.*3 already had that scope/,
    );
    expect(fixture.reassign).toHaveBeenCalledTimes(2);
  });
  it("discards a pending scope review when the active database changes", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Change scope for alpha:443" }),
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "New identity scope" }),
    );
    fireEvent.mouseDown(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: /Database-wide/,
      }),
    );
    act(() => {
      fixture.databaseId = "db-b";
      fixture.changed?.();
    });
    expect(
      screen.queryByRole("dialog", { name: "Review identity scope change" }),
    ).not.toBeInTheDocument();
    expect(fixture.reassign).not.toHaveBeenCalled();
  });
  it("blocks duplicate scope mutations while a reviewed move is pending", async () => {
    let finish!: (value: { updated: number }) => void;
    fixture.reassign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all filtered" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change selected scope" }),
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "New identity scope" }),
    );
    fireEvent.mouseDown(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: /Database-wide/,
      }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Review identity scope change" }),
      ).getByRole("checkbox"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed scope" }),
    );
    await waitFor(() => expect(fixture.reassign).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "Change selected scope" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Change selected scope" }),
    );
    expect(fixture.reassign).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ updated: 1 });
    });
    await screen.findByText(
      /1 of 3 reviewed identities changed scope.*2 already had that scope/,
    );
  });
  it("captures advanced security policy before review and refuses missing native decision metadata", async () => {
    const source = fixture.connectionRecords[0].records[0];
    source.scopeDecision = {
      userApproved: true,
      revoked: false,
      trustExpires: "2027-01-01",
      hostPolicy: "conditional-trust",
      hostPolicyConfig: { allowed_networks: ["192.0.2.0/24"] },
    };
    fixture.reassign.mockRejectedValueOnce(
      new Error("Reviewed security decision changed; refresh before moving"),
    );
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Change scope for gateway:443" }),
    );
    source.scopeDecision.hostPolicyConfig!.allowed_networks!.push(
      "198.51.100.0/24",
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "New identity scope" }),
    );
    fireEvent.mouseDown(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: /Database-wide/,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Review identity scope change",
    });
    expect(
      within(dialog).getByText("Policy: conditional-trust"),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed scope" }),
    );
    await screen.findByRole("alert");
    expect(fixture.reassign.mock.calls[0][1][0].expectedDecision).toEqual({
      userApproved: true,
      revoked: false,
      trustExpires: "2027-01-01",
      hostPolicy: "conditional-trust",
      hostPolicyConfig: { allowed_networks: ["192.0.2.0/24"] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviewed security decision changed",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change scope for alpha:443" }),
      ).toBeEnabled(),
    );
    fixture.records[0].scopeDecision = undefined;
    act(() => window.dispatchEvent(new Event("trustStoreChanged")));
    fireEvent.click(
      screen.getByRole("button", { name: "Change scope for alpha:443" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Review identity scope change" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Native reviewed security metadata is unavailable",
    );
    expect(fixture.reassign).toHaveBeenCalledTimes(1);
  });
  it("keeps an inspector opened as its database first becomes ready", async () => {
    let clicked = false;
    render(
      <Profiler
        id="inspect-on-ready"
        onRender={() => {
          const inspect = screen.queryByRole<HTMLButtonElement>("button", {
            name: "Inspect alpha:443",
          });
          // Exercise a click after the ready DOM commit but before its passive
          // scope-reset effect, without relying on scheduler timing or sleeps.
          if (!clicked && inspect && !inspect.disabled) {
            clicked = true;
            inspect.click();
          }
        }}
      >
        <TrustCenterTab onClose={vi.fn()} />
      </Profiler>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review tag replacement" }),
      ).toBeEnabled(),
    );
    expect(clicked).toBe(true);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Identity — alpha:443",
    );
  });

  it("opens Trust settings through its host without closing the manager", async () => {
    const onOpenTrustSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <TrustCenterTab
        onClose={onClose}
        showClose={false}
        onOpenTrustSettings={onOpenTrustSettings}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Trust settings" }));
    expect(onOpenTrustSettings).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
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

  // The 1,005-row fixture is inherent: the bounded page DOM is what this test
  // proves. Role queries across a page of row actions dominate the runtime, so
  // they are scoped to the owning toolbar, pager or dialog. It takes ~3 s
  // unloaded, and CI coverage workers run 2-4x slower than that.
  it("bounds large tables and preserves distinct page/all-filtered selection scopes", async () => {
    fixture.records = Array.from({ length: 1_005 }, (_, index) =>
      record(`host-${String(index).padStart(4, "0")}:443`),
    );
    fixture.connectionRecords = [];
    await mount();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    fireEvent.click(screen.getByText("Select page", { selector: "button" }));
    expect(screen.getByText(/100 selected/)).toBeInTheDocument();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Trust identity pages" }),
      ).getByRole("button", { name: "Next page" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select identities on this page" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByText("Select all filtered", { selector: "button" }),
    );
    expect(screen.getByText(/1005 selected/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Selected identity actions" }),
      ).getByRole("button", { name: "Revoke selected" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1005 identities in Team database",
    );
    expect(fixture.revoke).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
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
  }, 20_000);
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
    await acknowledgeReview();
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
    await acknowledgeReview();
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
