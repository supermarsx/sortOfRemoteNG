//! Optional installed static analyzers. User text is stdin DATA, never command
//! text, a scriptblock, a filename, or an execution-engine action.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Semaphore,
};

const MAX_SOURCE: usize = 64 * 1024;
const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_STDERR: usize = 64 * 1024;
const DEADLINE: Duration = Duration::from_secs(5);
const TOOL_ERROR: &str = "The installed static-analysis tool failed or returned unsupported output. No script was executed or saved.";
const LIMIT_ERROR: &str =
    "Script tooling accepts at most 64 KiB of UTF-8 text without NUL characters.";
static WORKERS: OnceLock<Semaphore> = OnceLock::new();

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Bash,
    Sh,
    Powershell,
    Batch,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub analysis_available: bool,
    pub format_available: bool,
    pub analyzer: Option<String>,
    pub formatter: Option<String>,
    pub reason: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct Capabilities {
    pub languages: BTreeMap<String, Capability>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: String,
    pub code: String,
    pub message: String,
}
#[derive(Debug, Serialize)]
pub struct Analysis {
    pub available: bool,
    pub tool: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub reason: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct Formatting {
    pub available: bool,
    pub tool: Option<String>,
    pub formatted: Option<String>,
    pub reason: Option<String>,
}

fn permit() -> Result<tokio::sync::SemaphorePermit<'static>, String> {
    WORKERS
        .get_or_init(|| Semaphore::new(2))
        .try_acquire()
        .map_err(|_| "Two static-tool requests are already running. Try again shortly.".to_string())
}
fn validate_source(source: &str) -> Result<(), String> {
    if source.len() > MAX_SOURCE || source.contains('\0') {
        Err(LIMIT_ERROR.into())
    } else {
        Ok(())
    }
}

/// ParseInput can resolve `using assembly`, and DSC parsing/module analysis can
/// load dependencies. Refuse these constructs BEFORE invoking PowerShell. This
/// deliberately conservative lexical gate also rejects words in comments and
/// strings rather than trying to parse potentially active declarations first.
fn validate_powershell_source(source: &str) -> Result<(), String> {
    let normalized: String = source
        .chars()
        .filter(|character| *character != '`')
        .collect();
    static DECLARATIONS: OnceLock<regex::Regex> = OnceLock::new();
    let declarations = DECLARATIONS.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(using|requires|configuration|dynamicparam|import-dscresource)\b")
            .expect("constant declaration expression")
    });
    if declarations.is_match(&normalized) {
        return Err("For safety, native PowerShell tooling does not analyze using, requires, DSC configuration, or dynamicparam declarations, including these words in comments or strings. No parser was started.".into());
    }
    Ok(())
}

/// Resolve only fixed program names from absolute PATH directories, never cwd,
/// shell aliases, PATHEXT scripts, custom executable arguments, or user paths.
fn executable(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    find_executable(name, std::env::split_paths(&paths))
}
fn find_executable(name: &str, paths: impl Iterator<Item = PathBuf>) -> Option<PathBuf> {
    let current_directory = std::env::current_dir().ok()?.canonicalize().ok()?;
    #[cfg(windows)]
    let file_name = format!("{name}.exe");
    #[cfg(not(windows))]
    let file_name = name.to_string();
    paths
        .filter(|path| path.is_absolute())
        .filter_map(|path| {
            let directory = path.canonicalize().ok()?;
            (directory != current_directory).then(|| directory.join(&file_name))
        })
        .find_map(|path| {
            let canonical = path.canonicalize().ok()?;
            let metadata = canonical.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o111 == 0 {
                    return None;
                }
            }
            Some(canonical)
        })
}
fn powershell() -> Option<PathBuf> {
    executable("pwsh").or_else(|| executable("powershell"))
}

