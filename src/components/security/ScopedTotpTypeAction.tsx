"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import type { RuntimeVaultTotpController } from "../../hooks/security/useRuntimeVaultTotp";
import {
  CredentialFailure,
  settleWithin,
} from "../../utils/security/credentialFailure";
import type { CredentialTypingTarget } from "../../utils/security/credentialTyping";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { useSessionObservationActivity } from "../../hooks/session/useSessionObservationActivity";

// Reading the authenticator is local work: an answer this late is not coming.
const generateTimeoutMs = 15_000;

/** For the reviewed redirect controller: its opaque entry handles must never be
 * interpreted as entries belonging to the temporary destination connection. */
export function ScopedTotpTypeAction({
  controller,
  id,
  target,
}: {
  controller: RuntimeVaultTotpController;
  id: string;
  target: CredentialTypingTarget | null;
}) {
  const active = useSessionObservationActivity(
    useSessionRenderActivity().isActive,
  );
  const latest = useRef({ controller, id, target, active });
  latest.current = { controller, id, target, active };
  const alive = useRef(false);
  const pending = useRef(false);
  const [status, setStatus] = useState({ busy: false, message: "" });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const type = async () => {
    if (pending.current || !target) return;
    const scope = controller.scopeKey;
    const started = Date.now();
    const check = () => {
      const current = latest.current;
      if (
        !alive.current ||
        !current.active ||
        document.hidden ||
        current.id !== id ||
        current.controller.scopeKey !== scope ||
        !current.controller.available ||
        current.target !== target ||
        Date.now() < started
      )
        throw new Error("Scope changed.");
      target.assertCurrent();
    };
    pending.current = true;
    setStatus({ busy: true, message: "" });
    let generated:
      Awaited<ReturnType<RuntimeVaultTotpController["generate"]>> | undefined;
    try {
      check();
      generated = await settleWithin(
        controller.generate(id),
        generateTimeoutMs,
        () => new CredentialFailure("resolution-timed-out"),
      );
      const assertDisclosure = () => {
        check();
        generated!.assertCurrent();
        if (
          !/^\d{6,8}$/.test(generated!.code) ||
          Date.now() >= generated!.expires
        )
          throw new CredentialFailure("code-expired");
      };
      assertDisclosure();
      await target.type(generated.code, assertDisclosure, {
        starts: started,
        expires: generated.expires,
      });
      if (alive.current)
        setStatus({
          busy: false,
          message:
            target.confirmation === "sent"
              ? "Code sent to the session."
              : "Code typed.",
        });
    } catch (error) {
      if (alive.current)
        setStatus({
          busy: false,
          message:
            error instanceof CredentialFailure
              ? error.message
              : "Could not type the code. Focus the session field and reopen Credentials & 2FA.",
        });
    } finally {
      generated = undefined;
      pending.current = false;
    }
  };
  return (
    <span className="inline-flex min-w-0 max-w-32 flex-col items-end">
      <button
        type="button"
        className="sor-icon-btn-sm"
        aria-label="Type code"
        title="Type code"
        disabled={!active || !controller.available || !target || status.busy}
        onClick={() => void type()}
      >
        <Keyboard size={14} aria-hidden="true" />
      </button>
      {status.message && (
        <span
          role="status"
          className="mt-1 max-w-full whitespace-normal text-right text-[10px] leading-tight text-[var(--color-textSecondary)] [overflow-wrap:anywhere]"
        >
          {status.message}
        </span>
      )}
    </span>
  );
}
