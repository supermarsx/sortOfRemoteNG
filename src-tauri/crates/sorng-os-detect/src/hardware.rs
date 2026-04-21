//! Hardware profiling — CPU, memory, disks, network, GPU, virtualization, DMI.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect CPU information from /proc/cpuinfo, lscpu, or sysctl.
pub async fn detect_cpu(host: &OsDetectHost) -> Result<CpuInfo, OsDetectError> {
    // Try lscpu first (structured output)
    let lscpu = client::exec_soft(host, "lscpu", &[]).await;
    if !lscpu.is_empty() {
        return Ok(parse_lscpu(&lscpu));
    }

    // Fallback: /proc/cpuinfo (Linux)
    let cpuinfo = client::shell_exec(host, "cat /proc/cpuinfo 2>/dev/null").await;
    if !cpuinfo.is_empty() {
        return Ok(parse_proc_cpuinfo(&cpuinfo));
    }

    // macOS: sysctl
    let model = client::shell_exec(host, "sysctl -n machdep.cpu.brand_string 2>/dev/null").await;
    if !model.is_empty() {
        let cores_phys = client::shell_exec(host, "sysctl -n hw.physicalcpu 2>/dev/null").await;
        let cores_log = client::shell_exec(host, "sysctl -n hw.logicalcpu 2>/dev/null").await;
        let freq = client::shell_exec(host, "sysctl -n hw.cpufrequency 2>/dev/null").await;
        let arch_str = client::exec_soft(host, "uname", &["-m"]).await;
        return Ok(CpuInfo {
            model: model.trim().to_string(),
            cores_physical: cores_phys.trim().parse().ok(),
            cores_logical: cores_log.trim().parse().ok(),
            architecture: parse_architecture(arch_str.trim()),
            frequency_mhz: freq.trim().parse::<f64>().ok().map(|hz| hz / 1_000_000.0),
            flags: Vec::new(),
            microcode: None,
            cache_size: None,
            vendor: Some("Apple".to_string()),
        });
    }

    Err(OsDetectError::ParseError(
        "Could not detect CPU info".to_string(),
    ))
}

/// Detect memory information.
pub async fn detect_memory(host: &OsDetectHost) -> Result<MemoryInfo, OsDetectError> {
    // Linux: /proc/meminfo
    let meminfo = client::shell_exec(host, "cat /proc/meminfo 2>/dev/null").await;
    if !meminfo.is_empty() {
        return Ok(parse_meminfo(&meminfo));
    }

    // macOS: sysctl + vm_stat
    let total = client::shell_exec(host, "sysctl -n hw.memsize 2>/dev/null").await;
    if !total.is_empty() {
        let total_bytes: u64 = total.trim().parse().unwrap_or(0);
        let vm_stat = client::exec_soft(host, "vm_stat", &[]).await;
        let available = parse_macos_available_memory(&vm_stat);
        return Ok(MemoryInfo {
            total_bytes,
            available_bytes: available,
            swap_total_bytes: 0,
            swap_available_bytes: 0,
            huge_pages: None,
        });
    }

    // FreeBSD: sysctl
    let phys = client::shell_exec(host, "sysctl -n hw.physmem 2>/dev/null").await;
    if !phys.is_empty() {
        let total_bytes: u64 = phys.trim().parse().unwrap_or(0);
        let free = client::shell_exec(host, "sysctl -n vm.stats.vm.v_free_count 2>/dev/null").await;
        let page_size = client::shell_exec(host, "sysctl -n hw.pagesize 2>/dev/null").await;
        let ps: u64 = page_size.trim().parse().unwrap_or(4096);
        let free_pages: u64 = free.trim().parse().unwrap_or(0);
        return Ok(MemoryInfo {
            total_bytes,
            available_bytes: free_pages * ps,
            swap_total_bytes: 0,
            swap_available_bytes: 0,
            huge_pages: None,
        });
    }

    Err(OsDetectError::ParseError(
        "Could not detect memory info".to_string(),
    ))
}

/// Detect disk information via lsblk, df.
pub async fn detect_disks(host: &OsDetectHost) -> Result<Vec<DiskInfo>, OsDetectError> {
    // Try df (most portable)
    let df = client::exec_soft(
        host,
        "df",
        &["-B1", "--output=source,target,fstype,size,used,avail"],
    )
    .await;
    if !df.is_empty() {
        return Ok(parse_df_output(&df));
    }

    // macOS df
    let df_mac = client::exec_soft(host, "df", &["-b"]).await;
    if !df_mac.is_empty() {
        return Ok(parse_df_bsd(&df_mac));
    }

    Ok(Vec::new())
}

