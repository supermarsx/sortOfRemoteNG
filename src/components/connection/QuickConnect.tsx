import React from "react";
import { PasswordInput } from "../ui/forms";
import { Clock, Play, Trash2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QuickConnectHistoryEntry } from "../../types/settings/settings";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { useQuickConnect } from "../../hooks/connection/useQuickConnect";
import { Checkbox, Select } from "../ui/forms";
import { getProtocolIcon } from "./connectionTree/helpers";

type Mgr = ReturnType<typeof useQuickConnect>;

interface QuickConnectProps {
  isOpen: boolean;
  onClose: () => void;
  historyEnabled: boolean;
  history: QuickConnectHistoryEntry[];
  onClearHistory: () => void;
  onConnect: (payload: {
    hostname: string;
    protocol: string;
    username?: string;
    password?: string;
    domain?: string;
    authType?: "password" | "key";
    privateKey?: string;
    passphrase?: string;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    httpVerifySsl?: boolean;
  }) => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const ConnectHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const connectLabel = t("quickConnect.connect", "Connect");

  return (
    <DialogHeader
      icon={Zap}
      iconColor="text-primary"
      iconBg="bg-primary/20"
      title={t("connections.quickConnect", "Quick Connect")}
      sticky
      actions={
        <button
          type="submit"
          data-tooltip={connectLabel}
          aria-label={connectLabel}
          className="p-2 bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded-lg transition-colors"
        >
          <Play size={16} />
        </button>
      }
      onClose={onClose}
    />
  );
};

const HostnameField: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <label
          htmlFor="hostname"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.hostnameLabel", "Hostname or IP Address")}
        </label>
        {mgr.historyItems.length > 0 && (
          <button
            type="button"
            onClick={() => mgr.setShowHistory((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <Clock size={12} />
            {t("quickConnect.history", "History")}
          </button>
        )}
      </div>
      <input
        id="hostname"
        type="text"
        required
        value={mgr.hostname}
        onChange={(e) => mgr.setHostname(e.target.value)}
        className="sor-form-input"
        placeholder={t(
          "quickConnect.hostnamePlaceholder",
          "192.168.1.100 or server.example.com",
        )}
        autoFocus
      />
      {mgr.showHistory && mgr.historyItems.length > 0 && (
        <div className="absolute z-20 mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
          <div className="max-h-48 overflow-auto">
            {mgr.historyItems.map((entry, index) => {
              const ProtoIcon = getProtocolIcon(entry.protocol);
              return (
                <button
                  key={`${entry.protocol}-${entry.hostname}-${index}`}
                  type="button"
                  onClick={() => mgr.handleHistorySelect(entry)}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <ProtoIcon
                        size={14}
                        className="flex-shrink-0 text-[var(--color-textSecondary)]"
                      />
                      <span className="truncate">{entry.hostname}</span>
                    </span>
                    <span className="ml-3 text-[10px] uppercase text-[var(--color-textSecondary)] flex-shrink-0">
                      {entry.protocol}
                    </span>
                  </div>
                  {entry.username && (
                    <div className="text-[11px] text-[var(--color-textSecondary)] truncate pl-6">
                      {entry.username}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-[var(--color-border)] px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-textSecondary)]">
              {mgr.historyEnabled
                ? t("quickConnect.savedHistory", "Saved Quick Connects")
                : t("quickConnect.historyDisabled", "History disabled")}
            </span>
            <button
              type="button"
              onClick={() => {
                mgr.onClearHistory();
                mgr.setShowHistory(false);
              }}
              className="flex items-center gap-1 text-[11px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <Trash2 size={12} />
              {t("common.clear", "Clear")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const ProtocolSelector: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div>
      <label
        htmlFor="protocol"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        {t("connection.protocol", "Protocol")}
      </label>
      <Select
        id="protocol"
        value={mgr.protocol}
        onChange={(v: string) => mgr.setProtocol(v)}
        options={[
          {
            value: "rdp",
            label: t("quickConnect.protocols.rdp", "RDP (Remote Desktop)"),
            icon: getProtocolIcon("rdp"),
          },
          {
            value: "ssh",
            label: t("quickConnect.protocols.ssh", "SSH (Secure Shell)"),
            icon: getProtocolIcon("ssh"),
          },
          {
            value: "vnc",
            label: t(
              "quickConnect.protocols.vnc",
              "VNC (Virtual Network Computing)",
            ),
            icon: getProtocolIcon("vnc"),
          },
          {
            value: "http",
            label: t("quickConnect.protocols.http", "HTTP"),
            icon: getProtocolIcon("http"),
          },
          {
            value: "https",
            label: t("quickConnect.protocols.https", "HTTPS"),
            icon: getProtocolIcon("https"),
          },
          {
            value: "telnet",
            label: t("quickConnect.protocols.telnet", "Telnet"),
            icon: getProtocolIcon("telnet"),
          },
        ]}
        variant="form"
      />
    </div>
  );
};

const RDPCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label
          htmlFor="rdp-username"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.usernameOptional", "Username (optional)")}
        </label>
        <input
          id="rdp-username"
          type="text"
          value={mgr.username}
          onChange={(e) => mgr.setUsername(e.target.value)}
          className="sor-form-input"
          placeholder="Administrator"
        />
      </div>
      <div>
        <label
          htmlFor="rdp-password"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.passwordOptional", "Password (optional)")}
        </label>
        <PasswordInput
          id="rdp-password"
          value={mgr.password}
          onChange={(e) => mgr.setPassword(e.target.value)}
          className="sor-form-input"
        />
      </div>
      <div>
        <label
          htmlFor="rdp-domain"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.domainOptional", "Domain (optional)")}
        </label>
        <input
          id="rdp-domain"
          type="text"
          value={mgr.domain}
          onChange={(e) => mgr.setDomain(e.target.value)}
          className="sor-form-input"
          placeholder="DOMAIN"
        />
      </div>
    </>
  );
};

const SshCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label
          htmlFor="ssh-username"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("connection.username", "Username")}
        </label>
        <input
          id="ssh-username"
          type="text"
          required
          value={mgr.username}
          onChange={(e) => mgr.setUsername(e.target.value)}
          className="sor-form-input"
          placeholder="root"
        />
      </div>
      <div>
        <label
          htmlFor="ssh-auth"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.authMethod", "Auth Method")}
        </label>
        <Select
          id="ssh-auth"
          value={mgr.authType}
          onChange={(v: string) => mgr.setAuthType(v as "password" | "key")}
          options={[
            { value: "password", label: t("connection.password", "Password") },
            {
              value: "key",
              label: t("quickConnect.privateKey", "Private Key"),
            },
          ]}
          variant="form"
        />
      </div>
      {mgr.authType === "password" ? (
        <div>
          <label
            htmlFor="ssh-password"
            className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
          >
            {t("connection.password", "Password")}
          </label>
          <PasswordInput
            id="ssh-password"
            required
            value={mgr.password}
            onChange={(e) => mgr.setPassword(e.target.value)}
            className="sor-form-input"
          />
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="ssh-key"
              className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
            >
              {t("quickConnect.privateKeyPath", "Private Key Path")}
            </label>
            <input
              id="ssh-key"
              type="text"
              required
              value={mgr.privateKey}
              onChange={(e) => mgr.setPrivateKey(e.target.value)}
              className="sor-form-input"
              placeholder="C:\\Users\\me\\.ssh\\id_rsa"
            />
          </div>
          <div>
            <label
              htmlFor="ssh-passphrase"
              className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
            >
              {t("quickConnect.passphraseOptional", "Passphrase (optional)")}
            </label>
            <PasswordInput
              id="ssh-passphrase"
              value={mgr.passphrase}
              onChange={(e) => mgr.setPassphrase(e.target.value)}
              className="sor-form-input"
            />
          </div>
        </>
      )}
    </>
  );
};

const VncCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div>
      <label
        htmlFor="vnc-password"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        {t("quickConnect.passwordOptional", "Password (optional)")}
      </label>
      <PasswordInput
        id="vnc-password"
        value={mgr.password}
        onChange={(e) => mgr.setPassword(e.target.value)}
        className="sor-form-input"
      />
    </div>
  );
};

const HttpCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label
          htmlFor="http-username"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t(
            "quickConnect.basicAuthUsernameOptional",
            "Basic Auth Username (optional)",
          )}
        </label>
        <input
          id="http-username"
          type="text"
          value={mgr.basicAuthUsername}
          onChange={(e) => mgr.setBasicAuthUsername(e.target.value)}
          className="sor-form-input"
          placeholder="admin"
        />
      </div>
      <div>
        <label
          htmlFor="http-password"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t(
            "quickConnect.basicAuthPasswordOptional",
            "Basic Auth Password (optional)",
          )}
        </label>
        <PasswordInput
          id="http-password"
          value={mgr.basicAuthPassword}
          onChange={(e) => mgr.setBasicAuthPassword(e.target.value)}
          className="sor-form-input"
        />
      </div>
      {mgr.isHttps && (
        <div>
          <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox
              checked={mgr.httpVerifySsl}
              onChange={(v: boolean) => mgr.setHttpVerifySsl(v)}
              variant="form"
            />
            <span>
              {t("quickConnect.verifyTls", "Verify TLS certificates")}
            </span>
          </label>
          <p className="text-xs text-[var(--color-textMuted)] mt-1">
            {t(
              "quickConnect.disableSelfSignedHint",
              "Disable for self-signed or untrusted certificates.",
            )}
          </p>
        </div>
      )}
    </>
  );
};

const TelnetCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label
          htmlFor="telnet-username"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.usernameOptional", "Username (optional)")}
        </label>
        <input
          id="telnet-username"
          type="text"
          value={mgr.username}
          onChange={(e) => mgr.setUsername(e.target.value)}
          className="sor-form-input"
        />
      </div>
      <div>
        <label
          htmlFor="telnet-password"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          {t("quickConnect.passwordOptional", "Password (optional)")}
        </label>
        <PasswordInput
          id="telnet-password"
          value={mgr.password}
          onChange={(e) => mgr.setPassword(e.target.value)}
          className="sor-form-input"
        />
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const QuickConnect: React.FC<QuickConnectProps> = ({
  isOpen,
  onClose,
  historyEnabled,
  history,
  onClearHistory,
  onConnect,
}) => {
  const mgr = useQuickConnect({
    isOpen,
    onClose,
    historyEnabled,
    history,
    onClearHistory,
    onConnect,
  });

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      dataTestId="quick-connect-modal"
      backdropClassName="bg-black/50"
      panelClassName="max-w-md mx-4 overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl"
    >
      <form
        onSubmit={mgr.handleSubmit}
        className="flex flex-col flex-1"
        role="form"
      >
        <ConnectHeader onClose={onClose} />
        <div className="p-4 space-y-4">
          <HostnameField mgr={mgr} />
          <ProtocolSelector mgr={mgr} />
          {mgr.isRdp && <RDPCredentials mgr={mgr} />}
          {mgr.isSsh && <SshCredentials mgr={mgr} />}
          {mgr.isVnc && <VncCredentials mgr={mgr} />}
          {mgr.isHttp && <HttpCredentials mgr={mgr} />}
          {mgr.isTelnet && <TelnetCredentials mgr={mgr} />}
        </div>
      </form>
    </Modal>
  );
};
