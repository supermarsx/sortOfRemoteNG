import { useState, useCallback, useMemo } from 'react';
import { ConnectionSession } from '../../types/connection/connection';
import { ConnectionAction } from '../../contexts/ConnectionContextTypes';
import { generateId } from '../../utils/core/id';

/** All protocol types the app supports for connections. */
const PROTOCOLS = [
  'rdp', 'ssh', 'vnc', 'anydesk', 'http', 'https', 'telnet', 'rlogin',
  'mysql', 'ftp', 'sftp', 'scp', 'winrm', 'rustdesk', 'smb',
  'gcp', 'azure', 'ibm-csp', 'digital-ocean', 'heroku', 'scaleway',
  'linode', 'ovhcloud', 'ilo', 'lenovo', 'supermicro',
] as const;

const SESSION_STATUSES = ['connecting', 'connected', 'disconnected', 'error', 'reconnecting'] as const;

type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Fake RDP error messages for testing the error screen. */
const RDP_ERROR_MESSAGES: Record<string, string> = {
  'CredSSP Oracle':
    'An authentication error has occurred. The function requested is not supported. This could be due to CredSSP encryption oracle remediation.',
  'CredSSP Post-Auth':
    'CredSSP: post-authentication error: The logon attempt failed. The server may require Network Level Authentication.',
  'Duplicate Session':
    'The remote session was disconnected because there are no Remote Desktop License Servers available. Another user connected to the server, forcing the disconnection of the current connection.',
  'Negotiation Failure':
    'The RDP negotiation with the server failed. The server may not support the requested security protocol (TLS 1.2). Error code: 0x00000002',
  'Credentials':
    'Logon failed: The specified account password has expired. Your password must be changed before logging on the first time.',
  'Network':
    'Unable to connect to the remote computer. Connection timed out after 30000ms. Verify the computer name, and then try to connect again.',
  'TLS':
    'The connection was terminated because an unexpected server authentication certificate was received. TLS handshake failed: certificate verify failed (self signed certificate)',
  'Unknown':
    'An unexpected server error has occurred. Error code: 0x00000516',
};

export interface DebugAction {
  id: string;
  label: string;
  description: string;
  category: 'sessions' | 'errors' | 'state' | 'ui';
  action: () => void;
}

interface UseDebugPanelParams {
  dispatch: React.Dispatch<ConnectionAction>;
  setActiveSessionId: (id: string) => void;
  sessions: ConnectionSession[];
  handleOpenDevtools: () => void;
}

