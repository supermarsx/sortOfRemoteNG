import { AlertOctagon, RotateCcw, ShieldAlert } from "lucide-react";
import { Checkbox } from "../../ui/forms";
import {
  acknowledgeRloginPlaintext,
  isRloginPlaintextAcknowledged,
  resetRloginPlaintextAcknowledgement,
} from "../../../utils/rlogin/rloginSettings";
import { RloginEditorSectionFrame } from "./Section";
import type { RloginSettingsSectionProps } from "./types";

export interface RloginSecuritySectionProps extends RloginSettingsSectionProps {
  now?: () => Date;
}

export function RloginSecuritySection({
  settings,
  onChange,
  validation,
  disabled,
  now = () => new Date(),
}: RloginSecuritySectionProps) {
  const acknowledged = isRloginPlaintextAcknowledged(settings);
  const acknowledgementError =
    validation?.errorsByField.plaintextAcknowledgement;

  return (
    <RloginEditorSectionFrame
      id="rlogin-security-section"
      title="Security"
      description="RLogin is a legacy plaintext protocol. Review and explicitly acknowledge the risk for this connection."
      icon={<ShieldAlert size={16} />}
    >
      <div
        role="alert"
        className="rounded-md border border-danger/40 bg-danger/10 px-3 py-3 text-xs leading-5 text-[var(--color-text)]"
      >
        <div className="flex items-start gap-2">
          <AlertOctagon
            size={16}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
          <div>
            <p className="font-semibold text-danger">
              Usernames and terminal traffic are sent in plaintext
            </p>
            <p className="mt-1 text-[var(--color-textSecondary)]">
              RLogin provides no encryption, integrity protection, or secure
              server authentication. Anyone able to observe or modify the
              network path may read or alter the session.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-3 text-xs leading-5 text-[var(--color-textSecondary)]">
        <p className="font-semibold text-warning">No password automation</p>
        <p className="mt-1">
          RFC 1282 does not include a password in its handshake. This client
          never sends a saved connection password automatically. If the remote
          host displays a password prompt, anything typed is still plaintext.
        </p>
      </div>

      <div
        data-editor-search-field="rlogin-plaintext-acknowledgement"
        className="rounded-md border border-[var(--color-border)] p-3"
      >
        <label
          htmlFor="rlogin-plaintext-acknowledgement"
          className="flex cursor-pointer items-start gap-2"
        >
          <Checkbox
            id="rlogin-plaintext-acknowledgement"
            checked={acknowledged}
            onChange={(checked) => {
              const next = checked
                ? acknowledgeRloginPlaintext(settings, now())
                : resetRloginPlaintextAcknowledgement(settings);
              onChange({
                plaintextAcknowledgement: next.plaintextAcknowledgement,
              });
            }}
            disabled={disabled}
            variant="form"
            className="mt-0.5"
            aria-invalid={acknowledgementError ? true : undefined}
            aria-describedby={
              acknowledgementError
                ? "rlogin-plaintext-acknowledgement-error"
                : "rlogin-plaintext-acknowledgement-description"
            }
          />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text)]">
              I understand and accept the plaintext risk for this connection
            </span>
            <span
              id="rlogin-plaintext-acknowledgement-description"
              className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]"
            >
              Imported, synchronized, and cloned connections must reset this
              acknowledgement before their first connection.
            </span>
          </span>
        </label>
        {acknowledgementError ? (
          <p
            id="rlogin-plaintext-acknowledgement-error"
            role="alert"
            className="mt-2 text-xs text-danger"
          >
            {acknowledgementError}
          </p>
        ) : null}

        {acknowledged ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <p className="text-[11px] text-[var(--color-textMuted)]">
              Acknowledged {settings.plaintextAcknowledgement.acknowledgedAt}
            </p>
            <button
              type="button"
              onClick={() => {
                const next = resetRloginPlaintextAcknowledgement(settings);
                onChange({
                  plaintextAcknowledgement: next.plaintextAcknowledgement,
                });
              }}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <RotateCcw size={12} aria-hidden /> Reset acknowledgement
            </button>
          </div>
        ) : null}
      </div>
    </RloginEditorSectionFrame>
  );
}