#[derive(Debug)]
struct ToolOutput {
    code: Option<i32>,
    stdout: Vec<u8>,
}
async fn bounded_read(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut result)
        .await
        .map_err(|_| TOOL_ERROR.to_string())?;
    if result.len() > limit {
        return Err("Static-tool output exceeded its safety limit; no result was applied.".into());
    }
    Ok(result)
}
async fn run(path: &Path, arguments: &[&str], source: &str) -> Result<ToolOutput, String> {
    run_with_deadline(path, arguments, source, DEADLINE).await
}
async fn run_with_deadline(
    path: &Path,
    arguments: &[&str],
    source: &str,
    deadline: Duration,
) -> Result<ToolOutput, String> {
    let directory = tempfile::tempdir().map_err(|_| TOOL_ERROR.to_string())?;
    let mut command = Command::new(path);
    command
        .args(arguments)
        .current_dir(directory.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("SHFMT_NO_EDITORCONFIG", "true")
        .env("POWERSHELL_TELEMETRY_OPTOUT", "1")
        .env("POWERSHELL_UPDATECHECK", "Off")
        .env_remove("SHELLCHECK_OPTS")
        .env_remove("SHELLCHECK_SOURCE_PATH");
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, including PowerShell.
    let mut child = command.spawn().map_err(|_| {
        "The installed static-analysis tool could not start. Check its local installation."
            .to_string()
    })?;
    let mut input = child.stdin.take().ok_or_else(|| TOOL_ERROR.to_string())?;
    let output = child.stdout.take().ok_or_else(|| TOOL_ERROR.to_string())?;
    let errors = child.stderr.take().ok_or_else(|| TOOL_ERROR.to_string())?;
    let work = async {
        let (_, stdout, _) = tokio::try_join!(
            async move {
                input
                    .write_all(source.as_bytes())
                    .await
                    .map_err(|_| TOOL_ERROR.to_string())?;
                input.shutdown().await.map_err(|_| TOOL_ERROR.to_string())?;
                drop(input);
                Ok::<(), String>(())
            },
            bounded_read(output, MAX_OUTPUT),
            bounded_read(errors, MAX_STDERR)
        )?;
        let status = child.wait().await.map_err(|_| TOOL_ERROR.to_string())?;
        Ok(ToolOutput {
            code: status.code(),
            stdout,
        })
    };
    let result = tokio::time::timeout(deadline, work).await;
    match result {
        Ok(Ok(output)) => Ok(output),
        failed => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
            match failed { Ok(Err(error)) => Err(error), _ => Err("Static analysis exceeded its five-second limit and was stopped. No result was applied.".into()) }
        }
    }
}

