#!/usr/bin/env node
// Explicit ephemeral hosted provisioning. No CEF build, publication, or local install.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
  lstat,
  open,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  RECIPE,
  nativeWindowsShell,
  observe,
  probeFailure,
  selectTarget,
} from "./cef-hosted-bootstrap.mjs";

const exec = promisify(execFile);
const fail = (message) => {
  throw new Error(message);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function provisionPlan(
  target,
  platform = process.platform,
  architecture = process.arch,
) {
  const selected = selectTarget(target, platform, architecture);
  return {
    target,
    runner: selected.runner,
    platform,
    architecture,
    execute: false,
    publicationAllowed: false,
    installer:
      platform === "win32"
        ? RECIPE.provisioning.windowsSdk
        : platform === "linux"
          ? RECIPE.provisioning.linuxDependencies
          : null,
    supplementalPrerequisite:
      platform === "darwin"
        ? {
            component: RECIPE.provisioning.macMetalToolchain.component,
            requiresReviewedProducerSelection: true,
            prepared: false,
          }
        : null,
    arguments:
      platform === "win32"
        ? [
            "/quiet",
            "/norestart",
            "/ceip",
            "off",
            "/features",
            ...RECIPE.provisioning.windowsSdk.features,
          ]
        : platform === "linux"
          ? RECIPE.provisioning.linuxDependencies.arguments
          : [],
    note: "Hosted-only prerequisite preparation; actual post-install inventory requires review before an engine build.",
  };
}
export function assertProvisionHost(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  )
    fail("Provisioning requires an explicit public GitHub-hosted dispatch");
}
export function verifyInstallerSignature(
  signature,
  pin = RECIPE.provisioning.windowsSdk,
) {
  if (
    signature?.status !== "Valid" ||
    signature?.thumbprint !== pin.signerThumbprint ||
    signature?.subject !==
      "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" ||
    signature?.productVersion !== pin.productVersion
  )
    fail("Pinned Microsoft SDK signature or product identity mismatch");
}
export async function acquirePinned(pin, fetcher = fetch) {
  const response = await fetcher(pin.url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) fail("Pinned prerequisite download failed");
  const limit =
    pin.encoding === "base64" ? Math.ceil(pin.size / 3) * 4 + 4096 : pin.size;
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > limit)
      fail("Pinned prerequisite download exceeds its reviewed size");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const bytes =
    pin.encoding === "base64"
      ? Buffer.from(raw.toString("ascii").trim(), "base64")
      : raw;
  if (bytes.length !== pin.size || hash(bytes) !== pin.sha256)
    fail("Pinned prerequisite byte identity mismatch");
  return bytes;
}
export function childEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !/^(GH_|GITHUB_|ACTIONS_|INPUT_)/i.test(key),
    ),
  );
}
// Called only AFTER the producer validates its exact reviewed runner/tool map.
// The component is Apple's newly observed selection, never a fabricated prior pin.
export function macMetalEnvironment(selected, env = {}) {
  for (const key of ["DEVELOPER_DIR", "SDKROOT"])
    if (
      typeof selected?.[key] !== "string" ||
      !path.posix.isAbsolute(selected[key]) ||
      selected[key].length > 2048 ||
      /[\x00-\x1f\x7f]/.test(selected[key])
    )
      fail("MAC_METAL_SELECTED_ENV");
  if (!selected.DEVELOPER_DIR.endsWith("/Contents/Developer"))
    fail("MAC_METAL_SELECTED_ENV");
  return {
    ...Object.fromEntries(
      ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"]
        .filter((key) => typeof env[key] === "string")
        .map((key) => [key, env[key]]),
    ),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    DEVELOPER_DIR: selected.DEVELOPER_DIR,
    SDKROOT: selected.SDKROOT,
  };
}
async function metalFile(file, check = () => {}) {
  check();
  const canonical = await realpath(file);
  const before = await lstat(canonical, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0n ||
    before.size > 256n * 1024n ** 2n
  )
    fail("MAC_METAL_FILE_BOUND");
  const handle = await open(canonical, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      fail("MAC_METAL_FILE_CHANGED");
    const digest = createHash("sha256");
    let bytes = 0;
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      check();
      const read = await handle.read(buffer, 0, buffer.length, null);
      check();
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (BigInt(bytes) > before.size) fail("MAC_METAL_FILE_CHANGED");
      digest.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(canonical, { bigint: true });
    if (
      BigInt(bytes) !== before.size ||
      !["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(
        (key) => before[key] === after[key] && before[key] === named[key],
      ) ||
      (await realpath(file)) !== canonical
    )
      fail("MAC_METAL_FILE_CHANGED");
    return { physicalPath: canonical, bytes, sha256: digest.digest("hex") };
  } finally {
    await handle.close();
  }
}
function metalVersion(result) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (Buffer.byteLength(text) > 65536) fail("MAC_METAL_VERSION_BOUND");
  const match = /\bversion\s+([0-9][A-Za-z0-9_.-]{0,63})/i.exec(text);
  if (!match) fail("MAC_METAL_VERSION_MISSING");
  return match[1];
}
export function macMetalFingerprint(observation) {
  if (
    !observation ||
    observation.kind !== "selected-mac-metal-observation" ||
    observation.provenance !== "newly-observed-apple-component-not-prepinned" ||
    typeof observation.developerDir !== "string" ||
    !observation.developerDir.endsWith("/Contents/Developer") ||
    !Array.isArray(observation.tools) ||
    observation.tools.length !== 2
  )
    fail("MAC_METAL_OBSERVATION");
  return {
    provenance: observation.provenance,
    developerDir: observation.developerDir,
    tools: ["metal", "metallib"].map((role, index) => {
      const tool = observation.tools[index];
      if (
        tool?.role !== role ||
        !["external-metal-toolchain", "selected-xcode-toolchain"].includes(
          tool.location,
        ) ||
        tool.appleAnchorVerified !== true ||
        !Number.isSafeInteger(tool.bytes) ||
        tool.bytes <= 0 ||
        tool.bytes > 256 * 1024 ** 2 ||
        !/^[a-f0-9]{64}$/.test(tool.sha256) ||
        (role === "metal"
          ? !/^[0-9][A-Za-z0-9_.-]{0,63}$/.test(tool.version) ||
            tool.versionSource !== "tool-output" ||
            tool.pairedCompilerVersion !== null
          : tool.version !== null ||
            tool.versionSource !== "not-observed" ||
            tool.pairedCompilerVersion !== observation.tools[0].version)
      )
        fail("MAC_METAL_OBSERVATION");
      // Ephemeral cryptex mount spelling is private evidence, not restore identity.
      return {
        role,
        location: tool.location,
        bytes: tool.bytes,
        sha256: tool.sha256,
        version: tool.version,
        versionSource: tool.versionSource,
        pairedCompilerVersion: tool.pairedCompilerVersion,
        appleAnchorVerified: true,
      };
    }),
  };
}
async function prepareMacMetalToolchainImpl(
  {
    selected,
    env = {},
    platform = process.platform,
    allowDownload = false,
    remainingMilliseconds = () =>
      RECIPE.provisioning.macMetalToolchain.maximumMilliseconds,
  },
  dependencies = {},
) {
  if (platform !== "darwin") return null;
  if (typeof allowDownload !== "boolean") fail("MAC_METAL_DOWNLOAD_POLICY");
  if (allowDownload) assertProvisionHost(env);
  const recipe = RECIPE.provisioning.macMetalToolchain;
  const childEnv = macMetalEnvironment(selected, env);
  const execute = dependencies.exec ?? exec;
  const measure = dependencies.measure ?? metalFile;
  const canonical = dependencies.realpath ?? realpath;
  const now = dependencies.now ?? (() => performance.now());
  const firstRemaining = remainingMilliseconds();
  if (!Number.isFinite(firstRemaining) || firstRemaining <= 0)
    fail("MAC_METAL_DEADLINE");
  const end = now() + Math.min(firstRemaining, recipe.maximumMilliseconds);
  const left = () => {
    const remaining = Math.floor(
      Math.min(end - now(), remainingMilliseconds()),
    );
    if (!Number.isFinite(remaining) || remaining <= 0)
      fail("MAC_METAL_DEADLINE");
    return remaining;
  };
  const invoke = async (executable, args, download = false) => {
    let result;
    try {
      result = await execute(executable, args, {
        env: childEnv,
        timeout: Math.min(
          left(),
          download ? recipe.maximumMilliseconds : recipe.probeMilliseconds,
        ),
        maxBuffer: recipe.maximumOutputBytes,
        windowsHide: true,
        killSignal: "SIGKILL",
      });
    } catch (error) {
      left();
      throw Object.assign(new Error("MAC_METAL_COMMAND_FAILED"), {
        metalMissing:
          executable === "/usr/bin/xcrun" &&
          args.includes("metal") &&
          /missing Metal Toolchain|unable to find utility ["']metal["']/i.test(
            String(error?.stderr ?? ""),
          ),
      });
    }
    left();
    return result;
  };
  let downloaded = false;
  const attest = async () => {
    const tools = [];
    const canonicalDeveloper = await canonical(selected.DEVELOPER_DIR);
    left();
    let componentRoot;
    for (const role of ["metal", "metallib"]) {
      const resolved = await invoke("/usr/bin/xcrun", [
        "--no-cache",
        "--find",
        role,
      ]);
      const file = String(resolved.stdout ?? "").trim();
      if (
        !path.posix.isAbsolute(file) ||
        /[\x00-\x1f\x7f]/.test(file) ||
        Buffer.byteLength(file) > 2048
      )
        fail("MAC_METAL_RESOLVED_PATH");
      const physical = await canonical(file);
      // Observed Apple metallib alias resolves to air-lld in the SAME component.
      // This is role-specific; xcrun must still select the metallib entry point.
      const binary =
        role === "metallib" &&
        path.posix.basename(file) === "metallib" &&
        path.posix.basename(physical) === "air-lld"
          ? "air-lld"
          : role;
      const external = physical.endsWith(
        `/Metal.xctoolchain/usr/bin/${binary}`,
      );
      const bundled =
        physical ===
        `${canonicalDeveloper}/Toolchains/XcodeDefault.xctoolchain/usr/bin/${binary}`;
      if (!external && !bundled) fail("MAC_METAL_RESOLVED_PATH");
      const root = path.posix.dirname(physical);
      if (componentRoot && componentRoot !== root)
        fail("MAC_METAL_COMPONENT_DRIFT");
      componentRoot = root;
      const before = await measure(physical, left);
      await invoke("/usr/bin/codesign", [
        "--verify",
        "--strict",
        "--all-architectures",
        "-R=anchor apple",
        physical,
      ]);
      const version =
        role === "metal"
          ? metalVersion(
              await invoke("/usr/bin/xcrun", [
                "--no-cache",
                "metal",
                "--version",
              ]),
            )
          : null;
      const after = await measure(physical, left);
      if (
        JSON.stringify(before) !== JSON.stringify(after) ||
        (await canonical(
          String(
            (await invoke("/usr/bin/xcrun", ["--no-cache", "--find", role]))
              .stdout ?? "",
          ).trim(),
        )) !== physical
      )
        fail("MAC_METAL_FILE_CHANGED");
      tools.push({
        role,
        location: external
          ? "external-metal-toolchain"
          : "selected-xcode-toolchain",
        ...before,
        version,
        versionSource: role === "metal" ? "tool-output" : "not-observed",
        pairedCompilerVersion: role === "metallib" ? tools[0].version : null,
        appleAnchorVerified: true,
      });
    }
    left();
    return tools;
  };
  let tools;
  try {
    tools = await attest();
  } catch (error) {
    if (error?.metalMissing !== true) throw error;
    if (!allowDownload) fail("MAC_METAL_PROBE_FAILED");
    await invoke(recipe.executable, recipe.arguments, true);
    downloaded = true;
    tools = await attest();
  }
  const observation = {
    schemaVersion: 1,
    kind: "selected-mac-metal-observation",
    provenance: recipe.provenance,
    developerDir: selected.DEVELOPER_DIR,
    downloaded,
    tools,
    componentResourceClosureVerified: false,
    nativeCompatibilityVerified: false,
  };
  macMetalFingerprint(observation);
  return observation;
}

