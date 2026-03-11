use crate::ssh::{SshCompressionConfig, SshConnectionConfig, SshServiceState};
use rquickjs::prelude::Async;
use rquickjs::{async_with, AsyncContext, AsyncRuntime, Function, Object};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type ScriptServiceState = Arc<Mutex<ScriptService>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptContext {
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub trigger: String,
}

impl Default for ScriptContext {
    fn default() -> Self {
        ScriptContext {
            connection_id: None,
            session_id: None,
            trigger: "test".to_string(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub struct ScriptService {
    ssh_service: SshServiceState,
}

impl ScriptService {
    pub fn new(ssh_service: SshServiceState) -> ScriptServiceState {
        Arc::new(Mutex::new(ScriptService { ssh_service }))
    }

    pub async fn execute_script(
        &mut self,
        code: String,
        script_type: String,
        _context: ScriptContext,
    ) -> Result<ScriptResult, String> {
        match script_type.as_str() {
            "javascript" => {
                // Basic security check
                if code.contains("eval(") || code.contains("Function(") || code.contains("require(")
                {
                    return Err("Potentially unsafe code detected".to_string());
                }

                let ssh_service = self.ssh_service.clone();
                let (tx, rx) = tokio::sync::oneshot::channel();

                // Spawn a dedicated thread for the JS runtime to avoid Send issues
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build();

                    match rt {
                        Ok(rt) => {
                            rt.block_on(async move {
                                let js_rt_res = AsyncRuntime::new();
                                match js_rt_res {
                                    Ok(js_rt) => {
                                        let js_ctx_res = AsyncContext::full(&js_rt).await;
                                        match js_ctx_res {
                                            Ok(ctx) => {
                                                let result = async_with!(ctx => |ctx| {
                                                    // Add basic globals
                                                    let global = ctx.globals();

                                                    // Console mock
                                                    let _ = {
                                                        let _: () = ctx.eval::<(), _>("({
                                                            log: (...args) => {},
                                                            warn: (...args) => {},
                                                            error: (...args) => {}
                                                        })").unwrap_or(());
                                                        global.set("console", ())
                                                    };

                                                    // SSH Module Binding
                                                    if let Ok(ssh_obj) = Object::new(ctx.clone()) {
                                                        // ssh.connect(host, port, username, password)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("connect", Function::new(ctx.clone(), Async(move |host: String, port: u16, username: String, password: Option<String>| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let config = SshConnectionConfig {
                                                                    host,
                                                                    port,
                                                                    username,
                                                                    password,
                                                                    private_key_path: None,
                                                                    private_key_passphrase: None,
                                                                    jump_hosts: vec![],
                                                                    proxy_config: None,
                                                                    proxy_chain: None,
                                                                    mixed_chain: None,
                                                                    openvpn_config: None,
                                                                    connect_timeout: Some(30),
                                                                    keep_alive_interval: Some(60),
                                                                    strict_host_key_checking: false,
                                                                    known_hosts_path: None,
                                                                    totp_secret: None,
                                                                    keyboard_interactive_responses: vec![],
                                                                    agent_forwarding: false,
                                                                    tcp_no_delay: true,
                                                                    tcp_keepalive: true,
                                                                    keepalive_probes: 3,
                                                                    ip_protocol: "auto".to_string(),
                                                                    compression: false,
                                                                    compression_level: 6,
                                                                    compression_config: SshCompressionConfig::default(),
                                                                    ssh_version: "auto".to_string(),
                                                                    preferred_ciphers: vec![],
                                                                    preferred_macs: vec![],
                                                                    preferred_kex: vec![],
                                                                    preferred_host_key_algorithms: vec![],
                                                                    x11_forwarding: None,
                                                                    proxy_command: None,
                                                                    pty_type: None,
                                                                    environment: std::collections::HashMap::new(),
                                                                    sk_auth: false,
                                                                    sk_device_path: None,
                                                                    sk_pin: None,
                                                                    sk_application: None,
                                                                };

                                                                let mut service = ssh_service.lock().await;
                            service.connect_ssh(config).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        // ssh.exec(session_id, command)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("exec", Function::new(ctx.clone(), Async(move |session_id: String, command: String| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let mut service = ssh_service.lock().await;
                            service.execute_command(&session_id, command, None).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        // ssh.disconnect(session_id)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("disconnect", Function::new(ctx.clone(), Async(move |session_id: String| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let mut service = ssh_service.lock().await;
                            service.disconnect_ssh(&session_id).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        let _ = global.set("ssh", ssh_obj);
                                                    }

                                                    // Execute the script and await the promise
                                                    let promise = ctx.eval_promise::<String>(code);
                                                    match promise {
                                                        Ok(p) => {
                                                            match p.into_future().await {
                                                                Ok(res) => Ok::<String, String>(res),
                                                                Err(e) => Err(format!("Script runtime error: {}", e))
                                                            }
                                                        },
                                                        Err(e) => Err(format!("Script eval error: {}", e))
                                                    }
                                                }).await;

                                                let _ = tx.send(result);
                                            },
                                            Err(e) => {
                                                let _ = tx.send(Err(format!("Failed to create JS context: {}", e)));
                                            }
                                        }
                                    },
                                    Err(e) => {
                                        let _ = tx.send(Err(format!("Failed to create JS runtime: {}", e)));
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            let _ = tx.send(Err(format!("Failed to create tokio runtime: {}", e)));
                        }
                    }
                });

                // Await the result from the thread
                match rx.await {
                    Ok(res) => match res {
                        Ok(output) => Ok(ScriptResult {
                            success: true,
                            result: Some(output),
                            error: None,
                        }),
                        Err(e) => Ok(ScriptResult {
                            success: false,
                            result: None,
                            error: Some(e),
                        }),
                    },
                    Err(e) => Err(format!("Script thread panicked or cancelled: {}", e)),
                }
            }
            "typescript" => Err("TypeScript execution not yet implemented".to_string()),
            _ => Err(format!("Unsupported script type: {}", script_type)),
        }
    }
}