// These are constant harnesses. User source is supplied exclusively through
// redirected stdin; no source interpolation, Invoke-Expression, ScriptBlock
// creation, dot sourcing, or execution policy changes are permitted.
const PS_PREFIX: &str = r#"$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$PSModuleAutoLoadingPreference='None';Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop;Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -ErrorAction Stop;[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$source=[Console]::In.ReadToEnd();"#;
const PS_CAPABILITIES: &str = r#"$module=Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1;$analyzer=$false;$formatter=$false;if($module){try{Import-Module $module.Path -ErrorAction Stop;$analyzer=[bool](Get-Command -Name Invoke-ScriptAnalyzer -Module PSScriptAnalyzer -ErrorAction Stop);$formatter=[bool](Get-Command -Name Invoke-Formatter -Module PSScriptAnalyzer -ErrorAction Stop)}catch{$analyzer=$false;$formatter=$false}};[Console]::Write((@{analyzer=$analyzer;formatter=$formatter}|ConvertTo-Json -Compress))"#;
const PS_ANALYZE: &str = r#"
$tokens=$null; $errors=$null;
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);
$diagnostics=@();
foreach($parseIssue in $errors) {
    $diagnostics+=@{line=$parseIssue.Extent.StartLineNumber;column=$parseIssue.Extent.StartColumnNumber;endLine=$parseIssue.Extent.EndLineNumber;endColumn=$parseIssue.Extent.EndColumnNumber;severity='error';code=$parseIssue.ErrorId;message=$parseIssue.Message}
}
$module=Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1;
$tool='PowerShell AST parser';
if($module -and $errors.Count -eq 0) {
    Import-Module $module.Path -ErrorAction Stop;
    $settings=@{IncludeDefaultRules=$true;IncludeRules=@('*');Rules=@{}};
    $results=Invoke-ScriptAnalyzer -ScriptDefinition $source -Settings $settings -IncludeDefaultRules;
    $tool='PSScriptAnalyzer';
    foreach($item in $results) {
        $diagnostics+=@{line=$item.Extent.StartLineNumber;column=$item.Extent.StartColumnNumber;endLine=$item.Extent.EndLineNumber;endColumn=$item.Extent.EndColumnNumber;severity=$item.Severity.ToString().ToLowerInvariant();code=$item.RuleName;message=$item.Message}
    }
}
[Console]::Write((@{tool=$tool;diagnostics=@($diagnostics)}|ConvertTo-Json -Depth 5 -Compress))
"#;
const PS_FORMAT: &str = r#"$tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){throw 'parse'};$module=Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1;if(-not $module){[Console]::Write('null');exit};Import-Module $module.Path -ErrorAction Stop;$settings=@{IncludeRules=@('PSPlaceOpenBrace','PSPlaceCloseBrace','PSUseConsistentWhitespace','PSUseConsistentIndentation','PSAlignAssignmentStatement','PSUseCorrectCasing');Rules=@{PSPlaceOpenBrace=@{Enable=$true;OnSameLine=$true;NewLineAfter=$true};PSPlaceCloseBrace=@{Enable=$true;NewLineAfter=$true};PSUseConsistentIndentation=@{Enable=$true;Kind='space';IndentationSize=4};PSUseConsistentWhitespace=@{Enable=$true;CheckOpenBrace=$true;CheckInnerBrace=$true;CheckOperator=$true};PSAlignAssignmentStatement=@{Enable=$true;CheckHashtable=$true};PSUseCorrectCasing=@{Enable=$true}}};$formatted=Invoke-Formatter -ScriptDefinition $source -Settings $settings;[Console]::Write((@{formatted=$formatted}|ConvertTo-Json -Compress))"#;
async fn run_powershell(
    path: &Path,
    script: &str,
    source: &str,
) -> Result<serde_json::Value, String> {
    run_powershell_with_deadline(path, script, source, DEADLINE).await
}
async fn run_powershell_with_deadline(
    path: &Path,
    script: &str,
    source: &str,
    deadline: Duration,
) -> Result<serde_json::Value, String> {
    validate_powershell_source(source)?;
    let harness = format!("{PS_PREFIX}{script}");
    let result = run_with_deadline(
        path,
        &[
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &harness,
        ],
        source,
        deadline,
    )
    .await?;
    if result.code != Some(0) {
        return Err(TOOL_ERROR.into());
    }
    serde_json::from_slice(&result.stdout).map_err(|_| TOOL_ERROR.into())
}

async fn probe_version(name: &str, arguments: &[&str], deadline: Duration) -> bool {
    let Some(path) = executable(name) else {
        return false;
    };
    let Ok(output) = run_with_deadline(&path, arguments, "", deadline).await else {
        return false;
    };
    if output.code != Some(0) {
        return false;
    }
    let Ok(version) = std::str::from_utf8(&output.stdout) else {
        return false;
    };
    if name == "shellcheck" {
        version.contains("ShellCheck")
    } else {
        version
            .trim()
            .strip_prefix('v')
            .is_some_and(|value| value.starts_with(|c: char| c.is_ascii_digit()))
    }
}

