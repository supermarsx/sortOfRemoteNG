import type { SynologyTab } from "../../../hooks/synology/synologyAdminData";

export interface AdminField {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "checkbox" | "email" | "date";
  optional?: boolean;
  maxLength?: number;
  placeholder?: string;
}
export interface AdminAction {
  id: string;
  tab: SynologyTab;
  label: string;
  command: string;
  help: string;
  mutation: boolean;
  fields: AdminField[];
  columns?: readonly (readonly [string, string])[];
  image?: boolean;
  /**
   * DSM allows the action's API for administrators only (plan t84 §3b "A"/"pkg-A").
   * A hint for gating the button; the NAS remains authoritative.
   */
  requires?: "administrator";
}
/** Tabs whose actions call administrator-only DSM APIs (§3b); File Station, Downloads, Cameras and Logs do not. */
const ADMINISTRATOR_ACTION_TABS: ReadonlySet<SynologyTab> =
  new Set<SynologyTab>([
    "system",
    "storage",
    "shares",
    "network",
    "users",
    "packages",
    "services",
    "docker",
    "vms",
    "backup",
    "security",
    "notifications",
  ]);
const text = (key: string, label: string, optional = false): AdminField => ({
  key,
  label,
  optional,
  maxLength: 255,
});
const secret = (key: string, label: string): AdminField => ({
  key,
  label,
  type: "password",
  maxLength: 1024,
});
const flag = (key: string, label: string): AdminField => ({
  key,
  label,
  type: "checkbox",
});
const number = (key: string, label: string): AdminField => ({
  key,
  label,
  type: "number",
});
const action = (
  id: string,
  tab: SynologyTab,
  label: string,
  command: string,
  fields: AdminField[],
  help: string,
  columns?: AdminAction["columns"],
): AdminAction => ({
  id,
  tab,
  label,
  command,
  fields,
  help,
  mutation: !columns,
  columns,
  ...(ADMINISTRATOR_ACTION_TABS.has(tab)
    ? { requires: "administrator" as const }
    : {}),
});
export const SYNOLOGY_ADMIN_ACTIONS: readonly AdminAction[] = [
  action(
    "processes",
    "system",
    "Processes",
    "syn_list_processes",
    [],
    "Current processes; no terminate capability is exposed.",
    [
      ["pid", "PID"],
      ["name", "Process"],
      ["user", "User"],
      ["cpu", "CPU"],
      ["memory", "Memory"],
      ["threads", "Threads"],
    ],
  ),
  action(
    "update",
    "system",
    "Check DSM update",
    "syn_check_update",
    [],
    "Checks availability only; does not install an update.",
    [
      ["update.available", "Available"],
      ["update.version", "Version"],
      ["update.version_details.buildnumber", "Build"],
    ],
  ),
  action(
    "reboot",
    "system",
    "Reboot NAS",
    "syn_reboot",
    [],
    "Interrupts connections and running jobs on this NAS.",
  ),
  action(
    "shutdown",
    "system",
    "Shut down NAS",
    "syn_shutdown",
    [],
    "Interrupts connections and turns off this NAS. Remote recovery may not be available.",
  ),
  action(
    "luns",
    "storage",
    "iSCSI LUNs",
    "syn_list_iscsi_luns",
    [],
    "Read-only LUN inventory.",
    [
      ["lunId", "LUN ID"],
      ["name", "Name"],
      ["status", "Status"],
      ["size", "Size"],
      ["usedSize", "Used"],
      ["location", "Location"],
    ],
  ),
  action(
    "targets",
    "storage",
    "iSCSI targets",
    "syn_list_iscsi_targets",
    [],
    "Read-only iSCSI target inventory.",
    [
      ["targetId", "ID"],
      ["name", "Name"],
      ["iqn", "IQN"],
      ["status", "Status"],
      ["mappedLuns", "Mapped LUNs"],
    ],
  ),
  action(
    "file-info",
    "fileStation",
    "File Station capabilities",
    "syn_get_file_station_info",
    [],
    "Available capabilities depend on File Station and your account.",
    [
      ["hostname", "Host"],
      ["isManager", "Manager"],
      ["supportSharing", "Sharing"],
      ["supportVirtualProtocol", "Virtual protocols"],
    ],
  ),
  action(
    "permissions",
    "shares",
    "Share permissions",
    "syn_get_share_permissions",
    [text("name", "Shared folder")],
    "Reads assigned share permissions; does not change ACLs.",
    [
      ["name", "Account"],
      ["isAdmin", "Admin"],
      ["isReadonly", "Read only"],
      ["isWritable", "Writable"],
      ["isDeny", "Denied"],
      ["isCustom", "Custom"],
    ],
  ),
  action(
    "share-create",
    "shares",
    "Create shared folder",
    "syn_create_shared_folder",
    [
      text("name", "Shared folder name"),
      text("volPath", "Volume path"),
      text("desc", "Description", true),
    ],
    "Creates a NAS shared folder on the specified volume. Use a DSM volume path such as /volume1.",
  ),
  action(
    "share-delete",
    "shares",
    "Delete shared folder",
    "syn_delete_shared_folder",
    [text("name", "Shared folder")],
    "Destructive: deletes this shared folder and its contents on the NAS. This is not the application recycle bin.",
  ),
  action(
    "share-mount",
    "shares",
    "Unlock encrypted share",
    "syn_mount_encrypted_share",
    [text("name", "Shared folder"), secret("password", "Encryption password")],
    "The password is used for this request only and is not saved.",
  ),
  action(
    "share-unmount",
    "shares",
    "Lock encrypted share",
    "syn_unmount_encrypted_share",
    [text("name", "Shared folder")],
    "Makes the encrypted shared folder unavailable to connected clients.",
  ),
  action(
    "dhcp",
    "network",
    "DHCP leases",
    "syn_list_dhcp_leases",
    [],
    "Requires the NAS DHCP service.",
    [
      ["hostname", "Host"],
      ["ip", "IP"],
      ["mac", "MAC"],
      ["expire", "Expires"],
      ["iface", "Interface"],
    ],
  ),
  action(
    "user-create",
    "users",
    "Create user",
    "syn_create_user",
    [
      text("name", "Username"),
      secret("password", "New password"),
      text("description", "Description", true),
      { ...text("email", "Email", true), type: "email" },
    ],
    "Creates a local DSM account. Review its access in DSM; no administrator privilege is granted by this form.",
  ),
  action(
    "user-delete",
    "users",
    "Delete user",
    "syn_delete_user",
    [text("name", "Username")],
    "Deletes the local user. Review ownership and service dependencies first.",
  ),
  action(
    "package-start",
    "packages",
    "Start package",
    "syn_start_package",
    [text("id", "Package ID")],
    "Starts the installed package.",
  ),
  action(
    "package-stop",
    "packages",
    "Stop package",
    "syn_stop_package",
    [text("id", "Package ID")],
    "Stops the package and may interrupt its users.",
  ),
  action(
    "package-install",
    "packages",
    "Install package",
    "syn_install_package",
    [text("id", "Package ID"), text("volume", "Volume")],
    "Requests installation from the NAS package catalog; no arbitrary local package upload.",
  ),
  action(
    "package-remove",
    "packages",
    "Uninstall package",
    "syn_uninstall_package",
    [text("id", "Package ID")],
    "May remove package data and interrupt dependent services.",
  ),
  action(
    "ssh",
    "services",
    "Configure SSH",
    "syn_set_ssh_enabled",
    [flag("enabled", "Enable SSH service")],
    "Changes remote shell availability on the NAS. Verify firewall and account access first.",
  ),
  action(
    "container-start",
    "docker",
    "Start container",
    "syn_start_docker_container",
    [text("name", "Container name")],
    "Starts the existing container.",
  ),
  action(
    "container-stop",
    "docker",
    "Stop container",
    "syn_stop_docker_container",
    [text("name", "Container name")],
    "Stops the container and interrupts its workload.",
  ),
  action(
    "container-restart",
    "docker",
    "Restart container",
    "syn_restart_docker_container",
    [text("name", "Container name")],
    "Restarts the container and interrupts its workload.",
  ),
  action(
    "container-delete",
    "docker",
    "Delete container",
    "syn_delete_docker_container",
    [
      text("name", "Container name"),
      flag("force", "Force removal of running container"),
    ],
    "Destructive: removes this container. Review persistent volumes separately.",
  ),
  action(
    "image-pull",
    "docker",
    "Pull image",
    "syn_pull_docker_image",
    [text("repository", "Image repository"), text("tag", "Image tag")],
    "The NAS downloads this image from its configured registry. This does not run it.",
  ),
  action(
    "project-start",
    "docker",
    "Start project",
    "syn_start_docker_project",
    [text("name", "Project name")],
    "Starts the existing Compose project.",
  ),
  action(
    "project-stop",
    "docker",
    "Stop project",
    "syn_stop_docker_project",
    [text("name", "Project name")],
    "Stops the project and its workloads.",
  ),
  action(
    "vm-on",
    "vms",
    "Power on VM",
    "syn_vm_power_on",
    [text("guestId", "VM ID")],
    "Powers on the selected existing virtual machine.",
  ),
  action(
    "vm-off",
    "vms",
    "Shut down VM",
    "syn_vm_shutdown",
    [text("guestId", "VM ID")],
    "Requests a graceful guest shutdown.",
  ),
  action(
    "vm-force",
    "vms",
    "Force off VM",
    "syn_vm_force_shutdown",
    [text("guestId", "VM ID")],
    "Equivalent to removing power; unsaved guest data may be lost.",
  ),
  action(
    "vm-snapshots",
    "vms",
    "VM snapshots",
    "syn_list_vm_snapshots",
    [text("guestId", "VM ID")],
    "Read-only snapshots for this virtual machine.",
    [
      ["snapId", "ID"],
      ["desc", "Description"],
      ["takenAt", "Created"],
      ["status", "Status"],
    ],
  ),
  action(
    "vm-snapshot-create",
    "vms",
    "Take VM snapshot",
    "syn_take_vm_snapshot",
    [text("guestId", "VM ID"), text("description", "Description")],
    "Creates a snapshot and consumes NAS storage.",
  ),
  action(
    "download-info",
    "downloads",
    "Download Station information",
    "syn_get_download_station_info",
    [],
    "Requires Download Station.",
    [
      ["versionString", "Version"],
      ["isManager", "Manager"],
    ],
  ),
  action(
    "download-create",
    "downloads",
    "New download",
    "syn_create_download_task",
    [
      { ...text("uri", "Download URL or magnet URI"), maxLength: 4096 },
      text("destination", "Destination folder", true),
    ],
    "The NAS contacts the supplied address and downloads content. Only use a source you trust.",
  ),
  action(
    "download-pause",
    "downloads",
    "Pause download",
    "syn_pause_download",
    [text("taskId", "Download task ID")],
    "Pauses the existing download task.",
  ),
  action(
    "download-resume",
    "downloads",
    "Resume download",
    "syn_resume_download",
    [text("taskId", "Download task ID")],
    "Resumes the existing download task.",
  ),
  action(
    "download-delete",
    "downloads",
    "Delete download",
    "syn_delete_download",
    [
      text("taskId", "Download task ID"),
      flag("force", "Move incomplete files to destination"),
    ],
    "Removes the task. Enabling the incomplete-file option moves unfinished content to the destination; it does not complete or validate the download.",
  ),
  action(
    "surveillance-info",
    "surveillance",
    "Surveillance information",
    "syn_get_surveillance_info",
    [],
    "Requires Surveillance Station and suitable permissions.",
    [
      ["version.major", "Major version"],
      ["version.minor", "Minor version"],
      ["cameraCount", "Cameras"],
      ["licenseCount", "Licenses"],
    ],
  ),
  {
    ...action(
      "camera-snapshot",
      "surveillance",
      "Camera snapshot",
      "syn_fs_camera_snapshot",
      [text("camId", "Camera ID")],
      "Fetches one still image only. No recording is saved locally.",
      [],
    ),
    image: true,
  },
  action(
    "recordings",
    "surveillance",
    "Camera recordings",
    "syn_list_recordings",
    [
      text("camId", "Camera ID"),
      number("offset", "Result offset"),
      number("limit", "Page size (1–100)"),
    ],
    "Lists a bounded page of recordings; use offset for subsequent pages.",
    [
      ["id", "ID"],
      ["cameraName", "Camera"],
      ["startTime", "Started"],
      ["stopTime", "Ended"],
      ["fileSize", "Bytes"],
      ["eventType", "Event"],
    ],
  ),
  action(
    "backup-start",
    "backup",
    "Start backup",
    "syn_start_backup_task",
    [text("taskId", "Backup task ID")],
    "Starts the configured backup task.",
  ),
  action(
    "backup-cancel",
    "backup",
    "Cancel backup",
    "syn_cancel_backup_task",
    [text("taskId", "Backup task ID")],
    "Requests cancellation; changes already made are not rolled back.",
  ),
  action(
    "backup-versions",
    "backup",
    "Backup versions",
    "syn_list_backup_versions",
    [text("taskId", "Backup task ID")],
    "Read-only versions; no restore or version deletion is exposed.",
    [
      ["versionId", "ID"],
      ["createdTime", "Created"],
      ["size", "Bytes"],
      ["status", "Status"],
    ],
  ),
  action(
    "ip-unblock",
    "security",
    "Unblock IP",
    "syn_unblock_ip",
    [text("ip", "IP address")],
    "Allows a previously blocked source to try authenticating again.",
  ),
  action(
    "connections",
    "logs",
    "Active connections",
    "syn_get_active_connections",
    [],
    "Read-only current connections.",
    [
      ["user", "Account"],
      ["ip", "IP"],
      ["type", "Type"],
      ["protocol", "Protocol"],
      ["description", "Description"],
      ["isLogin", "Login"],
      ["success", "Successful"],
      ["time", "Time"],
    ],
  ),
  action(
    "email-test",
    "notifications",
    "Send test email",
    "syn_test_email_notification",
    [],
    "Sends a real test notification using the NAS configuration. No settings are changed.",
  ),
];
export function adminActionArgs(
  action: AdminAction,
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of action.fields) {
    if (field.type === "checkbox") {
      result[field.key] = values[field.key] === true;
      continue;
    }
    const raw =
      typeof values[field.key] === "string"
        ? (values[field.key] as string)
        : "";
    const value = field.type === "password" ? raw : raw.trim();
    if (!value && field.optional) {
      // Shared-folder description is a required native String; unlike optional
      // account fields, its empty form value is represented by an empty string.
      result[field.key] =
        action.id === "share-create" && field.key === "desc" ? "" : null;
      continue;
    }
    if (
      !value ||
      value.length > (field.maxLength ?? 255) ||
      Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error(`Enter a valid ${field.label.toLowerCase()}.`);
    if (field.type === "number") {
      const n = Number(value);
      if (
        !Number.isSafeInteger(n) ||
        n < 0 ||
        (field.key === "limit" && (n < 1 || n > 100))
      )
        throw new Error(`Enter a valid ${field.label.toLowerCase()}.`);
      result[field.key] = n;
    } else result[field.key] = value;
  }
  if (
    action.id === "download-create" &&
    !/^(https?:\/\/|magnet:\?)/i.test(String(result.uri))
  )
    throw new Error("Use an HTTP(S) URL or magnet URI.");
  return result;
}
