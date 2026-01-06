import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Globe, Router, Network, Activity, CheckCircle, XCircle, Clock, Loader2, Stethoscope } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Connection } from '../types/connection';

interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}

interface PingResult {
  success: boolean;
  time_ms?: number;
  error?: string;
}

interface TracerouteHop {
  hop: number;
  ip?: string;
  hostname?: string;
  time_ms?: number;
  timeout: boolean;
}

interface PortCheckResult {
  port: number;
  open: boolean;
  service?: string;
  time_ms?: number;
  banner?: string;
}

interface DiagnosticResults {
  internetCheck: 'pending' | 'success' | 'failed';
  gatewayCheck: 'pending' | 'success' | 'failed';
  subnetCheck: 'pending' | 'success' | 'failed';
  pings: PingResult[];
  traceroute: TracerouteHop[];
  portCheck: PortCheckResult | null;
}

const initialResults: DiagnosticResults = {
  internetCheck: 'pending',
  gatewayCheck: 'pending',
  subnetCheck: 'pending',
  pings: [],
  traceroute: [],
  portCheck: null,
};

export const ConnectionDiagnostics: React.FC<ConnectionDiagnosticsProps> = ({
  connection,
  onClose,
}) => {
  const { t } = useTranslation();
  const [results, setResults] = useState<DiagnosticResults>(initialResults);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');

  const getDefaultPort = (protocol: string): number => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      vnc: 5900,
      telnet: 23,
      http: 80,
      https: 443,
      ftp: 21,
      smb: 445,
      mysql: 3306,
      postgresql: 5432,
      anydesk: 7070,
      rustdesk: 21116,
    };
    return ports[protocol.toLowerCase()] || 22;
  };

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setResults(initialResults);

    const isTauri = typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);

    if (!isTauri) {
      setResults({
        ...initialResults,
        internetCheck: 'failed',
        gatewayCheck: 'failed',
        subnetCheck: 'failed',
      });
      setIsRunning(false);
      return;
    }

    try {
      // Step 1: Internet connectivity check
      setCurrentStep(t('diagnostics.checkingInternet', 'Checking internet connectivity...'));
      try {
        const internetResult = await invoke<PingResult>('ping_host_detailed', { 
          host: '8.8.8.8', 
          count: 1,
          timeoutSecs: 5 
        });
        setResults(prev => ({ 
          ...prev, 
          internetCheck: internetResult.success ? 'success' : 'failed' 
        }));
      } catch {
        setResults(prev => ({ ...prev, internetCheck: 'failed' }));
      }

      // Step 2: Gateway check
      setCurrentStep(t('diagnostics.checkingGateway', 'Checking gateway...'));
      try {
        const gatewayResult = await invoke<PingResult>('ping_gateway', { 
          timeoutSecs: 5 
        });
        setResults(prev => ({ 
          ...prev, 
          gatewayCheck: gatewayResult.success ? 'success' : 'failed' 
        }));
      } catch {
        setResults(prev => ({ ...prev, gatewayCheck: 'failed' }));
      }

      // Step 3: Subnet/Local network check (ping target host)
      setCurrentStep(t('diagnostics.checkingSubnet', 'Checking subnet access...'));
      try {
        const subnetResult = await invoke<PingResult>('ping_host_detailed', { 
          host: connection.hostname, 
          count: 1,
          timeoutSecs: 5 
        });
        setResults(prev => ({ 
          ...prev, 
          subnetCheck: subnetResult.success ? 'success' : 'failed' 
        }));
      } catch {
        setResults(prev => ({ ...prev, subnetCheck: 'failed' }));
      }

      // Step 4: Run 5 pings to the target
      setCurrentStep(t('diagnostics.runningPings', 'Running ping tests...'));
      const pings: PingResult[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const pingResult = await invoke<PingResult>('ping_host_detailed', { 
            host: connection.hostname, 
            count: 1,
            timeoutSecs: 5 
          });
          pings.push(pingResult);
          setResults(prev => ({ ...prev, pings: [...pings] }));
        } catch (error) {
          pings.push({ success: false, error: String(error) });
          setResults(prev => ({ ...prev, pings: [...pings] }));
        }
        // Small delay between pings
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Step 5: Port check
      setCurrentStep(t('diagnostics.checkingPort', 'Checking port...'));
      const port = connection.port || getDefaultPort(connection.protocol);
      try {
        const portResult = await invoke<PortCheckResult>('check_port', { 
          host: connection.hostname, 
          port,
          timeoutSecs: 5 
        });
        setResults(prev => ({ ...prev, portCheck: portResult }));
      } catch (error) {
        setResults(prev => ({ 
          ...prev, 
          portCheck: { port, open: false, time_ms: undefined } 
        }));
      }

      // Step 6: Traceroute
      setCurrentStep(t('diagnostics.runningTraceroute', 'Running traceroute...'));
      try {
        const tracerouteResult = await invoke<TracerouteHop[]>('traceroute', { 
          host: connection.hostname,
          maxHops: 30,
          timeoutSecs: 3
        });
        setResults(prev => ({ ...prev, traceroute: tracerouteResult }));
      } catch (error) {
        console.warn('Traceroute failed:', error);
        // Traceroute might not be available on all systems
      }

    } catch (error) {
      console.error('Diagnostics failed:', error);
    } finally {
      setIsRunning(false);
      setCurrentStep('');
    }
  }, [connection, t]);

  useEffect(() => {
    // Run diagnostics on mount
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const StatusIcon = ({ status }: { status: 'pending' | 'success' | 'failed' }) => {
    switch (status) {
      case 'pending':
        return <Loader2 size={16} className="text-[var(--color-textMuted)] animate-spin" />;
      case 'success':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <XCircle size={16} className="text-red-500" />;
    }
  };

  const avgPingTime = results.pings.length > 0
    ? results.pings
        .filter(p => p.success && p.time_ms)
        .reduce((sum, p) => sum + (p.time_ms || 0), 0) / 
        results.pings.filter(p => p.success).length || 0
    : 0;

  const pingSuccessRate = results.pings.length > 0
    ? (results.pings.filter(p => p.success).length / results.pings.length) * 100
    : 0;

  // Calculate jitter (standard deviation of ping times)
  const successfulPings = results.pings.filter(p => p.success && p.time_ms);
  const jitter = successfulPings.length > 1
    ? Math.sqrt(
        successfulPings.reduce((sum, p) => sum + Math.pow((p.time_ms || 0) - avgPingTime, 2), 0) / 
        (successfulPings.length - 1)
      )
    : 0;

  // Get min/max for graph scaling
  const pingTimes = successfulPings.map(p => p.time_ms || 0);
  const maxPing = pingTimes.length > 0 ? Math.max(...pingTimes) : 0;
  const minPing = pingTimes.length > 0 ? Math.min(...pingTimes) : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Stethoscope size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t('diagnostics.title', 'Connection Diagnostics')}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {connection.name} • {connection.hostname}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runDiagnostics}
              disabled={isRunning}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
              data-tooltip={t('diagnostics.rerun', 'Run Again')}
            >
              <RefreshCw size={16} className={isRunning ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors"
              data-tooltip={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Current Step Indicator */}
          {isRunning && currentStep && (
            <div className="flex items-center gap-2 text-sm text-blue-500 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
              <Loader2 size={14} className="animate-spin" />
              {currentStep}
            </div>
          )}

          {/* Network Checks */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Network size={12} />
              {t('diagnostics.networkChecks', 'Network Checks')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Globe size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.internet', 'Internet')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">8.8.8.8</div>
                </div>
                <StatusIcon status={results.internetCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Router size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.gateway', 'Gateway')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">{t('diagnostics.defaultGateway', 'Default gateway')}</div>
                </div>
                <StatusIcon status={results.gatewayCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Network size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.subnet', 'Target Host')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">{connection.hostname}</div>
                </div>
                <StatusIcon status={results.subnetCheck} />
              </div>
            </div>
          </div>

          {/* Ping Results */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Activity size={12} />
              {t('diagnostics.pingResults', 'Ping Results')} ({results.pings.length}/5)
            </h3>
            
            {results.pings.length > 0 && (
              <>
                {/* Ping Graph */}
                <div className="mb-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-end gap-1 h-12">
                    {results.pings.map((ping, i) => {
                      const height = ping.success && ping.time_ms && maxPing > 0
                        ? Math.max(15, ((ping.time_ms / maxPing) * 100))
                        : 0;
                      return (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center justify-end"
                          title={ping.success ? `${ping.time_ms}ms` : 'Timeout'}
                        >
                          <div
                            className={`w-full rounded-t transition-all ${
                              ping.success 
                                ? ping.time_ms && ping.time_ms > avgPingTime * 1.5
                                  ? 'bg-yellow-500'
                                  : 'bg-green-500'
                                : 'bg-red-500'
                            }`}
                            style={{ height: ping.success ? `${height}%` : '15%' }}
                          />
                        </div>
                      );
                    })}
                    {Array(5 - results.pings.length).fill(0).map((_, i) => (
                      <div key={`empty-${i}`} className="flex-1 flex flex-col items-center justify-end">
                        <div className="w-full h-[15%] bg-[var(--color-border)] rounded-t opacity-30" />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[9px] text-[var(--color-textMuted)] mt-1">
                    <span>{minPing > 0 ? `${minPing}ms` : '-'}</span>
                    <span>{maxPing > 0 ? `${maxPing}ms` : '-'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {pingSuccessRate.toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.successRate', 'Success Rate')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {avgPingTime > 0 ? `${avgPingTime.toFixed(0)}ms` : '-'}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.avgLatency', 'Avg Latency')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {jitter > 0 ? `±${jitter.toFixed(0)}ms` : '-'}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.jitter', 'Jitter')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-green-500">
                      {results.pings.filter(p => p.success).length}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.successful', 'Successful')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-red-500">
                      {results.pings.filter(p => !p.success).length}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.failed', 'Failed')}</div>
                  </div>
                </div>
              </>
            )}
            
            <div className="flex gap-1.5">
              {results.pings.map((ping, i) => (
                <div
                  key={i}
                  className={`flex-1 p-2 rounded text-center text-xs font-medium ${
                    ping.success 
                      ? 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30' 
                      : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                  }`}
                >
                  {ping.success && ping.time_ms ? `${ping.time_ms}ms` : 'Timeout'}
                </div>
              ))}
              {Array(5 - results.pings.length).fill(0).map((_, i) => (
                <div key={`empty-${i}`} className="flex-1 p-2 rounded text-center text-xs bg-[var(--color-surface)] text-[var(--color-textMuted)] border border-[var(--color-border)]">
                  -
                </div>
              ))}
            </div>
          </div>

          {/* Port Check */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Network size={12} />
              {t('diagnostics.portCheck', 'Port Check')}
            </h3>
            
            {results.portCheck ? (
              <div className={`p-4 rounded-lg ${
                results.portCheck.open 
                  ? 'bg-green-500/10 border border-green-500/30' 
                  : 'bg-red-500/10 border border-red-500/30'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-medium text-[var(--color-text)]">
                      {t('diagnostics.port', 'Port')} {results.portCheck.port} ({connection.protocol.toUpperCase()})
                    </div>
                    <div className="text-sm text-[var(--color-textSecondary)]">
                      {results.portCheck.open 
                        ? t('diagnostics.portOpen', 'Port is open and accepting connections')
                        : t('diagnostics.portClosed', 'Port is closed or filtered')}
                    </div>
                  </div>
                  <StatusIcon status={results.portCheck.open ? 'success' : 'failed'} />
                </div>
                {results.portCheck.banner && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">Banner / Fingerprint</div>
                    <code className="text-xs font-mono bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text)] block truncate">
                      {results.portCheck.banner}
                    </code>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Loader2 size={20} className="text-[var(--color-textMuted)] animate-spin" />
              </div>
            )}
          </div>

          {/* Traceroute */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Router size={12} />
              {t('diagnostics.traceroute', 'Traceroute')}
              {results.traceroute.length > 0 && (
                <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
                  {results.traceroute.length} {results.traceroute.length === 1 ? t('diagnostics.hop', 'hop') : t('diagnostics.hops', 'hops')}
                </span>
              )}
            </h3>
            
            {results.traceroute.length > 0 ? (
              <div className="space-y-0.5 max-h-52 overflow-y-auto font-mono text-xs">
                {results.traceroute.map((hop, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-2 rounded ${
                      hop.timeout 
                        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' 
                        : 'bg-[var(--color-surface)] text-[var(--color-text)]'
                    }`}
                  >
                    <span className="w-5 text-[var(--color-textMuted)] text-right">{hop.hop}</span>
                    <span className="flex-1 truncate">
                      {hop.timeout 
                        ? '* * *' 
                        : `${hop.hostname || hop.ip || 'Unknown'}`}
                    </span>
                    {hop.ip && hop.ip !== hop.hostname && (
                      <span className="text-[var(--color-textMuted)]">({hop.ip})</span>
                    )}
                    <span className="w-14 text-right text-[var(--color-textSecondary)]">
                      {hop.time_ms ? `${hop.time_ms}ms` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            ) : isRunning ? (
              <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Loader2 size={20} className="text-[var(--color-textMuted)] animate-spin" />
                <span className="ml-2 text-[var(--color-textSecondary)]">{t('diagnostics.runningTraceroute', 'Running traceroute...')}</span>
              </div>
            ) : (
              <div className="text-center text-[var(--color-textSecondary)] py-4">
                {t('diagnostics.tracerouteUnavailable', 'Traceroute not available or no results')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
