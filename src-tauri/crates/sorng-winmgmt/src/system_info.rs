//! Remote System Information gathering via WMI.
//!
//! Aggregates data from Win32_ComputerSystem, Win32_OperatingSystem,
//! Win32_Processor, Win32_LogicalDisk, Win32_NetworkAdapterConfiguration,
//! Win32_PhysicalMemory, and Win32_BIOS to build a comprehensive system
//! information snapshot.

use crate::transport::WmiTransport;
use crate::types::*;
use crate::wql::WqlQueries;
use std::collections::HashMap;

/// Gathers system information from remote Windows hosts via WMI.
pub struct SystemInfoManager;

impl SystemInfoManager {
    // ─── Full System Info ────────────────────────────────────────────

    /// Gather a complete system information snapshot.
    pub async fn get_system_info(
        transport: &mut WmiTransport,
    ) -> Result<SystemInfo, String> {
        let computer_system = Self::get_computer_system(transport).await?;
        let operating_system = Self::get_operating_system(transport).await?;
        let bios = Self::get_bios(transport).await?;
        let processors = Self::get_processors(transport).await?;
        let logical_disks = Self::get_logical_disks(transport).await?;
        let network_adapters = Self::get_network_adapters(transport).await?;
        let physical_memory = Self::get_physical_memory(transport).await?;

        Ok(SystemInfo {
            computer_system,
            operating_system,
            bios,
            processors,
            logical_disks,
            network_adapters,
            physical_memory,
        })
    }

    // ─── Individual Components ───────────────────────────────────────

    /// Get computer system information.
    pub async fn get_computer_system(
        transport: &mut WmiTransport,
    ) -> Result<ComputerSystemInfo, String> {
        let query = WqlQueries::computer_system();
        let rows = transport.wql_query(&query).await?;
        let row = rows.first().ok_or("No computer system data")?;
        Ok(Self::row_to_computer_system(row))
    }

    /// Get operating system information.
    pub async fn get_operating_system(
        transport: &mut WmiTransport,
    ) -> Result<OperatingSystemInfo, String> {
        let query = WqlQueries::operating_system();
        let rows = transport.wql_query(&query).await?;
        let row = rows.first().ok_or("No operating system data")?;
        Ok(Self::row_to_os(row))
    }

    /// Get BIOS information.
    pub async fn get_bios(transport: &mut WmiTransport) -> Result<BiosInfo, String> {
        let query = WqlQueries::bios_info();
        let rows = transport.wql_query(&query).await?;
        let row = rows.first().ok_or("No BIOS data")?;
        Ok(Self::row_to_bios(row))
    }

