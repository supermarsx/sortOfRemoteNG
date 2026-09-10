import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import {
  getRuntimeWebNavigation,
  registerRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";
import { OPEN_RUNTIME_CONNECTION_EVENT } from "../session/useRuntimeConnectionLaunch";
import { getGlobalHttpProxyUrl } from "../integration/httpProxy";
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
}
interface Pending {
  review: HttpRedirectReview;
  assertCurrent: () => void;
  assertLaunchCurrent: () => void;
  signature: string;
}
export function useHttpRedirectReview(options: Options) {
  const signature = JSON.stringify([
    options.connection,
    options.accessKey,
    options.sourceOrigin,
    options.route,
    options.enabled,
  ]);
  const latest = useRef({ options, signature });
  latest.current = { options, signature };
  const live = useRef(true);
  const pending = useRef<Pending | null>(null);
  const action = useRef(0);
  const accepting = useRef(false);
  const dismissedReceipt = useRef<string | null>(null);
  const [review, setReview] = useState<HttpRedirectReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const offer = async () => {
    const current = latest.current;
    const { options: captured } = current;
    if (!captured.enabled || !captured.connection || !captured.accessKey)
      return;
    const id = captured.proxySessionId(),
      generation = captured.generation(),
      navigationToken = captured.navigationToken();
    if (!id || pending.current?.review.sessionId === id) return;
    const token = ++action.current;
    try {
      const assertOwner = captureSessionDatabaseAccess(captured.session);
      const assertCurrent = () => {
        assertOwner();
        if (
          !live.current ||
          latest.current.signature !== current.signature ||
          captured.generation() !== generation ||
          captured.proxySessionId() !== id ||
          captured.navigationToken() !== navigationToken ||
          getGlobalHttpProxyUrl({ failClosed: true }) !== captured.route
        )
          throw new Error(
            "Redirect review expired. Reopen the owning database and retry the navigation.",
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
      )
        return;
      const depth =
        getRuntimeWebNavigation(captured.connection.id)?.redirectHops ?? 0;
      if (depth >= 5) {
        setError(
          "Five redirect handoffs have already been reviewed. Open the intended destination as a separate connection; no redirect loop was followed.",
        );
        return;
      }
      pending.current = {
        review: receipt,
        assertCurrent,
        assertLaunchCurrent,
        signature: current.signature,
      };
      setError("");
      setReview(receipt);
    } catch {
      if (live.current && token === action.current)
        setError(
          "Redirect review is unavailable. Restore access to the owning database and retry; nothing was forwarded.",
        );
    }
  };
  const cancel = () => {
    if (accepting.current) return;
    dismissedReceipt.current = pending.current?.review.receiptId ?? null;
    ++action.current;
    pending.current = null;
    setReview(null);
    setBusy(false);
    setError("");
  };
  const accept = async () => {
    const receipt = pending.current;
    if (!receipt || accepting.current) return;
    accepting.current = true;
    const token = ++action.current;
    const captured = latest.current.options;
    setBusy(true);
    setError("");
    try {
      receipt.assertCurrent();
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
      if (
        token !== action.current ||
        !consumed ||
        JSON.stringify(consumed) !== JSON.stringify(receipt.review)
      )
        throw new Error();
      await captured.stopSource(receipt.review.sessionId);
      receipt.assertLaunchCurrent();
      if (token !== action.current) return;
      const connection = anonymousRedirectConnection(
        captured.connection,
        consumed,
      );
      registerRuntimeConnection(connection, {
        initialUrl: consumed.destinationUrl,
        redirectHops:
          (getRuntimeWebNavigation(captured.connection.id)?.redirectHops ?? 0) +
          1,
        assertCurrent: receipt.assertLaunchCurrent,
      });
      window.dispatchEvent(
        new CustomEvent(OPEN_RUNTIME_CONNECTION_EVENT, {
          detail: { connection, source: "httpRedirect" },
        }),
      );
      pending.current = null;
      setReview(null);
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
  return {
    review: review && pending.current?.signature === signature ? review : null,
    busy,
    error,
    offer,
    cancel,
    accept,
  };
}
