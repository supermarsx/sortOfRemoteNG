import { ImportExport } from "../../ImportExport";

function ConnectionsTab() {
  return (
    <div className="space-y-6">
      <div className="sor-section-card">
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
          Connection Import / Export
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Manage connection backups and transfers without leaving the collection
          center.
        </p>
        <ImportExport isOpen onClose={() => undefined} embedded />
      </div>
    </div>
  );
}

export default ConnectionsTab;
