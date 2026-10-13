import { useCallback, useEffect, useRef, useState } from "react";
import {
  copySecretToClipboard,
  type CredentialClipboardKind,
} from "../../utils/security/credentialClipboard";
import {
  CredentialFailure,
  failedOutcome,
  type CredentialOutcome,
} from "../../utils/security/credentialFailure";
import { totpRemainingFailure } from "../../utils/security/totpCode";

/** How long the tick stays after a successful copy. */
const TICK_MS = 1500;

/**
 * The copy buttons of one panel. One copy at a time: a request made while a
 * write is pending is ignored, so the tick and the message always belong to
 * the write that was made.
 *
 * `copied` is the `key` of the button whose write succeeded, for 1.5 s.
 * `error` is the cause of the last failure, until the next outcome. `copy`
 * resolves to that outcome, or to null for an ignored request; it still
 * resolves after unmount, so a caller can report a failure elsewhere. The
 * value itself goes to the clipboard only: it is never kept or logged here.
 *
 * Pass `expires` (Unix milliseconds) only for a one-time code. The code is
 * refused while too little of its time step is left to use it, and otherwise
 * leaves the clipboard with that step.
 */
export function useSecretCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<{
    pending: boolean;
    closed: boolean;
    tick?: ReturnType<typeof setTimeout>;
  }>({ pending: false, closed: false });

  useEffect(() => {
    const state = work.current;
    state.closed = false;
    return () => {
      state.closed = true;
      clearTimeout(state.tick);
    };
  }, []);

  const copy = useCallback(
    async (
      key: string,
      value: string,
      kind: CredentialClipboardKind,
      expires?: number,
    ): Promise<CredentialOutcome | null> => {
      const state = work.current;
      if (state.pending) return null;
      state.pending = true;
      const closing =
        expires === undefined
          ? null
          : totpRemainingFailure(expires, Date.now());
      const outcome = closing
        ? failedOutcome(new CredentialFailure(closing))
        : await copySecretToClipboard(value, kind, { expires });
      state.pending = false;
      if (state.closed) return outcome;
      clearTimeout(state.tick);
      setCopied(outcome.ok ? key : null);
      setError(outcome.ok ? null : outcome.message);
      if (outcome.ok) state.tick = setTimeout(() => setCopied(null), TICK_MS);
      return outcome;
    },
    [],
  );

  return { copied, error, copy };
}
