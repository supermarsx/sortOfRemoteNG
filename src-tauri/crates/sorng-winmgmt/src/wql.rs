//! WQL (WMI Query Language) query builder utilities.
//!
//! Provides a builder pattern for constructing WQL SELECT, event subscription,
//! and associator/reference queries targeting remote WMI classes.


/// Builder for constructing WQL queries.
#[derive(Debug, Clone)]
pub struct WqlBuilder {
    select_fields: Vec<String>,
    class: String,
    conditions: Vec<String>,
    #[allow(dead_code)]
    order_by: Option<(String, bool)>,
    #[allow(dead_code)]
    limit: Option<u32>,
}

impl WqlBuilder {
    /// Start building a query against a WMI class.
    pub fn select(class: &str) -> Self {
        Self {
            select_fields: Vec::new(),
            class: class.to_string(),
            conditions: Vec::new(),
            order_by: None,
            limit: None,
        }
    }

    /// Specify which fields to return (`*` if none specified).
    pub fn fields(mut self, fields: &[&str]) -> Self {
        self.select_fields = fields.iter().map(|f| f.to_string()).collect();
        self
    }

    /// Add a WHERE condition (raw WQL expression).
    pub fn where_raw(mut self, condition: &str) -> Self {
        self.conditions.push(condition.to_string());
        self
    }

    /// Add an equality condition: `Property = 'value'`.
    pub fn where_eq(mut self, property: &str, value: &str) -> Self {
        self.conditions
            .push(format!("{} = '{}'", property, wql_escape(value)));
        self
    }

    /// Add a numeric equality condition: `Property = value`.
    pub fn where_eq_num(mut self, property: &str, value: i64) -> Self {
        self.conditions
            .push(format!("{} = {}", property, value));
        self
    }

    /// Add a LIKE condition: `Property LIKE '%pattern%'`.
    pub fn where_like(mut self, property: &str, pattern: &str) -> Self {
        self.conditions
            .push(format!("{} LIKE '{}'", property, wql_escape(pattern)));
        self
    }

    /// Add an IN condition for string values.
    pub fn where_in(mut self, property: &str, values: &[&str]) -> Self {
        if values.is_empty() {
            return self;
        }
        let list = values
            .iter()
            .map(|v| format!("'{}'", wql_escape(v)))
            .collect::<Vec<_>>()
            .join(", ");
        self.conditions
            .push(format!("{} IN ({})", property, list));
        self
    }

    /// Add an IN condition for numeric values.
    pub fn where_in_num(mut self, property: &str, values: &[i64]) -> Self {
        if values.is_empty() {
            return self;
        }
        let list = values
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        self.conditions
            .push(format!("{} IN ({})", property, list));
        self
    }

    /// Add a comparison condition: `Property > value`.
    pub fn where_gt(mut self, property: &str, value: i64) -> Self {
        self.conditions
            .push(format!("{} > {}", property, value));
        self
    }

    /// Add a comparison condition: `Property >= value`.
    pub fn where_gte(mut self, property: &str, value: i64) -> Self {
        self.conditions
            .push(format!("{} >= {}", property, value));
        self
    }

    /// Add a comparison condition: `Property < value`.
    pub fn where_lt(mut self, property: &str, value: i64) -> Self {
        self.conditions
            .push(format!("{} < {}", property, value));
        self
    }

    /// Add IS NOT NULL condition.
    pub fn where_not_null(mut self, property: &str) -> Self {
        self.conditions
            .push(format!("{} IS NOT NULL", property));
        self
    }

    /// Add IS NULL condition.
    pub fn where_null(mut self, property: &str) -> Self {
        self.conditions
            .push(format!("{} IS NULL", property));
        self
    }

    /// Add a datetime comparison: `Property >= 'yyyymmddHHMMSS.000000+000'`.
    pub fn where_after(mut self, property: &str, dt: &chrono::DateTime<chrono::Utc>) -> Self {
        let wmi_dt = crate::transport::format_wmi_datetime(dt);
        self.conditions
            .push(format!("{} >= '{}'", property, wmi_dt));
        self
    }

    /// Add a datetime comparison: `Property <= 'yyyymmddHHMMSS.000000+000'`.
    pub fn where_before(mut self, property: &str, dt: &chrono::DateTime<chrono::Utc>) -> Self {
        let wmi_dt = crate::transport::format_wmi_datetime(dt);
        self.conditions
            .push(format!("{} <= '{}'", property, wmi_dt));
        self
    }

