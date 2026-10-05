import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ConflictReviewDetails from "../../src/components/SettingsDialog/sections/cloudSync/ConflictReviewDetails";

afterEach(cleanup);

it("shows version ancestry and counts alongside retained merge blockers", () => {
  render(
    <ConflictReviewDetails
      item={{
        id: "database:one",
        label: "Database",
        state: "conflict",
        localBytes: 1,
        remoteBytes: 1,
        smartMergeAvailable: false,
        conflicts: [{ code: "history-mismatch", kind: "other", count: 1 }],
        details: {
          records: [],
          hasBaseline: true,
          comparisonLimited: false,
          otherDifferences: true,
          versionHistory: {
            relationship: "local-ahead",
            sharedRevisions: 12,
            localOnlyRevisions: 3,
            remoteOnlyRevisions: 0,
          },
        },
      }}
    />,
  );
  const history = screen.getByRole("region", { name: "Version history" });
  expect(
    within(history).getByRole("heading", { name: "Version history" }),
  ).toBeVisible();
  expect(history).toHaveTextContent(
    "Local history includes all remote revisions plus newer revisions",
  );
  expect(history).toHaveTextContent("Shared revisions12");
  expect(history).toHaveTextContent("Local-only revisions3");
  expect(history).toHaveTextContent("not timezone or upload time");
  expect(history).toHaveTextContent(
    "does not choose a winner or override merge blockers",
  );
  expect(screen.getByRole("heading", { name: "Merge blockers" })).toBeVisible();
  expect(screen.getByText(/Keep local or Keep remote replaces/)).toBeVisible();
});
