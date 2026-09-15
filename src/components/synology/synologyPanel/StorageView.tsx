import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
import SynologySectionRestriction, {
  synologyTabAccess,
} from "./SynologySectionRestriction";
export default function StorageView({ mgr }: SubProps) {
  const access = synologyTabAccess(mgr, "storage");
  if (access.section)
    return <SynologySectionRestriction access={access.section} />;
  const overview = access.restriction("storageOverview");
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="Disks"
        rows={mgr.disks}
        restriction={access.restriction("disks")}
        columns={[
          ["id", "ID"],
          ["name", "Name"],
          ["model", "Model"],
          ["sizeTotal", "Bytes"],
          ["temp", "Temperature °C"],
          ["status", "Status"],
          ["smartStatus", "SMART"],
        ]}
        actions={(row) => (
          <button
            className="sor-btn-secondary-sm"
            onClick={() => void mgr.loadSmartInfo(String(row.id))}
          >
            SMART details
          </button>
        )}
      />
      {mgr.selectedDiskSmart && (
        <>
          <AdminTable
            title="SMART health"
            rows={[mgr.selectedDiskSmart]}
            columns={[
              ["diskName", "Disk"],
              ["healthStatus", "Health"],
              ["temperature", "Temperature °C"],
              ["powerOnHours", "Power-on hours"],
              ["reallocatedSectors", "Reallocated sectors"],
            ]}
          />
          <AdminTable
            title="SMART attributes"
            rows={mgr.selectedDiskSmart.attributes ?? []}
            columns={[
              ["id", "ID"],
              ["name", "Name"],
              ["current", "Current"],
              ["worst", "Worst"],
              ["threshold", "Threshold"],
              ["raw", "Raw value"],
              ["status", "Status"],
            ]}
          />
        </>
      )}
      <AdminTable
        title="Volumes"
        rows={mgr.volumes}
        restriction={access.restriction("volumes")}
        columns={[
          ["id", "ID"],
          ["displayName", "Name"],
          ["status", "Status"],
          ["fsType", "Filesystem"],
          ["sizeTotal", "Total bytes"],
          ["sizeUsed", "Used bytes"],
          ["sizeFree", "Free bytes"],
          ["usagePercent", "Used %"],
        ]}
      />
      <AdminTable
        title="Storage pools"
        rows={mgr.storageOverview?.storagePools ?? []}
        restriction={overview}
        columns={[
          ["id", "ID"],
          ["status", "Status"],
          ["raidType", "RAID"],
          ["sizeTotal", "Total bytes"],
          ["sizeUsed", "Used bytes"],
          ["disks", "Disks"],
        ]}
      />
      <AdminTable
        title="SSD caches"
        rows={mgr.storageOverview?.ssdCaches ?? []}
        restriction={overview}
        columns={[
          ["id", "ID"],
          ["status", "Status"],
          ["size", "Bytes"],
          ["readHit", "Read hit rate %"],
          ["disks", "Disks"],
        ]}
      />
      <AdminTable
        title="Hot spares"
        rows={mgr.storageOverview?.hotSpares ?? []}
        restriction={overview}
        columns={[
          ["diskId", "Disk"],
          ["poolId", "Pool"],
        ]}
      />
    </div>
  );
}
