import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { CredentialTypingTarget } from "../../utils/security/credentialTyping";

export type CaptureCredentialTarget = (
  isPopupControl: (element: Element) => boolean,
) => CredentialTypingTarget | Promise<CredentialTypingTarget>;

/** Captures before popup focus changes, and revokes on close/unmount. */
export function useCredentialTyping(
  open: boolean,
  capture?: CaptureCredentialTarget,
) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<CredentialTypingTarget | null>(null);
  const epoch = useRef(0);
  const [target, setTarget] = useState<CredentialTypingTarget | null>(null);
  const dispose = () => {
    epoch.current++;
    targetRef.current?.dispose();
    targetRef.current = null;
    setTarget(null);
  };
  useEffect(() => {
    if (!open) dispose();
    // The close transition owns revocation, not factory identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(
    () => () => {
      epoch.current++;
      targetRef.current?.dispose();
    },
    [],
  );
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (open || event.button !== 0) return;
    // Preserve the session's exact active element while requesting its lease.
    event.preventDefault();
    dispose();
    const ticket = epoch.current;
    const trigger = event.currentTarget;
    try {
      const pending = capture?.(
        (element) =>
          element === trigger || !!popupRef.current?.contains(element),
      );
      if (!pending) return;
      void Promise.resolve(pending)
        .then((next) => {
          if (ticket !== epoch.current) {
            next.dispose();
            return;
          }
          let consumed = false;
          let inFlight = false;
          const captured: CredentialTypingTarget = {
            sessionId: next.sessionId,
            assertCurrent: () => {
              if (consumed) throw new Error("Typing target consumed.");
              next.assertCurrent();
            },
            dispose: () => {
              consumed = true;
              next.dispose();
            },
            type: async (value, assertDisclosure, validity) => {
              if (consumed || inFlight)
                throw new Error("Typing target consumed or busy.");
              inFlight = true;
              try {
                await next.type(value, assertDisclosure, validity);
              } finally {
                captured.dispose();
                if (ticket === epoch.current) {
                  targetRef.current = null;
                  setTarget(null);
                }
              }
            },
          };
          targetRef.current = captured;
          setTarget(captured);
        })
        .catch(() => {
          /* Fixed UI guidance; never surface native errors. */
        });
    } catch {
      /* Absent/changed focus leaves typing disabled. */
    }
  };
  return { target, popupRef, onPointerDown };
}
