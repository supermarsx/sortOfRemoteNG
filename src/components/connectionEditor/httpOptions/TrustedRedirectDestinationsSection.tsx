import React, { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  MAX_TRUSTED_REDIRECT_DESTINATIONS,
  normalizeHttpRedirectOrigin,
  normalizeHttpTrustedRedirectDestinations,
} from "../../../utils/protocol/httpTrustedRedirectDestinations";
import type { Mgr } from "./types";

export default function TrustedRedirectDestinationsSection({
  mgr,
}: {
  mgr: Mgr;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  let destinations;
  try {
    destinations = normalizeHttpTrustedRedirectDestinations(
      mgr.formData.httpTrustedRedirectDestinations,
    );
  } catch {
    return (
      <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
        <h4 className="text-sm font-medium">Trusted redirect destinations</h4>
        <p role="alert" className="text-sm text-error">
          The saved destination list is invalid. No destination is trusted until
          this list is corrected.
        </p>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          onClick={() =>
            mgr.setFormData((previous) => ({
              ...previous,
              httpTrustedRedirectDestinations: {
                version: 1,
                origins: [],
              },
            }))
          }
        >
          Clear invalid destination list
        </button>
      </section>
    );
  }
  const add = () => {
    try {
      const origin = normalizeHttpRedirectOrigin(draft.trim());
      if (destinations.origins.includes(origin)) {
        setError("That exact origin is already listed.");
        return;
      }
      const next = normalizeHttpTrustedRedirectDestinations({
        ...destinations,
        origins: [...destinations.origins, origin],
      });
      mgr.setFormData((previous) => ({
        ...previous,
        httpTrustedRedirectDestinations: next,
      }));
      setDraft("");
      setError("");
    } catch {
      setError(
        "Enter an HTTP(S) origin only, such as https://nas.example:5001. Credentials, paths, query parameters, fragments and wildcards are not allowed.",
      );
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <div>
        <h4 className="text-sm font-medium">Trusted redirect destinations</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-textSecondary)]">
          Exact addresses for this saved connection only. Scheme and port must
          match; subdomains are not included. Saved destinations skip repeat
          destination review with an anonymous handoff in this tab, when the
          redirect policy permits. Certificate checks, HTTPS-only and downgrade
          restrictions still apply. Forwarding saved login credentials requires
          separate approval. Save the connection to retain changes.
        </p>
      </div>
      {destinations.origins.length ? (
        <ul
          className="max-h-48 space-y-1 overflow-y-auto"
          aria-label="Trusted redirect destination list"
        >
          {destinations.origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-all font-mono text-xs">
                {origin}
              </span>
              <button
                type="button"
                className="sor-icon-btn shrink-0"
                aria-label={`Remove ${origin}`}
                onClick={() => {
                  mgr.setFormData((previous) => {
                    const current = normalizeHttpTrustedRedirectDestinations(
                      previous.httpTrustedRedirectDestinations,
                    );
                    return {
                      ...previous,
                      httpTrustedRedirectDestinations: {
                        ...current,
                        origins: current.origins.filter(
                          (item) => item !== origin,
                        ),
                      },
                    };
                  });
                  setError("");
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-textSecondary)]">
          No trusted destinations.
        </p>
      )}
      <label htmlFor={id} className="block text-sm">
        Destination origin
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          placeholder="https://nas.example:5001"
          className="sor-form-input min-w-0 flex-1"
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          disabled={
            destinations.origins.length >= MAX_TRUSTED_REDIRECT_DESTINATIONS
          }
        />
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={
            !draft.trim() ||
            destinations.origins.length >= MAX_TRUSTED_REDIRECT_DESTINATIONS
          }
          onClick={add}
        >
          <Plus size={14} /> Add destination
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)]">
        {destinations.origins.length} / {MAX_TRUSTED_REDIRECT_DESTINATIONS}{" "}
        destinations
      </p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