    /// Add NOT EQUAL condition.
    pub fn where_ne(mut self, property: &str, value: &str) -> Self {
        self.conditions
            .push(format!("{} != '{}'", property, wql_escape(value)));
        self
    }

    /// Build the WQL SELECT statement.
    pub fn build(&self) -> String {
        let fields = if self.select_fields.is_empty() {
            "*".to_string()
        } else {
            self.select_fields.join(", ")
        };

        let mut query = format!("SELECT {} FROM {}", fields, self.class);

        if !self.conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&self.conditions.join(" AND "));
        }

        query
    }
}

// ─── Event Subscription Queries ──────────────────────────────────────

/// Builder for WMI event subscription queries (__InstanceModificationEvent, etc.).
pub struct WqlEventBuilder {
    event_class: String,
    target_class: String,
    within_sec: u32,
    conditions: Vec<String>,
}

impl WqlEventBuilder {
    /// Subscribe to instance modification events for a WMI class.
    pub fn instance_modification(target_class: &str) -> Self {
        Self {
            event_class: "__InstanceModificationEvent".to_string(),
            target_class: target_class.to_string(),
            within_sec: 5,
            conditions: Vec::new(),
        }
    }

    /// Subscribe to instance creation events.
    pub fn instance_creation(target_class: &str) -> Self {
        Self {
            event_class: "__InstanceCreationEvent".to_string(),
            target_class: target_class.to_string(),
            within_sec: 5,
            conditions: Vec::new(),
        }
    }

    /// Subscribe to instance deletion events.
    pub fn instance_deletion(target_class: &str) -> Self {
        Self {
            event_class: "__InstanceDeletionEvent".to_string(),
            target_class: target_class.to_string(),
            within_sec: 5,
            conditions: Vec::new(),
        }
    }

    /// Set the polling interval (WITHIN clause).
    pub fn within(mut self, seconds: u32) -> Self {
        self.within_sec = seconds;
        self
    }

    /// Add a condition on TargetInstance properties.
    pub fn where_target(mut self, property: &str, value: &str) -> Self {
        self.conditions.push(format!(
            "TargetInstance.{} = '{}'",
            property,
            wql_escape(value)
        ));
        self
    }

    /// Add a raw condition.
    pub fn where_raw(mut self, condition: &str) -> Self {
        self.conditions.push(condition.to_string());
        self
    }

    /// Build the event subscription WQL query.
    pub fn build(&self) -> String {
        let mut query = format!(
            "SELECT * FROM {} WITHIN {} WHERE TargetInstance ISA '{}'",
            self.event_class, self.within_sec, self.target_class
        );

        for cond in &self.conditions {
            query.push_str(" AND ");
            query.push_str(cond);
        }

        query
    }
}

// ─── ASSOCIATORS / REFERENCES ────────────────────────────────────────

/// Build an ASSOCIATORS OF query.
pub fn associators_of(
    object_path: &str,
    result_class: Option<&str>,
    assoc_class: Option<&str>,
) -> String {
    let mut query = format!(
        "ASSOCIATORS OF {{{}}}",
        wql_escape(object_path)
    );
    if let Some(rc) = result_class {
        query.push_str(&format!(" WHERE ResultClass = {}", rc));
    }
    if let Some(ac) = assoc_class {
        if result_class.is_some() {
            query.push_str(&format!(" AssocClass = {}", ac));
        } else {
            query.push_str(&format!(" WHERE AssocClass = {}", ac));
        }
    }
    query
}

/// Build a REFERENCES OF query.
pub fn references_of(object_path: &str, result_class: Option<&str>) -> String {
    let mut query = format!(
        "REFERENCES OF {{{}}}",
        wql_escape(object_path)
    );
    if let Some(rc) = result_class {
        query.push_str(&format!(" WHERE ResultClass = {}", rc));
    }
    query
}

// ─── Common WQL Queries for Windows Management ──────────────────────

/// Pre-built WQL queries for common Win32 classes.
pub struct WqlQueries;

impl WqlQueries {
    // ─── Services ────────────────────────────────────────────────────

    /// List all services.
    pub fn all_services() -> String {
        "SELECT Name, DisplayName, State, StartMode, ServiceType, PathName, ProcessId, \
         Status, Started, AcceptPause, AcceptStop, StartName, Description, ExitCode \
         FROM Win32_Service"
            .to_string()
    }

