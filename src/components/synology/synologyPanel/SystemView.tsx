import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
export default function SystemView({ mgr }: SubProps) {
  const info = mgr.systemInfo,
    util = mgr.utilization;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="System information"
        rows={info ? [info] : []}
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
        columns={[
          ["device", "Device"],
          ["rx", "Received"],
          ["tx", "Sent"],
        ]}
      />
      <AdminTable
        title="Disk utilization"
        rows={util?.disk ?? []}
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
