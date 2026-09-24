use super::*;
use serde_json::json;
use std::io::{Read, Write};

#[test]
fn source_limits_are_utf8_bytes_and_never_silently_truncate() {
    assert!(validate_source(&"a".repeat(MAX_SOURCE)).is_ok());
    assert_eq!(
        validate_source(&"a".repeat(MAX_SOURCE + 1)).unwrap_err(),
        LIMIT_ERROR
    );
    assert!(validate_source(&"😀".repeat(MAX_SOURCE / 4 + 1)).is_err());
    assert!(validate_source("echo before\0after").is_err());
    assert!(serde_json::from_value::<Language>(json!("javascript")).is_err());
    assert!(serde_json::from_value::<Language>(json!("bash; echo unsafe")).is_err());
}

#[test]
fn powershell_load_declarations_are_rejected_before_parser_start() {
    for source in [
        "using module './hostile.psm1'",
        "USING assembly './hostile.dll'",
        "#requires -Modules Hostile",
        "configuration Demo { Import-DscResource Hostile }",
        "dynamicparam { Write-Output never }",
        "u`sing module hostile",
        "confi`guration Demo {}",
        "# a comment mentions using module",
        "Write-Output 'using assembly'",
        "using <#comment#> module hostile",
    ] {
        assert!(validate_powershell_source(source).is_err(), "{source}");
    }
    assert!(validate_powershell_source("Write-Output $(Get-Date); & 'never-run.exe'").is_ok());
}

#[tokio::test]
async fn forbidden_powershell_declarations_refuse_even_a_missing_executable() {
    let error = run_powershell(
        Path::new("/nonexistent/tool"),
        PS_ANALYZE,
        "using module evil",
    )
    .await
    .unwrap_err();
    assert!(error.contains("No parser was started"));
}

#[test]
fn constant_harness_disables_module_autoload_and_has_no_user_execution_path() {
    assert!(PS_PREFIX.contains("$PSModuleAutoLoadingPreference='None'"));
    assert!(PS_PREFIX.contains("$PSHOME,'Modules','Microsoft.PowerShell.Utility'"));
    assert!(PS_ANALYZE.contains("Parser]::ParseInput($source"));
    assert!(PS_ANALYZE.contains("-ScriptDefinition $source -Settings $settings"));
    assert!(PS_FORMAT.contains("-ScriptDefinition $source -Settings $settings"));
    for harness in [PS_PREFIX, PS_ANALYZE, PS_FORMAT, PS_CAPABILITIES] {
        for forbidden in [
            "Invoke-Expression",
            "ScriptBlock]::Create",
            "& $source",
            ". $source",
            "-SaveDscDependency",
            "-CustomRulePath",
            "Install-Module",
            "-ExecutionPolicy",
        ] {
            assert!(!harness.contains(forbidden));
        }
    }
}

#[test]
fn program_resolution_never_uses_relative_paths_or_pathex_scripts() {
    let directory = tempfile::tempdir().unwrap();
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let candidate = directory.path().join(format!("fixed-tool{extension}"));
    std::fs::write(&candidate, b"synthetic fixture, never run").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&candidate, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    assert!(find_executable("fixed-tool", [PathBuf::from(".")].into_iter()).is_none());
    assert_eq!(
        find_executable("fixed-tool", [directory.path().to_path_buf()].into_iter()),
        Some(candidate.canonicalize().unwrap())
    );
    std::fs::write(directory.path().join("script-only.cmd"), b"never run").unwrap();
    assert!(find_executable("script-only", [directory.path().to_path_buf()].into_iter()).is_none());
    // No write to the real cwd: choosing a real file stem proves the directory
    // itself is rejected, independently of extension and executable presence.
    assert!(find_executable("Cargo", [std::env::current_dir().unwrap()].into_iter()).is_none());
}

