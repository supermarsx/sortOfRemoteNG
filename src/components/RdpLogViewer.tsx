import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  Search,
  ArrowDown,
} from 'lucide-react';

interface RdpLogEntry {
  timestamp: number;
  session_id?: string;
  level: string;
  message: string;
}

interface RdpLogViewerProps {
  isVisible: boolean;
}

const LEVEL_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  info: { icon: Info, color: 'text-blue-400' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400' },
  error: { icon: AlertCircle, color: 'text-red-400' },
  debug: { icon: Info, color: 'text-gray-500' },
};

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const RdpLogViewer: React.FC<RdpLogViewerProps> = ({ isVisible }) => {
  const [logs, setLogs] = useState<RdpLogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const lastTimestamp = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const newLogs = await invoke<RdpLogEntry[]>('get_rdp_logs', {
        sinceTimestamp: lastTimestamp.current || null,
      });
      if (newLogs.length > 0) {
        lastTimestamp.current = newLogs[newLogs.length - 1].timestamp;
        setLogs(prev => [...prev, ...newLogs].slice(-1000));
      }
    } catch {
      // Service may not be ready yet
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    // Reset and fetch all on first open
    lastTimestamp.current = 0;
    setLogs([]);
    fetchLogs();
    const timer = setInterval(fetchLogs, 2000);
    return () => clearInterval(timer);
  }, [isVisible, fetchLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter(entry => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
    if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter logs..."
            className="w-full pl-7 pr-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <select
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`p-1 rounded transition-colors ${autoScroll ? 'text-indigo-400 bg-indigo-900/30' : 'text-gray-500 hover:text-gray-300'}`}
          title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        >
          <ArrowDown size={12} />
        </button>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-[10px]">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs">
            No log entries
          </div>
        ) : (
          filteredLogs.map((entry, i) => {
            const config = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
            const Icon = config.icon;
            return (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-start gap-1.5 px-1.5 py-0.5 hover:bg-gray-800/50 rounded"
              >
                <Icon size={10} className={`${config.color} flex-shrink-0 mt-0.5`} />
                <span className="text-gray-500 flex-shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                {entry.session_id && (
                  <span className="text-gray-600 flex-shrink-0" title={entry.session_id}>
                    [{entry.session_id.slice(0, 6)}]
                  </span>
                )}
                <span className="text-gray-300 break-all">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 border-t border-gray-700 text-[10px] text-gray-500 flex-shrink-0">
        {filteredLogs.length} / {logs.length} entries
      </div>
    </div>
  );
};

export default RdpLogViewer;