/// Detect network interfaces.
pub async fn detect_network_interfaces(
    host: &OsDetectHost,
) -> Result<Vec<NetworkInterfaceInfo>, OsDetectError> {
    // Try ip -j link/addr (Linux with iproute2)
    let ip_json = client::shell_exec(host, "ip -j addr show 2>/dev/null").await;
    if !ip_json.is_empty() && ip_json.trim().starts_with('[') {
        return parse_ip_json(&ip_json);
    }

    // Fallback: ip addr show (non-JSON)
    let ip_text = client::shell_exec(host, "ip addr show 2>/dev/null").await;
    if !ip_text.is_empty() {
        return Ok(parse_ip_addr(&ip_text));
    }

    // Fallback: ifconfig
    let ifconfig = client::exec_soft(host, "ifconfig", &["-a"]).await;
    if !ifconfig.is_empty() {
        return Ok(parse_ifconfig(&ifconfig));
    }

    Ok(Vec::new())
}

/// Detect GPUs via lspci or nvidia-smi.
pub async fn detect_gpus(host: &OsDetectHost) -> Result<Vec<GpuInfo>, OsDetectError> {
    let mut gpus = Vec::new();

    // lspci for VGA/3D controllers
    let lspci = client::shell_exec(host, "lspci 2>/dev/null | grep -iE 'VGA|3D|Display'").await;
    for line in lspci.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Format: "00:02.0 VGA compatible controller: Intel Corporation ..."
        let desc = line.splitn(2, ": ").last().unwrap_or(line);
        let (vendor, model) = split_gpu_vendor_model(desc);
        gpus.push(GpuInfo {
            vendor,
            model,
            driver: None,
            vram_bytes: None,
        });
    }

    // nvidia-smi for NVIDIA VRAM + driver
    let nvidia = client::shell_exec(
        host,
        "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits 2>/dev/null",
    ).await;
    if !nvidia.is_empty() {
        for line in nvidia.lines() {
            let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if parts.len() >= 3 {
                let vram_mb: u64 = parts[2].parse().unwrap_or(0);
                // Update existing or add
                let found = gpus.iter_mut().find(|g| g.model.contains(parts[0]));
                if let Some(gpu) = found {
                    gpu.driver = Some(parts[1].to_string());
                    gpu.vram_bytes = Some(vram_mb * 1024 * 1024);
                } else {
                    gpus.push(GpuInfo {
                        vendor: "NVIDIA".to_string(),
                        model: parts[0].to_string(),
                        driver: Some(parts[1].to_string()),
                        vram_bytes: Some(vram_mb * 1024 * 1024),
                    });
                }
            }
        }
    }

    Ok(gpus)
}

/// Detect virtualization hypervisor / container runtime.
pub async fn detect_virtualization(
    host: &OsDetectHost,
) -> Result<VirtualizationInfo, OsDetectError> {
    // systemd-detect-virt (most reliable on systemd systems)
    let detect_virt = client::exec_soft(host, "systemd-detect-virt", &[]).await;
    let virt = detect_virt.trim().to_lowercase();
    if !virt.is_empty() && virt != "none" {
        let container_runtime = match virt.as_str() {
            "docker" | "podman" | "lxc" | "lxc-libvirt" | "wsl" | "systemd-nspawn" => {
                Some(virt.clone())
            }
            _ => None,
        };
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: virt,
            container_runtime,
        });
    }

    // DMI check
    let dmi_vendor = client::shell_exec(
        host,
        "cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null",
    )
    .await;
    let vendor_lower = dmi_vendor.trim().to_lowercase();
    let hypervisor = if vendor_lower.contains("vmware") {
        "vmware"
    } else if vendor_lower.contains("qemu") || vendor_lower.contains("kvm") {
        "kvm"
    } else if vendor_lower.contains("microsoft") {
        "hyperv"
    } else if vendor_lower.contains("xen") {
        "xen"
    } else if vendor_lower.contains("parallels") {
        "parallels"
    } else if vendor_lower.contains("virtualbox") {
        "virtualbox"
    } else {
        ""
    };

    if !hypervisor.is_empty() {
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: hypervisor.to_string(),
            container_runtime: None,
        });
    }

    // Check /proc/1/cgroup for containers
    let cgroup = client::shell_exec(host, "cat /proc/1/cgroup 2>/dev/null").await;
    if cgroup.contains("docker") {
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: "docker".to_string(),
            container_runtime: Some("docker".to_string()),
        });
    }
    if cgroup.contains("lxc") {
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: "lxc".to_string(),
            container_runtime: Some("lxc".to_string()),
        });
    }

    // Check /.dockerenv
    let dockerenv = client::shell_exec(host, "test -f /.dockerenv && echo yes").await;
    if dockerenv.trim() == "yes" {
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: "docker".to_string(),
            container_runtime: Some("docker".to_string()),
        });
    }

    // WSL detection
    let wsl = client::shell_exec(host, "cat /proc/version 2>/dev/null").await;
    if wsl.to_lowercase().contains("microsoft") || wsl.to_lowercase().contains("wsl") {
        return Ok(VirtualizationInfo {
            is_virtual: true,
            hypervisor: "wsl".to_string(),
            container_runtime: None,
        });
    }

    Ok(VirtualizationInfo {
        is_virtual: false,
        hypervisor: "none".to_string(),
        container_runtime: None,
    })
}

