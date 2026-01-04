use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio::task;
use tokio::sync::mpsc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use serialport::{};
use std::io::Read;
use std::time::Duration;

pub type SerialServiceState = Arc<Mutex<SerialService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialSession {
    pub id: String,
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub connected: bool,
}

#[derive(Debug)]
struct SerialConnection {
    session: SerialSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct SerialService {
    connections: HashMap<String, SerialConnection>,
}

impl SerialService {
    pub fn new() -> SerialServiceState {
        Arc::new(Mutex::new(SerialService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_serial(
        &mut self,
        port_name: String,
        baud_rate: u32,
        data_bits: u8,
        parity: String,
        stop_bits: u8,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Parse parity
        let parity = match parity.as_str() {
            "none" => serialport::Parity::None,
            "odd" => serialport::Parity::Odd,
            "even" => serialport::Parity::Even,
            _ => return Err("Invalid parity setting".to_string()),
        };

        // Parse stop bits
        let stop_bits = match stop_bits {
            1 => serialport::StopBits::One,
            2 => serialport::StopBits::Two,
            _ => return Err("Invalid stop bits setting".to_string()),
        };

        // Parse data bits
        let data_bits = match data_bits {
            5 => serialport::DataBits::Five,
            6 => serialport::DataBits::Six,
            7 => serialport::DataBits::Seven,
            8 => serialport::DataBits::Eight,
            _ => return Err("Invalid data bits setting".to_string()),
        };

        // Open serial port
        let mut port = serialport::new(&port_name, baud_rate)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| format!("Failed to open serial port {}: {}", port_name, e))?;

        // Create session info
        let session = SerialSession {
            id: session_id.clone(),
            port_name: port_name.clone(),
            baud_rate,
            data_bits: data_bits as u8,
            parity: parity.to_string(),
            stop_bits: stop_bits as u8,
            connected: true,
        };

        // Spawn a task to handle the connection
        let handle = {
            let session_id = session_id.clone();

            task::spawn(async move {
                let mut buf = [0; 1024];
                let mut shutdown_rx = shutdown_rx;

                loop {
                    tokio::select! {
                        _ = shutdown_rx.recv() => {
                            // Shutdown signal received
                            break;
                        }
                        result = tokio::task::spawn_blocking({
                            let mut port_clone = port.try_clone().unwrap();
                            move || {
                                match port_clone.read(&mut buf) {
                                    Ok(n) => Ok((n, buf)),
                                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                                        // Timeout is expected, continue
                                        std::thread::sleep(Duration::from_millis(10));
                                        Ok((0, buf))
                                    }
                                    Err(e) => Err(e),
                                }
                            }
                        }) => {
                            match result {
                                Ok(Ok((0, _))) => {
                                    // No data, continue
                                    continue;
                                }
                                Ok(Ok((n, data))) => {
                                    // Process received data
                                    let received_data = &data[..n];
                                    println!("Serial received: {:?}", String::from_utf8_lossy(received_data));
                                }
                                Ok(Err(e)) => {
                                    eprintln!("Serial read error: {}", e);
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("Task join error: {}", e);
                                    break;
                                }
                            }
                        }
                    }
                }
            })
        };

        let connection = SerialConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    pub async fn disconnect_serial(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(session_id) {
            // Send shutdown signal
            let _ = connection.shutdown_tx.send(()).await;

            // Wait for the task to finish
            let _ = connection._handle.await;

            Ok(())
        } else {
            Err("Serial session not found".to_string())
        }
    }

    pub async fn send_serial_data(&mut self, _session_id: &str, _data: Vec<u8>) -> Result<(), String> {
        // In this basic implementation, we don't maintain a persistent port for sending data
        // A more complete implementation would need to use channels or other IPC mechanisms
        Err("Data sending not implemented in this basic serial client".to_string())
    }

    pub async fn get_serial_session_info(&self, session_id: &str) -> Result<SerialSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err("Serial session not found".to_string())
        }
    }

    pub async fn list_serial_sessions(&self) -> Vec<SerialSession> {
        self.connections.values()
            .map(|conn| conn.session.clone())
            .collect()
    }

    pub async fn list_available_ports(&self) -> Result<Vec<String>, String> {
        tokio::task::spawn_blocking(|| {
            let ports = serialport::available_ports()
                .map_err(|e| format!("Failed to list serial ports: {}", e))?;

            Ok(ports.into_iter()
                .map(|port| port.port_name)
                .collect())
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
}

#[tauri::command]
pub async fn connect_serial(
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    parity: String,
    stop_bits: u8,
    state: tauri::State<'_, SerialServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_serial(port_name, baud_rate, data_bits, parity, stop_bits).await
}

#[tauri::command]
pub async fn disconnect_serial(
    session_id: String,
    state: tauri::State<'_, SerialServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_serial(&session_id).await
}

#[tauri::command]
pub async fn send_serial_data(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, SerialServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_serial_data(&session_id, data).await
}

#[tauri::command]
pub async fn get_serial_session_info(
    session_id: String,
    state: tauri::State<'_, SerialServiceState>,
) -> Result<SerialSession, String> {
    let service = state.lock().await;
    service.get_serial_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_serial_sessions(
    state: tauri::State<'_, SerialServiceState>,
) -> Result<Vec<SerialSession>, String> {
    let service = state.lock().await;
    Ok(service.list_serial_sessions().await)
}

#[tauri::command]
pub async fn list_available_serial_ports(
    state: tauri::State<'_, SerialServiceState>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service.list_available_ports().await
}