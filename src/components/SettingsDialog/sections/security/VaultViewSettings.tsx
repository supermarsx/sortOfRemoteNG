import { useContext, useState } from "react";
import { CheckboxField, Select } from "../../../ui/forms";
import SettingsContext from "../../../../contexts/SettingsContext";
import {
  normalizeCredentialVaultView,
  VAULT_COLUMNS,
  type CredentialVaultView,
} from "../../../../utils/settings/credentialVaultView";

export default function VaultViewSettings() {
  const context = useContext(SettingsContext);
  const view = normalizeCredentialVaultView(
    context?.settings.credentialVaultView,
  );
  const [error, setError] = useState(false);
  const save = (patch: Partial<CredentialVaultView>) => {
    setError(false);
    void context
      ?.updateSettings({
        credentialVaultView: normalizeCredentialVaultView({
          ...view,
          ...patch,
        }),
      })
      .catch(() => setError(true));
  };
  return (
    <fieldset
      disabled={!context}
      className="space-y-3"
      aria-label="Credential list layout"
    >
      <legend className="text-sm font-medium">Credential list layout</legend>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Applies to credential lists in every database. Drag a column edge, or
        focus it and use the arrow keys, to resize it in the vault.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {VAULT_COLUMNS.map(({ id, label, min }) => (
          <div key={id} className="flex items-center gap-2">
            <CheckboxField
              label={label}
              wrapperClassName="min-w-0 flex-1"
              checked={view.columns.includes(id)}
              disabled={id === "name" || id === "actions"}
              onChange={(checked) =>
                save({
                  columns: checked
                    ? [...view.columns, id]
                    : view.columns.filter((column) => column !== id),
                })
              }
            />
            <input
              className="sor-form-input w-24"
              type="number"
              min={min}
              max={640}
              step={10}
              aria-label={`${label} column width`}
              key={`${id}:${view.widths[id]}`}
              defaultValue={view.widths[id]}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(e) => {
                if (e.target.value)
                  save({
                    widths: { ...view.widths, [id]: Number(e.target.value) },
                  });
                else e.currentTarget.value = String(view.widths[id]);
              }}
            />
            <span className="text-xs">px</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <div>
          <span>Credentials per page</span>
          <Select
            label="Credentials per page"
            value={view.pageSize}
            onChange={(value) =>
              save({
                pageSize: Number(value) as CredentialVaultView["pageSize"],
              })
            }
            options={[25, 50, 100, 250].map((size) => ({
              value: size,
              label: String(size),
            }))}
          />
        </div>
        <div>
          <span>List navigation</span>
          <Select
            label="Credential list navigation"
            value={view.mode}
            onChange={(value) =>
              save({ mode: value as CredentialVaultView["mode"] })
            }
            options={[
              { value: "paged", label: "Pages" },
              { value: "infinite", label: "Infinite scroll" },
            ]}
          />
        </div>
      </div>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        onClick={() => save(normalizeCredentialVaultView(undefined))}
      >
        Reset credential list layout
      </button>
      {error && <p role="alert">Could not save the credential list layout.</p>}
    </fieldset>
  );
}