    /// Get a specific service by name.
    pub fn service_by_name(name: &str) -> String {
        WqlBuilder::select("Win32_Service")
            .where_eq("Name", name)
            .build()
    }

    /// Services in a specific state.
    pub fn services_by_state(state: &str) -> String {
        WqlBuilder::select("Win32_Service")
            .where_eq("State", state)
            .build()
    }

    /// Services with a specific start mode.
    pub fn services_by_start_mode(mode: &str) -> String {
        WqlBuilder::select("Win32_Service")
            .where_eq("StartMode", mode)
            .build()
    }

    /// Service dependencies.
    pub fn service_dependencies(service_name: &str) -> String {
        associators_of(
            &format!("Win32_Service.Name='{}'", wql_escape(service_name)),
            Some("Win32_Service"),
            Some("Win32_DependentService"),
        )
    }

    // ─── Event Log ───────────────────────────────────────────────────

    /// Query event log entries with filters.
    pub fn event_log_entries(
        log_file: &str,
        event_type: Option<u8>,
        source: Option<&str>,
        max_records: u32,
    ) -> String {
        let mut b = WqlBuilder::select("Win32_NTLogEvent").where_eq("Logfile", log_file);

        if let Some(t) = event_type {
            b = b.where_eq_num("EventType", t as i64);
        }
        if let Some(s) = source {
            b = b.where_eq("SourceName", s);
        }

        let q = b.build();
        // WQL doesn't have LIMIT, but WinRM MaxElements handles pagination
        let _ = max_records; // pagination handled at transport level
        q
    }

    /// List available event logs.
    pub fn event_log_list() -> String {
        "SELECT Name, FileName, NumberOfRecords, MaxFileSize, FileSize, \
         OverwritePolicy, OverWriteOutDated, Status \
         FROM Win32_NTEventlogFile"
            .to_string()
    }

    /// Get event sources for a log.
    pub fn event_sources(log_file: &str) -> String {
        WqlBuilder::select("Win32_NTLogEvent")
            .fields(&["SourceName"])
            .where_eq("Logfile", log_file)
            .build()
    }

    // ─── Processes ───────────────────────────────────────────────────

    /// List all processes.
    pub fn all_processes() -> String {
        "SELECT ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, \
         CreationDate, ThreadCount, HandleCount, WorkingSetSize, VirtualSize, \
         PeakWorkingSetSize, PageFaults, PageFileUsage, PeakPageFileUsage, \
         KernelModeTime, UserModeTime, Priority, SessionId, Status, \
         ReadOperationCount, WriteOperationCount, ReadTransferCount, WriteTransferCount \
         FROM Win32_Process"
            .to_string()
    }

    /// Get a process by PID.
    pub fn process_by_pid(pid: u32) -> String {
        WqlBuilder::select("Win32_Process")
            .where_eq_num("ProcessId", pid as i64)
            .build()
    }

    /// Processes by name.
    pub fn processes_by_name(name: &str) -> String {
        WqlBuilder::select("Win32_Process")
            .where_eq("Name", name)
            .build()
    }

    // ─── Performance ─────────────────────────────────────────────────

    /// CPU performance counters (total).
    pub fn perf_cpu_total() -> String {
        "SELECT PercentProcessorTime, PercentPrivilegedTime, PercentUserTime, \
         PercentInterruptTime, PercentDPCTime, PercentIdleTime \
         FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name = '_Total'"
            .to_string()
    }

    /// CPU performance per core.
    pub fn perf_cpu_per_core() -> String {
        "SELECT Name, PercentProcessorTime, PercentPrivilegedTime, PercentUserTime \
         FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name != '_Total'"
            .to_string()
    }

    /// Memory performance counters.
    pub fn perf_memory() -> String {
        "SELECT AvailableBytes, CommittedBytes, CommitLimit, \
         PagesPerSec, PageFaultsPerSec, CacheBytes, \
         PoolPagedBytes, PoolNonpagedBytes \
         FROM Win32_PerfFormattedData_PerfOS_Memory"
            .to_string()
    }