export async function prepareMacMetalToolchain(options, dependencies) {
  try {
    return await prepareMacMetalToolchainImpl(options, dependencies);
  } catch (error) {
    if (/^MAC_METAL_[A-Z_]+$/.test(error?.message ?? "")) throw error;
    throw new Error("MAC_METAL_UNAVAILABLE");
  }
}

const SIGNATURE_SCRIPT = String.raw`param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$s=Get-AuthenticodeSignature -LiteralPath $Installer
@{status=$s.Status.ToString();thumbprint=$s.SignerCertificate.Thumbprint;subject=$s.SignerCertificate.Subject;productVersion=(Get-Item -LiteralPath $Installer).VersionInfo.ProductVersion}|ConvertTo-Json -Compress
`;

// Observe child-process phases without printing their arguments or modifying the
// reviewed installer. Its own stdout/stderr and exit status remain authoritative.
export const LINUX_INSTALLER_OBSERVER = String.raw`
import json, os, runpy, stat, subprocess, sys, threading, time
_popen = subprocess.Popen
_records = 0
_record_lock = threading.Lock()

def read_fixed(file, limit):
    try:
        fd = os.open(file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                return None
            return os.read(fd, limit).decode('ascii', 'replace')
        finally:
            os.close(fd)
    except OSError:
        return None

def number(value):
    try:
        result = int(value)
        return result if 0 <= result <= 9007199254740991 else None
    except (TypeError, ValueError):
        return None

def process_progress(pid):
    root = '/proc/' + str(pid)
    comm = (read_fixed(root + '/comm', 64) or '').strip()
    role = comm if comm in ('sudo', 'apt-get', 'dpkg', 'dpkg-deb', 'http', 'https', 'gpgv', 'debconf') else 'other'
    status = read_fixed(root + '/status', 4096) or ''
    state = 'unknown'
    for line in status.splitlines():
        if line.startswith('State:'):
            words = line.split()
            state = dict(R='running', S='sleeping', D='disk-wait', T='stopped', Z='zombie').get(words[1] if len(words) > 1 else '', 'unknown')
    io = {}
    for line in (read_fixed(root + '/io', 4096) or '').splitlines():
        key, _, value = line.partition(':')
        if key in ('rchar', 'wchar', 'read_bytes', 'write_bytes', 'syscr', 'syscw'):
            io[key] = number(value.strip())
    children = []
    for value in (read_fixed(root + '/task/' + str(pid) + '/children', 4096) or '').split()[:32]:
        child = number(value)
        if child is not None and child > 0:
            children.append(child)
    return dict(pid=pid, role=role, state=state, io=io), children

def dpkg_progress():
    # No package names or log text leave this observer; only fixed actions and
    # numeric file metadata. O_NOFOLLOW prevents following an unexpected alias.
    try:
        fd = os.open('/var/log/dpkg.log', os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                return None
            os.lseek(fd, max(0, info.st_size - 4096), os.SEEK_SET)
            lines = os.read(fd, 4096).decode('ascii', 'replace').splitlines()
            action = 'other'
            if lines:
                words = lines[-1].split()
                if len(words) > 2 and words[2] in ('startup', 'status', 'install', 'upgrade', 'configure', 'unpack', 'trigproc', 'remove', 'purge'):
                    action = words[2]
            return dict(bytes=number(info.st_size), modifiedMs=number(int(info.st_mtime * 1000)), action=action)
        finally:
            os.close(fd)
    except OSError:
        return None

def progress(pid):
    pending, seen, rows = [pid], set(), []
    while pending and len(rows) < 32:
        current = pending.pop(0)
        if current in seen:
            continue
        seen.add(current)
        row, children = process_progress(current)
        rows.append(row)
        pending.extend(children[:32 - len(pending)])
    return dict(processes=rows, processListTruncated=bool(pending), dpkg=dpkg_progress())
def phase(args):
    if not isinstance(args, (list, tuple)):
        return None
    words = list(args)
    if words and os.path.basename(str(words[0])) == 'sudo':
        words = words[1:]
        while words and '=' in str(words[0]) and not str(words[0]).startswith('-'):
            words = words[1:]
    if not words or os.path.basename(str(words[0])) != 'apt-get':
        return None
    if 'update' in words:
        return 'apt-update'
    if 'install' in words:
        return 'apt-simulation' if '--just-print' in words else 'apt-install'
    return None
def emit(stage, state, pid, code=None, **extra):
    global _records
    with _record_lock:
        if stage is not None and _records < 256:
            _records += 1
            print('SORNG_PREREQUISITE_PHASE ' + json.dumps(dict(phase=stage, state=state, pid=pid, exitCode=code, **extra), separators=(',', ':')), file=sys.stderr, flush=True)
class ObservedPopen(_popen):
    def __init__(self, args, *rest, **kwargs):
        self._observed_phase = phase(args)
        self._observed_finished = False
        self._observed_stop = threading.Event()
        self._observed_guard = threading.Lock()
        self._observed_start = time.monotonic()
        super().__init__(args, *rest, **kwargs)
        emit(self._observed_phase, 'started', self.pid)
        if self._observed_phase == 'apt-install':
            threading.Thread(target=self._heartbeat, name='sorng-apt-progress', daemon=True).start()
    def _heartbeat(self):
        for _ in range(120):
            if self._observed_stop.wait(10):
                return
            try:
                snapshot = progress(self.pid)
                with self._observed_guard:
                    if self._observed_stop.is_set():
                        return
                    emit(self._observed_phase, 'progress', self.pid, elapsedMs=int((time.monotonic() - self._observed_start) * 1000), **snapshot)
            except Exception:
                # Observation failure must not change installer execution.
                pass
    def wait(self, *args, **kwargs):
        result = super().wait(*args, **kwargs)
        with self._observed_guard:
            self._observed_stop.set()
            if not self._observed_finished:
                self._observed_finished = True
                emit(self._observed_phase, 'finished', self.pid, result)
        return result
subprocess.Popen = ObservedPopen
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`;