pub async fn capabilities() -> Result<Capabilities, String> {
    let _permit = permit()?;
    let started = std::time::Instant::now();
    let remaining = || DEADLINE.saturating_sub(started.elapsed());
    let shellcheck = probe_version("shellcheck", &["--version"], remaining()).await;
    let shfmt = probe_version("shfmt", &["--version"], remaining()).await;
    let ps = powershell();
    let ps_modules = if let Some(path) = &ps {
        run_powershell_with_deadline(path, PS_CAPABILITIES, "", remaining())
            .await
            .ok()
    } else {
        None
    };
    let ps_ready = ps_modules.is_some();
    let pssa = ps_modules
        .as_ref()
        .is_some_and(|value| value["analyzer"] == true);
    let mut languages = BTreeMap::new();
    for name in ["bash", "sh"] {
        languages.insert(name.into(), Capability { analysis_available: shellcheck, format_available: shfmt, analyzer: shellcheck.then(|| "ShellCheck".into()), formatter: shfmt.then(|| "shfmt".into()), reason: (!shellcheck || !shfmt).then(|| "Optional installed ShellCheck provides analysis; shfmt provides formatting. No tools are installed automatically.".into()) });
    }
    languages.insert("powershell".into(), Capability { analysis_available: ps_ready, format_available: pssa, analyzer: ps_ready.then(|| if pssa { "PSScriptAnalyzer" } else { "PowerShell AST parser" }.into()), formatter: pssa.then(|| "Invoke-Formatter".into()), reason: (!pssa).then(|| "An installed PowerShell provides syntax analysis; optional installed PSScriptAnalyzer adds linting and formatting.".into()) });
    languages.insert("batch".into(), Capability { analysis_available: false, format_available: false, analyzer: None, formatter: None, reason: Some("No formal native batch analyzer or formatter is configured. Editor checks are basic only; batch files are never executed for validation.".into()) });
    Ok(Capabilities { languages })
}

fn shfmt_arguments(language: Language) -> [&'static str; 7] {
    // Explicit parser/printer options disable EditorConfig discovery in shfmt.
    // https://github.com/mvdan/sh/blob/master/cmd/shfmt/main.go
    [
        "-ln",
        if language == Language::Bash {
            "bash"
        } else {
            "posix"
        },
        "-i",
        "2",
        "-bn",
        "-ci",
        "-",
    ]
}

