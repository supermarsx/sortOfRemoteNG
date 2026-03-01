import React from 'react';
import {
  X, Power, Clock, Search, RefreshCw, Send,
  AlertCircle, CheckCircle, Cpu, Globe, Building2,
  Database, Loader2, CheckSquare, Square, Zap, Calendar,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { WakeScheduleManager } from './WakeScheduleManager';
import { useWOLQuickTool, type WOLQuickToolMgr } from '../hooks/network/useWOLQuickTool';

interface WOLQuickToolProps {
  isOpen: boolean;
  onClose: () => void;
}

interface WolDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  last_seen: string | null;
  vendor?: string | null;
  vendorSource?: 'local' | 'maclookup' | 'macvendors' | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function getVendorSourceIcon(source: string | null | undefined) {
  switch (source) {
    case 'local':
      return (
        <span title="Local database">
          <Database size={10} className="text-blue-400" />
        </span>
      );
    case 'maclookup':
    case 'macvendors':
      return (
        <span title="Online lookup">
          <Globe size={10} className="text-green-400" />
        </span>
      );
    default:
      return null;
  }
}

// ── Sub-components ─────────────────────────────────────────────────

function WOLHeader({ mgr }: { mgr: WOLQuickToolMgr }) {
  const { t } = useTranslation();
  return (
    <div className="relative z-10 flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-green-500/20 rounded-lg">
          <Power size={20} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            {t('wake.quickTool', 'Wake-on-LAN')}
          </h2>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Send magic packets to wake network devices
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => mgr.setShowScheduleManager(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] btn-animate"
          title={t('wake.scheduleWake', 'Schedule Wake')}
        >
          <Calendar size={16} />
          <span className="text-sm">{t('wake.schedules', 'Schedules')}</span>
        </button>
        <button
          onClick={mgr.onClose}
          className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] btn-animate"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

function QuickWakeSection({ mgr }: { mgr: WOLQuickToolMgr }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 flex-shrink-0">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        {t('wake.macAddress', 'MAC Address')}
      </label>
      <div className="flex space-x-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={mgr.macAddress}
            onChange={mgr.handleMacChange}
            placeholder="00:11:22:33:44:55"
            className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all font-mono text-lg"
          />
          {mgr.currentVendor && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 bg-[var(--color-surfaceHover)] rounded text-xs text-[var(--color-textSecondary)]">
              <Building2 size={12} className="text-green-500" />
              <span>{mgr.currentVendor}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => mgr.handleWake()}
          disabled={!mgr.macAddress}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-all flex items-center space-x-2 font-medium btn-animate shadow-lg shadow-green-500/20 disabled:shadow-none"
        >
          <Send size={18} />
          <span>{t('wake.send', 'Wake')}</span>
        </button>
      </div>
    </div>
  );
}

function AdvancedOptions({ mgr }: { mgr: WOLQuickToolMgr }) {
  const { t } = useTranslation();
  return (
    <details className="group flex-shrink-0">
      <summary className="text-sm text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] flex items-center gap-2 transition-colors">
        <Cpu size={14} />
        {t('wake.advancedOptions', 'Advanced Options')}
      </summary>
      <div className="mt-4 grid grid-cols-2 gap-4 p-4 bg-[var(--color-surfaceHover)]/30 rounded-lg border border-[var(--color-border)] animate-fade-in">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-2">
            {t('wake.broadcastAddress', 'Broadcast Address')}
          </label>
          <input
            type="text"
            value={mgr.broadcastAddress}
            onChange={(e) => mgr.setBroadcastAddress(e.target.value)}
            placeholder="255.255.255.255"
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-2">
            {t('wake.port', 'UDP Port')}
          </label>
          <input
            type="number"
            value={mgr.port}
            onChange={(e) => mgr.setPort(parseInt(e.target.value) || 9)}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          />
        </div>
        <div className="col-span-2">
          <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={mgr.useSecureOn}
              onChange={(e) => mgr.setUseSecureOn(e.target.checked)}
              className="rounded bg-[var(--color-input)] border-[var(--color-border)] text-green-500 focus:ring-green-500"
            />
            <span>{t('wake.secureOn', 'SecureOn Password')}</span>
          </label>
          {mgr.useSecureOn && (
            <input
              type="text"
              value={mgr.password}
              onChange={mgr.handlePasswordChange}
              placeholder="00:00:00:00:00:00"
              className="mt-2 w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-green-500 transition-all animate-fade-in"
            />
          )}
        </div>
      </div>
    </details>
  );
}

function StatusMessage({ mgr }: { mgr: WOLQuickToolMgr }) {
  if (!mgr.status.type) return null;
  return (
    <div
      className={`flex items-center space-x-3 p-4 rounded-lg animate-fade-in-up ${
        mgr.status.type === 'success'
          ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30'
          : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
      }`}
    >
      {mgr.status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <span className="text-sm font-medium">{mgr.status.message}</span>
    </div>
  );
}

function RecentMacs({ mgr }: { mgr: WOLQuickToolMgr }) {
  const { t } = useTranslation();
  if (mgr.recentMacs.length === 0) return null;
  return (
    <div className="animate-fade-in flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
          <Clock size={14} className="text-[var(--color-textMuted)]" />
          {t('wake.recent', 'Recent')}
        </label>
      </div>
      <div className="sor-chip-list">
        {mgr.recentMacs.map((mac, idx) => (
          <button
            key={idx}
            onClick={() => mgr.setMacAddress(mac)}
            className="sor-chip-button text-xs font-mono btn-animate"
          >
            {mac}
          </button>
        ))}
      </div>
    </div>
  );
}

function DeviceListToolbar({ mgr }: { mgr: WOLQuickToolMgr }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between mb-3">
      <label className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
        <Search size={14} className="text-[var(--color-textMuted)]" />
        {t('wake.networkDevices', 'Network Devices')}
        {mgr.devices.length > 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">({mgr.devices.length})</span>
        )}
        {mgr.isLookingUp && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
            <Loader2 size={10} className="animate-spin" />
            Looking up vendors...
          </span>
        )}
      </label>
      <div className="flex items-center gap-2">
        {mgr.devices.length > 0 && (
          <>
            <button
              onClick={mgr.toggleSelectAll}
              className="sor-option-chip text-xs btn-animate"
              title={
                mgr.selectedDevices.size === mgr.devices.length ? 'Deselect all' : 'Select all'
              }
            >
              {mgr.selectedDevices.size === mgr.devices.length ? (
                <CheckSquare size={12} />
              ) : (
                <Square size={12} />
              )}
              <span>
                {mgr.selectedDevices.size === mgr.devices.length
                  ? t('wake.deselectAll', 'Deselect All')
                  : t('wake.selectAll', 'Select All')}
              </span>
            </button>
            {mgr.selectedDevices.size > 0 && (
              <button
                onClick={mgr.handleBulkWake}
                disabled={mgr.isBulkWaking}
                className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-lg transition-all flex items-center space-x-2 btn-animate shadow-md shadow-green-500/20 disabled:shadow-none"
              >
                {mgr.isBulkWaking ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                <span>
                  {t('wake.wakeSelected', 'Wake Selected')} ({mgr.selectedDevices.size})
                </span>
              </button>
            )}
            <button
              onClick={mgr.handleWakeAll}
              disabled={mgr.isBulkWaking}
              className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-lg transition-all flex items-center space-x-2 btn-animate shadow-md shadow-amber-500/20 disabled:shadow-none"
              title="Wake all discovered devices"
            >
              {mgr.isBulkWaking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
              <span>{t('wake.wakeAll', 'Wake All')}</span>
            </button>
          </>
        )}
        <button
          onClick={mgr.handleScan}
          disabled={mgr.isScanning}
          className="sor-option-chip text-xs btn-animate"
        >
          <RefreshCw size={12} className={mgr.isScanning ? 'animate-spin' : ''} />
          <span>
            {mgr.isScanning
              ? t('wake.scanning', 'Scanning...')
              : t('wake.scan', 'Scan ARP')}
          </span>
        </button>
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  idx,
  mgr,
}: {
  device: WolDevice;
  idx: number;
  mgr: WOLQuickToolMgr;
}) {
  return (
    <div
      onClick={() => mgr.handleSelectDevice(device)}
      className={`sor-selection-row group animate-fade-in-up card-hover-effect ${
        mgr.selectedDevices.has(device.mac)
          ? 'sor-selection-row-selected bg-green-500/10 border-green-500/40 hover:bg-green-500/15'
          : 'bg-[var(--color-surfaceHover)]/30 hover:bg-[var(--color-surfaceHover)]/50'
      }`}
      style={{ animationDelay: `${idx * 50}ms` }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            mgr.toggleDeviceSelection(device.mac);
          }}
          className={`p-1 rounded transition-colors ${
            mgr.selectedDevices.has(device.mac)
              ? 'text-green-500 hover:text-green-400'
              : 'text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]'
          }`}
        >
          {mgr.selectedDevices.has(device.mac) ? (
            <CheckSquare size={18} />
          ) : (
            <Square size={18} />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-text)] font-mono">{device.mac}</span>
            {device.vendor && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-[var(--color-surfaceHover)] rounded text-xs text-[var(--color-textSecondary)]">
                {getVendorSourceIcon(device.vendorSource)}
                <Building2 size={10} />
                {device.vendor}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--color-textMuted)] mt-1 flex items-center gap-2">
            <span>{device.ip}</span>
            {device.hostname && (
              <>
                <span className="text-[var(--color-border)]">•</span>
                <span className="text-[var(--color-textMuted)]">{device.hostname}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          mgr.handleWake(device.mac);
        }}
        className="sor-selection-row-hover-action ml-3 p-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-lg transition-all btn-animate shadow-lg shadow-green-500/20"
        title="Wake this device"
      >
        <Power size={16} />
      </button>
    </div>
  );
}

