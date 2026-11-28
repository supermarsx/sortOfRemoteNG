import React, { useRef } from "react";
import type { Connection } from "../../types/connection/connection";
import { useVaultTotpChoices } from "../../hooks/security/useVaultTotpChoices";
import { credentialAccountSelection } from "../../utils/security/connectionCredentialAccounts";
import TOTPOptions from "./TOTPOptions";
import { Select } from "../ui/forms";

export default function ConnectionAuthenticators({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const choices = useVaultTotpChoices(formData);
  const latest = useRef({
    id: formData.id,
    source: formData.credentialSource,
    available: choices.available,
  });
  latest.current = {
    id: formData.id,
    source: formData.credentialSource,
    available: choices.available,
  };
  const source = formData.credentialSource;
  if (source?.kind !== "vault")
    return (
      <TOTPOptions
        formData={formData}
        setFormData={setFormData}
        defaultExpanded
      />
    );
  return (
    <div className="space-y-3">
      <Select
        label="Vault authenticator for login challenges"
        value={source.totpId ?? ""}
        disabled={!choices.available || choices.loading}
        options={[
          { value: "", label: "None — enter codes manually" },
          ...choices.entries.map((entry) => ({
            value: entry.id,
            label: entry.label,
          })),
          ...(source.totpId &&
          !choices.entries.some((entry) => entry.id === source.totpId)
            ? [
                {
                  value: source.totpId,
                  label: "Saved authenticator unavailable",
                  disabled: true,
                },
              ]
            : []),
        ]}
        onChange={(totpId) => {
          if (
            !choices.available ||
            (totpId && !choices.entries.some((entry) => entry.id === totpId))
          )
            return;
          setFormData((previous) => {
            if (
              !latest.current.available ||
              previous.id !== formData.id ||
              latest.current.id !== formData.id ||
              previous.credentialSource?.kind !== "vault" ||
              previous.credentialSource.credentialId !== source.credentialId ||
              latest.current.source?.kind !== "vault" ||
              latest.current.source.credentialId !== source.credentialId
            )
              return previous;
            return {
              ...previous,
              ...credentialAccountSelection(previous, {
                kind: "vault",
                credentialId: source.credentialId,
                ...(totpId ? { totpId } : {}),
              }),
            };
          });
        }}
      />
      <p className="text-sm text-[var(--color-textSecondary)]">
        This authenticator belongs to the default saved account. Create or edit
        its authenticators in Settings → Security → Database credential vault.
        Website automatic 2FA still requires consent in the sign-in settings.
      </p>
      {choices.error && (
        <p role="alert" className="text-error">
          {choices.error}
        </p>
      )}
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={!choices.available || choices.loading}
        onClick={choices.reload}
      >
        Reload authenticators
      </button>
    </div>
  );
}
