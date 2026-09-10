import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserScript } from "../../types/recording/webAutomation";
import type {
  AutomationLibraryApi,
  AutomationLibraryDiagnostic,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../types/recording/automationLibrary";
import {
  AutomationLibraryAccessError,
  automationLibraryDiagnostic,
} from "../../utils/recording/automationLibraryAccess";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { WEB_AUTOMATION_STORE_KEY } from "../../utils/recording/webAutomationLibrary";

export interface WebsiteUserScriptsLibraryBinding {
  api: AutomationLibraryApi;
  scope: AutomationScope;
  accessKey: string;
  enabled: boolean;
  settingsReady: boolean;
  diagnostic: AutomationLibraryDiagnostic | null;
  retry: () => void;
  databaseRevision: number;
}
const accessChanged = () =>
  new AutomationLibraryAccessError({
    code: "access-changed",
    message:
      "Library access changed. Retry and review the selected library before continuing.",
    retryable: true,
  });

/** Explicit destination only. No fallback to the app store and no execution. */
export function useScopedWebsiteUserScripts(
  binding?: WebsiteUserScriptsLibraryBinding,
) {
  const [snapshot, setSnapshot] =
    useState<AutomationLibrarySnapshot<"website-script"> | null>(null);
  const [diagnostic, setDiagnostic] =
    useState<AutomationLibraryDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(binding);
  latest.current = binding;
  const identity = JSON.stringify([
    binding?.scope,
    binding?.accessKey,
    binding?.enabled,
    binding?.settingsReady,
  ]);
  const previous = useRef({ identity, api: binding?.api });
  const generation = useRef(0),
    live = useRef(false),
    writing = useRef(false),
    pendingReload = useRef(false);
  const reviewed = useRef<AutomationLibrarySnapshot<"website-script"> | null>(
    null,
  );
  const snapshotIdentity = useRef<string | null>(null);
  if (
    previous.current.identity !== identity ||
    previous.current.api !== binding?.api
  ) {
    previous.current = { identity, api: binding?.api };
    generation.current++;
  }
  const assertCurrent = useCallback((captured: number) => {
    if (
      !live.current ||
      !latest.current?.enabled ||
      !latest.current.settingsReady ||
      captured !== generation.current
    )
      throw accessChanged();
  }, []);
  const load = useCallback(async () => {
    const owner = latest.current;
    if (
      !owner ||
      !owner.enabled ||
      !owner.settingsReady ||
      previous.current.identity !== identity ||
      previous.current.api !== owner.api
    )
      return;
    if (writing.current) {
      pendingReload.current = true;
      return;
    }
    const captured = ++generation.current;
    try {
      const next = await owner.api.read(owner.scope, "website-script");
      assertCurrent(captured);
      reviewed.current = next;
      snapshotIdentity.current = identity;
      setSnapshot(next);
      setDiagnostic(null);
    } catch (failure) {
      if (live.current && captured === generation.current) {
        reviewed.current = null;
        const problem = automationLibraryDiagnostic(failure);
        if (
          [
            "locked",
            "access-changed",
            "database-unavailable",
            "desktop-required",
          ].includes(problem.code)
        ) {
          snapshotIdentity.current = null;
          setSnapshot(null);
        }
        setDiagnostic(problem);
      }
    }
  }, [identity, assertCurrent]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    const operationGeneration = generation;
    live.current = true;
    reviewed.current = null;
    snapshotIdentity.current = null;
    setSnapshot(null);
    setDiagnostic(null);
    setBusy(false);
    void load();
    return () => {
      live.current = false;
      operationGeneration.current++;
      reviewed.current = null;
    };
  }, [identity, binding?.api, load]);
  useEffect(() => {
    // A normal external revision refresh must not unmount an unsaved draft.
    if (
      binding?.scope.kind === "database" &&
      snapshotIdentity.current === identity
    )
      void load();
  }, [binding?.databaseRevision, binding?.scope.kind, identity, load]);
  const bound = Boolean(binding);
  useEffect(() => {
    if (!bound || binding?.scope.kind !== "app") return;
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.key === WEB_AUTOMATION_STORE_KEY)
        void load();
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    return () =>
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
  }, [binding?.scope.kind, bound, load]);
  const renderedGeneration = generation.current;
  const mutate = async (
    item: BrowserScript | null,
    expected?: BrowserScript,
  ) => {
    if (writing.current) return false;
    const captured = renderedGeneration;
    try {
      assertCurrent(captured);
      const owner = latest.current!,
        review = reviewed.current;
      if (!review || snapshotIdentity.current !== identity)
        throw accessChanged();
      const prior = expected
        ? review.entries.find((entry) => entry.payload.id === expected.id)
        : undefined;
      if (
        expected &&
        (!prior || JSON.stringify(prior.payload) !== JSON.stringify(expected))
      )
        throw new AutomationLibraryAccessError({
          code: "conflict",
          message:
            "The reviewed script changed. Retry and review before replacing or deleting it.",
          retryable: true,
        });
      writing.current = true;
      setBusy(true);
      setDiagnostic(null);
      reviewed.current = null; // The facade receipt is one-use, even if a write refuses.
      const next = await owner.api.apply(
        review,
        item
          ? [
              {
                operation: "put",
                entry: {
                  family: "website-script",
                  payload: item,
                  ...(prior?.provenance
                    ? { provenance: prior.provenance }
                    : {}),
                },
                expected: prior,
              },
            ]
          : [{ operation: "delete", expected: prior! }],
      );
      assertCurrent(captured);
      reviewed.current = next;
      snapshotIdentity.current = identity;
      setSnapshot(next);
      return true;
    } catch (failure) {
      if (live.current && captured === generation.current)
        setDiagnostic(automationLibraryDiagnostic(failure));
      return false;
    } finally {
      writing.current = false;
      if (live.current) {
        setBusy(false);
        if (pendingReload.current) {
          pendingReload.current = false;
          void latestLoad.current();
        }
      }
    }
  };
  const accessible = Boolean(
    binding?.enabled &&
    binding.settingsReady &&
    snapshotIdentity.current === identity &&
    snapshot,
  );
  const problem = binding?.diagnostic ?? diagnostic;
  return {
    scripts: accessible ? snapshot!.entries.map((entry) => entry.payload) : [],
    ready: accessible,
    busy,
    error: problem?.message ?? null,
    diagnostic: problem,
    epoch: identity,
    scope: binding?.scope ?? { kind: "app" as const },
    settingsReady: binding?.settingsReady ?? false,
    desktopAvailable: binding?.enabled
      ? true
      : problem?.code === "desktop-required"
        ? false
        : null,
    save: (item: BrowserScript, expected?: BrowserScript) =>
      mutate(item, expected),
    remove: (expected: BrowserScript) => mutate(null, expected),
    reload: async () => {
      if (binding && !binding.enabled) {
        binding.retry();
        return;
      }
      await load();
    },
  };
}
