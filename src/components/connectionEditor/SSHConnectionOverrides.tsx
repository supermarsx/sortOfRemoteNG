import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Network, RotateCcw, Plus, X } from 'lucide-react';
import { Connection } from '../../types/connection';
import { 
  SSHConnectionConfig, 
  defaultSSHConnectionConfig,
  SSHVersion,
  SSHAuthMethod,
  SSHAuthMethods,
  IPProtocol,
} from '../../types/settings';
import { useSettings } from '../../contexts/SettingsContext';

interface SSHConnectionOverridesProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

type OverrideKey = keyof SSHConnectionConfig;

/**
 * Component for overriding global SSH connection settings per-connection.
 * Controls protocol-level settings like timeouts, authentication, ciphers, etc.
 */
export const SSHConnectionOverrides: React.FC<SSHConnectionOverridesProps> = ({ 
  formData, 
  setFormData 
}) => {
  const { settings } = useSettings();
  // Use global SSH connection config if available, otherwise use defaults
  const globalConfig = (settings as any).sshConnection || defaultSSHConnectionConfig;
  const [isExpanded, setIsExpanded] = useState(false);
  const overrides = formData.sshConnectionConfigOverride || {};

  // Check if any overrides exist
  const hasOverrides = Object.keys(overrides).length > 0;

  const updateOverride = <K extends OverrideKey>(key: K, value: SSHConnectionConfig[K] | undefined) => {
    setFormData(prev => {
      const currentOverrides = prev.sshConnectionConfigOverride || {};
      if (value === undefined) {
        // Remove the override (revert to global)
        const { [key]: _, ...rest } = currentOverrides;
        return {
          ...prev,
          sshConnectionConfigOverride: Object.keys(rest).length > 0 ? rest : undefined,
        };
      }
      return {
        ...prev,
        sshConnectionConfigOverride: {
          ...currentOverrides,
          [key]: value,
        },
      };
    });
  };

  const clearAllOverrides = () => {
    setFormData(prev => ({
      ...prev,
      sshConnectionConfigOverride: undefined,
    }));
  };

  const isOverridden = (key: OverrideKey) => key in overrides;
  const getValue = <K extends OverrideKey>(key: K): SSHConnectionConfig[K] => 
    (overrides[key] as SSHConnectionConfig[K]) ?? globalConfig[key];

  // Only show for SSH protocol
  if (formData.protocol !== 'ssh' || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-[var(--color-border)]/50 hover:bg-[var(--color-border)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-gray-200">
            SSH Connection Settings Override
          </span>
          {hasOverrides && (
            <span className="px-2 py-0.5 text-xs bg-green-600 text-[var(--color-text)] rounded-full">
              {Object.keys(overrides).length} custom
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4 bg-[var(--color-surface)]/50">
          <p className="text-xs text-[var(--color-textSecondary)]">
            Override global SSH connection settings for this connection. 
            These settings control the SSH protocol layer.
          </p>

          {hasOverrides && (
            <button
              type="button"
              onClick={clearAllOverrides}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All to Global
            </button>
          )}

          {/* Connection Behavior */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Connection</h4>
            
            <OverrideToggle
              label="Connect Timeout"
              isOverridden={isOverridden('connectTimeout')}
              globalValue={`${globalConfig.connectTimeout}s`}
              onToggle={(enabled) => updateOverride('connectTimeout', enabled ? globalConfig.connectTimeout : undefined)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={getValue('connectTimeout')}
                  onChange={(e) => updateOverride('connectTimeout', Number(e.target.value))}
                  className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
              </div>
            </OverrideToggle>

            <OverrideToggle
              label="Keep Alive Interval"
              isOverridden={isOverridden('keepAliveInterval')}
              globalValue={globalConfig.keepAliveInterval === 0 ? 'Disabled' : `${globalConfig.keepAliveInterval}s`}
              onToggle={(enabled) => updateOverride('keepAliveInterval', enabled ? globalConfig.keepAliveInterval : undefined)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={getValue('keepAliveInterval')}
                  onChange={(e) => updateOverride('keepAliveInterval', Number(e.target.value))}
                  className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <span className="text-sm text-[var(--color-textSecondary)]">seconds (0 = disabled)</span>
              </div>
            </OverrideToggle>

            <OverrideToggle
              label="Host Key Checking"
              isOverridden={isOverridden('strictHostKeyChecking')}
              globalValue={globalConfig.strictHostKeyChecking ? 'Strict' : 'Disabled'}
              onToggle={(enabled) => updateOverride('strictHostKeyChecking', enabled ? !globalConfig.strictHostKeyChecking : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('strictHostKeyChecking')}
                  onChange={(e) => updateOverride('strictHostKeyChecking', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Strict host key verification
              </label>
            </OverrideToggle>
          </div>

          {/* Authentication */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Authentication</h4>
            
            <OverrideToggle
              label="Auth Methods"
              isOverridden={isOverridden('preferredAuthMethods')}
              globalValue={globalConfig.preferredAuthMethods.join(', ')}
              onToggle={(enabled) => updateOverride('preferredAuthMethods', enabled ? [...globalConfig.preferredAuthMethods] : undefined)}
            >
              <AuthMethodSelector
                value={getValue('preferredAuthMethods')}
                onChange={(methods) => updateOverride('preferredAuthMethods', methods)}
              />
            </OverrideToggle>

            <OverrideToggle
              label="Try Public Key First"
              isOverridden={isOverridden('tryPublicKeyFirst')}
              globalValue={globalConfig.tryPublicKeyFirst ? 'Yes' : 'No'}
              onToggle={(enabled) => updateOverride('tryPublicKeyFirst', enabled ? !globalConfig.tryPublicKeyFirst : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('tryPublicKeyFirst')}
                  onChange={(e) => updateOverride('tryPublicKeyFirst', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Attempt public key auth first
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Agent Forwarding"
              isOverridden={isOverridden('agentForwarding')}
              globalValue={globalConfig.agentForwarding ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('agentForwarding', enabled ? !globalConfig.agentForwarding : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('agentForwarding')}
                  onChange={(e) => updateOverride('agentForwarding', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable SSH agent forwarding
              </label>
            </OverrideToggle>
          </div>

          {/* SSH Protocol */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Protocol</h4>
            
            <OverrideToggle
              label="SSH Version"
              isOverridden={isOverridden('sshVersion')}
              globalValue={globalConfig.sshVersion}
              onToggle={(enabled) => updateOverride('sshVersion', enabled ? globalConfig.sshVersion : undefined)}
            >
              <select
                value={getValue('sshVersion')}
                onChange={(e) => updateOverride('sshVersion', e.target.value as SSHVersion)}
                className="w-32 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="auto">Auto</option>
                <option value="2">SSH-2 only</option>
                <option value="1">SSH-1 only</option>
              </select>
            </OverrideToggle>

            <OverrideToggle
              label="Compression"
              isOverridden={isOverridden('enableCompression')}
              globalValue={globalConfig.enableCompression ? `Level ${globalConfig.compressionLevel}` : 'Disabled'}
              onToggle={(enabled) => updateOverride('enableCompression', enabled ? !globalConfig.enableCompression : undefined)}
            >
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <input
                    type="checkbox"
                    checked={getValue('enableCompression')}
                    onChange={(e) => updateOverride('enableCompression', e.target.checked)}
                    className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                  />
                  Enable
                </label>
                {getValue('enableCompression') && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--color-textSecondary)]">Level:</span>
                    <input
                      type="number"
                      min={1}
                      max={9}
                      value={getValue('compressionLevel')}
                      onChange={(e) => updateOverride('compressionLevel', Number(e.target.value))}
                      className="w-16 px-2 py-1 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                    />
                  </div>
                )}
              </div>
            </OverrideToggle>

            <OverrideToggle
              label="PTY Type"
              isOverridden={isOverridden('ptyType')}
              globalValue={globalConfig.ptyType}
              onToggle={(enabled) => updateOverride('ptyType', enabled ? globalConfig.ptyType : undefined)}
            >
              <select
                value={getValue('ptyType')}
                onChange={(e) => updateOverride('ptyType', e.target.value)}
                className="w-40 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="xterm-256color">xterm-256color</option>
                <option value="xterm">xterm</option>
                <option value="vt100">vt100</option>
                <option value="vt220">vt220</option>
                <option value="linux">linux</option>
                <option value="dumb">dumb</option>
              </select>
            </OverrideToggle>
          </div>

          {/* TCP/IP Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">TCP/IP</h4>
            
            <OverrideToggle
              label="TCP No Delay"
              isOverridden={isOverridden('tcpNoDelay')}
              globalValue={globalConfig.tcpNoDelay ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('tcpNoDelay', enabled ? !globalConfig.tcpNoDelay : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('tcpNoDelay')}
                  onChange={(e) => updateOverride('tcpNoDelay', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Disable Nagle algorithm
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="TCP Keep Alive"
              isOverridden={isOverridden('tcpKeepAlive')}
              globalValue={globalConfig.tcpKeepAlive ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('tcpKeepAlive', enabled ? !globalConfig.tcpKeepAlive : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('tcpKeepAlive')}
                  onChange={(e) => updateOverride('tcpKeepAlive', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable TCP keep-alive
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="IP Protocol"
              isOverridden={isOverridden('ipProtocol')}
              globalValue={globalConfig.ipProtocol}
              onToggle={(enabled) => updateOverride('ipProtocol', enabled ? globalConfig.ipProtocol : undefined)}
            >
              <select
                value={getValue('ipProtocol')}
                onChange={(e) => updateOverride('ipProtocol', e.target.value as IPProtocol)}
                className="w-32 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="auto">Auto</option>
                <option value="ipv4">IPv4 only</option>
                <option value="ipv6">IPv6 only</option>
              </select>
            </OverrideToggle>
          </div>

          {/* Port Forwarding */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Forwarding</h4>
            
            <OverrideToggle
              label="TCP Forwarding"
              isOverridden={isOverridden('enableTcpForwarding')}
              globalValue={globalConfig.enableTcpForwarding ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('enableTcpForwarding', enabled ? !globalConfig.enableTcpForwarding : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('enableTcpForwarding')}
                  onChange={(e) => updateOverride('enableTcpForwarding', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Allow TCP port forwarding
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="X11 Forwarding"
              isOverridden={isOverridden('enableX11Forwarding')}
              globalValue={globalConfig.enableX11Forwarding ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('enableX11Forwarding', enabled ? !globalConfig.enableX11Forwarding : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('enableX11Forwarding')}
                  onChange={(e) => updateOverride('enableX11Forwarding', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable X11 forwarding
              </label>
            </OverrideToggle>
          </div>

          {/* SFTP/SCP */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">File Transfer</h4>
            
            <OverrideToggle
              label="SFTP"
              isOverridden={isOverridden('sftpEnabled')}
              globalValue={globalConfig.sftpEnabled ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('sftpEnabled', enabled ? !globalConfig.sftpEnabled : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('sftpEnabled')}
                  onChange={(e) => updateOverride('sftpEnabled', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable SFTP subsystem
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="SCP"
              isOverridden={isOverridden('scpEnabled')}
              globalValue={globalConfig.scpEnabled ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => updateOverride('scpEnabled', enabled ? !globalConfig.scpEnabled : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('scpEnabled')}
                  onChange={(e) => updateOverride('scpEnabled', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable SCP transfers
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="SFTP Start Path"
              isOverridden={isOverridden('sftpStartPath')}
              globalValue={globalConfig.sftpStartPath || 'Home directory'}
              onToggle={(enabled) => updateOverride('sftpStartPath', enabled ? globalConfig.sftpStartPath || '' : undefined)}
            >
              <input
                type="text"
                placeholder="/path/to/start"
                value={getValue('sftpStartPath') || ''}
                onChange={(e) => updateOverride('sftpStartPath', e.target.value || undefined)}
                className="w-full px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              />
            </OverrideToggle>
          </div>

          {/* Ciphers & Algorithms */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Ciphers & Algorithms</h4>
            
            <OverrideToggle
              label="Preferred Ciphers"
              isOverridden={isOverridden('preferredCiphers')}
              globalValue={globalConfig.preferredCiphers.length ? globalConfig.preferredCiphers.join(', ') : 'Default'}
              onToggle={(enabled) => updateOverride('preferredCiphers', enabled ? [...globalConfig.preferredCiphers] : undefined)}
            >
              <CipherSelector
                label="Ciphers"
                value={getValue('preferredCiphers')}
                onChange={(ciphers) => updateOverride('preferredCiphers', ciphers)}
                options={CIPHER_OPTIONS}
              />
            </OverrideToggle>

            <OverrideToggle
              label="Preferred MACs"
              isOverridden={isOverridden('preferredMACs')}
              globalValue={globalConfig.preferredMACs.length ? globalConfig.preferredMACs.join(', ') : 'Default'}
              onToggle={(enabled) => updateOverride('preferredMACs', enabled ? [...globalConfig.preferredMACs] : undefined)}
            >
              <CipherSelector
                label="MACs"
                value={getValue('preferredMACs')}
                onChange={(macs) => updateOverride('preferredMACs', macs)}
                options={MAC_OPTIONS}
              />
            </OverrideToggle>

            <OverrideToggle
              label="Key Exchanges"
              isOverridden={isOverridden('preferredKeyExchanges')}
              globalValue={globalConfig.preferredKeyExchanges.length ? globalConfig.preferredKeyExchanges.join(', ') : 'Default'}
              onToggle={(enabled) => updateOverride('preferredKeyExchanges', enabled ? [...globalConfig.preferredKeyExchanges] : undefined)}
            >
              <CipherSelector
                label="Key Exchange"
                value={getValue('preferredKeyExchanges')}
                onChange={(kex) => updateOverride('preferredKeyExchanges', kex)}
                options={KEX_OPTIONS}
              />
            </OverrideToggle>

            <OverrideToggle
              label="Host Key Algorithms"
              isOverridden={isOverridden('preferredHostKeyAlgorithms')}
              globalValue={globalConfig.preferredHostKeyAlgorithms.length ? globalConfig.preferredHostKeyAlgorithms.join(', ') : 'Default'}
              onToggle={(enabled) => updateOverride('preferredHostKeyAlgorithms', enabled ? [...globalConfig.preferredHostKeyAlgorithms] : undefined)}
            >
              <CipherSelector
                label="Host Key"
                value={getValue('preferredHostKeyAlgorithms')}
                onChange={(algs) => updateOverride('preferredHostKeyAlgorithms', algs)}
                options={HOST_KEY_OPTIONS}
              />
            </OverrideToggle>
          </div>

          {/* Banner & Misc */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Banner & Misc</h4>
            
            <OverrideToggle
              label="Show Banner"
              isOverridden={isOverridden('showBanner')}
              globalValue={globalConfig.showBanner ? 'Yes' : 'No'}
              onToggle={(enabled) => updateOverride('showBanner', enabled ? !globalConfig.showBanner : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('showBanner')}
                  onChange={(e) => updateOverride('showBanner', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Display server banner
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Banner Timeout"
              isOverridden={isOverridden('bannerTimeout')}
              globalValue={`${globalConfig.bannerTimeout}s`}
              onToggle={(enabled) => updateOverride('bannerTimeout', enabled ? globalConfig.bannerTimeout : undefined)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={getValue('bannerTimeout')}
                  onChange={(e) => updateOverride('bannerTimeout', Number(e.target.value))}
                  className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
              </div>
            </OverrideToggle>
          </div>

          {/* Environment Variables */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Environment Variables</h4>
            
            <OverrideToggle
              label="Custom Environment"
              isOverridden={isOverridden('environment')}
              globalValue={Object.keys(globalConfig.environment || {}).length ? `${Object.keys(globalConfig.environment || {}).length} vars` : 'None'}
              onToggle={(enabled) => updateOverride('environment', enabled ? { ...(globalConfig.environment || {}) } : undefined)}
            >
              <EnvironmentEditor
                value={getValue('environment') || {}}
                onChange={(env) => updateOverride('environment', Object.keys(env).length > 0 ? env : undefined)}
              />
            </OverrideToggle>
          </div>
        </div>
      )}
    </div>
  );
};

// Common cipher/algorithm options
const CIPHER_OPTIONS = [
  'aes256-gcm@openssh.com',
  'chacha20-poly1305@openssh.com',
  'aes256-ctr',
  'aes192-ctr',
  'aes128-ctr',
  'aes256-cbc',
  'aes192-cbc',
  'aes128-cbc',
  '3des-cbc',
];

const MAC_OPTIONS = [
  'hmac-sha2-512-etm@openssh.com',
  'hmac-sha2-256-etm@openssh.com',
  'hmac-sha2-512',
  'hmac-sha2-256',
  'hmac-sha1',
  'hmac-md5',
];

const KEX_OPTIONS = [
  'curve25519-sha256',
  'curve25519-sha256@libssh.org',
  'ecdh-sha2-nistp521',
  'ecdh-sha2-nistp384',
  'ecdh-sha2-nistp256',
  'diffie-hellman-group18-sha512',
  'diffie-hellman-group16-sha512',
  'diffie-hellman-group14-sha256',
  'diffie-hellman-group14-sha1',
  'diffie-hellman-group-exchange-sha256',
];

const HOST_KEY_OPTIONS = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp521',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp256',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa',
  'ssh-dss',
];

interface OverrideToggleProps {
  label: string;
  isOverridden: boolean;
  globalValue: string;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

const OverrideToggle: React.FC<OverrideToggleProps> = ({
  label,
  isOverridden,
  globalValue,
  onToggle,
  children,
}) => {
  return (
    <div className="flex items-start gap-3">
      <label className="flex items-center gap-2 min-w-[140px]">
        <input
          type="checkbox"
          checked={isOverridden}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
        />
        <span className="text-sm text-[var(--color-textSecondary)]">{label}</span>
      </label>
      <div className="flex-1">
        {isOverridden ? (
          children
        ) : (
          <span className="text-sm text-gray-500 italic">
            Global: {globalValue}
          </span>
        )}
      </div>
    </div>
  );
};

interface AuthMethodSelectorProps {
  value: SSHAuthMethod[];
  onChange: (methods: SSHAuthMethod[]) => void;
}

const AuthMethodSelector: React.FC<AuthMethodSelectorProps> = ({ value, onChange }) => {
  const toggleMethod = (method: SSHAuthMethod) => {
    if (value.includes(method)) {
      onChange(value.filter(m => m !== method));
    } else {
      onChange([...value, method]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newValue = [...value];
    [newValue[index - 1], newValue[index]] = [newValue[index], newValue[index - 1]];
    onChange(newValue);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {SSHAuthMethods.map(method => (
          <label
            key={method}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
              value.includes(method)
                ? 'bg-green-600 text-[var(--color-text)]'
                : 'bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500'
            }`}
          >
            <input
              type="checkbox"
              checked={value.includes(method)}
              onChange={() => toggleMethod(method)}
              className="sr-only"
            />
            {method}
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-[var(--color-textSecondary)]">
          Order: {value.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => moveUp(i)}
              className="mx-0.5 px-1 py-0.5 bg-[var(--color-border)] rounded hover:bg-[var(--color-border)]"
              title="Click to move up"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface CipherSelectorProps {
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  options: string[];
}

const CipherSelector: React.FC<CipherSelectorProps> = ({ value, onChange, options }) => {
  const [showAll, setShowAll] = useState(false);

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter(v => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const visibleOptions = showAll ? options : options.slice(0, 4);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visibleOptions.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => toggleOption(option)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              value.includes(option)
                ? 'bg-blue-600 text-[var(--color-text)]'
                : 'bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500'
            }`}
          >
            {option.split('@')[0]}
          </button>
        ))}
        {options.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="px-2 py-0.5 text-xs bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded hover:bg-[var(--color-border)]"
          >
            {showAll ? 'Less...' : `+${options.length - 4} more...`}
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-gray-500">
          Selected: {value.length} (in order of preference)
        </div>
      )}
    </div>
  );
};

interface EnvironmentEditorProps {
  value: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}

const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({ value, onChange }) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const addVariable = () => {
    if (newKey && newValue) {
      onChange({ ...value, [newKey]: newValue });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeVariable = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  return (
    <div className="space-y-2">
      {Object.entries(value).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-green-400">{key}</code>
          <span className="text-gray-500">=</span>
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] flex-1 truncate">{val}</code>
          <button
            type="button"
            onClick={() => removeVariable(key)}
            className="p-1 text-red-400 hover:text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          className="w-24 px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
        />
        <span className="text-gray-500">=</span>
        <input
          type="text"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1 px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
        />
        <button
          type="button"
          onClick={addVariable}
          disabled={!newKey || !newValue}
          className="p-1 text-green-400 hover:text-green-300 disabled:text-gray-600"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SSHConnectionOverrides;
