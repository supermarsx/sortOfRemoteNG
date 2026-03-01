import React from 'react';
import { Lock, Eye, EyeOff, Shield, AlertCircle, X, Fingerprint, Key, FileKey, Upload, Loader2 } from 'lucide-react';
import { Modal, ModalBody } from './ui/Modal';
import { usePasswordDialog, AuthMethod } from '../hooks/usePasswordDialog';

type Mgr = ReturnType<typeof usePasswordDialog>;

// ─── Sub-components ─────────────────────────────────────────────────

const DialogHeader: React.FC<{ mode: 'setup' | 'unlock'; onCancel: () => void }> = ({ mode, onCancel }) => (
  <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
    <div className="flex items-center space-x-3">
      <div className="p-2 bg-blue-500/20 rounded-lg">
        <Shield className="text-blue-500" size={18} />
      </div>
      <h2 className="text-lg font-semibold text-[var(--color-text)]">
        {mode === 'setup' ? 'Secure Your Connections' : 'Unlock Connections'}
      </h2>
    </div>
    <button onClick={onCancel} className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" aria-label="Close">
      <X size={18} />
    </button>
  </div>
);

const CollectionWarning: React.FC = () => (
  <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-warning-rgb, 245, 158, 11), 0.15)', borderColor: 'var(--color-warning)' }}>
    <div className="flex items-center space-x-2">
      <AlertCircle className="text-yellow-400" size={16} />
      <span className="text-yellow-400 text-sm">Please select a collection before setting up security.</span>
    </div>
  </div>
);

const SetupBanner: React.FC = () => (
  <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.15)', borderColor: 'var(--color-primary)' }}>
    <div className="flex items-start space-x-3">
      <Lock className="text-blue-400 mt-0.5" size={16} />
      <div className="text-sm text-blue-400">
        <p className="font-medium mb-1">Secure Your Data</p>
        <p className="text-blue-300">Choose how to protect your connections. You can use a password, system passkey (Windows Hello/Touch ID), or a key file.</p>
      </div>
    </div>
  </div>
);

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-error-rgb, 239, 68, 68), 0.15)', borderColor: 'var(--color-error)' }}>
    <div className="flex items-center space-x-2">
      <AlertCircle className="text-red-400" size={16} />
      <span className="text-red-400 text-sm">{message}</span>
    </div>
  </div>
);

