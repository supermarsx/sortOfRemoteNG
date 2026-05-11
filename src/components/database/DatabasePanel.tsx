import React from "react";
import { Database, Plus, Upload } from "lucide-react";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { useDatabaseSelector } from "../../hooks/connection/useDatabaseSelector";
import { useTranslation } from "react-i18next";
import CollectionsTab from "../connection/collectionSelector/CollectionsTab";

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
}

/**
 * Tab-format replacement for the old <CollectionSelector> modal.
 *
 * Renders inside the ToolPanel like the Tag Manager and Tab Group Manager.
 * The list, create, import, unlock, and clone flows are reused verbatim
 * from CollectionsTab — only the framing (modal → flush panel) changes.
 */
export const DatabasePanel: React.FC<DatabasePanelProps> = ({
  onClose,
  onDatabaseSelect,
}) => {
  const { t } = useTranslation();
  const mgr = useDatabaseSelector(
    true,
    onDatabaseSelect ?? (() => Promise.resolve()),
  );

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <DialogHeader
        icon={Database}
        iconColor="text-primary"
        iconBg="bg-primary/20"
        title={t("collectionCenter.title")}
        subtitle={t("collectionCenter.subtitle")}
        onClose={onClose}
        sticky
        actions={
          <>
            <button
              onClick={() => mgr.setShowImportForm(true)}
              className="sor-btn-secondary-sm"
            >
              <Upload size={14} />
              <span>{t("collectionCenter.actions.import")}</span>
            </button>
            <button
              onClick={() => mgr.setShowCreateForm(true)}
              className="sor-btn-primary-sm"
              data-testid="database-create"
            >
              <Plus size={14} />
              <span>{t("connections.new")}</span>
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto p-6">
          <CollectionsTab mgr={mgr} />
        </div>
      </div>
    </div>
  );
};

export default DatabasePanel;
