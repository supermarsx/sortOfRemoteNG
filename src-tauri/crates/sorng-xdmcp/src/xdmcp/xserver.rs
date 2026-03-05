//! X server process management — launch Xephyr, Xorg, Xvfb, etc.

use crate::xdmcp::types::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// State of the X server process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum XServerState {
    Idle,
    Starting,
    Running,
    Stopped,
    Failed,
}

/// Information about a running X server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XServerInfo {
    pub server_type: String,
    pub display_number: u32,
    pub pid: Option<u32>,
    pub state: XServerState,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub color_depth: u8,
}

/// Locate an X server binary.
pub fn find_x_server(server_type: &XServerType, custom_path: Option<&str>) -> Result<PathBuf, XdmcpError> {
    if let Some(p) = custom_path {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
        return Err(XdmcpError::x_server(format!("X server not found at: {}", p)));
    }

    let binary_name = match server_type {
        XServerType::Xephyr => "Xephyr",
        XServerType::Xorg => "Xorg",
        XServerType::XWayland => "Xwayland",
        XServerType::Xvfb => "Xvfb",
        XServerType::VcXsrv => "vcxsrv",
        XServerType::Xming => "Xming",
        XServerType::MobaXterm => "MobaXterm",
        XServerType::Custom(name) => name,
    };

    // Check common locations
    let unix_paths = [
        format!("/usr/bin/{}", binary_name),
        format!("/usr/local/bin/{}", binary_name),
    ];

    let windows_paths = [
        format!("C:\\Program Files\\VcXsrv\\{}.exe", binary_name),
        format!("C:\\Program Files (x86)\\Xming\\{}.exe", binary_name),
    ];

    for p in unix_paths.iter().chain(windows_paths.iter()) {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
    }

    // Try PATH
    if let Ok(path) = which::which(binary_name) {
        return Ok(path);
    }

    Err(XdmcpError::x_server(format!("{} not found in PATH", binary_name)))
}

/// Build the command-line arguments for launching an X server.
pub fn build_x_server_args(
    server_type: &XServerType,
    display_number: u32,
    width: u32,
    height: u32,
    depth: u8,
    xdmcp_host: &str,
    xdmcp_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut args = Vec::new();

    // Display number
    args.push(format!(":{}", display_number));

    match server_type {
        XServerType::Xephyr => {
            args.push("-screen".into());
            args.push(format!("{}x{}", width, height));
            args.push("-query".into());
            args.push(xdmcp_host.into());
            if xdmcp_port != XDMCP_PORT {
                args.push("-port".into());
                args.push(xdmcp_port.to_string());
            }
            args.push("-resizeable".into());
        }
        XServerType::Xvfb => {
            args.push("-screen".into());
            args.push("0".into());
            args.push(format!("{}x{}x{}", width, height, depth));
        }
        XServerType::VcXsrv | XServerType::Xming => {
            args.push("-query".into());
            args.push(xdmcp_host.into());
            args.push("-screen".into());
            args.push(format!("0 {}x{}", width, height));
        }
        _ => {
            args.push("-query".into());
            args.push(xdmcp_host.into());
        }
    }

    args.extend(extra_args.iter().cloned());
    args
}

/// Find an available display number (starting from 10).
pub fn find_available_display(start: u32) -> u32 {
    // Check for X lock files
    for n in start..start + 100 {
        let lock_file = format!("/tmp/.X{}-lock", n);
        let socket_dir = format!("/tmp/.X11-unix/X{}", n);
        if !std::path::Path::new(&lock_file).exists()
            && !std::path::Path::new(&socket_dir).exists()
        {
            return n;
        }
    }
    start + 100 // fallback
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xephyr_args() {
        let args = build_x_server_args(
            &XServerType::Xephyr,
            10,
            1024,
            768,
            24,
            "192.168.1.100",
            177,
            &[],
        );
        assert!(args.contains(&":10".to_string()));
        assert!(args.contains(&"-query".to_string()));
        assert!(args.contains(&"192.168.1.100".to_string()));
        assert!(args.contains(&"1024x768".to_string()));
    }

    #[test]
    fn xvfb_args() {
        let args = build_x_server_args(
            &XServerType::Xvfb,
            20,
            1920,
            1080,
            24,
            "10.0.0.1",
            177,
            &[],
        );
        assert!(args.contains(&":20".to_string()));
        assert!(args.contains(&"1920x1080x24".to_string()));
    }

    #[test]
    fn custom_port() {
        let args = build_x_server_args(
            &XServerType::Xephyr,
            10,
            1024,
            768,
            24,
            "host",
            1177,
            &[],
        );
        assert!(args.contains(&"-port".to_string()));
        assert!(args.contains(&"1177".to_string()));
    }

    #[test]
    fn extra_args() {
        let args = build_x_server_args(
            &XServerType::Xephyr,
            10,
            1024,
            768,
            24,
            "host",
            177,
            &["-ac".into(), "-noreset".into()],
        );
        assert!(args.contains(&"-ac".to_string()));
        assert!(args.contains(&"-noreset".to_string()));
    }

    #[test]
    fn find_display() {
        // On most test machines, display 99+ should be available
        let d = find_available_display(99);
        assert!(d >= 99);
    }
}
