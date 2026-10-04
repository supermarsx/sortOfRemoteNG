import React, { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
  type HttpExternalResourceOrigin,
  type HttpProxyPolicy,
} from "../../types/connection/httpProxyPolicy";
import { normalizeExternalResourceOrigins } from "../../utils/connection/httpProxyPolicy";
import { CheckboxField, TextInput } from "../ui/forms";

/** Shared draft editor; validation and defaults belong to the policy contract. */
export default function ExternalResourceOriginsEditor({
  origins,
  onChange,
  sameOriginOnly,
  pageScripts,
  variant = "form",
}: {
  origins: readonly HttpExternalResourceOrigin[];
  onChange: (origins: HttpExternalResourceOrigin[]) => boolean;
  sameOriginOnly: boolean;
  pageScripts: HttpProxyPolicy["pageScripts"];
  variant?: "settings" | "form";
}) {
  const id = useId();
  const [origin, setOrigin] = useState("");
  const [scripts, setScripts] = useState(false);
  const [stylesheets, setStylesheets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (next: readonly HttpExternalResourceOrigin[]) => {
    if (sameOriginOnly) return false;
    try {
      const normalized = normalizeExternalResourceOrigins(next);
      if (!onChange(normalized)) return false;
      setError(null);
      return true;
    } catch {
      setError(
        "Use up to 16 unique exact HTTPS origins, with at least one resource type. Paths, queries, fragments, credentials, wildcards and duplicate origins are not allowed.",
      );
      return false;
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <h4 id={`${id}-title`} className="text-sm font-medium">
        External scripts and stylesheets
      </h4>
      <p
        id={`${id}-help`}
        className="text-xs text-[var(--color-textSecondary)]"
      >
        Allow up to 16 exact HTTPS origins. Requests go through the proxy
        without cookies or saved login credentials. Allowed scripts can run in
        the page; only add origins you trust. Choose scripts, stylesheets, or
        both.
      </p>
      <p className="text-xs text-[var(--color-textSecondary)]">
        These grants load resources only. Payment frames, API requests and
        sign-in permissions remain separate; adding a processor does not enable
        an entire checkout flow.
      </p>
      {sameOriginOnly && (
        <p role="status" className="text-xs text-warning">
          The same-origin restriction overrides external scripts and
          stylesheets. Saved origins are preserved but inactive.
        </p>
      )}
      {pageScripts !== "allow" && (
        <p className="text-xs text-warning">
          External script grants are inactive while website scripts are blocked
          or limited to inline scripts. Stylesheet grants still apply unless
          restricted to the same origin.
        </p>
      )}
      {origins.length ? (
        <ul aria-label="Saved external resource origins" className="space-y-2">
          {origins.map((row) => (
            <li
              key={row.origin}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="break-all font-mono text-xs text-[var(--color-text)]">
                  {row.origin}
                </span>
                <p className="text-xs text-[var(--color-textMuted)]">
                  {row.kinds
                    .map((kind) =>
                      kind === "script" ? "Scripts" : "Stylesheets",
                    )
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="sor-btn sor-icon-btn-sm shrink-0"
                disabled={sameOriginOnly}
                aria-label={`Remove resource origin ${row.origin}`}
                onClick={() =>
                  update(origins.filter((item) => item.origin !== row.origin))
                }
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-textMuted)]">
          No script or stylesheet origins are configured in this list.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_16rem] space-y-1.5">
          <label htmlFor={`${id}-origin`} className="block text-sm">
            External resource origin
          </label>
          <TextInput
            id={`${id}-origin`}
            variant={variant}
            className="min-h-9 w-full min-w-0 disabled:opacity-50"
            style={{ maxWidth: "none" }}
            placeholder="https://cdn.example.com"
            autoComplete="off"
            spellCheck={false}
            value={origin}
            disabled={sameOriginOnly}
            aria-invalid={!!error}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            onChange={(value) => {
              setOrigin(value);
              setError(null);
            }}
          />
        </div>
        <fieldset disabled={sameOriginOnly} className="space-y-1.5">
          <legend className="text-xs text-[var(--color-textSecondary)]">
            Resource types
          </legend>
          <div className="flex flex-wrap gap-3">
            <CheckboxField
              variant={variant}
              label="Scripts"
              checked={scripts}
              onChange={setScripts}
            />
            <CheckboxField
              variant={variant}
              label="Stylesheets"
              checked={stylesheets}
              onChange={setStylesheets}
            />
          </div>
        </fieldset>
        <button
          type="button"
          className="sor-btn sor-btn-secondary min-h-9"
          disabled={
            sameOriginOnly ||
            !origin.trim() ||
            (!scripts && !stylesheets) ||
            origins.length >= 16
          }
          onClick={() => {
            const kinds: HttpExternalResourceOrigin["kinds"] = [];
            if (scripts) kinds.push("script");
            if (stylesheets) kinds.push("stylesheet");
            if (update([...origins, { origin, kinds }])) setOrigin("");
          }}
        >
          Add resource origin
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      {origins.length >= 16 && (
        <p className="text-xs text-[var(--color-textMuted)]">
          The 16-origin limit is reached. Remove an origin before adding
          another.
        </p>
      )}
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={sameOriginOnly}
        onClick={() => update(DEFAULT_EXTERNAL_RESOURCE_ORIGINS)}
      >
        Restore common resource defaults
      </button>
    </section>
  );
}