    /// Physical disk performance counters.
    pub fn perf_physical_disk() -> String {
        "SELECT Name, DiskReadBytesPerSec, DiskWriteBytesPerSec, \
         DiskReadsPerSec, DiskWritesPerSec, AvgDiskQueueLength, \
         PercentDiskTime, AvgDiskSecPerRead, AvgDiskSecPerWrite \
         FROM Win32_PerfFormattedData_PerfDisk_PhysicalDisk"
            .to_string()
    }

    /// Logical disk info (free space, sizes).
    pub fn logical_disks() -> String {
        "SELECT DeviceID, DriveType, FileSystem, FreeSpace, Size, \
         VolumeName, VolumeSerialNumber, Compressed \
         FROM Win32_LogicalDisk WHERE DriveType = 3"
            .to_string()
    }

    /// Network interface performance counters.
    pub fn perf_network() -> String {
        "SELECT Name, BytesReceivedPerSec, BytesSentPerSec, BytesTotalPerSec, \
         PacketsReceivedPerSec, PacketsSentPerSec, CurrentBandwidth, \
         OutputQueueLength, PacketsReceivedErrors, PacketsOutboundErrors, \
         PacketsReceivedDiscarded, PacketsOutboundDiscarded \
         FROM Win32_PerfFormattedData_Tcpip_NetworkInterface"
            .to_string()
    }

    /// System-wide counters.
    pub fn perf_system() -> String {
        "SELECT Processes, Threads, SystemUpTime, \
         FileDataOperationsPerSec, FileReadOperationsPerSec, FileWriteOperationsPerSec \
         FROM Win32_PerfFormattedData_PerfOS_System"
            .to_string()
    }

    /// Processor queue length.
    pub fn perf_processor_queue() -> String {
        "SELECT ProcessorQueueLength \
         FROM Win32_PerfFormattedData_PerfOS_System"
            .to_string()
    }

    /// Context switches per second.
    pub fn perf_context_switches() -> String {
        "SELECT ContextSwitchesPerSec, SystemCallsPerSec \
         FROM Win32_PerfFormattedData_PerfOS_System"
            .to_string()
    }

    // ─── Registry ────────────────────────────────────────────────────

    // Registry uses StdRegProv methods, not WQL queries, but we provide
    // helper queries for registry-related event subscriptions.

    /// Monitor registry key changes.
    pub fn registry_change_event(hive: &str, key_path: &str) -> String {
        format!(
            "SELECT * FROM RegistryKeyChangeEvent WHERE Hive = '{}' AND KeyPath = '{}'",
            wql_escape(hive),
            wql_escape(key_path)
        )
    }

    // ─── System Info ─────────────────────────────────────────────────

    /// Computer system information.
    pub fn computer_system() -> String {
        "SELECT Name, Domain, Manufacturer, Model, TotalPhysicalMemory, \
         NumberOfProcessors, NumberOfLogicalProcessors, DomainRole, PartOfDomain, \
         CurrentTimeZone, DNSHostName, Workgroup, SystemType, PrimaryOwnerName, UserName \
         FROM Win32_ComputerSystem"
            .to_string()
    }

    /// Operating system information.
    pub fn operating_system() -> String {
        "SELECT Caption, Version, BuildNumber, OSArchitecture, SerialNumber, \
         InstallDate, LastBootUpTime, LocalDateTime, RegisteredUser, Organization, \
         WindowsDirectory, SystemDirectory, FreePhysicalMemory, TotalVisibleMemorySize, \
         FreeVirtualMemory, TotalVirtualMemorySize, NumberOfProcesses, NumberOfUsers, \
         ServicePackMajorVersion, ServicePackMinorVersion, CSName, Status \
         FROM Win32_OperatingSystem"
            .to_string()
    }

    /// OS memory (for perf overlay).
    pub fn os_memory() -> String {
        "SELECT TotalVisibleMemorySize, FreePhysicalMemory \
         FROM Win32_OperatingSystem"
            .to_string()
    }

    /// BIOS information.
    pub fn bios_info() -> String {
        "SELECT Manufacturer, Name, SerialNumber, Version, SMBIOSBIOSVersion, ReleaseDate \
         FROM Win32_BIOS"
            .to_string()
    }

    /// Processor information.
    pub fn processor_info() -> String {
        "SELECT Name, DeviceID, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, \
         MaxClockSpeed, CurrentClockSpeed, L2CacheSize, L3CacheSize, Architecture, \
         LoadPercentage, AddressWidth, Status \
         FROM Win32_Processor"
            .to_string()
    }

