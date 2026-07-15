import { Cable, Info } from "lucide-react";
import { NumberInput, Select, TextInput } from "../../ui/forms";
import { RLOGIN_SOURCE_PORT_OPTIONS } from "../../../utils/rlogin/rloginSettings";
import { RloginEditorSectionFrame, RloginFieldError } from "./Section";
import { fieldError, type RloginConnectionSectionProps } from "./types";

const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";

export function RloginConnectionSection({
  settings,
  port,
  onPortChange,
  onChange,
  validation,
  networkPath,
  disabled,
}: RloginConnectionSectionProps) {
  const portError = fieldError(validation, "port");
  const sourcePortError = fieldError(validation, "sourcePortMode");
  const reservedInactive = settings.sourcePortMode === "ephemeral";

  return (
    <RloginEditorSectionFrame
      id="rlogin-connection-section"
      title="Connection"
      description="Configure the RFC 1282 identity handshake and TCP endpoint. RLogin uses port 513 by default."
      icon={<Cable size={16} />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label htmlFor="rlogin-local-username">
          <span className={labelClass}>Local username</span>
          <TextInput
            id="rlogin-local-username"
            label="Local username"
            value={settings.localUsername}
            onChange={(localUsername) => onChange({ localUsername })}
            error={fieldError(validation, "localUsername")}
            autoComplete="username"
            disabled={disabled}
            variant="form-sm"
            className="w-full"
          />
        </label>
        <label htmlFor="rlogin-remote-username">
          <span className={labelClass}>Remote username</span>
          <TextInput
            id="rlogin-remote-username"
            label="Remote username"
            value={settings.remoteUsername}
            onChange={(remoteUsername) => onChange({ remoteUsername })}
            error={fieldError(validation, "remoteUsername")}
            autoComplete="username"
            disabled={disabled}
            variant="form-sm"
            className="w-full"
          />
        </label>
        <div>
          <label htmlFor="rlogin-port" className={labelClass}>
            Target port
          </label>
          <NumberInput
            id="rlogin-port"
            label="Target port"
            value={port}
            onChange={onPortChange}
            min={1}
            max={65_535}
            clamp={false}
            disabled={disabled}
            variant="form-sm"
            className="w-full"
            aria-invalid={portError ? true : undefined}
            aria-describedby={portError ? "rlogin-port-error" : undefined}
          />
          <RloginFieldError id="rlogin-port-error" error={portError} />
          {!portError ? (
            <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
              Standard RLogin service port: 513.
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="rlogin-source-port-mode" className={labelClass}>
            Client source port
          </label>
          <Select
            id="rlogin-source-port-mode"
            label="Client source port"
            value={settings.sourcePortMode}
            onChange={(value) =>
              onChange({
                sourcePortMode: value as typeof settings.sourcePortMode,
              })
            }
            options={RLOGIN_SOURCE_PORT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              title: option.description,
            }))}
            disabled={disabled}
            variant="form-sm"
            className="w-full"
          />
          <RloginFieldError
            id="rlogin-source-port-mode-error"
            error={sourcePortError}
          />
        </div>
        <div>
          <label htmlFor="rlogin-reserved-port-start" className={labelClass}>
            Reserved range start
          </label>
          <NumberInput
            id="rlogin-reserved-port-start"
            label="Reserved range start"
            value={settings.reservedPortStart}
            onChange={(reservedPortStart) => onChange({ reservedPortStart })}
            min={512}
            max={1023}
            clamp={false}
            disabled={disabled || reservedInactive}
            variant="form-sm"
            className="w-full"
            aria-invalid={
              fieldError(validation, "reservedPortStart") ? true : undefined
            }
          />
          <RloginFieldError
            id="rlogin-reserved-port-start-error"
            error={fieldError(validation, "reservedPortStart")}
          />
        </div>
        <div>
          <label htmlFor="rlogin-reserved-port-end" className={labelClass}>
            Reserved range end
          </label>
          <NumberInput
            id="rlogin-reserved-port-end"
            label="Reserved range end"
            value={settings.reservedPortEnd}
            onChange={(reservedPortEnd) => onChange({ reservedPortEnd })}
            min={512}
            max={1023}
            clamp={false}
            disabled={disabled || reservedInactive}
            variant="form-sm"
            className="w-full"
            aria-invalid={
              fieldError(validation, "reservedPortEnd") ? true : undefined
            }
          />
          <RloginFieldError
            id="rlogin-reserved-port-end-error"
            error={fieldError(validation, "reservedPortEnd")}
          />
        </div>
      </div>

      <div
        className="flex items-start gap-2 rounded-md border border-info/25 bg-info/5 px-3 py-2 text-xs leading-5 text-[var(--color-textSecondary)]"
        aria-live="polite"
      >
        <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden />
        <p>
          Reserved ports 512–1023 may require elevated privileges. A proxy, VPN,
          or SSH jump cannot guarantee the source port seen by the target
          {networkPath?.configured
            ? ", and this connection has a Network Path configured."
            : "."}
        </p>
      </div>
    </RloginEditorSectionFrame>
  );
}