/// Detect DMI information (vendor, product, serial) via dmidecode or /sys.
pub async fn detect_dmi_info(
    host: &OsDetectHost,
) -> Result<(Option<String>, Option<String>, Option<String>), OsDetectError> {
    // Try /sys first (no sudo needed)
    let vendor = client::shell_exec(
        host,
        "cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null",
    )
    .await;
    let product = client::shell_exec(
        host,
        "cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null",
    )
    .await;
    let serial = client::shell_exec(
        host,
        "cat /sys/devices/virtual/dmi/id/product_serial 2>/dev/null",
    )
    .await;

    let v = non_empty(vendor.trim());
    let p = non_empty(product.trim());
    let s = non_empty(serial.trim());

    if v.is_some() || p.is_some() {
        return Ok((v, p, s));
    }

    // Try dmidecode (requires sudo typically)
    let dmi = client::exec_soft(host, "dmidecode", &["-t", "system"]).await;
    if !dmi.is_empty() {
        let mut d_vendor = None;
        let mut d_product = None;
        let mut d_serial = None;
        for line in dmi.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("Manufacturer:") {
                d_vendor = non_empty(val.trim());
            } else if let Some(val) = line.strip_prefix("Product Name:") {
                d_product = non_empty(val.trim());
            } else if let Some(val) = line.strip_prefix("Serial Number:") {
                d_serial = non_empty(val.trim());
            }
        }
        return Ok((d_vendor, d_product, d_serial));
    }

    // macOS
    let sp = client::shell_exec(host, "system_profiler SPHardwareDataType 2>/dev/null").await;
    if !sp.is_empty() {
        let mut model = None;
        let mut serial_mac = None;
        for line in sp.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("Model Name:") {
                model = non_empty(val.trim());
            } else if let Some(val) = line.strip_prefix("Serial Number") {
                let val = val
                    .trim_start_matches(':')
                    .trim_start_matches("(system):")
                    .trim();
                serial_mac = non_empty(val);
            }
        }
        return Ok((Some("Apple".to_string()), model, serial_mac));
    }

    Ok((None, None, None))
}

/// Aggregate all hardware detection into a HardwareProfile.
pub async fn build_hardware_profile(host: &OsDetectHost) -> Result<HardwareProfile, OsDetectError> {
    let cpu = detect_cpu(host).await.ok();
    let memory = detect_memory(host).await.ok();
    let disks = detect_disks(host).await.unwrap_or_default();
    let network_interfaces = detect_network_interfaces(host).await.unwrap_or_default();
    let gpus = detect_gpus(host).await.unwrap_or_default();
    let virtualization = detect_virtualization(host).await.ok();
    let (dmi_vendor, dmi_product, dmi_serial) =
        detect_dmi_info(host).await.unwrap_or((None, None, None));

    Ok(HardwareProfile {
        cpu,
        memory,
        disks,
        network_interfaces,
        gpus,
        virtualization,
        dmi_vendor,
        dmi_product,
        dmi_serial,
    })
}

// ─── Parsers ────────────────────────────────────────────────────────

