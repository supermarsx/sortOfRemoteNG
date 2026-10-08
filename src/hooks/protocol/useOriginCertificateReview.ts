"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  ORIGIN_CERTIFICATE_REVIEW_EVENT,
  readOriginCertificateReview,
  type OriginCertificateDecision,
  type OriginCertificatePrompt,
  type OriginCertificateReviewTransport,
} from "../../types/protocols/originBrowserCertificateReview";

export const nativeCertificateReviewTransport: OriginCertificateReviewTransport =
  {
    listen: (listener) =>
      listen<unknown>(
        ORIGIN_CERTIFICATE_REVIEW_EVENT,
        (event) => listener(event.payload),
        {
          target: {
            kind: "WebviewWindow",
            label: getCurrentWebviewWindow().label,
          },
        },
      ),
    request: (request) =>
      invoke("origin_browser_certificate_review", { request }),
  };
interface ReviewState {
  prompt: OriginCertificatePrompt | null;
  submitting: boolean;
  error: string | null;
}
type Respond = (
  prompt: OriginCertificatePrompt,
  decision: OriginCertificateDecision,
) => Promise<boolean>;
const unavailable: Respond = async () => false;
const empty: ReviewState = { prompt: null, submitting: false, error: null };

/** Global owner-window subscription: works while browser creation is still waiting on TLS. */
export function useOriginCertificateReview(
  options: {
    transport?: OriginCertificateReviewTransport;
    enabled?: boolean;
  } = {},
) {
  const transport = options.transport ?? nativeCertificateReviewTransport;
  const enabled =
    options.enabled ?? (options.transport !== undefined || isTauri());
  const [state, setState] = useState<ReviewState>(empty);
  const responder = useRef<Respond>(unavailable);

  useEffect(() => {
    setState(empty);
    if (!enabled) return;
    let active = true;
    let revision = -1;
    let current: OriginCertificatePrompt | null = null;
    let submitting: OriginCertificatePrompt | null = null;
    let error: string | null = null;
    let unsubscribe: (() => void) | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let querying = false;
    let queryAgain = false;
    const denied = new Set<string>();
    const key = (prompt: OriginCertificatePrompt) =>
      JSON.stringify([prompt.requestId, prompt.identity]);
    const publish = () => {
      if (!active) return;
      const next = {
        prompt: current,
        submitting: !!current && submitting === current,
        error,
      };
      setState((previous) =>
        previous.prompt === next.prompt &&
        previous.submitting === next.submitting &&
        previous.error === next.error
          ? previous
          : next,
      );
    };
    const deny = (prompt: OriginCertificatePrompt) => {
      const token = key(prompt);
      if (denied.has(token)) return;
      denied.add(token);
      // Cleanup must never become an approval, retry a grant or surface raw native errors.
      try {
        void transport
          .request({
            action: "respond",
            requestId: prompt.requestId,
            identity: prompt.identity,
            decision: "cancel",
          })
          .catch(() => {});
      } catch {
        /* Native timeout still denies if the bridge has gone away. */
      }
    };
    const expire = (prompt: OriginCertificatePrompt) => {
      if (!active || current !== prompt) return;
      current = null;
      submitting = null;
      error = null;
      publish();
      deny(prompt);
    };
    const receive = (value: unknown) => {
      if (!active) return;
      const snapshot = readOriginCertificateReview(value);
      if (!snapshot) {
        if (current) expire(current);
        return;
      }
      if (snapshot.revision <= revision) return;
      revision = snapshot.revision;
      let next = snapshot.prompt;
      if (
        next &&
        (next.expiresAtUnixMs <= Date.now() || denied.has(key(next)))
      ) {
        deny(next);
        next = null;
      }
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      if (expiry !== undefined) clearTimeout(expiry);
      current = next;
      submitting = null;
      error = null;
      if (next) {
        const prompt = next;
        expiry = setTimeout(
          () => expire(prompt),
          Math.min(2_147_483_647, prompt.expiresAtUnixMs - Date.now()),
        );
      }
      publish();
    };
    const query = async (refreshAfterInFlight = false) => {
      if (!active) return;
      if (querying) {
        queryAgain ||= refreshAfterInFlight;
        return;
      }
      querying = true;
      try {
        const value = await transport.request({ action: "pending" });
        if (active) receive(value);
        else {
          // Unmount can race the initial inventory read before a prompt was displayed.
          const pending = readOriginCertificateReview(value)?.prompt;
          if (pending) deny(pending);
        }
      } catch {
        if (active && current) {
          error =
            "Certificate review could not be refreshed. Cancel or wait for it to expire.";
          publish();
        }
      } finally {
        querying = false;
        if (active && queryAgain) {
          queryAgain = false;
          void query();
        }
      }
    };
    const respond: Respond = async (prompt, decision) => {
      // Compare the actual receipt object, not only its IDs: old A callbacks
      // must not respond to a later A after a replacement or removal.
      if (
        !active ||
        current !== prompt ||
        submitting ||
        !["allow-once", "remember", "cancel"].includes(decision)
      )
        return false;
      if (prompt.expiresAtUnixMs <= Date.now()) {
        expire(prompt);
        return false;
      }
      submitting = prompt;
      error = null;
      publish();
      try {
        const value = await transport.request({
          action: "respond",
          requestId: prompt.requestId,
          identity: prompt.identity,
          decision,
        });
        if (!active) return false;
        receive(value);
        return true;
      } catch {
        if (active && current === prompt) {
          error =
            "The certificate decision could not be confirmed. No automatic retry was made. Cancel or review again.";
          publish();
        }
        // A stale/unknown token is not an authorization. Reconcile once instead
        // of retrying the decision or leaving a revoked prompt on screen.
        if (active) await query(true);
        return false;
      } finally {
        if (active && submitting === prompt) {
          submitting = null;
          publish();
        }
      }
    };
    responder.current = respond;
    const focus = () => {
      void query();
    };
    void (async () => {
      try {
        const off = await transport.listen(receive);
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
        window.addEventListener("focus", focus);
        await query();
      } catch {
        // No listener means no trustworthy review UI. Native expiry remains deny-only.
        if (current) expire(current);
      }
    })();
    return () => {
      active = false;
      if (responder.current === respond) responder.current = unavailable;
      window.removeEventListener("focus", focus);
      unsubscribe?.();
      if (expiry !== undefined) clearTimeout(expiry);
      if (current) deny(current);
    };
  }, [enabled, transport]);

  const respond = useCallback<Respond>(
    (prompt, decision) => responder.current(prompt, decision),
    [],
  );
  return { ...state, respond };
}
