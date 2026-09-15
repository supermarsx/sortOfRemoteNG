import type { ReactNode } from "react";
import type { SynologyTab } from "../../../hooks/synology/synologyAdminData";
import type { SubProps } from "./types";
import AdminTable, { type AdminColumn } from "./AdminTable";
import SynologySectionRestriction, {
  synologyTabAccess,
  type SynologyReadRestrictionView,
  type SynologyTabAccess,
} from "./SynologySectionRestriction";
const panel = (
  mgr: SubProps["mgr"],
  tab: SynologyTab,
  render: (access: SynologyTabAccess) => ReactNode,
) => {
  const access = synologyTabAccess(mgr, tab);
  return access.section ? (
    <SynologySectionRestriction access={access.section} />
  ) : (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      {render(access)}
    </div>
  );
};
const rows = (value: unknown) =>
  value && typeof value === "object" ? [value] : [];
function RowActions({
  mgr,
  row,
  items,
}: {
  mgr: SubProps["mgr"];
  row: Record<string, unknown>;
  items: readonly (readonly [string, string, string, string])[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([id, label, arg, key]) => (
        <button
          key={id}
          className="sor-btn-secondary-sm"
          disabled={mgr.actions.busy || row[key] == null}
          onClick={() => mgr.actions.open(id, { [arg]: String(row[key]) })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
const table = (
  title: string,
  data: readonly unknown[],
  columns: readonly AdminColumn[],
  restriction: SynologyReadRestrictionView | undefined,
  actions?: (row: Record<string, unknown>) => ReactNode,
) => (
  <AdminTable
    title={title}
    rows={data}
    columns={columns}
    actions={actions}
    restriction={restriction}
  />
);
export function SharesView({ mgr }: SubProps) {
  return panel(mgr, "shares", (access) =>
    table(
      "Shared folders",
      mgr.sharedFolders,
      [
        ["name", "Name"],
        ["path", "Path"],
        ["volPath", "Volume"],
        ["desc", "Description"],
        ["status", "Status"],
        ["encryption", "Encryption"],
      ],
      access.restriction("sharedFolders"),
      (row) => (
        <RowActions
          mgr={mgr}
          row={row}
          items={[
            ["permissions", "Permissions", "name", "name"],
            ["share-mount", "Unlock", "name", "name"],
            ["share-unmount", "Lock", "name", "name"],
            ["share-delete", "Delete", "name", "name"],
          ]}
        />
      ),
    ),
  );
}
export function NetworkView({ mgr }: SubProps) {
  return panel(mgr, "network", (access) => (
    <>
      {table(
        "Network",
        rows(mgr.networkOverview),
        [
          ["hostname", "Host"],
          ["gateway", "Gateway"],
          ["dns", "DNS"],
          ["workgroup", "Workgroup"],
        ],
        access.restriction("networkOverview"),
      )}
      {table(
        "Interfaces",
        mgr.networkInterfaces,
        [
          ["id", "ID"],
          ["name", "Name"],
          ["ip", "IP"],
          ["subnet", "Mask"],
          ["mac", "MAC"],
          ["status", "Status"],
          ["linkSpeed", "Speed"],
          ["mtu", "MTU"],
        ],
        access.restriction("networkInterfaces"),
      )}
      {table(
        "Firewall rules",
        mgr.firewallRules,
        [
          ["adapter", "Adapter"],
          ["action", "Action"],
          ["protocol", "Protocol"],
          ["srcPort", "Ports"],
          ["srcIp", "Source"],
          ["enabled", "Enabled"],
        ],
        access.restriction("firewallRules"),
      )}
    </>
  ));
}
export function UsersView({ mgr }: SubProps) {
  return panel(mgr, "users", (access) => (
    <>
      {table(
        "Users",
        mgr.users,
        [
          ["name", "Username"],
          ["uid", "UID"],
          ["description", "Description"],
          ["email", "Email"],
          ["expired", "Expires"],
        ],
        access.restriction("users"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[["user-delete", "Delete", "name", "name"]]}
          />
        ),
      )}
      {table(
        "Groups",
        mgr.groups,
        [
          ["name", "Name"],
          ["gid", "GID"],
          ["description", "Description"],
          ["members", "Members"],
        ],
        access.restriction("groups"),
      )}
    </>
  ));
}
export function PackagesView({ mgr }: SubProps) {
  return panel(mgr, "packages", (access) =>
    table(
      "Packages",
      mgr.packages,
      [
        ["id", "ID"],
        ["name", "Name"],
        ["version", "Version"],
        ["status", "Status"],
        ["updateVersion", "Available version"],
      ],
      access.restriction("packages"),
      (row) => (
        <RowActions
          mgr={mgr}
          row={row}
          items={[
            ["package-start", "Start", "id", "id"],
            ["package-stop", "Stop", "id", "id"],
            ["package-remove", "Uninstall", "id", "id"],
          ]}
        />
      ),
    ),
  );
}
export function ServicesView({ mgr }: SubProps) {
  return panel(mgr, "services", (access) => (
    <>
      {table(
        "Services",
        mgr.services,
        [
          ["name", "Service"],
          ["enabled", "Enabled"],
          ["running", "Running"],
          ["port", "Port"],
          ["serviceType", "Type"],
        ],
        access.restriction("services"),
      )}
      {table(
        "SMB",
        rows(mgr.smbConfig),
        [
          ["enabled", "Enabled"],
          ["workgroup", "Workgroup"],
          ["minProtocol", "Minimum protocol"],
          ["maxProtocol", "Maximum protocol"],
        ],
        access.restriction("smbConfig"),
      )}
      {table(
        "NFS",
        rows(mgr.nfsConfig),
        [
          ["enabled", "Enabled"],
          ["enableNfsV4", "NFS v4"],
          ["domain", "Domain"],
        ],
        access.restriction("nfsConfig"),
      )}
      {table(
        "SSH",
        rows(mgr.sshConfig),
        [
          ["enabled", "Enabled"],
          ["port", "Port"],
        ],
        access.restriction("sshConfig"),
      )}
    </>
  ));
}
export function DockerView({ mgr }: SubProps) {
  return panel(mgr, "docker", (access) => (
    <>
      {table(
        "Containers",
        mgr.dockerContainers,
        [
          ["id", "ID"],
          ["name", "Name"],
          ["image", "Image"],
          ["status", "Status"],
          ["state", "State"],
          ["cpuPercent", "CPU %"],
          ["memoryUsage", "Memory bytes"],
        ],
        access.restriction("dockerContainers"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[
              ["container-start", "Start", "name", "name"],
              ["container-stop", "Stop", "name", "name"],
              ["container-restart", "Restart", "name", "name"],
              ["container-delete", "Delete", "name", "name"],
            ]}
          />
        ),
      )}
      {table(
        "Images",
        mgr.dockerImages,
        [
          ["repository", "Repository"],
          ["tag", "Tag"],
          ["id", "ID"],
          ["size", "Bytes"],
        ],
        access.restriction("dockerImages"),
      )}
      {table(
        "Container networks",
        mgr.dockerNetworks,
        [
          ["name", "Name"],
          ["driver", "Driver"],
          ["subnet", "Subnet"],
          ["gateway", "Gateway"],
        ],
        access.restriction("dockerNetworks"),
      )}
      {table(
        "Projects",
        mgr.dockerProjects,
        [
          ["name", "Name"],
          ["status", "Status"],
          ["path", "Path"],
          ["services", "Services"],
        ],
        access.restriction("dockerProjects"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[
              ["project-start", "Start", "name", "name"],
              ["project-stop", "Stop", "name", "name"],
            ]}
          />
        ),
      )}
    </>
  ));
}
export function VmsView({ mgr }: SubProps) {
  return panel(mgr, "vms", (access) =>
    table(
      "Virtual machines",
      mgr.vms,
      [
        ["guestId", "VM ID"],
        ["guestName", "Name"],
        ["status", "Status"],
        ["vcpuNum", "vCPU"],
        ["vramSize", "RAM MB"],
        ["storageName", "Storage"],
      ],
      access.restriction("vms"),
      (row) => (
        <RowActions
          mgr={mgr}
          row={row}
          items={[
            ["vm-on", "Power on", "guestId", "guestId"],
            ["vm-off", "Shut down", "guestId", "guestId"],
            ["vm-force", "Force off", "guestId", "guestId"],
            ["vm-snapshots", "Snapshots", "guestId", "guestId"],
            ["vm-snapshot-create", "Take snapshot", "guestId", "guestId"],
          ]}
        />
      ),
    ),
  );
}
export function DownloadsView({ mgr }: SubProps) {
  return panel(mgr, "downloads", (access) => (
    <>
      {table(
        "Transfer rates",
        rows(mgr.downloadStats),
        [
          ["speedDownload", "Download bytes/s"],
          ["speedUpload", "Upload bytes/s"],
        ],
        access.restriction("downloadStats"),
      )}
      {table(
        "Downloads",
        mgr.downloadTasks,
        [
          ["id", "Task ID"],
          ["title", "Title"],
          ["status", "Status"],
          ["size", "Bytes"],
          ["sizeDownloaded", "Downloaded bytes"],
          ["percentDn", "Progress %"],
          ["destination", "Destination"],
        ],
        access.restriction("downloadTasks"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[
              ["download-pause", "Pause", "taskId", "id"],
              ["download-resume", "Resume", "taskId", "id"],
              ["download-delete", "Delete", "taskId", "id"],
            ]}
          />
        ),
      )}
    </>
  ));
}
export function SurveillanceView({ mgr }: SubProps) {
  return panel(mgr, "surveillance", (access) =>
    table(
      "Cameras",
      mgr.cameras,
      [
        ["id", "ID"],
        ["name", "Name"],
        ["ip", "IP"],
        ["model", "Model"],
        ["enabled", "Enabled"],
        ["status", "Status"],
        ["recording", "Recording"],
        ["resolution", "Resolution"],
      ],
      access.restriction("cameras"),
      (row) => (
        <RowActions
          mgr={mgr}
          row={row}
          items={[
            ["camera-snapshot", "Snapshot", "camId", "id"],
            ["recordings", "Recordings", "camId", "id"],
          ]}
        />
      ),
    ),
  );
}
export function BackupView({ mgr }: SubProps) {
  return panel(mgr, "backup", (access) => (
    <>
      {table(
        "Backup tasks",
        mgr.backupTasks,
        [
          ["taskId", "ID"],
          ["name", "Name"],
          ["status", "Status"],
          ["lastBackupTime", "Last backup"],
          ["nextBackupTime", "Next backup"],
          ["progress", "Progress"],
          ["destPath", "Destination"],
        ],
        access.restriction("backupTasks"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[
              ["backup-start", "Start", "taskId", "taskId"],
              ["backup-cancel", "Cancel task", "taskId", "taskId"],
              ["backup-versions", "Versions", "taskId", "taskId"],
            ]}
          />
        ),
      )}
      {table(
        "Active Backup devices",
        mgr.activeBackupDevices,
        [
          ["deviceId", "ID"],
          ["deviceName", "Name"],
          ["osName", "OS"],
          ["status", "Status"],
          ["lastBackup", "Last backup"],
        ],
        access.restriction("activeBackupDevices"),
      )}
    </>
  ));
}
export function SecurityView({ mgr }: SubProps) {
  return panel(mgr, "security", (access) => (
    <>
      {table(
        "Security",
        rows(mgr.securityOverview),
        [
          ["autoBlockEnabled", "Auto block"],
          ["firewallEnabled", "Firewall"],
          ["httpsEnabled", "HTTPS"],
          ["advisorScore", "Advisor score"],
          ["scanStatus", "Security Advisor status"],
          ["scanProgress", "Scan progress %"],
          ["lastScanTime", "Last scan (Unix time)"],
        ],
        access.restriction("securityOverview"),
      )}
      {table(
        "Blocked IPs",
        mgr.blockedIps,
        [
          ["ip", "IP"],
          ["blockedAt", "Blocked"],
          ["reason", "Reason"],
        ],
        access.restriction("blockedIps"),
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[["ip-unblock", "Unblock", "ip", "ip"]]}
          />
        ),
      )}
      {table(
        "Certificates",
        mgr.certificates,
        [
          ["id", "ID"],
          ["desc", "Description"],
          ["subject", "Subject"],
          ["issuer", "Issuer"],
          ["validFrom", "Valid from"],
          ["validTill", "Valid until"],
          ["isDefault", "Default"],
          ["isBroken", "Broken"],
        ],
        access.restriction("certificates"),
      )}
      {table(
        "Auto block",
        rows(mgr.autoBlockConfig),
        [
          ["enabled", "Enabled"],
          ["attempts", "Attempts"],
          ["withinMinutes", "Within minutes"],
          ["blockForever", "Indefinite"],
          ["expireMinutes", "Expiry minutes"],
          ["expireDays", "Expiry days"],
        ],
        access.restriction("autoBlockConfig"),
      )}
    </>
  ));
}
export function HardwareView({ mgr }: SubProps) {
  return panel(mgr, "hardware", (access) => {
    const hardware = access.restriction("hardwareInfo");
    return (
      <>
        {table(
          "Hardware",
          rows(mgr.hardwareInfo),
          [
            ["fanSpeed", "Fan mode"],
            ["beepEnabled", "Beeper"],
            ["ledBrightness", "LED brightness"],
          ],
          hardware,
        )}
        {table(
          "Fans",
          mgr.hardwareInfo?.fanSpeeds ?? [],
          [
            ["id", "ID"],
            ["fanSpeed", "Speed"],
            ["status", "Status"],
          ],
          hardware,
        )}
        {table(
          "Temperatures",
          mgr.hardwareInfo?.temperatures ?? [],
          [
            ["name", "Sensor"],
            ["temperature", "Temperature °C"],
            ["warnThreshold", "Warning threshold"],
            ["status", "Status"],
          ],
          hardware,
        )}
        {table(
          "UPS",
          rows(mgr.upsInfo),
          [
            ["enabled", "Enabled"],
            ["model", "Model"],
            ["status", "Status"],
            ["batteryCharge", "Battery %"],
            ["loadPercent", "Load %"],
            ["runtimeMinutes", "Runtime minutes"],
          ],
          access.restriction("upsInfo"),
        )}
        {table(
          "Power schedule",
          mgr.powerSchedule?.entries ?? [],
          [
            ["action", "Action"],
            ["weekday", "Days"],
            ["hour", "Hour"],
            ["minute", "Minute"],
            ["enabled", "Enabled"],
          ],
          access.restriction("powerSchedule"),
        )}
      </>
    );
  });
}
export function LogsView({ mgr }: SubProps) {
  return panel(mgr, "logs", (access) => (
    <>
      <div className="flex items-center gap-2 text-xs">
        <button
          className="sor-btn-secondary-sm"
          disabled={mgr.dataLoading || mgr.logPage === 0}
          onClick={() => mgr.setLogPage((p) => Math.max(0, p - 1))}
        >
          Earlier log page
        </button>
        <span>NAS result page {mgr.logPage + 1} · up to 100 per log</span>
        <button
          className="sor-btn-secondary-sm"
          disabled={
            mgr.dataLoading ||
            (mgr.systemLogs.length < 100 && mgr.connectionLogs.length < 100)
          }
          onClick={() => mgr.setLogPage((p) => p + 1)}
        >
          Next log page
        </button>
      </div>
      {table(
        "System logs",
        mgr.systemLogs,
        [
          ["time", "Time"],
          ["level", "Level"],
          ["user", "User"],
          ["event", "Event"],
          ["msg", "Message"],
        ],
        access.restriction("systemLogs"),
      )}
      {table(
        "Connection logs",
        mgr.connectionLogs,
        [
          ["time", "Time"],
          ["user", "User"],
          ["ip", "IP"],
          ["type", "Type"],
          ["protocol", "Protocol"],
          ["description", "Description"],
          ["isLogin", "Login"],
          ["success", "Success"],
        ],
        access.restriction("connectionLogs"),
      )}
    </>
  ));
}
export function NotificationsView({ mgr }: SubProps) {
  return panel(mgr, "notifications", (access) =>
    table(
      "Notifications",
      rows(mgr.notificationConfig),
      [
        ["emailEnabled", "Email"],
        ["emailAddress", "Recipient"],
        ["smtpServer", "SMTP server"],
        ["smsEnabled", "SMS"],
        ["pushEnabled", "Push"],
      ],
      access.restriction("notificationConfig"),
    ),
  );
}