#[test]
fn diagnostics_are_bounded_and_convert_json1_codepoints_to_utf16() {
    let source = "\t😀x\nend";
    let rows = json!([{"line":1,"column":3,"endLine":1,"endColumn":4,"level":"warning","code":2086,"message":"quote\u{0} this"}]);
    let result = diagnostics(source, &rows, true).unwrap();
    assert_eq!(
        (result[0].line, result[0].column, result[0].end_column),
        (1, 4, 5)
    );
    assert_eq!(result[0].code, "SC2086");
    assert_eq!(result[0].message, "quote this");
    let ps = diagnostics(source, &json!([{"line":1,"column":4,"endLine":0,"endColumn":0,"code":"X".repeat(300),"message":"m".repeat(600)}]), false).unwrap();
    assert_eq!((ps[0].column, ps[0].end_column), (4, 4));
    assert_eq!(ps[0].code.len(), 128);
    assert_eq!(ps[0].message.len(), 512);
    assert!(diagnostics("x", &json!(vec![json!({}); 201]), true).is_err());
    assert!(diagnostics("x", &json!(null), true).is_err());
}

#[tokio::test]
async fn batch_reports_honest_unavailability_without_execution() {
    let analysis = analyze(Language::Batch, "echo never executed".into())
        .await
        .unwrap();
    assert!(!analysis.available);
    assert!(analysis.diagnostics.is_empty());
    let formatted = format(Language::Batch, "echo never executed".into())
        .await
        .unwrap();
    assert!(!formatted.available);
    assert!(formatted.formatted.is_none());
}

#[tokio::test]
async fn capability_probe_preserves_exact_contract_and_honest_batch_limits() {
    let result = capabilities().await.unwrap();
    assert_eq!(
        result
            .languages
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["bash", "batch", "powershell", "sh"]
    );
    assert!(!result.languages["batch"].analysis_available);
    assert!(!result.languages["batch"].format_available);
    let serialized = serde_json::to_value(result).unwrap();
    assert!(serialized["languages"]["bash"]["analysisAvailable"].is_boolean());
    assert!(serialized["languages"]["powershell"]["formatAvailable"].is_boolean());
    if executable("shellcheck").is_none() {
        assert_eq!(serialized["languages"]["bash"]["analysisAvailable"], false);
    }
}

fn fixture_args(name: &str) -> Vec<String> {
    vec![
        "--ignored".into(),
        "--exact".into(),
        format!("tooling::tests::{name}"),
        "--nocapture".into(),
    ]
}
async fn child(name: &str, source: &str, deadline: Duration) -> Result<ToolOutput, String> {
    let arguments = fixture_args(name);
    let borrowed: Vec<_> = arguments.iter().map(String::as_str).collect();
    run_with_deadline(
        &std::env::current_exe().unwrap(),
        &borrowed,
        source,
        deadline,
    )
    .await
}

#[tokio::test]
async fn child_stdin_preserves_hostile_text_without_argument_interpretation() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("must-not-exist");
    let source = format!(
        "$(touch '{}'); & {{ Set-Content '{}' unsafe }}; echo \"'; --config=/secret\"",
        marker.display(),
        marker.display()
    );
    let result = child("fixture_echo", &source, Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(result.code, Some(0));
    assert!(String::from_utf8(result.stdout).unwrap().contains(&source));
    assert!(!marker.exists());
}

