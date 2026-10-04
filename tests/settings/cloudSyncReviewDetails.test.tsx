import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ConflictReviewDetails from "../../src/components/SettingsDialog/sections/cloudSync/ConflictReviewDetails";
import { summarizeCloudSyncReview } from "../../src/utils/services/cloudSyncReviewDetails";

afterEach(cleanup);
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
