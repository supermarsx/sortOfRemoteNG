//! Printer device handler for RDPDR printer redirection (MS-RDPEPC).
//!
//! Announces a virtual printer to the remote session. Print jobs arrive
//! as IRP_MJ_CREATE → IRP_MJ_WRITE (raw spool data) → IRP_MJ_CLOSE.
//! Completed jobs are saved as local files and a frontend event is emitted.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use sorng_core::events::DynEventEmitter;

use super::super::settings::PrinterOutputMode;
use super::pdu::*;

/// A single redirected printer device.
pub struct PrinterDevice {
    pub device_id: u32,
    printer_name: String,
    output_dir: PathBuf,
    emitter: DynEventEmitter,
    session_id: String,
    output_mode: PrinterOutputMode,
    open_jobs: HashMap<u32, PrintJob>,
    next_file_id: u32,
}

struct PrintJob {
    file: File,
    path: PathBuf,
    bytes_written: u64,
}

impl PrinterDevice {
    pub fn new(
        device_id: u32,
        printer_name: &str,
        output_dir: PathBuf,
        session_id: String,
        emitter: DynEventEmitter,
        output_mode: PrinterOutputMode,
    ) -> Self {
        // Ensure output directory exists
        let _ = fs::create_dir_all(&output_dir);
        Self {
            device_id,
            printer_name: printer_name.to_string(),
            output_dir,
            emitter,
            session_id,
            output_mode,
            open_jobs: HashMap::new(),
            next_file_id: 1,
        }
    }

    /// Build the DeviceData for DR_PRN_DEVICE_ANNOUNCE (MS-RDPEPC 2.2.2.1).
    pub fn build_device_data(&self) -> Vec<u8> {
        let pnp_name = encode_utf16le(""); // empty PnP name
        let driver_name = encode_utf16le("Microsoft Print to PDF");
        let printer_name = encode_utf16le(&self.printer_name);

        let mut data = Vec::with_capacity(24 + pnp_name.len() + driver_name.len() + printer_name.len());
        // Flags: RDPDR_PRINTER_ANNOUNCE_FLAG_DEFAULTPRINTER = 0x01 (optional)
        data.extend_from_slice(&0u32.to_le_bytes()); // Flags
        data.extend_from_slice(&0u32.to_le_bytes()); // CodePage
        data.extend_from_slice(&(pnp_name.len() as u32).to_le_bytes()); // PnPNameLen
        data.extend_from_slice(&(driver_name.len() as u32).to_le_bytes()); // DriverNameLen
        data.extend_from_slice(&(printer_name.len() as u32).to_le_bytes()); // PrintNameLen
        data.extend_from_slice(&0u32.to_le_bytes()); // CachedFieldsLen
        data.extend_from_slice(&pnp_name);
        data.extend_from_slice(&driver_name);
        data.extend_from_slice(&printer_name);
        data
    }

    /// Handle an IRP for this printer device.
    /// Returns Some(response) or None to discard.
    pub fn handle_irp(&mut self, major: u32, _minor: u32, completion_id: u32, file_id: u32, data: &[u8]) -> Option<Vec<u8>> {
        let (status, output) = match major {
            IRP_MJ_CREATE => self.handle_create(data),
            IRP_MJ_WRITE => self.handle_write(file_id, data),
            IRP_MJ_CLOSE => self.handle_close(file_id),
            _ => {
                log::debug!("RDPDR printer: unsupported IRP major=0x{:X}", major);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        };
        Some(build_io_completion(self.device_id, completion_id, status, &output))
    }

    fn handle_create(&mut self, _data: &[u8]) -> (u32, Vec<u8>) {
        let file_id = self.next_file_id;
        self.next_file_id += 1;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("print_job_{}_{}.prn", file_id, timestamp);
        let path = self.output_dir.join(&filename);

        match File::create(&path) {
            Ok(f) => {
                log::info!("RDPDR printer {}: new print job -> {:?}", self.session_id, path);
                self.open_jobs.insert(file_id, PrintJob { file: f, path, bytes_written: 0 });
                (STATUS_SUCCESS, create_response(file_id, 2)) // FILE_CREATED
            }
            Err(e) => {
                log::error!("RDPDR printer {}: failed to create file: {}", self.session_id, e);
                (STATUS_UNSUCCESSFUL, create_response(0, 0))
            }
        }
    }

    fn handle_write(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 32 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let length = read_u32(data, 0) as usize;
        let _offset = read_u64(data, 4);
        let write_data = &data[32..32 + length.min(data.len() - 32)];

        if let Some(job) = self.open_jobs.get_mut(&file_id) {
            match job.file.write_all(write_data) {
                Ok(_) => {
                    job.bytes_written += write_data.len() as u64;
                    let mut out = Vec::with_capacity(5);
                    out.extend_from_slice(&(write_data.len() as u32).to_le_bytes());
                    out.push(0); // padding
                    (STATUS_SUCCESS, out)
                }
                Err(e) => {
                    log::error!("RDPDR printer {}: write error: {}", self.session_id, e);
                    (STATUS_UNSUCCESSFUL, Vec::new())
                }
            }
        } else {
            (STATUS_UNSUCCESSFUL, Vec::new())
        }
    }

    fn handle_close(&mut self, file_id: u32) -> (u32, Vec<u8>) {
        if let Some(mut job) = self.open_jobs.remove(&file_id) {
            let _ = job.file.flush();
            let _ = job.file.sync_all();
            drop(job.file);

            let native_print_error = if self.output_mode == PrinterOutputMode::NativePrint {
                try_native_print(&job.path).err()
            } else {
                None
            };
            let delivered_mode = if native_print_error.is_none() && self.output_mode == PrinterOutputMode::NativePrint {
                "native-print"
            } else {
                "spool-file"
            };

            log::info!(
                "RDPDR printer {}: print job complete -> {:?} ({} bytes)",
                self.session_id, job.path, job.bytes_written
            );
            // Notify frontend
            let _ = self.emitter.emit_event("rdp://print-job-complete", serde_json::json!({
                "sessionId": self.session_id,
                "filePath": job.path.to_string_lossy(),
                "fileName": job.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                "size": job.bytes_written,
                "deliveryMode": delivered_mode,
                "nativePrintRequested": self.output_mode == PrinterOutputMode::NativePrint,
                "nativePrintError": native_print_error,
            }));
        }
        (STATUS_SUCCESS, vec![0u8; 5]) // padding per spec
    }
}

fn try_native_print(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let script = "try { Start-Process -FilePath $args[0] -Verb Print -PassThru | Wait-Process -Timeout 10; exit 0 } catch { Write-Error $_; exit 1 }";
        let status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .arg(path.as_os_str())
            .status()
            .map_err(|error| format!("failed to launch native print command: {error}"))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!("native print command exited with status {status}"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        for command in ["lpr", "lp"] {
            match Command::new(command).arg(path.as_os_str()).status() {
                Ok(status) if status.success() => return Ok(()),
                Ok(_) => continue,
                Err(_) => continue,
            }
        }

        Err("no native print command succeeded (tried lpr, lp)".to_string())
    }
}

/// Build the Create response (FileId + Information) for printer IRP_MJ_CREATE.
fn create_response(file_id: u32, information: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(5);
    out.extend_from_slice(&file_id.to_le_bytes());
    out.push(information as u8);
    out
}
