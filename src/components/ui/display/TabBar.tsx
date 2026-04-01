import React, { useCallback, useRef } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx';

export interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  /** Custom active color class, e.g. "border-success text-success".
   *  Defaults to "border-primary text-primary" */
  activeColor?: string;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Additional className on the wrapper */
  className?: string;
}

const DEFAULT_ACTIVE = 'border-primary text-primary';
const INACTIVE = 'border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]';

/**
 * Horizontal tab bar with optional icons and counts.
 * Uses a bottom‑border indicator for the active tab.
 */
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}) => {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      onTabChange(tabs[nextIndex].id);
      tabRefs.current[nextIndex]?.focus();
    },
    [tabs, activeTab, onTabChange],
  );

  return (
    <div
      role="tablist"
      className={cx('flex border-b border-[var(--color-border)]', className)}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[index] = el; }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
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
};
