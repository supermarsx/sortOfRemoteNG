import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Filter,
  Trash2,
  Search,
  Clock,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionLogEntry } from '../types/settings';
import { SettingsManager } from '../utils/settingsManager';

const LEVEL_ICONS: Record<string, JSX.Element> = {
  debug: <Bug className="text-gray-400" size={14} />,
  info: <Info className="text-blue-400" size={14} />,
  warn: <AlertTriangle className="text-yellow-400" size={14} />,
  error: <AlertCircle className="text-red-400" size={14} />,
};

const DEFAULT_ICON = <Info className="text-gray-400" size={14} />;

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

interface ActionLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ActionLogViewer: React.FC<ActionLogViewerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<ActionLogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<ActionLogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const settingsManager = SettingsManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      loadLogs();
      const interval = setInterval(loadLogs, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  useEffect(() => {
    filterLogs();
  }, [logs, searchTerm, levelFilter]);

  const loadLogs = () => {
    const actionLogs = settingsManager.getActionLog();
    setLogs(actionLogs);
  };

  const filterLogs = () => {
    let filtered = logs;

    if (levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === levelFilter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(log =>
        log.action.toLowerCase().includes(term) ||
        log.details.toLowerCase().includes(term) ||
        log.connectionName?.toLowerCase().includes(term)
      );
    }

    setFilteredLogs(filtered);
  };

  const clearLogs = () => {
    if (confirm('Are you sure you want to clear all logs?')) {
      settingsManager.clearActionLog();
      setLogs([]);
    }
  };

  const exportLogs = () => {
    const csvContent = [
      'Timestamp,Level,Action,Connection,Details,Duration',
      ...filteredLogs.map(log =>
        `"${log.timestamp.toISOString()}","${log.level}","${log.action}","${log.connectionName || ''}","${log.details.replace(/"/g, '""')}","${log.duration || ''}"`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `action-log-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getLevelIcon = (level: string) => LEVEL_ICONS[level] ?? DEFAULT_ICON;

  const getLevelColor = (level: string) => {
    return LEVEL_COLORS[level] ?? 'text-gray-400';
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">{t('logs.title')}</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={exportLogs}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Download size={14} />
              <span>{t('logs.export')}</span>
            </button>
            <button
              onClick={clearLogs}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Trash2 size={14} />
              <span>{t('logs.clear')}</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-700 bg-gray-750">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Filter size={16} className="text-gray-400" />
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>

            <div className="text-sm text-gray-400">
              {filteredLogs.length} of {logs.length} entries
            </div>
          </div>
        </div>

        {/* Log Table */}
        <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
          <table className="w-full">
            <thead className="bg-gray-700 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  <div className="flex items-center space-x-1">
                    <Clock size={12} />
                    <span>{t('logs.timestamp')}</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {t('logs.level')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {t('logs.action')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {t('logs.connection')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {t('logs.details')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-600">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    <div>
                      <div>{log.timestamp.toLocaleDateString()}</div>
                      <div className="text-xs text-gray-500">
                        {log.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className={`flex items-center space-x-2 ${getLevelColor(log.level)}`}>
                      {getLevelIcon(log.level)}
                      <span className="capitalize">{log.level}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-white font-medium">
                    {log.action}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {log.connectionName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300 max-w-md">
                    <div className="truncate" title={log.details}>
                      {log.details}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {log.duration ? `${log.duration}ms` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredLogs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <AlertCircle size={48} className="mb-4" />
              <p className="text-lg font-medium mb-2">No log entries found</p>
              <p className="text-sm">Try adjusting your search or filter criteria</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
