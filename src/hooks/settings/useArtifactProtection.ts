import { useCallback, useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";
import { generateId } from "../../utils/core/id";
import {
  isMutableArtifactId,
  type ArtifactPolicyPreview,
  type ArtifactPolicyProgress,
  type ArtifactPolicyResult,
  type ArtifactPolicyTarget,
  type ArtifactProtectionSnapshot,
  type MutableArtifactId,
} from "../../types/encryption/artifactProtection";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
async function native() {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error(
      "Artifact protection is available only in the desktop app. No files were changed.",
    );
  return invoke;
}

/** Explicit native inspection and token-bound transitions; never polls or stores secrets. */
export function useArtifactProtection(refreshKey?: unknown) {
  const [status, setStatus] = useState<ArtifactProtectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPolicyPreview | null>(null);
  const [result, setResult] = useState<ArtifactPolicyResult | null>(null);
  const [progress, setProgress] = useState<ArtifactPolicyProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const generation = useRef(0);
  const request = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const progressSubscription = useRef<(() => void) | null>(null);
  const releasePreview = useCallback(async (token: string) => {
    try {
      const invoke = await native();
      await invoke("encryption_release_artifact_preview", { token });
    } catch (error) {
      if (mounted.current)
        setError(
          `Could not release the preview: ${errorText(error)}. Its native expiry still applies.`,
        );
    }
  }, []);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (previewRef.current) void releasePreview(previewRef.current.token);
    previewRef.current = null;
    statusRef.current = null;
    if (mounted.current) {
      setPreview(null);
      setLoading(true);
      setStatus(null);
      setError(null);
    }
    try {
      const invoke = await native();
      const next = await invoke<ArtifactProtectionSnapshot>(
        "encryption_get_artifact_status",
      );
      if (!next || !Array.isArray(next.artifacts))
        throw new Error(
          "Artifact inspection is unavailable in this build. No protection state can be verified.",
        );
      if (mounted.current && current === generation.current) {
        statusRef.current = next;
        setStatus(next);
      }
    } catch (e) {
      if (mounted.current && current === generation.current)
        setError(errorText(e));
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, [releasePreview]);
  useEffect(() => {
    const currentGeneration = generation;
    const subscription = progressSubscription;
    const pendingPreview = previewRef;
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      currentGeneration.current++;
      subscription.current?.();
      subscription.current = null;
      if (pendingPreview.current)
        void releasePreview(pendingPreview.current.token);
      pendingPreview.current = null;
    };
  }, [refresh, refreshKey, releasePreview]);

  const begin = () => {
    if (busyRef.current || !mounted.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  };
  const inspect = async (
    ids: MutableArtifactId[],
    target: ArtifactPolicyTarget,
  ) => {
    if (!begin()) return;
    const epoch = generation.current;
    if (previewRef.current) void releasePreview(previewRef.current.token);
    setPreview(null);
    previewRef.current = null;
    setResult(null);
    let returnedToken: string | null = null;
    try {
      const current = statusRef.current;
      if (
        !current?.unlocked ||
        current.busy ||
        current.recoveryRequired ||
        current.policyError
      )
        throw new Error(
          "Unlock the global master key and resolve pending recovery before changing artifact protection.",
        );
      if (
        !ids.length ||
        ids.some(
          (id) =>
            !isMutableArtifactId(id) ||
            !current.artifacts.some(
              (row) =>
                row.id === id &&
                row.mutable &&
                row.diskState !== "unverified" &&
                row.unverifiedFiles === 0,
            ),
        )
      )
        throw new Error("Select supported artifact families first.");
      const invoke = await native();
      if (!mounted.current || epoch !== generation.current) return;
      const next = await invoke<ArtifactPolicyPreview>(
        "encryption_preview_artifact_policy",
        { artifacts: [...new Set(ids)], target },
      );
      if (typeof next?.token === "string" && next.token.trim())
        returnedToken = next.token;
      if (
        typeof next?.token !== "string" ||
        !next.token.trim() ||
        next.target !== target ||
        !Array.isArray(next.artifacts) ||
        next.artifacts.length !== new Set(ids).size ||
        new Set(next.artifacts.map((row) => row.id)).size !==
          new Set(ids).size ||
        next.artifacts.some(
          (row) =>
            !row.mutable ||
            row.diskState === "unverified" ||
            row.unverifiedFiles !== 0 ||
            !isMutableArtifactId(row.id) ||
            !ids.includes(row.id),
        )
      ) {
        throw new Error(
          "The native preview was invalid. No files were changed.",
        );
      }
      if (mounted.current && epoch === generation.current) {
        previewRef.current = next;
        setPreview(next);
      } else void releasePreview(next.token);
    } catch (e) {
      if (returnedToken) void releasePreview(returnedToken);
      if (mounted.current && epoch === generation.current)
        setError(errorText(e));
    } finally {
      finish();
    }
  };
  const dismissPreview = (release = true) => {
    if (release && previewRef.current)
      void releasePreview(previewRef.current.token);
    previewRef.current = null;
    setPreview(null);
  };
  const apply = async () => {
    const planned = previewRef.current;
    if (
      planned &&
      (!statusRef.current?.unlocked ||
        statusRef.current.busy ||
        statusRef.current.recoveryRequired ||
        statusRef.current.policyError)
    ) {
      dismissPreview();
      setError(
        "Protection state changed. Refresh and preview again before applying.",
      );
      return null;
    }
    if (!planned || !begin()) return null;
    const epoch = generation.current;
    const requestId = generateId();
    request.current = requestId;
    cancelRequested.current = false;
    setCancelling(false);
    dismissPreview(false);
    setProgress({
      requestId,
      phase: "scan",
      completed: 0,
      total: planned.totalFiles,
    });
    let failure: string | null = null;
    let outcome: ArtifactPolicyResult | null = null;
    try {
      const invoke = await native();
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ArtifactPolicyProgress>(
        "encryption:artifact-progress",
        ({ payload }) => {
          if (
            mounted.current &&
            epoch === generation.current &&
            request.current === payload.requestId
          )
            setProgress(payload);
        },
      );
      if (!mounted.current || epoch !== generation.current) {
        unlisten();
        return null;
      }
      progressSubscription.current = unlisten;
      outcome = await invoke<ArtifactPolicyResult>(
        "encryption_apply_artifact_policy",
        {
          token: planned.token,
          confirmPlaintext: planned.target === "plaintext",
          requestId,
        },
      );
      if (
        !outcome ||
        outcome.requestId !== requestId ||
        !["completed", "cancelled", "failed"].includes(outcome.outcome) ||
        !Array.isArray(outcome.results) ||
        outcome.results.length !== planned.artifacts.length ||
        new Set(outcome.results.map((row) => row.id)).size !==
          planned.artifacts.length ||
        outcome.results.some(
          (row) =>
            !planned.artifacts.some((selected) => selected.id === row.id) ||
            !["committed", "unchanged", "failed", "not-attempted"].includes(
              row.outcome,
            ),
        ) ||
        (outcome.outcome === "completed" &&
          outcome.results.some(
            (row) => row.outcome !== "committed" && row.outcome !== "unchanged",
          ))
      )
        throw new Error(
          "The operation returned no verified result. Refresh inspected status before retrying.",
        );
      if (mounted.current && epoch === generation.current) setResult(outcome);
      else outcome = null;
    } catch (e) {
      outcome = null;
      failure = errorText(e);
    } finally {
      void releasePreview(planned.token);
      progressSubscription.current?.();
      progressSubscription.current = null;
      request.current = null;
      if (mounted.current) {
        await refresh();
        if (failure) setError(failure);
        setProgress(null);
        setCancelling(false);
      }
      finish();
    }
    return outcome;
  };
  const cancel = async () => {
    const requestId = request.current;
    if (
      !requestId ||
      cancelRequested.current ||
      progress?.phase === "commit" ||
      progress?.phase === "rollback" ||
      progress?.phase === "complete"
    )
      return;
    cancelRequested.current = true;
    setCancelling(true);
    try {
      const invoke = await native();
      await invoke("encryption_cancel_artifact_policy", { requestId });
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e));
        setCancelling(false);
      }
      cancelRequested.current = false;
    }
  };
  const recover = async () => {
    if (!begin()) return;
    let failure: string | null = null;
    try {
      const invoke = await native();
      await invoke("encryption_recover_artifact_transition");
    } catch (e) {
      failure = errorText(e);
    } finally {
      if (mounted.current) {
        await refresh();
        if (failure) setError(failure);
      }
      finish();
    }
  };
  return {
    status,
    loading,
    busy,
    error,
    preview,
    result,
    progress,
    cancelling,
    refresh,
    inspect,
    dismissPreview,
    apply,
    cancel,
    recover,
  };
}