export async function provision(
  { target, output, execute = false, cleanup = false },
  env = process.env,
  dependencies = {},
) {
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.architecture ?? process.arch;
  const installerExec = dependencies.exec ?? exec;
  const observer = dependencies.observe ?? observe;
  const acquire = dependencies.acquire ?? acquirePinned;
  const nativeShell = dependencies.nativeShell ?? nativeWindowsShell;
  const plan = provisionPlan(target, platform, architecture);
  if (!execute) return plan;
  assertProvisionHost(env);
  if (!output || !env.RUNNER_TEMP)
    fail("An explicit runner-local output is required");
  const root = await realpath(env.RUNNER_TEMP),
    destination = path.resolve(output);
  const relative = path.relative(root, destination);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  )
    fail("Provision output must be beneath the ephemeral workspace");
  await mkdir(destination, { recursive: true });
  const canonical = path.relative(root, await realpath(destination));
  if (
    path.isAbsolute(canonical) ||
    canonical === ".." ||
    canonical.startsWith(`..${path.sep}`)
  )
    fail("Provision output resolves outside the ephemeral workspace");
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-hosted-provision",
    target,
    completed: false,
    publicationAllowed: false,
    engineBuildAttempted: false,
    stages: [],
  };
  const save = () =>
    writeFile(
      path.join(destination, "provision.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  await save();
  const run = async (executable, args, timeout, stage) => {
    receipt.stages.push({ stage, state: "running" });
    await save();
    try {
      const result = await installerExec(executable, args, {
        env: childEnvironment(env),
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 ** 2,
      });
      await writeFile(
        path.join(destination, `${stage}.log`),
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      );
      receipt.stages.at(-1).state = "completed";
      await save();
      return result;
    } catch (error) {
      await writeFile(
        path.join(destination, `${stage}.log`),
        `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      );
      receipt.stages.at(-1).state = "failed";
      receipt.failure = probeFailure(error, stage);
      if (stage === "install-sdk" && error.code === 3010)
        receipt.rebootRequired = true;
      await save();
      throw new Error(`Hosted prerequisite stage failed: ${stage}`);
    }
  };
  try {
    // The observer alone owns the canonical fixed Linux cleanup allowlist.
    const before = await observer(
      { target, output: path.join(destination, "before"), cleanup },
      env,
    );
    if (platform === "linux" && before.availableGiB < RECIPE.minimumFreeDiskGiB)
      fail(
        "Hosted Linux engine workspace remains below the reviewed disk minimum",
      );
    if (plan.installer) {
      const bytes = await acquire(plan.installer);
      const file = path.join(
        destination,
        platform === "win32" ? "winsdksetup.exe" : "install-build-deps.py",
      );
      await writeFile(file, bytes, { flag: "wx" });
      receipt.download = { size: bytes.length, sha256: hash(bytes) };
      await save();
      if (platform === "win32") {
        const shell = await nativeShell(env);
        const verifier = path.join(destination, "verify-signature.ps1");
        await writeFile(verifier, SIGNATURE_SCRIPT, { flag: "wx" });
        const verified = await run(
          shell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            verifier,
            "-Installer",
            file,
          ],
          90_000,
          "verify-sdk-signature",
        );
        const signature = JSON.parse(verified.stdout.trim());
        verifyInstallerSignature(signature);
        receipt.signature = signature;
        await save();
        await run(
          file,
          [
            ...plan.arguments,
            "/log",
            path.join(destination, "sdk-install.log"),
          ],
          20 * 60_000,
          "install-sdk",
        );
      } else {
        await run(
          "python3",
          ["-I", "-u", "-c", LINUX_INSTALLER_OBSERVER, file, ...plan.arguments],
          20 * 60_000,
          "install-linux-dependencies",
        );
        await run(
          "sudo",
          [
            "-n",
            "apt-get",
            "-y",
            "--no-install-recommends",
            "install",
            ...RECIPE.provisioning.linuxSupplementalPackages,
          ],
          10 * 60_000,
          "install-linux-supplemental-packages",
        );
        await run(
          "dpkg-query",
          ["-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"],
          30_000,
          "installed-packages",
        );
      }
    }
    const after = await observer(
      { target, output: path.join(destination, "after") },
      env,
    );
    receipt.blockers = after.blockers;
    receipt.completed = true;
    receipt.reviewStatus = "unreviewed-post-provision-observations";
    await save();
    if (env.GITHUB_OUTPUT)
      await appendFile(env.GITHUB_OUTPUT, `observations=${destination}\n`);
    return receipt;
  } catch (error) {
    if (!receipt.failure)
      receipt.failure = {
        stage: "provision",
        kind: "failed",
        exitCode: null,
        signal: null,
      };
    await save();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (
      !args[i].startsWith("--") ||
      !["target", "output", "execute", "cleanup"].includes(key) ||
      key in options
    )
      fail("Unknown or duplicate provision option");
    if (["execute", "cleanup"].includes(key)) options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail("Missing provision argument");
      options[key] = value;
    }
  }
  return provision(options);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
