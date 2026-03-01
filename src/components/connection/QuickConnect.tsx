import React from "react";
import { PasswordInput } from "../ui/forms/PasswordInput";
import { Clock, Play, Trash2, Zap } from "lucide-react";
import { QuickConnectHistoryEntry } from "../../types/settings";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { useQuickConnect } from "../../hooks/connection/useQuickConnect";
import { Checkbox, Select } from '../ui/forms';

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

const ConnectHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <DialogHeader
    icon={Zap}
    iconColor="text-green-500"
    iconBg="bg-green-500/20"
    title="Quick Connect"
    sticky
    actions={
      <button
        type="submit"
        data-tooltip="Connect"
        aria-label="Connect"
        className="p-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Play size={16} />
      </button>
    }
    onClose={onClose}
  />
);

const HostnameField: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="relative">
    <div className="flex items-center justify-between">
      <label
        htmlFor="hostname"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        Hostname or IP Address
      </label>
      {mgr.historyItems.length > 0 && (
        <button
          type="button"
          onClick={() => mgr.setShowHistory((prev) => !prev)}
          className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <Clock size={12} />
          History
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
      placeholder="192.168.1.100 or server.example.com"
      autoFocus
    />
    {mgr.showHistory && mgr.historyItems.length > 0 && (
      <div className="absolute z-20 mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
        <div className="max-h-48 overflow-auto">
          {mgr.historyItems.map((entry, index) => (
            <button
              key={`${entry.protocol}-${entry.hostname}-${index}`}
              type="button"
              onClick={() => mgr.handleHistorySelect(entry)}
              className="w-full text-left px-3 py-2 text-sm text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{entry.hostname}</span>
                <span className="ml-3 text-[10px] uppercase text-[var(--color-textSecondary)]">
                  {entry.protocol}
                </span>
              </div>
              {entry.username && (
                <div className="text-[11px] text-[var(--color-textSecondary)] truncate">
                  {entry.username}
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-[var(--color-border)] px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--color-textSecondary)]">
            {mgr.historyEnabled
              ? "Saved Quick Connects"
              : "History disabled"}
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
            Clear
          </button>
        </div>
      </div>
    )}
  </div>
);

const ProtocolSelector: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label
      htmlFor="protocol"
      className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
    >
      Protocol
    </label>
    <Select id="protocol" value={mgr.protocol} onChange={(v: string) => mgr.setProtocol(v)} options={[{ value: "rdp", label: "RDP (Remote Desktop)" }, { value: "ssh", label: "SSH (Secure Shell)" }, { value: "vnc", label: "VNC (Virtual Network Computing)" }, { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "telnet", label: "Telnet" }]} variant="form" />
  </div>
);

const RDPCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div>
      <label
        htmlFor="rdp-username"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        Username (optional)
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
        Password (optional)
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
        Domain (optional)
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

const SshCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div>
      <label
        htmlFor="ssh-username"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        Username
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
        Auth Method
      </label>
      <Select id="ssh-auth" value={mgr.authType} onChange={(v: string) => mgr.setAuthType(v as "password" | "key")} options={[{ value: "password", label: "Password" }, { value: "key", label: "Private Key" }]} variant="form" />
    </div>
    {mgr.authType === "password" ? (
      <div>
        <label
          htmlFor="ssh-password"
          className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
        >
          Password
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
            Private Key Path
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
            Passphrase (optional)
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

const VncCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label
      htmlFor="vnc-password"
      className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
    >
      Password (optional)
    </label>
    <PasswordInput
      id="vnc-password"
      value={mgr.password}
      onChange={(e) => mgr.setPassword(e.target.value)}
      className="sor-form-input"
    />
  </div>
);

const HttpCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div>
      <label
        htmlFor="http-username"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        Basic Auth Username (optional)
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
        Basic Auth Password (optional)
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
          <Checkbox checked={mgr.httpVerifySsl} onChange={(v: boolean) => mgr.setHttpVerifySsl(v)} variant="form" />
          <span>Verify TLS certificates</span>
        </label>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Disable for self-signed or untrusted certificates.
        </p>
      </div>
    )}
  </>
);

const TelnetCredentials: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div>
      <label
        htmlFor="telnet-username"
        className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
      >
        Username (optional)
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
        Password (optional)
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
