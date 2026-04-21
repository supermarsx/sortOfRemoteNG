//! Kernel module management — lsmod, modinfo, modprobe, blacklisting, autoloading.

use crate::client;
use crate::error::KernelError;
use crate::types::{KernelHost, KernelModule, ModuleInfo, ModuleParameter, ModuleState};

/// Parse lsmod output into `Vec<KernelModule>`.
///
/// lsmod format:
/// ```text
/// Module                  Size  Used by
/// nf_conntrack          172032  3 nf_nat,nf_conntrack_netlink,xt_conntrack
/// ```
pub async fn list_loaded_modules(host: &KernelHost) -> Result<Vec<KernelModule>, KernelError> {
    let out = client::exec_ok(host, "lsmod", &[]).await?;
    let mut modules = Vec::new();
    for line in out.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(4, char::is_whitespace).collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].to_string();
        let size_bytes = parts[1].trim().parse::<u64>().unwrap_or(0);
        let rest = if parts.len() > 3 { parts[3].trim() } else { "" };
        // rest is like "3 nf_nat,nf_conntrack_netlink,xt_conntrack"  or just "0"
        let (use_count, used_by) = parse_used_by(rest);
        modules.push(KernelModule {
            name,
            size_bytes,
            used_by,
            use_count,
            state: ModuleState::Live,
            offset: None,
            taint: None,
        });
    }
    // Enrich with /proc/modules for state/offset/taint
    if let Ok(proc) = client::exec_shell(host, "cat /proc/modules").await {
        let proc_map: std::collections::HashMap<
            String,
            (ModuleState, Option<String>, Option<String>),
        > = proc.lines().filter_map(parse_proc_module_line).collect();
        for m in &mut modules {
            if let Some((state, offset, taint)) = proc_map.get(&m.name) {
                m.state = state.clone();
                m.offset = offset.clone();
                m.taint = taint.clone();
            }
        }
    }
    Ok(modules)
}

fn parse_used_by(s: &str) -> (u32, Vec<String>) {
    if s.is_empty() {
        return (0, vec![]);
    }
    let parts: Vec<&str> = s.splitn(2, char::is_whitespace).collect();
    let count = parts[0].trim().parse::<u32>().unwrap_or(0);
    let users = if parts.len() > 1 && !parts[1].trim().is_empty() {
        parts[1]
            .split(',')
            .map(|u| u.trim().to_string())
            .filter(|u| !u.is_empty())
            .collect()
    } else {
        vec![]
    };
    (count, users)
}

/// Parse a single /proc/modules line:
/// `nf_conntrack 172032 3 nf_nat,..., Live 0xffffffffc0a60000 (E)`
#[allow(clippy::type_complexity)]
fn parse_proc_module_line(
    line: &str,
) -> Option<(String, (ModuleState, Option<String>, Option<String>))> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    let name = parts[0].to_string();
    let state = ModuleState::parse(parts[4]);
    let offset = parts.get(5).map(|s| s.to_string());
    let taint = parts
        .get(6)
        .map(|s| s.trim_matches(|c| c == '(' || c == ')').to_string());
    Some((name, (state, offset, taint)))
}

/// Get detailed module information via `modinfo`.
pub async fn get_module_info(host: &KernelHost, name: &str) -> Result<ModuleInfo, KernelError> {
    let out = client::exec_ok(host, "modinfo", &[name])
        .await
        .map_err(|e| {
            if matches!(e, KernelError::CommandFailed { .. }) {
                KernelError::ModuleNotFound(name.to_string())
            } else {
                e
            }
        })?;
    parse_modinfo(&out, name)
}

fn parse_modinfo(text: &str, name: &str) -> Result<ModuleInfo, KernelError> {
    let mut info = ModuleInfo {
        name: name.to_string(),
        filename: String::new(),
        license: String::new(),
        description: String::new(),
        author: String::new(),
        version: String::new(),
        firmware: vec![],
        depends: vec![],
        alias: vec![],
        parm: vec![],
    };
    for line in text.lines() {
        let (key, value) = match line.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };
        match key {
            "filename" => info.filename = value.to_string(),
            "license" => info.license = value.to_string(),
            "description" => info.description = value.to_string(),
            "author" => info.author = value.to_string(),
            "version" | "srcversion" if info.version.is_empty() => {
                info.version = value.to_string();
            }
            "firmware" => info.firmware.push(value.to_string()),
            "depends" => {
                info.depends = value
                    .split(',')
                    .map(|d| d.trim().to_string())
                    .filter(|d| !d.is_empty())
                    .collect();
            }
            "alias" => info.alias.push(value.to_string()),
            "parm" => {
                // Format: "param_name:description (type)"
                if let Some(mp) = parse_modinfo_parm(value) {
                    info.parm.push(mp);
                }
            }
            "name" => info.name = value.to_string(),
            _ => {}
        }
    }
    Ok(info)
}

