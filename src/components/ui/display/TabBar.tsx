import React from 'react';
import { type LucideIcon } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  /** Custom active color class, e.g. "border-green-500 text-green-400".
   *  Defaults to "border-blue-500 text-blue-400" */
  activeColor?: string;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Additional className on the wrapper */
  className?: string;
}

const DEFAULT_ACTIVE = 'border-blue-500 text-blue-400';
const INACTIVE = 'border-transparent text-[var(--color-textSecondary)] hover:text-gray-200';

/**
 * Horizontal tab bar with optional icons and counts.
 * Uses a bottom‑border indicator for the active tab.
 */
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}) => (
  <div className={cx('flex border-b border-[var(--color-border)]', className)}>
    {tabs.map((tab) => {
      const isActive = tab.id === activeTab;
      const Icon = tab.icon;
      return (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cx(
            'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
            isActive ? (tab.activeColor || DEFAULT_ACTIVE) : INACTIVE,
          )}
        >
          {Icon && <Icon size={14} />}
          {tab.label}
          {tab.count !== undefined && ` (${tab.count})`}
        </button>
      );
    })}
  </div>
);
