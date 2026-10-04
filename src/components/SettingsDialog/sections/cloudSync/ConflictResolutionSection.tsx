import { AlertTriangle, GitMerge } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  ConflictResolutionStrategies,
  ConflictResolutionStrategy,
} from "../../../../types/settings/settings";
import {
  conflictLabels,
  conflictDescriptions,
} from "../../../../hooks/settings/useCloudSyncSettings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { Select } from "../../../ui/forms/Select";
import type { CloudSyncReviewChoice } from "../../../../utils/services/cloudSyncConflictReview";
import { formatDatabaseBytes as byteSize } from "../../../../utils/connection/databaseSize";
import {
  finishCloudSyncReviewNavigation,
  useCloudSyncReviewNavigation,
} from "../../../../utils/settings/cloudSyncReviewNavigation";
import ConflictReviewDetails from "./ConflictReviewDetails";

const strategyOptions = ConflictResolutionStrategies.map((strategy) => ({
  value: strategy,
  label: conflictLabels[strategy],
}));

const reviewButtonClass =
  "rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50 disabled:cursor-not-allowed";
const stateLabels = {
  same: "Same on both sides",
  local: "Local changes — will upload",
  remote: "Remote changes — will download",
  conflict: "Conflict — choose a resolution",
};
const choiceLabels = {
  keepLocal: "Keep local",
  keepRemote: "Keep remote",
  smartMerge: "Smart merge",
};
const choiceImpact = {
  keepLocal: "Replaces this artifact on the remote target with the local copy.",
  keepRemote: "Replaces this artifact's local data with the remote copy.",
  smartMerge:
    "Merges compatible changes and updates this artifact locally and on the remote target.",
};

