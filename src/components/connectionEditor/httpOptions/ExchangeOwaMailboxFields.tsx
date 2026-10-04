import React, { useId } from "react";
import {
  EXCHANGE_OWA_MAILBOX_ERROR,
  normalizeExchangeOwaMailbox,
} from "../../../utils/connection/exchangeOwaProfile";
import type { Mgr } from "./types";

export default function ExchangeOwaMailboxFields({ mgr }: { mgr: Mgr }) {
  const id = useId();
  const mailbox = mgr.formData.httpApplication?.exchangeOwaMailbox;
  const normalized = normalizeExchangeOwaMailbox(mailbox);
  const invalid = normalized === undefined;
  const updateMailbox = (value: string) =>
    mgr.setFormData((previous) => {
      if (previous.httpApplication?.id !== "exchange-owa") return previous;
      return {
        ...previous,
        httpApplication: {
          ...previous.httpApplication,
          exchangeOwaMailbox: value || undefined,
        },
      };
    });

  return (
    <div className="max-w-xl space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Secondary mailbox (optional)
      </label>
      <input
        id={id}
        className="sor-form-input"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        maxLength={254}
        placeholder="mailbox@example.com"
        value={typeof mailbox === "string" ? mailbox : ""}
        aria-invalid={invalid}
        aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`}
        onChange={(event) => updateMailbox(event.target.value)}
        onBlur={() => {
          if (normalized !== undefined && normalized !== mailbox)
            updateMailbox(normalized);
        }}
      />
      <p id={`${id}-help`} className="text-xs text-[var(--color-textMuted)]">
        Leave blank to use the saved address (your own mailbox by default).
        Enter the secondary mailbox's SMTP email address to open it in manual or
        automatic form mode. Login still uses your primary account's saved or
        vault credentials. That account needs delegated access to the mailbox;
        an admin role alone does not grant it.
      </p>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-sm text-error">
          {EXCHANGE_OWA_MAILBOX_ERROR}
        </p>
      )}
    </div>
  );
}
