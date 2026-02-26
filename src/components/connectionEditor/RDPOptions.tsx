import React, { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Volume2,
  Mouse,
  HardDrive,
  Gauge,
  Shield,
  ShieldAlert,
  Settings2,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Trash2,
  Pencil,
  ScanSearch,
  Network,
  Server,
  Zap,
  ToggleLeft,
  Cable,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Connection, DEFAULT_RDP_SETTINGS, RdpConnectionSettings } from '../../types/connection';
import {
  CredsspOracleRemediationPolicies,
  NlaModes,
  TlsVersions,
  CredsspVersions,
  GatewayAuthMethods,
  GatewayCredentialSources,
  GatewayTransportModes,
  NegotiationStrategies,
} from '../../types/connection';
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from '../../utils/trustStore';

interface RDPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

// Collapsible section component
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-750 hover:bg-gray-700 transition-colors text-sm font-medium text-gray-200"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
      </button>
      {open && <div className="p-3 space-y-3 border-t border-gray-700">{children}</div>}
    </div>
  );
};

// Keyboard layout presets
const KEYBOARD_LAYOUTS: { label: string; value: number }[] = [
  { label: 'US English', value: 0x0409 },
  { label: 'UK English', value: 0x0809 },
  { label: 'German', value: 0x0407 },
  { label: 'French', value: 0x040c },
  { label: 'Spanish', value: 0x0c0a },
  { label: 'Italian', value: 0x0410 },
  { label: 'Portuguese (BR)', value: 0x0416 },
  { label: 'Japanese', value: 0x0411 },
  { label: 'Korean', value: 0x0412 },
  { label: 'Chinese (Simplified)', value: 0x0804 },
  { label: 'Chinese (Traditional)', value: 0x0404 },
  { label: 'Russian', value: 0x0419 },
  { label: 'Arabic', value: 0x0401 },
  { label: 'Hindi', value: 0x0439 },
  { label: 'Dutch', value: 0x0413 },
  { label: 'Swedish', value: 0x041d },
  { label: 'Norwegian', value: 0x0414 },
  { label: 'Danish', value: 0x0406 },
  { label: 'Finnish', value: 0x040b },
  { label: 'Polish', value: 0x0415 },
  { label: 'Czech', value: 0x0405 },
  { label: 'Turkish', value: 0x041f },
];

