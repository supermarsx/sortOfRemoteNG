import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  RecycleBinOutcome,
  RecycleBinPolicy,
  RecycleBinReview,
} from "../../types/connection/recycleBin";

/** UI projection only. The provider owns records, authorization and durable mutations. */
export function useConnectionRecycleBin(databaseId?: string) {
  const { recycleBin: api } = useConnections();
  const snapshot =
    api?.snapshot &&
    (databaseId === undefined || api.snapshot.scope.databaseId === databaseId)
      ? api.snapshot
      : null;
  const scopeKey = snapshot ? JSON.stringify(snapshot.scope) : "unavailable";
  const databaseKey = snapshot
    ? JSON.stringify([snapshot.scope.databaseId, snapshot.scope.generation])
    : "unavailable";
  const latest = useRef({ api, scopeKey, snapshot });
  latest.current = { api, scopeKey, snapshot };
  const mounted = useRef(true);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    key: string;
    error?: string;
    message?: string;
  }>({ key: scopeKey });
  const [review, setReview] = useState<RecycleBinReview | null>(null);
  const heldReview = useRef<{
    review: RecycleBinReview;
    cancel: (token: string) => void;
  } | null>(null);

  const discardReview = useCallback(() => {
    const held = heldReview.current;
    heldReview.current = null;
    held?.cancel(held.review.token);
    if (mounted.current) setReview(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardReview();
    };
  }, [discardReview]);
  useEffect(() => {
    const held = heldReview.current;
    if (held && JSON.stringify(held.review.scope) !== scopeKey) discardReview();
  }, [scopeKey, discardReview]);
  useEffect(() => {
    if (!review) return;
    const timer = window.setTimeout(
      () => {
        discardReview();
        setFeedback({
          key: scopeKey,
          error: "This review expired. Review the action again.",
        });
      },
      Math.max(0, Math.min(review.expiresAt - Date.now(), 2_147_483_647)),
    );
    return () => window.clearTimeout(timer);
  }, [review, scopeKey, discardReview]);

  const run = async (
    operation: () => Promise<RecycleBinOutcome | RecycleBinReview>,
  ) => {
    const captured = latest.current;
    if (
      !captured.api ||
      !captured.snapshot ||
      running.current ||
      captured.api.busy
    )
      return;
    running.current = true;
    setBusy(true);
    setFeedback({ key: captured.scopeKey });
    try {
      const result = await operation();
      if ("token" in result) {
        if (!mounted.current || latest.current.scopeKey !== captured.scopeKey) {
          captured.api.cancelReview(result.token);
          return;
        }
        discardReview();
        heldReview.current = {
          review: result,
          cancel: captured.api.cancelReview,
        };
        setReview(result);
      } else if (mounted.current) {
        // A successful mutation advances revision. Never post its result into a different database/generation.
        const currentScope = latest.current.snapshot?.scope;
        if (
          currentScope?.databaseId === captured.snapshot.scope.databaseId &&
          currentScope.generation === captured.snapshot.scope.generation
        ) {
          setFeedback({
            key: JSON.stringify([
              currentScope.databaseId,
              currentScope.generation,
            ]),
            message: [
              result.restored ? `${result.restored} restored` : "",
              result.purged ? `${result.purged} permanently deleted` : "",
              result.skipped
                ? `${result.skipped} skipped; existing connections were not overwritten`
                : "",
              !result.restored && !result.purged && !result.skipped
                ? "Changes saved"
                : "",
              ...result.warnings,
            ]
              .filter(Boolean)
              .join(". "),
          });
        }
      }
    } catch (error) {
      const currentScope = latest.current.snapshot?.scope;
      if (
        mounted.current &&
        currentScope?.databaseId === captured.snapshot.scope.databaseId &&
        currentScope.generation === captured.snapshot.scope.generation
      ) {
        setFeedback({
          key: JSON.stringify([
            currentScope.databaseId,
            currentScope.generation,
          ]),
          error:
            error instanceof Error
              ? error.message
              : "The recycle-bin action failed. Nothing further was requested.",
        });
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const restore = (ids: readonly string[]) => {
    const current = latest.current;
    if (!current.api || !current.snapshot || !ids.length)
      return Promise.resolve();
    return run(() => current.api!.restore(ids, current.snapshot!.scope));
  };
  const reviewPurge = (ids: readonly string[] | null) => {
    const current = latest.current;
    if (!current.api || !current.snapshot || ids?.length === 0)
      return Promise.resolve();
    return run(() => current.api!.reviewPurge(ids, current.snapshot!.scope));
  };
  const reviewRetention = (policy: RecycleBinPolicy) => {
    const current = latest.current;
    if (!current.api || !current.snapshot) return Promise.resolve();
    return run(() =>
      current.api!.reviewRetention(policy, current.snapshot!.scope),
    );
  };
  const confirm = () => {
    const held = heldReview.current;
    const current = latest.current;
    if (!held || !current.api || running.current || current.api.busy) return;
    if (
      JSON.stringify(held.review.scope) !== current.scopeKey ||
      held.review.expiresAt <= Date.now()
    ) {
      discardReview();
      setFeedback({
        key: current.scopeKey,
        error: "The database or review changed. Review the action again.",
      });
      return;
    }
    heldReview.current = null;
    setReview(null);
    void run(() => current.api!.commitReview(held.review.token));
  };

  return {
    snapshot,
    scopeKey,
    busy: busy || Boolean(api?.busy),
    review: review && JSON.stringify(review.scope) === scopeKey ? review : null,
    error:
      feedback.key === scopeKey || feedback.key === databaseKey
        ? feedback.error
        : undefined,
    message: feedback.key === databaseKey ? feedback.message : undefined,
    restore,
    reviewPurge,
    reviewRetention,
    confirm,
    cancelReview: discardReview,
  };
}
