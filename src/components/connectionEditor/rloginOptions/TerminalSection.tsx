import { Keyboard, Radio } from "lucide-react";
import { Checkbox, NumberInput, Select, TextInput } from "../../ui/forms";
import { RLOGIN_ENCODING_OPTIONS } from "../../../utils/rlogin/rloginSettings";
import { RloginEditorSectionFrame, RloginFieldError } from "./Section";
import { fieldError, type RloginSettingsSectionProps } from "./types";

const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";

export function RloginTerminalSection({
  settings,
  onChange,
  validation,
  disabled,
}: RloginSettingsSectionProps) {
  const speedError = fieldError(validation, "terminalSpeed");
  const rowsError = fieldError(validation, "initialRows");
  const columnsError = fieldError(validation, "initialColumns");
  const escapeError = fieldError(validation, "escapeCharacter");

  return (
    <RloginEditorSectionFrame
      id="rlogin-terminal-section"
      title="Terminal"
      description="Choose the terminal descriptor, byte encoding, flow control, dimensions, and local escape behavior."
      icon={<Keyboard size={16} />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label htmlFor="rlogin-terminal-type">
          <span className={labelClass}>Terminal type</span>
          <TextInput
            id="rlogin-terminal-type"
            label="Terminal type"
            value={settings.terminalType}
            onChange={(terminalType) => onChange({ terminalType })}
            error={fieldError(validation, "terminalType")}
            disabled={disabled}
            variant="form-sm"
            className="w-full"
            spellCheck={false}
          />
        </label>
        <div>
          <label htmlFor="rlogin-terminal-speed" className={labelClass}>
            Terminal speed (baud)
          </label>
          <NumberInput
            id="rlogin-terminal-speed"
            label="Terminal speed"
            value={settings.terminalSpeed}
            onChange={(terminalSpeed) => onChange({ terminalSpeed })}
            min={1}
            max={4_000_000}
            clamp={false}
            disabled={disabled}
            variant="form-sm"
            className="w-full"
            aria-invalid={speedError ? true : undefined}
            aria-describedby={
              speedError ? "rlogin-terminal-speed-error" : undefined
            }
          />
          <RloginFieldError
            id="rlogin-terminal-speed-error"
            error={speedError}
          />
        </div>
        <div>
          <label htmlFor="rlogin-encoding" className={labelClass}>
            Character encoding
          </label>
          <Select
            id="rlogin-encoding"
            label="Character encoding"
            value={settings.encoding}
            onChange={(value) =>
              onChange({ encoding: value as typeof settings.encoding })
            }
            options={RLOGIN_ENCODING_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              title: option.description,
            }))}
            searchable
            searchPlaceholder="Search encodings…"
            disabled={disabled}
            variant="form-sm"
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="rlogin-initial-columns" className={labelClass}>
              Columns
            </label>
            <NumberInput
              id="rlogin-initial-columns"
              label="Initial columns"
              value={settings.initialColumns}
              onChange={(initialColumns) => onChange({ initialColumns })}
              min={1}
              max={65_535}
              clamp={false}
              disabled={disabled}
              variant="form-sm"
              className="w-full"
              aria-invalid={columnsError ? true : undefined}
              aria-describedby={
                columnsError ? "rlogin-initial-columns-error" : undefined
              }
            />
            <RloginFieldError
              id="rlogin-initial-columns-error"
              error={columnsError}
            />
          </div>
          <div>
            <label htmlFor="rlogin-initial-rows" className={labelClass}>
              Rows
            </label>
            <NumberInput
              id="rlogin-initial-rows"
              label="Initial rows"
              value={settings.initialRows}
              onChange={(initialRows) => onChange({ initialRows })}
              min={1}
              max={65_535}
              clamp={false}
              disabled={disabled}
              variant="form-sm"
              className="w-full"
              aria-invalid={rowsError ? true : undefined}
              aria-describedby={
                rowsError ? "rlogin-initial-rows-error" : undefined
              }
            />
            <RloginFieldError
              id="rlogin-initial-rows-error"
              error={rowsError}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-3">
        <label
          className="flex items-start gap-2"
          htmlFor="rlogin-local-flow-control"
        >
          <Checkbox
            id="rlogin-local-flow-control"
            checked={settings.localFlowControl}
            onChange={(localFlowControl) => onChange({ localFlowControl })}
            disabled={disabled}
            variant="form"
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text)]">
              Local XON/XOFF flow control in cooked mode
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
              Ctrl-S pauses display and Ctrl-Q resumes it only while the server
              reports cooked mode. Raw mode always forwards those bytes.
            </span>
          </span>
        </label>

        <label
          className="flex items-start gap-2"
          htmlFor="rlogin-escape-enabled"
        >
          <Checkbox
            id="rlogin-escape-enabled"
            checked={settings.escapeEnabled}
            onChange={(escapeEnabled) => onChange({ escapeEnabled })}
            disabled={disabled}
            variant="form"
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text)]">
              Enable line-start escape commands
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
              The standard sequence ~. disconnects locally at the beginning of a
              line. The escape byte is never sent for that command.
            </span>
          </span>
        </label>

        <div className="max-w-xs">
          <label htmlFor="rlogin-escape-character" className={labelClass}>
            Escape character
          </label>
          <TextInput
            id="rlogin-escape-character"
            label="Escape character"
            value={settings.escapeCharacter}
            onChange={(escapeCharacter) => onChange({ escapeCharacter })}
            error={escapeError}
            helperText={
              escapeError
                ? undefined
                : "Use one ASCII character, caret notation such as ^], or \\xNN."
            }
            disabled={disabled || !settings.escapeEnabled}
            variant="form-sm"
            className="w-full font-mono"
            maxLength={4}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="flex items-start gap-2 text-[11px] leading-4 text-[var(--color-textMuted)]">
        <Radio size={13} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          RLogin uses remote echo. The client does not fake local echo or scan
          ordinary terminal bytes for protocol controls.
        </p>
      </div>
    </RloginEditorSectionFrame>
  );
}
