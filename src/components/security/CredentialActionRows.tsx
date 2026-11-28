import { Copy, Info, Keyboard } from "lucide-react";

/** Shared credential presentation; the caller retains protocol-specific disclosure guards. */
export function CredentialActionRows({
  canCopy,
  canType,
  showType = true,
  onCopy,
  onType,
  help,
}: {
  canCopy: boolean;
  canType: boolean;
  showType?: boolean;
  onCopy: (field: "username" | "password") => void;
  onType: (field: "username" | "password") => void;
  help: string;
}) {
  return (
    <div className="space-y-2" aria-label="Credential actions">
      <div className="flex items-center justify-between text-xs font-medium text-[var(--color-textSecondary)]">
        <span>Credentials</span>
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="Copy and typing help"
          aria-description={help}
          data-tooltip={help}
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </div>
      {(["username", "password"] as const).map((field) => (
        <div key={field} className="flex items-center justify-between gap-3">
          <span className="text-xs capitalize">{field}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="sor-btn-secondary-sm gap-1.5"
              aria-label={`Copy ${field}`}
              data-tooltip={`Copy ${field}`}
              disabled={!canCopy}
              onClick={() => onCopy(field)}
            >
              <Copy size={13} aria-hidden="true" /> Copy
            </button>
            {showType && (
              <button
                type="button"
                className="sor-btn-secondary-sm gap-1.5"
                aria-label={`Type ${field}`}
                data-tooltip={`Type ${field}`}
                disabled={!canType}
                onClick={() => onType(field)}
              >
                <Keyboard size={13} aria-hidden="true" /> Type
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
