import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import type { useHttpRedirectTrust } from "./useHttpRedirectTrust";
import {
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  releaseRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";
import { OPEN_RUNTIME_CONNECTION_EVENT } from "../session/useRuntimeConnectionLaunch";
import { getGlobalHttpProxyUrl } from "../integration/httpProxy";
import {
  authenticatedRedirectConnection,
  normalizeRedirectAuthentication,
  redirectAuthenticationAvailability,
} from "../../utils/protocol/httpRedirectAuthentication";
import {
  anonymousRedirectConnection,
  parseHttpRedirectReview,
  type HttpRedirectReview,
} from "../../utils/protocol/httpRedirectReview";

interface Options {
  connection?: Connection;
  session: ConnectionSession;
  sourceOrigin: string;
  accessKey: string;
  route: string | undefined;
  enabled: boolean;
  generation: () => number;
  proxySessionId: () => string;
  navigationToken: () => string | null;
  stopSource: (sessionId: string) => Promise<void>;
  /** Replace only the tab's ephemeral target, never the saved connection. */
  continueInTab?: (connection: Connection) => void;
  trust?: ReturnType<typeof useHttpRedirectTrust>;
}
type TrustInspection = Awaited<
  ReturnType<NonNullable<Options["trust"]>["inspect"]>
>;
interface Pending {
  review: HttpRedirectReview;
  assertCurrent: () => void;
  assertLaunchCurrent: () => void;
  signature: string;
  assertTransportCurrent: () => void;
  trust: TrustInspection | null;
}
export const MAX_HTTP_REDIRECT_HANDOFFS = 5;

export function useHttpRedirectReview(options: Options) {
  // Successful connection bookkeeping arrives on a delayed timer. It must not
  // dismiss a live receipt. All other fields remain part of the security fence,
  // including future authentication, route and policy settings.
  const connectionIdentity = options.connection
    ? {
        ...options.connection,
        lastConnected: undefined,
        connectionCount: undefined,
      }
    : undefined;
  const signature = stableJsonStringify([
    connectionIdentity,
    options.accessKey,
    options.sourceOrigin,
    options.route,
    options.enabled,
    options.trust?.revision,
  ]);
  // Saving an explicitly reviewed origin changes only the local consent list.
  // The save adapter separately fences that exact delta and its durable result.
  const transportSignature = stableJsonStringify([
    connectionIdentity && {
      ...connectionIdentity,
      httpTrustedRedirectDestinations: undefined,
    },
    options.accessKey,
    options.sourceOrigin,
    options.route,
    options.enabled,
  ]);
  const latest = useRef({ options, signature, transportSignature });
  latest.current = { options, signature, transportSignature };
  const live = useRef(true);
  const pending = useRef<Pending | null>(null);
  const action = useRef(0);
  const accepting = useRef(false);
  const remembering = useRef(false);
  const manuallyRememberedReceipt = useRef<string | null>(null);
  const rememberReplayGuard = useRef<(() => void) | null>(null);
  const offering = useRef<{
    key: string;
    reportError: boolean;
    userInitiated: boolean;
  } | null>(null);
  const dismissedReceipt = useRef<string | null>(null);
  const [review, setReview] = useState<HttpRedirectReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trustNotice, setTrustNotice] = useState("");
  const [rememberingDestination, setRememberingDestination] = useState(false);
  const [rememberVersion, setRememberVersion] = useState(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Operation generation, not a DOM node; invalidate the latest attempt.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++action.current;
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    ++action.current;
    pending.current = null;
    setReview(null);
    setBusy(false);
    setError("");
  }, [signature]);
  const offer = async (userInitiated = false, discoveryOnly = false) => {
    const current = latest.current;
    const { options: captured } = current;
    if (!captured.enabled || !captured.connection || !captured.accessKey) {
      if (userInitiated)
        setError(
          !captured.enabled
            ? "Enable reviewed cross-origin redirects in this connection's settings, then reload the source page."
            : "Open and unlock this session's owning database before reviewing the destination.",
        );
      return;
    }
    const id = captured.proxySessionId(),
      generation = captured.generation(),
      navigationToken = captured.navigationToken();
    if (!id) {
      if (userInitiated)
        setError(
          "The source proxy is no longer available. Reload the source page to request a new redirect.",
        );
      return;
    }
    if (
      pending.current?.review.sessionId === id ||
      accepting.current ||
      remembering.current
    )
      return;
    if (userInitiated) dismissedReceipt.current = null;
    const requestKey = JSON.stringify([
      current.signature,
      id,
      generation,
      navigationToken,
    ]);
    if (offering.current?.key === requestKey) {
      offering.current.reportError ||= !discoveryOnly;
      offering.current.userInitiated ||= userInitiated;
      return;
    }
    const request = {
      key: requestKey,
      reportError: !discoveryOnly,
      userInitiated,
    };
    offering.current = request;
    const token = ++action.current;
    try {
      const assertOwner = captureSessionDatabaseAccess(captured.session);
      const assertTransportCurrent = () => {
        assertOwner();
        if (
          !live.current ||
          latest.current.transportSignature !== current.transportSignature ||
          captured.generation() !== generation ||
          captured.proxySessionId() !== id ||
          captured.navigationToken() !== navigationToken ||
          getGlobalHttpProxyUrl({ failClosed: true }) !== captured.route
        )
          throw new Error(
            "Redirect review expired. Reopen the owning database and retry the navigation.",
          );
      };
      const assertCurrent = () => {
        assertTransportCurrent();
        if (latest.current.signature !== current.signature)
          throw new Error(
            "Redirect settings changed. Review the destination again.",
          );
      };
      const assertLaunchCurrent = () => {
        assertOwner();
        // The canonical launcher may close the source in single-connection
        // mode. A mount flag is not database authority after explicit acceptance.
        if (
          getGlobalHttpProxyUrl({ failClosed: true }) !== captured.route ||
          (live.current &&
            (latest.current.signature !== current.signature ||
              captured.generation() !== generation))
        )
          throw new Error("The redirect's database or network route changed.");
      };
      assertCurrent();
      const value = await invoke<unknown>("review_proxy_redirect", {
        sessionId: id,
        receiptId: null,
      });
      assertCurrent();
      if (token !== action.current || captured.proxySessionId() !== id) return;
      const receipt = parseHttpRedirectReview(
        value,
        id,
        captured.sourceOrigin,
        captured.connection.httpProxyPolicy,
      );
      if (
        !receipt ||
        receipt.receiptId === dismissedReceipt.current ||
        (receipt.navigationToken !== null &&
          receipt.navigationToken !== captured.navigationToken())
      ) {
        if (request.userInitiated)
          setError(
            "No current redirect destination is available. Reload the source page and review its next redirect.",
          );
        return;
      }
      const depth =
        getRuntimeWebNavigation(captured.connection.id)?.redirectHops ?? 0;
      if (depth >= MAX_HTTP_REDIRECT_HANDOFFS) {
        setError(
          "Five redirect handoffs have already been reviewed. Open the intended destination as a separate connection; no redirect loop was followed.",
        );
        return;
      }
      if (receipt.receiptId !== manuallyRememberedReceipt.current)
        setTrustNotice("");
      let trust: TrustInspection | null = null;
      if (captured.trust) {
        try {
          trust = await captured.trust.inspect(receipt, assertCurrent);
          trust.assertCurrent();
        } catch {
          trust = null;
          setTrustNotice(
            "Saved redirect destinations could not be verified. Open and unlock the owning database, then retry. You can still review this one-time destination; it has not been trusted automatically.",
          );
        }
      }
      assertCurrent();
      if (token !== action.current) return;
      pending.current = {
        review: receipt,
        assertCurrent,
        assertLaunchCurrent,
        signature: current.signature,
        assertTransportCurrent,
        trust,
      };
      setError("");
      setReview(receipt);
    } catch {
      if (request.reportError && live.current && token === action.current)
        setError(
          "Redirect review is unavailable. Restore access to the owning database and retry; nothing was forwarded.",
        );
    } finally {
      if (offering.current === request) offering.current = null;
    }
  };
  const cancel = () => {
    if (accepting.current || remembering.current) return;
    dismissedReceipt.current = pending.current?.review.receiptId ?? null;
    rememberReplayGuard.current = null;
    ++action.current;
    pending.current = null;
    setReview(null);
    setBusy(false);
    setError("");
    setTrustNotice("");
  };
  const canAutomaticallyContinue = (
    captured: Options,
    current: Pending,
  ): boolean => {
    try {
      return !!(
        current.trust?.trusted &&
        current.review.receiptId !== manuallyRememberedReceipt.current &&
        captured.continueInTab &&
        captured.enabled &&
        captured.connection?.httpProxyPolicy?.allowCrossOriginRedirects ===
          true &&
        normalizeRedirectAuthentication(
          captured.connection?.httpRedirectAuthentication,
        ).mode === "none"
      );
    } catch {
      return false;
    }
  };
  const accept = async (
    destination: "current" | "anonymous" = "anonymous",
    carrySavedLogin = false,
    insecureApproved = false,
    automatic = false,
  ) => {
    const receipt = pending.current;
    if (!receipt || accepting.current || remembering.current) return;
    accepting.current = true;
    const token = ++action.current;
    const captured = latest.current.options;
    setBusy(true);
    setError("");
    try {
      if (destination !== "current" && destination !== "anonymous")
        throw new Error();
      if (destination === "current" && !captured.continueInTab)
        throw new Error();
      if (
        carrySavedLogin &&
        (destination !== "current" ||
          !redirectAuthenticationAvailability(
            captured.connection,
            receipt.review,
          ).available)
      )
        throw new Error();
      receipt.assertCurrent();
      if (automatic) {
        if (
          !captured.trust ||
          destination !== "current" ||
          carrySavedLogin ||
          insecureApproved
        )
          throw new Error();
        // Read persisted consent again immediately before consuming the receipt.
        // An optimistic editor update or failed flush is never authorization.
        receipt.trust = await captured.trust.inspect(
          receipt.review,
          receipt.assertCurrent,
        );
        receipt.trust.assertCurrent();
        if (!canAutomaticallyContinue(captured, receipt)) throw new Error();
      }
      if (
        captured.proxySessionId() !== receipt.review.sessionId ||
        !captured.connection
      )
        throw new Error();
      const consumed = parseHttpRedirectReview(
        await invoke<unknown>("review_proxy_redirect", {
          sessionId: receipt.review.sessionId,
          receiptId: receipt.review.receiptId,
        }),
        receipt.review.sessionId,
        captured.sourceOrigin,
        captured.connection.httpProxyPolicy,
      );
      receipt.assertCurrent();
      if (automatic) receipt.trust?.assertCurrent();
      if (
        token !== action.current ||
        !consumed ||
        JSON.stringify(consumed) !== JSON.stringify(receipt.review)
      )
        throw new Error();
      // Validate the complete destination/login choice before stopping the
      // source. The new object remains volatile and is never a saved edit.
      const connection = carrySavedLogin
        ? authenticatedRedirectConnection(
            captured.connection,
            consumed,
            insecureApproved,
          )
        : anonymousRedirectConnection(captured.connection, consumed);
      const assertLaunchCurrent = () => {
        receipt.assertLaunchCurrent();
        // The expected source stop invalidates receipt transport, not the
        // original database lease or the persisted destination permission.
        if (automatic) {
          if (!receipt.trust?.assertLaunchCurrent) throw new Error();
          receipt.trust.assertLaunchCurrent();
        }
      };
      await captured.stopSource(receipt.review.sessionId);
      assertLaunchCurrent();
      if (token !== action.current) return;
      registerRuntimeConnection(connection, {
        initialUrl: consumed.destinationUrl,
        redirectHops:
          (getRuntimeWebNavigation(captured.connection.id)?.redirectHops ?? 0) +
          1,
        assertCurrent: assertLaunchCurrent,
        trustedRedirectSource: receipt.trust?.provenance ?? undefined,
      });
      try {
        assertLaunchCurrent();
        if (destination === "current") captured.continueInTab!(connection);
        else
          window.dispatchEvent(
            new CustomEvent(OPEN_RUNTIME_CONNECTION_EVENT, {
              detail: { connection, source: "httpRedirect" },
            }),
          );
      } catch (error) {
        releaseRuntimeConnection(connection.id);
        throw error;
      }
      pending.current = null;
      setReview(null);
      rememberReplayGuard.current = null;
    } catch {
      if (live.current && token === action.current)
        setError(
          "The redirect expired or access changed. No destination was opened. Retry the original navigation to review again.",
        );
    } finally {
      accepting.current = false;
      if (live.current && token === action.current) setBusy(false);
    }
  };
  const rememberDestination = async () => {
    const current = pending.current;
    const captured = latest.current.options;
    if (
      !current ||
      !captured.trust?.canRemember ||
      accepting.current ||
      remembering.current
    )
      return;
    remembering.current = true;
    setRememberingDestination(true);
    setTrustNotice("");
    try {
      current.assertCurrent();
      // Only the still-current native receipt can be saved, never page text.
      const verified = parseHttpRedirectReview(
        await invoke<unknown>("review_proxy_redirect", {
          sessionId: current.review.sessionId,
          receiptId: null,
        }),
        current.review.sessionId,
        captured.sourceOrigin,
        captured.connection?.httpProxyPolicy,
      );
      current.assertCurrent();
      if (
        !verified ||
        stableJsonStringify(verified) !== stableJsonStringify(current.review)
      )
        throw new Error();
      // Trust is a separate action. Saving must not turn this click into
      // navigation; the destination is skipped only on future receipts.
      manuallyRememberedReceipt.current = current.review.receiptId;
      await captured.trust.remember(
        current.review,
        current.assertTransportCurrent,
      );
      current.assertTransportCurrent();
      setTrustNotice(
        "Destination saved for the original connection. Certificate checks and login permissions are unchanged.",
      );
    } catch {
      if (live.current)
        setTrustNotice(
          "The destination could not be saved and verified. Check the owning database and its save status, then try again. No automatic trust was granted.",
        );
    } finally {
      remembering.current = false;
      if (live.current) {
        setRememberingDestination(false);
        pending.current = null;
        setReview(null);
        // Wait for the persisted connection/revision render, then obtain a new
        // current native receipt instead of continuing with pre-save authority.
        rememberReplayGuard.current = current.assertTransportCurrent;
        setRememberVersion((version) => version + 1);
      }
    }
  };
  const actionsRef = useRef({ offer, accept });
  actionsRef.current = { offer, accept };
  useEffect(() => {
    if (rememberVersion > 0 && rememberReplayGuard.current) {
      try {
        rememberReplayGuard.current();
        void actionsRef.current.offer(true);
      } catch {
        // Navigation/owner changes cancel the save's recovery; do not overlay
        // an unrelated new page with the old receipt's unavailable error.
        rememberReplayGuard.current = null;
      }
    }
  }, [rememberVersion, signature]);
  useEffect(() => {
    const current = pending.current;
    if (
      current &&
      current.signature === signature &&
      canAutomaticallyContinue(latest.current.options, current)
    )
      void actionsRef.current.accept("current", false, false, true);
  }, [review, signature]);
  return {
    redirectStep: Math.min(
      (getRuntimeWebNavigation(options.connection?.id ?? "")?.redirectHops ??
        0) + 1,
      MAX_HTTP_REDIRECT_HANDOFFS,
    ),
    maxRedirectHops: MAX_HTTP_REDIRECT_HANDOFFS,
    authentication: redirectAuthenticationAvailability(
      options.connection,
      review,
    ),
    review: review && pending.current?.signature === signature ? review : null,
    busy: busy || rememberingDestination,
    error,
    trustNotice,
    trustedDestination:
      pending.current?.signature === signature &&
      pending.current.trust?.trusted === true,
    canRememberDestination: options.trust?.canRemember === true,
    rememberUnavailableReason:
      options.trust?.unavailableReason ??
      "Save this connection in an open database first.",
    rememberingDestination,
    rememberDestination,
    offer,
    cancel,
    accept,
  };
}
