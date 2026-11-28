import React, { useId, useState } from "react";
import { Checkbox } from "../../ui/forms";
import { AlertTriangle } from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import {
  httpTypingOrigin,
  MAX_HTTP_TYPING_ORIGINS,
  normalizeHttpTypingOrigins,
  withHttpTypingOrigin,
} from "../../../utils/connection/httpTypingOrigins";

export default function HttpTypingOriginsSection({
  formData,
  setFormData,
  initialOrigin,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  initialOrigin?: string;
}) {
  const id = useId();
  const [address, setAddress] = useState(() =>
    initialOrigin && httpTypingOrigin(initialOrigin) === initialOrigin
      ? initialOrigin
      : "",
  );
  const [error, setError] = useState("");
  const origins = normalizeHttpTypingOrigins(formData.httpTypingOrigins);
  const add = () => {
    const origin = httpTypingOrigin(address.trim());
    if (!origin || origin !== address.trim()) {
      setError(
        "Enter an exact HTTP origin, including its port, without a path, credentials or wildcard. Example: http://device.example:8080",
      );
      return;
    }
    if (!withHttpTypingOrigin(formData.httpTypingOrigins, origin)) {
      setError("The allowed-origin list is full.");
      return;
    }
    setFormData((previous) =>
      previous.id !== formData.id
        ? previous
        : {
            ...previous,
            httpTypingOrigins:
              withHttpTypingOrigin(previous.httpTypingOrigins, origin) ??
              previous.httpTypingOrigins,
          },
    );
    setAddress("");
    setError("");
  };
  return (
    <section
      className="space-y-4"
      data-editor-search-field="http-typing-origins"
    >
      <p className="text-sm text-[var(--color-textSecondary)]">
        Choose Type in the browser's Credentials & 2FA menu, then focus an empty
        field. HTTPS pages and the saved HTTP source origin need no extra entry.
        Additional plain-HTTP origins must be allowed explicitly here unless you
        enable typing on any page below.
      </p>
      <div className="rounded border border-[var(--color-border)] p-3 text-sm">
        Typing cannot overwrite a filled field or target an unsupported embedded
        frame. Clear the field and choose Type again if the page replaced it or
        changed focus. A permission entry cannot make an unsupported field
        typeable.
      </div>
      <div className="space-y-2 rounded border border-[var(--color-border)] p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={formData.httpTypingAnyOrigin === true}
            onChange={(enabled) =>
              setFormData((previous) =>
                previous.id !== formData.id
                  ? previous
                  : { ...previous, httpTypingAnyOrigin: enabled },
              )
            }
          />
          Allow typing on any page
        </label>
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          This lets you type credentials into any HTTP or HTTPS page opened in
          this connection, including redirected sites and different ports. An
          untrusted page can steal what you type; HTTP also exposes it on the
          network. Use only when you trust the page. This does not enable
          automatic login or bypass empty-field and frame checks. Save and
          reconnect to apply.
        </p>
      </div>
      <h4 className="font-medium">Additional allowed HTTP origins</h4>
      <p className="text-xs text-[var(--color-textSecondary)]">
        HTTP sends credentials without transport encryption. Only add an origin
        you intend to use. The hostname and port must match exactly.
      </p>
      <ul className="space-y-2">
        {origins.map((origin) => (
          <li key={origin} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono text-sm">
              {origin}
            </span>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              aria-label={`Remove typing permission for ${origin}`}
              onClick={() =>
                setFormData((previous) =>
                  previous.id !== formData.id
                    ? previous
                    : {
                        ...previous,
                        httpTypingOrigins: normalizeHttpTypingOrigins(
                          previous.httpTypingOrigins,
                        ).filter((item) => item !== origin),
                      },
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor={id} className="block text-sm">
        HTTP origin to allow
      </label>
      <input
        id={id}
        type="text"
        className="sor-form-input w-full"
        autoComplete="off"
        value={address}
        placeholder="http://device.example:8080"
        onChange={(event) => setAddress(event.target.value)}
      />
      <button
        type="button"
        className="sor-btn sor-btn-primary"
        disabled={!address.trim() || origins.length >= MAX_HTTP_TYPING_ORIGINS}
        onClick={add}
      >
        Allow typing for this origin
      </button>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </section>
  );
}
