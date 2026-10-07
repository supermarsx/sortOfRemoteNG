import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConflictResolutionSection from "../../src/components/SettingsDialog/sections/cloudSync/ConflictResolutionSection";
import SyncStatusOverview from "../../src/components/SettingsDialog/sections/cloudSync/SyncStatusOverview";
import { useCloudSyncSettings } from "../../src/hooks/settings/useCloudSyncSettings";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { CloudSyncConflictReview } from "../../src/utils/services/cloudSyncConflictReview";
import type { CloudSyncOperationResult } from "../../src/utils/services/cloudSyncService";
import {
  beginCloudSyncActivity,
  cloudSyncTargetIdentity,
  invalidateCloudSyncTarget,
} from "../../src/utils/services/cloudSyncActivity";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  resolve: vi.fn(),
  sync: vi.fn(),
  test: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../src/utils/services/cloudSyncEngine", () => ({}));
vi.mock("../../src/utils/services/cloudSyncService", async (actual) => ({
  ...(await actual<object>()),
  reviewCloudSyncTarget: mocks.review,
  resolveCloudSyncTarget: mocks.resolve,
  syncCloudTargets: mocks.sync,
  testCloudSyncTarget: mocks.test,
}));
vi.mock("../../src/components/ui/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));

function config(): CloudSyncConfig {
  return {
    ...defaultCloudSyncConfig,
    enabled: true,
    selectedItems: ["settings", "scripts", "connections"],
    syncTargets: [
      {
        id: "work",
        label: "Work",
        provider: "nextcloud",
        enabled: true,
        nextcloud: {
          serverUrl: "https://example.test",
          username: "user",
          folderPath: "/work",
          useAppPassword: true,
          appPassword: "private-secret",
        },
      },
      { id: "home", label: "Home", provider: "nextcloud", enabled: true },
      { id: "off", label: "Off", provider: "nextcloud", enabled: false },
    ],
    targetStatus: {
      work: {
        provider: "nextcloud",
        lastSyncTime: 1,
        lastSyncStatus: "conflict",
        lastSyncError: "Earlier concurrent edits need review.",
      },
      home: {
        provider: "nextcloud",
        lastSyncTime: 2,
        lastSyncStatus: "failed",
        lastSyncError: "Home offline",
      },
    },
  };
}

function review(targetId = "work"): CloudSyncConflictReview {
  return {
    targetId,
    requestIdentity: cloudSyncTargetIdentity(targetId),
    reviewKey: "private-receipt-key",
    items: [
      {
        id: "settings",
        label: "Application settings",
        state: "conflict",
        localBytes: 2048,
        remoteBytes: 3072,
        smartMergeAvailable: true,
      },
      {
        id: "scripts",
        label: "Scripts",
        state: "conflict",
        localBytes: 100,
        remoteBytes: 200,
        smartMergeAvailable: false,
        reason: "Overlapping changes require a choice.",
      },
      {
        id: "connections",
        label: "Connections",
        state: "remote",
        localBytes: 0,
        remoteBytes: 400,
        smartMergeAvailable: false,
      },
      {
        id: "shortcuts",
        label: "Shortcuts",
        state: "local",
        localBytes: 80,
        remoteBytes: 0,
        smartMergeAvailable: false,
      },
      {
        id: "tags",
        label: "Tags",
        state: "same",
        localBytes: 20,
        remoteBytes: 20,
        smartMergeAvailable: false,
      },
    ],
  };
}

function result(
  status: CloudSyncOperationResult["status"] = "success",
): CloudSyncOperationResult {
  return {
    targetId: "work",
    provider: "nextcloud",
    requestIdentity: cloudSyncTargetIdentity("work"),
    status,
    message: "Done",
  };
}

function matchingReview(): CloudSyncConflictReview {
  const receipt = review();
  receipt.items = receipt.items.map((item) => ({
    ...item,
    state: "same",
    smartMergeAvailable: false,
  }));
  return receipt;
}

function reconciliationReview(): CloudSyncConflictReview {
  const receipt = review();
  receipt.items[1].historyReconciliationAvailable = true;
  receipt.items[1].conflicts = [
    { code: "history-unrelated", kind: "other", count: 1 },
  ];
  return receipt;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Harness({ overview = false }: { overview?: boolean }) {
  const [settings, setSettings] = useState({
    cloudSync: config(),
  } as GlobalSettings);
  const mgr = useCloudSyncSettings(settings, (updates) => {
    mocks.update(updates);
    setSettings((previous) => ({ ...previous, ...updates }));
  });
  return (
    <>
      {overview && <SyncStatusOverview mgr={mgr} />}
      <ConflictResolutionSection mgr={mgr} />
    </>
  );
}

function hookWithConfig(initial = config()) {
  return renderHook(
    ({ cloudSync }) =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, mocks.update),
    { initialProps: { cloudSync: initial } },
  );
}

async function openReview() {
  fireEvent.click(
    screen.getByRole("button", { name: "Review conflicts for Work" }),
  );
  await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
}

function choose(label: string, option: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: `Resolution for ${label}` }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.review.mockImplementation(async (target) => review(target.id));
  mocks.resolve.mockImplementation(async () => result());
});
afterEach(cleanup);

