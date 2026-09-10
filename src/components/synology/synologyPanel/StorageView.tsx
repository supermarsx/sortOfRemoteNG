import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
export default function StorageView({ mgr }: SubProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="Disks"
        rows={mgr.disks}
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
        columns={[
          ["id", "ID"],
          ["status", "Status"],
          ["raidType", "RAID"],
          ["size", "Bytes"],
          ["disks", "Disks"],
        ]}
      />
      <AdminTable
        title="SSD caches"
        rows={mgr.storageOverview?.ssdCaches ?? []}
        columns={[
          ["id", "ID"],
          ["status", "Status"],
          ["size", "Bytes"],
          ["readHit", "Read hits"],
          ["writeHit", "Write hits"],
        ]}
      />
      <AdminTable
        title="Hot spares"
        rows={mgr.storageOverview?.hotSpares ?? []}
        columns={[
          ["diskId", "Disk"],
          ["status", "Status"],
        ]}
      />
    </div>
  );
}
