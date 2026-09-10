import type { ReactNode } from "react";
import type { SubProps } from "./types";
import AdminTable, { type AdminColumn } from "./AdminTable";
const panel = (children: ReactNode) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">{children}</div>
);
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
  actions?: (row: Record<string, unknown>) => ReactNode,
) => (
  <AdminTable title={title} rows={data} columns={columns} actions={actions} />
);
export function SharesView({ mgr }: SubProps) {
  return panel(
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
  return panel(
    <>
      {table("Network", rows(mgr.networkOverview), [
        ["hostname", "Host"],
        ["gateway", "Gateway"],
        ["dns", "DNS"],
        ["workgroup", "Workgroup"],
      ])}
      {table("Interfaces", mgr.networkInterfaces, [
        ["id", "ID"],
        ["name", "Name"],
        ["ip", "IP"],
        ["mask", "Mask"],
        ["mac", "MAC"],
        ["status", "Status"],
        ["speed", "Speed"],
        ["mtu", "MTU"],
      ])}
      {table("Firewall rules", mgr.firewallRules, [
        ["policy", "Policy"],
        ["protocol", "Protocol"],
        ["ports", "Ports"],
        ["sourceIp", "Source"],
        ["enabled", "Enabled"],
      ])}
    </>,
  );
}
export function UsersView({ mgr }: SubProps) {
  return panel(
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
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[["user-delete", "Delete", "name", "name"]]}
          />
        ),
      )}
      {table("Groups", mgr.groups, [
        ["name", "Name"],
        ["gid", "GID"],
        ["description", "Description"],
        ["members", "Members"],
      ])}
    </>,
  );
}
export function PackagesView({ mgr }: SubProps) {
  return panel(
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
  return panel(
    <>
      {table("Services", mgr.services, [
        ["name", "Service"],
        ["enabled", "Enabled"],
        ["running", "Running"],
        ["port", "Port"],
        ["serviceType", "Type"],
      ])}
      {table("SMB", rows(mgr.smbConfig), [
        ["enabled", "Enabled"],
        ["workgroup", "Workgroup"],
        ["minProtocol", "Minimum protocol"],
        ["maxProtocol", "Maximum protocol"],
      ])}
      {table("NFS", rows(mgr.nfsConfig), [
        ["enabled", "Enabled"],
        ["enableNfsV4", "NFS v4"],
        ["domain", "Domain"],
      ])}
      {table("SSH", rows(mgr.sshConfig), [
        ["enabled", "Enabled"],
        ["port", "Port"],
      ])}
    </>,
  );
}
export function DockerView({ mgr }: SubProps) {
  return panel(
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
      {table("Images", mgr.dockerImages, [
        ["repository", "Repository"],
        ["tag", "Tag"],
        ["id", "ID"],
        ["size", "Bytes"],
      ])}
      {table("Container networks", mgr.dockerNetworks, [
        ["name", "Name"],
        ["driver", "Driver"],
        ["subnet", "Subnet"],
        ["gateway", "Gateway"],
      ])}
      {table(
        "Projects",
        mgr.dockerProjects,
        [
          ["name", "Name"],
          ["status", "Status"],
          ["path", "Path"],
          ["services", "Services"],
        ],
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
    </>,
  );
}
export function VmsView({ mgr }: SubProps) {
  return panel(
    table(
      "Virtual machines",
      mgr.vms,
      [
        ["guestId", "VM ID"],
        ["guestName", "Name"],
        ["status", "Status"],
        ["vcpuNum", "vCPU"],
        ["vramSize", "RAM bytes"],
        ["storageName", "Storage"],
      ],
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
  return panel(
    <>
      {table("Transfer rates", rows(mgr.downloadStats), [
        ["speedDownload", "Download bytes/s"],
        ["speedUpload", "Upload bytes/s"],
      ])}
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
    </>,
  );
}
export function SurveillanceView({ mgr }: SubProps) {
  return panel(
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
  return panel(
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
      {table("Active Backup devices", mgr.activeBackupDevices, [
        ["deviceId", "ID"],
        ["deviceName", "Name"],
        ["osName", "OS"],
        ["status", "Status"],
        ["lastBackupTime", "Last backup"],
      ])}
    </>,
  );
}
export function SecurityView({ mgr }: SubProps) {
  return panel(
    <>
      {table("Security", rows(mgr.securityOverview), [
        ["autoBlockEnabled", "Auto block"],
        ["firewallEnabled", "Firewall"],
        ["httpsEnabled", "HTTPS"],
        ["advisorScore", "Advisor score"],
      ])}
      {table(
        "Blocked IPs",
        mgr.blockedIps,
        [
          ["ip", "IP"],
          ["blockedAt", "Blocked"],
          ["reason", "Reason"],
        ],
        (row) => (
          <RowActions
            mgr={mgr}
            row={row}
            items={[["ip-unblock", "Unblock", "ip", "ip"]]}
          />
        ),
      )}
      {table("Certificates", mgr.certificates, [
        ["id", "ID"],
        ["desc", "Description"],
        ["subject", "Subject"],
        ["issuer", "Issuer"],
        ["validFrom", "Valid from"],
        ["validTill", "Valid until"],
        ["isDefault", "Default"],
        ["isBroken", "Broken"],
      ])}
      {table("Auto block", rows(mgr.autoBlockConfig), [
        ["enabled", "Enabled"],
        ["attempts", "Attempts"],
        ["withinMinutes", "Within minutes"],
        ["blockForever", "Indefinite"],
        ["expireMinutes", "Expiry minutes"],
      ])}
    </>,
  );
}
export function HardwareView({ mgr }: SubProps) {
  return panel(
    <>
      {table("Hardware", rows(mgr.hardwareInfo), [
        ["fanSpeed", "Fan mode"],
        ["beepEnabled", "Beeper"],
        ["ledBrightness", "LED brightness"],
      ])}
      {table("Fans", mgr.hardwareInfo?.fanSpeeds ?? [], [
        ["id", "ID"],
        ["fanSpeed", "Speed"],
        ["status", "Status"],
      ])}
      {table("Temperatures", mgr.hardwareInfo?.temperatures ?? [], [
        ["name", "Sensor"],
        ["temperature", "Temperature °C"],
        ["warnThreshold", "Warning threshold"],
        ["status", "Status"],
      ])}
      {table("UPS", rows(mgr.upsInfo), [
        ["enabled", "Enabled"],
        ["model", "Model"],
        ["status", "Status"],
        ["batteryCharge", "Battery %"],
        ["loadPercent", "Load %"],
        ["runtimeMinutes", "Runtime minutes"],
      ])}
      {table("Power schedule", mgr.powerSchedule?.entries ?? [], [
        ["action", "Action"],
        ["weekday", "Days"],
        ["hour", "Hour"],
        ["minute", "Minute"],
        ["enabled", "Enabled"],
      ])}
    </>,
  );
}
export function LogsView({ mgr }: SubProps) {
  return panel(
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
      {table("System logs", mgr.systemLogs, [
        ["time", "Time"],
        ["level", "Level"],
        ["user", "User"],
        ["event", "Event"],
        ["msg", "Message"],
      ])}
      {table("Connection logs", mgr.connectionLogs, [
        ["time", "Time"],
        ["user", "User"],
        ["ip", "IP"],
        ["type", "Type"],
        ["isLogin", "Login"],
        ["success", "Success"],
      ])}
    </>,
  );
}
export function NotificationsView({ mgr }: SubProps) {
  return panel(
    table("Notifications", rows(mgr.notificationConfig), [
      ["emailEnabled", "Email"],
      ["emailAddress", "Recipient"],
      ["smtpServer", "SMTP server"],
      ["smsEnabled", "SMS"],
      ["pushEnabled", "Push"],
    ]),
  );
}
