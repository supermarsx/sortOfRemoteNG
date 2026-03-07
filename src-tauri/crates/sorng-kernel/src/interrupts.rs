//! Hardware information from /proc — interrupts, DMA, I/O ports, I/O memory.

use crate::client;
use crate::error::KernelError;
use crate::types::{DmaInfo, InterruptInfo, IoPortInfo, KernelHost};

/// Parse /proc/interrupts into structured data.
///
/// Format:
/// ```text
///            CPU0       CPU1
///   0:        46          0   IO-APIC   2-edge      timer
///   1:         9          0   IO-APIC   1-edge      i8042
/// ```
pub async fn get_interrupts(host: &KernelHost) -> Result<Vec<InterruptInfo>, KernelError> {
    let out = client::exec_shell(host, "cat /proc/interrupts 2>/dev/null").await?;
    let lines: Vec<&str> = out.lines().collect();
    if lines.is_empty() {
        return Ok(vec![]);
    }
    // First line is the CPU header row
    let cpu_count = lines[0].split_whitespace().count();
    let mut interrupts = Vec::new();
    for line in &lines[1..] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.splitn(2, ':').collect();
        if parts.len() < 2 {
            continue;
        }
        let irq = parts[0].trim().to_string();
        let rest = parts[1].trim();
        let tokens: Vec<&str> = rest.split_whitespace().collect();
        // First `cpu_count` tokens are counts, then chip, hw_irq, actions
        let mut cpu_counts = Vec::new();
        let mut non_count_start = 0;
        for (i, tok) in tokens.iter().enumerate() {
            if i < cpu_count {
                if let Ok(n) = tok.parse::<u64>() {
                    cpu_counts.push(n);
                } else {
                    non_count_start = i;
                    break;
                }
            } else {
                non_count_start = i;
                break;
            }
        }
        if non_count_start == 0 && cpu_counts.len() == cpu_count {
            non_count_start = cpu_count;
        }

        let remaining: Vec<&str> = tokens[non_count_start..].to_vec();
        let chip_name = remaining.first().unwrap_or(&"").to_string();
        let hw_irq = remaining.get(1).unwrap_or(&"").to_string();
        let actions: Vec<String> = if remaining.len() > 2 {
            remaining[2..]
                .join(" ")
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        } else {
            vec![]
        };

        interrupts.push(InterruptInfo {
            irq,
            cpu_counts,
            chip_name,
            hw_irq,
            actions,
        });
    }
    Ok(interrupts)
}

/// Parse /proc/dma.
///
/// Format:
/// ```text
///  4: cascade
/// ```
pub async fn get_dma(host: &KernelHost) -> Result<Vec<DmaInfo>, KernelError> {
    let out = client::exec_shell(host, "cat /proc/dma 2>/dev/null").await?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((ch_str, device)) = trimmed.split_once(':') {
            if let Ok(channel) = ch_str.trim().parse::<u32>() {
                entries.push(DmaInfo {
                    channel,
                    device: device.trim().to_string(),
                });
            }
        }
    }
    Ok(entries)
}

/// Parse /proc/ioports.
///
/// Format:
/// ```text
/// 0000-0cf7 : PCI Bus 0000:00
///   0000-001f : dma1
/// ```
pub async fn get_ioports(host: &KernelHost) -> Result<Vec<IoPortInfo>, KernelError> {
    let out = client::exec_shell(host, "cat /proc/ioports 2>/dev/null").await?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((range_str, device)) = trimmed.split_once(':') {
            let range = range_str.trim();
            let (start, end) = if let Some((s, e)) = range.split_once('-') {
                (s.trim().to_string(), e.trim().to_string())
            } else {
                (range.to_string(), range.to_string())
            };
            entries.push(IoPortInfo {
                range_start: start,
                range_end: end,
                device: device.trim().to_string(),
            });
        }
    }
    Ok(entries)
}

/// Parse /proc/iomem — same format as ioports.
pub async fn get_iomem(host: &KernelHost) -> Result<Vec<IoPortInfo>, KernelError> {
    let out = client::exec_shell(host, "cat /proc/iomem 2>/dev/null").await?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((range_str, device)) = trimmed.split_once(':') {
            let range = range_str.trim();
            let (start, end) = if let Some((s, e)) = range.split_once('-') {
                (s.trim().to_string(), e.trim().to_string())
            } else {
                (range.to_string(), range.to_string())
            };
            entries.push(IoPortInfo {
                range_start: start,
                range_end: end,
                device: device.trim().to_string(),
            });
        }
    }
    Ok(entries)
}
