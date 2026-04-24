import { ImportExport } from "../../ImportExport";
import { useTranslation } from "react-i18next";

function ConnectionsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="sor-section-card">
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
          {t("collectionCenter.connections.title")}
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          {t("collectionCenter.connections.description")}
        </p>
        <ImportExport isOpen onClose={() => undefined} embedded />
      </div>
    </div>
  );
}

export default ConnectionsTab;