fn parse_lscpu(stdout: &str) -> CpuInfo {
    let mut model = String::new();
    let mut cores_physical = None;
    let mut cores_logical = None;
    let mut freq = None;
    let mut flags = Vec::new();
    let mut vendor = None;
    let mut arch = Architecture::Unknown("unknown".to_string());
    let mut cache_size = None;

    for line in stdout.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            match key {
                "Model name" => model = val.to_string(),
                "Core(s) per socket" => {
                    let cores_per_socket: u32 = val.parse().unwrap_or(0);
                    cores_physical = Some(cores_per_socket);
                }
                "CPU(s)" => cores_logical = val.parse().ok(),
                "CPU max MHz" | "CPU MHz" => {
                    if freq.is_none() {
                        freq = val.parse().ok();
                    }
                }
                "Vendor ID" => vendor = Some(val.to_string()),
                "Architecture" => arch = parse_architecture(val),
                "Flags" => flags = val.split_whitespace().map(|s| s.to_string()).collect(),
                "L3 cache" | "L2 cache" => {
                    if cache_size.is_none() {
                        cache_size = Some(val.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    // Multiply cores_physical by sockets
    let sockets_str = stdout.lines().find(|l| l.trim().starts_with("Socket(s):"));
    if let Some(sock_line) = sockets_str {
        if let Some((_, val)) = sock_line.split_once(':') {
            let sockets: u32 = val.trim().parse().unwrap_or(1);
            cores_physical = cores_physical.map(|c| c * sockets);
        }
    }

    CpuInfo {
        model,
        cores_physical,
        cores_logical,
        architecture: arch,
        frequency_mhz: freq,
        flags,
        microcode: None,
        cache_size,
        vendor,
    }
}

fn parse_proc_cpuinfo(content: &str) -> CpuInfo {
    let mut model = String::new();
    let mut vendor = None;
    let mut freq = None;
    let mut flags = Vec::new();
    let mut microcode = None;
    let mut cache_size = None;
    let mut processor_count: u32 = 0;
    let mut core_ids = std::collections::HashSet::new();

    for line in content.lines() {
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            match key {
                "processor" => processor_count += 1,
                "model name" => {
                    if model.is_empty() {
                        model = val.to_string();
                    }
                }
                "vendor_id" => {
                    if vendor.is_none() {
                        vendor = Some(val.to_string());
                    }
                }
                "cpu MHz" => {
                    if freq.is_none() {
                        freq = val.parse().ok();
                    }
                }
                "flags" => {
                    if flags.is_empty() {
                        flags = val.split_whitespace().map(|s| s.to_string()).collect();
                    }
                }
                "microcode" => {
                    if microcode.is_none() {
                        microcode = Some(val.to_string());
                    }
                }
                "cache size" => {
                    if cache_size.is_none() {
                        cache_size = Some(val.to_string());
                    }
                }
                "core id" => {
                    core_ids.insert(val.to_string());
                }
                _ => {}
            }
        }
    }

    let cores_physical = if core_ids.is_empty() {
        None
    } else {
        Some(core_ids.len() as u32)
    };
    let cores_logical = if processor_count > 0 {
        Some(processor_count)
    } else {
        None
    };
    let arch_str = if flags.iter().any(|f| f == "lm") {
        "x86_64"
    } else {
        "unknown"
    };

    CpuInfo {
        model,
        cores_physical,
        cores_logical,
        architecture: parse_architecture(arch_str),
        frequency_mhz: freq,
        flags,
        microcode,
        cache_size,
        vendor,
    }
}

fn parse_meminfo(content: &str) -> MemoryInfo {
    let mut total = 0u64;
    let mut available = 0u64;
    let mut swap_total = 0u64;
    let mut swap_free = 0u64;
    let mut huge_pages = None;

    for line in content.lines() {
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val_kb = parse_kb_value(val.trim());
            match key {
                "MemTotal" => total = val_kb * 1024,
                "MemAvailable" => available = val_kb * 1024,
                "SwapTotal" => swap_total = val_kb * 1024,
                "SwapFree" => swap_free = val_kb * 1024,
                "HugePages_Total" => {
                    huge_pages = val
                        .split_whitespace()
                        .next()
                        .and_then(|v| v.parse::<u64>().ok());
                }
                _ => {}
            }
        }
    }

    MemoryInfo {
        total_bytes: total,
        available_bytes: available,
        swap_total_bytes: swap_total,
        swap_available_bytes: swap_free,
        huge_pages,
    }
}

fn parse_kb_value(s: &str) -> u64 {
    // "16384000 kB" -> 16384000
    s.split_whitespace()
        .next()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn parse_macos_available_memory(vm_stat: &str) -> u64 {
    let mut free_pages = 0u64;
    let mut page_size = 4096u64;

    for line in vm_stat.lines() {
        if line.contains("page size of") {
            if let Some(ps) = line.split("page size of").last() {
                page_size = ps.trim().trim_end_matches('.').parse().unwrap_or(4096);
            }
        } else if line.contains("Pages free:") {
            free_pages = extract_trailing_number(line);
        }
    }

    free_pages * page_size
}

fn extract_trailing_number(line: &str) -> u64 {
    line.split_whitespace()
        .last()
        .map(|s| s.trim_end_matches('.'))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn parse_df_output(stdout: &str) -> Vec<DiskInfo> {
    // Header: Filesystem  Mounted on  Type  Size  Used  Avail
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                return None;
            }
            // Skip pseudo filesystems
            let device = parts[0];
            if device.starts_with("tmpfs")
                || device.starts_with("devtmpfs")
                || device == "none"
                || device.starts_with("overlay")
            {
                return None;
            }
            Some(DiskInfo {
                device: device.to_string(),
                mount_point: parts[1].to_string(),
                fs_type: parts[2].to_string(),
                total_bytes: parts[3].parse().unwrap_or(0),
                used_bytes: parts[4].parse().unwrap_or(0),
                available_bytes: parts[5].parse().unwrap_or(0),
            })
        })
        .collect()
}

fn parse_df_bsd(stdout: &str) -> Vec<DiskInfo> {
    // macOS/BSD df -b: Filesystem 512-blocks Used Available Capacity Mounted on
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                return None;
            }
            let device = parts[0];
            if device == "devfs" || device == "map" {
                return None;
            }
            let block_size = 512u64;
            Some(DiskInfo {
                device: device.to_string(),
                mount_point: parts[5..].join(" "),
                fs_type: String::new(),
                total_bytes: parts[1].parse::<u64>().unwrap_or(0) * block_size,
                used_bytes: parts[2].parse::<u64>().unwrap_or(0) * block_size,
                available_bytes: parts[3].parse::<u64>().unwrap_or(0) * block_size,
            })
        })
        .collect()
}

