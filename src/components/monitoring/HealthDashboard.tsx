import React, { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDashboard } from "../../hooks/monitoring/useDashboard";
import type {
  ConnectionHealthEntry,
  DashboardAlert,
  HeatmapCell,
  QuickStats,
  SparklineData,
} from "../../types/monitoring/dashboard";

/* ------------------------------------------------------------------ */
/*  Inline SVG micro-icons                                            */
/* ------------------------------------------------------------------ */

const IconCircle: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <svg className={className} style={style} width="10" height="10" viewBox="0 0 10 10">
    <circle cx="5" cy="5" r="5" fill="currentColor" />
  </svg>
);

const IconRefresh: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M13.5 2.5v4h-4" />
    <path d="M2.5 13.5v-4h4" />
    <path d="M3.2 6a5.5 5.5 0 0 1 9.3-1.5" />
    <path d="M12.8 10a5.5 5.5 0 0 1-9.3 1.5" />
  </svg>
);

const IconGear: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5.66-1.34-.86-.5a4.77 4.77 0 0 0 0-1.32l.86-.5a.5.5 0 0 0 .18-.68l-1-1.73a.5.5 0 0 0-.68-.18l-.86.5a4.8 4.8 0 0 0-1.14-.66V2.7a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5v1a4.8 4.8 0 0 0-1.14.66l-.86-.5a.5.5 0 0 0-.68.18l-1 1.73a.5.5 0 0 0 .18.68l.86.5a4.77 4.77 0 0 0 0 1.32l-.86.5a.5.5 0 0 0-.18.68l1 1.73a.5.5 0 0 0 .68.18l.86-.5c.34.28.72.5 1.14.66v1a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-1c.42-.16.8-.38 1.14-.66l.86.5a.5.5 0 0 0 .68-.18l1-1.73a.5.5 0 0 0-.18-.68Z" />
  </svg>
);

const IconCheck: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
  </svg>
);

const IconX: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3 11 11M11 3 3 11" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  healthy: "var(--sor-color-healthy, #22c55e)",
  degraded: "var(--sor-color-degraded, #eab308)",
  unhealthy: "var(--sor-color-unhealthy, #ef4444)",
  unknown: "var(--sor-color-unknown, #94a3b8)",
  unreachable: "var(--sor-color-unreachable, #dc2626)",
};

const SEVERITY_CLASS: Record<string, string> = {
  info: "sor-alert--info",
  warning: "sor-alert--warning",
  critical: "sor-alert--critical",
};

function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

interface TopBarProps {
  monitoring: boolean;
  loading: boolean;
  error: string | null;
  onToggle: () => void;
  onRefresh: () => void;
  onConfig: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ monitoring, loading, error, onToggle, onRefresh, onConfig }) => {
  const { t } = useTranslation();
  return (
    <header className="sor-dash-topbar">
      <h2 className="sor-dash-topbar__title">{t("dashboard.title", "Connection Health")}</h2>
      <div className="sor-dash-topbar__actions">
        <button
          className={`sor-dash-btn ${monitoring ? "sor-dash-btn--active" : ""}`}
          onClick={onToggle}
          title={monitoring ? t("dashboard.stopMonitoring", "Stop Monitoring") : t("dashboard.startMonitoring", "Start Monitoring")}
        >
          <IconCircle className={monitoring ? "sor-dash-icon--pulse" : "sor-dash-icon--muted"} />
          <span>{monitoring ? t("dashboard.monitoring", "Monitoring") : t("dashboard.paused", "Paused")}</span>
        </button>
        <button className="sor-dash-btn" onClick={onRefresh} disabled={loading} title={t("dashboard.refresh", "Refresh")}>
          <IconRefresh className={loading ? "sor-dash-icon--spin" : ""} />
        </button>
        <button className="sor-dash-btn" onClick={onConfig} title={t("dashboard.settings", "Settings")}>
          <IconGear />
        </button>
        <span className={`sor-dash-status-dot ${error ? "sor-dash-status-dot--error" : monitoring ? "sor-dash-status-dot--ok" : "sor-dash-status-dot--idle"}`} />
      </div>
    </header>
  );
};

/* ---- Quick Stats Cards ---- */

interface QuickStatsCardsProps {
  stats: QuickStats | null;
  summary: { total: number; healthy: number; degraded: number; unhealthy: number; averageLatencyMs: number } | null;
}

