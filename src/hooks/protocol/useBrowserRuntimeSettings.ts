import { useMemo, useRef } from "react";
import type { GlobalSettings } from "../../types/settings/settings";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import {
  normalizeWebBrowserSettings,
  resolveBrowserProxyPolicy,
} from "../../utils/settings/webBrowserSettings";

// A shared popup uses its source's actual native session, including after the
// user edits global defaults. Entries live only as long as the owning proxy.
const sessionPolicies = new Map<
  string,
  { proxyId: string; policy: HttpProxyPolicy }
>();
export const browserSessionPolicy = {
  bind(sourceId: string, proxyId: string, policy: HttpProxyPolicy) {
    sessionPolicies.set(sourceId, { proxyId, policy: structuredClone(policy) });
  },
  read(sourceId: string, proxyId: string): HttpProxyPolicy | null {
    const entry = sessionPolicies.get(sourceId);
    return entry?.proxyId === proxyId ? entry.policy : null;
  },
  release(sourceId: string, proxyId: string) {
    if (sessionPolicies.get(sourceId)?.proxyId === proxyId)
      sessionPolicies.delete(sourceId);
  },
};

/** Defaults belong to this tab; appearance and the next transport start stay live. */
export function useBrowserRuntimeSettings(
  sessionId: string,
  savedPolicy: unknown,
  settings: GlobalSettings,
  settingsReady: boolean | undefined,
  inheritedPolicy?: HttpProxyPolicy | null,
) {
  const live = useMemo(() => {
    try {
      return {
        settings: normalizeWebBrowserSettings(settings.webBrowser),
        error: null,
      };
    } catch {
      return {
        settings: normalizeWebBrowserSettings(undefined),
        error: "Invalid web browser settings. Review the values in Settings.",
      };
    }
  }, [settings.webBrowser]);
  const snapshot = useRef<{
    sessionId: string;
    settings: ReturnType<typeof normalizeWebBrowserSettings> | null;
  }>({ sessionId, settings: null });
  if (snapshot.current.sessionId !== sessionId)
    snapshot.current = { sessionId, settings: null };
  // Older context consumers omit the optional readiness flag. The real
  // provider supplies false until persisted settings have finished loading.
  const ready = settingsReady !== false;
  if (
    inheritedPolicy === undefined &&
    ready &&
    !snapshot.current.settings &&
    !live.error
  )
    snapshot.current.settings = live.settings;
  const defaults = snapshot.current.settings;
  const resolved = useMemo(() => {
    try {
      return {
        policy: defaults
          ? resolveBrowserProxyPolicy(savedPolicy, defaults)
          : null,
        error: null,
      };
    } catch {
      return {
        policy: null,
        error:
          "Invalid website proxy policy. Review this connection's internal proxy controls.",
      };
    }
  }, [defaults, savedPolicy]);
  const liveRef = useRef({
    browser: live.settings,
    transport: settings.internalProxy,
  });
  liveRef.current = {
    browser: live.settings,
    transport: settings.internalProxy,
  };
  return {
    browserSettings: live.settings,
    policy: inheritedPolicy === undefined ? resolved.policy : inheritedPolicy,
    error:
      inheritedPolicy === null
        ? "The source browser policy is unavailable. Reopen this popup from its source tab."
        : (live.error ?? resolved.error),
    ready,
    liveRef,
  };
}