    /// Get processor information.
    pub async fn get_processors(
        transport: &mut WmiTransport,
    ) -> Result<Vec<ProcessorInfo>, String> {
        let query = WqlQueries::processor_info();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_processor(r)).collect())
    }

    /// Get logical disk information.
    pub async fn get_logical_disks(
        transport: &mut WmiTransport,
    ) -> Result<Vec<LogicalDiskInfo>, String> {
        let query = WqlQueries::logical_disks();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_logical_disk(r)).collect())
    }

    /// Get network adapter information (IP-enabled adapters).
    pub async fn get_network_adapters(
        transport: &mut WmiTransport,
    ) -> Result<Vec<NetworkAdapterInfo>, String> {
        // Get configuration (IP, DNS, etc.)
        let config_query = WqlQueries::network_adapter_config();
        let config_rows = transport.wql_query(&config_query).await?;

        // Get adapter info (speed, connection status)
        let adapter_query = WqlQueries::network_adapters();
        let adapter_rows = transport.wql_query(&adapter_query).await.unwrap_or_default();

        // Build a map of adapter details by InterfaceIndex
        let adapter_map: HashMap<u32, &HashMap<String, String>> = adapter_rows
            .iter()
            .filter_map(|r| {
                r.get("InterfaceIndex")
                    .and_then(|v| v.parse::<u32>().ok())
                    .map(|idx| (idx, r))
            })
            .collect();

        let mut adapters = Vec::new();
        for row in &config_rows {
            let interface_index = row
                .get("InterfaceIndex")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let adapter_detail = adapter_map.get(&interface_index);

            adapters.push(Self::row_to_network_adapter(row, adapter_detail.copied()));
        }

        Ok(adapters)
    }

    /// Get physical memory modules.
    pub async fn get_physical_memory(
        transport: &mut WmiTransport,
    ) -> Result<Vec<PhysicalMemoryInfo>, String> {
        let query = WqlQueries::physical_memory();
        let rows = transport.wql_query(&query).await?;
        Ok(rows
            .iter()
            .map(|r| Self::row_to_physical_memory(r))
            .collect())
    }

    // ─── Quick Info ──────────────────────────────────────────────────

    /// Get a quick summary (hostname, OS, memory, processors).
    pub async fn quick_summary(
        transport: &mut WmiTransport,
    ) -> Result<QuickSystemSummary, String> {
        let cs = Self::get_computer_system(transport).await?;
        let os = Self::get_operating_system(transport).await?;

        Ok(QuickSystemSummary {
            hostname: cs.name.clone(),
            domain: cs.domain.clone(),
            os_caption: os.caption.clone(),
            os_version: os.version.clone(),
            os_architecture: os.os_architecture.clone(),
            total_memory_gb: cs.total_physical_memory as f64 / 1_073_741_824.0,
            processor_count: cs.number_of_processors,
            logical_processor_count: cs.number_of_logical_processors,
            last_boot: os.last_boot_up_time.clone(),
            system_type: cs.system_type.clone(),
        })
    }

    // ─── Parsing Helpers ─────────────────────────────────────────────

    fn row_to_computer_system(row: &HashMap<String, String>) -> ComputerSystemInfo {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u32 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
        };
        let get_u64 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0)
        };
        let get_bool = |key: &str| {
            row.get(key)
                .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
                .unwrap_or(false)
        };

        let domain_role = match get_or("DomainRole", "0").as_str() {
            "0" => "Standalone Workstation",
            "1" => "Member Workstation",
            "2" => "Standalone Server",
            "3" => "Member Server",
            "4" => "Backup Domain Controller",
            "5" => "Primary Domain Controller",
            _ => "Unknown",
        };

        ComputerSystemInfo {
            name: get_or("Name", ""),
            domain: get_or("Domain", ""),
            manufacturer: get_or("Manufacturer", ""),
            model: get_or("Model", ""),
            total_physical_memory: get_u64("TotalPhysicalMemory"),
            number_of_processors: get_u32("NumberOfProcessors"),
            number_of_logical_processors: get_u32("NumberOfLogicalProcessors"),
            domain_role: domain_role.to_string(),
            part_of_domain: get_bool("PartOfDomain"),
            current_time_zone: row.get("CurrentTimeZone").and_then(|v| v.parse().ok()),
            dns_host_name: get("DNSHostName"),
            workgroup: get("Workgroup"),
            system_type: get_or("SystemType", ""),
            primary_owner_name: get("PrimaryOwnerName"),
            user_name: get("UserName"),
        }
    }

    fn row_to_os(row: &HashMap<String, String>) -> OperatingSystemInfo {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u32 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
        };
        let get_u64 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0)
        };

        OperatingSystemInfo {
            caption: get_or("Caption", ""),
            version: get_or("Version", ""),
            build_number: get_or("BuildNumber", ""),
            os_architecture: get_or("OSArchitecture", ""),
            serial_number: get_or("SerialNumber", ""),
            install_date: get("InstallDate"),
            last_boot_up_time: get("LastBootUpTime"),
            local_date_time: get("LocalDateTime"),
            registered_user: get("RegisteredUser"),
            organization: get("Organization"),
            windows_directory: get_or("WindowsDirectory", ""),
            system_directory: get_or("SystemDirectory", ""),
            free_physical_memory: get_u64("FreePhysicalMemory"),
            total_visible_memory_size: get_u64("TotalVisibleMemorySize"),
            free_virtual_memory: get_u64("FreeVirtualMemory"),
            total_virtual_memory_size: get_u64("TotalVirtualMemorySize"),
            number_of_processes: get_u32("NumberOfProcesses"),
            number_of_users: get_u32("NumberOfUsers"),
            service_pack_major_version: row
                .get("ServicePackMajorVersion")
                .and_then(|v| v.parse().ok()),
            service_pack_minor_version: row
                .get("ServicePackMinorVersion")
                .and_then(|v| v.parse().ok()),
            cs_name: get_or("CSName", ""),
            status: get_or("Status", "OK"),
        }
    }

    fn row_to_bios(row: &HashMap<String, String>) -> BiosInfo {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };

        BiosInfo {
            manufacturer: get_or("Manufacturer", ""),
            name: get_or("Name", ""),
            serial_number: get_or("SerialNumber", ""),
            version: get_or("Version", ""),
            smbios_bios_version: get("SMBIOSBIOSVersion"),
            release_date: get("ReleaseDate"),
        }
    }

    fn row_to_processor(row: &HashMap<String, String>) -> ProcessorInfo {
        let _get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u32 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
        };

        let architecture = match get_or("Architecture", "0").as_str() {
            "0" => "x86",
            "1" => "MIPS",
            "2" => "Alpha",
            "3" => "PowerPC",
            "5" => "ARM",
            "6" => "ia64",
            "9" => "x64",
            "12" => "ARM64",
            _ => "Unknown",
        };

        ProcessorInfo {
            name: get_or("Name", "").trim().to_string(),
            device_id: get_or("DeviceID", ""),
            manufacturer: get_or("Manufacturer", ""),
            number_of_cores: get_u32("NumberOfCores"),
            number_of_logical_processors: get_u32("NumberOfLogicalProcessors"),
            max_clock_speed: get_u32("MaxClockSpeed"),
            current_clock_speed: get_u32("CurrentClockSpeed"),
            l2_cache_size: row.get("L2CacheSize").and_then(|v| v.parse().ok()),
            l3_cache_size: row.get("L3CacheSize").and_then(|v| v.parse().ok()),
            architecture: architecture.to_string(),
            load_percentage: row.get("LoadPercentage").and_then(|v| v.parse().ok()),
            address_width: get_u32("AddressWidth"),
            status: get_or("Status", "OK"),
        }
    }

    fn row_to_logical_disk(row: &HashMap<String, String>) -> LogicalDiskInfo {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u64 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0)
        };
        let get_bool = |key: &str| {
            row.get(key)
                .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
                .unwrap_or(false)
        };

        let drive_type = match get_or("DriveType", "0").as_str() {
            "0" => "Unknown",
            "1" => "No Root Directory",
            "2" => "Removable",
            "3" => "Local Disk",
            "4" => "Network Drive",
            "5" => "CD-ROM",
            "6" => "RAM Disk",
            _ => "Unknown",
        };

        let free_space = get_u64("FreeSpace");
        let size = get_u64("Size");
        let used_percent = if size > 0 {
            ((size - free_space) as f64 / size as f64) * 100.0
        } else {
            0.0
        };

        LogicalDiskInfo {
            device_id: get_or("DeviceID", ""),
            drive_type: drive_type.to_string(),
            file_system: get("FileSystem"),
            free_space,
            size,
            volume_name: get("VolumeName"),
            volume_serial_number: get("VolumeSerialNumber"),
            compressed: get_bool("Compressed"),
            used_percent,
        }
    }

    fn row_to_network_adapter(
        config_row: &HashMap<String, String>,
        adapter_row: Option<&HashMap<String, String>>,
    ) -> NetworkAdapterInfo {
        let get_cfg = |key: &str| config_row.get(key).cloned();
        let get_cfg_or = |key: &str, default: &str| {
            config_row
                .get(key)
                .cloned()
                .unwrap_or_else(|| default.to_string())
        };

        // Parse array fields (IP addresses, subnets, gateways, DNS)
        let parse_array = |key: &str| -> Vec<String> {
            config_row
                .get(key)
                .map(|s| {
                    s.split(',')
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty())
                        .collect()
                })
                .unwrap_or_default()
        };

        let dhcp_enabled = config_row
            .get("DHCPEnabled")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);

        let interface_index = config_row
            .get("InterfaceIndex")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        // Merge adapter details
        let speed = adapter_row.and_then(|r| r.get("Speed").and_then(|v| v.parse().ok()));
        let adapter_type = adapter_row.and_then(|r| r.get("AdapterType").cloned());
        let net_connection_id =
            adapter_row.and_then(|r| r.get("NetConnectionID").cloned());
        let net_connection_status =
            adapter_row.and_then(|r| r.get("NetConnectionStatus").cloned());

        NetworkAdapterInfo {
            description: get_cfg_or("Description", ""),
            adapter_type,
            mac_address: get_cfg("MACAddress"),
            ip_addresses: parse_array("IPAddress"),
            ip_subnets: parse_array("IPSubnet"),
            default_ip_gateway: parse_array("DefaultIPGateway"),
            dns_servers: parse_array("DNSServerSearchOrder"),
            dhcp_enabled,
            dhcp_server: get_cfg("DHCPServer"),
            speed,
            interface_index,
            net_connection_id,
            net_connection_status,
        }
    }

    fn row_to_physical_memory(row: &HashMap<String, String>) -> PhysicalMemoryInfo {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u64 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0)
        };

        let form_factor = row.get("FormFactor").and_then(|v| {
            let code: u32 = v.parse().ok()?;
            Some(
                match code {
                    8 => "DIMM",
                    12 => "SODIMM",
                    _ => "Unknown",
                }
                .to_string(),
            )
        });

        let memory_type = row.get("MemoryType").and_then(|v| {
            let code: u32 = v.parse().ok()?;
            Some(
                match code {
                    20 => "DDR",
                    21 => "DDR2",
                    22 => "DDR2 FB-DIMM",
                    24 => "DDR3",
                    26 => "DDR4",
                    30 => "DDR5",
                    _ => "Unknown",
                }
                .to_string(),
            )
        });

        PhysicalMemoryInfo {
            bank_label: get("BankLabel"),
            capacity: get_u64("Capacity"),
            device_locator: get_or("DeviceLocator", ""),
            form_factor,
            manufacturer: get("Manufacturer").map(|s| s.trim().to_string()),
            memory_type,
            part_number: get("PartNumber").map(|s| s.trim().to_string()),
            serial_number: get("SerialNumber").map(|s| s.trim().to_string()),
            speed: row.get("Speed").and_then(|v| v.parse().ok()),
            configured_clock_speed: row
                .get("ConfiguredClockSpeed")
                .and_then(|v| v.parse().ok()),
        }
    }
}

