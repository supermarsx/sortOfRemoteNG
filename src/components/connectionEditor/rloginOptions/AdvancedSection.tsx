import { Clock3, Gauge } from "lucide-react";
import { Checkbox, NumberInput } from "../../ui/forms";
import { RloginEditorSectionFrame, RloginFieldError } from "./Section";
import { fieldError, type RloginSettingsSectionProps } from "./types";

const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";

const timeoutFields = [
  {
    key: "connectTimeoutMs",
    id: "rlogin-connect-timeout",
    label: "Connect timeout",
    hint: "Shared transport DNS and TCP connection deadline.",
  },
  {
    key: "handshakeTimeoutMs",
    id: "rlogin-handshake-timeout",
    label: "Handshake timeout",
    hint: "Maximum wait for the server acknowledgement.",
  },
  {
    key: "writeTimeoutMs",
    id: "rlogin-write-timeout",
    label: "Write timeout",
    hint: "Maximum time for input and resize writes.",
  },
  {
    key: "idleTimeoutMs",
    id: "rlogin-idle-timeout",
    label: "Idle read timeout",
    hint: "Close an unresponsive session after this idle period.",
  },
] as const;

export function RloginAdvancedSection({
  settings,
  onChange,
  validation,
  disabled,
}: RloginSettingsSectionProps) {
  const keepAliveError = fieldError(validation, "tcpKeepAliveSeconds");

  return (
    <RloginEditorSectionFrame
      id="rlogin-advanced-section"
      title="Advanced"
      description="Tune bounded transport deadlines and operating-system TCP behavior. No application bytes are used as keepalives."
      icon={<Gauge size={16} />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {timeoutFields.map((field) => {
          const error = fieldError(validation, field.key);
          return (
            <div key={field.key}>
              <label htmlFor={field.id} className={labelClass}>
                {field.label} (ms)
              </label>
              <NumberInput
                id={field.id}
                label={`${field.label} in milliseconds`}
                value={settings[field.key]}
                onChange={(value) => onChange({ [field.key]: value })}
                min={100}
                max={86_400_000}
                clamp={false}
                disabled={disabled}
                variant="form-sm"
                className="w-full"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${field.id}-${error ? "error" : "hint"}`}
              />
              <RloginFieldError id={`${field.id}-error`} error={error} />
              {!error ? (
                <p
                  id={`${field.id}-hint`}
                  className="mt-1 text-[11px] text-[var(--color-textMuted)]"
                >
                  {field.hint}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-3">
        <label className="flex items-start gap-2" htmlFor="rlogin-tcp-no-delay">
          <Checkbox
            id="rlogin-tcp-no-delay"
            checked={settings.tcpNoDelay}
            onChange={(tcpNoDelay) => onChange({ tcpNoDelay })}
            disabled={disabled}
            variant="form"
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text)]">
              TCP no-delay
            </span>
            <span className="mt-0.5 block text-[11px] text-[var(--color-textMuted)]">
              Reduce latency for interactive keystrokes.
            </span>
          </span>
        </label>
        <label
          className="flex items-start gap-2"
          htmlFor="rlogin-tcp-keepalive"
        >
          <Checkbox
            id="rlogin-tcp-keepalive"
            checked={settings.tcpKeepAlive}
            onChange={(tcpKeepAlive) => onChange({ tcpKeepAlive })}
            disabled={disabled}
            variant="form"
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text)]">
              Operating-system TCP keepalive
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
              Detect dead peers without injecting bytes into RLogin&apos;s
              transparent terminal stream.
            </span>
          </span>
        </label>
        <div className="max-w-xs">
          <label htmlFor="rlogin-tcp-keepalive-seconds" className={labelClass}>
            Keepalive interval (seconds)
          </label>
          <NumberInput
            id="rlogin-tcp-keepalive-seconds"
            label="TCP keepalive interval in seconds"
            value={settings.tcpKeepAliveSeconds}
            onChange={(tcpKeepAliveSeconds) =>
              onChange({ tcpKeepAliveSeconds })
            }
            min={1}
            max={86_400}
            clamp={false}
            disabled={disabled || !settings.tcpKeepAlive}
            variant="form-sm"
            className="w-full"
            aria-invalid={keepAliveError ? true : undefined}
            aria-describedby={
              keepAliveError ? "rlogin-tcp-keepalive-seconds-error" : undefined
            }
          />
          <RloginFieldError
            id="rlogin-tcp-keepalive-seconds-error"
            error={keepAliveError}
          />
        </div>
      </div>

      <div className="flex items-start gap-2 text-[11px] leading-4 text-[var(--color-textMuted)]">
        <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          Disabled keepalive and escape controls retain their valid configured
          values so re-enabling them does not silently reset user choices.
        </p>
      </div>
    </RloginEditorSectionFrame>
  );
}