const QuickStatsCards: React.FC<QuickStatsCardsProps> = ({ stats, summary }) => {
  const { t } = useTranslation();

  const total = summary?.total ?? stats?.totalConnections ?? 0;
  const healthy = summary?.healthy ?? 0;
  const degraded = summary?.degraded ?? 0;
  const down = summary?.unhealthy ?? 0;
  const avgLatency = summary?.averageLatencyMs ?? stats?.averageLatencyMs ?? 0;

  const cards = [
    { label: t("dashboard.totalConnections", "Total"), value: total, color: "var(--sor-color-text, #e2e8f0)" },
    { label: t("dashboard.healthy", "Healthy"), value: healthy, color: STATUS_COLORS.healthy },
    { label: t("dashboard.degraded", "Degraded"), value: degraded, color: STATUS_COLORS.degraded },
    { label: t("dashboard.down", "Down"), value: down, color: STATUS_COLORS.unhealthy },
    { label: t("dashboard.avgLatency", "Avg Latency"), value: formatLatency(avgLatency), color: "var(--sor-color-primary, #38bdf8)" },
  ];

  return (
    <div className="sor-dash-stats-row">
      {cards.map((c) => (
        <div key={c.label} className="sor-dash-stat-card" style={{ borderTopColor: c.color }}>
          <span className="sor-dash-stat-card__value" style={{ color: c.color }}>{c.value}</span>
          <span className="sor-dash-stat-card__label">{c.label}</span>
        </div>
      ))}
    </div>
  );
};

/* ---- Alert Banner ---- */

interface AlertBannerProps {
  alerts: DashboardAlert[];
  onAcknowledge: (id: string) => void;
}

