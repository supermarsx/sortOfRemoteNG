import type { SubProps } from "./types";
import AdminTable from "./AdminTable";
import SynologySectionRestriction, {
  synologyTabAccess,
} from "./SynologySectionRestriction";
export default function DashboardView({ mgr }: SubProps) {
  const access = synologyTabAccess(mgr, "dashboard");
  if (access.section)
    return <SynologySectionRestriction access={access.section} />;
  const d = mgr.dashboard;
  // The overview command returns each part independently; a missing part is
  // explained instead of looking like an empty NAS.
  const missing = (part: unknown, section: string) =>
    d && !part
      ? `DSM did not return this part of the overview. Open ${section} for details.`
      : undefined;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <AdminTable
        title="NAS overview"
        rows={d?.systemInfo ? [d.systemInfo] : []}
        restriction={access.restriction("systemInfo")}
        emptyMessage={missing(d?.systemInfo, "System")}
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
        restriction={access.restriction("utilization")}
        emptyMessage={missing(d?.utilization, "System")}
        columns={[
          ["systemLoad", "System %"],
          ["userLoad", "User %"],
        ]}
      />
      <AdminTable
        title="Volume overview"
        rows={d?.storage?.volumes ?? []}
        restriction={access.restriction("storageOverview")}
        emptyMessage={missing(d?.storage, "Storage")}
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
        restriction={access.restriction("networkOverview")}
        emptyMessage={missing(d?.network, "Network")}
        columns={[
          ["hostname", "Host"],
          ["gateway", "Gateway"],
          ["dns", "DNS"],
        ]}
      />
    </div>
  );
}