// ─── Supporting Types ────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

/// Quick system summary for dashboard display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSystemSummary {
    pub hostname: String,
    pub domain: String,
    pub os_caption: String,
    pub os_version: String,
    pub os_architecture: String,
    pub total_memory_gb: f64,
    pub processor_count: u32,
    pub logical_processor_count: u32,
    pub last_boot: Option<String>,
    pub system_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_row_to_computer_system() {
        let mut row = HashMap::new();
        row.insert("Name".to_string(), "SERVER01".to_string());
        row.insert("Domain".to_string(), "contoso.com".to_string());
        row.insert("Manufacturer".to_string(), "Dell Inc.".to_string());
        row.insert("Model".to_string(), "PowerEdge R740".to_string());
        row.insert(
            "TotalPhysicalMemory".to_string(),
            "68719476736".to_string(),
        );
        row.insert("NumberOfProcessors".to_string(), "2".to_string());
        row.insert("NumberOfLogicalProcessors".to_string(), "48".to_string());
        row.insert("DomainRole".to_string(), "3".to_string());
        row.insert("PartOfDomain".to_string(), "True".to_string());
        row.insert("SystemType".to_string(), "x64-based PC".to_string());

        let cs = SystemInfoManager::row_to_computer_system(&row);
        assert_eq!(cs.name, "SERVER01");
        assert_eq!(cs.domain, "contoso.com");
        assert_eq!(cs.total_physical_memory, 68719476736);
        assert_eq!(cs.number_of_logical_processors, 48);
        assert_eq!(cs.domain_role, "Member Server");
        assert!(cs.part_of_domain);
    }

    #[test]
    fn test_row_to_logical_disk() {
        let mut row = HashMap::new();
        row.insert("DeviceID".to_string(), "C:".to_string());
        row.insert("DriveType".to_string(), "3".to_string());
        row.insert("FileSystem".to_string(), "NTFS".to_string());
        row.insert("FreeSpace".to_string(), "53687091200".to_string()); // 50 GB
        row.insert("Size".to_string(), "107374182400".to_string()); // 100 GB
        row.insert("VolumeName".to_string(), "System".to_string());

        let disk = SystemInfoManager::row_to_logical_disk(&row);
        assert_eq!(disk.device_id, "C:");
        assert_eq!(disk.drive_type, "Local Disk");
        assert!((disk.used_percent - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_row_to_processor() {
        let mut row = HashMap::new();
        row.insert(
            "Name".to_string(),
            "  Intel(R) Xeon(R) Gold 6148  ".to_string(),
        );
        row.insert("DeviceID".to_string(), "CPU0".to_string());
        row.insert("Manufacturer".to_string(), "GenuineIntel".to_string());
        row.insert("NumberOfCores".to_string(), "20".to_string());
        row.insert("NumberOfLogicalProcessors".to_string(), "40".to_string());
        row.insert("MaxClockSpeed".to_string(), "2400".to_string());
        row.insert("Architecture".to_string(), "9".to_string());
        row.insert("AddressWidth".to_string(), "64".to_string());

        let proc = SystemInfoManager::row_to_processor(&row);
        assert_eq!(proc.name, "Intel(R) Xeon(R) Gold 6148");
        assert_eq!(proc.number_of_cores, 20);
        assert_eq!(proc.architecture, "x64");
    }
}