    /// Network adapter configuration.
    pub fn network_adapter_config() -> String {
        "SELECT Description, MACAddress, IPAddress, IPSubnet, DefaultIPGateway, \
         DNSServerSearchOrder, DHCPEnabled, DHCPServer, InterfaceIndex \
         FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = True"
            .to_string()
    }

    /// Network adapters with connection status.
    pub fn network_adapters() -> String {
        "SELECT Description, AdapterType, MACAddress, Speed, InterfaceIndex, \
         NetConnectionID, NetConnectionStatus \
         FROM Win32_NetworkAdapter WHERE NetConnectionStatus IS NOT NULL"
            .to_string()
    }

    /// Physical memory modules.
    pub fn physical_memory() -> String {
        "SELECT BankLabel, Capacity, DeviceLocator, FormFactor, Manufacturer, \
         MemoryType, PartNumber, SerialNumber, Speed, ConfiguredClockSpeed \
         FROM Win32_PhysicalMemory"
            .to_string()
    }

    // ─── Scheduled Tasks ─────────────────────────────────────────────

    /// List scheduled tasks (via CIM MSFT_ScheduledTask in Task Scheduler namespace).
    /// Note: This uses the root\Microsoft\Windows\TaskScheduler namespace.
    pub fn scheduled_tasks() -> String {
        "SELECT TaskName, TaskPath, State, Description, Author, Date, URI \
         FROM MSFT_ScheduledTask"
            .to_string()
    }

    /// Get a specific scheduled task.
    pub fn scheduled_task(task_path: &str, task_name: &str) -> String {
        WqlBuilder::select("MSFT_ScheduledTask")
            .where_eq("TaskPath", task_path)
            .where_eq("TaskName", task_name)
            .build()
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Escape single quotes in WQL string values.
fn wql_escape(s: &str) -> String {
    s.replace('\'', "\\'").replace('\\', "\\\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_select() {
        let q = WqlBuilder::select("Win32_Service").build();
        assert_eq!(q, "SELECT * FROM Win32_Service");
    }

    #[test]
    fn test_select_with_fields_and_filter() {
        let q = WqlBuilder::select("Win32_Service")
            .fields(&["Name", "State"])
            .where_eq("Name", "Spooler")
            .build();
        assert_eq!(
            q,
            "SELECT Name, State FROM Win32_Service WHERE Name = 'Spooler'"
        );
    }

    #[test]
    fn test_multiple_conditions() {
        let q = WqlBuilder::select("Win32_NTLogEvent")
            .where_eq("Logfile", "Application")
            .where_eq_num("EventType", 1)
            .build();
        assert_eq!(
            q,
            "SELECT * FROM Win32_NTLogEvent WHERE Logfile = 'Application' AND EventType = 1"
        );
    }

    #[test]
    fn test_like_query() {
        let q = WqlBuilder::select("Win32_Process")
            .where_like("Name", "%chrome%")
            .build();
        assert_eq!(
            q,
            "SELECT * FROM Win32_Process WHERE Name LIKE '%chrome%'"
        );
    }

    #[test]
    fn test_in_query() {
        let q = WqlBuilder::select("Win32_Service")
            .where_in("State", &["Running", "Stopped"])
            .build();
        assert!(q.contains("IN ('Running', 'Stopped')"));
    }

    #[test]
    fn test_event_subscription() {
        let q = WqlEventBuilder::instance_modification("Win32_Service")
            .within(3)
            .where_target("Name", "Spooler")
            .build();
        assert!(q.contains("__InstanceModificationEvent"));
        assert!(q.contains("WITHIN 3"));
        assert!(q.contains("ISA 'Win32_Service'"));
        assert!(q.contains("TargetInstance.Name = 'Spooler'"));
    }

    #[test]
    fn test_associators_of() {
        let q = associators_of(
            "Win32_Service.Name='Spooler'",
            Some("Win32_Service"),
            None,
        );
        assert!(q.contains("ASSOCIATORS OF"));
        assert!(q.contains("ResultClass = Win32_Service"));
    }

    #[test]
    fn test_predefined_queries() {
        let q = WqlQueries::all_services();
        assert!(q.contains("Win32_Service"));
        assert!(q.contains("SELECT"));

        let q = WqlQueries::perf_cpu_total();
        assert!(q.contains("Win32_PerfFormattedData_PerfOS_Processor"));
        assert!(q.contains("_Total"));
    }
}
