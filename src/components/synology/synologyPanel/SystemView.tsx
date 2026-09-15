import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
import SynologySectionRestriction, {
  synologyTabAccess,
} from "./SynologySectionRestriction";
export default function SystemView({ mgr }: SubProps) {
  const access = synologyTabAccess(mgr, "system");
  if (access.section)
    return <SynologySectionRestriction access={access.section} />;
  const info = mgr.systemInfo,
    util = mgr.utilization;
  const utilization = access.restriction("utilization");
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="System information"
        rows={info ? [info] : []}
        restriction={access.restriction("systemInfo")}
        columns={[
          ["model", "Model"],
          ["serial", "Serial"],
          ["version", "DSM"],
          ["versionString", "Build"],
          ["uptime", "Uptime seconds"],
          ["temperature", "Temperature °C"],
          ["ram", "RAM MB"],
        ]}
      />
      <AdminTable
        title="CPU"
        rows={util?.cpu ? [util.cpu] : []}
        restriction={utilization}
        columns={[
          ["systemLoad", "System %"],
          ["userLoad", "User %"],
          ["otherLoad", "Other %"],
          ["1min_load", "1 minute load"],
          ["5min_load", "5 minute load"],
          ["15min_load", "15 minute load"],
        ]}
      />
      <AdminTable
        title="Memory"
        rows={util?.memory ? [util.memory] : []}
        restriction={utilization}
        columns={[
          ["totalReal", "Total"],
          ["availReal", "Available"],
          ["cached", "Cached"],
          ["buffer", "Buffer"],
          ["realUsage", "Usage %"],
        ]}
      />
      <AdminTable
        title="Network utilization"
        rows={util?.network ?? []}
        restriction={utilization}
        columns={[
          ["device", "Device"],
          ["rx", "Received"],
          ["tx", "Sent"],
        ]}
      />
      <AdminTable
        title="Disk utilization"
        rows={util?.disk ?? []}
        restriction={utilization}
        columns={[
          ["device", "Device"],
          ["displayName", "Name"],
          ["utilization", "Utilization %"],
          ["readByte", "Read bytes"],
          ["writeByte", "Written bytes"],
        ]}
      />
    </div>
  );
}
