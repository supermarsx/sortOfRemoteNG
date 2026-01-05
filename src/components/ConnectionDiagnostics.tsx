import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Globe, Router, Network, Activity, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
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
        return <Loader2 size={16} className="text-gray-400 animate-spin" />;
      case 'success':
        return <CheckCircle size={16} className="text-green-400" />;
      case 'failed':
        return <XCircle size={16} className="text-red-400" />;
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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Activity size={20} className="text-blue-400" />
              {t('diagnostics.title', 'Connection Diagnostics')}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {connection.name} ({connection.hostname})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runDiagnostics}
              disabled={isRunning}
              className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
              data-tooltip={t('diagnostics.rerun', 'Run Again')}
            >
              <RefreshCw size={16} className={isRunning ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              data-tooltip={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Current Step Indicator */}
          {isRunning && currentStep && (
            <div className="flex items-center gap-2 text-sm text-blue-400 bg-blue-900/20 border border-blue-600/40 rounded-lg px-4 py-3">
              <Loader2 size={14} className="animate-spin" />
              {currentStep}
            </div>
          )}

          {/* Network Checks */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4 flex items-center gap-2">
              <Network size={14} />
              {t('diagnostics.networkChecks', 'Network Checks')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                <Globe size={20} className="text-gray-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    {t('diagnostics.internet', 'Internet')}
                  </div>
                  <div className="text-xs text-gray-400">8.8.8.8</div>
                </div>
                <StatusIcon status={results.internetCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                <Router size={20} className="text-gray-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    {t('diagnostics.gateway', 'Gateway')}
                  </div>
                  <div className="text-xs text-gray-400">{t('diagnostics.defaultGateway', 'Default gateway')}</div>
                </div>
                <StatusIcon status={results.gatewayCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                <Network size={20} className="text-gray-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    {t('diagnostics.subnet', 'Target Host')}
                  </div>
                  <div className="text-xs text-gray-400">{connection.hostname}</div>
                </div>
                <StatusIcon status={results.subnetCheck} />
              </div>
            </div>
          </div>

          {/* Ping Results */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4 flex items-center gap-2">
              <Activity size={14} />
              {t('diagnostics.pingResults', 'Ping Results')} ({results.pings.length}/5)
            </h3>
            
            {results.pings.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-2xl font-bold text-white">
                    {pingSuccessRate.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-400">{t('diagnostics.successRate', 'Success Rate')}</div>
                </div>
                <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-2xl font-bold text-white">
                    {avgPingTime > 0 ? `${avgPingTime.toFixed(0)}ms` : '-'}
                  </div>
                  <div className="text-xs text-gray-400">{t('diagnostics.avgLatency', 'Avg Latency')}</div>
                </div>
                <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-2xl font-bold text-green-400">
                    {results.pings.filter(p => p.success).length}
                  </div>
                  <div className="text-xs text-gray-400">{t('diagnostics.successful', 'Successful')}</div>
                </div>
                <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-2xl font-bold text-red-400">
                    {results.pings.filter(p => !p.success).length}
                  </div>
                  <div className="text-xs text-gray-400">{t('diagnostics.failed', 'Failed')}</div>
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              {results.pings.map((ping, i) => (
                <div
                  key={i}
                  className={`flex-1 p-2 rounded text-center text-xs ${
                    ping.success 
                      ? 'bg-green-900/30 text-green-400 border border-green-600/40' 
                      : 'bg-red-900/30 text-red-400 border border-red-600/40'
                  }`}
                >
                  {ping.success && ping.time_ms ? `${ping.time_ms}ms` : 'Timeout'}
                </div>
              ))}
              {Array(5 - results.pings.length).fill(0).map((_, i) => (
                <div key={`empty-${i}`} className="flex-1 p-2 rounded text-center text-xs bg-gray-800/50 text-gray-500 border border-gray-600/40">
                  -
                </div>
              ))}
            </div>
          </div>

          {/* Port Check */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4 flex items-center gap-2">
              <Network size={14} />
              {t('diagnostics.portCheck', 'Port Check')}
            </h3>
            
            {results.portCheck ? (
              <div className={`flex items-center justify-between p-4 rounded-lg ${
                results.portCheck.open 
                  ? 'bg-green-900/20 border border-green-600/40' 
                  : 'bg-red-900/20 border border-red-600/40'
              }`}>
                <div>
                  <div className="text-lg font-medium text-white">
                    {t('diagnostics.port', 'Port')} {results.portCheck.port} ({connection.protocol.toUpperCase()})
                  </div>
                  <div className="text-sm text-gray-400">
                    {results.portCheck.open 
                      ? t('diagnostics.portOpen', 'Port is open and accepting connections')
                      : t('diagnostics.portClosed', 'Port is closed or filtered')}
                  </div>
                </div>
                <StatusIcon status={results.portCheck.open ? 'success' : 'failed'} />
              </div>
            ) : (
              <div className="flex items-center justify-center p-4 bg-gray-800/50 rounded-lg">
                <Loader2 size={20} className="text-gray-400 animate-spin" />
              </div>
            )}
          </div>

          {/* Traceroute */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4 flex items-center gap-2">
              <Router size={14} />
              {t('diagnostics.traceroute', 'Traceroute')}
            </h3>
            
            {results.traceroute.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
                {results.traceroute.map((hop, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-4 p-2 rounded ${
                      hop.timeout 
                        ? 'bg-yellow-900/20 text-yellow-400' 
                        : 'bg-gray-800/50 text-gray-300'
                    }`}
                  >
                    <span className="w-6 text-gray-500">{hop.hop}</span>
                    <span className="flex-1 truncate">
                      {hop.timeout 
                        ? '* * *' 
                        : `${hop.hostname || hop.ip || 'Unknown'}`}
                    </span>
                    {hop.ip && hop.ip !== hop.hostname && (
                      <span className="text-gray-500">({hop.ip})</span>
                    )}
                    <span className="w-16 text-right">
                      {hop.time_ms ? `${hop.time_ms}ms` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            ) : isRunning ? (
              <div className="flex items-center justify-center p-4 bg-gray-800/50 rounded-lg">
                <Loader2 size={20} className="text-gray-400 animate-spin" />
                <span className="ml-2 text-gray-400">{t('diagnostics.runningTraceroute', 'Running traceroute...')}</span>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-4">
                {t('diagnostics.tracerouteUnavailable', 'Traceroute not available or no results')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
