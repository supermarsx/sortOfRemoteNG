import React from 'react';
import { Download, FileText, Database, Settings, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../ui/forms';
import { Checkbox } from '../ui/forms';
import { Connection } from '../../types/connection/connection';

export interface ExportConfig {
  format: 'json' | 'xml' | 'csv';
  includePasswords: boolean;
  encrypted: boolean;
  password: string;
}

interface ExportTabProps {
  connections: Connection[];
  config: ExportConfig;
  onConfigChange: (update: Partial<ExportConfig>) => void;
  isProcessing: boolean;
  handleExport: () => void;
}

const ExportTab: React.FC<ExportTabProps> = ({
  connections,
  config,
  onConfigChange,
  isProcessing,
  handleExport,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">{t('exportTab.title')}</h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          {t('exportTab.description')}
        </p>
        <div className="bg-[var(--color-border)] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--color-textSecondary)]">{t('exportTab.totalConnections')}:</span>
            <span className="text-[var(--color-text)] font-medium">{connections.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-textSecondary)]">{t('exportTab.groups')}:</span>
            <span className="text-[var(--color-text)] font-medium">
              {connections.filter(c => c.isGroup).length}
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          {t('exportTab.exportFormat')}
        </label>
        <div className="grid grid-cols-3 gap-3" data-testid="export-format">
          {[
            { value: 'json' as const, label: 'JSON', icon: FileText, desc: t('exportTab.formatJson') },
            { value: 'xml' as const, label: 'XML', icon: Database, desc: t('exportTab.formatXml') },
            { value: 'csv' as const, label: 'CSV', icon: Settings, desc: t('exportTab.formatCsv') },
          ].map(format => (
            <button
              key={format.value}
              onClick={() => onConfigChange({ format: format.value })}
              className={`p-4 rounded-lg border-2 transition-colors ${
                config.format === format.value
                  ? 'border-primary bg-primary/20'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border)]'
              }`}
            >
              <format.icon size={24} className="mx-auto mb-2 text-[var(--color-textSecondary)]" />
              <div className="text-[var(--color-text)] font-medium">{format.label}</div>
              <div className="text-xs text-[var(--color-textSecondary)] mt-1">{format.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <Checkbox checked={config.includePasswords} onChange={(val: boolean) => onConfigChange({ includePasswords: val })} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
          <span className="text-[var(--color-textSecondary)]">{t('exportTab.includePasswords')}</span>
        </label>

        <label className="flex items-center space-x-2">
          <Checkbox checked={config.encrypted} onChange={(val: boolean) => onConfigChange({ encrypted: val })} data-testid="export-encrypt" className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
          <span className="text-[var(--color-textSecondary)]">{t('exportTab.encryptExport')}</span>
          <Lock size={16} className="text-warning" />
        </label>

        {config.encrypted && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              {t('exportTab.encryptionPassword')}
            </label>
            <PasswordInput
              value={config.password}
              onChange={e => onConfigChange({ password: e.target.value })}
              className="sor-form-input"
              placeholder={t('exportTab.enterPassword')}
              autoComplete="new-password"
              data-testid="export-password"
            />
          </div>
        )}
      </div>

      <button
        onClick={handleExport}
        disabled={isProcessing || connections.length === 0 || (config.encrypted && !config.password)}
        data-testid="export-confirm"
        className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--color-border)]"></div>
            <span>{t('exportTab.exporting')}</span>
          </>
        ) : (
          <>
            <Download size={16} />
            <span>{t('exportTab.exportButton')}</span>
          </>
        )}
      </button>
    </div>
  );
};

export default ExportTab;
