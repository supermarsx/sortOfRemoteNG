import React from "react";
import { Database, Plus, Upload } from "lucide-react";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { useCollectionSelector } from "../../hooks/connection/useDatabaseSelector";
import { useTranslation } from "react-i18next";
import CollectionsTab from "./collectionSelector/CollectionsTab";

interface CollectionSelectorProps {
  isOpen: boolean;
  onCollectionSelect: (
    collectionId: string,
    password?: string,
  ) => Promise<void> | void;
  onClose: () => void;
  /** Reserved for future tabs; currently unused. */
  initialTab?: "collections";
}

export const CollectionSelector: React.FC<CollectionSelectorProps> = ({
  isOpen,
  onCollectionSelect,
  onClose,
  initialTab,
}) => {
  const { t } = useTranslation();
  const mgr = useCollectionSelector(isOpen, onCollectionSelect);
  const { setActiveTab } = mgr;

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab, setActiveTab]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-5xl h-[90vh] rounded-lg overflow-hidden"
      contentClassName="bg-[var(--color-surface)]"
      dataTestId="collection-selector"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <DialogHeader
          icon={Database}
          iconColor="text-primary"
          iconBg="bg-primary/20"
          title={t("databaseCenter.title")}
          subtitle={t("databaseCenter.subtitle")}
          onClose={onClose}
          sticky
          actions={
            <>
              <button
                onClick={() => mgr.setShowImportForm(true)}
                className="sor-btn-secondary-sm"
              >
                <Upload size={14} />
                <span>{t("databaseCenter.actions.import")}</span>
              </button>
              <button
                onClick={() => mgr.setShowCreateForm(true)}
                className="sor-btn-primary-sm"
                data-testid="collection-create"
              >
                <Plus size={14} />
                <span>{t("connections.new")}</span>
              </button>
            </>
          }
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-6">
            <CollectionsTab mgr={mgr} />
          </div>
        </div>
      </div>
    </Modal>
  );
};