fn parse_ip_json(json_str: &str) -> Result<Vec<NetworkInterfaceInfo>, OsDetectError> {
    let entries: Vec<serde_json::Value> = serde_json::from_str(json_str)?;
    let mut interfaces = Vec::new();

    for entry in &entries {
        let name = entry["ifname"].as_str().unwrap_or("").to_string();
        let state = entry["operstate"]
            .as_str()
            .unwrap_or("unknown")
            .to_lowercase();
        let mac = entry["address"].as_str().map(|s| s.to_string());
        let mtu = entry["mtu"].as_u64().map(|v| v as u32);

        let mut ipv4 = Vec::new();
        let mut ipv6 = Vec::new();
        if let Some(addr_info) = entry["addr_info"].as_array() {
            for addr in addr_info {
                let family = addr["family"].as_str().unwrap_or("");
                let local = addr["local"].as_str().unwrap_or("");
                let prefix = addr["prefixlen"].as_u64().unwrap_or(0);
                let cidr = format!("{}/{}", local, prefix);
                match family {
                    "inet" => ipv4.push(cidr),
                    "inet6" => ipv6.push(cidr),
                    _ => {}
                }
            }
        }

        interfaces.push(NetworkInterfaceInfo {
            name,
            mac,
            ipv4_addrs: ipv4,
            ipv6_addrs: ipv6,
            state,
            mtu,
            speed_mbps: None,
            driver: None,
        });
    }

    Ok(interfaces)
}

