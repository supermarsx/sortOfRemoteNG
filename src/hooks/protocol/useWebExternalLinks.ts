import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import { externalWebLink } from "../../utils/protocol/webExternalLink";

export interface ExternalLinkContext {
  frame: Window;
  document: WebAutomationDocument;
  sourceOrigin: string;
  captureAccess: () => () => void;
}
type ArmedContext = ExternalLinkContext & { assertAccessible: () => void };

export function useWebExternalLinks(current: () => ExternalLinkContext | null) {
  const latest = useRef(current);
  latest.current = current;
  const context = current();
  const [pending, setPending] = useState<{
    context: ArmedContext;
    url: string;
  } | null>(null);
  const pendingRef = useRef(pending);
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = (captured: ExternalLinkContext) => {
    const next = latest.current();
    return (
      next?.frame === captured.frame &&
      next.document === captured.document &&
      next.sourceOrigin === captured.sourceOrigin
    );
  };
  const cancel = () => {
    pendingRef.current = null;
    setPending(null);
    setError("");
  };

  useEffect(() => {
    if (!context) return;
    let armed: ArmedContext;
    try {
      // Retain the existing database lease; never acquire a fresh lease when
      // a delayed page message or a later Open click arrives.
      armed = { ...context, assertAccessible: context.captureAccess() };
    } catch {
      return;
    }
    const { frame, document, sourceOrigin } = context;
    const origin = new URL(document.url).origin;
    const arm = (enabled: boolean) => {
      try {
        frame.postMessage(
          {
            type: "sorng_owa_external_links",
            version: 1,
            sessionId: document.sessionId,
            documentToken: document.token,
            documentSequence: document.sequence,
            navigationToken: document.navigationToken,
            enabled,
          },
          origin,
        );
      } catch {
        // The frame may already have been removed during navigation/unmount.
        // Messages cannot open a browser and no alternate bridge is used.
      }
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        !matches(context) ||
        pendingRef.current ||
        opening.current ||
        event.source !== frame ||
        event.origin !== origin ||
        data?.type !== "sorng_owa_external_link" ||
        data.version !== 1 ||
        data.sessionId !== document.sessionId ||
        data.documentToken !== document.token ||
        data.documentSequence !== document.sequence ||
        data.navigationToken !== document.navigationToken
      )
        return;
      const url = externalWebLink(data.destinationUrl, sourceOrigin);
      if (!url) return;
      try {
        armed.assertAccessible();
      } catch {
        return;
      }
      const request = { context: armed, url };
      pendingRef.current = request;
      setPending(request);
      setError("");
    };
    window.addEventListener("message", receive);
    arm(true);
    return () => {
      window.removeEventListener("message", receive);
      arm(false);
      pendingRef.current = null;
      setPending(null);
      setError("");
    };
    // Identity is immutable for the accepted document. The current getter
    // rechecks mutable navigation/ownership fences before receiving or opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.frame, context?.document, context?.sourceOrigin]);

  const open = async (gesture: Pick<Event, "isTrusted">) => {
    const request = pendingRef.current;
    if (!gesture.isTrusted || !request || opening.current) return;
    if (!matches(request.context)) {
      cancel();
      return;
    }
    const url = externalWebLink(request.url, request.context.sourceOrigin);
    if (!url) {
      cancel();
      return;
    }
    try {
      request.context.assertAccessible();
    } catch {
      cancel();
      return;
    }
    opening.current = true;
    setBusy(true);
    setError("");
    try {
      // URL only: no browser cookies, headers, saved login, or referrer.
      await invoke("open_url_external", { url });
      if (pendingRef.current === request) cancel();
    } catch {
      if (pendingRef.current === request && matches(request.context))
        setError("Could not open the system browser. Try again or cancel.");
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };
  return {
    url: pending && matches(pending.context) ? pending.url : null,
    busy,
    error,
    cancel,
    open,
  };
}
