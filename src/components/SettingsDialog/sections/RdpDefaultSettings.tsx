import React from 'react';
import { GlobalSettings } from '../../../types/settings';
import {
  Shield,
  Network,
  Server,
  Zap,
  Monitor,
  Cable,
} from 'lucide-react';

interface RdpDefaultSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const selectClass =
  'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm';
const inputClass =
  'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm';

export const RdpDefaultSettings: React.FC<RdpDefaultSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const rdp = settings.rdpDefaults ?? ({} as GlobalSettings['rdpDefaults']);

  const update = (patch: Partial<GlobalSettings['rdpDefaults']>) => {
    updateSettings({ rdpDefaults: { ...rdp, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">RDP</h3>
        <p className="text-sm text-gray-400">
          Default configuration applied to all new RDP connections. Individual connections can
          override these settings.
        </p>
      </div>

      {/* ─── Security Defaults ─────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-400" />
          Security Defaults
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.useCredSsp ?? true}
            onChange={(e) => update({ useCredSsp: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors font-medium">
            Use CredSSP
          </span>
        </label>
        <p className="text-xs text-gray-500 ml-7 -mt-2">
          Master toggle – when disabled, CredSSP is entirely skipped for new connections.
        </p>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.enableTls ?? true}
            onChange={(e) => update({ enableTls: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Enable TLS
          </span>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.enableNla ?? true}
            onChange={(e) => update({ enableNla: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
            disabled={!(rdp.useCredSsp ?? true)}
          />
          <span
            className={`text-sm transition-colors ${
              !(rdp.useCredSsp ?? true) ? 'text-gray-600' : 'text-gray-300 group-hover:text-white'
            }`}
          >
            Enable NLA (Network Level Authentication)
          </span>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.autoLogon ?? false}
            onChange={(e) => update({ autoLogon: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Auto logon (send credentials in INFO packet)
          </span>
        </label>
      </div>

      {/* ─── Display Defaults ──────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Monitor className="w-4 h-4 text-blue-400" />
          Display Defaults
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Default Width</label>
            <input
              type="number"
              min={640}
              max={7680}
              value={rdp.defaultWidth ?? 1920}
              onChange={(e) => update({ defaultWidth: parseInt(e.target.value) || 1920 })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Default Height</label>
            <input
              type="number"
              min={480}
              max={4320}
              value={rdp.defaultHeight ?? 1080}
              onChange={(e) => update({ defaultHeight: parseInt(e.target.value) || 1080 })}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Default Color Depth</label>
          <select
            value={rdp.defaultColorDepth ?? 32}
            onChange={(e) =>
              update({ defaultColorDepth: parseInt(e.target.value) as 16 | 24 | 32 })
            }
            className={selectClass}
          >
            <option value={16}>16-bit (High Color)</option>
            <option value={24}>24-bit (True Color)</option>
            <option value={32}>32-bit (True Color + Alpha)</option>
          </select>
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.smartSizing ?? true}
            onChange={(e) => update({ smartSizing: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Smart Sizing (scale remote desktop to fit window)
          </span>
        </label>
      </div>

      {/* ─── Gateway Defaults ──────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" />
          RDP Gateway Defaults
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.gatewayEnabled ?? false}
            onChange={(e) => update({ gatewayEnabled: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Enable RDP Gateway by default
          </span>
        </label>

        {(rdp.gatewayEnabled ?? false) && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Default Gateway Hostname</label>
              <input
                type="text"
                value={rdp.gatewayHostname ?? ''}
                onChange={(e) => update({ gatewayHostname: e.target.value })}
                className={inputClass}
                placeholder="gateway.example.com"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Default Gateway Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={rdp.gatewayPort ?? 443}
                onChange={(e) => update({ gatewayPort: parseInt(e.target.value) || 443 })}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Authentication Method</label>
              <select
                value={rdp.gatewayAuthMethod ?? 'ntlm'}
                onChange={(e) =>
                  update({
                    gatewayAuthMethod: e.target.value as GlobalSettings['rdpDefaults']['gatewayAuthMethod'],
                  })
                }
                className={selectClass}
              >
                <option value="ntlm">NTLM</option>
                <option value="basic">Basic</option>
                <option value="digest">Digest</option>
                <option value="negotiate">Negotiate (Kerberos/NTLM)</option>
                <option value="smartcard">Smart Card</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Transport Mode</label>
              <select
                value={rdp.gatewayTransportMode ?? 'auto'}
                onChange={(e) =>
                  update({
                    gatewayTransportMode: e.target.value as GlobalSettings['rdpDefaults']['gatewayTransportMode'],
                  })
                }
                className={selectClass}
              >
                <option value="auto">Auto</option>
                <option value="http">HTTP</option>
                <option value="udp">UDP</option>
              </select>
            </div>

            <label className="flex items-center space-x-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={rdp.gatewayBypassLocal ?? true}
                onChange={(e) => update({ gatewayBypassLocal: e.target.checked })}
                className="rounded border-gray-600 bg-gray-700 text-blue-600"
              />
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                Bypass gateway for local addresses
              </span>
            </label>
          </div>
        )}
      </div>

      {/* ─── Hyper-V Defaults ──────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Server className="w-4 h-4 text-violet-400" />
          Hyper-V Defaults
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.enhancedSessionMode ?? false}
            onChange={(e) => update({ enhancedSessionMode: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Use Enhanced Session Mode by default
          </span>
        </label>
        <p className="text-xs text-gray-500 ml-7 -mt-2">
          Enhanced Session Mode enables clipboard, drive redirection and better audio in Hyper-V VMs.
        </p>
      </div>

      {/* ─── Negotiation Defaults ──────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          Connection Negotiation Defaults
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.autoDetect ?? false}
            onChange={(e) => update({ autoDetect: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            Enable auto-detect negotiation by default
          </span>
        </label>
        <p className="text-xs text-gray-500 ml-7 -mt-2">
          Automatically tries different protocol combinations until a working one is found.
        </p>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Default Strategy</label>
          <select
            value={rdp.negotiationStrategy ?? 'nla-first'}
            onChange={(e) =>
              update({
                negotiationStrategy: e.target.value as GlobalSettings['rdpDefaults']['negotiationStrategy'],
              })
            }
            className={selectClass}
          >
            <option value="auto">Auto (try all combinations)</option>
            <option value="nla-first">NLA First (CredSSP → TLS → Plain)</option>
            <option value="tls-first">TLS First (TLS → CredSSP → Plain)</option>
            <option value="nla-only">NLA Only</option>
            <option value="tls-only">TLS Only</option>
            <option value="plain-only">Plain Only (DANGEROUS)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Max Retries: {rdp.maxRetries ?? 3}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rdp.maxRetries ?? 3}
            onChange={(e) => update({ maxRetries: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>1</span>
            <span>10</span>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Retry Delay: {rdp.retryDelayMs ?? 1000}ms
          </label>
          <input
            type="range"
            min={100}
            max={5000}
            step={100}
            value={rdp.retryDelayMs ?? 1000}
            onChange={(e) => update({ retryDelayMs: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>100ms</span>
            <span>5000ms</span>
          </div>
        </div>
      </div>

      {/* ─── TCP / Socket Defaults ─────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Cable className="w-4 h-4 text-emerald-400" />
          TCP / Socket Defaults
        </h4>
        <p className="text-xs text-gray-500">
          Low-level socket settings applied during the TCP connection phase. Incorrect values may cause connectivity issues.
        </p>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Connect Timeout: {rdp.tcpConnectTimeoutSecs ?? 10}s
          </label>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={rdp.tcpConnectTimeoutSecs ?? 10}
            onChange={(e) => update({ tcpConnectTimeoutSecs: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>1s</span>
            <span>60s</span>
          </div>
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.tcpNodelay ?? true}
            onChange={(e) => update({ tcpNodelay: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            TCP_NODELAY (disable Nagle&apos;s algorithm)
          </span>
        </label>
        <p className="text-xs text-gray-500 ml-7 -mt-2">
          Reduces latency for interactive sessions. Recommended ON.
        </p>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.tcpKeepAlive ?? true}
            onChange={(e) => update({ tcpKeepAlive: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
            TCP Keep-Alive
          </span>
        </label>

        {(rdp.tcpKeepAlive ?? true) && (
          <div className="ml-7">
            <label className="block text-sm text-gray-400 mb-1">
              Keep-Alive Interval: {rdp.tcpKeepAliveIntervalSecs ?? 60}s
            </label>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={rdp.tcpKeepAliveIntervalSecs ?? 60}
              onChange={(e) => update({ tcpKeepAliveIntervalSecs: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>5s</span>
              <span>300s</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Receive Buffer (bytes)</label>
            <select
              value={rdp.tcpRecvBufferSize ?? 262144}
              onChange={(e) => update({ tcpRecvBufferSize: parseInt(e.target.value) })}
              className={selectClass}
            >
              <option value={65536}>64 KB</option>
              <option value={131072}>128 KB</option>
              <option value={262144}>256 KB (default)</option>
              <option value={524288}>512 KB</option>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Send Buffer (bytes)</label>
            <select
              value={rdp.tcpSendBufferSize ?? 262144}
              onChange={(e) => update({ tcpSendBufferSize: parseInt(e.target.value) })}
              className={selectClass}
            >
              <option value={65536}>64 KB</option>
              <option value={131072}>128 KB</option>
              <option value={262144}>256 KB (default)</option>
              <option value={524288}>512 KB</option>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RdpDefaultSettings;
