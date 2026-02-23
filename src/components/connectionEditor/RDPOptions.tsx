import React, { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Volume2,
  Mouse,
  HardDrive,
  Gauge,
  Shield,
  Settings2,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Trash2,
  Pencil,
  ScanSearch,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Connection, DEFAULT_RDP_SETTINGS, RdpConnectionSettings } from '../../types/connection';
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

        <div>
          <label className="block text-xs text-gray-400 mb-1">Keyboard Layout</label>
          <div className="flex gap-2">
            <select
              value={rdp.input?.keyboardLayout ?? 0x0409}
              onChange={(e) => updateRdp('input', { keyboardLayout: parseInt(e.target.value) })}
              className={selectClass + ' flex-1'}
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
      </Section>

      {/* ─── Security ────────────────────────────────────────────── */}
      <Section title="Security" icon={<Shield size={14} className="text-red-400" />}>
        <label className={labelClass}>
          <input
            type="checkbox"
            checked={rdp.security?.enableNla ?? true}
            onChange={(e) => updateRdp('security', { enableNla: e.target.checked })}
            className={checkboxClass}
          />
          <span>Enable NLA (Network Level Authentication)</span>
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
    </div>
  );
};

export default RDPOptions;