const AuthMethodButton: React.FC<{
  method: AuthMethod; active: boolean; disabled: boolean;
  onClick: () => void; icon: React.ReactNode; label: string;
}> = ({ method, active, disabled, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 rounded-lg border transition-all ${
      active ? 'border-blue-500 text-blue-400' : 'bg-[var(--color-border)] border-[var(--color-border)] text-[var(--color-textSecondary)] hover:border-[var(--color-border)]'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    style={active ? { backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.2)' } : {}}
  >
    {icon}
    <span className="text-sm">{label}</span>
  </button>
);

const AuthMethodSelector: React.FC<{ mgr: Mgr; noCollectionSelected: boolean }> = ({ mgr, noCollectionSelected }) => (
  <div className="flex space-x-2">
    <AuthMethodButton method="password" active={mgr.authMethod === 'password'} disabled={noCollectionSelected} onClick={() => mgr.setAuthMethod('password')} icon={<Key size={16} />} label="Password" />
    {mgr.passkeyAvailable && (
      <AuthMethodButton method="passkey" active={mgr.authMethod === 'passkey'} disabled={noCollectionSelected} onClick={() => mgr.setAuthMethod('passkey')} icon={<Fingerprint size={16} />} label="Passkey" />
    )}
    <AuthMethodButton method="keyfile" active={mgr.authMethod === 'keyfile'} disabled={noCollectionSelected} onClick={() => mgr.setAuthMethod('keyfile')} icon={<FileKey size={16} />} label="Key File" />
  </div>
);

const PasswordForm: React.FC<{ mgr: Mgr; mode: 'setup' | 'unlock'; noCollectionSelected: boolean }> = ({ mgr, mode, noCollectionSelected }) => (
  <form onSubmit={mgr.handleSubmit} className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mode === 'setup' ? 'Create Password' : 'Enter Password'}</label>
      <div className="relative">
        <input type={mgr.showPassword ? 'text' : 'password'} required value={mgr.password} onChange={(e) => mgr.setPassword(e.target.value)} disabled={noCollectionSelected} className="w-full px-3 py-2 pr-10 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50" placeholder="Enter password" minLength={4} autoFocus />
        <button type="button" onClick={() => mgr.setShowPassword(!mgr.showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
          {mgr.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
    {mode === 'setup' && (
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Confirm Password</label>
        <div className="relative">
          <input type={mgr.showConfirmPassword ? 'text' : 'password'} required value={mgr.confirmPassword} onChange={(e) => mgr.setConfirmPassword(e.target.value)} disabled={noCollectionSelected} className="w-full px-3 py-2 pr-10 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50" placeholder="Confirm password" minLength={4} />
          <button type="button" onClick={() => mgr.setShowConfirmPassword(!mgr.showConfirmPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
            {mgr.showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {mgr.passwordsMismatch && <p className="text-red-400 text-sm mt-1">Passwords do not match</p>}
      </div>
    )}
    <div className="flex justify-end space-x-3 pt-2">
      <button type="button" onClick={mgr.handleCancel} className="px-4 py-2 text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md transition-colors">{mode === 'setup' ? 'Skip' : 'Cancel'}</button>
      <button type="submit" disabled={mgr.passwordSubmitDisabled} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
        <Lock size={16} /><span>{mode === 'setup' ? 'Secure' : 'Unlock'}</span>
      </button>
    </div>
  </form>
);

const PasskeyForm: React.FC<{ mgr: Mgr; mode: 'setup' | 'unlock'; noCollectionSelected: boolean }> = ({ mgr, mode, noCollectionSelected }) => (
  <div className="space-y-4">
    <div className="bg-[var(--color-border)] rounded-lg p-6 text-center">
      <Fingerprint size={48} className="mx-auto mb-4 text-blue-400" />
      <p className="text-[var(--color-textSecondary)] mb-2">{mode === 'setup' ? 'Use Windows Hello or your device biometrics to secure your data' : 'Authenticate with Windows Hello or device biometrics'}</p>
      <p className="text-[var(--color-textSecondary)] text-sm">Your passkey is stored securely on your device</p>
    </div>
    <div className="flex justify-end space-x-3 pt-2">
      <button type="button" onClick={mgr.handleCancel} className="px-4 py-2 text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md transition-colors">Cancel</button>
      <button type="button" onClick={mgr.handlePasskeyAuth} disabled={noCollectionSelected || mgr.passkeyLoading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
        {mgr.passkeyLoading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
        <span>{mgr.passkeyLoading ? 'Authenticating...' : mode === 'setup' ? 'Set Up Passkey' : 'Authenticate'}</span>
      </button>
    </div>
  </div>
);

const KeyFileForm: React.FC<{ mgr: Mgr; mode: 'setup' | 'unlock'; noCollectionSelected: boolean }> = ({ mgr, mode, noCollectionSelected }) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mode === 'setup' ? 'Select Key File' : 'Select Your Key File'}</label>
      <div onClick={noCollectionSelected ? undefined : mgr.handleKeyFileSelect} className={`border-2 border-dashed border-[var(--color-border)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--color-border)] transition-colors ${noCollectionSelected ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {mgr.keyFilePath ? (
          <div className="flex items-center justify-center space-x-2 text-green-400"><FileKey size={24} /><span>{mgr.keyFilePath}</span></div>
        ) : (
          <><Upload size={32} className="mx-auto mb-2 text-[var(--color-textSecondary)]" /><p className="text-[var(--color-textSecondary)] text-sm">Click to select a key file (.key, .pem, .txt)</p></>
        )}
      </div>
      {mode === 'setup' && <p className="text-[var(--color-textSecondary)] text-xs mt-2">Keep your key file safe! You will need it to unlock your connections.</p>}
    </div>
    <div className="flex justify-end space-x-3 pt-2">
      <button type="button" onClick={mgr.handleCancel} className="px-4 py-2 text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md transition-colors">Cancel</button>
      <button type="button" onClick={mgr.handleSubmit as any} disabled={noCollectionSelected || !mgr.keyFileContent} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
        <FileKey size={16} /><span>{mode === 'setup' ? 'Secure' : 'Unlock'}</span>
      </button>
    </div>
  </div>
);

// ─── Root component ─────────────────────────────────────────────────

interface PasswordDialogProps {
  isOpen: boolean;
  mode: 'setup' | 'unlock';
  onSubmit: (password: string, method?: AuthMethod) => void;
  onCancel: () => void;
  error?: string;
  noCollectionSelected?: boolean;
}

export const PasswordDialog: React.FC<PasswordDialogProps> = ({
  isOpen, mode, onSubmit, onCancel, error, noCollectionSelected = false,
}) => {
  const mgr = usePasswordDialog({ isOpen, mode, onSubmit, onCancel, noCollectionSelected });

  if (!isOpen) return null;

  const errorMsg = error || mgr.passwordError;

  return (
    <Modal isOpen={isOpen} onClose={mgr.handleCancel} closeOnBackdrop closeOnEscape panelClassName="max-w-md mx-4 rounded-xl border border-[var(--color-border)] animate-in fade-in zoom-in-95 duration-200">
      <ModalBody className="overflow-y-auto">
        <DialogHeader mode={mode} onCancel={mgr.handleCancel} />
        <div className="p-6 space-y-4">
          {noCollectionSelected && <CollectionWarning />}
          {mode === 'setup' && !noCollectionSelected && <SetupBanner />}
          {errorMsg && <ErrorBanner message={errorMsg} />}
          <AuthMethodSelector mgr={mgr} noCollectionSelected={noCollectionSelected} />
          {mgr.authMethod === 'password' && <PasswordForm mgr={mgr} mode={mode} noCollectionSelected={noCollectionSelected} />}
          {mgr.authMethod === 'passkey' && <PasskeyForm mgr={mgr} mode={mode} noCollectionSelected={noCollectionSelected} />}
          {mgr.authMethod === 'keyfile' && <KeyFileForm mgr={mgr} mode={mode} noCollectionSelected={noCollectionSelected} />}
        </div>
      </ModalBody>
    </Modal>
  );
};

export default PasswordDialog;