#[tokio::test]
async fn deadline_covers_blocked_stdin_and_output_then_reaps_child() {
    for name in ["fixture_stall_before_input", "fixture_stall_after_input"] {
        let started = std::time::Instant::now();
        let error = child(name, &"x".repeat(MAX_SOURCE), Duration::from_millis(80))
            .await
            .unwrap_err();
        assert!(error.contains("was stopped"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
    // A subsequent process can run immediately; no held handles or workers.
    assert_eq!(
        child("fixture_echo", "after timeout", Duration::from_secs(3))
            .await
            .unwrap()
            .code,
        Some(0)
    );
}

#[tokio::test]
async fn excessive_tool_output_is_refused_without_leaking_output() {
    let error = child("fixture_flood", "", Duration::from_secs(3))
        .await
        .unwrap_err();
    assert!(error.contains("safety limit"));
    assert!(!error.contains("PRIVATE"));
}

#[tokio::test]
async fn powershell_actual_ast_does_not_execute_hostile_source_when_installed() {
    let Some(path) = powershell() else {
        eprintln!("PowerShell not installed: optional parser fixture unavailable");
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("not-created.txt");
    let escaped = marker.to_string_lossy().replace('\'', "''");
    let source =
        format!("[IO.File]::WriteAllText('{escaped}','MUST NOT RUN'); Write-Output $(Get-Date); (");
    let deadline = installed_tool_deadline();
    let result = run_powershell_with_deadline(&path, PS_ANALYZE, &source, deadline)
        .await
        .unwrap();
    assert!(!marker.exists());
    assert_eq!(result["tool"], "PowerShell AST parser");
    assert!(!result["diagnostics"].as_array().unwrap().is_empty());
    let valid_source =
        format!("[IO.File]::WriteAllText('{escaped}','MUST NOT RUN'); Write-Output $(Get-Date)");
    let valid = run_powershell_with_deadline(&path, PS_ANALYZE, &valid_source, deadline)
        .await
        .unwrap();
    assert!(!marker.exists());
    assert!(matches!(
        valid["tool"].as_str(),
        Some("PowerShell AST parser" | "PSScriptAnalyzer")
    ));
    assert!(valid["diagnostics"].is_array());
}

#[tokio::test]
async fn installed_shfmt_formats_stdin_only_with_explicit_dialects() {
    let Some(path) = executable("shfmt") else {
        eprintln!("shfmt unavailable: optional formatter smoke");
        return;
    };
    for language in [Language::Bash, Language::Sh] {
        let output = run(
            &path,
            &shfmt_arguments(language),
            "if true;then\necho 'literal only'\nfi\n",
        )
        .await
        .unwrap();
        assert_eq!(output.code, Some(0));
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "if true; then\n  echo 'literal only'\nfi\n"
        );
    }
}

#[tokio::test]
async fn installed_powershell_formatter_returns_only_a_draft() {
    let Some(path) = powershell() else {
        eprintln!("PowerShell unavailable: optional formatter smoke");
        return;
    };
    let output = run_powershell_with_deadline(
        &path,
        PS_FORMAT,
        "if($true){\nwrite-output 'literal only'\n}",
        installed_tool_deadline(),
    )
    .await
    .unwrap();
    let Some(formatted) = output["formatted"].as_str() else {
        eprintln!("PSScriptAnalyzer unavailable: optional formatter smoke");
        return;
    };
    assert_eq!(
        formatted.replace("\r\n", "\n"),
        "if ($true) {\n    Write-Output 'literal only'\n}"
    );
}

fn installed_tool_deadline() -> Duration {
    if cfg!(coverage) {
        Duration::from_secs(15)
    } else {
        DEADLINE
    }
}

// Invoked only as fixed Rust child-process fixtures by the tests above, never as
// installed analyzers. Their bodies do not interpret or execute the input.
#[test]
#[ignore = "child-process fixture, exercised by parent lifecycle tests"]
fn fixture_echo() {
    let mut source = String::new();
    std::io::stdin().read_to_string(&mut source).unwrap();
    println!("INPUT:{source}");
}
#[test]
#[ignore = "child-process fixture, exercised by parent lifecycle tests"]
fn fixture_stall_before_input() {
    std::thread::sleep(Duration::from_secs(10));
}
#[test]
#[ignore = "child-process fixture, exercised by parent lifecycle tests"]
fn fixture_stall_after_input() {
    let mut source = String::new();
    std::io::stdin().read_to_string(&mut source).unwrap();
    std::thread::sleep(Duration::from_secs(10));
}
#[test]
#[ignore = "child-process fixture, exercised by parent lifecycle tests"]
fn fixture_flood() {
    let _ = std::io::stdout().write_all("PRIVATE".repeat(MAX_OUTPUT / 7 + 100).as_bytes());
}
