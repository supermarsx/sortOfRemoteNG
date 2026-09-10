import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
export default function DashboardView({ mgr }: SubProps) {
  const d = mgr.dashboard;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="NAS overview"
        rows={d?.systemInfo ? [d.systemInfo] : []}
        columns={[
          ["model", "Model"],
          ["version", "DSM"],
          ["serial", "Serial"],
          ["uptime", "Uptime seconds"],
          ["temperature", "Temperature °C"],
        ]}
      />
      <AdminTable
        title="CPU overview"
        rows={d?.utilization?.cpu ? [d.utilization.cpu] : []}
        columns={[
          ["systemLoad", "System %"],
          ["userLoad", "User %"],
        ]}
      />
      <AdminTable
        title="Volume overview"
        rows={d?.storage?.volumes ?? []}
        columns={[
          ["displayName", "Volume"],
          ["status", "Status"],
          ["sizeTotal", "Total bytes"],
          ["sizeUsed", "Used bytes"],
        ]}
      />
      <AdminTable
        title="Network overview"
        rows={d?.network ? [d.network] : []}
        columns={[
          ["hostname", "Host"],
          ["gateway", "Gateway"],
          ["dns", "DNS"],
        ]}
      />
    </div>
  );
}