describe("cloud sync conflict review UI", () => {
  it("verifies matching copies and clears the stale target conflict without choosing a winner", async () => {
    const receipt = matchingReview();
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness overview />);
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Conflict review for Work" }),
      ).getByRole("button", { name: "Review conflicts for Work" }),
    );
    await screen.findByText(
      "All reviewed copies are already identical. The previous conflict is cleared.",
    );
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      config().syncTargets![0],
      config(),
      receipt,
      {},
    );
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Success");
    expect(
      screen.queryByText("Conflicts need review."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review conflicts for Work" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("5 artifacts · 0 conflicts")).toBeInTheDocument();
    const persisted = mocks.update.mock.lastCall![0].cloudSync;
    expect(persisted.targetStatus.work.lastSyncStatus).toBe("success");
    expect(persisted.targetStatus.work.lastSyncError).toBeUndefined();
    expect(persisted.targetStatus.home).toEqual(config().targetStatus!.home);
    expect(persisted.conflictResolution).toBe("askEveryTime");
    expect(JSON.stringify(persisted)).not.toMatch(
      /private-receipt-key|reviewKey|smartMergeAvailable|choices/,
    );
  });

  it("retains a real conflict if verification detects newer data", async () => {
    const pending = deferred<CloudSyncOperationResult>();
    mocks.review.mockResolvedValueOnce(matchingReview());
    mocks.resolve.mockReturnValueOnce(pending.promise);
    render(<Harness overview />);
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Conflict review for Work" }),
      ).getByRole("button", { name: "Review conflicts for Work" }),
    );
    await screen.findByText(/Verifying before clearing the previous conflict/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Last attempt: Conflict");
    expect(screen.getByText("Last attempt error details")).toBeInTheDocument();
    expect(
      screen.getByText("Earlier concurrent edits need review."),
    ).toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        ...result("conflict"),
        message: "Newer edits require review.",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Newer edits require review",
    );
    expect(screen.getByText("Conflicts need review.")).toBeInTheDocument();
    expect(
      mocks.update.mock.lastCall![0].cloudSync.targetStatus.work.lastSyncStatus,
    ).toBe("conflict");
    expect(mocks.resolve).toHaveBeenCalledOnce();
  });

  it("keeps one-sided changes pending until explicitly synced, without claiming a current conflict", async () => {
    const receipt = review();
    receipt.items = receipt.items.filter((item) => item.state !== "conflict");
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness overview />);
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Conflict review for Work" }),
      ).getByRole("button", { name: "Review conflicts for Work" }),
    );
    await screen.findByText(
      "No conflicts found in this review. One-sided changes still need syncing.",
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Conflicts need review."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Last attempt: Conflict");
    expect(screen.getByText("Last attempt error details")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Sync reviewed changes for Work" }),
    );
    await screen.findByText("Reviewed choices applied.");
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      config().syncTargets![0],
      config(),
      receipt,
      {},
    );
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Success");
  });

  it("does not clear a previous conflict from an empty review", async () => {
    mocks.review.mockResolvedValueOnce({ ...review(), items: [] });
    render(<Harness />);
    await openReview();
    expect(screen.getByText(/No artifacts were reviewed/)).toBeInTheDocument();
    expect(screen.getByText("Conflicts need review.")).toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("expands conflict details by default and collapses other artifacts with an accessible disclosure", async () => {
    const receipt = review();
    for (const item of receipt.items)
      item.details = {
        records: [],
        hasBaseline: false,
        comparisonLimited: false,
        otherDifferences: false,
      };
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness />);
    await openReview();
    for (const item of receipt.items) {
      const artifact = screen.getByRole("listitem", { name: item.label });
      const summary = within(artifact).getByText(
        "Record comparison and merge details",
      );
      const disclosure = summary.closest("details")!;
      expect(disclosure.open).toBe(item.state === "conflict");
      fireEvent.click(summary);
      expect(disclosure.open).toBe(item.state !== "conflict");
    }
  });

  it("uses singular artifact and conflict counts for one conflict", async () => {
    const receipt = review();
    receipt.items = receipt.items.slice(0, 1);
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness />);
    await openReview();
    expect(screen.getByText("1 artifact · 1 conflict")).toBeInTheDocument();
  });

  it("keeps one visible blocker list above the record counts when comparison details are collapsed", async () => {
    const receipt = review();
    receipt.items[1].details = {
      records: [
        {
          kind: "terminalScripts",
          local: 5,
          remote: 5,
          localOnly: 0,
          remoteOnly: 0,
          different: 5,
          same: 0,
          reordered: false,
        },
      ],
      hasBaseline: true,
      comparisonLimited: false,
      otherDifferences: true,
    };
    receipt.items[1].conflicts = [
      { code: "history-incompatible", kind: "other", count: 1 },
      { code: "concurrent-edit", kind: "terminalScripts", count: 2 },
    ];
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness />);
    await openReview();
    const artifact = within(screen.getByRole("listitem", { name: "Scripts" }));
    const heading = artifact.getByRole("heading", { name: "Merge blockers" });
    const blockers = artifact.getByRole("list", {
      name: "Merge blockers for Scripts",
    });
    const table = artifact.getByRole("table", {
      name: "Record comparison for Scripts",
    });
    const summary = artifact.getByText("Record comparison and merge details");
    const disclosure = summary.closest("details")!;
    expect(heading).toBeVisible();
    expect(
      heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(blockers).toBeVisible();
    expect(within(blockers).getAllByRole("listitem")).toHaveLength(2);
    expect(blockers).toHaveTextContent("1 reported blocker");
    expect(blockers).toHaveTextContent("2 reported blockers");

    fireEvent.click(summary);
    expect(disclosure.open).toBe(false);
    expect(table).not.toBeVisible();
    expect(heading).toBeVisible();
    expect(blockers).toBeVisible();
    expect(
      artifact.getByText(/The record histories cannot be safely combined/),
    ).toBeVisible();
    expect(
      artifact.getByText(/Both copies edited the same record/),
    ).toBeVisible();
    expect(
      artifact.getByText(/Refresh review to run the current history checks/),
    ).toBeVisible();
    expect(
      artifact.getByText(/Compare the affected category in both copies/),
    ).toBeVisible();
    expect(
      artifact.getByText(/These counts are reported blockers/),
    ).toBeVisible();
    expect(artifact.getByText(/History validation stops/)).toBeVisible();
    expect(artifact.getByText(/replaces the entire artifact/)).toBeVisible();
    expect(blockers.closest("details")).toBeNull();

    fireEvent.click(summary);
    expect(table).toBeVisible();
    expect(
      artifact.getAllByRole("list", { name: "Merge blockers for Scripts" }),
    ).toHaveLength(1);
    expect(
      artifact.getAllByRole("heading", { name: "Merge blockers" }),
    ).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(
      /private-secret|private-receipt-key/,
    );
  });

  it("previews summaries, makes every conflict explicit, and cancels without a write", async () => {
    render(<Harness />);
    expect(
      screen.queryByRole("group", { name: "Conflict review for Off" }),
    ).not.toBeInTheDocument();
    await openReview();
    expect(screen.getByText("5 artifacts · 2 conflicts")).toBeInTheDocument();
    expect(
      screen.getByText(/Local: 2.0 KiB · Remote: 3.0 KiB/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Remote changes — will download/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Local changes — will upload/)).toBeInTheDocument();
    expect(screen.getByText(/Same on both sides/)).toBeInTheDocument();
    expect(
      screen.queryByText(/private-secret|private-receipt-key/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    choose("Application settings", "Keep local");
    expect(
      screen.getByText(/Replaces this artifact on the remote target/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
    expect(
      screen.queryByRole("list", { name: "Reviewed artifacts for Work" }),
    ).not.toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    await openReview();
    expect(mocks.review).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
  });

  it("offers smart merge only where available and applies mixed choices to one target", async () => {
    render(<Harness />);
    await openReview();
    choose("Application settings", "Smart merge");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Resolution for Scripts" }),
    );
    expect(
      screen.queryByRole("option", { name: "Smart merge" }),
    ).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Keep remote" }));
    expect(
      screen.getByText(/Replaces this artifact's local data/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Merges compatible changes and updates this artifact/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    );
    await screen.findByText("Reviewed choices applied.");
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      config().syncTargets![0],
      config(),
      review(),
      { settings: "smartMerge", scripts: "keepRemote" },
    );
    const persisted = mocks.update.mock.lastCall![0].cloudSync;
    expect(persisted.conflictResolution).toBe("askEveryTime");
    expect(persisted.targetStatus.home).toEqual(config().targetStatus!.home);
    expect(persisted.targetStatus.work.lastSyncStatus).toBe("success");
    expect(JSON.stringify(persisted)).not.toMatch(
      /reviewKey|requestIdentity|private-receipt-key|smartMergeAvailable|choices/,
    );
    expect(
      screen.queryByRole("button", { name: "Apply reviewed choices" }),
    ).not.toBeInTheDocument();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    "does not infer history reconciliation from a baseline or blocker when availability is %s",
    async (available) => {
      const receipt = reconciliationReview();
      receipt.items[1].historyReconciliationAvailable = available;
      receipt.items[1].details = {
        records: [],
        hasBaseline: true,
        comparisonLimited: false,
        otherDifferences: true,
      };
      mocks.review.mockResolvedValueOnce(receipt);
      render(<Harness />);
      await openReview();
      fireEvent.click(
        screen.getByRole("combobox", { name: "Resolution for Scripts" }),
      );
      expect(
        screen.queryByRole("option", {
          name: "Reconcile histories and merge",
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Keep local" })).toBeVisible();
      expect(screen.getByRole("option", { name: "Keep remote" })).toBeVisible();
      expect(screen.queryByText(/supports record history v3/)).toBeNull();
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );

  it("offers eligible history reconciliation only as an explicit reviewed choice, preserving ordinary choices and strategy", async () => {
    const receipt = reconciliationReview();
    mocks.review.mockResolvedValueOnce(receipt);
    render(<Harness />);
    await openReview();
    const resolution = screen.getByRole("combobox", {
      name: "Resolution for Scripts",
    });
    expect(resolution).toHaveTextContent("Choose a resolution");
    const helper = screen.getByText(/combines only baseline-verified/);
    expect(helper).toBeVisible();
    expect(helper).toHaveTextContent("preserves both recorded histories");
    expect(helper).toHaveTextContent(
      "does not choose the newest copy by dates",
    );
    expect(helper).toHaveTextContent(
      "All syncing devices need an updated app that supports record history v3",
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    // This repair must never become an automatic/global strategy.
    const strategy = screen.getByText("Ask Every Time").closest("button")!;
    fireEvent.click(strategy);
    expect(
      screen.queryByRole("option", { name: "Reconcile histories and merge" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(strategy, { key: "Escape" });

    fireEvent.click(resolution);
    expect(screen.getByRole("option", { name: "Keep local" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Keep remote" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Smart merge" })).toBeNull();
    expect(
      screen.getByRole("option", { name: "Reconcile histories and merge" }),
    ).toHaveAttribute("aria-selected", "false");
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Reconcile histories and merge" }),
    );
    expect(resolution).toHaveTextContent("Reconcile histories and merge");
    expect(
      screen.getByText(
        /updates this artifact locally and on the remote target with the baseline-verified merge/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    choose("Application settings", "Smart merge");
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeEnabled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    );
    await screen.findByText("Reviewed choices applied.");
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      config().syncTargets![0],
      config(),
      receipt,
      { settings: "smartMerge", scripts: "reconcileHistory" },
    );
    expect(mocks.sync).not.toHaveBeenCalled();
    const persisted = mocks.update.mock.lastCall![0].cloudSync;
    expect(persisted.conflictResolution).toBe("askEveryTime");
    expect(persisted.targetStatus.home).toEqual(config().targetStatus!.home);
    expect(JSON.stringify(persisted)).not.toMatch(
      /reconcileHistory|historyReconciliationAvailable|reviewKey|choices/,
    );
    expect(document.body.textContent).not.toMatch(
      /private-secret|private-receipt-key/,
    );
  });

  it.each(["same", "local", "remote"] as const)(
    "does not offer reconciliation for a %s artifact even if its flag is set",
    async (state) => {
      const receipt = reconciliationReview();
      receipt.items[1].state = state;
      mocks.review.mockResolvedValueOnce(receipt);
      render(<Harness />);
      await openReview();
      expect(
        screen.queryByRole("combobox", { name: "Resolution for Scripts" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/supports record history v3/)).toBeNull();
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );

  it("drops the reconciliation selection when a refreshed review no longer allows it", async () => {
    mocks.review.mockResolvedValueOnce(reconciliationReview());
    render(<Harness />);
    await openReview();
    choose("Application settings", "Keep local");
    choose("Scripts", "Reconcile histories and merge");
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh review for Work" }),
    );
    await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
    expect(
      screen.getByRole("combobox", { name: "Resolution for Scripts" }),
    ).toHaveTextContent("Choose a resolution");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Resolution for Scripts" }),
    );
    expect(
      screen.queryByRole("option", { name: "Reconcile histories and merge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("cancels a selected reconciliation without applying or remembering it", async () => {
    mocks.review.mockResolvedValue(reconciliationReview());
    render(<Harness />);
    await openReview();
    choose("Application settings", "Keep local");
    choose("Scripts", "Reconcile histories and merge");
    fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
    await openReview();
    expect(
      screen.getByRole("combobox", { name: "Resolution for Scripts" }),
    ).toHaveTextContent("Choose a resolution");
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["conflict", "partial", "failed"] as const)(
    "never replays history reconciliation after a %s apply result",
    async (status) => {
      const receipt = reconciliationReview();
      mocks.review.mockResolvedValue(receipt);
      mocks.resolve.mockResolvedValue({
        ...result(status),
        message: "Refresh the conflict review before trying again.",
      });
      render(<Harness />);
      await openReview();
      choose("Application settings", "Keep local");
      choose("Scripts", "Reconcile histories and merge");
      fireEvent.click(
        screen.getByRole("button", { name: "Apply reviewed choices" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Refresh the conflict review",
      );
      expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
        config().syncTargets![0],
        config(),
        receipt,
        { settings: "keepLocal", scripts: "reconcileHistory" },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh review for Work" }),
      );
      await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
      expect(
        screen.getByRole("combobox", { name: "Resolution for Scripts" }),
      ).toHaveTextContent("Choose a resolution");
      expect(
        screen.getByRole("button", { name: "Apply reviewed choices" }),
      ).toBeDisabled();
      expect(mocks.resolve).toHaveBeenCalledOnce();
      expect(mocks.update.mock.lastCall![0].cloudSync.conflictResolution).toBe(
        "askEveryTime",
      );
    },
  );

  it("opens and focuses the review section from the status panel", async () => {
    render(<Harness overview />);
    const status = within(
      screen.getByRole("list", { name: "Target sync status" }),
    );
    fireEvent.click(
      status.getByRole("button", { name: "Review conflicts for Work" }),
    );
    await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
    expect(
      screen.getByRole("region", { name: "Conflict Resolution" }),
    ).toHaveFocus();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("refocuses same-target shortcuts only when a new review starts", async () => {
    render(<Harness overview />);
    const section = screen.getByRole("region", { name: "Conflict Resolution" });
    const focus = vi.spyOn(section, "focus");
    const scroll = vi.fn();
    Object.defineProperty(section, "scrollIntoView", {
      value: scroll,
      configurable: true,
    });
    const shortcut = within(
      screen.getByRole("list", { name: "Target sync status" }),
    ).getByRole("button", { name: "Review conflicts for Work" });

    fireEvent.click(shortcut);
    await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
    expect(section).toHaveFocus();
    expect(focus).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });

    choose("Application settings", "Keep local");
    expect(
      screen.getByRole("combobox", {
        name: "Resolution for Application settings",
      }),
    ).toHaveFocus();
    expect(focus).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledOnce();

    const pending = deferred<CloudSyncConflictReview>();
    mocks.review.mockReturnValueOnce(pending.promise);
    shortcut.focus();
    fireEvent.click(shortcut);
    expect(section).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(mocks.review).toHaveBeenCalledTimes(2);

    // Moving elsewhere during the fetch must survive its completion.
    const cancel = screen.getByRole("button", { name: "Cancel review" });
    cancel.focus();
    await act(async () =>
      pending.resolve({ ...review(), reviewKey: "fresh-preview" }),
    );
    expect(cancel).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();

    choose("Scripts", "Keep remote");
    expect(
      screen.getByRole("combobox", { name: "Resolution for Scripts" }),
    ).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("shows safe unlock guidance and only fetches again after refresh", async () => {
    mocks.review.mockRejectedValueOnce(
      new Error("Selected data locked: private-secret"),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review conflicts for Work" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Open and unlock",
    );
    expect(screen.queryByText(/private-secret/)).not.toBeInTheDocument();
    expect(mocks.review).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh review for Work" }),
    );
    await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
    expect(mocks.review).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each(["conflict", "partial", "failed"] as const)(
    "discards receipt and choices after %s; refresh never replays choices",
    async (status) => {
      mocks.resolve.mockResolvedValue({
        ...result(status),
        message:
          "Refresh the conflict review: no reviewed choices were applied.",
      });
      render(<Harness />);
      await openReview();
      choose("Application settings", "Keep local");
      choose("Scripts", "Keep remote");
      fireEvent.click(
        screen.getByRole("button", { name: "Apply reviewed choices" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Refresh the conflict review",
      );
      expect(
        screen.queryByRole("list", { name: "Reviewed artifacts for Work" }),
      ).not.toBeInTheDocument();
      expect(mocks.review).toHaveBeenCalledOnce();
      expect(mocks.resolve).toHaveBeenCalledOnce();
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh review for Work" }),
      );
      await screen.findByRole("list", { name: "Reviewed artifacts for Work" });
      expect(
        screen.getByRole("button", { name: "Apply reviewed choices" }),
      ).toBeDisabled();
      expect(mocks.resolve).toHaveBeenCalledOnce();
      expect(mocks.update.mock.lastCall![0].cloudSync.conflictResolution).toBe(
        "askEveryTime",
      );
    },
  );
});

describe("cloud sync conflict review hook guards", () => {
  it("does not verify or publish a matching receipt over a newer status received while fetching", async () => {
    const pending = deferred<CloudSyncConflictReview>();
    mocks.review.mockReturnValueOnce(pending.promise);
    const hook = hookWithConfig();
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleReviewConflicts("work");
    });
    const next = config();
    next.targetStatus!.work.lastSyncTime = 999;
    next.targetStatus!.work.lastSyncError = "New conflict";
    hook.rerender({ cloudSync: next });
    await act(async () => {
      pending.resolve(matchingReview());
      await running;
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(hook.result.current.conflictReview).toMatchObject({
      phase: "error",
    });
    expect(hook.result.current.conflictReview?.review).toBeUndefined();
  });

  it("does not let a completed matching review hide a subsequent conflict", async () => {
    mocks.review.mockResolvedValueOnce(matchingReview());
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    expect(hook.result.current.conflictReview?.phase).toBe("complete");
    const next = config();
    next.targetStatus!.work.lastSyncTime = 999;
    next.targetStatus!.work.lastSyncError = "New conflict";
    hook.rerender({ cloudSync: next });
    render(<ConflictResolutionSection mgr={hook.result.current} />);
    expect(screen.getByText("Conflicts need review.")).toBeInTheDocument();
    expect(mocks.resolve).toHaveBeenCalledOnce();
  });

  it.each(["destination", "identity", "unmount", "cancel", "newer status"])(
    "does not publish matching-copy verification after %s changes",
    async (change) => {
      const pending = deferred<CloudSyncOperationResult>();
      mocks.review.mockResolvedValueOnce(matchingReview());
      mocks.resolve.mockReturnValueOnce(pending.promise);
      const hook = hookWithConfig();
      let running!: Promise<void>;
      await act(async () => {
        running = hook.result.current.handleReviewConflicts("work");
      });
      expect(mocks.resolve).toHaveBeenCalledOnce();
      if (change === "unmount") hook.unmount();
      else if (change === "identity") invalidateCloudSyncTarget("work");
      else if (change === "cancel")
        act(() => hook.result.current.cancelConflictReview());
      else {
        const next = config();
        if (change === "destination")
          next.syncTargets![0].nextcloud!.folderPath = "/changed";
        else
          next.targetStatus!.work = {
            ...next.targetStatus!.work,
            lastSyncTime: 999,
            lastSyncError: "New conflict",
          };
        hook.rerender({ cloudSync: next });
      }
      await act(async () => {
        pending.resolve(result());
        await running;
      });
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    "master disabled",
    "target disabled",
    "missing target",
    "no selection",
    "unpinned SFTP",
  ])("does not preview invalid targets: %s", async (scenario) => {
    const initial = config();
    if (scenario === "master disabled") initial.enabled = false;
    if (scenario === "target disabled") initial.syncTargets![0].enabled = false;
    if (scenario === "no selection") initial.selectedItems = [];
    if (scenario === "unpinned SFTP") initial.syncTargets![0].provider = "sftp";
    const hook = hookWithConfig(initial);
    await act(async () =>
      hook.result.current.handleReviewConflicts(
        scenario === "missing target" ? "missing" : "work",
      ),
    );
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    if (scenario === "unpinned SFTP")
      expect(hook.result.current.conflictReview?.message).toContain("SHA256");
  });

  it("does not publish a preview after unmount or retain it after remount", async () => {
    const pending = deferred<CloudSyncConflictReview>();
    mocks.review.mockReturnValue(pending.promise);
    const hook = hookWithConfig();
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleReviewConflicts("work");
    });
    hook.unmount();
    await act(async () => {
      pending.resolve(review());
      await running;
    });
    const next = hookWithConfig();
    expect(next.result.current.conflictReview).toBeNull();
    expect(next.result.current.isBusy).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("drops choices on a thrown apply error and unlocks the operation guard", async () => {
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
    });
    mocks.resolve.mockRejectedValueOnce(
      new Error("Locked selected data: private-secret"),
    );
    await act(async () => hook.result.current.handleApplyReviewedChoices());
    expect(hook.result.current.conflictReview).toMatchObject({
      phase: "error",
      choices: {},
      message: expect.stringContaining("Open and unlock"),
    });
    expect(hook.result.current.conflictReview?.review).toBeUndefined();
    expect(hook.result.current.isBusy).toBe(false);
    await act(async () => hook.result.current.handleApplyReviewedChoices());
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires every conflict choice and rejects unsupported smart merge and unknown artifacts", async () => {
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "smartMerge");
      hook.result.current.setConflictReviewChoice("unknown", "keepRemote");
      hook.result.current.setConflictReviewChoice("connections", "keepRemote");
    });
    await act(async () => hook.result.current.handleApplyReviewedChoices());
    expect(hook.result.current.conflictReview?.choices).toEqual({
      settings: "keepLocal",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    "rejects reconciliation for an ineligible conflict (%s), non-conflict or unknown artifact in the actual hook",
    async (available) => {
      const receipt = reconciliationReview();
      receipt.items[0].historyReconciliationAvailable = available;
      receipt.items[2].historyReconciliationAvailable = true;
      mocks.review.mockResolvedValueOnce(receipt);
      const hook = hookWithConfig();
      await act(async () => hook.result.current.handleReviewConflicts("work"));
      act(() => {
        for (const id of ["settings", "scripts", "connections", "unknown"])
          hook.result.current.setConflictReviewChoice(id, "reconcileHistory");
      });
      expect(hook.result.current.conflictReview?.choices).toEqual({
        scripts: "reconcileHistory",
      });
      await act(async () => hook.result.current.handleApplyReviewedChoices());
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );

  const changes: [string, (config: CloudSyncConfig) => CloudSyncConfig][] = [
    ["selection", (c) => ({ ...c, selectedItems: ["different"] })],
    ["exclusions", (c) => ({ ...c, excludePatterns: ["*.secret"] })],
    ["encryption", (c) => ({ ...c, syncEncryptionPassword: "different" })],
    ["strategy", (c) => ({ ...c, conflictResolution: "keepRemote" })],
    [
      "compression",
      (c) => ({ ...c, compressionEnabled: !c.compressionEnabled }),
    ],
    ["master disabled", (c) => ({ ...c, enabled: false })],
    [
      "target removed",
      (c) => ({
        ...c,
        syncTargets: c.syncTargets!.filter((t) => t.id !== "work"),
      }),
    ],
    [
      "target disabled",
      (c) => ({
        ...c,
        syncTargets: c.syncTargets!.map((t) =>
          t.id === "work" ? { ...t, enabled: false } : t,
        ),
      }),
    ],
    [
      "provider",
      (c) => ({
        ...c,
        syncTargets: c.syncTargets!.map((t) =>
          t.id === "work" ? { ...t, provider: "webdav" } : t,
        ),
      }),
    ],
    [
      "destination",
      (c) => ({
        ...c,
        syncTargets: c.syncTargets!.map((t) =>
          t.id === "work"
            ? { ...t, nextcloud: { ...t.nextcloud!, folderPath: "/elsewhere" } }
            : t,
        ),
      }),
    ],
    [
      "credentials",
      (c) => ({
        ...c,
        syncTargets: c.syncTargets!.map((t) =>
          t.id === "work"
            ? { ...t, nextcloud: { ...t.nextcloud!, appPassword: "changed" } }
            : t,
        ),
      }),
    ],
  ];

  it.each(changes)(
    "discards a pending preview after changed %s",
    async (_name, change) => {
      const pending = deferred<CloudSyncConflictReview>();
      mocks.review.mockReturnValue(pending.promise);
      const initial = config();
      const hook = hookWithConfig(initial);
      const identity = cloudSyncTargetIdentity("work");
      let running!: Promise<void>;
      act(() => {
        running = hook.result.current.handleReviewConflicts("work");
      });
      hook.rerender({ cloudSync: change(initial) });
      expect(cloudSyncTargetIdentity("work")).not.toBe(identity);
      await act(async () => {
        pending.resolve(review());
        await running;
      });
      expect(hook.result.current.conflictReview).toBeNull();
      expect(hook.result.current.isBusy).toBe(false);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each(changes)(
    "discards ready choices after changed %s",
    async (_name, change) => {
      const initial = config();
      const hook = hookWithConfig(initial);
      await act(async () => hook.result.current.handleReviewConflicts("work"));
      act(() =>
        hook.result.current.setConflictReviewChoice("settings", "keepLocal"),
      );
      hook.rerender({ cloudSync: change(initial) });
      expect(hook.result.current.conflictReview).toBeNull();
      await act(async () => hook.result.current.handleApplyReviewedChoices());
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );

  it("guards same-tick settings changes before an apply can start", async () => {
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    await act(async () => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
      hook.result.current.updateCloudSync({ selectedItems: ["changed"] });
      await hook.result.current.handleApplyReviewedChoices();
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(hook.result.current.conflictReview).toBeNull();
  });

  it("ignores a cancelled pending preview and blocks overlapping operations until it settles", async () => {
    const pending = deferred<CloudSyncConflictReview>();
    mocks.review.mockReturnValue(pending.promise);
    const hook = hookWithConfig();
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleReviewConflicts("work");
      void hook.result.current.handleReviewConflicts("home");
      void hook.result.current.handleSyncNow();
      void hook.result.current.handleTestTarget("home");
      hook.result.current.cancelConflictReview();
    });
    expect(hook.result.current.isBusy).toBe(true);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.test).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(review());
      await running;
    });
    expect(hook.result.current.conflictReview).toBeNull();
    expect(hook.result.current.isBusy).toBe(false);
  });

  it("drops the previous target's receipt and choices when another target is reviewed", async () => {
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() =>
      hook.result.current.setConflictReviewChoice("settings", "keepLocal"),
    );
    await act(async () => hook.result.current.handleReviewConflicts("home"));
    expect(hook.result.current.conflictReview).toMatchObject({
      targetId: "home",
      choices: {},
    });
  });

  it("blocks review and apply while shared target activity is running", async () => {
    const hook = hookWithConfig();
    let finish!: () => void;
    act(() => {
      finish = beginCloudSyncActivity({ id: "home", provider: "nextcloud" });
    });
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    expect(mocks.review).not.toHaveBeenCalled();
    act(finish);
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
      finish = beginCloudSyncActivity({ id: "work", provider: "nextcloud" });
    });
    try {
      await act(async () => hook.result.current.handleApplyReviewedChoices());
      expect(mocks.resolve).not.toHaveBeenCalled();
    } finally {
      act(finish);
    }
  });

  it("rejects receipts and results with the wrong identity or target", async () => {
    const hook = hookWithConfig();
    mocks.review.mockResolvedValueOnce({
      ...review(),
      requestIdentity: Symbol(),
    });
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    expect(hook.result.current.conflictReview).toMatchObject({
      phase: "error",
      choices: {},
    });
    mocks.review.mockResolvedValueOnce(review("home"));
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    expect(hook.result.current.conflictReview?.review).toBeUndefined();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
    });
    mocks.resolve.mockResolvedValueOnce({
      ...result(),
      requestIdentity: Symbol(),
    });
    await act(async () => hook.result.current.handleApplyReviewedChoices());
    expect(hook.result.current.conflictReview).toMatchObject({
      phase: "error",
      choices: {},
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires refresh when the receipt identity is revoked before apply", async () => {
    const hook = hookWithConfig();
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
      invalidateCloudSyncTarget("work");
    });
    await act(async () => hook.result.current.handleApplyReviewedChoices());
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(hook.result.current.conflictReview).toMatchObject({
      phase: "error",
      choices: {},
    });
  });

  it.each(["changed destination", "unmount"])(
    "never publishes pending apply results after %s",
    async (change) => {
      const pending = deferred<CloudSyncOperationResult>();
      mocks.resolve.mockReturnValue(pending.promise);
      const hook = hookWithConfig();
      await act(async () => hook.result.current.handleReviewConflicts("work"));
      act(() => {
        hook.result.current.setConflictReviewChoice("settings", "keepLocal");
        hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
      });
      let running!: Promise<void>;
      act(() => {
        running = hook.result.current.handleApplyReviewedChoices();
        void hook.result.current.handleApplyReviewedChoices();
      });
      expect(hook.result.current.isTargetSyncing("work")).toBe(true);
      expect(hook.result.current.isTargetSyncing("home")).toBe(false);
      expect(mocks.resolve).toHaveBeenCalledOnce();
      if (change === "unmount") hook.unmount();
      else
        hook.rerender({
          cloudSync: changes.find(([name]) => name === "destination")![1](
            config(),
          ),
        });
      await act(async () => {
        pending.resolve(result());
        await running;
      });
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("preserves newly updated history for other targets when reviewed application completes", async () => {
    const pending = deferred<CloudSyncOperationResult>();
    mocks.resolve.mockReturnValue(pending.promise);
    const initial = config();
    const hook = hookWithConfig(initial);
    await act(async () => hook.result.current.handleReviewConflicts("work"));
    act(() => {
      hook.result.current.setConflictReviewChoice("settings", "keepLocal");
      hook.result.current.setConflictReviewChoice("scripts", "keepRemote");
    });
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleApplyReviewedChoices();
    });
    const home = {
      provider: "nextcloud" as const,
      lastSyncTime: 200,
      lastSyncStatus: "success" as const,
    };
    hook.rerender({
      cloudSync: {
        ...initial,
        targetStatus: { ...initial.targetStatus, home },
      },
    });
    await act(async () => {
      pending.resolve(result());
      await running;
    });
    expect(mocks.update.mock.lastCall![0].cloudSync.targetStatus.home).toEqual(
      home,
    );
  });
});