export const RDPOptions: React.FC<RDPOptionsProps> = ({ formData, setFormData }) => {
  const [rdpTrustRecords, setRdpTrustRecords] = useState<TrustRecord[]>([]);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [detectingLayout, setDetectingLayout] = useState(false);

  const detectKeyboardLayout = useCallback(async () => {
    setDetectingLayout(true);
    try {
      const layout = await invoke<number>('detect_keyboard_layout');
      const langId = layout & 0xffff;
      setFormData((prev) => ({
        ...prev,
        rdpSettings: {
          ...(prev.rdpSettings ?? DEFAULT_RDP_SETTINGS),
          input: {
            ...((prev.rdpSettings ?? DEFAULT_RDP_SETTINGS).input),
            keyboardLayout: langId,
          },
        },
      }));
    } catch {
      /* detection not available outside Tauri */
    } finally {
      setDetectingLayout(false);
    }
  }, [setFormData]);

  // Load trust records for RDP connections (uses TLS cert type)
  useEffect(() => {
    if (formData.isGroup || formData.protocol !== 'rdp') return;
    const loadRecords = () => {
      try {
        // Load from both per-connection store and global store
        const connRecords = formData.id ? getAllTrustRecords(formData.id) : [];
        const globalRecords = getAllTrustRecords();
        // Combine, preferring per-connection. Filter to TLS type (RDP uses TLS certs).
        const all = [...connRecords, ...globalRecords].filter((r) => r.type === 'tls');
        // Deduplicate by fingerprint
        const seen = new Set<string>();
        const deduped = all.filter((r) => {
          if (seen.has(r.identity.fingerprint)) return false;
          seen.add(r.identity.fingerprint);
          return true;
        });
        setRdpTrustRecords(deduped);
      } catch {
        /* ignore */
      }
    };
    loadRecords();
  }, [formData.isGroup, formData.protocol, formData.id]);

  if (formData.isGroup || formData.protocol !== 'rdp') return null;

  const rdp: RdpConnectionSettings = formData.rdpSettings ?? DEFAULT_RDP_SETTINGS;

  // Helper to update nested rdpSettings
  const updateRdp = <K extends keyof RdpConnectionSettings>(
    section: K,
    patch: Partial<NonNullable<RdpConnectionSettings[K]>>
  ) => {
    setFormData((prev) => ({
      ...prev,
      rdpSettings: {
        ...prev.rdpSettings,
        [section]: {
          ...(prev.rdpSettings?.[section] ?? (DEFAULT_RDP_SETTINGS[section] as Record<string, unknown>)),
          ...patch,
        },
      },
    }));
  };

  const handleRemoveTrust = (record: TrustRecord) => {
    try {
      const [host, portStr] = record.host.split(':');
      const port = parseInt(portStr, 10) || 3389;
      removeIdentity(host, port, 'tls', formData.id);
      // Also remove from global store
      removeIdentity(host, port, 'tls');
      setRdpTrustRecords((prev) => prev.filter((r) => r.identity.fingerprint !== record.identity.fingerprint));
    } catch {
      /* ignore */
    }
  };

  const handleClearAllRdpTrust = () => {
    try {
      if (formData.id) clearAllTrustRecords(formData.id);
      setRdpTrustRecords([]);
    } catch {
      /* ignore */
    }
  };

  const handleSaveNickname = (record: TrustRecord) => {
    try {
      const [host, portStr] = record.host.split(':');
      const port = parseInt(portStr, 10) || 3389;
      updateTrustRecordNickname(host, port, 'tls', nicknameInput, formData.id);
      setRdpTrustRecords((prev) =>
        prev.map((r) =>
          r.identity.fingerprint === record.identity.fingerprint ? { ...r, nickname: nicknameInput } : r
        )
      );
      setEditingNickname(null);
      setNicknameInput('');
    } catch {
      /* ignore */
    }
  };

  const hostRecords = rdpTrustRecords.filter((r) => {
    const expectedHost = `${formData.hostname}:${formData.port || 3389}`;
    return r.host === expectedHost;
  });

  const selectClass =
    'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const inputClass = selectClass;
  const checkboxClass = 'rounded border-gray-600 bg-gray-700 text-blue-600';
  const labelClass = 'flex items-center space-x-2 text-sm text-gray-300';

  return (
    <div className="space-y-3">
      {/* Domain */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Domain</label>
        <input
          type="text"
          value={formData.domain || ''}
          onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
          className={inputClass}
          placeholder="DOMAIN (optional)"
        />
      </div>

      {/* ─── Display ─────────────────────────────────────────────── */}
      <Section title="Display" icon={<Monitor size={14} className="text-blue-400" />} defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Width</label>
            <input
              type="number"
              value={rdp.display?.width ?? 1920}
              onChange={(e) => updateRdp('display', { width: parseInt(e.target.value) || 1920 })}
              className={inputClass}
              min={640}
              max={7680}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Height</label>
            <input
              type="number"
              value={rdp.display?.height ?? 1080}
              onChange={(e) => updateRdp('display', { height: parseInt(e.target.value) || 1080 })}
              className={inputClass}
              min={480}
              max={4320}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Color Depth</label>
          <select
            value={rdp.display?.colorDepth ?? 32}
            onChange={(e) => updateRdp('display', { colorDepth: parseInt(e.target.value) as 16 | 24 | 32 })}
            className={selectClass}
          >
            <option value={16}>16-bit (High Color)</option>
            <option value={24}>24-bit (True Color)</option>
            <option value={32}>32-bit (True Color + Alpha)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Desktop Scale Factor: {rdp.display?.desktopScaleFactor ?? 100}%
          </label>
          <input
            type="range"
            min={100}
            max={500}
            step={25}
            value={rdp.display?.desktopScaleFactor ?? 100}
            onChange={(e) => updateRdp('display', { desktopScaleFactor: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.display?.resizeToWindow ?? false}
            onChange={(e) => updateRdp('display', { resizeToWindow: e.target.checked })}
            className={checkboxClass}
          />
          <span>Resize to window (dynamic resolution)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.display?.smartSizing ?? true}
            onChange={(e) => updateRdp('display', { smartSizing: e.target.checked })}
            className={checkboxClass}
          />
          <span>Smart sizing (scale to fit)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.display?.lossyCompression ?? true}
            onChange={(e) => updateRdp('display', { lossyCompression: e.target.checked })}
            className={checkboxClass}
          />
          <span>Lossy bitmap compression</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.display?.magnifierEnabled ?? false}
            onChange={(e) => updateRdp('display', { magnifierEnabled: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable magnifier glass</span>
        </label>

        {rdp.display?.magnifierEnabled && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Magnifier Zoom: {rdp.display?.magnifierZoom ?? 3}x
            </label>
            <input
              type="range"
              min={2}
              max={8}
              step={1}
              value={rdp.display?.magnifierZoom ?? 3}
              onChange={(e) => updateRdp('display', { magnifierZoom: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        )}
      </Section>

      {/* ─── Audio ───────────────────────────────────────────────── */}
      <Section title="Audio" icon={<Volume2 size={14} className="text-green-400" />}>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Audio Playback</label>
          <select
            value={rdp.audio?.playbackMode ?? 'local'}
            onChange={(e) => updateRdp('audio', { playbackMode: e.target.value as 'local' | 'remote' | 'disabled' })}
            className={selectClass}
          >
            <option value="local">Play on this computer</option>
            <option value="remote">Play on remote computer</option>
            <option value="disabled">Do not play</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Audio Recording</label>
          <select
            value={rdp.audio?.recordingMode ?? 'disabled'}
            onChange={(e) => updateRdp('audio', { recordingMode: e.target.value as 'enabled' | 'disabled' })}
            className={selectClass}
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Record from this computer</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Audio Quality</label>
          <select
            value={rdp.audio?.audioQuality ?? 'dynamic'}
            onChange={(e) => updateRdp('audio', { audioQuality: e.target.value as 'dynamic' | 'medium' | 'high' })}
            className={selectClass}
          >
            <option value="dynamic">Dynamic (auto-adjust)</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </Section>

      {/* ─── Input ───────────────────────────────────────────────── */}
      <Section title="Input" icon={<Mouse size={14} className="text-yellow-400" />}>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Mouse Mode</label>
          <select
            value={rdp.input?.mouseMode ?? 'absolute'}
            onChange={(e) => updateRdp('input', { mouseMode: e.target.value as 'relative' | 'absolute' })}
            className={selectClass}
          >
            <option value="absolute">Absolute (real mouse position)</option>
            <option value="relative">Relative (virtual mouse delta)</option>
          </select>
        </div>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.input?.autoDetectLayout !== false}
            onChange={(e) => updateRdp('input', { autoDetectLayout: e.target.checked })}
            className={checkboxClass}
          />
          <span>Auto-detect keyboard layout on connect</span>
        </label>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Keyboard Layout {rdp.input?.autoDetectLayout !== false && <span className="text-blue-400">(overridden by auto-detect)</span>}
          </label>
          <div className="flex gap-2">
            <select
              value={rdp.input?.keyboardLayout ?? 0x0409}
              onChange={(e) => updateRdp('input', { keyboardLayout: parseInt(e.target.value) })}
              disabled={rdp.input?.autoDetectLayout !== false}
              className={selectClass + ' flex-1' + (rdp.input?.autoDetectLayout !== false ? ' opacity-50' : '')}
            >
              {KEYBOARD_LAYOUTS.map((kl) => (
                <option key={kl.value} value={kl.value}>
                  {kl.label} (0x{kl.value.toString(16).padStart(4, '0')})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={detectKeyboardLayout}
              disabled={detectingLayout}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 flex items-center gap-1 disabled:opacity-50"
              title="Auto-detect current keyboard layout"
            >
              <ScanSearch size={12} />
              {detectingLayout ? '...' : 'Detect'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Keyboard Type</label>
          <select
            value={rdp.input?.keyboardType ?? 'ibm-enhanced'}
            onChange={(e) => updateRdp('input', { keyboardType: e.target.value as 'ibm-enhanced' })}
            className={selectClass}
          >
            <option value="ibm-pc-xt">IBM PC/XT (83 key)</option>
            <option value="olivetti">Olivetti (102 key)</option>
            <option value="ibm-pc-at">IBM PC/AT (84 key)</option>
            <option value="ibm-enhanced">IBM Enhanced (101/102 key)</option>
            <option value="nokia1050">Nokia 1050</option>
            <option value="nokia9140">Nokia 9140</option>
            <option value="japanese">Japanese</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Input Priority</label>
          <select
            value={rdp.input?.inputPriority ?? 'realtime'}
            onChange={(e) => updateRdp('input', { inputPriority: e.target.value as 'realtime' | 'batched' })}
            className={selectClass}
          >
            <option value="realtime">Realtime (send immediately)</option>
            <option value="batched">Batched (group events)</option>
          </select>
        </div>

        {rdp.input?.inputPriority === 'batched' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Batch Interval: {rdp.input?.batchIntervalMs ?? 16}ms
            </label>
            <input
              type="range"
              min={8}
              max={100}
              step={4}
              value={rdp.input?.batchIntervalMs ?? 16}
              onChange={(e) => updateRdp('input', { batchIntervalMs: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        )}

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.input?.enableUnicodeInput ?? true}
            onChange={(e) => updateRdp('input', { enableUnicodeInput: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable Unicode keyboard input</span>
        </label>
      </Section>

      {/* ─── Device Redirection ──────────────────────────────────── */}
      <Section title="Local Resources" icon={<HardDrive size={14} className="text-purple-400" />}>
        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.clipboard ?? true}
            onChange={(e) => updateRdp('deviceRedirection', { clipboard: e.target.checked })}
            className={checkboxClass}
          />
          <span>Clipboard</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.printers ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { printers: e.target.checked })}
            className={checkboxClass}
          />
          <span>Printers</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.ports ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { ports: e.target.checked })}
            className={checkboxClass}
          />
          <span>Serial / COM Ports</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.smartCards ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { smartCards: e.target.checked })}
            className={checkboxClass}
          />
          <span>Smart Cards</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.webAuthn ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { webAuthn: e.target.checked })}
            className={checkboxClass}
          />
          <span>WebAuthn / FIDO Devices</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.videoCapture ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { videoCapture: e.target.checked })}
            className={checkboxClass}
          />
          <span>Video Capture (Cameras)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.audioInput ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { audioInput: e.target.checked })}
            className={checkboxClass}
          />
          <span>Audio Input (Microphone)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.deviceRedirection?.usbDevices ?? false}
            onChange={(e) => updateRdp('deviceRedirection', { usbDevices: e.target.checked })}
            className={checkboxClass}
          />
          <span>USB Devices</span>
        </label>
      </Section>

      {/* ─── Performance ─────────────────────────────────────────── */}
      <Section title="Performance" icon={<Gauge size={14} className="text-orange-400" />} defaultOpen>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Connection Speed</label>
          <select
            value={rdp.performance?.connectionSpeed ?? 'broadband-high'}
            onChange={(e) => {
              const speed = e.target.value as RdpConnectionSettings['performance'] extends { connectionSpeed?: infer T } ? T : never;
              // Apply presets based on connection speed
              const presets: Record<string, Partial<NonNullable<RdpConnectionSettings['performance']>>> = {
                'modem': {
                  disableWallpaper: true, disableFullWindowDrag: true, disableMenuAnimations: true,
                  disableTheming: true, disableCursorShadow: true, enableFontSmoothing: false,
                  enableDesktopComposition: false, targetFps: 15, frameBatchIntervalMs: 66,
                },
                'broadband-low': {
                  disableWallpaper: true, disableFullWindowDrag: true, disableMenuAnimations: true,
                  disableTheming: false, disableCursorShadow: true, enableFontSmoothing: true,
                  enableDesktopComposition: false, targetFps: 24, frameBatchIntervalMs: 42,
                },
                'broadband-high': {
                  disableWallpaper: true, disableFullWindowDrag: true, disableMenuAnimations: true,
                  disableTheming: false, disableCursorShadow: true, enableFontSmoothing: true,
                  enableDesktopComposition: false, targetFps: 30, frameBatchIntervalMs: 33,
                },
                'wan': {
                  disableWallpaper: false, disableFullWindowDrag: false, disableMenuAnimations: false,
                  disableTheming: false, disableCursorShadow: false, enableFontSmoothing: true,
                  enableDesktopComposition: true, targetFps: 60, frameBatchIntervalMs: 16,
                },
                'lan': {
                  disableWallpaper: false, disableFullWindowDrag: false, disableMenuAnimations: false,
                  disableTheming: false, disableCursorShadow: false, enableFontSmoothing: true,
                  enableDesktopComposition: true, targetFps: 60, frameBatchIntervalMs: 16,
                },
              };
              const preset = presets[speed as string];
              if (preset) {
                updateRdp('performance', { connectionSpeed: speed, ...preset });
              } else {
                updateRdp('performance', { connectionSpeed: speed });
              }
            }}
            className={selectClass}
          >
            <option value="modem">Modem (56 Kbps)</option>
            <option value="broadband-low">Broadband (Low)</option>
            <option value="broadband-high">Broadband (High)</option>
            <option value="wan">WAN</option>
            <option value="lan">LAN (10 Mbps+)</option>
            <option value="auto-detect">Auto-detect</option>
          </select>
        </div>

        <div className="text-xs text-gray-500 font-medium pt-1">Visual Experience</div>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableWallpaper ?? true}
            onChange={(e) => updateRdp('performance', { disableWallpaper: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable wallpaper</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableFullWindowDrag ?? true}
            onChange={(e) => updateRdp('performance', { disableFullWindowDrag: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable full-window drag</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableMenuAnimations ?? true}
            onChange={(e) => updateRdp('performance', { disableMenuAnimations: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable menu animations</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableTheming ?? false}
            onChange={(e) => updateRdp('performance', { disableTheming: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable visual themes</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableCursorShadow ?? true}
            onChange={(e) => updateRdp('performance', { disableCursorShadow: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable cursor shadow</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.disableCursorSettings ?? false}
            onChange={(e) => updateRdp('performance', { disableCursorSettings: e.target.checked })}
            className={checkboxClass}
          />
          <span>Disable cursor settings</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.enableFontSmoothing ?? true}
            onChange={(e) => updateRdp('performance', { enableFontSmoothing: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable font smoothing (ClearType)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.enableDesktopComposition ?? false}
            onChange={(e) => updateRdp('performance', { enableDesktopComposition: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable desktop composition (Aero)</span>
        </label>

        <div className="text-xs text-gray-500 font-medium pt-2">Render Backend</div>
        <p className="text-xs text-gray-500 mb-1">
          Controls how decoded RDP frames are displayed. Native renderers bypass JS entirely for lowest latency.
        </p>

        <div>
          <select
            value={rdp.performance?.renderBackend ?? 'softbuffer'}
            onChange={(e) => updateRdp('performance', { renderBackend: e.target.value as 'auto' | 'softbuffer' | 'wgpu' | 'webview' })}
            className={selectClass}
          >
            <option value="webview">Webview (JS Canvas) — default, most compatible</option>
            <option value="softbuffer">Softbuffer (CPU) — native Win32 child window, zero JS</option>
            <option value="wgpu">Wgpu (GPU) — DX12/Vulkan texture, best throughput</option>
            <option value="auto">Auto — try GPU → CPU → Webview</option>
          </select>
        </div>

        <div className="text-xs text-gray-500 font-medium pt-2">Frontend Renderer</div>
        <p className="text-xs text-gray-500 mb-1">
          Controls how RGBA frames are painted onto the canvas. WebGL/WebGPU use GPU texture upload for lower latency; OffscreenCanvas Worker moves rendering off the main thread.
        </p>

        <div>
          <select
            value={rdp.performance?.frontendRenderer ?? 'auto'}
            onChange={(e) => updateRdp('performance', { frontendRenderer: e.target.value as 'auto' | 'canvas2d' | 'webgl' | 'webgpu' | 'offscreen-worker' })}
            className={selectClass}
          >
            <option value="auto">Auto — best available (WebGPU → WebGL → Canvas 2D)</option>
            <option value="canvas2d">Canvas 2D — putImageData (baseline, always works)</option>
            <option value="webgl">WebGL — texSubImage2D (GPU texture upload)</option>
            <option value="webgpu">WebGPU — writeTexture (modern GPU API)</option>
            <option value="offscreen-worker">OffscreenCanvas Worker — off-main-thread rendering</option>
          </select>
        </div>

        <div className="text-xs text-gray-500 font-medium pt-2">Frame Delivery</div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Target FPS: {rdp.performance?.targetFps ?? 30}
          </label>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={rdp.performance?.targetFps ?? 30}
            onChange={(e) => updateRdp('performance', { targetFps: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>Unlimited</span>
            <span>60</span>
          </div>
        </div>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.frameBatching ?? true}
            onChange={(e) => updateRdp('performance', { frameBatching: e.target.checked })}
            className={checkboxClass}
          />
          <span>Frame batching (combine dirty regions)</span>
        </label>

        {rdp.performance?.frameBatching && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Batch Interval: {rdp.performance?.frameBatchIntervalMs ?? 33}ms
              ({Math.round(1000 / (rdp.performance?.frameBatchIntervalMs || 33))} fps max)
            </label>
            <input
              type="range"
              min={8}
              max={100}
              step={1}
              value={rdp.performance?.frameBatchIntervalMs ?? 33}
              onChange={(e) => updateRdp('performance', { frameBatchIntervalMs: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        )}

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.persistentBitmapCaching ?? false}
            onChange={(e) => updateRdp('performance', { persistentBitmapCaching: e.target.checked })}
            className={checkboxClass}
          />
          <span>Persistent bitmap caching</span>
        </label>

        {/* ─── Bitmap Codec Negotiation ─────────────────────────── */}
        <div className="text-xs text-gray-500 font-medium pt-2">Bitmap Codec Negotiation</div>
        <p className="text-xs text-gray-500 mb-1">
          Controls which bitmap compression codecs are advertised to the server during capability negotiation.
          When disabled, only raw/RLE bitmaps are used (higher bandwidth, lower CPU).
        </p>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.performance?.codecs?.enableCodecs ?? true}
            onChange={(e) => updateRdp('performance', {
              codecs: { ...rdp.performance?.codecs, enableCodecs: e.target.checked },
            })}
            className={checkboxClass}
          />
          <span className="font-medium">Enable bitmap codec negotiation</span>
        </label>

        {(rdp.performance?.codecs?.enableCodecs ?? true) && (
          <>
            <label className={`${labelClass} ml-4`}>
              <input
                type="checkbox"
                checked={rdp.performance?.codecs?.remoteFx ?? true}
                onChange={(e) => updateRdp('performance', {
                  codecs: { ...rdp.performance?.codecs, remoteFx: e.target.checked },
                })}
                className={checkboxClass}
              />
              <span>RemoteFX (RFX)</span>
              <span className="text-xs text-gray-500 ml-1">— DWT + RLGR entropy, best quality/compression</span>
            </label>

            {(rdp.performance?.codecs?.remoteFx ?? true) && (
              <div className="ml-8 flex items-center gap-2">
                <span className="text-xs text-gray-400">Entropy:</span>
                <select
                  value={rdp.performance?.codecs?.remoteFxEntropy ?? 'rlgr3'}
                  onChange={(e) => updateRdp('performance', {
                    codecs: { ...rdp.performance?.codecs, remoteFxEntropy: e.target.value as 'rlgr1' | 'rlgr3' },
                  })}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200"
                >
                  <option value="rlgr1">RLGR1 (faster decoding)</option>
                  <option value="rlgr3">RLGR3 (better compression)</option>
                </select>
              </div>
            )}

            <div className="border-t border-gray-700/50 pt-2 mt-2">
              <label className={`${labelClass}`}>
                <input
                  type="checkbox"
                  checked={rdp.performance?.codecs?.enableGfx ?? false}
                  onChange={(e) => updateRdp('performance', {
                    codecs: { ...rdp.performance?.codecs, enableGfx: e.target.checked },
                  })}
                  className={checkboxClass}
                />
                <span>RDPGFX (H.264 Hardware Decode)</span>
                <span className="text-xs text-gray-500 ml-1">— lowest bandwidth &amp; CPU via GPU decode</span>
              </label>

              {(rdp.performance?.codecs?.enableGfx ?? false) && (
                <div className="ml-8 flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">H.264 Decoder:</span>
                  <select
                    value={rdp.performance?.codecs?.h264Decoder ?? 'auto'}
                    onChange={(e) => updateRdp('performance', {
                      codecs: { ...rdp.performance?.codecs, h264Decoder: e.target.value as 'auto' | 'media-foundation' | 'openh264' },
                    })}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200"
                  >
                    <option value="auto">Auto (MF hardware → openh264 fallback)</option>
                    <option value="media-foundation">Media Foundation (GPU hardware)</option>
                    <option value="openh264">openh264 (software)</option>
                  </select>
                </div>
              )}
            </div>
          </>
        )}
      </Section>

      {/* ─── Security ────────────────────────────────────────────── */}
      <Section title="Security" icon={<Shield size={14} className="text-red-400" />}>
        {/* CredSSP Master Toggle */}
        <div className="pb-2 mb-2 border-b border-gray-700/60">
          <label className={labelClass}>
            <input
              type="checkbox"
              checked={rdp.security?.useCredSsp ?? true}
              onChange={(e) => updateRdp('security', { useCredSsp: e.target.checked })}
              className={checkboxClass}
            />
            <span className="font-medium">Use CredSSP</span>
          </label>
          <p className="text-xs text-gray-500 ml-5 mt-0.5">
            Master toggle – when disabled, CredSSP/NLA is entirely skipped (TLS-only or plain RDP).
          </p>
        </div>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.enableNla ?? true}
            onChange={(e) => updateRdp('security', { enableNla: e.target.checked })}
            className={checkboxClass}
            disabled={!(rdp.security?.useCredSsp ?? true)}
          />
          <span className={!(rdp.security?.useCredSsp ?? true) ? 'opacity-50' : ''}>Enable NLA (Network Level Authentication)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.enableTls ?? true}
            onChange={(e) => updateRdp('security', { enableTls: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable TLS (legacy graphical logon)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.autoLogon ?? false}
            onChange={(e) => updateRdp('security', { autoLogon: e.target.checked })}
            className={checkboxClass}
          />
          <span>Auto logon (send credentials in INFO packet)</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.enableServerPointer ?? true}
            onChange={(e) => updateRdp('security', { enableServerPointer: e.target.checked })}
            className={checkboxClass}
          />
          <span>Server-side pointer rendering</span>
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.pointerSoftwareRendering ?? true}
            onChange={(e) => updateRdp('security', { pointerSoftwareRendering: e.target.checked })}
            className={checkboxClass}
          />
          <span>Software pointer rendering</span>
        </label>

        {/* ─── CredSSP Remediation ───────────────────────────────── */}
        <div className="pt-3 mt-2 border-t border-gray-700/60">
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-300">
            <ShieldAlert size={14} className="text-amber-400" />
            <span className="font-medium">CredSSP Remediation</span>
            <span className="text-xs text-gray-500 ml-1">(CVE-2018-0886)</span>
          </div>

          <div className="space-y-3">
            {/* Oracle Remediation Policy */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Encryption Oracle Remediation Policy
              </label>
              <select
                value={rdp.security?.credsspOracleRemediation ?? ''}
                onChange={(e) =>
                  updateRdp('security', {
                    credsspOracleRemediation:
                      e.target.value === '' ? undefined : (e.target.value as typeof CredsspOracleRemediationPolicies[number]),
                  })
                }
                className={selectClass}
              >
                <option value="">Use global default</option>
                {CredsspOracleRemediationPolicies.map((p) => (
                  <option key={p} value={p}>
                    {p === 'force-updated'
                      ? 'Force Updated Clients'
                      : p === 'mitigated'
                        ? 'Mitigated (recommended)'
                        : 'Vulnerable (allow all)'}
                  </option>
                ))}
              </select>
            </div>

            {/* NLA Mode */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">NLA Mode</label>
              <select
                value={rdp.security?.enableNla === false ? 'disabled' : ''}
                onChange={(e) => {
                  const v = e.target.value as typeof NlaModes[number] | '';
                  if (v === '') {
                    // Use global default
                    updateRdp('security', { enableNla: undefined });
                  } else {
                    updateRdp('security', { enableNla: v !== 'disabled' });
                  }
                }}
                className={selectClass}
              >
                <option value="">Use global default</option>
                {NlaModes.map((m) => (
                  <option key={m} value={m}>
                    {m === 'required'
                      ? 'Required (reject if NLA unavailable)'
                      : m === 'preferred'
                        ? 'Preferred (fallback to TLS)'
                        : 'Disabled (TLS only)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Allow HYBRID_EX */}
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.security?.allowHybridEx ?? false}
                onChange={(e) => updateRdp('security', { allowHybridEx: e.target.checked })}
                className={checkboxClass}
              />
              <span>Allow HYBRID_EX protocol (Early User Auth Result)</span>
            </label>

            {/* NLA fallback to TLS */}
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.security?.nlaFallbackToTls ?? true}
                onChange={(e) => updateRdp('security', { nlaFallbackToTls: e.target.checked })}
                className={checkboxClass}
              />
              <span>Allow NLA fallback to TLS on failure</span>
            </label>

            {/* TLS Min Version */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Minimum TLS Version</label>
              <select
                value={rdp.security?.tlsMinVersion ?? ''}
                onChange={(e) =>
                  updateRdp('security', {
                    tlsMinVersion: e.target.value === '' ? undefined : (e.target.value as typeof TlsVersions[number]),
                  })
                }
                className={selectClass}
              >
                <option value="">Use global default</option>
                {TlsVersions.map((v) => (
                  <option key={v} value={v}>
                    TLS {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Authentication Packages */}
            <div className="space-y-1">
              <span className="block text-xs text-gray-400">Authentication Packages</span>
              <label className={labelClass}>
                <input
                  type="checkbox"
                  checked={rdp.security?.ntlmEnabled ?? true}
                  onChange={(e) => updateRdp('security', { ntlmEnabled: e.target.checked })}
                  className={checkboxClass}
                />
                <span>NTLM</span>
              </label>
              <label className={labelClass}>
                <input
                  type="checkbox"
                  checked={rdp.security?.kerberosEnabled ?? false}
                  onChange={(e) => updateRdp('security', { kerberosEnabled: e.target.checked })}
                  className={checkboxClass}
                />
                <span>Kerberos</span>
              </label>
              <label className={labelClass}>
                <input
                  type="checkbox"
                  checked={rdp.security?.pku2uEnabled ?? false}
                  onChange={(e) => updateRdp('security', { pku2uEnabled: e.target.checked })}
                  className={checkboxClass}
                />
                <span>PKU2U</span>
              </label>
            </div>

            {/* Restricted Admin / Remote Guard */}
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.security?.restrictedAdmin ?? false}
                onChange={(e) => updateRdp('security', { restrictedAdmin: e.target.checked })}
                className={checkboxClass}
              />
              <span>Restricted Admin (no credential delegation)</span>
            </label>

            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.security?.remoteCredentialGuard ?? false}
                onChange={(e) => updateRdp('security', { remoteCredentialGuard: e.target.checked })}
                className={checkboxClass}
              />
              <span>Remote Credential Guard</span>
            </label>

            {/* Server Public Key Validation */}
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.security?.enforceServerPublicKeyValidation ?? true}
                onChange={(e) => updateRdp('security', { enforceServerPublicKeyValidation: e.target.checked })}
                className={checkboxClass}
              />
              <span>Enforce server public key validation</span>
            </label>

            {/* CredSSP Version */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">CredSSP Version</label>
              <select
                value={rdp.security?.credsspVersion?.toString() ?? ''}
                onChange={(e) =>
                  updateRdp('security', {
                    credsspVersion: e.target.value === '' ? undefined : (parseInt(e.target.value) as typeof CredsspVersions[number]),
                  })
                }
                className={selectClass}
              >
                <option value="">Use global default</option>
                {CredsspVersions.map((v) => (
                  <option key={v} value={v.toString()}>
                    TSRequest v{v} {v === 6 ? '(latest, with nonce)' : v === 3 ? '(with client nonce)' : '(legacy)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Server Cert Validation */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Server Certificate Validation</label>
              <select
                value={rdp.security?.serverCertValidation ?? ''}
                onChange={(e) =>
                  updateRdp('security', {
                    serverCertValidation:
                      e.target.value === '' ? undefined : (e.target.value as 'validate' | 'warn' | 'ignore'),
                  })
                }
                className={selectClass}
              >
                <option value="">Use global default</option>
                <option value="validate">Validate (reject untrusted)</option>
                <option value="warn">Warn (prompt on untrusted)</option>
                <option value="ignore">Ignore (accept all)</option>
              </select>
            </div>

            {/* SSPI Package List Override */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                SSPI Package List Override
              </label>
              <input
                type="text"
                value={rdp.security?.sspiPackageList ?? ''}
                onChange={(e) => updateRdp('security', { sspiPackageList: e.target.value || undefined })}
                className={inputClass}
                placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
              />
            </div>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-xs text-gray-400 mb-1">
            Server Certificate Trust Policy
          </label>
          <select
            value={formData.rdpTrustPolicy ?? ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                rdpTrustPolicy:
                  e.target.value === ''
                    ? undefined
                    : (e.target.value as 'tofu' | 'always-ask' | 'always-trust' | 'strict'),
              })
            }
            className={selectClass}
          >
            <option value="">Use global default</option>
            <option value="tofu">Trust On First Use (TOFU)</option>
            <option value="always-ask">Always Ask</option>
            <option value="always-trust">Always Trust (skip verification)</option>
            <option value="strict">Strict (reject unless pre-approved)</option>
          </select>
        </div>

        {/* Trusted Certificates / Fingerprints */}
        {hostRecords.length > 0 && (
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Fingerprint size={12} />
                Trusted Certificates ({hostRecords.length})
              </span>
              <button
                type="button"
                onClick={handleClearAllRdpTrust}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Clear All
              </button>
            </div>
            <div className="space-y-2">
              {hostRecords.map((r) => (
                <div
                  key={r.identity.fingerprint}
                  className="bg-gray-900 rounded p-2 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 truncate max-w-[200px]" title={r.identity.fingerprint}>
                      {r.nickname || formatFingerprint(r.identity.fingerprint).slice(0, 32) + '…'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNickname(r.identity.fingerprint);
                          setNicknameInput(r.nickname || '');
                        }}
                        className="text-gray-500 hover:text-blue-400"
                        title="Edit nickname"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveTrust(r)}
                        className="text-gray-500 hover:text-red-400"
                        title="Remove trust"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {editingNickname === r.identity.fingerprint && (
                    <div className="mt-1 flex gap-1">
                      <input
                        type="text"
                        value={nicknameInput}
                        onChange={(e) => setNicknameInput(e.target.value)}
                        className="flex-1 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-white text-xs"
                        placeholder="Nickname"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveNickname(r)}
                        className="text-xs text-green-400 hover:text-green-300"
                      >
                        Save
                      </button>
                    </div>
                  )}
                  <div className="text-gray-600 mt-1">
                    First seen: {new Date(r.identity.firstSeen).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ─── RDP Gateway ─────────────────────────────────────────── */}
      <Section title="RDP Gateway" icon={<Network size={14} className="text-cyan-400" />}>
        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.gateway?.enabled ?? false}
            onChange={(e) => updateRdp('gateway', { enabled: e.target.checked })}
            className={checkboxClass}
          />
          <span className="font-medium">Enable RDP Gateway</span>
        </label>
        <p className="text-xs text-gray-500 ml-5 -mt-1">
          Tunnel the RDP session through an RD Gateway (HTTPS transport).
        </p>

        {(rdp.gateway?.enabled ?? false) && (
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Gateway Hostname</label>
              <input
                type="text"
                value={rdp.gateway?.hostname ?? ''}
                onChange={(e) => updateRdp('gateway', { hostname: e.target.value })}
                className={inputClass}
                placeholder="gateway.example.com"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Gateway Port: {rdp.gateway?.port ?? 443}
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={rdp.gateway?.port ?? 443}
                onChange={(e) => updateRdp('gateway', { port: parseInt(e.target.value) || 443 })}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Authentication Method</label>
              <select
                value={rdp.gateway?.authMethod ?? 'ntlm'}
                onChange={(e) =>
                  updateRdp('gateway', {
                    authMethod: e.target.value as typeof GatewayAuthMethods[number],
                  })
                }
                className={selectClass}
              >
                {GatewayAuthMethods.map((m) => (
                  <option key={m} value={m}>
                    {m === 'ntlm'
                      ? 'NTLM'
                      : m === 'basic'
                        ? 'Basic'
                        : m === 'digest'
                          ? 'Digest'
                          : m === 'negotiate'
                            ? 'Negotiate (Kerberos/NTLM)'
                            : 'Smart Card'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Credential Source</label>
              <select
                value={rdp.gateway?.credentialSource ?? 'same-as-connection'}
                onChange={(e) =>
                  updateRdp('gateway', {
                    credentialSource: e.target.value as typeof GatewayCredentialSources[number],
                  })
                }
                className={selectClass}
              >
                {GatewayCredentialSources.map((s) => (
                  <option key={s} value={s}>
                    {s === 'same-as-connection'
                      ? 'Same as connection'
                      : s === 'separate'
                        ? 'Separate credentials'
                        : 'Ask on connect'}
                  </option>
                ))}
              </select>
            </div>

            {rdp.gateway?.credentialSource === 'separate' && (
              <div className="space-y-2 pl-2 border-l-2 border-gray-700">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Gateway Username</label>
                  <input
                    type="text"
                    value={rdp.gateway?.username ?? ''}
                    onChange={(e) => updateRdp('gateway', { username: e.target.value })}
                    className={inputClass}
                    placeholder="DOMAIN\\user"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Gateway Password</label>
                  <input
                    type="password"
                    value={rdp.gateway?.password ?? ''}
                    onChange={(e) => updateRdp('gateway', { password: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Gateway Domain</label>
                  <input
                    type="text"
                    value={rdp.gateway?.domain ?? ''}
                    onChange={(e) => updateRdp('gateway', { domain: e.target.value })}
                    className={inputClass}
                    placeholder="DOMAIN"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">Transport Mode</label>
              <select
                value={rdp.gateway?.transportMode ?? 'auto'}
                onChange={(e) =>
                  updateRdp('gateway', {
                    transportMode: e.target.value as typeof GatewayTransportModes[number],
                  })
                }
                className={selectClass}
              >
                {GatewayTransportModes.map((m) => (
                  <option key={m} value={m}>
                    {m === 'auto' ? 'Auto' : m === 'http' ? 'HTTP' : 'UDP'}
                  </option>
                ))}
              </select>
            </div>

            <label className={labelClass}>
              <input
                type="checkbox"
                checked={rdp.gateway?.bypassForLocal ?? true}
                onChange={(e) => updateRdp('gateway', { bypassForLocal: e.target.checked })}
                className={checkboxClass}
              />
              <span>Bypass gateway for local addresses</span>
            </label>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Access Token (optional)</label>
              <input
                type="text"
                value={rdp.gateway?.accessToken ?? ''}
                onChange={(e) => updateRdp('gateway', { accessToken: e.target.value || undefined })}
                className={inputClass}
                placeholder="Azure AD / OAuth token"
              />
              <p className="text-xs text-gray-500 mt-0.5">For token-based gateway authentication (e.g. Azure AD).</p>
            </div>
          </div>
        )}
      </Section>

      {/* ─── Hyper-V / Enhanced Session ──────────────────────────── */}
      <Section title="Hyper-V / Enhanced Session" icon={<Server size={14} className="text-violet-400" />}>
        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.hyperv?.useVmId ?? false}
            onChange={(e) => updateRdp('hyperv', { useVmId: e.target.checked })}
            className={checkboxClass}
          />
          <span className="font-medium">Connect via VM ID</span>
        </label>
        <p className="text-xs text-gray-500 ml-5 -mt-1">
          Connect to a Hyper-V VM using its GUID instead of hostname.
        </p>

        {(rdp.hyperv?.useVmId ?? false) && (
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">VM ID (GUID)</label>
              <input
                type="text"
                value={rdp.hyperv?.vmId ?? ''}
                onChange={(e) => updateRdp('hyperv', { vmId: e.target.value })}
                className={inputClass}
                placeholder="12345678-abcd-1234-ef00-123456789abc"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hyper-V Host Server</label>
              <input
                type="text"
                value={rdp.hyperv?.hostServer ?? ''}
                onChange={(e) => updateRdp('hyperv', { hostServer: e.target.value })}
                className={inputClass}
                placeholder="hyperv-host.example.com"
              />
              <p className="text-xs text-gray-500 mt-0.5">The Hyper-V server hosting the VM.</p>
            </div>
          </div>
        )}

        <div className="pt-2 mt-2 border-t border-gray-700/60">
          <label className={labelClass}>
            <input
              type="checkbox"
              checked={rdp.hyperv?.enhancedSessionMode ?? false}
              onChange={(e) => updateRdp('hyperv', { enhancedSessionMode: e.target.checked })}
              className={checkboxClass}
            />
            <span>Enhanced Session Mode</span>
          </label>
          <p className="text-xs text-gray-500 ml-5 -mt-1">
            Uses VMBus channel for better performance, clipboard, drive redirection and audio in Hyper-V VMs.
          </p>
        </div>
      </Section>

      {/* ─── Connection Negotiation / Auto-detect ────────────────── */}
      <Section title="Connection Negotiation" icon={<Zap size={14} className="text-amber-400" />}>
        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.negotiation?.autoDetect ?? false}
            onChange={(e) => updateRdp('negotiation', { autoDetect: e.target.checked })}
            className={checkboxClass}
          />
          <span className="font-medium">Auto-detect negotiation</span>
        </label>
        <p className="text-xs text-gray-500 ml-5 -mt-1">
          Automatically try different protocol combinations (CredSSP, TLS, plain) until a working one is found.
        </p>

        {(rdp.negotiation?.autoDetect ?? false) && (
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Negotiation Strategy</label>
              <select
                value={rdp.negotiation?.strategy ?? 'nla-first'}
                onChange={(e) =>
                  updateRdp('negotiation', {
                    strategy: e.target.value as typeof NegotiationStrategies[number],
                  })
                }
                className={selectClass}
              >
                {NegotiationStrategies.map((s) => (
                  <option key={s} value={s}>
                    {s === 'auto'
                      ? 'Auto (try all combinations)'
                      : s === 'nla-first'
                        ? 'NLA First (CredSSP → TLS → Plain)'
                        : s === 'tls-first'
                          ? 'TLS First (TLS → CredSSP → Plain)'
                          : s === 'nla-only'
                            ? 'NLA Only (fail if unavailable)'
                            : s === 'tls-only'
                              ? 'TLS Only (no CredSSP)'
                              : 'Plain Only (no security — DANGEROUS)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Max Retries: {rdp.negotiation?.maxRetries ?? 3}
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={rdp.negotiation?.maxRetries ?? 3}
                onChange={(e) => updateRdp('negotiation', { maxRetries: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-600">
                <span>1</span>
                <span>10</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Retry Delay: {rdp.negotiation?.retryDelayMs ?? 1000}ms
              </label>
              <input
                type="range"
                min={100}
                max={5000}
                step={100}
                value={rdp.negotiation?.retryDelayMs ?? 1000}
                onChange={(e) => updateRdp('negotiation', { retryDelayMs: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-600">
                <span>100ms</span>
                <span>5000ms</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── Load Balancing ────────────────────────────────────── */}
        <div className="pt-3 mt-2 border-t border-gray-700/60">
          <div className="flex items-center gap-2 mb-2 text-sm text-gray-300">
            <ToggleLeft size={14} className="text-blue-400" />
            <span className="font-medium">Load Balancing</span>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Load Balancing Info</label>
            <input
              type="text"
              value={rdp.negotiation?.loadBalancingInfo ?? ''}
              onChange={(e) => updateRdp('negotiation', { loadBalancingInfo: e.target.value })}
              className={inputClass}
              placeholder="e.g. tsv://MS Terminal Services Plugin.1.Farm1"
            />
            <p className="text-xs text-gray-500 mt-0.5">
              Sent during X.224 negotiation for RDP load balancers / Session Brokers.
            </p>
          </div>

          <label className={`${labelClass} mt-2`}>
            <input
              type="checkbox"
              checked={rdp.negotiation?.useRoutingToken ?? false}
              onChange={(e) => updateRdp('negotiation', { useRoutingToken: e.target.checked })}
              className={checkboxClass}
            />
            <span>Use routing token format (instead of cookie)</span>
          </label>
        </div>
      </Section>

      {/* ─── Advanced ────────────────────────────────────────────── */}
      <Section title="Advanced" icon={<Settings2 size={14} className="text-gray-400" />}>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Client Name</label>
          <input
            type="text"
            value={rdp.advanced?.clientName ?? 'SortOfRemoteNG'}
            onChange={(e) => updateRdp('advanced', { clientName: e.target.value.slice(0, 15) })}
            className={inputClass}
            maxLength={15}
            placeholder="SortOfRemoteNG"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Read Timeout: {rdp.advanced?.readTimeoutMs ?? 16}ms
          </label>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={rdp.advanced?.readTimeoutMs ?? 16}
            onChange={(e) => updateRdp('advanced', { readTimeoutMs: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>1ms (fast)</span>
            <span>100ms (low CPU)</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Full-frame Sync Interval: every {rdp.advanced?.fullFrameSyncInterval ?? 300} frames
          </label>
          <input
            type="range"
            min={60}
            max={600}
            step={30}
            value={rdp.advanced?.fullFrameSyncInterval ?? 300}
            onChange={(e) =>
              updateRdp('advanced', { fullFrameSyncInterval: parseInt(e.target.value) })
            }
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Max Consecutive Errors: {rdp.advanced?.maxConsecutiveErrors ?? 50}
          </label>
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={rdp.advanced?.maxConsecutiveErrors ?? 50}
            onChange={(e) =>
              updateRdp('advanced', { maxConsecutiveErrors: parseInt(e.target.value) })
            }
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Stats Interval: {rdp.advanced?.statsIntervalSecs ?? 1}s
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rdp.advanced?.statsIntervalSecs ?? 1}
            onChange={(e) =>
              updateRdp('advanced', { statsIntervalSecs: parseInt(e.target.value) })
            }
            className="w-full"
          />
        </div>
      </Section>

      {/* ─── TCP / Socket ────────────────────────────────────────── */}
      <Section title="TCP / Socket" icon={<Cable size={14} className="text-emerald-400" />}>
        <p className="text-xs text-gray-500 mb-3">
          Low-level socket options for the underlying TCP connection.
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Connect Timeout: {rdp.tcp?.connectTimeoutSecs ?? 10}s
          </label>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={rdp.tcp?.connectTimeoutSecs ?? 10}
            onChange={(e) => updateRdp('tcp', { connectTimeoutSecs: parseInt(e.target.value) })}
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
            checked={rdp.tcp?.nodelay ?? true}
            onChange={(e) => updateRdp('tcp', { nodelay: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
            TCP_NODELAY (disable Nagle&apos;s algorithm)
          </span>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={rdp.tcp?.keepAlive ?? true}
            onChange={(e) => updateRdp('tcp', { keepAlive: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
            TCP Keep-Alive
          </span>
        </label>

        {(rdp.tcp?.keepAlive ?? true) && (
          <div className="ml-6">
            <label className="block text-xs text-gray-400 mb-1">
              Keep-Alive Interval: {rdp.tcp?.keepAliveIntervalSecs ?? 60}s
            </label>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={rdp.tcp?.keepAliveIntervalSecs ?? 60}
              onChange={(e) => updateRdp('tcp', { keepAliveIntervalSecs: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Recv Buffer</label>
            <select
              value={rdp.tcp?.recvBufferSize ?? 262144}
              onChange={(e) => updateRdp('tcp', { recvBufferSize: parseInt(e.target.value) })}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            >
              <option value={65536}>64 KB</option>
              <option value={131072}>128 KB</option>
              <option value={262144}>256 KB</option>
              <option value={524288}>512 KB</option>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Send Buffer</label>
            <select
              value={rdp.tcp?.sendBufferSize ?? 262144}
              onChange={(e) => updateRdp('tcp', { sendBufferSize: parseInt(e.target.value) })}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            >
              <option value={65536}>64 KB</option>
              <option value={131072}>128 KB</option>
              <option value={262144}>256 KB</option>
              <option value={524288}>512 KB</option>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
            </select>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default RDPOptions;
