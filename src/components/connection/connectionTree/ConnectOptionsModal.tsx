import { PasswordInput, Textarea } from "../../ui/forms";
import Modal from "../../ui/overlays/Modal";
import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import { Select, Checkbox } from "../../ui/forms";
import { useTranslation } from "react-i18next";

function ConnectOptionsModal({ mgr }: { mgr: ConnectionTreeMgr }) {
  const { t } = useTranslation();
  if (!mgr.connectOptionsTarget || !mgr.connectOptionsData) return null;
  const target = mgr.connectOptionsTarget;
  const data = mgr.connectOptionsData;
  const update = (patch: Partial<typeof data>) =>
    mgr.setConnectOptionsData({ ...data, ...patch });
  const close = () => {
    mgr.setConnectOptionsTarget(null);
    mgr.setConnectOptionsData(null);
  };

  return (
    <Modal
      isOpen={Boolean(mgr.connectOptionsTarget && mgr.connectOptionsData)}
      onClose={close}
      closeOnEscape={false}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-connect-options-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t("connections.connectWithOptions", "Connect with Options")}
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              {t("connection.username", "Username")}
            </label>
            <input
              type="text"
              value={data.username}
              onChange={(e) => update({ username: e.target.value })}
              className="sor-form-input"
            />
          </div>
          {target.protocol === "ssh" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("quickConnect.authMethod", "Auth Method")}
                </label>
                <Select
                  value={data.authType}
                  onChange={(v: string) =>
                    update({ authType: v as "password" | "key" })
                  }
                  options={[
                    {
                      value: "password",
                      label: t("connection.password", "Password"),
                    },
                    {
                      value: "key",
                      label: t("quickConnect.privateKey", "Private Key"),
                    },
                  ]}
                  className="sor-form-input"
                />
              </div>
              {data.authType === "password" ? (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("connection.password", "Password")}
                  </label>
                  <PasswordInput
                    value={data.password}
                    onChange={(e) => update({ password: e.target.value })}
                    className="sor-form-input"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                      {t("quickConnect.privateKey", "Private Key")}
                    </label>
                    <Textarea
                      value={data.privateKey}
                      onChange={(v) => update({ privateKey: v })}
                      rows={3}
                      className="sor-form-input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                      {t(
                        "quickConnect.passphraseOptional",
                        "Passphrase (optional)",
                      )}
                    </label>
                    <PasswordInput
                      value={data.passphrase}
                      onChange={(e) => update({ passphrase: e.target.value })}
                      className="sor-form-input"
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("connection.password", "Password")}
              </label>
              <PasswordInput
                value={data.password}
                onChange={(e) => update({ password: e.target.value })}
                className="sor-form-input"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox
              checked={data.saveToConnection}
              onChange={(v: boolean) => update({ saveToConnection: v })}
            />
            <span>
              {t(
                "connections.saveCredentialsToConnection",
                "Save credentials to this connection",
              )}
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-2 text-sm text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md"
            >
              {t("dialogs.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={mgr.handleConnectOptionsSubmit}
              className="px-3 py-2 text-sm text-[var(--color-text)] bg-primary hover:bg-primary/90 rounded-md"
            >
              {t("quickConnect.connect", "Connect")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── PanelContextMenu ──────────────────────────────────────────── */

export default ConnectOptionsModal;
