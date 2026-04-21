import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Container,
  LayoutDashboard,
  Box,
  HardDrive,
  Database,
  Network,
  Layers,
  X,
  RefreshCw,
  Play,
  Square,
  RotateCcw,
  Pause,
  Trash2,
  Download,
  Plus,
  Search,
  FileText,
  Info,
  ArrowUpCircle,
  ArrowDownCircle,
  Cpu,
  MemoryStick,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { useDocker, type DockerTab } from '../../hooks/protocol/useDocker';
import { Modal, ModalBody, ModalHeader } from '../ui/overlays/Modal';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';
import { EmptyState } from '../ui/display/EmptyState';
import type { ContainerSummary, ContainerState } from '../../types/protocols/docker';

// ── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | undefined | null): string {
  if (bytes == null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function timeAgo(epoch: number | undefined): string {
  if (!epoch) return '—';
  const seconds = Math.floor(Date.now() / 1000 - epoch);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function containerName(c: ContainerSummary): string {
  return c.names?.[0]?.replace(/^\//, '') ?? c.id.slice(0, 12);
}

function stateColor(state: ContainerState): string {
  switch (state) {
    case 'Running': return 'bg-success';
    case 'Paused': return 'bg-warning';
    case 'Exited': case 'Dead': return 'bg-error';
    default: return 'bg-[var(--color-textSecondary)]';
  }
}

function stateTextColor(state: ContainerState): string {
  switch (state) {
    case 'Running': return 'text-success';
    case 'Paused': return 'text-warning';
    case 'Exited': case 'Dead': return 'text-error';
    default: return 'text-[var(--color-textSecondary)]';
  }
}

function formatPorts(c: ContainerSummary): string {
  if (!c.ports?.length) return '—';
  return c.ports
    .filter(p => p.public_port)
    .map(p => `${p.public_port}→${p.private_port}/${p.port_type ?? 'tcp'}`)
    .join(', ') || '—';
}

// ── types ───────────────────────────────────────────────────────────────────

interface DockerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
}

type ConfirmAction = {
  title: string;
  message: string;
  onConfirm: () => void;
} | null;

const SIDEBAR_TABS: { id: DockerTab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'containers', label: 'Containers', icon: Box },
  { id: 'images', label: 'Images', icon: HardDrive },
  { id: 'volumes', label: 'Volumes', icon: Database },
  { id: 'networks', label: 'Networks', icon: Network },
  { id: 'compose', label: 'Compose', icon: Layers },
];

// ── component ───────────────────────────────────────────────────────────────

export const DockerPanel: React.FC<DockerPanelProps> = ({ isOpen, onClose, connectionId }) => {
  const { t } = useTranslation();
  const docker = useDocker(connectionId, isOpen);

  const [endpointType, setEndpointType] = useState<'unix' | 'tcp' | 'ssh'>('unix');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2376');
  const [tlsEnabled, setTlsEnabled] = useState(true);
  const [showAllContainers, setShowAllContainers] = useState(true);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [pullImageName, setPullImageName] = useState('');
  const [showPullDialog, setShowPullDialog] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');
  const [showCreateVolume, setShowCreateVolume] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState('');
  const [newNetworkDriver, setNewNetworkDriver] = useState('bridge');
  const [showCreateNetwork, setShowCreateNetwork] = useState(false);

  const filteredContainers = docker.containers.filter(c => {
    const matchesSearch = !docker.searchQuery ||
      containerName(c).toLowerCase().includes(docker.searchQuery.toLowerCase()) ||
      c.image.toLowerCase().includes(docker.searchQuery.toLowerCase());
    const matchesState = showAllContainers || c.state === 'Running';
    return matchesSearch && matchesState;
  });

  const handleConnect = () => {
    docker.connect();
  };

  const handleDisconnect = () => {
    setConfirmAction({
      title: 'Disconnect',
      message: 'Are you sure you want to disconnect from the Docker daemon?',
      onConfirm: () => {
        docker.disconnect();
        setConfirmAction(null);
      },
    });
  };

  const handlePullImage = async () => {
    if (!pullImageName.trim()) return;
    await docker.pullImage(pullImageName.trim());
    setPullImageName('');
    setShowPullDialog(false);
  };

  const handleCreateVolume = async () => {
    if (!newVolumeName.trim()) return;
    await docker.createVolume({ name: newVolumeName.trim() });
    setNewVolumeName('');
    setShowCreateVolume(false);
  };

  const handleCreateNetwork = async () => {
    if (!newNetworkName.trim()) return;
    await docker.createNetwork({ name: newNetworkName.trim(), driver: newNetworkDriver });
    setNewNetworkName('');
    setNewNetworkDriver('bridge');
    setShowCreateNetwork(false);
  };

  // ── sub-views ─────────────────────────────────────────────────────────────

  const renderConnectionForm = () => (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center mb-8">
          <Container size={48} className="mx-auto mb-3 text-primary" />
          <h2 className="text-xl font-semibold text-[var(--color-text)]">Connect to Docker</h2>
          <p className="text-sm text-[var(--color-textSecondary)] mt-1">Configure your Docker daemon endpoint</p>
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">Endpoint Type</label>
          <div className="flex space-x-2">
            {(['unix', 'tcp', 'ssh'] as const).map(ep => (
              <button
                key={ep}
                onClick={() => setEndpointType(ep)}
                className={`flex-1 py-2 px-3 rounded text-sm transition-colors ${
                  endpointType === ep
                    ? 'bg-primary text-[var(--color-text)]'
                    : 'bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]'
                }`}
              >
                {ep.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {endpointType === 'unix' && (
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">Socket Path</label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="/var/run/docker.sock"
              className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
            />
          </div>
        )}

        {(endpointType === 'tcp' || endpointType === 'ssh') && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder={endpointType === 'ssh' ? 'user@hostname' : '127.0.0.1'}
                className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">Port</label>
              <input
                type="text"
                value={port}
                onChange={e => setPort(e.target.value)}
                placeholder={endpointType === 'ssh' ? '22' : '2375'}
                className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        )}

        {endpointType === 'tcp' && (
          <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={tlsEnabled}
              onChange={e => setTlsEnabled(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            <span>Enable TLS</span>
          </label>
        )}

        {docker.error && (
          <p className="text-error text-sm">{docker.error}</p>
        )}

        <button
          onClick={handleConnect}
          disabled={docker.loading}
          className="w-full py-2.5 bg-primary text-[var(--color-text)] rounded font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {docker.connectionState === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );

  const renderDashboard = () => {
    const info = docker.systemInfo;
    if (!info) return null;

    const cards = [
      { label: 'Server Version', value: info.server_version ?? '—', icon: Server },
      { label: 'Containers', value: `${info.containers_running ?? 0} running / ${info.containers_stopped ?? 0} stopped / ${info.containers_paused ?? 0} paused`, icon: Box },
      { label: 'Images', value: String(info.images ?? 0), icon: HardDrive },
      { label: 'CPUs', value: String(info.cpus ?? '—'), icon: Cpu },
      { label: 'Memory', value: formatBytes(info.total_memory), icon: MemoryStick },
      { label: 'OS / Arch', value: `${info.os ?? '—'} / ${info.arch ?? '—'}`, icon: Server },
      { label: 'Kernel', value: info.kernel_version ?? '—', icon: Server },
      { label: 'Storage Driver', value: info.driver ?? '—', icon: Database },
    ];

    return (
      <div className="p-6 space-y-6 overflow-y-auto flex-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Dashboard</h2>
          <button
            onClick={() => docker.refreshAll()}
            disabled={docker.refreshing}
            className="sor-icon-btn-sm"
            aria-label="Refresh dashboard"
          >
            <RefreshCw size={16} className={docker.refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Icon size={16} className="text-primary" />
                  <span className="text-xs text-[var(--color-textSecondary)]">{card.label}</span>
                </div>
                <p className="text-sm font-medium text-[var(--color-text)]">{card.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContainerActions = (c: ContainerSummary) => (
    <div className="flex items-center space-x-1 mt-2">
      {c.state !== 'Running' && c.state !== 'Paused' && (
        <button onClick={() => docker.startContainer(c.id)} className="sor-icon-btn-sm" aria-label="Start container">
          <Play size={14} className="text-success" />
        </button>
      )}
      {c.state === 'Running' && (
        <>
          <button onClick={() => docker.stopContainer(c.id)} className="sor-icon-btn-sm" aria-label="Stop container">
            <Square size={14} className="text-error" />
          </button>
          <button onClick={() => docker.restartContainer(c.id)} className="sor-icon-btn-sm" aria-label="Restart container">
            <RotateCcw size={14} />
          </button>
          <button onClick={() => docker.pauseContainer(c.id)} className="sor-icon-btn-sm" aria-label="Pause container">
            <Pause size={14} className="text-warning" />
          </button>
        </>
      )}
      {c.state === 'Paused' && (
        <button onClick={() => docker.unpauseContainer(c.id)} className="sor-icon-btn-sm" aria-label="Unpause container">
          <Play size={14} className="text-success" />
        </button>
      )}
      <button
        onClick={async () => {
          setExpandedContainer(c.id);
          docker.setSelectedContainerId(c.id);
          await docker.getContainerLogs(c.id);
        }}
        className="sor-icon-btn-sm"
        aria-label="View logs"
      >
        <FileText size={14} />
      </button>
      <button
        onClick={async () => {
          docker.setSelectedContainerId(c.id);
          await docker.inspectContainer(c.id);
        }}
        className="sor-icon-btn-sm"
        aria-label="Inspect container"
      >
        <Info size={14} />
      </button>
      <button
        onClick={() => setConfirmAction({
          title: 'Remove Container',
          message: `Remove container "${containerName(c)}"? This action cannot be undone.`,
          onConfirm: async () => {
            await docker.removeContainer(c.id, true);
            setConfirmAction(null);
          },
        })}
        className="sor-icon-btn-sm"
        aria-label="Remove container"
      >
        <Trash2 size={14} className="text-error" />
      </button>
    </div>
  );

  const renderContainers = () => (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Containers</h2>
        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-1.5 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={showAllContainers}
              onChange={e => setShowAllContainers(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            <span>Show all</span>
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
            <input
              type="text"
              value={docker.searchQuery}
              onChange={e => docker.setSearchQuery(e.target.value)}
              placeholder="Filter…"
              className="pl-7 pr-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
            />
          </div>
          <button onClick={() => docker.refreshContainers()} className="sor-icon-btn-sm" aria-label="Refresh containers">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {filteredContainers.length === 0 ? (
        <EmptyState icon={Box} message="No containers found" hint={docker.searchQuery ? 'Try a different search query' : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="sor-th">Name</th>
                <th className="sor-th">Image</th>
                <th className="sor-th">Status</th>
                <th className="sor-th">Ports</th>
                <th className="sor-th">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredContainers.map(c => (
                <React.Fragment key={c.id}>
                  <tr
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)] cursor-pointer"
                    onClick={() => setExpandedContainer(expandedContainer === c.id ? null : c.id)}
                  >
                    <td className="py-2 px-3 text-[var(--color-text)] font-medium">{containerName(c)}</td>
                    <td className="py-2 px-3 text-[var(--color-textSecondary)]">{c.image}</td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${stateColor(c.state)}`} />
                        <span className={stateTextColor(c.state)}>{c.state}</span>
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[var(--color-textSecondary)] text-xs">{formatPorts(c)}</td>
                    <td className="py-2 px-3 text-[var(--color-textSecondary)] text-xs">{timeAgo(c.created)}</td>
                  </tr>
                  {expandedContainer === c.id && (
                    <tr>
                      <td colSpan={5} className="bg-[var(--color-surfaceHover)] px-4 py-3">
                        {renderContainerActions(c)}
                        {docker.selectedContainerId === c.id && docker.containerLogs && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-medium text-[var(--color-text)]">Container Logs</h4>
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => docker.getContainerLogs(c.id)}
                                  className="sor-icon-btn-sm"
                                  aria-label="Refresh logs"
                                >
                                  <RefreshCw size={12} />
                                </button>
                                <button
                                  onClick={() => {
                                    const blob = new Blob([docker.containerLogs!], { type: 'text/plain;charset=utf-8' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${containerName(c)}-logs-${Date.now()}.txt`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  }}
                                  className="sor-icon-btn-sm"
                                  aria-label="Download logs"
                                >
                                  <Download size={12} />
                                </button>
                                <button
                                  onClick={() => docker.clearContainerLogs()}
                                  className="sor-icon-btn-sm"
                                  aria-label="Clear logs"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            <pre className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-xs text-[var(--color-textSecondary)] overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                              {docker.containerLogs}
                            </pre>
                          </div>
                        )}
                        {docker.selectedContainerId === c.id && docker.containerInspect && (
                          <pre className="mt-3 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-xs text-[var(--color-textSecondary)] overflow-auto max-h-48 whitespace-pre-wrap">
                            {JSON.stringify(docker.containerInspect, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderImages = () => (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Images</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowPullDialog(true)}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 transition-opacity"
          >
            <Download size={14} />
            <span>Pull Image</span>
          </button>
          <button onClick={() => docker.refreshImages()} className="sor-icon-btn-sm" aria-label="Refresh images">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {showPullDialog && (
        <div className="flex items-center space-x-2 p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
          <input
            type="text"
            value={pullImageName}
            onChange={e => setPullImageName(e.target.value)}
            placeholder="e.g. nginx:latest"
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
            onKeyDown={e => e.key === 'Enter' && handlePullImage()}
          />
          <button onClick={handlePullImage} disabled={docker.loading} className="px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 disabled:opacity-50">
            Pull
          </button>
          <button onClick={() => { setShowPullDialog(false); setPullImageName(''); }} className="sor-icon-btn-sm" aria-label="Cancel pull">
            <X size={14} />
          </button>
        </div>
      )}

      {docker.images.length === 0 ? (
        <EmptyState icon={HardDrive} message="No images found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="sor-th">Tag</th>
                <th className="sor-th">ID</th>
                <th className="sor-th">Size</th>
                <th className="sor-th">Created</th>
                <th className="sor-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docker.images.map(img => (
                <tr key={img.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]">
                  <td className="py-2 px-3 text-[var(--color-text)]">
                    {img.repo_tags?.join(', ') || '<none>'}
                  </td>
                  <td className="py-2 px-3 text-[var(--color-textSecondary)] text-xs font-mono">
                    {img.id.replace('sha256:', '').slice(0, 12)}
                  </td>
                  <td className="py-2 px-3 text-[var(--color-textSecondary)]">{formatBytes(img.size)}</td>
                  <td className="py-2 px-3 text-[var(--color-textSecondary)] text-xs">{timeAgo(img.created)}</td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => setConfirmAction({
                        title: 'Remove Image',
                        message: `Remove image "${img.repo_tags?.[0] ?? img.id.slice(0, 12)}"?`,
                        onConfirm: async () => {
                          await docker.removeImage(img.id, false);
                          setConfirmAction(null);
                        },
                      })}
                      className="sor-icon-btn-sm"
                      aria-label="Remove image"
                    >
                      <Trash2 size={14} className="text-error" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderVolumes = () => (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Volumes</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowCreateVolume(true)}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            <span>Create</span>
          </button>
          <button onClick={() => docker.refreshVolumes()} className="sor-icon-btn-sm" aria-label="Refresh volumes">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {showCreateVolume && (
        <div className="flex items-center space-x-2 p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
          <input
            type="text"
            value={newVolumeName}
            onChange={e => setNewVolumeName(e.target.value)}
            placeholder="Volume name"
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
            onKeyDown={e => e.key === 'Enter' && handleCreateVolume()}
          />
          <button onClick={handleCreateVolume} disabled={docker.loading} className="px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 disabled:opacity-50">
            Create
          </button>
          <button onClick={() => { setShowCreateVolume(false); setNewVolumeName(''); }} className="sor-icon-btn-sm" aria-label="Cancel create volume">
            <X size={14} />
          </button>
        </div>
      )}

      {docker.volumes.length === 0 ? (
        <EmptyState icon={Database} message="No volumes found" />
      ) : (
        <div className="space-y-2">
          {docker.volumes.map(vol => (
            <div key={vol.name} className="flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-[var(--color-text)]">{vol.name}</p>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Driver: {vol.driver} {vol.mountpoint ? `• ${vol.mountpoint}` : ''}
                  {vol.usage_data?.size != null ? ` • ${formatBytes(vol.usage_data.size)}` : ''}
                </p>
              </div>
              <button
                onClick={() => setConfirmAction({
                  title: 'Remove Volume',
                  message: `Remove volume "${vol.name}"? All data will be lost.`,
                  onConfirm: async () => {
                    await docker.removeVolume(vol.name);
                    setConfirmAction(null);
                  },
                })}
                className="sor-icon-btn-sm"
                aria-label="Remove volume"
              >
                <Trash2 size={14} className="text-error" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderNetworks = () => {
    const subnet = (net: typeof docker.networks[0]) =>
      net.ipam?.config?.[0]?.subnet ?? '—';

    return (
      <div className="p-6 space-y-4 overflow-y-auto flex-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Networks</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowCreateNetwork(true)}
              className="flex items-center space-x-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 transition-opacity"
            >
              <Plus size={14} />
              <span>Create</span>
            </button>
            <button onClick={() => docker.refreshNetworks()} className="sor-icon-btn-sm" aria-label="Refresh networks">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {showCreateNetwork && (
          <div className="flex items-center space-x-2 p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
            <input
              type="text"
              value={newNetworkName}
              onChange={e => setNewNetworkName(e.target.value)}
              placeholder="Network name"
              className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              onKeyDown={e => e.key === 'Enter' && handleCreateNetwork()}
            />
            <select
              value={newNetworkDriver}
              onChange={e => setNewNetworkDriver(e.target.value)}
              className="px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
            >
              <option value="bridge">bridge</option>
              <option value="host">host</option>
              <option value="overlay">overlay</option>
              <option value="macvlan">macvlan</option>
              <option value="none">none</option>
            </select>
            <button onClick={handleCreateNetwork} disabled={docker.loading} className="px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:opacity-90 disabled:opacity-50">
              Create
            </button>
            <button onClick={() => { setShowCreateNetwork(false); setNewNetworkName(''); }} className="sor-icon-btn-sm" aria-label="Cancel create network">
              <X size={14} />
            </button>
          </div>
        )}

        {docker.networks.length === 0 ? (
          <EmptyState icon={Network} message="No networks found" />
        ) : (
          <div className="space-y-2">
            {docker.networks.map(net => (
              <div key={net.id} className="flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-[var(--color-text)]">{net.name}</p>
                  <p className="text-xs text-[var(--color-textSecondary)]">
                    Driver: {net.driver ?? '—'} • Scope: {net.scope ?? '—'} • Subnet: {subnet(net)}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmAction({
                    title: 'Remove Network',
                    message: `Remove network "${net.name}"?`,
                    onConfirm: async () => {
                      await docker.removeNetwork(net.id);
                      setConfirmAction(null);
                    },
                  })}
                  className="sor-icon-btn-sm"
                  aria-label="Remove network"
                >
                  <Trash2 size={14} className="text-error" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderCompose = () => (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Compose Projects</h2>
        <button onClick={() => docker.refreshCompose()} className="sor-icon-btn-sm" aria-label="Refresh compose projects">
          <RefreshCw size={14} />
        </button>
      </div>

      {docker.composeProjects.length === 0 ? (
        <EmptyState icon={Layers} message="No compose projects found" hint="Deploy a compose stack to see it here" />
      ) : (
        <div className="space-y-2">
          {docker.composeProjects.map(proj => (
            <div key={proj.name} className="flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-[var(--color-text)]">{proj.name}</p>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Status: {proj.status ?? '—'}
                  {proj.config_files?.length ? ` • ${proj.config_files.join(', ')}` : ''}
                </p>
              </div>
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => {
                    if (proj.config_files?.length) {
                      docker.composeUp({ files: proj.config_files, project_name: proj.name, detach: true });
                    }
                  }}
                  className="sor-icon-btn-sm"
                  aria-label="Compose up"
                  disabled={!proj.config_files?.length}
                >
                  <ArrowUpCircle size={14} className="text-success" />
                </button>
                <button
                  onClick={() => setConfirmAction({
                    title: 'Compose Down',
                    message: `Bring down compose project "${proj.name}"?`,
                    onConfirm: async () => {
                      if (proj.config_files?.length) {
                        await docker.composeDown({ files: proj.config_files, project_name: proj.name });
                      }
                      setConfirmAction(null);
                    },
                  })}
                  className="sor-icon-btn-sm"
                  aria-label="Compose down"
                  disabled={!proj.config_files?.length}
                >
                  <ArrowDownCircle size={14} className="text-error" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (docker.activeTab) {
      case 'dashboard': return renderDashboard();
      case 'containers': return renderContainers();
      case 'images': return renderImages();
      case 'volumes': return renderVolumes();
      case 'networks': return renderNetworks();
      case 'compose': return renderCompose();
    }
  };

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        panelClassName="max-w-7xl h-[92vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
      >
        <div className="flex flex-col h-full" role="dialog" aria-label="Docker Management Panel">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
            <div className="flex items-center space-x-3">
              <Container size={20} className="text-primary" />
              <span className={`w-2 h-2 rounded-full ${
                docker.connectionState === 'connected'
                  ? 'bg-success'
                  : docker.connectionState === 'connecting'
                    ? 'bg-warning animate-pulse'
                    : 'bg-[var(--color-textSecondary)]'
              }`} />
              <span className="text-[var(--color-text)] font-medium">Docker</span>
            </div>
            <div className="flex items-center space-x-2">
              {docker.connectionState === 'connected' && (
                <button onClick={handleDisconnect} className="text-xs text-[var(--color-textSecondary)] hover:text-error transition-colors">
                  Disconnect
                </button>
              )}
              <button onClick={onClose} className="sor-icon-btn-sm" aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          {docker.connectionState !== 'connected' ? (
            renderConnectionForm()
          ) : (
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar */}
              <div className="w-48 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col py-2">
                {SIDEBAR_TABS.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => docker.setActiveTab(tab.id)}
                      className={`flex items-center space-x-2 px-4 py-2.5 text-sm transition-colors ${
                        docker.activeTab === tab.id
                          ? 'bg-primary/20 text-primary border-r-2 border-primary'
                          : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'
                      }`}
                    >
                      <Icon size={16} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surfaceHover)]">
                {docker.error && (
                  <div className="px-4 py-2 bg-error/10 text-error text-xs border-b border-error/20">
                    {docker.error}
                  </div>
                )}
                {renderContent()}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmAction !== null}
        title={confirmAction?.title ?? 'Confirm'}
        message={confirmAction?.message ?? ''}
        variant="danger"
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
};

export default DockerPanel;