fn unavailable_analysis(reason: &str) -> Analysis {
    Analysis {
        available: false,
        tool: None,
        diagnostics: Vec::new(),
        reason: Some(reason.into()),
    }
}
fn unavailable_format(reason: &str) -> Formatting {
    Formatting {
        available: false,
        tool: None,
        formatted: None,
        reason: Some(reason.into()),
    }
}
fn bounded_text(value: &serde_json::Value, limit: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}
fn diagnostics(
    source: &str,
    values: &serde_json::Value,
    shell: bool,
) -> Result<Vec<Diagnostic>, String> {
    let rows = values.as_array().ok_or_else(|| TOOL_ERROR.to_string())?;
    if rows.len() > 200 {
        return Err("Static analysis returned more than 200 diagnostics; shorten the script before retrying.".into());
    }
    let lines: Vec<_> = source.split('\n').collect();
    let position = |line: u64, column: u64| {
        let line = line.max(1).min(lines.len() as u64) as usize;
        let text = lines[line - 1];
        let column = if shell {
            text.chars()
                .take(column.saturating_sub(1) as usize)
                .map(char::len_utf16)
                .sum::<usize>()
                + 1
        } else {
            (column.max(1) as usize).min(text.encode_utf16().count() + 1)
        };
        (line as u32, column as u32)
    };
    rows.iter()
        .map(|row| {
            let raw_line = row["line"].as_u64().unwrap_or(1);
            let raw_column = row["column"].as_u64().unwrap_or(1);
            let (line, column) = position(raw_line, raw_column);
            let (end_line, end_column) = position(
                row["endLine"].as_u64().unwrap_or(raw_line),
                row["endColumn"]
                    .as_u64()
                    .unwrap_or(raw_column.saturating_add(1)),
            );
            let level = row[if shell { "level" } else { "severity" }]
                .as_str()
                .unwrap_or("info");
            let code = if shell {
                format!("SC{}", row["code"].as_u64().unwrap_or(0))
            } else {
                bounded_text(&row["code"], 128)
            };
            Ok(Diagnostic {
                line,
                column,
                end_line: end_line.max(line),
                end_column: if end_line <= line {
                    end_column.max(column)
                } else {
                    end_column
                },
                severity: if matches!(level, "error" | "warning") {
                    level
                } else {
                    "info"
                }
                .into(),
                code,
                message: bounded_text(&row["message"], 512),
            })
        })
        .collect()
}
pub async fn analyze(language: Language, source: String) -> Result<Analysis, String> {
    validate_source(&source)?;
    let _permit = permit()?;
    match language {
        Language::Bash | Language::Sh => {
            let Some(path) = executable("shellcheck") else {
                return Ok(unavailable_analysis(
                    "ShellCheck is not installed or not available on PATH.",
                ));
            };
            let dialect = if language == Language::Bash {
                "--shell=bash"
            } else {
                "--shell=sh"
            };
            let result = run(&path, &["--norc", dialect, "--format=json1", "-"], &source).await?;
            if !matches!(result.code, Some(0 | 1)) {
                return Err(TOOL_ERROR.into());
            }
            let value: serde_json::Value =
                serde_json::from_slice(&result.stdout).map_err(|_| TOOL_ERROR.to_string())?;
            Ok(Analysis {
                available: true,
                tool: Some("ShellCheck".into()),
                diagnostics: diagnostics(&source, &value["comments"], true)?,
                reason: None,
            })
        }
        Language::Powershell => {
            let Some(path) = powershell() else {
                return Ok(unavailable_analysis(
                    "PowerShell is not installed or not available on PATH.",
                ));
            };
            let value = run_powershell(&path, PS_ANALYZE, &source).await?;
            Ok(Analysis {
                available: true,
                tool: Some(bounded_text(&value["tool"], 128)),
                diagnostics: diagnostics(&source, &value["diagnostics"], false)?,
                reason: None,
            })
        }
        Language::Batch => Ok(unavailable_analysis(
            "No formal native batch analyzer is configured. Editor checks are basic only.",
        )),
    }
}
pub async fn format(language: Language, source: String) -> Result<Formatting, String> {
    validate_source(&source)?;
    let _permit = permit()?;
    let (tool, formatted) = match language {
        Language::Bash | Language::Sh => {
            let Some(path) = executable("shfmt") else {
                return Ok(unavailable_format(
                    "shfmt is not installed or not available on PATH.",
                ));
            };
            let result = run(&path, &shfmt_arguments(language), &source).await?;
            if result.code != Some(0) {
                return Err(TOOL_ERROR.into());
            }
            (
                "shfmt",
                String::from_utf8(result.stdout).map_err(|_| TOOL_ERROR.to_string())?,
            )
        }
        Language::Powershell => {
            let Some(path) = powershell() else {
                return Ok(unavailable_format(
                    "PowerShell and PSScriptAnalyzer are not available on PATH.",
                ));
            };
            let value = run_powershell(&path, PS_FORMAT, &source).await?;
            let Some(formatted) = value["formatted"].as_str() else {
                return Ok(unavailable_format(
                    "Formatting requires the optional installed PSScriptAnalyzer module.",
                ));
            };
            ("Invoke-Formatter", formatted.to_string())
        }
        Language::Batch => {
            return Ok(unavailable_format(
                "No formal native batch formatter is configured.",
            ))
        }
    };
    validate_source(&formatted)?;
    Ok(Formatting {
        available: true,
        tool: Some(tool.into()),
        formatted: Some(formatted),
        reason: None,
    })
}

#[cfg(test)]
#[path = "tooling_tests.rs"]
mod tests;