function ConflictResolutionSection({ mgr }: { mgr: Mgr }) {
  const section = useRef<HTMLDivElement>(null);
  const active = mgr.conflictReview;
  const reviewNavigation = useCloudSyncReviewNavigation();
  const usesSmartMerge =
    mgr.cloudSync.conflictResolution === "smartMerge" ||
    Object.values(active?.choices ?? {}).includes("smartMerge");
  useEffect(() => {
    // Navigate once per request, including a fresh review of the same target.
    if (active?.targetId) {
      section.current?.focus({ preventScroll: true });
      section.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active?.targetId, mgr.reviewRequestSequence]);
  useEffect(() => {
    if (!reviewNavigation) return;
    // Run after the owning tab has rendered and its normal scroll reset ran.
    // Never focus a hidden settings session; allow time for tab activation.
    const deadline = Date.now() + 5_000;
    let frame: number;
    const focus = () => {
      const element = section.current;
      if (element?.getClientRects().length) {
        element.focus({ preventScroll: true });
        element.scrollIntoView?.({ block: "start" });
        finishCloudSyncReviewNavigation(reviewNavigation);
      } else if (Date.now() < deadline) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [reviewNavigation]);
  return (
    <div
      ref={section}
      tabIndex={-1}
      role="region"
      aria-label="Conflict Resolution"
      className="space-y-4"
    >
      <SectionHeader
        icon={<AlertTriangle className="w-4 h-4 text-primary" />}
        title="Conflict Resolution"
      />
      <Card>
        <SettingsSelectRow
          settingKey="cloudSync.conflictResolution"
          icon={<GitMerge size={16} />}
          label="Strategy"
          value={mgr.cloudSync.conflictResolution}
          options={strategyOptions}
          onChange={(v) =>
            mgr.updateCloudSync({
              conflictResolution: v as ConflictResolutionStrategy,
            })
          }
          infoTooltip="How to reconcile when the local copy and the cloud copy have both changed since the last sync."
        />
        <p className="text-xs text-[var(--color-textSecondary)] mt-1 ml-7">
          {conflictDescriptions[mgr.cloudSync.conflictResolution]}
        </p>
        {usesSmartMerge && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-2 ml-7">
            Use an updated app on every syncing device. Older builds cannot read
            merged record histories.
          </p>
        )}
      </Card>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Fetch a fresh preview for a target before applying choices. Reviews show
        record-type counts, differences, recorded dates and merge blockers;
        record contents and secret values are not displayed.
      </p>
      {mgr.syncTargets
        .filter((target) => target.enabled && target.provider !== "none")
        .map((target) => {
          const state = active?.targetId === target.id ? active : null;
          const review = state?.review;
          const conflicts =
            review?.items.filter((item) => item.state === "conflict") ?? [];
          const ready = state?.phase === "ready";
          const reviewedWithoutConflicts = Boolean(
            review?.items.length &&
            conflicts.length === 0 &&
            (ready || state?.phase === "verifying"),
          );
          const matchingCopies =
            reviewedWithoutConflicts &&
            review!.items.every((item) => item.state === "same");
          const allChosen = conflicts.every((item) =>
            Boolean(state?.choices[item.id]),
          );
          const blocked =
            !mgr.cloudSync.enabled ||
            Boolean(mgr.validationError) ||
            mgr.isBusy ||
            mgr.isTargetSyncing(target.id);
          const status = mgr.getTargetStatus(target.id)?.lastSyncStatus;
          return (
            <Card key={target.id}>
              <div
                role="group"
                aria-label={`Conflict review for ${target.label}`}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-sm font-medium text-[var(--color-text)]">
                    {target.label}
                  </h5>
                  <button
                    type="button"
                    className={reviewButtonClass}
                    disabled={blocked}
                    onClick={() => void mgr.handleReviewConflicts(target.id)}
                    aria-label={`${state ? "Refresh review" : "Review conflicts"} for ${target.label}`}
                  >
                    {state?.phase === "loading"
                      ? "Reviewing…"
                      : state
                        ? "Refresh review"
                        : "Review conflicts"}
                  </button>
                </div>
                {(status === "conflict" || status === "partial") &&
                  !reviewedWithoutConflicts && (
                    <p className="text-xs text-warning">
                      {status === "conflict"
                        ? "Conflicts need review."
                        : "The last sync was partial. Review the remaining artifacts."}
                    </p>
                  )}
                {state?.phase === "loading" && (
                  <p
                    role="status"
                    className="text-xs text-[var(--color-textSecondary)]"
                  >
                    Fetching fresh local and remote summaries…
                  </p>
                )}
                {state?.message && (
                  <p
                    role={state.phase === "error" ? "alert" : "status"}
                    className="text-xs text-[var(--color-textSecondary)]"
                  >
                    {state.message}
                  </p>
                )}
                {review && (
                  <>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      {review.items.length}{" "}
                      {review.items.length === 1 ? "artifact" : "artifacts"} ·{" "}
                      {conflicts.length}{" "}
                      {conflicts.length === 1 ? "conflict" : "conflicts"}
                    </p>
                    <ul
                      aria-label={`Reviewed artifacts for ${target.label}`}
                      className="space-y-3"
                    >
                      {review.items.map((item) => {
                        const choice = state?.choices[item.id];
                        return (
                          <li
                            key={item.id}
                            aria-label={item.label}
                            className="space-y-2 rounded-lg border border-[var(--color-border)] p-3"
                          >
                            <p className="break-words text-sm font-medium text-[var(--color-text)]">
                              {item.label}
                            </p>
                            <p className="text-xs text-[var(--color-textSecondary)]">
                              {stateLabels[item.state]} · Local:{" "}
                              {byteSize(item.localBytes)} · Remote:{" "}
                              {byteSize(item.remoteBytes)}
                            </p>
                            {item.reason && (
                              <p className="text-xs text-[var(--color-textSecondary)]">
                                {item.reason}
                              </p>
                            )}
                            {(item.details || !!item.conflicts?.length) && (
                              <details
                                open={item.state === "conflict"}
                                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
                              >
                                <summary className="cursor-pointer rounded text-xs font-medium text-[var(--color-textSecondary)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                  Record comparison and merge details
                                </summary>
                                <div className="mt-2">
                                  <ConflictReviewDetails item={item} />
                                </div>
                              </details>
                            )}
                            {item.state === "conflict" && (
                              <Select
                                label={`Resolution for ${item.label}`}
                                value={choice ?? ""}
                                placeholder="Choose a resolution"
                                disabled={blocked || !ready}
                                options={(item.smartMergeAvailable
                                  ? ([
                                      "keepLocal",
                                      "keepRemote",
                                      "smartMerge",
                                    ] as const)
                                  : (["keepLocal", "keepRemote"] as const)
                                ).map((value) => ({
                                  value,
                                  label: choiceLabels[value],
                                }))}
                                onChange={(value) =>
                                  mgr.setConflictReviewChoice(
                                    item.id,
                                    value as CloudSyncReviewChoice,
                                  )
                                }
                              />
                            )}
                            {choice && (
                              <p className="text-xs text-warning">
                                {choiceImpact[choice]}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Applying affects only {target.label} and the selected
                      local artifacts. One-sided changes also sync in the
                      directions shown above. Your global strategy stays
                      unchanged.
                    </p>
                    {!allChosen && (
                      <p className="text-xs text-warning">
                        Choose a resolution for every conflicting artifact
                        before applying.
                      </p>
                    )}
                    {(ready || state?.phase === "applying") && (
                      <button
                        type="button"
                        className={reviewButtonClass}
                        disabled={
                          blocked ||
                          !ready ||
                          !allChosen ||
                          !review.items.length
                        }
                        onClick={() => void mgr.handleApplyReviewedChoices()}
                      >
                        {state?.phase === "applying"
                          ? "Applying reviewed choices…"
                          : matchingCopies
                            ? "Verify matching copies"
                            : reviewedWithoutConflicts
                              ? "Sync reviewed changes"
                              : "Apply reviewed choices"}
                      </button>
                    )}
                  </>
                )}
                {state && (
                  <button
                    type="button"
                    className={`${reviewButtonClass} ml-2`}
                    disabled={state.phase === "applying"}
                    onClick={mgr.cancelConflictReview}
                  >
                    Cancel review
                  </button>
                )}
              </div>
            </Card>
          );
        })}
    </div>
  );
}

export default ConflictResolutionSection;
