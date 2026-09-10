import React, { useId } from "react";
import { Checkbox, PasswordInput } from "../../ui/forms";
import {
  DEFAULT_HTTP_FORM_AUTOMATION,
  normalizeHttpFormAutomation,
} from "../../../utils/connection/httpFormAutomation";
import type { HttpFormAutomation } from "../../../types/connection/httpFormAutomation";
import type { Mgr } from "./types";

export default function FormAutomationSection({ mgr }: { mgr: Mgr }) {
  const id = useId();
  let value: HttpFormAutomation;
  let draftInvalid = false;
  try {
    value = normalizeHttpFormAutomation(mgr.formData.httpFormAutomation) ?? {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
    };
  } catch {
    const draft = mgr.formData.httpFormAutomation;
    // Keep partially typed selectors editable while runtime validation remains strict.
    if (
      draft?.version === 1 &&
      typeof draft.submit === "boolean" &&
      [draft.fillDelayMs, draft.submitDelayMs, draft.detectionTimeoutMs].every(
        (item) => typeof item === "number" && Number.isFinite(item),
      ) &&
      (draft.formSelector === undefined ||
        typeof draft.formSelector === "string") &&
      Array.isArray(draft.fields) &&
      draft.fields.length <= 16 &&
      draft.fields.every(
        (field) =>
          field &&
          typeof field.selector === "string" &&
          typeof field.value === "string",
      )
    ) {
      value = draft;
      draftInvalid = true;
    } else
      return (
        <section className="space-y-2">
          <p role="alert" className="text-sm text-error">
            Advanced form settings are invalid. Connecting is blocked until they
            are reviewed or explicitly cleared.
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={() =>
              mgr.setFormData((old) => ({
                ...old,
                httpFormAutomation: undefined,
                httpAutoLogin: false,
                httpApplication: old.httpApplication
                  ? { ...old.httpApplication, loginMode: "manual" }
                  : undefined,
              }))
            }
          >
            Clear advanced form settings and disable automatic login
          </button>
        </section>
      );
  }
  const update = (patch: Partial<HttpFormAutomation>) =>
    mgr.setFormData((old) => ({
      ...old,
      httpFormAutomation: { ...value, ...patch },
    }));
  const changeField = (
    index: number,
    patch: Partial<HttpFormAutomation["fields"][number]>,
  ) =>
    update({
      fields: value.fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  return (
    <section
      aria-label="Advanced form automation"
      className="space-y-3 rounded border border-[var(--color-border)] p-3"
    >
      <h4 className="text-sm font-medium">Advanced form automation</h4>
      {draftInvalid && (
        <p role="alert" className="text-sm text-error">
          These draft settings are not valid yet. Complete the selectors and
          timing before connecting; no automatic fill is allowed with invalid
          settings.
        </p>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Applies only when automatic form login is separately enabled in
        Application or Advanced. These options never enable it. Delays are
        bounded; one fill/submission attempt is allowed per proxy session.
        Credential origin checks cannot be disabled.
      </p>
      <label htmlFor={`${id}-form`} className="block text-sm">
        Exact form selector (optional)
      </label>
      <input
        id={`${id}-form`}
        className="sor-form-input"
        value={value.formSelector ?? ""}
        maxLength={512}
        placeholder="form#login"
        onChange={(event) =>
          update({ formSelector: event.target.value || undefined })
        }
      />
      <p className="text-xs text-[var(--color-textMuted)]">
        When supplied, exactly one form must match. All selected controls must
        belong to that form. An unmatched or replaced control stops the attempt.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ["fillDelayMs", "Delay before filling (ms)", 0, 30000],
            ["submitDelayMs", "Delay after filling (ms)", 0, 30000],
            ["detectionTimeoutMs", "Overall deadline (ms)", 1000, 60000],
          ] as const
        ).map(([key, label, min, max]) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm">
              {label}
            </label>
            <input
              id={`${id}-${key}`}
              className="sor-form-input"
              type="number"
              min={min}
              max={max}
              step={1}
              value={value[key]}
              onChange={(event) => {
                const number = Number(event.target.value);
                if (Number.isInteger(number) && number >= min && number <= max)
                  update({
                    [key]: number,
                    ...(key !== "detectionTimeoutMs"
                      ? {
                          detectionTimeoutMs: Math.max(
                            value.detectionTimeoutMs,
                            number +
                              value[
                                key === "fillDelayMs"
                                  ? "submitDelayMs"
                                  : "fillDelayMs"
                              ],
                          ),
                        }
                      : {}),
                  });
              }}
            />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value.submit}
          onChange={(checked) => update({ submit: checked })}
        />
        Submit after filling
      </label>
      <p className="text-xs text-[var(--color-textMuted)]">
        Turn submission off to fill only and review the website yourself. The
        overall deadline must cover both delays; a delayed or replaced form is
        never retried after filling.
      </p>
      <h5 className="text-sm font-medium">Additional explicit fields</h5>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Optional text, hidden or select controls in the same form, such as
        tenant or domain. Values may contain secrets and follow database
        protection. Password, username, OTP, file, CSRF and token controls are
        not allowed. Standard CSRF tokens must remain site-managed; no hidden
        field is guessed or created.
      </p>
      {value.fields.map((field, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <div>
            <label
              htmlFor={`${id}-selector-${index}`}
              className="mb-1 block text-xs"
            >
              Field {index + 1} selector
            </label>
            <input
              id={`${id}-selector-${index}`}
              className="sor-form-input"
              value={field.selector}
              maxLength={512}
              onChange={(event) =>
                changeField(index, { selector: event.target.value })
              }
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-value-${index}`}
              className="mb-1 block text-xs"
            >
              Field {index + 1} value
            </label>
            <PasswordInput
              id={`${id}-value-${index}`}
              className="sor-form-input"
              value={field.value}
              maxLength={4096}
              autoComplete="off"
              onChange={(event) =>
                changeField(index, { value: event.target.value })
              }
            />
          </div>
          <button
            type="button"
            className="sor-btn sor-btn-secondary self-end"
            aria-label={`Remove additional field ${index + 1}`}
            onClick={() =>
              update({ fields: value.fields.filter((_, i) => i !== index) })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={value.fields.length >= 16}
        onClick={() =>
          update({
            fields: [...value.fields, { selector: "", value: "" }],
            submit: false,
          })
        }
      >
        Add explicit field
      </button>
      <p className="text-xs text-[var(--color-textMuted)]">
        Adding a field switches to fill-only. Choose submission again only after
        reviewing the controls. At most 16 fields, 4096 characters per value and
        16 KiB total.
      </p>
    </section>
  );
}