function DeviceList({ mgr }: { mgr: WOLQuickToolMgr }) {
  return (
    <div className="animate-fade-in flex-1 min-h-0 flex flex-col">
      <DeviceListToolbar mgr={mgr} />
      {mgr.devices.length > 0 && (
        <div className="sor-selection-list flex-1 min-h-0 overflow-y-auto stagger-animate">
          {mgr.devices.map((device, idx) => (
            <DeviceRow key={idx} device={device} idx={idx} mgr={mgr} />
          ))}
        </div>
      )}
      {mgr.devices.length === 0 && !mgr.isScanning && (
        <div className="text-center py-8 text-[var(--color-textMuted)]">
          <Search size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">Click "Scan ARP" to discover devices on your network</p>
        </div>
      )}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────

export const WOLQuickTool: React.FC<WOLQuickToolProps> = ({ isOpen, onClose }) => {
  const mgr = useWOLQuickTool(onClose);

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="relative max-w-2xl rounded-xl overflow-hidden border border-[var(--color-border)] shadow-2xl resize-y min-h-[400px] h-[85vh]"
        contentClassName="relative bg-[var(--color-surface)] modal-content-animate"
      >
        {/* Scattered glow effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[250px] h-[180px] bg-green-500/8 rounded-full blur-[100px] top-[20%] left-[15%]" />
          <div className="absolute w-[200px] h-[200px] bg-emerald-500/6 rounded-full blur-[120px] top-[45%] left-[40%]" />
          <div className="absolute w-[220px] h-[150px] bg-teal-500/6 rounded-full blur-[90px] top-[65%] right-[20%]" />
        </div>

        <WOLHeader mgr={mgr} />

        <div
          className="relative z-10 p-5 space-y-5 overflow-y-auto flex flex-col bg-[var(--color-surface)]"
          style={{ height: 'calc(100% - 80px)' }}
        >
          <QuickWakeSection mgr={mgr} />
          <AdvancedOptions mgr={mgr} />
          <StatusMessage mgr={mgr} />
          <RecentMacs mgr={mgr} />
          <DeviceList mgr={mgr} />
        </div>
      </Modal>

      <WakeScheduleManager
        isOpen={mgr.showScheduleManager}
        onClose={() => mgr.setShowScheduleManager(false)}
      />
    </>
  );
};
