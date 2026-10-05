import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ConflictReviewDetails from "../../src/components/SettingsDialog/sections/cloudSync/ConflictReviewDetails";
import type { CloudSyncReviewItem } from "../../src/utils/services/cloudSyncConflictReview";
import {
  reviewConflictGuidance,
  reviewConflictLabels,
  summarizeCloudSyncReview,
  type CloudSyncReviewDetails,
  type SmartSyncConflictCode,
} from "../../src/utils/services/cloudSyncReviewDetails";

afterEach(cleanup);

function renderDates(dates: Partial<CloudSyncReviewDetails>) {
  return render(
    <ConflictReviewDetails
      item={{
        id: "database:date-review",
        label: "Date review",
        state: "conflict",
        localBytes: 1,
        remoteBytes: 1,
        smartMergeAvailable: false,
        details: {
          records: [],
          hasBaseline: true,
          comparisonLimited: false,
          otherDifferences: false,
          ...dates,
        },
      }}
    />,
  );
}

it("shows actionable counts, safe dates, precise merge blockers and whole-copy impacts", () => {
  const date = "2026-09-01T12:00:00.000Z";
  render(
    <ConflictReviewDetails
      item={{
        id: "database:private-id",
        label: "MasterI",
        state: "conflict",
        localBytes: 200,
        remoteBytes: 200,
        smartMergeAvailable: false,
        details: summarizeCloudSyncReview(
          "database:private-id",
          {
            connections: [
              { id: "private-record", password: "PRIVATE_LOCAL" },
              { id: "only-local" },
            ],
            recordMetadata: {
              records: { $: { updatedAt: date, updatedAtSource: "inferred" } },
            },
          },
          {
            connections: [
              { id: "private-record", password: "PRIVATE_REMOTE" },
              { id: "only-remote" },
            ],
          },
          true,
          Date.parse(date),
        ),
        conflicts: [{ code: "concurrent-edit", kind: "connections", count: 1 }],
      }}
    />,
  );
  const table = screen.getByRole("table", {
    name: "Record comparison for MasterI",
  });
  const heading = screen.getByRole("heading", { name: "Merge blockers" });
  expect(heading).toBeVisible();
  expect(
    heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const blockers = screen.getByRole("list", {
    name: "Merge blockers for MasterI",
  });
  expect(within(blockers).getAllByRole("listitem")).toHaveLength(1);
  expect(blockers).toHaveTextContent("1 reported blocker");
  expect(
    screen.getByText(/These counts are reported blockers/),
  ).toHaveTextContent("not counts of differing records");
  expect(screen.getByText(/History validation stops/)).toHaveTextContent(
    "at the first detected problem, so more problems may remain",
  );
  expect(screen.getByText(/History validation stops/)).toHaveTextContent(
    "A history count of 1 means one reported rejection, not one affected record",
  );
  const row = within(table).getByRole("row", {
    name: /Connections and folders/,
  });
  expect(
    within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["2", "2", "1", "1", "1", "0"]);
  expect(
    screen.getByText(/Both copies edited the same record/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Remote last recorded change: Not recorded/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Local last recorded change:/)).toHaveTextContent(
    "inferred",
  );
  expect(
    screen.getByText(/Remote snapshot time:/).querySelector("time"),
  ).toHaveAttribute("dateTime", date);
  expect(screen.getByText(/Local last recorded change:/)).toHaveTextContent(
    "2026-09-01 12:00:00.000 UTC (inferred)",
  );
  expect(screen.getByText(/Remote snapshot time:/)).toHaveTextContent(
    "2026-09-01 12:00:00.000 UTC",
  );
  expect(screen.getByText(/Times are shown in UTC/)).toHaveTextContent(
    "Timezone differences alone do not establish which copy is newer",
  );
  expect(screen.getByText(/Times are shown in UTC/)).toHaveTextContent(
    "Legacy dates without a recorded timezone remain uncertain",
  );
  expect(screen.getByText(/replaces the entire artifact/)).toBeInTheDocument();
  expect(
    screen.getByText(/Other data or metadata differs/),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(
    /PRIVATE_|private-id|private-record|only-local|only-remote/,
  );
});

it("does not claim missing baseline or limited comparisons prove deletion/newness", () => {
  render(
    <ConflictReviewDetails
      item={{
        id: "unknown",
        label: "Archive",
        state: "conflict",
        localBytes: 1,
        remoteBytes: 1,
        smartMergeAvailable: false,
        details: summarizeCloudSyncReview(
          "unknown",
          { PRIVATE_KEY: "PRIVATE_VALUE" },
          {},
          false,
        ),
        conflicts: [{ code: "missing-baseline", kind: "other", count: 1 }],
      }}
    />,
  );
  expect(
    screen.getByText(/differences alone cannot establish which copy is newer/),
  ).toBeInTheDocument();
  expect(screen.getByText(/counts are incomplete/)).toBeInTheDocument();
  expect(
    screen.getByText(/No shared smart-sync baseline is available/),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/PRIVATE_/);
});

it("shows the older generic history blocker even without record comparison details", () => {
  render(
    <ConflictReviewDetails
      item={{
        id: "database:PRIVATE_ID",
        label: "Archive",
        state: "conflict",
        localBytes: 1,
        remoteBytes: 1,
        smartMergeAvailable: false,
        conflicts: [{ code: "history-incompatible", kind: "other", count: 2 }],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "Merge blockers" })).toBeVisible();
  const blockers = screen.getByRole("list", {
    name: "Merge blockers for Archive",
  });
  expect(blockers).toHaveTextContent(
    "The record histories cannot be safely combined",
  );
  expect(blockers).toHaveTextContent("2 reported blockers");
  expect(
    within(blockers).getByText(
      /Refresh review to run the current history checks/,
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("Record comparison and merge details"),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/replaces the entire artifact/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/PRIVATE_/);
});

it.each([
  "history-unrelated",
  "history-revision-collision",
  "history-stamp-collision",
  "history-creation-provenance",
  "history-missing-head",
  "history-deleted-content",
  "history-safety-limit",
  "history-timestamp-overflow",
  "history-invalid",
] satisfies SmartSyncConflictCode[])(
  "shows the safe reason and guidance for %s without exposing diagnostic payloads",
  (code) => {
    const entry = {
      code,
      kind: "other" as const,
      count: 1,
      message: "PRIVATE_ERROR",
      path: "PRIVATE_PATH",
      revision: "PRIVATE_REVISION",
    };
    const { container } = render(
      <ConflictReviewDetails
        item={{
          id: "database:PRIVATE_ID",
          label: "Archive",
          state: "conflict",
          localBytes: 1,
          remoteBytes: 1,
          smartMergeAvailable: false,
          conflicts: [entry],
        }}
      />,
    );
    const blockers = screen.getByRole("list", {
      name: "Merge blockers for Archive",
    });
    expect(
      screen.getByRole("heading", { name: "Merge blockers" }),
    ).toBeVisible();
    expect(blockers).toBeVisible();
    expect(blockers).toHaveTextContent(reviewConflictLabels[code]);
    expect(
      within(blockers).getByText(reviewConflictGuidance[code]),
    ).toBeVisible();
    expect(container.innerHTML).not.toMatch(/PRIVATE_/);
    expect(blockers).not.toHaveTextContent(code);
  },
);

it.each(["same", "local", "remote"] as const)(
  "does not present merge blockers for a %s artifact, including stale diagnostics",
  (state) => {
    const item: CloudSyncReviewItem = {
      id: "database:archive",
      label: "Archive",
      state,
      localBytes: 1,
      remoteBytes: 1,
      smartMergeAvailable: false,
      details: summarizeCloudSyncReview("database:archive", {}, {}, false),
    };
    const { rerender } = render(<ConflictReviewDetails item={item} />);
    expect(
      screen.queryByRole("heading", { name: "Merge blockers" }),
    ).not.toBeInTheDocument();
    rerender(
      <ConflictReviewDetails
        item={{
          ...item,
          conflicts: [
            { code: "history-incompatible", kind: "other", count: 1 },
          ],
        }}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Merge blockers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Merge blockers for Archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/These counts are reported blockers/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/replaces the entire artifact/),
    ).not.toBeInTheDocument();
  },
);

it("does not infer merge blockers from differing records when no blockers were reported", () => {
  render(
    <ConflictReviewDetails
      item={{
        id: "database:archive",
        label: "Archive",
        state: "conflict",
        localBytes: 1,
        remoteBytes: 1,
        smartMergeAvailable: true,
        details: summarizeCloudSyncReview(
          "database:archive",
          { connections: [{ id: "record", name: "PRIVATE_LOCAL" }] },
          { connections: [{ id: "record", name: "PRIVATE_REMOTE" }] },
          true,
        ),
      }}
    />,
  );
  expect(screen.getByRole("table")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Merge blockers" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/These counts are reported blockers/),
  ).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/PRIVATE_/);
});

it("renders equivalent offset timestamps as the same visible UTC instant", () => {
  renderDates({
    localRecordedAt: { at: "2026-09-01T00:15:00.123Z", source: "record" },
    remoteRecordedAt: {
      at: "2026-08-31T20:15:00.123-04:00",
      source: "observed",
    },
    remoteSnapshotAt: "2026-09-01T05:45:00.123+05:30",
  });

  for (const label of [
    /Local last recorded change:/,
    /Remote last recorded change:/,
    /Remote snapshot time:/,
  ]) {
    const time = screen.getByText(label).querySelector("time");
    expect(time).toHaveTextContent("2026-09-01 00:15:00.123 UTC");
    expect(time).toHaveAttribute("dateTime", "2026-09-01T00:15:00.123Z");
  }
  expect(screen.getByText(/Local last recorded change:/)).toHaveTextContent(
    "(record)",
  );
  expect(screen.getByText(/Remote last recorded change:/)).toHaveTextContent(
    "(observed)",
  );
});

it("keeps distinct instants visible, including changes one millisecond apart", () => {
  renderDates({
    localRecordedAt: { at: "2026-09-01T12:00:00.123Z", source: "record" },
    remoteRecordedAt: {
      at: "2026-09-01T13:00:00.124+01:00",
      source: "record",
    },
    remoteSnapshotAt: "2026-09-01T12:00:00.123-04:00",
  });

  expect(screen.getByText(/Local last recorded change:/)).toHaveTextContent(
    "2026-09-01 12:00:00.123 UTC",
  );
  expect(screen.getByText(/Remote last recorded change:/)).toHaveTextContent(
    "2026-09-01 12:00:00.124 UTC",
  );
  expect(screen.getByText(/Remote snapshot time:/)).toHaveTextContent(
    "2026-09-01 16:00:00.123 UTC",
  );
});

it.each([
  "2026-99-01T12:00:00.123Z",
  "2026-09-01T12:00:00.123+25:00",
  "not-a-date",
  "2026-09-01T12:00:00.123",
  "2026-09-01",
])("handles invalid or timezone-free dates safely: %s", (at) => {
  const { container } = renderDates({
    localRecordedAt: { at, source: "inferred" },
    remoteRecordedAt: { at, source: "observed" },
    remoteSnapshotAt: at,
  });

  for (const label of [
    /Local last recorded change:/,
    /Remote last recorded change:/,
    /Remote snapshot time:/,
  ]) {
    expect(screen.getByText(label)).toHaveTextContent(
      "Unavailable (invalid or missing timezone)",
    );
  }
  expect(container.querySelector("time")).toBeNull();
  expect(container.textContent).not.toContain("Invalid Date");
});