fn parse_ip_addr(stdout: &str) -> Vec<NetworkInterfaceInfo> {
    let mut interfaces = Vec::new();
    let mut current: Option<NetworkInterfaceInfo> = None;

    for line in stdout.lines() {
        if line.starts_with(|c: char| c.is_ascii_digit()) {
            // New interface line: "2: eth0: <...> state UP ..."
            if let Some(iface) = current.take() {
                interfaces.push(iface);
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            let name = parts
                .get(1)
                .unwrap_or(&"")
                .trim_end_matches(':')
                .to_string();
            let state = if line.contains("state UP") {
                "up"
            } else {
                "down"
            };
            let mtu = parts
                .iter()
                .position(|p| *p == "mtu")
                .and_then(|i| parts.get(i + 1))
                .and_then(|v| v.parse().ok());
            current = Some(NetworkInterfaceInfo {
                name,
                mac: None,
                ipv4_addrs: Vec::new(),
                ipv6_addrs: Vec::new(),
                state: state.to_string(),
                mtu,
                speed_mbps: None,
                driver: None,
            });
        } else if let Some(ref mut iface) = current {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("link/ether ") {
                iface.mac = rest.split_whitespace().next().map(|s| s.to_string());
            } else if let Some(rest) = trimmed.strip_prefix("inet ") {
                if let Some(addr) = rest.split_whitespace().next() {
                    iface.ipv4_addrs.push(addr.to_string());
                }
            } else if let Some(rest) = trimmed.strip_prefix("inet6 ") {
                if let Some(addr) = rest.split_whitespace().next() {
                    iface.ipv6_addrs.push(addr.to_string());
                }
            }
        }
    }
    if let Some(iface) = current {
        interfaces.push(iface);
    }
    interfaces
}

fn parse_ifconfig(stdout: &str) -> Vec<NetworkInterfaceInfo> {
    let mut interfaces = Vec::new();
    let mut current: Option<NetworkInterfaceInfo> = None;

    for line in stdout.lines() {
        // New interface starts at column 0 (not whitespace-indented)
        if !line.is_empty() && !line.starts_with(char::is_whitespace) {
            if let Some(iface) = current.take() {
                interfaces.push(iface);
            }
            let name = line
                .split(':')
                .next()
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            let state = if line.contains("UP") { "up" } else { "down" };
            let mtu = line
                .split("mtu")
                .last()
                .and_then(|s| s.split_whitespace().next())
                .and_then(|v| v.parse().ok());
            current = Some(NetworkInterfaceInfo {
                name,
                mac: None,
                ipv4_addrs: Vec::new(),
                ipv6_addrs: Vec::new(),
                state: state.to_string(),
                mtu,
                speed_mbps: None,
                driver: None,
            });
        } else if let Some(ref mut iface) = current {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("ether ") {
                iface.mac = rest.split_whitespace().next().map(|s| s.to_string());
            } else if let Some(rest) = trimmed.strip_prefix("inet ") {
                let addr = rest.split_whitespace().next().unwrap_or("");
                iface.ipv4_addrs.push(addr.to_string());
            } else if let Some(rest) = trimmed.strip_prefix("inet6 ") {
                let addr = rest.split_whitespace().next().unwrap_or("");
                iface.ipv6_addrs.push(addr.to_string());
            } else if trimmed.starts_with("HWaddr") || trimmed.contains("HWaddr") {
                let mac = trimmed
                    .split("HWaddr")
                    .last()
                    .and_then(|s| s.split_whitespace().next())
                    .map(|s| s.to_string());
                iface.mac = mac;
            }
        }
    }
    if let Some(iface) = current {
        interfaces.push(iface);
    }
    interfaces
}

fn split_gpu_vendor_model(desc: &str) -> (String, String) {
    let known_vendors = [
        "NVIDIA",
        "AMD",
        "Intel",
        "Matrox",
        "ASPEED",
        "VMware",
        "VirtualBox",
    ];
    for v in &known_vendors {
        if desc.to_uppercase().contains(&v.to_uppercase()) {
            return (v.to_string(), desc.to_string());
        }
    }
    ("Unknown".to_string(), desc.to_string())
}

pub fn parse_architecture(s: &str) -> Architecture {
    match s.to_lowercase().as_str() {
        "x86_64" | "amd64" => Architecture::X86_64,
        "aarch64" | "arm64" => Architecture::Aarch64,
        "armv7l" | "armhf" => Architecture::Armv7l,
        "riscv64" => Architecture::Riscv64,
        "s390x" => Architecture::S390x,
        "ppc64le" => Architecture::Ppc64le,
        "mips64" => Architecture::Mips64,
        "i686" | "i386" | "x86" => Architecture::I686,
        other => Architecture::Unknown(other.to_string()),
    }
}

fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}
