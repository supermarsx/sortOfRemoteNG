import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface RDPLogEntry {
  timestamp: number;
  session_id?: string;
  level: string;
  message: string;
}

export function useRDPLogViewer(
  isVisible: boolean,
  sessionFilter?: string | null,
) {
  const [logs, setLogs] = useState<RDPLogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [sessionIdFilter, setSessionIdFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const lastTimestamp = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((entry: RDPLogEntry) => {
    setLogs((prev) => [...prev, entry].slice(-1000));
    if (entry.timestamp > lastTimestamp.current) {
      lastTimestamp.current = entry.timestamp;
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const newLogs = await invoke<RDPLogEntry[]>('get_rdp_logs', {
        sinceTimestamp: lastTimestamp.current || null,
      });
      if (newLogs.length > 0) {
        lastTimestamp.current = newLogs[newLogs.length - 1].timestamp;
        setLogs((prev) => [...prev, ...newLogs].slice(-1000));
      }
    } catch {
      // Service may not be ready yet
    }
  }, []);

  // Poll for logs from the backend buffer
  useEffect(() => {
    if (!isVisible) return;
    lastTimestamp.current = 0;
    setLogs([]);
    fetchLogs();
    const timer = setInterval(fetchLogs, 2000);
    return () => clearInterval(timer);
  }, [isVisible, fetchLogs]);

  // Listen for real-time rdp://log events from the session runner
  useEffect(() => {
    if (!isVisible) return;
    let unlisten: UnlistenFn | undefined;
    listen<RDPLogEntry>('rdp://log', (event) => {
      appendLog(event.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [isVisible, appendLog]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    if (sessionFilter) {
      setSessionIdFilter(sessionFilter);
    }
  }, [sessionFilter]);

  const sessionIds = Array.from(
    new Set(logs.map((e) => e.session_id).filter(Boolean)),
  ) as string[];

  const filteredLogs = logs.filter((entry) => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
    if (sessionIdFilter !== 'all' && entry.session_id !== sessionIdFilter)
      return false;
    if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase()))
      return false;
    return true;
  });

  return {
    logs,
    filter,
    setFilter,
    levelFilter,
    setLevelFilter,
    sessionIdFilter,
    setSessionIdFilter,
    autoScroll,
    setAutoScroll,
    scrollRef,
    sessionIds,
    filteredLogs,
  };
}
