import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { PopoverSurface } from "../../../ui/overlays/PopoverSurface";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordOptions,
  type PasswordGeneratorOptions,
} from "../../../../utils/security/passwordGenerator";
import { passwordQuality } from "../../../../utils/security/vaultManager/passwordQuality";
import {
  CLIPBOARD_CLEAR_SECS,
  copySecretToClipboard,
} from "../../../../utils/security/credentialClipboard";
import type { VaultTextKey, VaultTx } from "./vaultText";

const GROUPS: [keyof PasswordGeneratorOptions, VaultTextKey][] = [
  ["lowercase", "generatorLowercase"],
  ["uppercase", "generatorUppercase"],
  ["digits", "generatorDigits"],
  ["symbols", "generatorSymbols"],
  ["excludeAmbiguous", "generatorAmbiguous"],
];
const QUALITY_KEYS = {
  veryWeak: "qualityVeryWeak",
  weak: "qualityWeak",
  fair: "qualityFair",
  good: "qualityGood",
  strong: "qualityStrong",
} as const;

/** A free-standing generator. The value lives only in this popover and is
 * dropped when it closes; copying uses the auto-clearing secure clipboard. */
export function VaultPasswordGenerator({
  isOpen,
  anchorRef,
  onClose,
  onCopied,
  tx,
}: {
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onCopied: (seconds: number) => void;
  tx: VaultTx;
}) {
  const [options, setOptions] = useState<PasswordGeneratorOptions>({
    ...DEFAULT_PASSWORD_OPTIONS,
  });
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const error = validatePasswordOptions(options);
  const regenerate = useCallback((next: PasswordGeneratorOptions) => {
    setStatus(null);
    try {
      setValue(validatePasswordOptions(next) ? "" : generatePassword(next));
    } catch {
      setValue("");
    }
  }, []);
  useEffect(() => {
    if (isOpen) regenerate(options);
    else setValue("");
    // Generate on open only; option edits regenerate explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const update = (patch: Partial<PasswordGeneratorOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    regenerate(next);
  };
  const quality = passwordQuality(value);
  return (
    <PopoverSurface
      isOpen={isOpen}
      anchorRef={anchorRef}
      onClose={onClose}
      className="w-72 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs shadow-xl"
    >
      <section
        role="dialog"
        aria-label={tx("generatorTitle")}
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">{tx("generatorTitle")}</h3>
        <div className="flex items-center gap-1">
          <output
            aria-label={tx("generatorOutput")}
            className="min-w-0 flex-1 break-all rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 font-mono text-[11px]"
          >
            {value}
          </output>
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label={tx("generatorRegenerate")}
            data-tooltip={tx("generatorRegenerate")}
            disabled={!!error}
            onClick={() => regenerate(options)}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label={tx("generatorCopy")}
            data-tooltip={tx("generatorCopy")}
            disabled={!value}
            onClick={async () => {
              const outcome = await copySecretToClipboard(value, "password");
              if (outcome.ok) onCopied(CLIPBOARD_CLEAR_SECS.password);
              setStatus({
                ok: outcome.ok,
                text: tx(outcome.ok ? "generatorCopied" : "generatorFailed"),
              });
            }}
          >
            <Copy size={14} aria-hidden="true" />
          </button>
        </div>
        <div
          role="meter"
          aria-label={tx("generatorQuality")}
          aria-valuemin={0}
          aria-valuemax={128}
          aria-valuenow={Math.min(128, quality.bits)}
          aria-valuetext={`${tx(QUALITY_KEYS[quality.level])}, ${tx("generatorBits", { bits: quality.bits })}`}
        >
          <div className="h-1.5 overflow-hidden rounded bg-[var(--color-border)]">
            <div
              className={`h-full ${quality.ratio < 0.35 ? "bg-error" : quality.ratio < 0.55 ? "bg-warning" : "bg-success"}`}
              style={{ width: `${Math.round(quality.ratio * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {tx(QUALITY_KEYS[quality.level])} ·{" "}
            {tx("generatorBits", { bits: quality.bits })}
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-14">{tx("generatorLength")}</span>
          <input
            type="range"
            min={MIN_PASSWORD_LENGTH}
            max={MAX_PASSWORD_LENGTH}
            value={options.length}
            aria-label={tx("generatorLength")}
            className="min-w-0 flex-1"
            onChange={(event) => update({ length: Number(event.target.value) })}
          />
          <span className="w-8 text-right tabular-nums">{options.length}</span>
        </label>
        {GROUPS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options[key] as boolean}
              onChange={(event) => update({ [key]: event.target.checked })}
            />
            {tx(label)}
          </label>
        ))}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className={status.ok ? "" : "text-error"}>
            {status.text}
          </p>
        )}
      </section>
    </PopoverSurface>
  );
}
