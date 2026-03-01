import React from "react";
import { Plus, Trash2, Copy, Shield, Key } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTOTPManager } from "../hooks/useTOTPManager";
import { Modal, ModalHeader, ModalBody } from "./ui/Modal";
import { TOTPConfig } from "../types/settings";

type Mgr = ReturnType<typeof useTOTPManager>;

/* ── sub-components ── */

const AddTOTPForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
    <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
      Add New TOTP Configuration
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Account Name *
        </label>
        <input
          type="text"
          value={mgr.newConfig.account || ""}
          onChange={(e) =>
            mgr.setNewConfig({ ...mgr.newConfig, account: e.target.value })
          }
          className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
          placeholder="user@example.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Issuer
        </label>
        <input
          type="text"
          value={mgr.newConfig.issuer || ""}
          onChange={(e) =>
            mgr.setNewConfig({ ...mgr.newConfig, issuer: e.target.value })
          }
          className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
          placeholder="sortOfRemoteNG"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Digits
        </label>
        <select
          value={mgr.newConfig.digits || 6}
          onChange={(e) =>
            mgr.setNewConfig({
              ...mgr.newConfig,
              digits: parseInt(e.target.value),
            })
          }
          className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
        >
          <option value={6}>6 digits</option>
          <option value={8}>8 digits</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Period (seconds)
        </label>
        <select
          value={mgr.newConfig.period || 30}
          onChange={(e) =>
            mgr.setNewConfig({
              ...mgr.newConfig,
              period: parseInt(e.target.value),
            })
          }
          className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
        >
          <option value={15}>15 seconds</option>
          <option value={30}>30 seconds</option>
          <option value={60}>60 seconds</option>
        </select>
      </div>
    </div>

    <div className="flex justify-end space-x-3">
      <button
        onClick={() => mgr.setShowAddForm(false)}
        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={mgr.handleAddConfig}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
      >
        Add TOTP
      </button>
    </div>
  </div>
);

const QRCodeDisplay: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6 text-center">
    <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
      Scan QR Code
    </h3>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={mgr.qrCodeUrl} alt="TOTP QR Code" className="mx-auto mb-4" />
    <p className="text-[var(--color-textSecondary)] text-sm">
      Scan this QR code with your authenticator app (Google Authenticator,
      Aegis, etc.)
    </p>
    <button
      onClick={mgr.clearQrCode}
      className="mt-4 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
    >
      Close
    </button>
  </div>
);

const TOTPConfigRow: React.FC<{
  config: TOTPConfig;
  mgr: Mgr;
}> = ({ config, mgr }) => (
  <div className="sor-selection-row cursor-default bg-[var(--color-border)] p-4">
    <div className="flex-1">
      <div className="flex items-center space-x-3 mb-2">
        <Shield size={16} className="text-blue-400" />
        <span className="text-[var(--color-text)] font-medium">
          {config.account}
        </span>
        <span className="text-[var(--color-textSecondary)] text-sm">
          ({config.issuer})
        </span>
      </div>

      <div className="flex items-center space-x-4">
        <div className="bg-[var(--color-surface)] rounded-lg px-4 py-2 font-mono text-2xl text-green-400">
          {mgr.currentCodes[config.secret] || "------"}
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          <div>Expires in: {mgr.getTimeRemaining()}s</div>
          <div>
            {config.digits} digits &bull; {config.period}s period
          </div>
        </div>
      </div>
    </div>

    <div className="flex items-center space-x-2">
      <button
        onClick={() =>
          mgr.copyToClipboard(mgr.currentCodes[config.secret] || "")
        }
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        title="Copy code"
      >
        <Copy size={16} />
      </button>

      <button
        onClick={() => mgr.copyToClipboard(config.secret)}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        title="Copy secret"
      >
        <Key size={16} />
      </button>

      <button
        onClick={() => mgr.handleDeleteConfig(config.secret)}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-red-400 hover:text-red-300"
        title="Delete"
      >
        <Trash2 size={16} />
      </button>
    </div>
  </div>
);

const TOTPInstructions: React.FC = () => (
  <div className="mt-8 bg-blue-900/20 border border-blue-700 rounded-lg p-4">
    <h3 className="text-blue-300 font-medium mb-2">How to use TOTP</h3>
    <ul className="text-blue-200 text-sm space-y-1">
      <li>
        &bull; Install an authenticator app like Google Authenticator or Aegis
      </li>
      <li>&bull; Scan the QR code or manually enter the secret key</li>
      <li>&bull; Use the generated codes for two-factor authentication</li>
      <li>&bull; Codes refresh every 30 seconds (or configured period)</li>
      <li>&bull; Keep your secret keys secure and backed up</li>
    </ul>
  </div>
);

/* ── main component ── */

interface TOTPManagerProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
}

export const TOTPManager: React.FC<TOTPManagerProps> = ({
  isOpen,
  onClose,
  connectionId,
}) => {
  const { t } = useTranslation();
  const mgr = useTOTPManager(isOpen, connectionId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      panelClassName="max-w-4xl mx-4 max-h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="totp-manager-modal"
    >
      <ModalHeader
        onClose={onClose}
        title={
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Shield size={18} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              TOTP Authenticator
            </h2>
          </div>
        }
        actions={
          <button
            onClick={() => mgr.setShowAddForm(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2 text-sm"
          >
            <Plus size={14} />
            <span>Add TOTP</span>
          </button>
        }
      />

      <ModalBody className="p-6">
        {mgr.showAddForm && <AddTOTPForm mgr={mgr} />}
        {mgr.qrCodeUrl && <QRCodeDisplay mgr={mgr} />}

        <div className="sor-selection-list">
          {mgr.totpConfigs.length === 0 ? (
            <div className="text-center py-12">
              <Key size={48} className="mx-auto text-gray-500 mb-4" />
              <p className="text-[var(--color-textSecondary)]">
                No TOTP configurations found
              </p>
              <p className="text-gray-500 text-sm">
                Add a new TOTP configuration to get started
              </p>
            </div>
          ) : (
            mgr.totpConfigs.map((config) => (
              <TOTPConfigRow key={config.secret} config={config} mgr={mgr} />
            ))
          )}
        </div>

        <TOTPInstructions />
      </ModalBody>
    </Modal>
  );
};
