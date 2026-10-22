import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { WandSparkles, RefreshCw, Copy } from "lucide-react";
import { PopoverSurface } from "../overlays/PopoverSurface";
import { CheckboxField } from "./Checkbox";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordGeneratorOptions,
  validatePasswordOptions,
} from "../../../utils/security/passwordGenerator";

interface PasswordGeneratorProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  besideReveal: boolean;
  minLength?: number;
  maxLength?: number;
}

/** Drafts live only in this mounted popover, never in application settings. */
export function PasswordGenerator({
  inputRef,
  besideReveal,
  minLength,
  maxLength,
}: PasswordGeneratorProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    anchorRef.current?.focus({ preventScroll: true });
  }, []);

  const apply = (password: string) => {
    const input = inputRef.current;
    if (!input || input.readOnly || input.matches(":disabled")) return;
    // Use the native setter so React's value tracker observes a real input
    // change. Existing controlled handlers, onInput, refs and form state run
    // exactly as they do for typing; no invented ChangeEvent or storage path.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) return;
    setter.call(input, password);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Generate password"
        data-tooltip="Generate password"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`sor-btn absolute ${besideReveal ? "right-8" : "right-1"} top-1/2 -translate-y-1/2 !p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:hidden`}
        onClick={() => {
          if (inputRef.current?.matches(":disabled")) return;
          setOpen(!open);
        }}
      >
        <WandSparkles size={16} aria-hidden="true" />
      </button>
      {open && (
        <PopoverSurface
          isOpen
          anchorRef={anchorRef}
          onClose={close}
          closeOnEscape={false}
          portalContainer={inputRef.current?.closest<HTMLElement>(
            '[role="dialog"]',
          )}
          className="sor-toolbar-popup"
          style={{
            width: "22rem",
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100dvh - 16px)",
            overflowY: "auto",
          }}
        >
          <GeneratorPanel
            id={id}
            onClose={close}
            onUse={apply}
            minLength={minLength}
            maxLength={maxLength}
          />
        </PopoverSurface>
      )}
    </>
  );
}

function GeneratorPanel({
  id,
  onClose,
  onUse,
  minLength,
  maxLength,
}: {
  id: string;
  onClose: () => void;
  onUse: (password: string) => void;
  minLength?: number;
  maxLength?: number;
}) {
  const minimum = Math.max(
    MIN_PASSWORD_LENGTH,
    minLength ?? MIN_PASSWORD_LENGTH,
  );
  const maximum = Math.min(
    MAX_PASSWORD_LENGTH,
    maxLength != null && maxLength >= 0 ? maxLength : MAX_PASSWORD_LENGTH,
  );
  const [options, setOptions] = useState<PasswordGeneratorOptions>(() => ({
    ...DEFAULT_PASSWORD_OPTIONS,
    length: Math.max(
      minimum,
      Math.min(DEFAULT_PASSWORD_OPTIONS.length, maximum),
    ),
  }));
  const makeDraft = (next: PasswordGeneratorOptions) => {
    const error = validatePasswordOptions(next);
    if (error) return { password: "", error };
    if (minimum > maximum)
      return {
        password: "",
        error: "This field's length limits do not support generated passwords.",
      };
    if (next.length < minimum || next.length > maximum)
      return {
        password: "",
        error: `This field requires a length from ${minimum} to ${maximum}.`,
      };
    try {
      return { password: generatePassword(next), error: "" };
    } catch {
      return {
        password: "",
        error:
          "Secure password generation is unavailable. Please try again in a supported environment.",
      };
    }
  };
  const [draft, setDraft] = useState(() => makeDraft(options));
  const [copyStatus, setCopyStatus] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // PopoverSurface positions and reveals itself in its first frame. Wait
    // until the following frame before focusing a now-visible control.
    let focusFrame = 0;
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() =>
        lengthRef.current?.focus({ preventScroll: true }),
      );
    });
    // Capture Escape before the surrounding editor/modal's document listener.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", escape, true);
    };
  }, [onClose]);

  const update = (next: PasswordGeneratorOptions) => {
    setOptions(next);
    setDraft(makeDraft(next));
    setCopyStatus("");
  };

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="p-4 space-y-4 text-sm text-[var(--color-text)]"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.key === "Enter" &&
          !(event.target instanceof HTMLButtonElement)
        )
          event.preventDefault();
        if (event.key !== "Tab") return;
        const items = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            "input:not(:disabled), textarea, button:not(:disabled)",
          ) ?? [],
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div>
        <h3 id={`${id}-title`} className="font-semibold">
          Generate password
        </h3>
        <p
          id={`${id}-help`}
          className="mt-1 text-xs text-[var(--color-textSecondary)]"
        >
          Generate locally, then choose Use password to fill this field. This
          does not change the password on the remote service.
        </p>
      </div>
      <label className="flex items-center justify-between gap-3">
        Length
        <input
          ref={lengthRef}
          type="number"
          min={minimum}
          max={maximum}
          step={1}
          value={Number.isNaN(options.length) ? "" : options.length}
          className="sor-form-input !w-20"
          aria-invalid={!!draft.error}
          aria-describedby={draft.error ? `${id}-error` : undefined}
          onChange={(event) =>
            update({ ...options, length: event.target.valueAsNumber })
          }
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Character types</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["lowercase", "Lowercase (a–z)"],
              ["uppercase", "Uppercase (A–Z)"],
              ["digits", "Digits (0–9)"],
              ["symbols", "Symbols (!@#)"],
            ] as const
          ).map(([key, label]) => (
            <CheckboxField
              key={key}
              label={label}
              checked={options[key]}
              onChange={(checked) => update({ ...options, [key]: checked })}
            />
          ))}
        </div>
      </fieldset>
      <CheckboxField
        label="Exclude ambiguous characters"
        description="I, l, 1, O, 0, o and |"
        checked={options.excludeAmbiguous}
        onChange={(checked) =>
          update({ ...options, excludeAmbiguous: checked })
        }
      />
      {draft.error && (
        <p role="alert" id={`${id}-error`} className="text-error">
          {draft.error}
        </p>
      )}
      <label className="block space-y-2">
        <span>Proposed password</span>
        <textarea
          readOnly
          value={draft.password}
          rows={2}
          autoComplete="off"
          spellCheck={false}
          className="sor-form-input w-full font-mono resize-none"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!!draft.error}
          onClick={() => update(options)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Regenerate
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!draft.password}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft.password);
              setCopyStatus("Password copied.");
            } catch {
              setCopyStatus(
                "Could not copy. Select the proposed password to copy it manually.",
              );
            }
          }}
        >
          <Copy size={14} aria-hidden="true" />
          Copy
        </button>
      </div>
      <p role="status" className="text-xs text-[var(--color-textSecondary)]">
        {copyStatus}
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={!draft.password || !!draft.error}
          onClick={() => onUse(draft.password)}
        >
          Use password
        </button>
      </div>
    </div>
  );
}
