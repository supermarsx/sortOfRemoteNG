"""Fixed private-branch diagnostic. Never substitutes for workspace coverage."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
BRANCH = "refs/heads/codex/diagnose-pwsh-coverage-20261113"
PINS = {
    "tooling.rs": (22245, "15935b82ee072822e08929c2be7665ff4c189b4c932cc6e2f49f7bb78e82ea29"),
    "tooling_tests.rs": (11907, "a5e87d7371cdbeb53004500179aa73fd4ed2f9bcb67dbaba7b9a0fb210b2ef82"),
}
LOG_BOUND = 1024 * 1024
TOTAL_BOUND = 16 * 1024 * 1024
PREFIX = "src-tauri/crates/sorng-ssh-scripts/src/"


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def identity(env):
    require(env.get("GITHUB_EVENT_NAME") == "push", "EVENT")
    require(env.get("GITHUB_REPOSITORY") == "supermarsx/sortOfRemoteNG", "REPOSITORY")
    require(env.get("GITHUB_REPOSITORY_ID") == "1010282954", "REPOSITORY_ID")
    require(env.get("GITHUB_REF") == BRANCH, "REF")
    require(re.fullmatch(r"[a-f0-9]{40}", env.get("GITHUB_SHA", "")), "HEAD")


def pin(raw, name):
    size, digest = PINS[name]
    require(len(raw) == size and hashlib.sha256(raw).hexdigest() == digest, "SOURCE_PIN")


def rust_command(mode=None, compile_only=False):
    require(mode in (None, "default", "serial"), "MODE")
    command = ["cargo", "llvm-cov", "--package", "sorng-ssh-scripts", "--lib", "--no-report"]
    if compile_only:
        command.append("--no-run")
    else:
        command += ["--", "--nocapture"]
        if mode == "serial":
            command.append("--test-threads=1")
    return command


def sources():
    result = {}
    for name in PINS:
        raw = subprocess.check_output(["git", "cat-file", "blob", "HEAD:" + PREFIX + name], cwd=ROOT)
        pin(raw, name)
        require((ROOT / PREFIX / name).read_bytes() == raw, "WORKTREE_SOURCE")
        result[name] = raw.decode()
    require('Duration::from_secs(15)' in result["tooling_tests.rs"], "FIXTURE_DEADLINE")
    require('const DEADLINE: Duration = Duration::from_secs(5);' in result["tooling.rs"], "PRODUCTION_DEADLINE")
    require('"-Command",\n            &harness,' in result["tooling.rs"], "CONSTRUCTOR")
    return result


def metadata(executable):
    # No PowerShell process is started here: preserve the cold first Rust run.
    raw = executable.read_bytes()
    package = subprocess.run(["dpkg-query", "-W", "-f=${Version}", "powershell"], capture_output=True, timeout=5)
    return {
        "pwshPath": str(executable), "pwshBytes": len(raw),
        "pwshSha256": hashlib.sha256(raw).hexdigest(),
        "dpkgVersion": package.stdout.decode(errors="replace")[:128],
        "ImageOS": os.environ.get("ImageOS"), "ImageVersion": os.environ.get("ImageVersion"),
        "kernel": os.uname().release, "cpuAffinity": sorted(os.sched_getaffinity(0)),
        "osRelease": Path("/etc/os-release").read_text()[:2048],
        "originalPSModulePathInherited": True,
        "PSModulePathSha256": hashlib.sha256(os.environ.get("PSModulePath", "").encode()).hexdigest(),
        "PowerShellInvoked": False,
    }


def kill_owned(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_command(command, label, directory, env, overall, maximum):
    require(re.fullmatch(r"[a-z0-9-]+", label), "LABEL")
    began = time.monotonic()
    deadline = min(overall, began + maximum)
    require(deadline > began, "OVERALL_DEADLINE")
    child = subprocess.Popen(command, cwd=ROOT / "src-tauri", env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    tail = bytearray()
    stream = selectors.DefaultSelector()
    stream.register(child.stdout, selectors.EVENT_READ)
    timed_out = False
    try:
        while stream.get_map():
            if time.monotonic() >= deadline:
                timed_out = True
                break
            for key, _ in stream.select(timeout=min(0.2, max(0, deadline-time.monotonic()))):
                data = os.read(key.fd, 65536)
                if not data:
                    stream.unregister(key.fileobj)
                    continue
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
                tail.extend(data)
                del tail[:-LOG_BOUND]
        if timed_out:
            kill_owned(child)
        try:
            child.wait(timeout=1 if timed_out else max(0, deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_owned(child)
            child.wait(timeout=1)
    finally:
        stream.close()
        child.stdout.close()
        if child.poll() is None:
            kill_owned(child)
            child.wait(timeout=1)
    (directory / (label + ".log")).write_bytes(tail)
    clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", tail.decode(errors="replace"))
    unavailable = any(message in clean for message in (
        "PowerShell not installed: optional parser fixture unavailable",
        "PowerShell unavailable: optional formatter smoke",
        "PSScriptAnalyzer unavailable: optional formatter smoke",
    ))
    installed_positive = not unavailable and all(message in clean for message in (
        "tooling::tests::installed_powershell_formatter_returns_only_a_draft ... ok",
        "tooling::tests::powershell_actual_ast_does_not_execute_hostile_source_when_installed ... ok",
        "test result: ok.",
    ))
    return {"label": label, "command": command, "exit": child.returncode,
            "timedOut": timed_out, "seconds": round(time.monotonic()-began, 4), "retainedBytes": len(tail),
            "installedAssertionsPositive": installed_positive, "unavailableEvidence": unavailable}


def traced(harness):
    # Diagnostic-only stage markers, never a replacement for unmodified runs.
    stamp = lambda name: "[Console]::Error.WriteLine('DIAG_STAGE:" + name + "');"
    output = stamp("entry") + harness
    for anchor, name in [
        ("Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop;", "utility-loaded"),
        ("Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -ErrorAction Stop;", "management-loaded"),
        ("$source=[Console]::In.ReadToEnd();", "stdin-eof"),
        ("Select-Object -First 1;", "module-discovered"),
        ("Import-Module $module.Path -ErrorAction Stop;", "analyzer-imported"),
    ]:
        if anchor in output:
            require(output.count(anchor) == 1, "TRACE_ANCHOR")
            output = output.replace(anchor, anchor + stamp(name), 1)
    return output


def native_sync(executable, constants, work, operation, source, trace=False):
    script = {"identity": "PS_IDENTITY", "capability": "PS_CAPABILITIES", "invalid": "PS_ANALYZE", "valid": "PS_ANALYZE", "format": "PS_FORMAT"}[operation]
    seconds = 5 if operation == "capability" else 15
    harness = constants["PS_PREFIX"] + constants[script]
    if trace:
        harness = traced(harness)
    env = dict(os.environ, SHFMT_NO_EDITORCONFIG="true", POWERSHELL_TELEMETRY_OPTOUT="1", POWERSHELL_UPDATECHECK="Off")
    for key in ("SHELLCHECK_OPTS", "SHELLCHECK_SOURCE_PATH"):
        env.pop(key, None)
    cwd = Path(tempfile.mkdtemp(prefix="child-", dir=work))
    data = source.encode()
    require(len(data) <= 4096, "FIXED_NATIVE_SOURCE_BOUND")
    child = subprocess.Popen([str(executable), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", harness],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd, env=env, start_new_session=True)
    began = time.monotonic()
    deadline = began + seconds
    timed_out = False
    failure = None
    buffers = {"out": bytearray(), "err": bytearray()}
    streams = selectors.DefaultSelector()
    streams.register(child.stdout, selectors.EVENT_READ, ("out", LOG_BOUND))
    streams.register(child.stderr, selectors.EVENT_READ, ("err", 64*1024))
    try:
        # Every fixed probe source fits one PIPE_BUF; user text is never argv.
        child.stdin.write(data)
        child.stdin.close()
        while streams.get_map():
            if time.monotonic() >= deadline:
                timed_out = True
                failure = "DEADLINE"
                break
            for key, _ in streams.select(timeout=min(0.2, max(0, deadline-time.monotonic()))):
                name, cap = key.data
                chunk = os.read(key.fd, min(16384, cap-len(buffers[name])+1))
                if not chunk:
                    streams.unregister(key.fileobj)
                elif len(buffers[name]) + len(chunk) > cap:
                    failure = "NATIVE_OUTPUT_BOUND"
                    break
                else:
                    buffers[name].extend(chunk)
            if failure:
                break
    except OSError as error:
        failure = type(error).__name__
    finally:
        streams.close()
        child.stdout.close()
        child.stderr.close()
        if child.stdin and not child.stdin.closed:
            child.stdin.close()
        if failure:
            kill_owned(child)
        try:
            child.wait(timeout=1 if failure else max(0, deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
            failure = "DEADLINE"
            kill_owned(child)
            child.wait(timeout=1)
    out, err = bytes(buffers["out"]), bytes(buffers["err"])
    bounded = failure != "NATIVE_OUTPUT_BOUND" and len(out) <= LOG_BOUND and len(err) <= 64 * 1024
    value = None
    if failure is None and child.returncode == 0 and bounded:
        try:
            value = json.loads(out)
        except ValueError:
            pass
    positive = isinstance(value, dict)
    if operation == "identity":
        positive = positive and isinstance(value.get("version"), str)
    elif operation == "capability":
        positive = positive and value.get("analyzer") is True and value.get("formatter") is True
    elif operation == "invalid":
        positive = positive and value.get("tool") == "PowerShell AST parser" and bool(value.get("diagnostics"))
    elif operation == "valid":
        positive = positive and value.get("tool") in ("PowerShell AST parser", "PSScriptAnalyzer") and isinstance(value.get("diagnostics"), list)
    else:
        positive = positive and value.get("formatted", "").replace("\r\n", "\n") == "if ($true) {\n    Write-Output 'literal only'\n}"
    # Keep proof summaries, never a potentially megabyte-size parsed payload.
    value_summary = {"stdoutSha256": hashlib.sha256(out).hexdigest()}
    if isinstance(value, dict):
        for key, limit in (("tool", 64), ("version", 128), ("moduleVersion", 128), ("modulePath", 512)):
            if isinstance(value.get(key), str):
                value_summary[key] = value[key][:limit]
        if isinstance(value.get("diagnostics"), list):
            value_summary["diagnosticCount"] = len(value["diagnostics"])
        if operation == "format":
            value_summary["draftExactlyMatchesFixture"] = positive
    return {"operation": operation, "trace": trace, "seconds": round(time.monotonic()-began, 4), "deadline": seconds,
            "positive": positive, "timedOut": timed_out, "failure": failure, "exit": child.returncode,
            "stdoutBytes": len(out), "stderrBytes": len(err), "outputBounded": bounded,
            "stages": re.findall(r"DIAG_STAGE:[a-z-]+", err.decode(errors="replace"))[:32], "result": value_summary}


async def native(*args, **kwargs):
    return await asyncio.to_thread(native_sync, *args, **kwargs)


async def native_comparison(executable, text, work):
    constants = {}
    for name in ("PS_PREFIX", "PS_ANALYZE", "PS_FORMAT", "PS_CAPABILITIES"):
        matches = re.findall(r"const " + name + r': &str = r#"(.*?)"#;', text, re.S)
        require(len(matches) == 1, "CONSTANT")
        constants[name] = matches[0]
    constants["PS_IDENTITY"] = "$module=Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1;[Console]::Write((@{version=$PSVersionTable.PSVersion.ToString();moduleVersion=if($module){$module.Version.ToString()}else{$null};modulePath=if($module){$module.Path}else{$null}}|ConvertTo-Json -Compress))"
    marker = work / "must-not-exist"
    hostile = "[IO.File]::WriteAllText('" + str(marker).replace("'", "''") + "','MUST NOT RUN'); Write-Output $(Get-Date)"
    async def analyze():
        rows = [await native(executable, constants, work, "invalid", hostile + "; (")]
        if rows[-1]["positive"]:
            rows.append(await native(executable, constants, work, "valid", hostile))
        return rows
    cap = lambda: native(executable, constants, work, "capability", "")
    fmt = lambda: native(executable, constants, work, "format", "if($true){\nwrite-output 'literal only'\n}")
    groups = await asyncio.gather(cap(), analyze(), fmt())
    parallel = [groups[0], *groups[1], groups[2]]
    serial = [await cap(), *await analyze(), await fmt()]
    traces = []
    failures = {row["operation"] for row in parallel + serial if not row["positive"]}
    for operation in sorted(failures):
        source = {"capability": "", "invalid": hostile + "; (", "valid": hostile,
                  "format": "if($true){\nwrite-output 'literal only'\n}"}[operation]
        traces.append(await native(executable, constants, work, operation, source, trace=True))
    require(not marker.exists(), "HOSTILE_MARKER_CREATED")
    actual_identity = await native(executable, constants, work, "identity", "")
    return {"parallel": parallel, "serialized": serial, "failureOnlyTraces": traces, "actualRuntimeIdentity": actual_identity,
            "markerAbsent": True, "scope": "Post-Rust native harnesses; not cold-baseline or Rust-supervisor proof."}


def main():
    require(len(sys.argv) == 1, "NO_INPUTS")
    identity(os.environ)
    require(sys.platform == "linux", "LINUX_ONLY")
    require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip() == os.environ["GITHUB_SHA"], "CHECKOUT_HEAD")
    bound = time.monotonic() + 17 * 60
    runner_temp = Path(os.environ["RUNNER_TEMP"])
    require(runner_temp.is_absolute() and runner_temp.resolve() == runner_temp, "RUNNER_TEMP")
    output = runner_temp / "pwsh-coverage-diagnostic"
    output.mkdir(mode=0o700, exist_ok=False)
    scratch = Path(tempfile.mkdtemp(prefix="pwsh-coverage-owned-", dir=runner_temp))
    summary = {"kind": "private-PowerShell-coverage-diagnostic", "runs": [],
               "isWorkspaceCoverageProof": False, "SDKorNativeAcceptance": False,
               "productionDeadlineChanged": False, "testSourcesChanged": False,
               "scope": "Crate-only; full workspace feature-union and previous VM pressure differ."}
    try:
        source = sources()
        executable = Path(shutil.which("pwsh") or "/nonexistent").resolve(strict=True)
        summary["beforeColdRust"] = metadata(executable)
        version = subprocess.check_output(["cargo", "llvm-cov", "--version"], timeout=10).decode().strip()
        require(version == "cargo-llvm-cov 0.9.1", "LLVM_COV_VERSION")
        original = dict(os.environ)
        compiled = run_command(rust_command(compile_only=True), "compile", output, original, bound, 8 * 60)
        summary["compile"] = compiled
        require(compiled["exit"] == 0 and not compiled["timedOut"], "COMPILE_FAILED")
        # No pwsh/version/module/native probe precedes this unmodified cold run.
        cases = [("default-original-cold", "default", False), ("serial-original-after-baseline", "serial", False),
                 ("serial-fresh-owned-cache", "serial", True), ("default-fresh-owned-cache", "default", True)]
        for label, mode, fresh in cases:
            env = dict(original)
            if fresh:
                home = scratch / (label + "-home")
                home.mkdir()
                env.update(HOME=str(home), XDG_CACHE_HOME=str(home / ".cache"), XDG_CONFIG_HOME=str(home / ".config"), XDG_DATA_HOME=str(home / ".local/share"))
                env["CARGO_HOME"] = original.get("CARGO_HOME", str(Path(original["HOME"]) / ".cargo"))
                env["RUSTUP_HOME"] = original.get("RUSTUP_HOME", str(Path(original["HOME"]) / ".rustup"))
                # Preserve installed module roots from the original environment.
                if "PSModulePath" not in original:
                    env["PSModulePath"] = ":".join([str(Path(original["HOME"]) / ".local/share/powershell/Modules"), "/usr/local/share/powershell/Modules", str(executable.parent / "Modules")])
            row = run_command(rust_command(mode), label, output, env, bound, 90)
            row.update(originalHOME=not fresh, controlledFreshCache=fresh, originalPSModulePath="PSModulePath" in original or not fresh)
            summary["runs"].append(row)
        failed = any(r["exit"] != 0 or r["timedOut"] or not r["installedAssertionsPositive"] for r in summary["runs"])
        summary["unmodifiedRustFailuresObserved"] = failed
        summary["nativeProbesNeeded"] = failed
        if failed:
            require(time.monotonic() + 180 < bound, "NO_NATIVE_BUDGET")
            summary["native"] = asyncio.run(native_comparison(executable, source["tooling.rs"], scratch))
        summary["outcome"] = "failure observed; inspect unchanged assertions" if failed else "not reproduced; no repair proven"
        summary["exit"] = 1 if failed else 0
    except Exception as error:
        summary["error"] = str(error)[:300]
        summary["exit"] = 1
    finally:
        for name in PINS:
            try:
                pin((ROOT / PREFIX / name).read_bytes(), name)
            except Exception:
                summary["exit"] = 1
                summary["sourceChanged"] = True
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        require(sum(p.stat().st_size for p in output.rglob("*") if p.is_file()) <= TOTAL_BOUND, "ARTIFACT_BOUND")
    return summary["exit"]


if __name__ == "__main__":
    sys.exit(main())