export function useDebugPanel({
  dispatch,
  setActiveSessionId,
  sessions,
  handleOpenDevtools,
}: UseDebugPanelParams) {
  const [filter, setFilter] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>('sessions');

  const createMockSession = useCallback(
    (protocol: string, status: SessionStatus, name?: string, errorMessage?: string): ConnectionSession => {
      const id = generateId();
      const hostname = `debug-${protocol}.example.com`;
      return {
        id,
        connectionId: `debug-${id}`,
        name: name || `[Debug] ${protocol.toUpperCase()} ${status}`,
        status,
        startTime: new Date(),
        protocol,
        hostname,
        reconnectAttempts: status === 'reconnecting' ? 2 : 0,
        maxReconnectAttempts: 3,
        ...(errorMessage ? { errorMessage } : {}),
      };
    },
    [],
  );

  const addSession = useCallback(
    (session: ConnectionSession) => {
      dispatch({ type: 'ADD_SESSION', payload: session });
      requestAnimationFrame(() => setActiveSessionId(session.id));
    },
    [dispatch, setActiveSessionId],
  );

  const actions = useMemo((): DebugAction[] => {
    const list: DebugAction[] = [];

    // ── Session creation (per protocol × status) ──────────────────
    for (const proto of PROTOCOLS) {
      for (const status of SESSION_STATUSES) {
        list.push({
          id: `session-${proto}-${status}`,
          label: `${proto.toUpperCase()} → ${status}`,
          description: `Open a mock ${proto} tab in "${status}" state`,
          category: 'sessions',
          action: () => addSession(createMockSession(proto, status)),
        });
      }
    }

    // ── RDP error screen variants ─────────────────────────────────
    for (const [label, msg] of Object.entries(RDP_ERROR_MESSAGES)) {
      list.push({
        id: `rdp-error-${label}`,
        label: `RDP Error: ${label}`,
        description: msg.slice(0, 80) + '…',
        category: 'errors',
        action: () => {
          const session = createMockSession('rdp', 'error', `[Debug] RDP ${label}`, msg);
          addSession(session);
        },
      });
    }

    // ── Bulk spawn ────────────────────────────────────────────────
    list.push({
      id: 'spawn-all-protocols-connected',
      label: 'All Protocols (connected)',
      description: 'Open one connected tab for every protocol',
      category: 'sessions',
      action: () => {
        for (const proto of PROTOCOLS) {
          const session = createMockSession(proto, 'connected');
          dispatch({ type: 'ADD_SESSION', payload: session });
        }
      },
    });

    list.push({
      id: 'spawn-all-protocols-error',
      label: 'All Protocols (error)',
      description: 'Open one error tab for every protocol',
      category: 'sessions',
      action: () => {
        for (const proto of PROTOCOLS) {
          const session = createMockSession(proto, 'error');
          dispatch({ type: 'ADD_SESSION', payload: session });
        }
      },
    });

    list.push({
      id: 'spawn-all-rdp-errors',
      label: 'All RDP Error Variants',
      description: 'Open tabs for every RDP error category',
      category: 'errors',
      action: () => {
        for (const [label, msg] of Object.entries(RDP_ERROR_MESSAGES)) {
          const session = createMockSession('rdp', 'error', `[Debug] RDP ${label}`, msg);
          dispatch({ type: 'ADD_SESSION', payload: session });
        }
      },
    });

    list.push({
      id: 'spawn-mixed-stress',
      label: 'Stress Test (50 tabs)',
      description: 'Open 50 random sessions in mixed states',
      category: 'sessions',
      action: () => {
        for (let i = 0; i < 50; i++) {
          const proto = PROTOCOLS[Math.floor(Math.random() * PROTOCOLS.length)];
          const status = SESSION_STATUSES[Math.floor(Math.random() * SESSION_STATUSES.length)];
          const session = createMockSession(proto, status, `[Stress ${i + 1}] ${proto.toUpperCase()}`);
          dispatch({ type: 'ADD_SESSION', payload: session });
        }
      },
    });

    // ── State actions ─────────────────────────────────────────────
    list.push({
      id: 'close-all-debug',
      label: 'Close All Debug Sessions',
      description: 'Remove all sessions whose name starts with [Debug] or [Stress]',
      category: 'state',
      action: () => {
        for (const s of sessions) {
          if (s.name.startsWith('[Debug]') || s.name.startsWith('[Stress')) {
            dispatch({ type: 'REMOVE_SESSION', payload: s.id });
          }
        }
      },
    });

    list.push({
      id: 'close-all-sessions',
      label: 'Close All Sessions',
      description: 'Remove every session tab',
      category: 'state',
      action: () => {
        for (const s of sessions) {
          dispatch({ type: 'REMOVE_SESSION', payload: s.id });
        }
      },
    });

    // ── UI Actions ────────────────────────────────────────────────
    list.push({
      id: 'open-devtools',
      label: 'Open WebView DevTools',
      description: 'Open the Tauri/WebView developer console',
      category: 'ui',
      action: handleOpenDevtools,
    });

    list.push({
      id: 'throw-error',
      label: 'Throw Test Error',
      description: 'Trigger a console.error to test ErrorLogBar',
      category: 'ui',
      action: () => {
        console.error('[Debug] Test error triggered from Debug Panel at', new Date().toISOString());
      },
    });

    list.push({
      id: 'throw-unhandled',
      label: 'Throw Unhandled Exception',
      description: 'Trigger an unhandled throw for ErrorBoundary testing',
      category: 'ui',
      action: () => {
        setTimeout(() => {
          throw new Error('[Debug] Unhandled test exception');
        }, 0);
      },
    });

    list.push({
      id: 'log-state',
      label: 'Dump State to Console',
      description: 'Log current sessions and connection count to devtools console',
      category: 'state',
      action: () => {
        console.group('[Debug] App State Dump');
        console.log('Sessions:', sessions.length, sessions);
        console.log('Timestamp:', new Date().toISOString());
        console.groupEnd();
      },
    });

    return list;
  }, [addSession, createMockSession, dispatch, sessions, handleOpenDevtools]);

  const filteredActions = useMemo(() => {
    if (!filter) return actions;
    const q = filter.toLowerCase();
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.includes(q),
    );
  }, [actions, filter]);

  const categories = useMemo(() => {
    const cats = ['sessions', 'errors', 'state', 'ui'] as const;
    return cats.map((cat) => ({
      key: cat,
      label: { sessions: 'Mock Sessions', errors: 'Error Screens', state: 'State Management', ui: 'UI & DevTools' }[cat],
      actions: filteredActions.filter((a) => a.category === cat),
    }));
  }, [filteredActions]);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategory((prev) => (prev === cat ? null : cat));
  }, []);

  return {
    filter,
    setFilter,
    expandedCategory,
    toggleCategory,
    categories,
    sessionCount: sessions.length,
    debugSessionCount: sessions.filter((s) => s.name.startsWith('[Debug]') || s.name.startsWith('[Stress')).length,
  };
}