const AlertBanner: React.FC<AlertBannerProps> = ({ alerts, onAcknowledge }) => {
  const { t } = useTranslation();

  const active = useMemo(() => alerts.filter((a) => !a.acknowledged), [alerts]);

  if (active.length === 0) return null;

  return (
    <section className="sor-dash-alerts">
      <h3 className="sor-dash-section-title">
        {t("dashboard.activeAlerts", "Active Alerts")}
        <span className="sor-dash-badge">{active.length}</span>
      </h3>
      <ul className="sor-dash-alerts__list">
        {active.map((alert) => (
          <li key={alert.id} className={`sor-dash-alert ${SEVERITY_CLASS[alert.severity] ?? ""}`}>
            <div className="sor-dash-alert__body">
              <span className="sor-dash-alert__conn">{alert.connectionName}</span>
              <span className="sor-dash-alert__msg">{alert.message}</span>
              <span className="sor-dash-alert__time">{relativeTime(alert.timestamp)}</span>
            </div>
            <button className="sor-dash-alert__ack" onClick={() => onAcknowledge(alert.id)} title={t("dashboard.acknowledge", "Acknowledge")}>
              <IconCheck />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

/* ---- Heatmap Grid ---- */

interface HeatmapGridProps {
  cells: HeatmapCell[];
  onSelectConnection: (id: string) => void;
}

const HeatmapGrid: React.FC<HeatmapGridProps> = ({ cells, onSelectConnection }) => {
  const { t } = useTranslation();

  if (cells.length === 0) {
    return <p className="sor-dash-placeholder">{t("dashboard.noHeatmap", "No heatmap data available.")}</p>;
  }

  return (
    <section className="sor-dash-heatmap">
      <h3 className="sor-dash-section-title">{t("dashboard.heatmap", "Connection Heatmap")}</h3>
      <div className="sor-dash-heatmap__grid">
        {cells.map((cell) => (
          <button
            key={cell.connectionId}
            className="sor-dash-heatmap__cell"
            style={{ backgroundColor: STATUS_COLORS[cell.status] ?? STATUS_COLORS.unknown }}
            onClick={() => onSelectConnection(cell.connectionId)}
            title={`${cell.name} — ${cell.status} ${formatLatency(cell.latencyMs)}`}
          >
            <span className="sor-dash-heatmap__cell-label">{cell.name.slice(0, 3)}</span>
          </button>
        ))}
      </div>
      <div className="sor-dash-heatmap__legend">
        {(["healthy", "degraded", "unhealthy", "unknown"] as const).map((s) => (
          <span key={s} className="sor-dash-heatmap__legend-item">
            <IconCircle className="sor-dash-icon" style={{ color: STATUS_COLORS[s] }} />
            {t(`dashboard.status.${s}`, s)}
          </span>
        ))}
      </div>
    </section>
  );
};

/* ---- Sparkline Mini Chart ---- */

interface SparklineMiniProps {
  data: SparklineData;
}

const SparklineMini: React.FC<SparklineMiniProps> = ({ data }) => {
  const width = 160;
  const height = 40;

  const validPoints = data.points.filter((p) => p.latencyMs !== null);
  if (validPoints.length < 2) return <span className="sor-dash-sparkline--empty">—</span>;

  const range = data.maxMs - data.minMs || 1;
  const step = width / (validPoints.length - 1);

  const pathD = validPoints
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p.latencyMs! - data.minMs) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaD = `${pathD} L${((validPoints.length - 1) * step).toFixed(1)},${height} L0,${height} Z`;

  return (
    <svg className="sor-dash-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={areaD} fill="var(--sor-color-primary-alpha, rgba(56,189,248,.15))" />
      <path d={pathD} fill="none" stroke="var(--sor-color-primary, #38bdf8)" strokeWidth="1.5" />
    </svg>
  );
};

/* ---- Top Latency Section ---- */

interface TopLatencyProps {
  entries: ConnectionHealthEntry[];
  sparklines: Record<string, SparklineData>;
}

const TopLatencySection: React.FC<TopLatencyProps> = ({ entries, sparklines }) => {
  const { t } = useTranslation();

  if (entries.length === 0) return null;

  return (
    <section className="sor-dash-top-latency">
      <h3 className="sor-dash-section-title">{t("dashboard.topLatency", "Top Connections by Latency")}</h3>
      <div className="sor-dash-top-latency__list">
        {entries.map((e) => (
          <div key={e.connectionId} className="sor-dash-top-latency__row">
            <span className="sor-dash-top-latency__name">{e.connectionName}</span>
            <span className="sor-dash-top-latency__protocol">{e.protocol}</span>
            <span className="sor-dash-top-latency__value" style={{ color: STATUS_COLORS[e.status] }}>
              {formatLatency(e.latencyMs)}
            </span>
            {sparklines[e.connectionId] && <SparklineMini data={sparklines[e.connectionId]} />}
          </div>
        ))}
      </div>
    </section>
  );
};

/* ---- Recent Connections ---- */

interface RecentListProps {
  recent: Array<{ connectionId: string; connectionName: string; protocol: string; timestamp: string }>;
}

const RecentList: React.FC<RecentListProps> = ({ recent }) => {
  const { t } = useTranslation();

  if (recent.length === 0) {
    return <p className="sor-dash-placeholder">{t("dashboard.noRecent", "No recent connections.")}</p>;
  }

  return (
    <section className="sor-dash-recent">
      <h3 className="sor-dash-section-title">{t("dashboard.recentConnections", "Recent Connections")}</h3>
      <ul className="sor-dash-recent__list">
        {recent.map((r, i) => (
          <li key={`${r.connectionId}-${i}`} className="sor-dash-recent__item">
            <span className="sor-dash-recent__name">{r.connectionName}</span>
            <span className="sor-dash-recent__protocol">{r.protocol}</span>
            <span className="sor-dash-recent__time">{relativeTime(r.timestamp)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

/* ---- Config Panel ---- */

interface ConfigPanelProps {
  config: { enabled: boolean; refreshIntervalMs: number; parallelChecks: number };
  onUpdate: (partial: Partial<ConfigPanelProps["config"]>) => void;
  onClose: () => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, onUpdate, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="sor-dash-config-overlay">
      <div className="sor-dash-config-panel">
        <header className="sor-dash-config-panel__header">
          <h3>{t("dashboard.configTitle", "Dashboard Settings")}</h3>
          <button className="sor-dash-btn sor-dash-btn--icon" onClick={onClose}>
            <IconX />
          </button>
        </header>
        <div className="sor-dash-config-panel__body">
          <label className="sor-dash-config-field">
            <span>{t("dashboard.refreshInterval", "Refresh interval (s)")}</span>
            <input
              className="sor-dash-input"
              type="number"
              min={5}
              max={300}
              value={Math.round(config.refreshIntervalMs / 1000)}
              onChange={(e) => onUpdate({ refreshIntervalMs: Number(e.target.value) * 1000 })}
            />
          </label>
          <label className="sor-dash-config-field">
            <span>{t("dashboard.parallelChecks", "Parallel checks")}</span>
            <input
              className="sor-dash-input"
              type="number"
              min={1}
              max={50}
              value={config.parallelChecks}
              onChange={(e) => onUpdate({ parallelChecks: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>
    </div>
  );
};

/* ---- Widget Grid ---- */

interface WidgetGridProps {
  children: React.ReactNode;
  columns: number;
}

const WidgetGrid: React.FC<WidgetGridProps> = ({ children, columns }) => (
  <div
    className="sor-dash-widget-grid"
    style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
  >
    {children}
  </div>
);

interface WidgetCardProps {
  title: string;
  span?: number;
  children: React.ReactNode;
}

const WidgetCard: React.FC<WidgetCardProps> = ({ title, span = 1, children }) => (
  <div className="sor-dash-widget" style={{ gridColumn: `span ${span}` }}>
    <h4 className="sor-dash-widget__title">{title}</h4>
    <div className="sor-dash-widget__content">{children}</div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Main Dashboard Component                                          */
/* ------------------------------------------------------------------ */

export interface HealthDashboardProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const HealthDashboard: React.FC<HealthDashboardProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const dash = useDashboard();

  const [showConfig, setShowConfig] = useState(false);
  const [topLatency, setTopLatency] = useState<ConnectionHealthEntry[]>([]);
  const [recent, setRecent] = useState<Array<{ connectionId: string; connectionName: string; protocol: string; timestamp: string }>>([]);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  /* ---- Initial data load ---- */
  useEffect(() => {
    if (!isOpen || initialLoaded) return;

    let cancelled = false;
    const load = async () => {
      await dash.loadConfig();
      await dash.loadLayout();
      await Promise.all([dash.fetchState(), dash.fetchAllHealth(), dash.fetchHeatmap(), dash.fetchQuickStats()]);

      const [top, rec] = await Promise.all([dash.fetchTopLatency(8), dash.fetchRecent(12)]);

      if (!cancelled) {
        setTopLatency(top);
        setRecent(rec);

        // fetch sparklines for top-latency connections
        for (const entry of top.slice(0, 6)) {
          dash.fetchSparkline(entry.connectionId);
        }
        setInitialLoaded(true);
      }
    };

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* ---- Derived values ---- */
  const monitoring = dash.state?.monitoring ?? false;
  const alerts = dash.state?.alerts ?? [];
  const summary = dash.state?.summary ?? null;

  const handleToggleMonitoring = async () => {
    if (monitoring) {
      await dash.stopMonitoring();
    } else {
      await dash.startMonitoring();
    }
  };

  const handleRefresh = async () => {
    await dash.forceRefresh();
    const [top, rec] = await Promise.all([dash.fetchTopLatency(8), dash.fetchRecent(12)]);
    setTopLatency(top);
    setRecent(rec);
    for (const entry of top.slice(0, 6)) {
      dash.fetchSparkline(entry.connectionId);
    }
  };

  const handleSelectConnection = (connectionId: string) => {
    setSelectedConnection(connectionId);
    dash.fetchConnectionHealth(connectionId);
    dash.fetchSparkline(connectionId);
  };

  /* ---- Render gates ---- */
  if (!isOpen) return null;

  if (!initialLoaded && dash.loading) {
    return (
      <div className="sor-dash-root sor-dash-root--loading">
        <div className="sor-dash-loader">
          <IconRefresh className="sor-dash-icon--spin" />
          <span>{t("dashboard.loading", "Loading dashboard…")}</span>
        </div>
      </div>
    );
  }

  if (dash.error && !initialLoaded) {
    return (
      <div className="sor-dash-root sor-dash-root--error">
        <div className="sor-dash-error">
          <IconX className="sor-dash-icon--error" />
          <p>{t("dashboard.loadError", "Failed to load dashboard data.")}</p>
          <p className="sor-dash-error__detail">{dash.error}</p>
          <button className="sor-dash-btn" onClick={handleRefresh}>{t("dashboard.retry", "Retry")}</button>
        </div>
      </div>
    );
  }

  /* ---- Selected connection detail ---- */
  const selectedEntry = selectedConnection
    ? dash.healthEntries.find((e) => e.connectionId === selectedConnection) ?? null
    : null;

  return (
    <div className="sor-dash-root">
      {/* Top bar */}
      <TopBar
        monitoring={monitoring}
        loading={dash.loading}
        error={dash.error}
        onToggle={handleToggleMonitoring}
        onRefresh={handleRefresh}
        onConfig={() => setShowConfig(true)}
      />

      {/* Error toast */}
      {dash.error && initialLoaded && (
        <div className="sor-dash-error-toast">
          <span>{dash.error}</span>
          <button className="sor-dash-btn sor-dash-btn--icon" onClick={() => { /* clear handled by next fetch */ }}>
            <IconX />
          </button>
        </div>
      )}

      <div className="sor-dash-body">
        {/* Quick stats */}
        <QuickStatsCards stats={dash.quickStats} summary={summary} />

        {/* Alerts */}
        <AlertBanner alerts={alerts} onAcknowledge={dash.acknowledgeAlert} />

        {/* Widget grid */}
        <WidgetGrid columns={dash.layout.columns >= 8 ? 3 : 2}>
          {/* Heatmap widget */}
          <WidgetCard title={t("dashboard.heatmap", "Connection Heatmap")} span={2}>
            <HeatmapGrid cells={dash.heatmap} onSelectConnection={handleSelectConnection} />
          </WidgetCard>

          {/* Recent connections widget */}
          <WidgetCard title={t("dashboard.recentConnections", "Recent Connections")}>
            <RecentList recent={recent} />
          </WidgetCard>

          {/* Sparklines / top-latency widget */}
          <WidgetCard title={t("dashboard.topLatency", "Top Connections by Latency")} span={2}>
            <TopLatencySection entries={topLatency} sparklines={dash.sparklines} />
          </WidgetCard>

          {/* Protocol breakdown widget */}
          <WidgetCard title={t("dashboard.protocolBreakdown", "Protocol Breakdown")}>
            <ProtocolBreakdown stats={dash.quickStats} />
          </WidgetCard>
        </WidgetGrid>

        {/* Selected connection detail panel */}
        {selectedEntry && (
          <section className="sor-dash-detail">
            <header className="sor-dash-detail__header">
              <h3 className="sor-dash-detail__title">{selectedEntry.connectionName}</h3>
              <button className="sor-dash-btn sor-dash-btn--icon" onClick={() => setSelectedConnection(null)}>
                <IconX />
              </button>
            </header>
            <div className="sor-dash-detail__grid">
              <DetailField label={t("dashboard.protocol", "Protocol")} value={selectedEntry.protocol} />
              <DetailField label={t("dashboard.hostname", "Hostname")} value={selectedEntry.hostname} />
              <DetailField
                label={t("dashboard.status", "Status")}
                value={selectedEntry.status}
                color={STATUS_COLORS[selectedEntry.status]}
              />
              <DetailField label={t("dashboard.latency", "Latency")} value={formatLatency(selectedEntry.latencyMs)} />
              <DetailField label={t("dashboard.uptime", "Uptime")} value={`${selectedEntry.uptimePercent.toFixed(1)}%`} />
              <DetailField label={t("dashboard.checks", "Checks")} value={`${selectedEntry.checkCount} (${selectedEntry.failCount} fail)`} />
              <DetailField label={t("dashboard.lastChecked", "Last Checked")} value={relativeTime(selectedEntry.lastChecked)} />
              {selectedEntry.errorMessage && (
                <DetailField label={t("dashboard.error", "Error")} value={selectedEntry.errorMessage} className="sor-dash-detail__error" />
              )}
            </div>
            {dash.sparklines[selectedEntry.connectionId] && (
              <div className="sor-dash-detail__sparkline">
                <SparklineMini data={dash.sparklines[selectedEntry.connectionId]} />
              </div>
            )}
          </section>
        )}
      </div>

      {/* Config panel overlay */}
      {showConfig && (
        <ConfigPanel
          config={dash.config}
          onUpdate={(partial) => dash.updateConfig(partial)}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
};

/* ---- Small utility sub-components ---- */

const DetailField: React.FC<{ label: string; value: string; color?: string; className?: string }> = ({
  label,
  value,
  color,
  className,
}) => (
  <div className={`sor-dash-detail__field ${className ?? ""}`}>
    <span className="sor-dash-detail__field-label">{label}</span>
    <span className="sor-dash-detail__field-value" style={color ? { color } : undefined}>
      {value}
    </span>
  </div>
);

const ProtocolBreakdown: React.FC<{ stats: QuickStats | null }> = ({ stats }) => {
  const { t } = useTranslation();

  if (!stats || Object.keys(stats.protocolBreakdown).length === 0) {
    return <p className="sor-dash-placeholder">{t("dashboard.noProtocols", "No protocol data.")}</p>;
  }

  const total = Object.values(stats.protocolBreakdown).reduce((s, n) => s + n, 0) || 1;

  return (
    <ul className="sor-dash-protocol-list">
      {Object.entries(stats.protocolBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([proto, count]) => (
          <li key={proto} className="sor-dash-protocol-item">
            <span className="sor-dash-protocol-item__name">{proto}</span>
            <div className="sor-dash-protocol-item__bar-bg">
              <div
                className="sor-dash-protocol-item__bar-fill"
                style={{ width: `${((count / total) * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="sor-dash-protocol-item__count">{count}</span>
          </li>
        ))}
    </ul>
  );
};

export default HealthDashboard;
