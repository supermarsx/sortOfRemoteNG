import React from 'react';
import { X, Monitor, Terminal, Eye, Globe, Phone, Wifi, WifiOff } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useConnections } from '../contexts/ConnectionContext';

const getProtocolIcon = (protocol: string) => {
  switch (protocol) {
    case 'rdp':
      return Monitor;
    case 'ssh':
      return Terminal;
    case 'vnc':
      return Eye;
    case 'http':
    case 'https':
      return Globe;
    case 'telnet':
    case 'rlogin':
      return Phone;
    default:
      return Monitor;
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'connected':
      return Wifi;
    case 'connecting':
      return Wifi;
    case 'disconnected':
    case 'error':
      return WifiOff;
    default:
      return WifiOff;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'connected':
      return 'text-green-400';
    case 'connecting':
      return 'text-yellow-400 animate-pulse';
    case 'error':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
};

interface SessionTabsProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
}

export const SessionTabs: React.FC<SessionTabsProps> = ({
  activeSessionId,
  onSessionSelect,
}) => {
  const { state, dispatch } = useConnections();

  const handleCloseSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'REMOVE_SESSION', payload: sessionId });
  };

  if (state.sessions.length === 0) {
    return (
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-center">
        <span className="text-gray-500 text-sm">No active sessions</span>
      </div>
    );
  }

  return (
    <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center overflow-x-auto">
      {state.sessions.map((session) => {
        const ProtocolIcon = getProtocolIcon(session.protocol);
        const StatusIcon = getStatusIcon(session.status);
        const isActive = session.id === activeSessionId;

        return (
          <div
            key={session.id}
            className={`flex items-center h-full px-3 cursor-pointer border-r border-gray-700 min-w-0 ${
              isActive
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700/50'
            } transition-colors`}
            onClick={() => onSessionSelect(session.id)}
          >
            <ProtocolIcon size={14} className="mr-2 flex-shrink-0" />
            <span className="truncate text-sm mr-2 max-w-32">
              {session.name}
            </span>
            <StatusIcon
              size={12}
              className={`mr-2 flex-shrink-0 ${getStatusColor(session.status)}`}
            />
            <button
              onClick={(e) => handleCloseSession(session.id, e)}
              className="flex-shrink-0 p-1 hover:bg-gray-600 rounded transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};