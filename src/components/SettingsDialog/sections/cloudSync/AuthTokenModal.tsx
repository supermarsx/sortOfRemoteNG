import { PasswordInput } from "../../../ui/forms/PasswordInput";
import { X } from "lucide-react";
import { Modal } from "../../../ui/overlays/Modal";
import { NumberInput } from "../../../ui/forms";
import type { Mgr } from "./types";
function AuthTokenModal({ mgr }: { mgr: Mgr }) {
  return (
    <Modal
      isOpen={Boolean(mgr.authProvider)}
      onClose={mgr.closeTokenDialog}
      closeOnEscape={false}
      backdropClassName="z-50 bg-black/60 p-4"
      panelClassName="max-w-md mx-4"
      dataTestId="cloud-sync-token-modal"
    >
      <div className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {mgr.authProvider === "googleDrive"
              ? "Connect Google Drive"
              : "Connect OneDrive"}
          </h3>
          <button
            onClick={mgr.closeTokenDialog}
            className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-textSecondary)] mt-2">
          Paste access tokens if you already completed OAuth in a browser.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Access Token
            </label>
            <PasswordInput
              value={mgr.authForm.accessToken}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  accessToken: e.target.value,
                })
              }
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Refresh Token (optional)
            </label>
            <PasswordInput
              value={mgr.authForm.refreshToken}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  refreshToken: e.target.value,
                })
              }
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Account Email
            </label>
            <input
              type="email"
              value={mgr.authForm.accountEmail}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  accountEmail: e.target.value,
                })
              }
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Token Expiry (epoch seconds, optional)
            </label>
            <NumberInput value={mgr.authForm.tokenExpiry} onChange={(v: number) => mgr.setAuthForm({
                  ...mgr.authForm,
                  tokenExpiry: e.target.value,
                })} className="sor-settings-input" min={0} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={mgr.closeTokenDialog}
            className="px-3 py-2 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mgr.saveTokenDialog}
            className="px-3 py-2 text-sm text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Save Tokens
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default AuthTokenModal;
