import React, { useRef } from "react";
import type { LucideIcon } from "lucide-react";

export interface SidebarTabDescriptor<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

export interface SidebarTabsProps<Id extends string> {
  tabs: readonly SidebarTabDescriptor<Id>[];
  activeTab: Id;
  onTabChange: (id: Id) => void;
  /** Namespace for `-tab-${id}` / `-panel-${id}` ids, e.g. "proxy-chain-menu". */
  idPrefix: string;
  ariaLabel: string;
}

/**
 * Vertical ARIA tablist with roving tabIndex: the list holds exactly one tab
 * stop, and Up/Down/Home/End move focus between tabs from there.
 */
export function SidebarTabs<Id extends string>({
  tabs,
  activeTab,
  onTabChange,
  idPrefix,
  ariaLabel,
}: SidebarTabsProps<Id>): React.JSX.Element {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    tabRefs.current[index]?.focus();
    onTabChange(tab.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((tab) => tab.id === activeTab);
    if (current === -1 || tabs.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        selectTab((current + 1) % tabs.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        selectTab((current - 1 + tabs.length) % tabs.length);
        break;
      case "Home":
        event.preventDefault();
        selectTab(0);
        break;
      case "End":
        event.preventDefault();
        selectTab(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="w-56 border-r border-[var(--color-border)] p-4 space-y-2 overflow-y-auto"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-testid={`${idPrefix}-tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={handleKeyDown}
            className={`sor-sidebar-tab ${isActive ? "sor-sidebar-tab-active" : ""}`}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default SidebarTabs;