/// Parse a modinfo parm line like `max_entries:Maximum entries (int)`.
fn parse_modinfo_parm(value: &str) -> Option<ModuleParameter> {
    let (name, rest) = value.split_once(':')?;
    let name = name.trim().to_string();
    let rest = rest.trim();
    // Extract type from trailing parenthesized value
    let (description, param_type) = if let Some(idx) = rest.rfind('(') {
        let desc = rest[..idx].trim().to_string();
        let ptype = rest[idx + 1..].trim_end_matches(')').trim().to_string();
        (desc, ptype)
    } else {
        (rest.to_string(), String::new())
    };
    Some(ModuleParameter {
        name,
        param_type,
        description,
        current_value: None,
    })
}

/// Load a kernel module with optional parameters.
pub async fn load_module(
    host: &KernelHost,
    name: &str,
    params: &[(&str, &str)],
) -> Result<(), KernelError> {
    let mut args = vec![name];
    let param_strings: Vec<String> = params.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let param_refs: Vec<&str> = param_strings.iter().map(|s| s.as_str()).collect();
    args.extend(param_refs);
    let arg_refs: Vec<&str> = args.to_vec();
    client::exec_ok(host, "modprobe", &arg_refs).await?;
    Ok(())
}

/// Unload a kernel module, optionally with force.
pub async fn unload_module(host: &KernelHost, name: &str, force: bool) -> Result<(), KernelError> {
    // First check if module is loaded
    if !check_module_loaded(host, name).await? {
        return Err(KernelError::ModuleNotFound(name.to_string()));
    }

    let result = if force {
        client::exec(host, "rmmod", &["-f", name]).await
    } else {
        client::exec(host, "modprobe", &["-r", name]).await
    };

    match result {
        Ok((_, stderr, code)) if code != 0 => {
            if stderr.contains("is in use") || stderr.contains("is builtin") {
                Err(KernelError::ModuleInUse(name.to_string()))
            } else {
                Err(KernelError::CommandFailed {
                    command: format!("unload {name}"),
                    exit_code: code,
                    stderr,
                })
            }
        }
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}

/// Unload and re-load a module with optional parameters.
pub async fn reload_module(
    host: &KernelHost,
    name: &str,
    params: &[(&str, &str)],
) -> Result<(), KernelError> {
    unload_module(host, name, false).await?;
    load_module(host, name, params).await
}

/// Read current parameter values from /sys/module/<name>/parameters/.
pub async fn get_module_params(
    host: &KernelHost,
    name: &str,
) -> Result<Vec<ModuleParameter>, KernelError> {
    let cmd = format!(
        "for f in /sys/module/{name}/parameters/*; do \
         [ -f \"$f\" ] && echo \"$(basename $f)=$(cat $f 2>/dev/null)\"; \
         done"
    );
    let out = client::exec_shell(host, &cmd).await?;
    let mut params = Vec::new();
    for line in out.lines() {
        if let Some((param_name, value)) = line.split_once('=') {
            params.push(ModuleParameter {
                name: param_name.trim().to_string(),
                param_type: String::new(),
                description: String::new(),
                current_value: Some(value.trim().to_string()),
            });
        }
    }
    // Try to enrich with modinfo data
    if let Ok(info) = get_module_info(host, name).await {
        for p in &mut params {
            if let Some(ip) = info.parm.iter().find(|ip| ip.name == p.name) {
                p.param_type.clone_from(&ip.param_type);
                p.description.clone_from(&ip.description);
            }
        }
    }
    Ok(params)
}

/// Write a value to a module parameter at runtime.
pub async fn set_module_param(
    host: &KernelHost,
    module: &str,
    param: &str,
    value: &str,
) -> Result<(), KernelError> {
    let cmd = format!(
        "echo '{}' > /sys/module/{}/{}/{}",
        value.replace('\'', "'\\''"),
        module,
        "parameters",
        param
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// List all available module files under /lib/modules/$(uname -r)/.
pub async fn list_available_modules(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "find /lib/modules/$(uname -r) -name '*.ko*' -printf '%f\\n' 2>/dev/null | \
               sed 's/\\.ko.*$//' | sort -u";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Search modules by query string (matches filename, description, alias).
pub async fn search_modules(
    host: &KernelHost,
    query: &str,
) -> Result<Vec<ModuleInfo>, KernelError> {
    let available = list_available_modules(host).await?;
    let q_lower = query.to_lowercase();
    let mut results = Vec::new();
    for name in &available {
        if name.to_lowercase().contains(&q_lower) {
            if let Ok(info) = get_module_info(host, name).await {
                results.push(info);
            }
        }
    }
    Ok(results)
}

/// Get the dependency chain for a module.
pub async fn get_module_dependencies(
    host: &KernelHost,
    name: &str,
) -> Result<Vec<String>, KernelError> {
    let out = client::exec_ok(host, "modprobe", &["--show-depends", name]).await?;
    let deps: Vec<String> = out
        .lines()
        .filter_map(|line| {
            // Lines like: insmod /lib/modules/.../dep.ko
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let path = parts[1];
                let basename = path.rsplit('/').next().unwrap_or(path);
                Some(
                    basename
                        .trim_end_matches(".ko")
                        .trim_end_matches(".ko.xz")
                        .trim_end_matches(".ko.zst")
                        .to_string(),
                )
            } else {
                None
            }
        })
        .filter(|d| d != name)
        .collect();
    Ok(deps)
}

/// Check whether a module is currently loaded.
pub async fn check_module_loaded(host: &KernelHost, name: &str) -> Result<bool, KernelError> {
    let (stdout, _, _) = client::exec(host, "lsmod", &[]).await?;
    Ok(stdout
        .lines()
        .any(|line| line.split_whitespace().next() == Some(name)))
}

/// Blacklist a module by adding it to /etc/modprobe.d/blacklist-sorng.conf.
pub async fn blacklist_module(host: &KernelHost, name: &str) -> Result<(), KernelError> {
    let cmd = format!(
        "grep -qxF 'blacklist {name}' /etc/modprobe.d/blacklist-sorng.conf 2>/dev/null || \
         echo 'blacklist {name}' >> /etc/modprobe.d/blacklist-sorng.conf"
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// Remove a module from the blacklist.
pub async fn unblacklist_module(host: &KernelHost, name: &str) -> Result<(), KernelError> {
    let cmd = format!(
        "sed -i '/^blacklist {name}$/d' /etc/modprobe.d/blacklist-sorng.conf 2>/dev/null; true"
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// List all blacklisted modules from /etc/modprobe.d/*.
pub async fn list_blacklisted(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "grep -rh '^blacklist ' /etc/modprobe.d/ 2>/dev/null | awk '{print $2}' | sort -u";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Get all modprobe.d configuration file contents.
pub async fn get_modprobe_config(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "for f in /etc/modprobe.d/*.conf; do \
               [ -f \"$f\" ] && echo \"=== $f ===\" && cat \"$f\"; done";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out.lines().map(|l| l.to_string()).collect())
}

/// Write persistent options for a module to /etc/modprobe.d/<name>.conf.
pub async fn set_module_options(
    host: &KernelHost,
    name: &str,
    options: &[(&str, &str)],
) -> Result<(), KernelError> {
    let opts: Vec<String> = options.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let line = format!("options {} {}", name, opts.join(" "));
    let cmd = format!(
        "echo '{}' > /etc/modprobe.d/{}.conf",
        line.replace('\'', "'\\''"),
        name
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// Get modules configured for autoloading.
pub async fn get_modules_autoload(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "cat /etc/modules-load.d/*.conf /etc/modules 2>/dev/null | \
               grep -v '^#' | grep -v '^$' | sort -u";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Add a module to autoload at boot via /etc/modules-load.d/sorng.conf.
pub async fn add_autoload_module(host: &KernelHost, name: &str) -> Result<(), KernelError> {
    let cmd = format!(
        "grep -qxF '{name}' /etc/modules-load.d/sorng.conf 2>/dev/null || \
         echo '{name}' >> /etc/modules-load.d/sorng.conf"
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// Remove a module from autoloading.
pub async fn remove_autoload_module(host: &KernelHost, name: &str) -> Result<(), KernelError> {
    let cmd = format!("sed -i '/^{name}$/d' /etc/modules-load.d/sorng.conf 2>/dev/null; true");
    client::exec_shell(host, &cmd).await?;
    Ok(())
}
