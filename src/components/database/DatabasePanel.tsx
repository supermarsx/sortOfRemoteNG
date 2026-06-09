import React from "react";
import { useDatabaseSelector } from "../../hooks/connection/useDatabaseSelector";
import DatabaseList from "./list/DatabaseList";

interface DatabasePanelProps {
  /** Tool-panel close handler (closes the tab). */
  onClose: () => void;
  /**
   * Called when the user opens a database. The panel doesn't navigate by
   * itself; it just hands the id (and optional password) back to the App,
   * which decides what to do next.
   */
  onDatabaseSelect?: (
    databaseId: string,
    password?: string,
  ) => Promise<void> | void;
  /**
   * Called when the user closes the currently-open database from the
   * row toolbar. Lets the App clear connection state, drop the
   * auto-open-last pointer, and surface the empty-library view.
   */
  onDatabaseClose?: () => Promise<void> | void;
}

/**
 * Tab-format Databases panel.
 *
 * Lives inside ToolPanel like the Tag Manager / Tab Group Manager. The tab
 * bar already provides the tab title, so the panel renders its own heading
 * directly in the content — no DialogHeader, no modal chrome.
 */
export const DatabasePanel: React.FC<DatabasePanelProps> = ({
  onClose,
  onDatabaseSelect,
  onDatabaseClose,
}) => {
  const mgr = useDatabaseSelector(
    true,
    onDatabaseSelect ?? (() => Promise.resolve()),
    onDatabaseClose,
  );

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <DatabaseList mgr={mgr} onClose={onClose} />
      </div>
    </div>
  );
};

export default DatabasePanel;
