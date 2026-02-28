import React from "react";
import { PasswordInput } from "./ui/PasswordInput";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  Eye,
  EyeOff,
  Check,
  FileKey,
  Shield,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./ui/Modal";
import { useSSHKeyManager, SSHKey } from "../hooks/useSSHKeyManager";

type Mgr = ReturnType<typeof useSSHKeyManager>;

interface SSHKeyManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKey?: (keyPath: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
      {error}
    </div>
  );
};

const ActionButtons: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 mb-6 flex-wrap">
      <button
        onClick={() => mgr.setShowGenerateForm(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t("sshKeyManager.generate", "Generate Key")}
      </button>
      <button
        onClick={mgr.handleGenerateToFile}
        disabled={mgr.generating}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-[var(--color-text)] rounded-md hover:bg-emerald-500 transition-colors disabled:opacity-50"
        title="Generate a key and save directly to a custom location"
      >
        <FileKey className="w-4 h-4" />
        {t("sshKeyManager.generateToFile", "Generate to File")}
      </button>
      <button
        onClick={mgr.handleImportKey}
        className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
      >
        <Upload className="w-4 h-4" />
        {t("sshKeyManager.import", "Import Key")}
      </button>
      <button
        onClick={mgr.loadKeys}
        className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors ml-auto"
      >
        <RefreshCw className="w-4 h-4" />
        {t("sshKeyManager.refresh", "Refresh")}
      </button>
    </div>
  );
};

const GenerateKeyForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  if (!mgr.showGenerateForm) return null;

  return (
    <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
      <h3 className="text-sm font-medium mb-4">
        {t("sshKeyManager.generateNew", "Generate New SSH Key")}
      </h3>
      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("sshKeyManager.keyName", "Key Name")}
          </label>
          <input
            type="text"
            value={mgr.newKeyName}
            onChange={(e) => mgr.setNewKeyName(e.target.value)}
            placeholder="my-server-key"
            className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("sshKeyManager.keyType", "Key Type")}
          </label>
          <select
            value={mgr.newKeyType}
            onChange={(e) =>
              mgr.setNewKeyType(e.target.value as "ed25519" | "rsa")
            }
            className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="ed25519">Ed25519 (Recommended)</option>
            <option value="rsa">RSA (4096-bit)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("sshKeyManager.passphrase", "Passphrase (Optional)")}
          </label>
          <PasswordInput
            value={mgr.newKeyPassphrase}
            onChange={(e) => mgr.setNewKeyPassphrase(e.target.value)}
            placeholder="Optional passphrase"
            className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {mgr.newKeyPassphrase && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("sshKeyManager.confirmPassphrase", "Confirm Passphrase")}
            </label>
            <PasswordInput
              value={mgr.confirmPassphrase}
              onChange={(e) => mgr.setConfirmPassphrase(e.target.value)}
              placeholder="Confirm passphrase"
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={mgr.resetGenerateForm}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-md transition-colors"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handleGenerateKey}
            disabled={mgr.generating || !mgr.newKeyName.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {mgr.generating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {t("sshKeyManager.generate", "Generate")}
          </button>
        </div>
      </div>
    </div>
  );
};

const KeyCard: React.FC<{ keyItem: SSHKey; mgr: Mgr }> = ({
  keyItem,
  mgr,
}) => (
  <div className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors">
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <FileKey className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h4 className="font-medium">{keyItem.name}</h4>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {keyItem.type.toUpperCase()}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(keyItem.createdAt).toLocaleDateString()}
            </span>
            {keyItem.hasPassphrase && (
              <span className="flex items-center gap-1 text-yellow-600">
                <Key className="w-3 h-3" />
                Protected
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {mgr.hasOnSelectKey && (
          <button
            onClick={() => mgr.handleSelectKey(keyItem)}
            className="p-2 hover:bg-primary/10 text-primary rounded-md transition-colors"
            title="Use this key"
          >
            <Check className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => mgr.handleCopyPublicKey(keyItem)}
          className="p-2 hover:bg-muted rounded-md transition-colors"
          title="Copy public key"
        >
          {mgr.copiedId === keyItem.id ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() =>
            mgr.setShowPrivateKey(
              mgr.showPrivateKey === keyItem.id ? null : keyItem.id,
            )
          }
          className="p-2 hover:bg-muted rounded-md transition-colors"
          title="Show/hide public key"
        >
          {mgr.showPrivateKey === keyItem.id ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => mgr.handleExportKey(keyItem)}
          className="p-2 hover:bg-muted rounded-md transition-colors"
          title="Export key"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={() => mgr.handleDeleteKey(keyItem)}
          className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
          title="Delete key"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>

    {mgr.showPrivateKey === keyItem.id && keyItem.publicKey && (
      <div className="mt-3 p-3 bg-muted/50 rounded-md">
        <p className="text-xs font-medium mb-1 text-muted-foreground">
          Public Key:
        </p>
        <code className="text-xs break-all font-mono">
          {keyItem.publicKey}
        </code>
        <p className="text-xs text-muted-foreground mt-2">
          Fingerprint: {keyItem.fingerprint}
        </p>
      </div>
    )}
  </div>
);

const KeysList: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mgr.keys.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileKey className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>{t("sshKeyManager.noKeys", "No SSH keys found")}</p>
        <p className="text-sm">
          {t(
            "sshKeyManager.noKeysHint",
            "Generate or import a key to get started",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mgr.keys.map((key) => (
        <KeyCard key={key.id} keyItem={key} mgr={mgr} />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const SSHKeyManager: React.FC<SSHKeyManagerProps> = ({
  isOpen,
  onClose,
  onSelectKey,
}) => {
  const { t } = useTranslation();
  const mgr = useSSHKeyManager(isOpen, onClose, onSelectKey);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      panelClassName="max-w-3xl max-h-[90vh]"
      contentClassName="bg-background"
      dataTestId="ssh-key-manager-modal"
    >
      <ModalHeader
        onClose={onClose}
        title={
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {t("sshKeyManager.title", "SSH Key Manager")}
            </h2>
          </div>
        }
      />

      <ModalBody className="p-6">
        <ErrorBanner error={mgr.error} />
        <ActionButtons mgr={mgr} />
        <GenerateKeyForm mgr={mgr} />
        <KeysList mgr={mgr} />
      </ModalBody>

      <ModalFooter className="px-6 py-4">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-md transition-colors"
        >
          {t("common.close", "Close")}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default SSHKeyManager;
