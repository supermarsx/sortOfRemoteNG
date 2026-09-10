// Minimal presentation-boundary checks. The native typed model remains the
// source of truth; unknown optional fields are shown as unknown, never zero.
const identity: Record<string, readonly string[]> = {
  syn_list_processes: ["pid", "name"],
  syn_list_disks: ["id", "name"],
  syn_list_volumes: ["id", "status"],
  syn_list_iscsi_luns: ["lunId", "name"],
  syn_list_iscsi_targets: ["targetId", "name"],
  syn_list_shared_folders: ["name"],
  syn_get_share_permissions: ["name"],
  syn_list_network_interfaces: ["id"],
  syn_list_users: ["name"],
  syn_list_groups: ["name"],
  syn_list_packages: ["id", "name"],
  syn_list_services: ["id", "name"],
  syn_list_docker_containers: ["id", "name"],
  syn_list_docker_images: ["repository", "tag"],
  syn_list_docker_networks: ["name"],
  syn_list_docker_projects: ["name"],
  syn_list_vms: ["guestId", "guestName"],
  syn_list_vm_snapshots: ["snapId"],
  syn_list_download_tasks: ["id", "title"],
  syn_list_cameras: ["id", "name"],
  syn_list_recordings: ["id"],
  syn_list_backup_tasks: ["taskId", "name"],
  syn_list_backup_versions: ["versionId"],
  syn_list_active_backup_devices: ["deviceId"],
  syn_list_blocked_ips: ["ip"],
  syn_list_certificates: ["id"],
  syn_get_system_logs: ["id", "time"],
  syn_get_connection_logs: ["time", "ip"],
  syn_get_active_connections: ["time", "ip"],
};
export function validateSynologyAdminResponse(
  command: string,
  value: unknown,
): void {
  const keys = identity[command];
  if (keys) {
    if (
      !Array.isArray(value) ||
      value.some(
        (row) =>
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          keys.some(
            (key) =>
              typeof row[key] !== "string" && typeof row[key] !== "number",
          ),
      )
    )
      throw new Error(
        "The NAS returned an invalid collection. Update the desktop application or check package compatibility.",
      );
  }
  if (
    command === "syn_get_system_info" &&
    (!value ||
      typeof value !== "object" ||
      typeof (value as Record<string, unknown>).model !== "string")
  )
    throw new Error("The NAS returned invalid system information.");
}
