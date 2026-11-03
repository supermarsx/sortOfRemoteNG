// INACTIVE private Windows ARM source/GN derivative; no compiler admission.
// BEGIN REVIEWED SOURCE DERIVATIVE
// Closed Windows ARM source/GN adapter. Import is inert; no compiler entry.
import fs from "node:fs/promises";
import {
  constants,
  openSync,
  writeSync,
  closeSync,
  writeFileSync,
  watch,
  renameSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const HELPER_ROOT = path.join(HERE, "current-source-helpers");
const SOURCE_PHASES = new Set([
  "source-admission",
  "repository-fetch",
  "gclient-sync",
  "hook-plan",
  "runhooks",
  "patch-apply",
  "setup-x86",
  "setup-x64",
  "setup-arm64",
  "cef-hook",
  "cef-gn",
  "graph-inventory",
  "complete",
]);
let currentProgress = null;

export class SourceProgress {
  constructor(root, contextSha, now = performance.now.bind(performance)) {
    this.root = root;
    this.contextSha = contextSha;
    this.now = now;
    this.begin = 0;
    this.lastOutput = 0;
    this.label = "source-admission";
    this.sequence = 0;
    this.stdout = 0;
    this.stderr = 0;
    this.completed = 0;
    this.total = 0;
    this.tail = "";
    this.writes = 0;
    this.failed = false;
    try {
      this.begin = now();
      this.lastOutput = this.begin;
      this.flush();
      this.timer = setInterval(() => this.flush(), 15000);
      this.timer.unref();
    } catch {
      this.failed = true;
    }
  }
  phase(label) {
    if (!SOURCE_PHASES.has(label)) {
      this.failed = true;
      return;
    }
    if (label === this.label) return;
    if (this.sequence >= 32) {
      this.failed = true;
      return;
    }
    this.label = label;
    this.sequence++;
    this.flush();
  }
  observe(role, stdout, chunk) {
    try {
      if (stdout) this.stdout += chunk.length;
      else this.stderr += chunk.length;
      this.lastOutput = this.now();
      if (role === "sync" && stdout) {
        this.tail = (this.tail + chunk.toString("utf8")).slice(-512);
        const match = /Syncing projects:\s*\d+%\s*\((\d+)\/(\d+)\)/.exec(
          this.tail,
        );
        if (
          match &&
          Number(match[1]) <= Number(match[2]) &&
          Number(match[2]) <= 10000
        ) {
          this.completed = Number(match[1]);
          this.total = Number(match[2]);
        }
      }
    } catch {
      this.failed = true;
    }
  }
  flush() {
    if (this.failed || this.writes >= 512) return;
    try {
      const now = this.now(),
        elapsed = Math.floor(now - this.begin),
        age = Math.floor(now - this.lastOutput);
      need(
        elapsed >= 0 &&
          elapsed <= 7200000 &&
          age >= 0 &&
          this.stdout + this.stderr <= 67108864,
        "FULL_PROGRESS_BOUND",
      );
      const real = realpathSync(this.root);
      need(
        real.replaceAll("\\", "/").toLowerCase() ===
          this.root.replaceAll("\\", "/").toLowerCase(),
        "FULL_PROGRESS_ROOT",
      );
      const value = {
        kind: "windows-arm-source-phase",
        contextSha256: this.contextSha,
        phase: this.label,
        sequence: this.sequence,
        elapsedMs: elapsed,
        stdoutBytes: this.stdout,
        stderrBytes: this.stderr,
        lastOutputAgeMs: age,
        syncCompleted: this.completed,
        syncTotal: this.total,
      };
      const raw = Buffer.from(JSON.stringify(value) + "\n");
      need(raw.length <= 2048, "FULL_PROGRESS_BOUND");
      const temporary = path.join(this.root, "source-phase-pending.json");
      writeFileSync(temporary, raw, { flag: "wx" });
      renameSync(temporary, path.join(this.root, "source-phase-result.json"));
      this.writes++;
    } catch {
      this.failed = true;
    }
  }
  close() {
    clearInterval(this.timer);
    this.flush();
    try {
      writeFileSync(
        path.join(this.root, "source-progress-metadata-result.json"),
        JSON.stringify({
          kind: "windows-arm-source-progress-metadata",
          metadataFailure: this.failed,
          samplesWritten: this.writes,
          sourceOutcomeNotInferred: true,
        }) + "\n",
        { flag: "wx" },
      );
    } catch {}
  }
}
const TARGET = "aarch64-pc-windows-msvc";
// Exact c101dcbe source bodies independently witnessed during hook admission.
const HOOK_PRIMARY = Object.freeze([
  Object.freeze({
    path: "gclient.py",
    bytes: 197613,
    sha256: "e4f65024411d1da4a7581b13c4ea2c249c247008d4a7d0dc343d06935e20eaef",
  }),
  Object.freeze({
    path: "gn.py",
    bytes: 3994,
    sha256: "52f824935d4cbf07a675438e5ac3eabc7aee360d4d9756b2d17c13db28121677",
  }),
]);
const BOOTSTRAP_SOURCES = [
  {
    path: "utils.py",
    bytes: 3305,
    sha256: "208b3a5f4eba28834f0eed242dc146ace7ec915fc155285cf1ecb750172e73f9",
  },
  {
    path: "vpython3.bat",
    bytes: 231,
    sha256: "e0104fdf826d1b2dddca10266553563319d4fc7179f839e5a60f732d99a4a2d7",
  },
  {
    path: "cipd.bat",
    bytes: 2914,
    sha256: "4b172599ba46f9d04b85c3c57dc6f86a54f2af44e5502a9f5861c79a0fc8248a",
  },
  {
    path: ".cipd_impl.ps1",
    bytes: 4723,
    sha256: "2101c2ab44ec93d71a6b38ebd5b62626844a979fedffaeb8ce7a9a5004812030",
  },
  {
    path: "cipd_client_version",
    bytes: 54,
    sha256: "c6179de8cdbd4c28d59ddcf8ab280b658cb0de26dddfce4a3ced31b94bf44c24",
  },
  {
    path: "cipd_client_version.digests",
    bytes: 3597,
    sha256: "3ba4bdeb37e5ee3868bdc3b6b458020118d4cc8a666bb3048c7b835a3ec77a9c",
  },
  {
    path: "cipd_manifest.txt",
    bytes: 3688,
    sha256: "825c2550ae559a0c045427158d008315446c5909f0ee446bae008dc9a07d09b3",
  },
  {
    path: "cipd_manifest.versions",
    bytes: 28650,
    sha256: "e4a72dd969b2dc4ed43b23fe03886b9972c0e63cde76ea189d34263602d1c34a",
  },
  {
    path: "cipd_bin_setup.bat",
    bytes: 1387,
    sha256: "3607a1f703b59f213f7fff874cb8d6065b5af17144c66458a0a35e18137069fa",
  },
];
const CIPD_CLIENT_SHA =
  "8f59e10885f14d06e222502cbfb65eb59199027dd9724aef6d271badf4a47b1f";
const VPYTHON_INSTANCE = "5_RRshFOtDVoKVpdtehepLtVyYsUdifAy9IHenpJmHoC";
let sourceCloseFailure = false;
let sourceReportingFailure = false;
const syncCloseReportingFaults = new WeakMap();
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const keys = (value, expected) =>
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
    "FULL_DRIVER_FIELDS",
  );

export function sourceBudget(
  context,
  p,
  now = Date.now,
  mono = performance.now.bind(performance),
) {
  const started = mono(),
    initial = Math.min(
      p.sourceGn.limits.wholeSeconds * 1000,
      context.wallWorkEnd * 1000 - now(),
    );
  need(Number.isFinite(initial) && initial > 0, "FULL_DRIVER_CLOCK");
  return {
    remaining() {
      const value = Math.min(
        context.wallWorkEnd * 1000 - now(),
        initial - (mono() - started),
      );
      need(Number.isFinite(value) && value > 0, "FULL_DRIVER_DEADLINE");
      return value;
    },
  };
}

export function reviewedHostTools(p) {
  keys(p.sourceGn.hostTools, ["node", "git"]);
  for (const role of ["node", "git"]) {
    const pin = p.sourceGn.hostTools[role];
    need(pin !== null, "FULL_HOST_TOOL_PIN_MISSING");
    keys(pin, ["path", "bytes", "sha256", "nlink"]);
    need(
      typeof pin.path === "string" &&
        /^C:\/[A-Za-z0-9 ./_-]+\/(?:node|git)\.exe$/.test(pin.path) &&
        !pin.path.split("/").some((x) => x === "." || x === "..") &&
        pin.path.endsWith(`/${role}.exe`) &&
        Number.isSafeInteger(pin.bytes) &&
        pin.bytes > 0 &&
        pin.bytes <= 256 * 1024 ** 2 &&
        /^[a-f0-9]{64}$/.test(pin.sha256) &&
        Number.isInteger(pin.nlink) &&
        pin.nlink >= 1 &&
        pin.nlink <= 8,
      "FULL_HOST_TOOL_PIN",
    );
  }
  return structuredClone(p.sourceGn.hostTools);
}

export function reviewedHostClosure(p, image) {
  const value = p.sourceGn.hostClosure,
    tools = reviewedHostTools(p),
    imageData = sourceImageData(p);
  keys(value, ["image", "rows", "peBytes", "edgeCount", "edgeSha256"]);
  need(
    image === value.image &&
      image === p.image &&
      imageData.profileSha256 === imageData.selectedProfileSha256,
    "FULL_HOST_IMAGE",
  );
  need(
    Array.isArray(value.rows) && value.rows.length === 18,
    "FULL_HOST_CLOSURE_ROWS",
  );
  const names = new Map();
  let total = 0;
  for (const pin of value.rows) {
    keys(pin, ["path", "bytes", "sha256", "nlink", "machine"]);
    need(
      typeof pin.path === "string" &&
        (Object.values(tools).some((tool) => tool.path === pin.path) ||
          pin.path === "C:/Program Files/Git/ucrt64/bin/git.exe" ||
          pin.path ===
            "C:/Program Files/Git/ucrt64/libexec/git-core/git-remote-https.exe" ||
          /^C:\/Program Files\/Git\/ucrt64\/bin\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\.dll$/i.test(
            pin.path,
          )) &&
        !pin.path.includes("..") &&
        !/^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(
          path.basename(pin.path),
        ) &&
        !names.has(pin.path.toLowerCase()),
      "FULL_HOST_CLOSURE_PATH",
    );
    need(
      Number.isSafeInteger(pin.bytes) &&
        pin.bytes > 0 &&
        pin.bytes <= 256 * 1024 ** 2 &&
        typeof pin.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(pin.sha256) &&
        Number.isInteger(pin.nlink) &&
        pin.nlink >= 1 &&
        pin.nlink <= 8 &&
        pin.machine === 0x8664,
      "FULL_HOST_CLOSURE_PIN",
    );
    names.set(pin.path.toLowerCase(), pin);
    total += pin.bytes;
  }
  for (const pin of Object.values(tools))
    need(
      names.has(pin.path.toLowerCase()) &&
        Object.entries(pin).every(
          ([key, value]) => names.get(pin.path.toLowerCase())[key] === value,
        ),
      "FULL_HOST_CLOSURE_TOOL",
    );
  const seeds = p.commandInventory.candidates.filter(
    (row) => row.kind === "pe",
  );
  need(
    seeds.length === 11 &&
      seeds.every((row) => names.has(row.path.toLowerCase())),
    "FULL_HOST_CLOSURE_SEEDS",
  );
  need(
    Number.isSafeInteger(value.peBytes) &&
      total === value.peBytes &&
      total <= 512 * 1024 ** 2 &&
      Number.isInteger(value.edgeCount) &&
      value.edgeCount > 0 &&
      value.edgeCount <= 256 &&
      typeof value.edgeSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(value.edgeSha256),
    "FULL_HOST_CLOSURE_BOUND",
  );
  return structuredClone(value);
}

export async function verifyHostClosure(p, budget, image, reader = held) {
  const value = reviewedHostClosure(p, image);
  let bytes = 0;
  for (const pin of value.rows) {
    budget.remaining();
    need(pin.bytes <= 512 * 1024 ** 2 - bytes, "FULL_HOST_CLOSURE_BYTES");
    const raw = await reader(pin.path, pin.bytes, budget, pin);
    need(
      Buffer.isBuffer(raw) &&
        raw.length === pin.bytes &&
        sha(raw) === pin.sha256,
      "FULL_HOST_CLOSURE_PIN",
    );
    bytes += raw.length;
    budget.remaining();
  }
  return { files: value.rows.length, bytes, edgeSha256: value.edgeSha256 };
}

const signature = (s) =>
  [
    s.dev,
    s.ino,
    s.size,
    s.mtimeNs,
    s.ctimeNs,
    s.birthtimeNs,
    s.mode,
    s.nlink,
  ].join(":");
const shared = (s) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.birthtimeNs, s.nlink].join(":");
async function physical(file) {
  need(
    path.isAbsolute(file) &&
      !file
        .replaceAll("\\", "/")
        .split("/")
        .some((x) => x === "." || x === ".."),
    "FULL_DRIVER_PATH",
  );
  const resolved = await fs.realpath(file);
  need(
    resolved.replaceAll("\\", "/").toLowerCase() ===
      file.replaceAll("\\", "/").toLowerCase(),
    "FULL_DRIVER_ALIAS",
  );
  for (let at = file; ; at = path.dirname(at)) {
    need(!(await fs.lstat(at)).isSymbolicLink(), "FULL_DRIVER_LINK");
    if (path.dirname(at) === at) break;
  }
  return resolved;
}
async function held(file, cap, budget, pin, boundedReads = false) {
  budget.remaining();
  await physical(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === BigInt(pin?.nlink ?? 1) &&
      before.size >= 0n &&
      before.size <= BigInt(cap),
    "FULL_DRIVER_FILE",
  );
  const fd = await fs.open(file, constants.O_RDONLY);
  let failed = false;
  try {
    const fdBefore = await fd.stat({ bigint: true });
    need(shared(before) === shared(fdBefore), "FULL_DRIVER_IDENTITY");
    const chunks = [],
      buffer = Buffer.alloc(65536);
    let total = 0;
    while (true) {
      budget.remaining();
      if (boundedReads && total === Number(before.size)) break;
      const { bytesRead } = await fd.read(
        buffer,
        0,
        Math.min(
          buffer.length,
          boundedReads ? Number(before.size) - total : cap + 1 - total,
        ),
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
      need(total <= cap, "FULL_DRIVER_BOUND");
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const raw = Buffer.concat(chunks, total);
    need(
      signature(await fs.lstat(file, { bigint: true })) === signature(before) &&
        signature(await fd.stat({ bigint: true })) === signature(fdBefore) &&
        shared(before) === shared(fdBefore),
      "FULL_DRIVER_CHANGED",
    );
    if (pin)
      need(
        raw.length === pin.bytes && sha(raw) === pin.sha256,
        "FULL_DRIVER_PIN",
      );
    return raw;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      sourceCloseFailure = true;
      if (!failed) throw error;
    }
  }
}

export function sourcePaths(root, p) {
  const imageData = sourceImageData(p);
  need(
    p.sourceGn.mode === "image-qualified-source-gn" &&
      p.sourceGn.sourceId === imageData.sourceId &&
      p.sourceGn.namespace === imageData.namespace &&
      p.sourceGn.compilerAllowed === false &&
      p.sourceGn.checkpointAllowed === false &&
      p.sourceGn.restoreAllowed === false &&
      p.sourceGn.sdkAllowed === false,
    "FULL_SOURCE_POLICY",
  );
  need(path.isAbsolute(root) && !/\s/.test(root), "FULL_SOURCE_WORKSPACE");
  const workspace = path.join(root, "source-checkout");
  return {
    workspace,
    chromium: path.join(workspace, "src"),
    cef: path.join(workspace, "src/cef"),
    depot: path.join(workspace, "depot_tools"),
    logs: path.join(root, "source-gn-logs"),
    commands: path.join(root, "source-commands"),
    inputs: path.join(REPO, p.sourceGn.namespace),
  };
}

// Batch expansion is confined to the pinned hook arguments, never an ambient
// interpreter. Reject cmd metacharacters in the fixed interpreter path itself.
export function python3Adapter(python) {
  need(
    /^C:\/[A-Za-z0-9 ./_-]+\/python\.exe$/.test(python) &&
      !python.split("/").some((part) => part === "." || part === ".."),
    "FULL_PYTHON_ADAPTER_PATH",
  );
  return Buffer.from(
    `@echo off\r\n"${python}" -B %*\r\nexit /b %errorlevel%\r\n`,
    "ascii",
  );
}

export async function preparePython3Adapter(directory, python, budget) {
  const raw = python3Adapter(python);
  budget.remaining();
  await physical(path.dirname(directory));
  await fs.mkdir(directory); // Exclusive owned directory: never replace a shim.
  await physical(directory);
  const file = path.join(directory, "python3.bat");
  await fs.writeFile(file, raw, { flag: "wx" });
  const pin = Object.freeze({ bytes: raw.length, sha256: sha(raw), nlink: 1 });
  await held(file, 4096, budget, pin);
  return Object.freeze({ file, pin });
}

export function bootstrapShim(python, script, guardSha, witnessSha, role) {
  python3Adapter(python);
  need(
    ["cipd", "vpython"].includes(role) &&
      /^[a-f0-9]{64}$/.test(guardSha) &&
      /^[a-f0-9]{64}$/.test(witnessSha) &&
      path.isAbsolute(script) &&
      !/["%&|<>!^\r\n]/.test(script),
    "FULL_BOOTSTRAP_SHIM",
  );
  return Buffer.from(
    `@echo off\r\n"${python}" -I -B "${script}" --execute ${role} ${guardSha} ${witnessSha} %*\r\nexit /b %errorlevel%\r\n`,
    "ascii",
  );
}

export function deriveBootstrapSetup(raw) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw),
    old = 'call "%~dp0\\cipd.bat" ensure';
  need(text.split(old).length === 2, "FULL_BOOTSTRAP_SETUP_SOURCE");
  return Buffer.from(text.replace(old, '"%~dp0\\.cipd_client.exe" ensure'));
}

export function bootstrapProgram(root, p, contextSha) {
  const files = sourcePaths(root, p);
  const fullAuthority = fullBootstrapAuthority(root, p, contextSha);
  need(/^[a-f0-9]{64}$/.test(contextSha), "FULL_CONTEXT_PIN");
  const policy = {
    root: root.replaceAll("\\", "/"),
    depot: files.depot.replaceAll("\\", "/"),
    commands: files.commands.replaceAll("\\", "/"),
    native: HERE.replaceAll("\\", "/"),
    workspace: files.workspace.replaceAll("\\", "/"),
    python: p.python.path,
    contextSha,
    fullContext: fullAuthority?.context ?? null,
    enabled: fullAuthority
      ? FULL_SOURCE_BODY_ADMITTED &&
        Object.values(p.sourceGn.executionPolicy).every(
          (value) => value === true,
        )
      : PRIVATE_DRIVER_ADMITTED &&
        p.privatePolicy.privateAuthorityAdmitted === true &&
        p.phaseAdmission["image-qualified-source-gn"] === true &&
        Object.values(p.sourceGn.executionPolicy).every(
          (value) => value === true,
        ),
    image: p.image,
    sources: BOOTSTRAP_SOURCES,
    clientSha: CIPD_CLIENT_SHA,
    instance: VPYTHON_INSTANCE,
    syncArgs: [
      "sync",
      "--jobs",
      "2",
      "--nohooks",
      "--noprehooks",
      "--no-history",
      "--revision",
      `src@${p.sourceChromium}`,
    ],
  };
  return Buffer.from(
    String.raw`import sys,os,json,time,stat,hashlib,subprocess
from pathlib import Path
P=json.loads(${JSON.stringify(JSON.stringify(policy))})
sys.path.insert(0,P['native'])
import acquire as data
import extract
ROOT=Path(P['root']);DEPOT=Path(P['depot']);COMMANDS=Path(P['commands'])
SCRIPT=COMMANDS/'source_bootstrap.py';WITNESS=COMMANDS/'bootstrap-witness.json'
SETUP=DEPOT/'sorng-cipd-setup.bat'
CAP=512*1024**2
def context():
 short=data.Clock(time.time()+5,time.monotonic()+5)
 _,raw=extract.held(ROOT/'context.json',short,sha256=P['contextSha'],retain=True,maximum=131072,bounded_reads=True)
 value=json.loads(raw)
 if P['fullContext'] is not None:
  data.need(P['enabled'] is True and value==P['fullContext'],'FULL_BOOTSTRAP_AUTHORITY')
 else:
  data.need(P['enabled'] is True and value['mode']=='private-compiler-input-qualification' and value['image']==P['image'] and value['image'] in ('20261030.294.1','20261021.278.1') and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101','FULL_BOOTSTRAP_AUTHORITY')
 clock=data.Clock(value['wallWorkEnd'],value['monotonicWorkEnd'])
 for key,relative in (('CIPD_CACHE_DIR','cipd'),('VPYTHON_VIRTUALENV_ROOT','vpython'),('LOCALAPPDATA','local'),('APPDATA','roaming'),('XDG_CACHE_HOME','xdg')):
  data.need(Path(os.environ.get(key,''))==ROOT/'source-caches'/relative,'FULL_BOOTSTRAP_ENV');data.plain(ROOT/'source-caches'/relative)
 data.need(Path(os.environ.get('CIPD_CONFIG_FILE',''))==ROOT/'source-caches/cipd.cfg' and not any(os.environ.get(key)for key in ('CIPD_BACKEND','CIPD_SERVICE_URL','CIPD_PLATFORM','VPYTHON_BYPASS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')),'FULL_BOOTSTRAP_ENV')
 extract.held(ROOT/'source-caches/cipd.cfg',clock,expected_size=0,sha256=hashlib.sha256(b'').hexdigest(),maximum=0,bounded_reads=True)
 return clock
def write_new(path,raw,clock):
 clock.remaining();data.plain(path,exists=False);stream=path.open('xb');failed=False
 try:data.need(stream.write(raw)==len(raw),'FULL_BOOTSTRAP_WRITE')
 except BaseException:failed=True;raise
 finally:
  try:stream.close()
  except BaseException:
   if not failed:raise
   print('FULL_BOOTSTRAP_CLOSE_FAILURE',file=sys.stderr)
 clock.remaining()
def read_pin(path,clock,ledger,pin=None,maximum=256*1024**2):
 path=data.plain(path);size=path.lstat().st_size
 data.need(0<=size<=min(maximum,CAP-ledger[0]),'FULL_BOOTSTRAP_BYTES')
 if pin is not None:data.need(size==pin['bytes'] and pin['nlink']==1,'FULL_BOOTSTRAP_PIN')
 charged=0
 def consumed(count):
  nonlocal charged
  data.need(type(count)is int and charged<=count<=size,'FULL_BOOTSTRAP_BYTES')
  ledger[0]+=count-charged;charged=count;data.need(ledger[0]<=CAP,'FULL_BOOTSTRAP_BYTES')
 observed,raw=extract.held(path,clock,expected_size=size,sha256=None if pin is None else pin['sha256'],retain=True,maximum=min(maximum,CAP-ledger[0]),expected_nlink=1,progress=consumed,bounded_reads=True)
 data.need(observed['bytes']==charged==size,'FULL_BOOTSTRAP_BYTES')
 return dict(path=path.as_posix(),bytes=size,sha256=observed['sha256'],nlink=1),raw
def sources(clock,ledger):
 result={}
 for pin in P['sources']:result[pin['path']]=read_pin(DEPOT/pin['path'],clock,ledger,dict(pin,nlink=1),2*1024**2)[1]
 return result
def absent(path):
 try:path.lstat()
 except FileNotFoundError:return
 raise data.Denied('FULL_BOOTSTRAP_PREEXISTING')
def directory_signature(value):
 signature=data.signature(value)
 return signature[:2]+signature[3:] if os.name=='nt' else signature
def empty_directory(path,clock):
 path=data.plain(path);before=path.lstat();data.need(stat.S_ISDIR(before.st_mode),'FULL_BOOTSTRAP_DIRECTORY')
 iterator=os.scandir(path);failed=False
 try:data.need(next(iterator,None)is None,'FULL_BOOTSTRAP_CACHE_NOT_EMPTY')
 except BaseException:failed=True;raise
 finally:
  try:iterator.close()
  except BaseException:
   if not failed:raise
   print('FULL_BOOTSTRAP_CLOSE_FAILURE',file=sys.stderr)
 data.need(directory_signature(before)==directory_signature(path.lstat()),'FULL_BOOTSTRAP_DIRECTORY_CHANGED');clock.remaining()
def override_absent():absent(DEPOT/'.cipd_client_platform')
def shim(role,guard_sha,witness_sha):
 return ('@echo off\r\n"'+P['python']+'" -I -B "'+str(SCRIPT)+'" --execute '+role+' '+guard_sha+' '+witness_sha+' %*\r\nexit /b %errorlevel%\r\n').encode('ascii')
def run_checked(command,clock,stdin=None):
 seconds=clock.remaining()-120;data.need(seconds>0,'FULL_SOURCE_RESERVE')
 if stdin is not None:return subprocess.run(command,check=False,shell=False,timeout=seconds,input=stdin).returncode
 return subprocess.run(command,check=False,shell=False,timeout=seconds).returncode
def derived_setup(raw):
 old=b'call "%~dp0\\cipd.bat" ensure';new=b'"%~dp0\\.cipd_client.exe" ensure'
 data.need(raw.count(old)==1,'FULL_BOOTSTRAP_SETUP_SOURCE')
 return raw.replace(old,new)
def provision(guard_sha,runner=run_checked):
 clock=context();ledger=[0];raw_sources=sources(clock,ledger)
 read_pin(SCRIPT,clock,ledger,dict(bytes=SCRIPT.stat().st_size,sha256=guard_sha,nlink=1),2*1024**2)
 for path in (DEPOT/'.cipd_client_platform',DEPOT/'.cipd_client.exe',DEPOT/'.versions',DEPOT/'.cipd_bin',SETUP,WITNESS,COMMANDS/'cipd.bat',COMMANDS/'vpython3.bat'):absent(path)
 for name in ('local','roaming','xdg','cipd','vpython'):empty_directory(ROOT/'source-caches'/name,clock)
 code=runner(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',str(DEPOT/'.cipd_impl.ps1'),'-CipdBinary',str(DEPOT/'.cipd_client.exe'),'-Platform','windows-amd64','-BackendURL','https://chrome-infra-packages.appspot.com','-VersionFile',str(DEPOT/'cipd_client_version')],clock)
 data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_CLIENT_EXIT')
 client,_=read_pin(DEPOT/'.cipd_client.exe',clock,ledger)
 data.need(client['sha256']==P['clientSha'],'FULL_BOOTSTRAP_CLIENT_HASH')
 write_new(SETUP,derived_setup(raw_sources['cipd_bin_setup.bat']),clock)
 code=runner(['C:\\Windows\\System32\\cmd.exe','/d','/c',str(SETUP)],clock)
 data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_SETUP_EXIT')
 ledger=[0];sources(clock,ledger);override_absent()
 read_pin(SETUP,clock,ledger,dict(bytes=len(derived_setup(raw_sources['cipd_bin_setup.bat'])),sha256=hashlib.sha256(derived_setup(raw_sources['cipd_bin_setup.bat'])).hexdigest(),nlink=1))
 client,_=read_pin(DEPOT/'.cipd_client.exe',clock,ledger,client)
 vpython,body=read_pin(DEPOT/'.cipd_bin/vpython3.exe',clock,ledger)
 data.need(extract.pe_metadata(body)['machine']==0x8664,'FULL_BOOTSTRAP_VPYTHON_MACHINE')
 for target,source in (('.cipd_manifest.txt','cipd_manifest.txt'),('.cipd_manifest.versions','cipd_manifest.versions'),('.cipd_client_version','cipd_client_version')):
  pin=next(pin for pin in P['sources']if pin['path']==source)
  read_pin(DEPOT/'.cipd_bin'/target,clock,ledger,dict(pin,nlink=1))
 value=dict(kind='windows-arm-fresh-pinned-bootstrap',contextSha=P['contextSha'],guardSha=guard_sha,setupExit=0,fresh=True,packageInstance=P['instance'],client=client,vpython=vpython,vpythonMachine=0x8664)
 raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();write_new(WITNESS,raw,clock);witness_sha=hashlib.sha256(raw).hexdigest()
 for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):write_new(COMMANDS/name,shim(role,guard_sha,witness_sha),clock)
 verify(witness_sha,guard_sha)
 return value
def verify(expected,guard_sha):
 data.need(all(type(value)is str and len(value)==64 and all(c in '0123456789abcdef'for c in value)for value in (expected,guard_sha)),'FULL_BOOTSTRAP_EXPECTED_PIN')
 clock=context();ledger=[0];witness_pin,raw=read_pin(WITNESS,clock,ledger,maximum=65536)
 data.need(witness_pin['sha256']==expected,'FULL_BOOTSTRAP_WITNESS_PIN')
 value=json.loads(raw)
 data.need(type(value)is dict and set(value)=={'kind','contextSha','guardSha','setupExit','fresh','packageInstance','client','vpython','vpythonMachine'} and value['kind']=='windows-arm-fresh-pinned-bootstrap' and value['contextSha']==P['contextSha'] and type(value['setupExit'])is int and value['setupExit']==0 and value['fresh']is True and value['packageInstance']==P['instance'] and type(value['vpythonMachine'])is int and value['vpythonMachine']==0x8664,'FULL_BOOTSTRAP_WITNESS')
 data.need(value['guardSha']==guard_sha,'FULL_BOOTSTRAP_GUARD_PIN')
 read_pin(SCRIPT,clock,ledger,dict(bytes=SCRIPT.stat().st_size,sha256=guard_sha,nlink=1),2*1024**2)
 raw_sources=sources(clock,ledger);override_absent()
 for role,path in (('client',DEPOT/'.cipd_client.exe'),('vpython',DEPOT/'.cipd_bin/vpython3.exe')):
  pin=value[role]
  data.need(type(pin)is dict and set(pin)=={'path','bytes','sha256','nlink'} and pin['path']==path.as_posix() and type(pin['bytes'])is int and 0<pin['bytes']<=256*1024**2 and type(pin['nlink'])is int and pin['nlink']==1 and type(pin['sha256'])is str and len(pin['sha256'])==64 and all(c in '0123456789abcdef'for c in pin['sha256']),'FULL_BOOTSTRAP_PIN')
  data.need(role!='client' or pin['sha256']==P['clientSha'],'FULL_BOOTSTRAP_CLIENT_HASH')
  read_pin(path,clock,ledger,pin)
 setup=derived_setup(raw_sources['cipd_bin_setup.bat']);read_pin(SETUP,clock,ledger,dict(bytes=len(setup),sha256=hashlib.sha256(setup).hexdigest(),nlink=1))
 for target,source in (('.cipd_manifest.txt','cipd_manifest.txt'),('.cipd_manifest.versions','cipd_manifest.versions'),('.cipd_client_version','cipd_client_version')):
  pin=next(pin for pin in P['sources']if pin['path']==source);read_pin(DEPOT/'.cipd_bin'/target,clock,ledger,dict(pin,nlink=1))
 for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):
  body=shim(role,value['guardSha'],witness_pin['sha256']);read_pin(COMMANDS/name,clock,ledger,dict(bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),nlink=1),4096)
 return value,clock
def arguments(role,args):
 data.need(type(args)is list and 0<len(args)<=64 and all(type(value)is str and len(value)<=4096 and not any(c in value for c in '\x00\r\n%&|<>!^')for value in args),'FULL_BOOTSTRAP_ARGV')
 if role=='cipd':
  if args[0]=='export':
   data.need(len(args)==5 and args[1]=='--root' and args[3:]==['--ensure-file','-'],'FULL_BOOTSTRAP_CIPD_EXPORT_ARGV')
   out=data.plain(args[2]);name=out.parent.name;identity=name[len('virtualenv+'):]
   data.need(args[2].replace('\\','/')==out.as_posix() and out.name=='contents' and out.parent.parent==ROOT/'source-caches/vpython/store' and name.startswith('virtualenv+') and len(identity)==26 and all(c in '0123456789abcdefghijklmnopqrstuv'for c in identity) and identity[-1]in '048cgkos' and stat.S_ISDIR(out.lstat().st_mode),'FULL_BOOTSTRAP_CIPD_EXPORT_ROOT');return
  if args[0]=='expand-package-name':
   data.need(len(args)==2 and args[1] and not args[1].startswith(('-','/')) and '..'not in args[1] and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789_/{}.-'+chr(36)for c in args[1]),'FULL_BOOTSTRAP_CIPD_ARGV');return
  data.need(len(args)==7 and args[0]in ('ensure','ensure-file-resolve') and args[1]=='-log-level' and args[2]in ('info','error'),'FULL_BOOTSTRAP_CIPD_ARGV')
  if args[0]=='ensure':
   data.need(args[3]=='-root' and data.plain(args[4])==Path(P['workspace']) and args[5]=='-ensure-file','FULL_BOOTSTRAP_CIPD_ARGV')
   paths=[args[6]]
  else:
   data.need(args[3]=='-ensure-file' and args[5]=='-json-output','FULL_BOOTSTRAP_CIPD_ARGV');paths=[args[4],args[6]]
  for value in paths:
   path=data.plain(value);info=path.lstat();data.need(path.parent==ROOT/'tmp' and stat.S_ISREG(info.st_mode) and info.st_nlink==1,'FULL_BOOTSTRAP_TEMP_PATH')
def export_input(clock):
 # Exact pinned Chromium 3.11 install -> infra c77 / LUCI 7ba3 CIPDExport.
 # ensure.File.Serialize writes two spaces between this package and version.
 expected=b'infra/3pp/tools/virtualenv  version:2@20.25.1.chromium.8\n'
 clock.remaining();raw=sys.stdin.buffer.read(len(expected)+1);clock.remaining()
 data.need(type(raw)is bytes and raw==expected,'FULL_BOOTSTRAP_CIPD_EXPORT_INPUT')
 return raw

def execute(role,args,expected,guard_sha,runner=run_checked):
 data.need(role in ('cipd','vpython'),'FULL_BOOTSTRAP_ROLE');arguments(role,args)
 stdin=export_input(context())if role=='cipd'and args[0]=='export'else None
 value,clock=verify(expected,guard_sha);failed=False
 try:
  command=[value['client'if role=='cipd'else 'vpython']['path'],*args]
  code=runner(command,clock)if stdin is None else runner(command,clock,stdin)
  data.need(type(code)is int and code==0,'FULL_BOOTSTRAP_CHILD_EXIT')
 except BaseException:failed=True;raise
 finally:
  try:verify(expected,guard_sha)
  except BaseException:
   if not failed:raise
   print('FULL_BOOTSTRAP_POST_FAILURE',file=sys.stderr)
def inherited_environment(approved,candidate):
 current=dict(os.environ);expected=dict(approved)
 # Exact writes from pinned gclient.main; these do not select executables.
 for key,value in (('GIT_PAGER','cat'),('GIT_EDITOR','false'),('GIT_TERMINAL_PROMPT','0')):
  if key in current:
   data.need(current[key]==approved.get(key)or current[key]==value,'FULL_BOOTSTRAP_INHERITED_ENV')
   expected[key]=current[key]
 # Pinned GitDependency.update records commit data, not command/config authority.
 if 'GCLIENT_PREVIOUS_SYNC_COMMITS'in current:
  value=current['GCLIENT_PREVIOUS_SYNC_COMMITS']
  data.need(type(value)is str and 0<len(value)<=1024**2 and not any(c in value for c in '\x00\r\n'),'FULL_BOOTSTRAP_INHERITED_ENV')
  expected['GCLIENT_PREVIOUS_SYNC_COMMITS']=value
 data.need(current==expected,'FULL_BOOTSTRAP_INHERITED_ENV')
 if candidate is None:return
 data.need(type(candidate)is dict,'FULL_BOOTSTRAP_ENV_OVERRIDE');expected=dict(current)
 if 'COLUMNS'not in current or 'LINES'not in current:
  if 'COLUMNS'in candidate and 'LINES'in candidate:
   for key in ('COLUMNS','LINES'):
    value=candidate[key]
    data.need(type(value)is str and value.isascii()and value.isdecimal()and 1<=len(value)<=5 and value[0]!='0'and 1<=int(value)<=10000,'FULL_BOOTSTRAP_TERMINAL_ENV')
    expected[key]=value
 data.need(candidate==expected,'FULL_BOOTSTRAP_ENV_OVERRIDE')

def bind(expected,guard_sha):
 value,_=verify(expected,guard_sha);sys.path.insert(0,str(DEPOT));import subprocess2
 if getattr(subprocess2,'_sorng_cipd_bound',False):return
 popen=subprocess2.Popen;data.need(isinstance(popen,type),'FULL_BOOTSTRAP_POPEN_CLASS')
 original_init=popen.__init__;approved=dict(os.environ)
 def admitted(self,args,**kwargs):
  if isinstance(args,(list,tuple))and args and args[0]in ('cipd','cipd.bat',str(DEPOT/'cipd.bat')):
   values=list(args[1:]);data.need(not(values and values[0]=='export'),'FULL_BOOTSTRAP_CIPD_EXPORT_ROLE');arguments('cipd',values);inherited_environment(approved,kwargs.get('env'));current,_=verify(expected,guard_sha);kwargs['shell']=False
   return original_init(self,[current['client']['path'],*values],**kwargs)
  return original_init(self,args,**kwargs)
 popen.__init__=admitted;subprocess2._sorng_cipd_bound=True
def main(argv):
 data.need(P['enabled']is True and os.name=='nt','FULL_BOOTSTRAP_DISABLED')
 if len(argv)>=3 and argv[:2]==['--prepare-sync','--guard-sha']:
  guard_sha=argv[2];data.need(argv[3:]==P['syncArgs'][1:],'FULL_BOOTSTRAP_SYNC_ARGV')
  value=provision(guard_sha);print('FULL_BOOTSTRAP_WITNESS:'+json.dumps(value,sort_keys=True,separators=(',',':')),flush=True)
  expected=hashlib.sha256((json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest()
  bind(expected,guard_sha);sys.path.insert(0,str(DEPOT));import gclient
  return gclient.main(P['syncArgs'])
 data.need(len(argv)>=5 and argv[0]=='--execute','FULL_BOOTSTRAP_ARGV')
 execute(argv[1],argv[4:],argv[3],argv[2]);return 0
if __name__=='__main__':sys.exit(main(sys.argv[1:]))
`,
    "utf8",
  );
}

export async function prepareBootstrap(root, p, contextSha, budget) {
  const files = sourcePaths(root, p),
    file = path.join(files.commands, "source_bootstrap.py"),
    raw = bootstrapProgram(root, p, contextSha);
  await fs.writeFile(file, raw, { flag: "wx" });
  const pin = { path: file, bytes: raw.length, sha256: sha(raw), nlink: 1 };
  await held(file, 2 * 1024 ** 2, budget, pin);
  return {
    file,
    pin,
    witness: path.join(files.commands, "bootstrap-witness.json"),
    witnessPin: null,
  };
}

export async function verifyBootstrap(root, p, bootstrap, budget, contextSha) {
  const files = sourcePaths(root, p);
  need(bootstrap.witnessPin !== null, "FULL_BOOTSTRAP_NOT_ATTESTED");
  await held(bootstrap.file, 2 * 1024 ** 2, budget, bootstrap.pin);
  const raw = await held(
    bootstrap.witness,
    65536,
    budget,
    bootstrap.witnessPin,
  );
  const value = JSON.parse(raw);
  keys(value, [
    "kind",
    "contextSha",
    "guardSha",
    "setupExit",
    "fresh",
    "packageInstance",
    "client",
    "vpython",
    "vpythonMachine",
  ]);
  need(
    value.kind === "windows-arm-fresh-pinned-bootstrap" &&
      value.contextSha === contextSha &&
      value.guardSha === bootstrap.pin.sha256 &&
      value.setupExit === 0 &&
      value.fresh === true &&
      value.packageInstance === VPYTHON_INSTANCE &&
      value.vpythonMachine === 0x8664,
    "FULL_BOOTSTRAP_WITNESS",
  );
  const witnessPin = { bytes: raw.length, sha256: sha(raw), nlink: 1 };
  let bytes = bootstrap.pin.bytes + raw.length,
    setupSource;
  for (const [role, relative] of [
    ["client", ".cipd_client.exe"],
    ["vpython", ".cipd_bin/vpython3.exe"],
  ]) {
    const pin = value[role];
    keys(pin, ["path", "bytes", "sha256", "nlink"]);
    need(
      pin.path === path.join(files.depot, relative).replaceAll("\\", "/") &&
        Number.isSafeInteger(pin.bytes) &&
        pin.bytes > 0 &&
        pin.bytes <= 256 * 1024 ** 2 &&
        pin.nlink === 1 &&
        /^[a-f0-9]{64}$/.test(pin.sha256) &&
        (role !== "client" || pin.sha256 === CIPD_CLIENT_SHA),
      "FULL_BOOTSTRAP_PIN",
    );
    need(pin.bytes <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");
    await held(pin.path, pin.bytes, budget, pin, true);
    bytes += pin.bytes;
  }
  for (const pin of BOOTSTRAP_SOURCES) {
    need(pin.bytes <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");
    const body = await held(
      path.join(files.depot, pin.path),
      pin.bytes,
      budget,
      pin,
      true,
    );
    bytes += pin.bytes;
    if (pin.path === "cipd_bin_setup.bat") setupSource = body;
  }
  for (const [target, source] of [
    [".cipd_manifest.txt", "cipd_manifest.txt"],
    [".cipd_manifest.versions", "cipd_manifest.versions"],
    [".cipd_client_version", "cipd_client_version"],
  ]) {
    const pin = BOOTSTRAP_SOURCES.find((pin) => pin.path === source);
    need(pin.bytes <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");
    await held(
      path.join(files.depot, ".cipd_bin", target),
      pin.bytes,
      budget,
      pin,
      true,
    );
    bytes += pin.bytes;
  }
  const setup = deriveBootstrapSetup(setupSource);
  need(setup.length <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");
  await held(
    path.join(files.depot, "sorng-cipd-setup.bat"),
    setup.length,
    budget,
    { bytes: setup.length, sha256: sha(setup), nlink: 1 },
    true,
  );
  bytes += setup.length;
  for (const [role, name] of [
    ["cipd", "cipd.bat"],
    ["vpython", "vpython3.bat"],
  ]) {
    const body = bootstrapShim(
      p.python.path,
      bootstrap.file,
      bootstrap.pin.sha256,
      witnessPin.sha256,
      role,
    );
    need(body.length <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");
    await held(
      path.join(files.commands, name),
      body.length,
      budget,
      { bytes: body.length, sha256: sha(body), nlink: 1 },
      true,
    );
    bytes += body.length;
  }
  await fs.lstat(path.join(files.depot, ".cipd_client_platform")).then(
    () => need(false, "FULL_BOOTSTRAP_OVERRIDE"),
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  need(
    bootstrap.witnessPin !== null &&
      bootstrap.witnessPin.sha256 === witnessPin.sha256,
    "FULL_BOOTSTRAP_NOT_ATTESTED",
  );
  return value;
}

export function bootstrapObserver(bootstrap, contextSha) {
  need(bootstrap.witnessPin === null, "FULL_BOOTSTRAP_ALREADY_ATTESTED");
  const prefix = Buffer.from("FULL_BOOTSTRAP_WITNESS:"),
    cap = 65536 + prefix.length;
  let tail = Buffer.alloc(0),
    dropping = false,
    found = false;
  return {
    push(chunk) {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start),
          stop = end === -1 ? chunk.length : end,
          piece = chunk.subarray(start, stop);
        if (!dropping) {
          if (tail.length + piece.length > cap) {
            const first = Buffer.concat([
              tail,
              piece.subarray(0, prefix.length),
            ]).subarray(0, prefix.length);
            need(!first.equals(prefix), "FULL_BOOTSTRAP_ATTESTATION_BOUND");
            dropping = true;
            tail = Buffer.alloc(0);
          } else tail = Buffer.concat([tail, piece]);
        }
        if (end !== -1) {
          if (!dropping && tail.subarray(0, prefix.length).equals(prefix)) {
            need(!found, "FULL_BOOTSTRAP_ATTESTATION_DUPLICATE");
            const line = tail.at(-1) === 13 ? tail.subarray(0, -1) : tail;
            const raw = Buffer.concat([
              line.subarray(prefix.length),
              Buffer.from("\n"),
            ]);
            need(raw.length <= 65536, "FULL_BOOTSTRAP_ATTESTATION_BOUND");
            const value = JSON.parse(raw);
            keys(value, [
              "kind",
              "contextSha",
              "guardSha",
              "setupExit",
              "fresh",
              "packageInstance",
              "client",
              "vpython",
              "vpythonMachine",
            ]);
            need(
              value.kind === "windows-arm-fresh-pinned-bootstrap" &&
                value.contextSha === contextSha &&
                value.guardSha === bootstrap.pin.sha256 &&
                value.setupExit === 0 &&
                value.fresh === true &&
                value.packageInstance === VPYTHON_INSTANCE &&
                value.client?.sha256 === CIPD_CLIENT_SHA &&
                value.vpythonMachine === 0x8664,
              "FULL_BOOTSTRAP_ATTESTATION",
            );
            bootstrap.witnessPin = Object.freeze({
              bytes: raw.length,
              sha256: sha(raw),
              nlink: 1,
            });
            found = true;
          }
          tail = Buffer.alloc(0);
          dropping = false;
        }
        start = end === -1 ? chunk.length : end + 1;
      }
    },
    finish() {
      need(found, "FULL_BOOTSTRAP_ATTESTATION_MISSING");
    },
  };
}

export function bindBootstrapVector(command, bootstrap) {
  const witness = "__SORNG_BOOTSTRAP_WITNESS__",
    guard = "__SORNG_BOOTSTRAP_GUARD__";
  const hasWitness = command.args.includes(witness),
    hasGuard = command.args.includes(guard);
  if (!hasWitness && !hasGuard) return command.args;
  need(
    hasWitness &&
      hasGuard &&
      command.args.filter((arg) => arg === witness).length === 1 &&
      command.args.filter((arg) => arg === guard).length === 1 &&
      /^[a-f0-9]{64}$/.test(bootstrap?.witnessPin?.sha256 ?? "") &&
      /^[a-f0-9]{64}$/.test(bootstrap?.pin?.sha256 ?? ""),
    "FULL_BOOTSTRAP_VECTOR_PIN",
  );
  return command.args.map((arg) =>
    arg === witness
      ? bootstrap.witnessPin.sha256
      : arg === guard
        ? bootstrap.pin.sha256
        : arg,
  );
}

export function hookProjectionArguments(depot, commands = depot) {
  return [
    "-B",
    "-c",
    `import sys,os,json,re
sys.path.insert(0,sys.argv[2])
import source_bootstrap
source_bootstrap.bind(sys.argv[3],sys.argv[4])
sys.path.insert(0,sys.argv[1])
import gclient
options,args=gclient.OptionParser().parse_args(['--jobs','2'])
options.nohooks=True
options.noprehooks=True
options.process_all_deps=True
client=gclient.GClient.LoadCurrentConfig(options)
if client is None: raise RuntimeError('FULL_HOOK_CONFIG')
if client.RunOnDeps('flatten',args,progress=False)!=0: raise RuntimeError('FULL_HOOK_FLATTEN')
# Hook observation needs scoped native objects, not a global DEPS vars map.
# Flattener's global-var consistency assertion remains unchanged upstream.
all_deps={};groups={'hooks':[],'pre_deps_hooks':[]};active=set();counts=[0,0]
def add_dep(dep):
 if dep.name in all_deps and all_deps[dep.name]!=dep: raise RuntimeError('FULL_HOOK_DEP_IDENTITY')
 if dep.url: all_deps[dep.name]=dep
 if len(all_deps)>4096: raise RuntimeError('FULL_HOOK_DEP_BOUND')
def collect(dep,depth):
 if depth>=64 or id(dep) in active: raise RuntimeError('FULL_HOOK_DEP_CYCLE_OR_DEPTH')
 counts[0]+=1
 if counts[0]>4096: raise RuntimeError('FULL_HOOK_DEP_BOUND')
 if not dep.deps_parsed: raise RuntimeError('FULL_HOOK_DEPS_UNPARSED')
 active.add(id(dep))
 try:
  for kind,rows in [('hooks',dep.deps_hooks),('pre_deps_hooks',dep.pre_deps_hooks)]:
   for hook in rows:
    if counts[1]>=512: raise RuntimeError('FULL_HOOK_COUNT')
    counts[1]+=1;groups[kind].append((dep,hook))
  for child in dep.dependencies: add_dep(child)
  for child in dep.dependencies:
   if child.should_recurse: collect(child,depth+1)
 finally: active.remove(id(dep))
for solution in client.dependencies:
 add_dep(solution);collect(solution,0)
def relative(value):
 return (type(value)is str and 0<len(value)<=512 and re.fullmatch(r'[A-Za-z0-9_./+-]+',value) is not None and not value.startswith('/') and
  all(part and part not in ('.','..') and part.lower()!='.git' for part in value.split('/')))
# Validate recursive origin paths before native pinning or metadata queries.
# Nonrecursive CIPD names legitimately contain ':', and are never DEPS paths.
for dep in all_deps.values():
 if not dep.should_recurse: continue
 hierarchy=dep.hierarchy_data()
 if (not relative(dep.name) or not relative(dep.deps_file) or type(hierarchy)not in(tuple,list) or not 0<len(hierarchy)<=64 or
  any(type(pair)not in(tuple,list) or len(pair)!=2 or not relative(pair[0]) or type(pair[1])is not str or len(pair[1])>4096 for pair in hierarchy)):
  raise RuntimeError('FULL_HOOK_PROJECTION_ORIGIN')
# Only recursive Git dependencies can supply the DEPS origins observed here.
# Formatter-wide pinning would resolve all registered CIPD packages, even those
# that are irrelevant to this hook observation. Native source sync is unchanged.
for dep in all_deps.values():
 if not dep.should_recurse: continue
 if dep.GetScmName()!='git': raise RuntimeError('FULL_HOOK_PROJECTION_ORIGIN')
 gclient.Flattener._pin_dep(None,dep)
origin_rows=set()
for dep in all_deps.values():
 if not dep.should_recurse: continue
 if type(dep.url)is not str or re.fullmatch(r'https://[^\\s@]+@[a-f0-9]{40}',dep.url)is None: raise RuntimeError('FULL_HOOK_PROJECTION_ORIGIN')
 filename=dep.deps_file
 if not os.path.exists(os.path.join(client.root_dir,dep.name,filename)):
  filename='DEPS'
  if not os.path.exists(os.path.join(client.root_dir,dep.name,filename)): continue
 origin_rows.add((dep.url,filename,dep.hierarchy_data()))
 if len(origin_rows)>1024: raise RuntimeError('FULL_HOOK_ORIGIN_COUNT')
hooks=[]
for kind,rows in [('hooks',groups['hooks']),('pre_deps_hooks',groups['pre_deps_hooks'])]:
 for dep,hook in rows:
  if len(hooks)>=512: raise RuntimeError('FULL_HOOK_COUNT')
  hooks.append(dict(kind=kind,name=hook.name,condition=hook.condition,pattern=hook.pattern,cwd=os.path.relpath(hook.effective_cwd).replace('\\\\','/'),action=hook.action))
origins=[dict(url=url,deps_file=filename,hierarchy=hierarchy) for url,filename,hierarchy in sorted(origin_rows)]
if len(origins)>1024: raise RuntimeError('FULL_HOOK_ORIGIN_COUNT')
raw=json.dumps(dict(kind='windows-arm-hook-projection',hooks=hooks,origins=origins),ensure_ascii=True,separators=(',',':')).encode('ascii')
if len(raw)>4*1024**2: raise RuntimeError('FULL_HOOK_PROJECTION_BOUND')
print('FULL_HOOK_PROJECTION:'+raw.decode('ascii'))
`,
    depot,
    commands,
    "__SORNG_BOOTSTRAP_WITNESS__",
    "__SORNG_BOOTSTRAP_GUARD__",
  ];
}

export function dependencyHookArguments(depot, adapter, pin) {
  return [
    "-B",
    "-c",
    `import sys,os,hashlib,threading
depot,adapter,digest,expected_bootstrap,expected_guard=sys.argv[1:]
sys.path.insert(0,os.path.dirname(adapter))
import source_bootstrap
source_bootstrap.bind(expected_bootstrap,expected_guard)
sys.path.insert(0,depot)
import gclient
original=gclient.Hook.run
dispatch=gclient.gclient_utils.CheckCallAndFilter
scope=threading.local()
apache_action=('python3','src/third_party/depot_tools/download_from_google_storage.py','--no_resume','--directory','--recursive','--num_threads=16','--bucket','chromium-apache-win32','src/third_party/apache-win32')
def project_apache(command,kwargs):
 hook=getattr(scope,'hook',None)
 candidate=getattr(hook,'name',None)=='apache_win32' or any(value in command for value in ('chromium-apache-win32','src/third_party/apache-win32'))
 if not candidate:return command
 if type(hook)is not gclient.Hook or hook.name!='apache_win32' or hook.condition!='checkout_win' or hook.pattern!=chr(92)+'.sha1' or tuple(hook.action)!=apache_action or tuple(command)!=apache_action:raise RuntimeError('FULL_HOOK_APACHE_PROJECTION')
 cwd=kwargs.get('cwd');workspace=source_bootstrap.P['workspace']
 if type(cwd)is not str or cwd.replace(chr(92),'/').lower()!=workspace.lower():raise RuntimeError('FULL_HOOK_APACHE_CWD')
 source_bootstrap.data.plain(cwd)
 # Exact source-owned resource projection; preserve the original frozen action.
 effective=list(command);effective[5]='--num_threads=4'
 return effective
def admitted_dispatch(command,*args,**kwargs):
 if not getattr(scope,'active',False): return dispatch(command,*args,**kwargs)
 if type(command) is not list or not command or len(command)>64 or command[0] not in ('python3','vpython3.bat'): raise RuntimeError('FULL_HOOK_ENTRY')
 for value in command:
  if type(value) is not str or len(value)>4096 or any(c in value for c in '\\x00\\r\\n%&|<>!^'): raise RuntimeError('FULL_HOOK_SHELL_ARGUMENT')
 effective=project_apache(command,kwargs)
 if os.path.islink(adapter) or os.path.realpath(adapter).lower()!=os.path.abspath(adapter).lower(): raise RuntimeError('FULL_PYTHON_ADAPTER_ALIAS')
 source=open(adapter,'rb')
 failed=False
 try: raw=source.read(4097)
 except BaseException:
  failed=True
  raise
 finally:
  try: source.close()
  except BaseException:
   if failed: print('FULL_PYTHON_ADAPTER_CLOSE_FAILURE',file=sys.stderr)
   else: raise
 if len(raw)>4096 or hashlib.sha256(raw).hexdigest()!=digest: raise RuntimeError('FULL_PYTHON_ADAPTER_PIN')
 mapped=[adapter if command[0]=='python3' else os.path.join(os.path.dirname(adapter),'vpython3.bat'),*effective[1:]]
 return dispatch(mapped,*args,**kwargs)
def admitted(self):
 previous=getattr(scope,'active',False);previous_hook=getattr(scope,'hook',None)
 original_action=self.action;apache_guard=self.name=='apache_win32';failed=False
 scope.active=True;scope.hook=self
 try: return original(self)
 except BaseException:failed=True;raise
 finally:
  scope.active=previous;scope.hook=previous_hook
  if not failed and apache_guard and (self.name!='apache_win32' or self.condition!='checkout_win' or self.pattern!=chr(92)+'.sha1' or self.action is not original_action or tuple(self.action)!=apache_action):raise RuntimeError('FULL_HOOK_APACHE_POSTCHECK')
gclient.Hook.run=admitted
gclient.gclient_utils.CheckCallAndFilter=admitted_dispatch
sys.exit(gclient.main(['runhooks','--jobs','2']))
`,
    depot,
    adapter,
    pin.sha256,
    "__SORNG_BOOTSTRAP_WITNESS__",
    "__SORNG_BOOTSTRAP_GUARD__",
  ];
}

export function validateHookProjection(text) {
  need(Buffer.byteLength(text) <= 4 * 1024 ** 2, "FULL_HOOK_PROJECTION_BOUND");
  const lines = text.trimEnd().split(/\r?\n/),
    packets = lines.filter((line) => line.startsWith("FULL_HOOK_PROJECTION:"));
  need(
    packets.length === 1 && lines.at(-1) === packets[0],
    "FULL_HOOK_PROJECTION_PACKET",
  );
  const result = JSON.parse(packets[0].slice("FULL_HOOK_PROJECTION:".length));
  keys(result, ["kind", "hooks", "origins"]);
  need(
    result.kind === "windows-arm-hook-projection" &&
      Array.isArray(result.hooks) &&
      result.hooks.length <= 512 &&
      Array.isArray(result.origins) &&
      result.origins.length > 0 &&
      result.origins.length <= 1024,
    "FULL_HOOK_PROJECTION_FIELDS",
  );
  const relative = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[A-Za-z0-9_./+-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git",
      );
  for (const hook of result.hooks) {
    keys(hook, ["kind", "name", "condition", "pattern", "cwd", "action"]);
    need(
      ["hooks", "pre_deps_hooks"].includes(hook.kind) &&
        [hook.name, hook.condition, hook.pattern].every(
          (value) =>
            value === null ||
            (typeof value === "string" &&
              value.length <= 4096 &&
              !/[\0\r\n]/.test(value)),
        ) &&
        (hook.cwd === "." || relative(hook.cwd)) &&
        Array.isArray(hook.action) &&
        hook.action.length > 0 &&
        hook.action.length <= 64 &&
        hook.action.every(
          (value) =>
            typeof value === "string" &&
            value.length <= 4096 &&
            !/[\0\r\n]/.test(value),
        ),
      "FULL_HOOK_PROJECTION_ACTION",
    );
  }
  const seen = new Set();
  for (const origin of result.origins) {
    keys(origin, ["url", "deps_file", "hierarchy"]);
    need(
      typeof origin.url === "string" &&
        /^https:\/\/[^\s@]+@[a-f0-9]{40}$/.test(origin.url) &&
        relative(origin.deps_file) &&
        Array.isArray(origin.hierarchy) &&
        origin.hierarchy.length > 0 &&
        origin.hierarchy.length <= 64 &&
        origin.hierarchy.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            relative(pair[0]) &&
            typeof pair[1] === "string" &&
            pair[1].length <= 4096,
        ),
      "FULL_HOOK_PROJECTION_ORIGIN",
    );
    const filename = `${origin.hierarchy.at(-1)[0]}/${origin.deps_file}`;
    need(!seen.has(filename.toLowerCase()), "FULL_HOOK_PROJECTION_DUPLICATE");
    seen.add(filename.toLowerCase());
  }
  return result;
}

export async function retainHookOrigins(file, projection, budget, limits) {
  const witness = Buffer.from(
    "FULL_HOOK_ORIGIN_PINS:" + JSON.stringify(projection) + "\n",
  );
  need(
    witness.length <= 4 * 1024 ** 2 &&
      limits.bytes + witness.length <= limits.cap,
    "FULL_HOOK_PROJECTION_BOUND",
  );
  await held(file, 4 * 1024 ** 2, budget);
  const before = await fs.lstat(file, { bigint: true });
  const fd = await fs.open(file, "a");
  let failed = false;
  try {
    const descriptor = await fd.stat({ bigint: true });
    need(shared(descriptor) === shared(before), "FULL_HOOK_LOG_IDENTITY");
    budget.remaining();
    need(
      (await fd.write(witness)).bytesWritten === witness.length,
      "FULL_HOOK_LOG_WRITE",
    );
    const after = await fd.stat({ bigint: true });
    need(
      after.dev === descriptor.dev &&
        after.ino === descriptor.ino &&
        after.nlink === 1n &&
        after.size === before.size + BigInt(witness.length) &&
        shared(after) === shared(await fs.lstat(file, { bigint: true })),
      "FULL_HOOK_LOG_CHANGED",
    );
    budget.remaining();
    limits.bytes += witness.length;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      sourceCloseFailure = true;
      if (!failed) throw error;
    }
  }
}

// Diagnostics only: fixed policy metadata, no enumeration, file reads or admission.
const GIT_DIAGNOSTIC_FIELDS = Object.freeze([
  "dev",
  "ino",
  "size",
  "mtimeNs",
  "ctimeNs",
  "birthtimeNs",
  "mode",
  "nlink",
]);
const GIT_DIAGNOSTIC_CODES = new Set([
  "SOURCE_GIT_POLICY_ALIAS",
  "SOURCE_GIT_POLICY_LINK",
  "SOURCE_GIT_POLICY_FILE",
  "SOURCE_GIT_POLICY_IDENTITY",
  "SOURCE_GIT_POLICY_CHANGED",
  "SOURCE_GIT_POLICY_DIRECTORY",
  "SOURCE_GIT_POLICY_HOOKS",
  "SOURCE_GIT_POLICY_CAPABILITY",
  "SOURCE_GIT_ENVIRONMENT_VALUE",
]);
export async function gitPolicyMetadata(root, budget) {
  const rows = [];
  for (const [role, name] of [
    ["root", ""],
    ["home", "home"],
    ["xdg", "xdg"],
    ["hooks", "hooks"],
    ["global", "global.gitconfig"],
    ["system", "system.gitconfig"],
  ]) {
    try {
      budget.remaining();
      const stat = await fs.lstat(path.join(root, name), { bigint: true });
      rows.push({
        role,
        type: stat.isSymbolicLink()
          ? "link"
          : stat.isDirectory()
            ? "directory"
            : stat.isFile()
              ? "file"
              : "other",
        fields: GIT_DIAGNOSTIC_FIELDS.map((key) =>
          typeof stat[key] === "bigint" ? stat[key].toString() : null,
        ),
      });
    } catch {
      rows.push({ role, type: "unavailable", fields: null });
    }
  }
  return rows;
}
// Closed candidate metadata only. Ancestors are checked from the volume root,
// and rechecked around each lstat; no contents, enumeration or realpath follows.
const GIT_HOME_CANDIDATES = Object.freeze([
  ["config", ".config"],
  ["auth-parent", ".config/chrome_infra"],
  ["auth", ".config/chrome_infra/auth"],
  ["auth-tokens", ".config/chrome_infra/auth/tokens.json"],
  ["auth-credentials", ".config/chrome_infra/auth/creds.json"],
  ["cache", ".cache"],
]);
const gitDiagnosticIdentity = (stat) => {
  const fields = ["dev", "ino", "birthtimeNs", "mode", "nlink"];
  return fields.every((key) => typeof stat[key] === "bigint") &&
    stat.nlink > 0n &&
    stat.birthtimeNs >= 0n
    ? fields.map((key) => stat[key].toString()).join(":")
    : null;
};
export async function gitHomeCandidateMetadata(root, budget, previous) {
  const rows = [],
    anchors = new Map();
  let trustedHome = false;
  const blocked = (role) => ({ role, type: "blocked", fields: null });
  // No successful authoritative baseline means no candidate queries.
  if (
    previous === null ||
    (previous !== undefined && previous.trustedHome !== true) ||
    !path.isAbsolute(root) ||
    path.resolve(root) !== root
  )
    return {
      rows: GIT_HOME_CANDIDATES.map(([role]) => blocked(role)),
      anchors,
      trustedHome,
    };
  const readStat = async (file) => {
    budget.remaining();
    try {
      return { stat: await fs.lstat(file, { bigint: true }) };
    } catch (error) {
      return { absent: error?.code === "ENOENT" };
    }
  };
  const directory = async (file) => {
    const { stat } = await readStat(file);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return false;
    const identity = gitDiagnosticIdentity(stat);
    if (
      identity === null ||
      (previous?.anchors.has(file) &&
        previous.anchors.get(file) !== identity) ||
      (anchors.has(file) && anchors.get(file) !== identity)
    )
      return false;
    anchors.set(file, identity);
    return true;
  };
  for (const [role, name] of GIT_HOME_CANDIDATES) {
    const file = path.join(root, "home", name),
      parents = [];
    for (let at = path.dirname(file); ; at = path.dirname(at)) {
      parents.unshift(at);
      if (path.dirname(at) === at) break;
      need(parents.length < 64, "FULL_GIT_DIAGNOSTIC_ANCESTORS");
    }
    const checkParents = async () => {
      for (const parent of parents)
        if (!(await directory(parent))) return false;
      return true;
    };
    if (!(await checkParents())) {
      rows.push(blocked(role));
      continue;
    }
    if (role === "config" || role === "cache") trustedHome = true;
    const { stat, absent } = await readStat(file);
    if (!(await checkParents())) {
      rows.push(blocked(role));
      continue;
    }
    if (!stat) {
      rows.push({
        role,
        type: absent ? "absent" : "unavailable",
        fields: null,
      });
      continue;
    }
    const type = stat.isSymbolicLink()
      ? "link"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other";
    const identity = gitDiagnosticIdentity(stat);
    if (
      identity === null ||
      (previous?.anchors.has(file) &&
        previous.anchors.get(file) !== identity) ||
      (anchors.has(file) && anchors.get(file) !== identity)
    ) {
      rows.push(blocked(role));
      continue;
    }
    if (type === "directory") anchors.set(file, identity);
    rows.push({
      role,
      type,
      fields: GIT_DIAGNOSTIC_FIELDS.map((key) =>
        typeof stat[key] === "bigint" ? stat[key].toString() : null,
      ),
    });
  }
  return { rows, anchors, trustedHome };
}
export function gitPolicyDiagnostic(error, before, after) {
  let code = "UNCLASSIFIED";
  try {
    const message = error?.message;
    if (GIT_DIAGNOSTIC_CODES.has(message)) code = message;
  } catch {
    /* No raw exception data. */
  }
  return {
    kind: "windows-arm-source-git-policy-diagnostic",
    success: false,
    code,
    fields: GIT_DIAGNOSTIC_FIELDS,
    rows: after.map((row, index) => {
      const prior = before?.[index] ?? { type: "unavailable", fields: null };
      return {
        role: row.role,
        beforeType: prior.type,
        afterType: row.type,
        before: prior.fields,
        after: row.fields,
        changed:
          prior.fields && row.fields
            ? GIT_DIAGNOSTIC_FIELDS.filter(
                (key, field) =>
                  !(
                    process.platform === "win32" &&
                    row.type === "directory" &&
                    prior.type === "directory" &&
                    key === "size"
                  ) && prior.fields[field] !== row.fields[field],
              )
            : null,
        typeChanged: prior.type !== row.type,
      };
    }),
  };
}
export async function appendGitPolicyDiagnostic(file, report, budget, limits) {
  const bytes = Buffer.from(
    "SOURCE_GIT_DIAGNOSTIC:" + JSON.stringify(report) + "\n",
  );
  need(bytes.length <= 8192, "FULL_GIT_DIAGNOSTIC_BOUND");
  budget.remaining();
  need(
    Number.isSafeInteger(limits.bytes) &&
      limits.bytes >= 0 &&
      limits.cap === 64 * 1024 ** 2 &&
      limits.bytes + bytes.length <= limits.cap,
    "FULL_SOURCE_OUTPUT_BOUND",
  );
  // Charge before any I/O, including failed retention. No refund or new ledger.
  limits.bytes += bytes.length;
  await physical(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size >= 0n &&
      before.size <= BigInt(limits.cap),
    "FULL_GIT_DIAGNOSTIC_FILE",
  );
  budget.remaining();
  const fd = await fs.open(
    file,
    constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
  );
  let failed = false;
  try {
    const descriptor = await fd.stat({ bigint: true });
    need(
      descriptor.isFile() && shared(descriptor) === shared(before),
      "FULL_GIT_DIAGNOSTIC_IDENTITY",
    );
    budget.remaining();
    need(
      (await fd.write(bytes)).bytesWritten === bytes.length,
      "FULL_GIT_DIAGNOSTIC_WRITE",
    );
    const after = await fd.stat({ bigint: true });
    const pathAfter = await fs.lstat(file, { bigint: true });
    need(
      pathAfter.isFile() &&
        !pathAfter.isSymbolicLink() &&
        after.dev === descriptor.dev &&
        after.ino === descriptor.ino &&
        after.birthtimeNs === descriptor.birthtimeNs &&
        after.nlink === 1n &&
        after.mode === descriptor.mode &&
        after.size === before.size + BigInt(bytes.length) &&
        shared(after) === shared(pathAfter),
      "FULL_GIT_DIAGNOSTIC_CHANGED",
    );
    await physical(file);
    budget.remaining();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      sourceCloseFailure = true;
      if (!failed) throw error;
    }
  }
}
// Nonrecursive, advisory notifications only. Names never become filesystem paths.
export async function observeGitHome(root, budget) {
  need(path.basename(root) === "cef-source-git-policy", "FULL_HOME_WATCH_ROOT");
  const home = path.join(root, "home"),
    anchors = [root, home];
  const identities = async () => {
    const rows = [];
    for (const file of anchors) {
      budget.remaining();
      await physical(file);
      const stat = await fs.lstat(file, { bigint: true });
      const identity = gitDiagnosticIdentity(stat);
      need(
        stat.isDirectory() && !stat.isSymbolicLink() && identity !== null,
        "FULL_HOME_WATCH_IDENTITY",
      );
      rows.push(identity);
    }
    return rows;
  };
  const before = await identities();
  let armed = false,
    closed = false,
    closeRequested = false,
    failed = false,
    first,
    notifications = 0,
    overflow = false,
    finishPromise;
  const rows = [];
  const fail = (error) => {
    if (!failed) {
      failed = true;
      first = error;
    }
  };
  const watcher = watch(
    home,
    { recursive: false, persistent: false, encoding: "buffer" },
    (kind, name) => {
      if (!armed || closeRequested) return;
      notifications = Math.min(17, notifications + 1);
      if (rows.length === 16) {
        overflow = true;
        return;
      }
      const available = Buffer.isBuffer(name),
        size = available ? name.length : null;
      const bounded = available && size <= 1024;
      rows.push({
        kind: kind === "rename" || kind === "change" ? kind : "unknown",
        nameBytes: bounded ? size : null,
        nameOversized: available && size > 1024,
        nameSha256: bounded ? sha(name) : null,
        role: !bounded
          ? "unavailable"
          : name.equals(Buffer.from(".config"))
            ? "config"
            : name.equals(Buffer.from(".cache"))
              ? "cache"
              : "other",
      });
    },
  );
  let resolveClose;
  const closure = new Promise((resolve) => {
    resolveClose = resolve;
  });
  watcher.once("close", () => {
    closed = true;
    armed = false;
    resolveClose();
  });
  watcher.on("error", () => fail(new Error("FULL_HOME_WATCH_ERROR")));
  const snapshot = () => ({
    kind: "windows-arm-source-home-events",
    stage: "sync",
    capturedEventsOnly: true,
    observationComplete: false,
    watcherClosed: closed,
    observerError: failed,
    notificationsSaturatedAt: 17,
    notifications,
    overflow,
    omittedForReport: 0,
    rows: rows.map((row) => ({ ...row })),
  });
  const finish = () =>
    (finishPromise ??= (async () => {
      closeRequested = true;
      armed = false;
      let timer;
      try {
        // Request closure even if the original operation deadline has expired.
        try {
          watcher.close();
        } catch (error) {
          fail(error);
        }
        const remaining = Math.floor(
          Math.min(5000, budget.remaining() - 120000),
        );
        need(remaining > 0, "FULL_HOME_WATCH_CLOSE_UNKNOWN");
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("FULL_HOME_WATCH_CLOSE_UNKNOWN")),
            remaining,
          );
        });
        await Promise.race([closure, timeout]);
        budget.remaining();
        need(closed, "FULL_HOME_WATCH_CLOSE_UNKNOWN");
      } catch (error) {
        fail(error);
      } finally {
        clearTimeout(timer);
      }
      if (failed) throw first;
      return snapshot();
    })());
  try {
    const after = await identities();
    need(
      before.every((identity, index) => identity === after[index]) && !closed,
      "FULL_HOME_WATCH_CHANGED",
    );
    if (failed) throw first;
    armed = true;
    return { snapshot, finish };
  } catch (error) {
    try {
      await finish();
    } catch {
      /* Startup's exact first fault wins. */
    }
    throw error;
  }
}
function withGitHomeEvents(report, events) {
  if (!events) return report;
  const result = {
    ...report,
    homeEvents: { ...events, rows: [...events.rows] },
  };
  while (
    Buffer.byteLength(
      "SOURCE_GIT_DIAGNOSTIC:" + JSON.stringify(result) + "\n",
    ) > 8192 &&
    result.homeEvents.rows.length
  ) {
    result.homeEvents.rows.pop();
    result.homeEvents.omittedForReport++;
  }
  return result; // The existing append bound still denies an oversized base report.
}
export function gitPolicyVerifier(
  root,
  file,
  budget,
  limits,
  verify,
  homeEvents,
) {
  let baseline = null,
    baselineHome = null,
    reported = false;
  return async () => {
    try {
      const result = await verify();
      // Only a successful authoritative verification can refresh the baseline.
      baseline = await gitPolicyMetadata(root, budget);
      baselineHome = await gitHomeCandidateMetadata(root, budget);
      return result;
    } catch (error) {
      if (!reported) {
        reported = true; // First fault only, even if capture/append/close fails.
        try {
          const current = await gitPolicyMetadata(root, budget);
          const home = await gitHomeCandidateMetadata(
            root,
            budget,
            baselineHome,
          );
          await appendGitPolicyDiagnostic(
            file,
            withGitHomeEvents(
              {
                ...gitPolicyDiagnostic(error, baseline, current),
                homeCandidates: gitPolicyDiagnostic(
                  null,
                  baselineHome?.rows,
                  home.rows,
                ).rows,
              },
              homeEvents?.(),
            ),
            budget,
            limits,
          );
        } catch {
          sourceReportingFailure = true;
        }
      }
      throw error; // Includes null/0/undefined; retention never replaces this value.
    }
  };
}

// Run the real pinned selector. Its returned path and bytes must match the one
// already admitted by the driver; its other candidates and PATH never execute.
export function boundGnArguments(hooks, expected, pin) {
  need(
    Number.isSafeInteger(pin.bytes) &&
      pin.bytes > 0 &&
      pin.bytes <= 16 * 1024 ** 2 &&
      /^[a-f0-9]{64}$/.test(pin.sha256),
    "FULL_GN_PIN",
  );
  const runner = `import sys,os,hashlib,stat
script,expected,size,digest=sys.argv[1:5]
sys.path.insert(0,os.path.dirname(script))
import gn
select=gn.FindGnTool
def admitted():
 candidate=select()
 if candidate is None or os.path.normcase(os.path.abspath(candidate))!=os.path.normcase(os.path.abspath(expected)): raise RuntimeError('FULL_GN_SELECTOR')
 at=os.path.abspath(candidate)
 while True:
  if os.path.islink(at) or os.path.realpath(at).lower()!=at.lower(): raise RuntimeError('FULL_GN_SELECTOR_ALIAS')
  parent=os.path.dirname(at)
  if parent==at: break
  at=parent
 before=os.stat(candidate,follow_symlinks=False)
 if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size!=int(size): raise RuntimeError('FULL_GN_SELECTOR_FILE')
 def shared(s):
  birth=getattr(s,'st_birthtime_ns',None)
  if os.name=='nt' and (type(birth) is not int or birth<0): raise RuntimeError('FULL_GN_SELECTOR_BIRTH')
  return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,hasattr(s,'st_birthtime_ns'),birth,s.st_nlink)
 signature=lambda s:(*shared(s),s.st_ctime_ns,s.st_mode)
 source=open(candidate,'rb')
 failed=False
 try:
  held=os.fstat(source.fileno())
  if shared(held)!=shared(before): raise RuntimeError('FULL_GN_SELECTOR_CHANGED')
  actual=hashlib.sha256(source.read(int(size)+1)).hexdigest()
  after=os.fstat(source.fileno())
  path_after=os.stat(candidate,follow_symlinks=False)
  if actual!=digest or signature(held)!=signature(after) or signature(before)!=signature(path_after) or shared(after)!=shared(path_after): raise RuntimeError('FULL_GN_SELECTOR_PIN')
 except BaseException:
  failed=True
  raise
 finally:
  try: source.close()
  except BaseException:
   if not failed: raise
 return candidate
gn.FindGnTool=admitted
sys.exit(gn.main([script,*sys.argv[5:]]))
`;
  return [
    "-B",
    "-c",
    `import os,runpy,sys
hook,gn,expected,size,digest=sys.argv[1:]
sys.path.insert(0,os.path.dirname(hook))
# BEGIN fixed ARM64 GN argument projection
import hashlib,inspect,stat,types
gn_projection_path=os.path.abspath(os.path.join(os.path.dirname(hook),'gn_args.py'))
def gn_projection_pin():
 if os.path.normcase(os.path.realpath(gn_projection_path))!=os.path.normcase(gn_projection_path):raise RuntimeError('FULL_GN_PROJECTION_SOURCE')
 before=os.stat(gn_projection_path,follow_symlinks=False)
 if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size!=26541:raise RuntimeError('FULL_GN_PROJECTION_SOURCE')
 with open(gn_projection_path,'rb') as source:
  held=os.fstat(source.fileno());raw=source.read(26542);after=os.fstat(source.fileno())
 current=os.stat(gn_projection_path,follow_symlinks=False)
 def shared(s):
  birth=getattr(s,'st_birthtime_ns',None)
  if os.name=='nt' and (type(birth)is not int or birth<0):raise RuntimeError('FULL_GN_PROJECTION_SOURCE')
  return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,hasattr(s,'st_birthtime_ns'),birth,s.st_nlink)
 signature=lambda s:(*shared(s),s.st_ctime_ns,s.st_mode)
 if shared(before)!=shared(held) or signature(held)!=signature(after) or signature(before)!=signature(current) or shared(after)!=shared(current) or hashlib.sha256(raw).hexdigest()!='ab94e3b3c214198b396c8b4858b5d5e9cb42be956bbc294d651dd86eac44df6e':raise RuntimeError('FULL_GN_PROJECTION_SOURCE')
gn_projection_pin()
import gn_args
if os.path.abspath(gn_args.__file__)!=gn_projection_path or gn_args.platform!='windows' or gn_args.machine!='amd64':raise RuntimeError('FULL_GN_PROJECTION_SOURCE')
for name,digest in [('MergeDicts','50de766f8b38c15b93ca8c80e500f5974ce7c7c4af3ddb568f63ba6f4a4691fc'),('GetConfigArgs','f2ade37bcfc944b5385dfc23e848344bc6f9d9606063708ea58b00eb678c5ddd'),('GetAllPlatformConfigs','608d1c5ffb0e793e97c67db19af0fe0a14c9248d548ac5edde79c09c0ec34cb3')]:
 function=getattr(gn_args,name)
 if type(function)is not types.FunctionType or function.__globals__ is not gn_args.__dict__ or os.path.abspath(function.__code__.co_filename)!=gn_projection_path or hashlib.sha256(inspect.getsource(function).encode('utf8')).hexdigest()!=digest:raise RuntimeError('FULL_GN_PROJECTION_FUNCTION')
gn_projection_pin()
gn_projection_fixed=dict(alternate_cdm_storage_id_key='968b476909da4373b08903c28e859454',blink_symbol_level=0,chrome_pgo_phase=0,clang_use_chrome_plugins=False,enable_background_mode=False,enable_backup_ref_ptr_instance_tracer=False,enable_cdm_host_verification=True,enable_cdm_storage_id=True,enable_downgrade_processing=False,enable_precompiled_headers=False,enable_resource_allowlist_generation=False,enable_rlz=True,enable_widevine=True,is_component_build=False,is_debug=False,optimize_webui=True,symbol_level=1,target_cpu='arm64',use_remoteexec=False,use_siso=True,v8_symbol_level=0,host_cpu='x64',is_clang=True,use_lld=True)
def gn_projection_rows(value):
 if type(value)is not dict or any(type(k)is not str or type(v)not in (str,bool,int) for k,v in value.items()):raise RuntimeError('FULL_GN_PROJECTION_SHAPE')
 return sorted((k,type(v).__name__,v) for k,v in value.items())
gn_projection_native=gn_args.GetAllPlatformConfigs
gn_projection_calls=0
def gn_projection_configs(build_args,quiet=False):
 global gn_projection_calls
 if gn_projection_calls!=0 or quiet is not False or os.environ.get('GN_OUT_CONFIGS')!='Release_GN_arm64' or os.environ.get('CEF_ENABLE_ARM64')!='1':raise RuntimeError('FULL_GN_PROJECTION_SELECTION')
 if gn_projection_rows(gn_args.GetGNEnvArgs())!=gn_projection_rows(gn_projection_fixed):raise RuntimeError('FULL_GN_PROJECTION_ARGUMENTS')
 root=os.path.abspath(os.path.join(os.path.dirname(hook),'../../../..'))
 sdk=dict(visual_studio_path=os.environ.get('GYP_MSVS_OVERRIDE_PATH'),visual_studio_version=os.environ.get('GYP_MSVS_VERSION'),visual_studio_runtime_dirs=os.environ.get('VS_CRT_ROOT'),windows_sdk_path=os.environ.get('SDK_ROOT'),windows_sdk_version=os.environ.get('SDK_VERSION'))
 if any(type(v)is not str for v in sdk.values()) or sdk['visual_studio_version']!='2026' or sdk['windows_sdk_version']!='10.0.28000.0':raise RuntimeError('FULL_GN_PROJECTION_SDK')
 for key,relative in [('visual_studio_path','custom-vs'),('visual_studio_runtime_dirs','runtime/x64'),('windows_sdk_path','Windows Kits/10')]:
  if os.path.normcase(os.path.abspath(sdk[key]))!=os.path.normcase(os.path.join(root,*relative.split('/'))):raise RuntimeError('FULL_GN_PROJECTION_SDK')
 if gn_projection_rows(build_args)!=gn_projection_rows(sdk):raise RuntimeError('FULL_GN_PROJECTION_INPUT')
 before=gn_projection_rows(build_args)
 gn_projection_calls+=1
 # The unchanged native generator computes its six configurations and filters.
 native=gn_projection_native(build_args,quiet)
 if gn_projection_rows(build_args)!=before or gn_projection_rows(gn_args.GetGNEnvArgs())!=gn_projection_rows(gn_projection_fixed):raise RuntimeError('FULL_GN_PROJECTION_INPUT')
 if type(native)is not dict or list(native)!=['Release_GN_arm64']:raise RuntimeError('FULL_GN_PROJECTION_OUTPUT')
 expected=dict(gn_projection_fixed,**sdk);expected['enable_backup_ref_ptr_instance_tracer']=True
 if gn_projection_rows(native['Release_GN_arm64'])!=gn_projection_rows(expected):raise RuntimeError('FULL_GN_PROJECTION_OUTPUT')
 gn_projection_pin()
 # Return a fresh projection; neither native input nor native output is mutated.
 projected=dict(native['Release_GN_arm64']);projected['enable_backup_ref_ptr_instance_tracer']=False
 if gn_projection_rows(projected)!=gn_projection_rows(dict(gn_projection_fixed,**sdk)):raise RuntimeError('FULL_GN_PROJECTION_OUTPUT')
 return {'Release_GN_arm64':projected}
gn_args.GetAllPlatformConfigs=gn_projection_configs
# END fixed ARM64 GN argument projection
import gclient_util
original=gclient_util.RunAction
def reviewed_action(directory,command):
 if command and command[0]=='gn':
  if gn_projection_calls!=1:raise RuntimeError('FULL_GN_PROJECTION_COMPLETION')
  if len(command)<3 or command[1]!='gen': raise RuntimeError('FULL_GN_COMMAND')
  command=[sys.executable,'-B','-c',${JSON.stringify(runner)},gn,expected,size,digest,*command[1:]]
 return original(directory,command)
gclient_util.RunAction=reviewed_action
sys.argv=[hook]
runpy.run_path(hook,run_name='__main__')
# BEGIN fixed ARM64 GN projection completion
if gn_projection_calls!=1:raise RuntimeError('FULL_GN_PROJECTION_COMPLETION')
gn_projection_pin()
print('{"schemaVersion":1,"kind":"windows-arm-fixed-gn-argument-projection","nativeGeneratorCalled":true,"selectedConfiguration":"Release_GN_arm64","projectedArgument":"enable_backup_ref_ptr_instance_tracer","nativeValue":true,"projectedValue":false,"vendorSourceModified":false}')
# END fixed ARM64 GN projection completion
`,
    hooks[3],
    hooks[4],
    expected,
    String(pin.bytes),
    pin.sha256,
  ];
}

// All top-level subprocesses are constructed here; callers cannot supply argv,
// cwd, target, compiler target, extra GN flags or environment overrides.
export function sourceCommands(root, p, hooks, contextPin) {
  const files = sourcePaths(root, p),
    tools = reviewedHostTools(p),
    python = p.python.path;
  need(
    Array.isArray(hooks) &&
      hooks.length === 5 &&
      hooks[0] === "-B" &&
      hooks[1] === "-c" &&
      typeof hooks[2] === "string" &&
      hooks[3] === path.join(files.cef, "tools/gclient_hook.py") &&
      hooks[4] === path.join(files.depot, "gn.py"),
    "FULL_HOOK_COMMAND",
  );
  need(/^[a-f0-9]{64}$/.test(contextPin), "FULL_CONTEXT_PIN");
  return Object.freeze(
    [
      {
        role: "sync",
        executable: python,
        cwd: files.workspace,
        args: [
          "-I",
          "-B",
          path.join(files.commands, "source_bootstrap.py"),
          "--prepare-sync",
          "--guard-sha",
          sha(bootstrapProgram(root, p, contextPin)),
          "--jobs",
          "2",
          "--nohooks",
          "--noprehooks",
          "--no-history",
          "--revision",
          `src@${p.sourceChromium}`,
        ],
      },
      {
        role: "hook-projection",
        executable: python,
        cwd: files.workspace,
        args: hookProjectionArguments(files.depot, files.commands),
      },
      {
        role: "dependency-hooks",
        executable: python,
        cwd: files.workspace,
        args: dependencyHookArguments(
          files.depot,
          path.join(files.commands, "python3.bat"),
          { sha256: sha(python3Adapter(python)) },
        ),
      },
      ...["x86", "x64", "arm64"].map((cpu) => ({
        role: `setup-${cpu}`,
        executable: python,
        cwd: root,
        args: [
          "-I",
          "-B",
          path.join(files.chromium, "build/toolchain/win/setup_toolchain.py"),
          path.join(root, "custom-vs"),
          path.join(root, "Windows Kits/10"),
          path.join(root, "runtime/x64"),
          "win",
          cpu,
          `environment.${cpu}`,
        ],
      })),
      {
        role: "verify-setup",
        executable: python,
        cwd: root,
        args: [
          "-I",
          "-B",
          path.join(HERE, "producer.py"),
          "--verify-source-setup",
          root,
          contextPin,
          "--execute",
        ],
      },
      {
        role: "cef-gn",
        executable: python,
        cwd: files.chromium,
        args: [...hooks],
      },
    ].map((value) =>
      Object.freeze({
        ...value,
        args: Object.freeze(value.args),
        gitAuthority: tools.git.sha256,
      }),
    ),
  );
}

export function sourceEnvironment(root, p, recipe) {
  const files = sourcePaths(root, p),
    tools = reviewedHostTools(p);
  need(
    recipe.requiredHost === "win32" &&
      recipe.target === TARGET &&
      recipe.commands.length === 3 &&
      recipe.commands[0].args.length === 1 &&
      recipe.commands[0].args[0] === "cef/tools/gclient_hook.py",
    "FULL_RECIPE",
  );
  return {
    SystemRoot: "C:/Windows",
    WINDIR: "C:/Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    PATH: [
      files.commands,
      files.depot,
      path.dirname(p.python.path),
      path.dirname(tools.git.path),
      path.join(root, "llvm/bin"),
      path.join(root, "Windows Kits/10/bin", p.sdkVersion, "x64"),
      path.join(root, "runtime/x64"),
      "C:/Windows/System32/WindowsPowerShell/v1.0",
      "C:/Windows/System32",
      "C:/Windows",
    ].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    USERPROFILE: path.join(root, "home"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: "",
    DEPOT_TOOLS_UPDATE: "0",
    DEPOT_TOOLS_WIN_TOOLCHAIN: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GYP_MSVS_OVERRIDE_PATH: path.join(root, "custom-vs"),
    LOCALAPPDATA: path.join(root, "source-caches/local"),
    APPDATA: path.join(root, "source-caches/roaming"),
    XDG_CACHE_HOME: path.join(root, "source-caches/xdg"),
    CIPD_CACHE_DIR: path.join(root, "source-caches/cipd"),
    VPYTHON_VIRTUALENV_ROOT: path.join(root, "source-caches/vpython"),
    CIPD_CONFIG_FILE: path.join(root, "source-caches/cipd.cfg"),
    GYP_MSVS_VERSION: "2026",
    CEF_VCVARS: "none",
    CEF_ENABLE_ARM64: "1",
    WIN_CUSTOM_TOOLCHAIN: "1",
    VS_CRT_ROOT: path.join(root, "runtime/x64"),
    SDK_ROOT: path.join(root, "Windows Kits/10"),
    SDK_VERSION: p.sdkVersion,
    ...recipe.environment,
  };
}

export function validateGeneratedArguments(raw) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1024 ** 2,
    "FULL_GN_ARGS_BOUND",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  need(!text.includes("\0"), "FULL_GN_ARGS_ENCODING");
  const expected = {
    target_cpu: '"arm64"',
    host_cpu: '"x64"',
    is_clang: "true",
    use_lld: "true",
    use_remoteexec: "false",
    use_siso: "true",
    is_component_build: "false",
    is_debug: "false",
    enable_backup_ref_ptr_instance_tracer: "false",
  };
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z][a-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    if (Object.hasOwn(expected, match[1])) {
      need(
        !seen.has(match[1]) && match[2] === expected[match[1]],
        "FULL_GN_CRITICAL_ARGUMENT",
      );
      seen.set(match[1], match[2]);
    }
    if (/sandbox/.test(match[1]))
      need(match[2] === "true", "FULL_GN_SANDBOX_ARGUMENT");
  }
  need(seen.size === Object.keys(expected).length, "FULL_GN_CRITICAL_ARGUMENT");
  return {
    targetCpu: "arm64",
    hostCpu: "x64",
    criticalArgumentsVerified: true,
    instanceTracer: false,
    remoteExecution: false,
    generatedSecurityHeadersVerified: false,
    compilerAdmission: false,
  };
}

async function sourceStage(root, budget, stage, maximumSeconds, action) {
  need(
    (stage === "source-acquisition" && maximumSeconds === 4500) ||
      (stage === "source-hooks-gn" && maximumSeconds === 1800),
    "FULL_SOURCE_STAGE",
  );
  const allowed = Math.min(maximumSeconds * 1000, budget.remaining() - 120000);
  need(allowed > 0, "FULL_SOURCE_RESERVE");
  const began = performance.now();
  const timer = setTimeout(
    () => {
      const report = {
        kind: "windows-arm-source-stage-deadline",
        success: false,
        stage,
        firstFailure: "FULL_SOURCE_STAGE_DEADLINE",
        compilerExecuted: null,
        engineCompilationRequested: false,
        sdkBuilt: false,
        cleanupNotInferred: true,
      };
      try {
        writeFileSync(
          path.join(root, "source-deadline-result.json"),
          JSON.stringify(report) + "\n",
          { flag: "wx" },
        );
      } catch {
        sourceReportingFailure = true;
        try {
          writeSync(
            2,
            Buffer.from(
              JSON.stringify({
                ...report,
                reportingFailure: "FULL_SOURCE_REPORT",
              }) + "\n",
            ),
          );
        } catch {
          /* Preserve the deadline. */
        }
      }
      process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.
    },
    Math.max(1, allowed),
  );
  try {
    const result = await action();
    budget.remaining();
    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function executeCommand(
  command,
  expected,
  env,
  files,
  budget,
  limits,
  capture,
  bootstrap,
) {
  need(expected.includes(command), "FULL_COMMAND_IDENTITY");
  const observedPhase = {
    sync: "gclient-sync",
    "hook-projection": "hook-plan",
    "dependency-hooks": "runhooks",
    "setup-x86": "setup-x86",
    "setup-x64": "setup-x64",
    "setup-arm64": "setup-arm64",
    "cef-hooks": "cef-hook",
    "cef-gn": "cef-gn",
  }[command.role];
  if (observedPhase) currentProgress?.phase(observedPhase);
  budget.remaining();
  const descriptors = [];
  const observer =
    bootstrap && command.role === "sync"
      ? bootstrapObserver(bootstrap.value, bootstrap.contextSha)
      : null;
  const childArgs = bootstrap
    ? bindBootstrapVector(command, bootstrap.value)
    : command.args;
  let child,
    timer,
    primary,
    failed = false,
    logsClosed = false,
    reportingFailed = false,
    reportingError,
    bytes = 0;
  try {
    const output = openSync(
      path.join(files.logs, `${command.role}.stdout.log`),
      "wx",
    );
    descriptors.push(output);
    const errorOutput = openSync(
      path.join(files.logs, `${command.role}.stderr.log`),
      "wx",
    );
    descriptors.push(errorOutput);
    if (bootstrap && childArgs !== command.args) {
      const record = Buffer.from(
        "FULL_BOOTSTRAP_VECTOR_BINDING:" +
          JSON.stringify({
            role: command.role,
            witnessSha: bootstrap.value.witnessPin.sha256,
            guardSha: bootstrap.value.pin.sha256,
          }) +
          "\n",
      );
      need(
        limits.bytes + record.length <= limits.cap,
        "FULL_SOURCE_OUTPUT_BOUND",
      );
      need(
        writeSync(output, record) === record.length,
        "FULL_SOURCE_LOG_WRITE",
      );
      limits.bytes += record.length;
    }
    const text = [];
    const outcome = await new Promise((resolve, reject) => {
      const deny = (error) => {
        if (!failed) {
          failed = true;
          primary = error;
        }
        reject(primary);
      };
      child = spawn(command.executable, childArgs, {
        cwd: command.cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const [stream, fd] of [
        [child.stdout, output],
        [child.stderr, errorOutput],
      ]) {
        stream.once("error", deny);
        stream.on("data", (chunk) => {
          try {
            currentProgress?.observe(
              command.role,
              stream === child.stdout,
              chunk,
            );
            budget.remaining();
            limits.bytes += chunk.length;
            bytes += chunk.length;
            need(
              limits.bytes <= limits.cap &&
                (!capture || bytes <= 4 * 1024 ** 2),
              "FULL_SOURCE_OUTPUT_BOUND",
            );
            need(
              writeSync(fd, chunk) === chunk.length,
              "FULL_SOURCE_LOG_WRITE",
            );
            if (capture && stream === child.stdout)
              text.push(Buffer.from(chunk));
            if (observer && stream === child.stdout) observer.push(chunk);
          } catch (error) {
            deny(error);
          }
        });
      }
      child.once("error", deny);
      child.once("close", (code, signal) => {
        // Preserve the actual child/stream/deadline failure before best-effort
        // retention. A numeric close fact never replaces the policy postcheck.
        if (!failed && !(code === 0 && signal === null)) {
          failed = true;
          primary = new Error("FULL_SOURCE_CHILD_FAILED");
        }
        if (command.role === "sync") {
          try {
            need(!logsClosed, "FULL_SYNC_CLOSE_LOG_CLOSED");
            budget.remaining();
            const record = Buffer.from(
              "FULL_SYNC_CLOSE:" +
                JSON.stringify({
                  code: Number.isSafeInteger(code) ? code : null,
                  signal:
                    signal === null
                      ? null
                      : [
                            "SIGTERM",
                            "SIGKILL",
                            "SIGINT",
                            "SIGABRT",
                            "SIGBREAK",
                          ].includes(signal)
                        ? signal
                        : "UNCLASSIFIED",
                }) +
                "\n",
            );
            need(record.length <= 512, "FULL_SYNC_CLOSE_BOUND");
            need(
              limits.bytes + record.length <= limits.cap,
              "FULL_SOURCE_OUTPUT_BOUND",
            );
            // Charge before the write, including a failed or partial write.
            limits.bytes += record.length;
            need(
              writeSync(output, record) === record.length,
              "FULL_SOURCE_LOG_WRITE",
            );
          } catch (error) {
            sourceReportingFailure = true;
            reportingFailed = true;
            reportingError = error;
          }
        }
        if (failed) reject(primary);
        else resolve(code);
      });
      timer = setTimeout(
        () => deny(new Error("FULL_DRIVER_DEADLINE")),
        Math.max(1, budget.remaining() - 120000),
      );
    });
    need(outcome === 0, "FULL_SOURCE_CHILD_FAILED");
    observer?.finish();
    budget.remaining();
    if (reportingFailed) {
      // An unforgeable outcome defers only this optional reporting fault until
      // checked() has completed the authoritative source/policy postchecks.
      const outcome = Object.freeze({});
      syncCloseReportingFaults.set(outcome, reportingError);
      return outcome;
    }
    return Buffer.concat(text).toString("utf8");
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    clearTimeout(timer);
    logsClosed = true;
    let closeError;
    for (const fd of descriptors)
      try {
        closeSync(fd);
      } catch (error) {
        sourceCloseFailure = true;
        closeError ??= error;
      }
    // No PID-name or root-only tree cleanup: failure exits this Node root and
    // the actual creation-bound enclosing Job terminates/reaps its own cohort.
    if (closeError && !failed) throw closeError;
  }
}

export async function loadSealedProfile(
  root,
  c,
  provisional = { remaining: () => 1 },
) {
  need(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED");
  requirePrivateScope(c);
  const policyRaw = await held(
    path.join(HERE, "private-qualification-profile.json"),
    65536,
    provisional,
    c.sources.find(
      (row) =>
        row.path ===
        "native/windows-arm-full-sdk/private-qualification-profile.json",
    ),
  );
  need(sha(policyRaw) === PRIVATE_PROFILE_SHA256, "PRIVATE_POLICY_PIN");
  const policy = JSON.parse(policyRaw);
  need(
    policy.mode === c.mode &&
      policy.ref === c.ref &&
      policy.workflow === c.workflow &&
      policy.privateAuthorityAdmitted === true &&
      policy.workflowActivation === true &&
      policy.sourceClosureStatus === "sealed",
    "PRIVATE_SOURCE_ADMISSION_CLOSED",
  );
  const selectedPin = policy.images[c.image];
  need(
    selectedPin &&
      [
        "image-qualified-current-profile.json",
        "image-qualified-20261021-profile.json",
      ].includes(selectedPin.profile),
    "PRIVATE_IMAGE",
  );
  const baseRaw = await held(
    path.join(HERE, "profile.json"),
    65536,
    provisional,
    c.sources.find(
      (row) => row.path === "native/windows-arm-full-sdk/profile.json",
    ),
  );
  const base = JSON.parse(baseRaw);
  const selectedRaw = await held(
    path.join(HERE, selectedPin.profile),
    65536,
    provisional,
    c.sources.find(
      (row) =>
        row.path === "native/windows-arm-full-sdk/" + selectedPin.profile,
    ),
  );
  need(
    sha(selectedRaw) === selectedPin.profileSha256,
    "PRIVATE_SELECTED_PROFILE_PIN",
  );
  const selected = JSON.parse(selectedRaw);
  need(
    sha(baseRaw) === selected.baseProfileSha256 &&
      selected.baseProfileSha256 ===
        "ccadcf1fc6f86fe11b922d93c11dc6192ccf571f03c485c610e89938c60b546a",
    "FULL_BASE_PROFILE",
  );
  need(
    selected.mode === "image-qualified-source-gn" &&
      selected.ref ===
        "refs/heads/codex/windows-arm-image-qualified-source-gn-20261101" &&
      selected.workflow ===
        ".github/workflows/windows-arm-source-preflight.yml" &&
      selected.image === c.image &&
      selected.sourceGn.sourceId === selectedPin.sourceId &&
      selected.sourceGn.namespace === selectedPin.namespace &&
      selected.admission.sourceAcquisitionAllowed === true &&
      selected.admission.gnAllowed === true &&
      selected.admission.engineCompilationAllowed === false &&
      selected.admission.sdkAllowed === false &&
      selected.admission.restoreAllowed === false &&
      selected.admission.publicationAllowed === false,
    "PRIVATE_SELECTED_SOURCE_POLICY",
  );
  const p = {
    ...base,
    image: selected.image,
    sourceGn: selected.sourceGn,
    sourcePaths: policy.sourcePaths,
    privatePolicy: policy,
    privateSelectedSha256: selectedPin.profileSha256,
    phaseAdmission: {
      ...base.phaseAdmission,
      "image-qualified-source-gn": true,
    },
  };
  const budget = sourceBudget(c, p),
    tools = reviewedHostTools(p),
    files = sourcePaths(root, p);
  keys(p.sourceGn.executionPolicy, [
    "hostLoaderClosureApproved",
    "gitConfigurationApproved",
    "sourceHookCommandClosureApproved",
  ]);
  need(
    Object.values(p.sourceGn.executionPolicy).every((value) => value === true),
    "FULL_EXECUTION_POLICY_UNAVAILABLE",
  );
  need(
    p.phaseAdmission["image-qualified-source-gn"] === true,
    "FULL_SOURCE_ADMISSION_UNAVAILABLE",
  );
  need(
    c.sources.length === 105 && p.sourcePaths.length === 105,
    "PRIVATE_SOURCE_TUPLE",
  );
  for (let i = 0; i < c.sources.length; i++) {
    const row = c.sources[i];
    need(row.path === p.sourcePaths[i], "PRIVATE_SOURCE_TUPLE");
    await held(
      path.join(root, "source-inputs", String(i)),
      2 * 1024 ** 2,
      budget,
      row,
    );
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  }
  for (const row of [...p.sourceGn.helpers, ...p.sourceGn.sourceData])
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  need(
    JSON.stringify(tools.node) === JSON.stringify(policy.driverNode),
    "PRIVATE_DRIVER_NODE_PIN",
  );
  return { p, budget, tools, files, privatePolicyRaw: policyRaw };
}

async function privateSourceBody(argv) {
  need(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED");
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      argv.length === 4 &&
      argv[0] === "--private-source-gn" &&
      /^[a-f0-9]{64}$/.test(argv[2]) &&
      argv[3] === "--execute",
    "FULL_DRIVER_ARGV",
  );
  const root = await physical(argv[1]);
  need(
    path.dirname(root) === path.join(REPO, ".artifacts") &&
      /^windows-arm-full-sdk-[a-f0-9-]{36}$/.test(path.basename(root)),
    "FULL_DRIVER_ROOT",
  );
  const provisional = { remaining: () => 1 };
  const raw = await held(path.join(root, "context.json"), 131072, provisional);
  need(sha(raw) === argv[2], "FULL_CONTEXT_PIN");
  const c = JSON.parse(raw);
  need(
    c.mode === "private-compiler-input-qualification" &&
      c.workflow ===
        ".github/workflows/windows-arm-compiler-input-qualification.yml" &&
      c.head === c.workflowSha &&
      /^[a-f0-9]{40}$/.test(c.head) &&
      c.ref === "refs/heads/codex/windows-arm-engine-qualification-20261101" &&
      c.repositoryId === "1010282954" &&
      c.visibility === "public" &&
      c.event === "workflow_dispatch",
    "FULL_DRIVER_AUTHORITY",
  );
  requirePrivateScope(c);
  need(
    c.kind === "windows-arm-full-sdk-context" &&
      c.defaultBranch === "main" &&
      c.inputs &&
      Object.keys(c.inputs).length === 1 &&
      c.inputs.mode === PRIVATE_MODE &&
      /^[1-9][0-9]*$/.test(c.runId) &&
      /^[1-9][0-9]*$/.test(c.attempt),
    "PRIVATE_CONTEXT_SCOPE",
  );
  const { p, budget, tools, files, privatePolicyRaw } = await loadSealedProfile(
    root,
    c,
    provisional,
  );
  await verifyHostClosure(p, budget, c.image);
  need(
    (await fs.realpath(process.execPath)).toLowerCase() ===
      (await fs.realpath(tools.node.path)).toLowerCase(),
    "FULL_DRIVER_NODE",
  );
  const custom = await import(
    pathToFileURL(
      path.join(HELPER_ROOT, "scripts/lib/browser-custom-runtime.mjs"),
    )
  );
  const patched = await import(
    pathToFileURL(path.join(HELPER_ROOT, "scripts/cef-patched-runtime.mjs"))
  );
  const runtime = await import(
    pathToFileURL(path.join(HELPER_ROOT, "scripts/cef-runtime-ci.mjs"))
  );
  const checkpoint = await import(
    pathToFileURL(
      path.join(HELPER_ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
    )
  );
  const lock = custom.validateSourceLock(
    JSON.parse(
      await held(path.join(files.inputs, "source-lock.json"), 65536, budget),
    ),
  );
  need(
    custom.identitySha256(lock) === p.sourceGn.sourceId,
    "FULL_SOURCE_IDENTITY",
  );
  const recipe = await custom.customRuntimeBuildRecipe({
    sourceLock: lock,
    target: TARGET,
    inputsRoot: files.inputs,
    checkouts: {
      chromium: files.chromium,
      cef: files.cef,
      depotTools: files.depot,
    },
  });
  await fs.mkdir(path.join(root, "source-caches"));
  for (const name of ["local", "roaming", "xdg", "cipd", "vpython"])
    await fs.mkdir(path.join(root, "source-caches", name));
  await fs.writeFile(path.join(root, "source-caches/cipd.cfg"), "", {
    flag: "wx",
  });
  const gitPolicy = await custom.prepareSourceGitIsolation(
    path.join(root, "cef-source-git-policy"),
    { windowsLongPaths: true },
  );
  const adapter = await preparePython3Adapter(
    files.commands,
    p.python.path,
    budget,
  );
  const bootstrap = await prepareBootstrap(root, p, argv[2], budget);
  const gnPath = path.join(files.chromium, "buildtools/win/gn.exe"),
    gnPin = p.cipd[0].members.find((row) => row.name === "gn.exe"),
    hookArguments = boundGnArguments(
      runtime.cefHookArguments(files.cef, files.depot),
      gnPath,
      gnPin,
    );
  const env = await custom.sourceGitEnvironment(
      gitPolicy,
      sourceEnvironment(root, p, recipe),
    ),
    commands = sourceCommands(
      root,
      p,
      runtime.cefHookArguments(files.cef, files.depot),
      argv[2],
    );
  // The initial plan validates the maintained CEF wrapper; the only replacement
  // is this local closed GN selector wrapper, never caller-supplied command text.
  const executionCommands = Object.freeze(
    commands.map((command) =>
      command.role === "cef-gn"
        ? Object.freeze({ ...command, args: Object.freeze(hookArguments) })
        : command,
    ),
  );
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  await fs.mkdir(files.logs);
  await fs.writeFile(
    path.join(files.logs, "command-plan.json"),
    JSON.stringify(
      {
        kind: "windows-arm-source-command-plan",
        sourceId: p.sourceGn.sourceId,
        helperSourceCommit: p.sourceGn.helpersSourceCommit,
        commands: executionCommands,
        python3Adapter: adapter.pin,
        bootstrapProgram: bootstrap.pin,
        acquisition: patched.acquisitionSourcePlan(files.workspace, TARGET),
        compilerAllowed: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  const limits = { bytes: 0, cap: p.sourceGn.limits.outputBytes };
  let stage = "source-acquire",
    primary,
    failed = false,
    success = false,
    graph = null,
    generatedArguments = null;
  let homeObservation = null;
  const verifyGitPolicy = gitPolicyVerifier(
    path.join(root, "cef-source-git-policy"),
    path.join(files.logs, "sync.stderr.log"),
    budget,
    limits,
    () => custom.sourceGitEnvironment(gitPolicy, env),
    () => homeObservation?.snapshot(),
  );
  const checked = async (action, observeHome = false) => {
    await verifyHostClosure(p, budget, c.image);
    await held(bootstrap.file, 2 * 1024 ** 2, budget, bootstrap.pin);
    if (bootstrap.witnessPin !== null)
      await verifyBootstrap(root, p, bootstrap, budget, argv[2]);
    await held(adapter.file, 4096, budget, adapter.pin);
    for (const primary of HOOK_PRIMARY)
      await held(
        path.join(files.depot, primary.path),
        primary.bytes,
        budget,
        primary,
      );
    await verifyGitPolicy();
    let rejected = false,
      value,
      primary,
      postFailed = false,
      postError,
      observerFailed = false,
      observerError,
      reportFailed = false,
      reportError;
    homeObservation = null;
    if (observeHome) {
      try {
        homeObservation = await observeGitHome(
          path.join(root, "cef-source-git-policy"),
          budget,
        );
      } catch (error) {
        observerFailed = true;
        observerError = error;
        sourceReportingFailure = true;
      }
    }
    if (!observerFailed) {
      try {
        value = await action();
      } catch (error) {
        rejected = true;
        primary = error;
      }
    }
    // Stop/join before postcheck so its first-fault report can include captured
    // events. Observer/retention faults never skip the authoritative postcheck.
    try {
      await homeObservation?.finish();
    } catch (error) {
      observerFailed = true;
      observerError = error;
      sourceReportingFailure = true;
    }
    try {
      await verifyHostClosure(p, budget, c.image);
      await verifyBootstrap(root, p, bootstrap, budget, argv[2]);
      await held(adapter.file, 4096, budget, adapter.pin);
      for (const primary of HOOK_PRIMARY)
        await held(
          path.join(files.depot, primary.path),
          primary.bytes,
          budget,
          primary,
        );
      await verifyGitPolicy();
    } catch (error) {
      postFailed = true;
      postError = error;
      console.error("FULL_BOOTSTRAP_OR_SOURCE_POSTCHECK_FAILURE");
    }
    if (homeObservation && !postFailed) {
      try {
        await appendGitPolicyDiagnostic(
          path.join(files.logs, "sync.stderr.log"),
          withGitHomeEvents(
            {
              kind: "windows-arm-source-home-observation",
              capturedEventsOnly: true,
            },
            homeObservation.snapshot(),
          ),
          budget,
          limits,
        );
      } catch (error) {
        reportFailed = true;
        reportError = error;
        sourceReportingFailure = true;
      }
    }
    if (rejected) throw primary;
    if (postFailed) throw postError;
    if (syncCloseReportingFaults.has(value))
      throw syncCloseReportingFaults.get(value);
    if (observerFailed) throw observerError;
    if (reportFailed) throw reportError;
    return value;
  };
  let qualificationOwner;
  currentProgress = new SourceProgress(root, argv[2]);
  try {
    await sourceStage(root, budget, "source-acquisition", 4500, async () => {
      currentProgress.phase("repository-fetch");
      budget.remaining();
      await patched.acquireSources(
        files.workspace,
        TARGET,
        tools.git.path,
        gitPolicy,
      );
      await verifyHostClosure(p, budget, c.image);
      budget.remaining();
      await runtime.prepareWindowsGitLauncher({
        depot: files.depot,
        gitExecutable: tools.git.path,
        logs: files.logs,
      });
      stage = commands[0].role;
      await checked(
        () =>
          executeCommand(
            commands[0],
            commands,
            env,
            files,
            budget,
            limits,
            false,
            { value: bootstrap, contextSha: argv[2] },
          ),
        true,
      );
    });
    await sourceStage(root, budget, "source-hooks-gn", 1800, async () => {
      stage = executionCommands[1].role;
      const projection = validateHookProjection(
        await checked(() =>
          executeCommand(
            executionCommands[1],
            executionCommands,
            env,
            files,
            budget,
            limits,
            true,
            { value: bootstrap, contextSha: argv[2] },
          ),
        ),
      );
      let originBytes = 0;
      // Direct files reported by the pinned Flattener, not a new tree walker.
      for (const origin of projection.origins) {
        const relative = `${origin.hierarchy.at(-1)[0]}/${origin.deps_file}`;
        const raw = await held(
          path.join(files.workspace, relative),
          Math.min(4 * 1024 ** 2, 16 * 1024 ** 2 - originBytes),
          budget,
        );
        originBytes += raw.length;
        need(originBytes <= 16 * 1024 ** 2, "FULL_HOOK_ORIGIN_BYTES");
        origin.bytes = raw.length;
        origin.sha256 = sha(raw);
      }
      // Retain the exact conditions/argv/origins plus their held byte witnesses
      // in the same bounded projection stdout artifact before any runhooks.
      await retainHookOrigins(
        path.join(files.logs, "hook-projection.stdout.log"),
        projection,
        budget,
        limits,
      );
      stage = executionCommands[2].role;
      await checked(() =>
        executeCommand(
          executionCommands[2],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      await custom.verifySourceBuildIsolation(files.chromium);
      const checkouts = {
        chromium: files.chromium,
        cef: files.cef,
        depotTools: files.depot,
      };
      stage = "source-apply";
      currentProgress.phase("patch-apply");
      await custom.applySourcePatches({
        sourceLock: lock,
        inputsRoot: files.inputs,
        checkouts,
        gitExecutable: tools.git.path,
        gitIsolation: gitPolicy,
      });
      for (const command of executionCommands.slice(3, 6)) {
        stage = command.role;
        await checked(() =>
          executeCommand(
            command,
            executionCommands,
            env,
            files,
            budget,
            limits,
            true,
            { value: bootstrap, contextSha: argv[2] },
          ),
        );
      }
      stage = "verify-setup";
      await checked(() =>
        executeCommand(
          executionCommands[6],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      stage = "source-version";
      await checked(() =>
        custom.verifySourceCheckoutVersion(
          p.python.path,
          files.chromium,
          lock.upstream.cef.version,
        ),
      );
      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);
      stage = "cef-gn";
      await checked(() =>
        executeCommand(
          executionCommands[7],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      qualificationOwner = beginQualificationSource({
        root,
        c,
        p,
        budget,
        tools,
        files,
        privatePolicyRaw,
        custom,
        checkpoint,
        gitPolicy,
        env,
        checked,
        output: limits,
        contextSha: argv[2],
      });
      await qualificationOwnerAwait(
        qualificationOwner,
        held(
          path.join(files.chromium, "out/Release_GN_arm64/build.ninja"),
          16 * 1024 ** 2,
          budget,
        ),
      );
      generatedArguments = validateGeneratedArguments(
        await qualificationOwnerAwait(
          qualificationOwner,
          held(
            path.join(files.chromium, "out/Release_GN_arm64/args.gn"),
            1024 ** 2,
            budget,
          ),
        ),
      );
      stage = "graph-inventory";
      currentProgress.phase("graph-inventory");
      const capture = await collectQualificationGraph(qualificationOwner);
      graph = capture.summary;
      const snapshot = capture.diagnostic;
      budget.remaining();
      await qualificationOwnerAwait(
        qualificationOwner,
        fs.writeFile(
          path.join(files.logs, "fresh-graph-pins.json"),
          JSON.stringify(snapshot) + "\n",
          { flag: "wx" },
        ),
      );
      budget.remaining();
    });
    const qualificationSource = commitQualificationGraph(qualificationOwner);
    success = true;
    currentProgress.phase("complete");
    stage = "private-qualification";
    await privateQualificationHandoff({
      qualificationSource,
      root,
      c,
      p,
      budget,
      files,
      graph,
      generatedArguments,
      custom,
      gitPolicy,
      env,
      privatePolicyRaw,
    });
  } catch (error) {
    retireQualificationSource(qualificationOwner, true, error);
    failed = true;
    primary = error;
    throw error;
  } finally {
    retireQualificationSource(qualificationOwner);
    currentProgress?.close();
    const code =
      typeof primary?.message === "string" &&
      /^(?:FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(primary.message)
        ? primary.message
        : failed
          ? "FULL_SOURCE_FAILED"
          : null;
    const report = {
      kind: "windows-arm-source-gn",
      success,
      stage: success ? "complete" : stage,
      firstFailure: success ? null : code,
      target: TARGET,
      sourceId: p.sourceGn.sourceId,
      graph,
      generatedArguments,
      compilerExecuted: null,
      engineCompilationRequested: false,
      engineCheckpointImplemented: false,
      sdkBuilt: false,
      nativeAcceptance: false,
      sourceCloseFailure,
      gitPolicy: custom.sourceGitIsolationEvidence(gitPolicy),
      outerJobCleanupNotInferred: true,
    };
    try {
      await fs.writeFile(
        path.join(root, "source-gn-result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
      );
    } catch (error) {
      sourceReportingFailure = true;
      if (!failed) throw error;
    }
  }
}

// END REVIEWED SOURCE DERIVATIVE

function privateImage(p) {
  const value = p.privatePolicy?.images?.[p.image];
  need(
    value && ["20261030.294.1", "20261021.278.1"].includes(p.image),
    "PRIVATE_IMAGE",
  );
  return value;
}

// BEGIN PRIVATE FULL SOURCE IMAGE DATA
function sourceImageData(p) {
  const binding = fullSourceProfiles.get(p);
  if (!binding)
    return {
      ...privateImage(p),
      selectedProfileSha256: p.privateSelectedSha256,
    };
  try {
    need(
      binding.profile === p && binding.sourceGn === p.sourceGn,
      "FULL_IMAGE_PROFILE_BINDING",
    );
    need(
      fullBootstrapAuthority(binding.root, p, binding.contextPin) === binding,
      "FULL_IMAGE_OWNER",
    );
    const image = binding.imageData;
    need(
      image &&
        image.image === p.image &&
        binding.context.sourceId === image.sourceId &&
        binding.context.sourceProfileSha256 === image.profileSha256 &&
        p.sourceGn.sourceId === image.sourceId &&
        p.sourceGn.namespace === image.namespace &&
        binding.selectedProfileSha256 === image.profileSha256,
      "FULL_IMAGE_CHANGED",
    );
    return Object.freeze({
      ...image,
      selectedProfileSha256: binding.selectedProfileSha256,
    });
  } catch (error) {
    fullSourceProfiles.delete(p);
    throw error;
  }
}
// END PRIVATE FULL SOURCE IMAGE DATA

async function privateQualificationHandoff({
  qualificationSource,
  root,
  p,
  graph,
  generatedArguments,
  custom,
  gitPolicy,
  env,
}) {
  need(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED");
  const source = qualificationSourceRuns.get(qualificationSource);
  need(source, "PRIVATE_SOURCE_RUN");
  const phase = source.phase;
  let failed = false,
    primary;
  const report = {
    kind: "windows-arm-private-qualification",
    success: false,
    sourceGnCompleted: true,
    target: TARGET,
    sourceId: p.sourceGn.sourceId,
    compilerExecuted: false,
    generatedSecurityHeadersVerified: false,
    engineCompilationRequested: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    runtimeReady: false,
    outerJobCleanupNotInferred: true,
    firstFailure: null,
  };
  const timer = setTimeout(
    () => {
      retireQualificationSource(
        source.owner,
        true,
        new Error("PRIVATE_PHASE_DEADLINE"),
      );
      try {
        writeFileSync(
          path.join(root, "private-qualification-deadline.json"),
          JSON.stringify({
            ...report,
            firstFailure: "PRIVATE_PHASE_DEADLINE",
          }) + "\n",
          { flag: "wx" },
        );
      } catch {
        sourceReportingFailure = true;
      }
      // The dedicated creation-assigned Job reaps this exact worker cohort.
      process.exit(124);
    },
    Math.max(1, source.end - performance.now()),
  );
  try {
    need(
      graph !== null && generatedArguments !== null,
      "PRIVATE_FRESH_GRAPH_REQUIRED",
    );
    phase.observe();
    // This is the still-live WeakMap token, not a serialized env/report claim.
    await custom.sourceGitEnvironment(gitPolicy, env);
    phase.observe();
    need(
      p.privatePolicy.environmentContractApproved === true,
      "PRIVATE_ENVIRONMENT_UNAVAILABLE",
    );
    need(
      source.root === root && source.policyImage === p.image,
      "PRIVATE_SOURCE_RUN",
    );
    phase.observe();
    // Even genuine metadata cannot qualify the still-unreviewed ARM defaults.
    await coordinateQualification(qualificationSource);
  } catch (error) {
    failed = true;
    primary = error;
    retireQualificationSource(source.owner, true, error);
    report.firstFailure =
      error?.message === "PRIVATE_ARM64_DEFAULTS_UNQUALIFIED" ||
      /^(?:PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(error?.message ?? "")
        ? error.message
        : "PRIVATE_QUALIFICATION_UNAVAILABLE";
    throw primary;
  } finally {
    retireQualificationSource(source.owner);
    try {
      phase.observe();
      await fs.writeFile(
        path.join(root, "private-qualification-result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
      );
      phase.observe();
    } catch (error) {
      sourceReportingFailure = true;
      if (!failed) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const PRIVATE_DRIVER_ADMITTED = false;
const PRIVATE_PROFILE_SHA256 =
  "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052";
const PRIVATE_MODE = "private-compiler-input-qualification";
const PRIVATE_REF =
  "refs/heads/codex/windows-arm-engine-qualification-20261101";
const PRIVATE_WORKFLOW =
  ".github/workflows/windows-arm-compiler-input-qualification.yml";
const PRIVATE_ROLES = Object.freeze([
  "qual-gn-desc-pa",
  "qual-gn-desc-cef",
  "qual-gn-args",
  "qual-generate-headers",
  "qual-clang-probe",
  "qual-link-probe",
]);
const PRIVATE_ROOT =
  /^[A-Z]:\/a\/sortOfRemoteNG\/sortOfRemoteNG\/\.artifacts\/windows-arm-full-sdk-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (raw) => createHash("sha256").update(raw).digest("hex");

export function requirePrivateScope(context) {
  need(
    context !== null &&
      typeof context === "object" &&
      !Array.isArray(context) &&
      context.mode === PRIVATE_MODE &&
      context.ref === PRIVATE_REF &&
      context.workflow === PRIVATE_WORKFLOW &&
      context.repository === "supermarsx/sortOfRemoteNG" &&
      context.repositoryId === "1010282954" &&
      context.visibility === "public" &&
      context.event === "workflow_dispatch",
    "PRIVATE_MODE_SCOPE",
  );
}

export function sourceJobProjection(context, rawPolicy, contextSha) {
  requirePrivateScope(context);
  need(
    Buffer.isBuffer(rawPolicy) &&
      rawPolicy.length > 0 &&
      rawPolicy.length <= 65536 &&
      hash(rawPolicy) === PRIVATE_PROFILE_SHA256,
    "PRIVATE_POLICY_PIN",
  );
  const policy = JSON.parse(rawPolicy);
  need(
    policy.mode === PRIVATE_MODE &&
      policy.ref === PRIVATE_REF &&
      policy.workflow === PRIVATE_WORKFLOW &&
      policy.privateAuthorityAdmitted === false &&
      policy.workflowActivation === false &&
      policy.sourceClosureStatus === "planned-files-incomplete",
    "PRIVATE_POLICY_SCOPE",
  );
  need(
    typeof context.root === "string" && PRIVATE_ROOT.test(context.root),
    "PRIVATE_ROOT",
  );
  need(
    typeof contextSha === "string" && /^[a-f0-9]{64}$/.test(contextSha),
    "PRIVATE_CONTEXT_PIN",
  );
  const checkout = context.root.split("/.artifacts/", 1)[0];
  return Object.freeze({
    kind: "windows-arm-private-source-job-projection",
    role: "private-source-gn",
    argv: Object.freeze([
      policy.driverNode.path,
      "--disable-proto=throw",
      "--no-addons",
      checkout + "/" + policy.handoffContract.sourceWorker,
      "--private-source-gn",
      context.root,
      contextSha,
      "--execute",
    ]),
    cwd: context.root,
    qualificationRoles: PRIVATE_ROLES,
    aggregateWorkMs: 900000,
    cleanupMs: 30000,
    finalReserveMs: 120000,
    sourceEnvironmentAuthority: "retained-live-git-policy-token-required",
    environmentAuthorityTransferred: false,
    liveJobCapability: false,
    executionAdmitted: false,
  });
}

function staticProjectionEqual(value, expected) {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      expected.every((item, index) => staticProjectionEqual(value[index], item))
    );
  if (expected !== null && typeof expected === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([name, item]) =>
          Object.hasOwn(value, name) &&
          staticProjectionEqual(value[name], item),
      )
    );
  return value === expected;
}

export function staticLoadingProjection(context, rawPolicy, observations) {
  // Candidate data only. This reuses the exact existing source/GN OS-TCB
  // policy; it does not infer actual DLL resolution, system bytes or ownership.
  sourceJobProjection(context, rawPolicy, "0".repeat(64));
  const policy = JSON.parse(rawPolicy);
  const loading = policy.staticLoadingPolicy;
  need(
    loading.kind === "reviewed-system-image-static-tools-v1" &&
      loading.systemImageIsTrustedTcb === true &&
      loading.actualLoaderClosureApproved === false &&
      loading.system32ByteSetProven === false,
    "PRIVATE_STATIC_POLICY",
  );
  need(
    loading.images.includes(context.image) &&
      staticProjectionEqual(context.host, {
        platform: loading.platform,
        architecture: loading.architecture,
        runner: loading.runner,
      }),
    "PRIVATE_STATIC_HOST",
  );
  const selected = policy.images[context.image];
  need(
    staticProjectionEqual(context.source, {
      target: policy.target,
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    }),
    "PRIVATE_STATIC_SOURCE",
  );
  const observationFields = [
    "kind",
    "toolPins",
    "llvmArchive",
    "llvmTools",
    "compilerEnvironment",
  ];
  need(
    observations &&
      Object.getPrototypeOf(observations) === Object.prototype &&
      Object.keys(observations).length === observationFields.length &&
      observationFields.every((name) => Object.hasOwn(observations, name)),
    "PRIVATE_STATIC_LOADING_FIELDS",
  );
  need(
    observations.kind === "windows-arm-static-loading-candidate",
    "PRIVATE_STATIC_LOADING_KIND",
  );
  const root = context.root;
  const pins = Object.fromEntries(
    Object.entries(policy.tools).map(([role, row]) => [
      role,
      {
        path: row.path ?? root + "/" + row.relativePath,
        bytes: row.bytes,
        sha256: row.sha256,
      },
    ]),
  );
  need(
    staticProjectionEqual(observations.toolPins, pins),
    "PRIVATE_STATIC_TOOL_PIN",
  );
  need(
    staticProjectionEqual(observations.llvmArchive, loading.llvmArchive),
    "PRIVATE_STATIC_ARCHIVE",
  );
  const llvm = Object.fromEntries(
    Object.entries(loading.llvmStaticTools).map(([role, row]) => [
      role,
      { path: pins[role].path, ...row },
    ]),
  );
  need(
    staticProjectionEqual(observations.llvmTools, llvm),
    "PRIVATE_STATIC_PE",
  );
  const environment = observations.compilerEnvironment;
  const environmentFields = ["kind", "cwd", "cwdEntriesBefore", "values"];
  need(
    environment &&
      Object.getPrototypeOf(environment) === Object.prototype &&
      Object.keys(environment).length === environmentFields.length &&
      environmentFields.every((name) => Object.hasOwn(environment, name)),
    "PRIVATE_STATIC_ENV_FIELDS",
  );
  const rules = loading.commandEnvironment;
  need(
    environment.kind === "closed-fixed-compiler-environment" &&
      environment.cwd === root + "/" + rules.compilerCwdRelative &&
      staticProjectionEqual(
        environment.cwdEntriesBefore,
        rules.initialCwdEntries,
      ),
    "PRIVATE_STATIC_CWD",
  );
  const expectedValues = {
    ...rules.requiredValues,
    TEMP: root + "/" + rules.temporaryRelative,
    TMP: root + "/" + rules.temporaryRelative,
  };
  const values = environment.values;
  need(
    values &&
      Object.getPrototypeOf(values) === Object.prototype &&
      [
        Object.keys(expectedValues).length,
        Object.keys(expectedValues).length + 1,
      ].includes(Object.keys(values).length) &&
      Object.keys(values).every(
        (name) =>
          Object.hasOwn(expectedValues, name) ||
          name === rules.optionalTrackingVariable,
      ),
    "PRIVATE_STATIC_ENV_NAMES",
  );
  need(
    Object.entries(expectedValues).every(
      ([name, value]) => values[name] === value,
    ),
    "PRIVATE_STATIC_ENV_VALUE",
  );
  if (Object.hasOwn(values, rules.optionalTrackingVariable))
    need(
      typeof values[rules.optionalTrackingVariable] === "string" &&
        values[rules.optionalTrackingVariable].length > 0 &&
        values[rules.optionalTrackingVariable].length <= 128 &&
        !/[^A-Za-z0-9_-]/.test(values[rules.optionalTrackingVariable]),
      "PRIVATE_STATIC_TRACKING",
    );
  return Object.freeze({
    kind: "windows-arm-static-loading-projection",
    policyKind: loading.kind,
    image: context.image,
    source: { ...context.source },
    selectedSourceProfileSha256: selected.profileSha256,
    staticPolicyProjectionMatches: true,
    systemImageIsTrustedTcb: true,
    reusedSourceToolRoles: [...loading.reusedSourceToolRoles],
    additionalStaticToolRoles: Object.keys(loading.llvmStaticTools),
    actualLoaderClosureApproved: false,
    system32ByteSetProven: false,
    liveOwnershipVerified: false,
    environmentAuthorityTransferred: false,
    processProvenanceVerified: false,
    executionAdmitted: false,
  });
}

export function privateCommandProjections(context, rawPolicy, contextSha) {
  sourceJobProjection(context, rawPolicy, contextSha);
  const policy = JSON.parse(rawPolicy);
  const root = context.root;
  const source = root + "/source-checkout/src";
  const out = source + "/out/Release_GN_arm64";
  const probe = root + "/private-qualification";
  const checkout = root.split("/.artifacts/", 1)[0];
  const gn = source + "/buildtools/win/gn.exe";
  const vectors = [
    [gn, "desc", out, policy.generatedInputs[0].label, "--format=json"],
    [gn, "desc", out, policy.generatedInputs[1].label, "--format=json"],
    [gn, "args", out, "--list", "--json", "--short"],
    [
      root + "/siso/siso.exe",
      "ninja",
      "--offline",
      "-local_jobs=1",
      "-C",
      out,
      ...policy.generatedInputs.map((row) => row.relativeOutput),
    ],
    [
      root + "/llvm/bin/clang-cl.exe",
      "--target=aarch64-pc-windows-msvc",
      "/c",
      "/nologo",
      "/X",
      "/GS",
      "/Zl",
      "/std:c++20",
      "/clang:-nostdinc",
      "/I" + source + "/base/allocator/partition_allocator/src",
      "/I" + out + "/gen/base/allocator/partition_allocator/src",
      "/I" + out + "/gen",
      "/Fo" + probe + "/probe.obj",
      checkout + "/" + policy.probeSource,
    ],
    [
      root + "/llvm/bin/lld-link.exe",
      "/lldignoreenv",
      "/nodefaultlib",
      "/machine:arm64",
      "/subsystem:console",
      "/entry:" + policy.probeEntry,
      "/manifest:no",
      "/out:" + probe + "/probe.exe",
      probe + "/probe.obj",
    ],
  ];
  return Object.freeze(
    vectors.map((argv, index) =>
      Object.freeze({
        role: PRIVATE_ROLES[index],
        argv: Object.freeze(argv),
        cwd: index < 4 ? source : probe,
        environmentContract:
          index < 4
            ? "live-source-git-policy-required"
            : "hermetic-tool-policy-unreviewed",
        executionAdmitted: false,
      }),
    ),
  );
}

export function qualificationPhaseClock(
  sourceBudget,
  now = performance.now.bind(performance),
) {
  // This is a deadline/order helper only; it creates no Job/process/source
  // authority. The future private worker will create exactly one at post-GN.
  const began = now();
  const remaining = sourceBudget.remaining();
  need(
    Number.isFinite(began) &&
      Number.isFinite(remaining) &&
      remaining > 150000 &&
      remaining <= 7200000,
    "PRIVATE_PHASE_BUDGET",
  );
  const allowance = Math.min(900000, remaining - 150000);
  let next = 0,
    pending = false,
    finished = false,
    failed = false,
    primary;
  const checkClock = () => {
    const left = sourceBudget.remaining();
    const at = now();
    need(
      Number.isFinite(left) &&
        left > 150000 &&
        left <= 7200000 &&
        Number.isFinite(at) &&
        at >= began &&
        at - began < allowance,
      "PRIVATE_PHASE_DEADLINE",
    );
  };
  const check = (role, after) => {
    try {
      if (failed) throw primary;
      checkClock();
      need(
        !finished &&
          next < PRIVATE_ROLES.length &&
          role === PRIVATE_ROLES[next] &&
          pending === after,
        "PRIVATE_PHASE_ORDER",
      );
      pending = !after;
      if (after) next++;
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
      throw primary;
    }
  };
  return Object.freeze({
    observe: () => {
      try {
        if (failed) throw primary;
        checkClock();
        need(!finished, "PRIVATE_PHASE_ORDER");
      } catch (error) {
        if (!failed) {
          failed = true;
          primary = error;
        }
        throw primary;
      }
    },
    before: (role) => check(role, false),
    after: (role) => check(role, true),
    finish: () => {
      try {
        if (failed) throw primary;
        checkClock();
        need(
          !finished && next === PRIVATE_ROLES.length && !pending,
          "PRIVATE_PHASE_ORDER",
        );
        finished = true;
        return Object.freeze({
          commandsCompleted: next,
          executionAdmitted: false,
        });
      } catch (error) {
        if (!failed) {
          failed = true;
          primary = error;
        }
        throw primary;
      }
    },
    maximumWorkMs: allowance,
    executionAdmitted: false,
  });
}

// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES
import { fstatSync as qualificationFdStat } from "node:fs";
// Only the private source-owned issuer below populates this map. The actual
// source entry and every workload admission remain closed.
const qualificationSourceRuns = new WeakMap();
const qualificationSessions = new WeakMap();
const qualificationObservations = new WeakMap();
const QUALIFICATION_PATCHED_INPUTS = Object.freeze([
  Object.freeze({
    relative: "source-checkout/src/cef/BUILD.gn",
    bytes: 97568,
    sha256: "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
  }),
  Object.freeze({
    relative:
      "source-checkout/src/base/allocator/partition_allocator/src/partition_alloc/BUILD.gn",
    bytes: 45891,
    sha256: "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
  }),
]);

function qualificationPoison(state, error) {
  if (!state.failed) {
    state.failed = true;
    state.primary = error;
    state.failedAt = performance.now();
    state.epoch++;
  }
  if (state.source.owner)
    retireQualificationSource(state.source.owner, true, state.primary);
  return state.primary;
}

function qualificationCheck(state) {
  if (state.failed) throw state.primary;
  try {
    need(!state.closed && !state.source.signal?.aborted, "PRIVATE_CANCELLED");
    need(
      qualificationSourceRuns.get(state.sourceToken) === state.source,
      "PRIVATE_SOURCE_RUN",
    );
    state.phase.observe();
    need(performance.now() < state.end, "PRIVATE_PHASE_DEADLINE");
  } catch (error) {
    throw qualificationPoison(state, error);
  }
}

function createQualificationSession(sourceToken) {
  const source = qualificationSourceRuns.get(sourceToken);
  need(source, "PRIVATE_SOURCE_RUN");
  const phase = source.phase;
  need(phase && Number.isFinite(source.end), "PRIVATE_SOURCE_PHASE");
  const token = Object.freeze({ kind: "private-qualification-session" });
  const state = {
    token,
    sourceToken,
    source,
    phase,
    end: source.end,
    epoch: 0,
    failed: false,
    primary: undefined,
    failedAt: null,
    closed: false,
    running: false,
    locallyJoined: false,
    next: 0,
    logDirectoryIdentity: null,
    logFiles: new Map(),
  };
  qualificationSessions.set(token, state);
  source.sessions?.add(state);
  qualificationCheck(state);
  return token;
}

// Close is bounded by the same phase, not a new cleanup lease. Closing a
// session revokes receipts synchronously; a late FD close can never mint one.
async function qualificationWithin(
  state,
  operation,
  end = state.end,
  retiring = false,
) {
  // Keep a rejection observer if this continuation reaches an expired lease
  // after its owned operation was already created.
  const awaited = Promise.resolve(operation);
  awaited.catch(() => {});
  let timer, onAbort;
  const left = end - performance.now();
  need(Number.isFinite(left) && left > 0, "PRIVATE_PHASE_DEADLINE");
  try {
    const value = await Promise.race([
      awaited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PRIVATE_PHASE_DEADLINE")),
          Math.max(1, Math.ceil(left)),
        );
      }),
      new Promise((_, reject) => {
        if (retiring) return;
        onAbort = () => reject(new Error("PRIVATE_CANCELLED"));
        state.source.signal?.addEventListener("abort", onAbort, { once: true });
        if (state.source.signal?.aborted) onAbort();
      }),
    ]);
    need(performance.now() < end, "PRIVATE_PHASE_DEADLINE");
    return value;
  } finally {
    clearTimeout(timer);
    if (onAbort) state.source.signal?.removeEventListener("abort", onAbort);
  }
}

async function qualificationHeld(file, pin, state, inspect = null) {
  qualificationCheck(state);
  need(
    Number.isSafeInteger(pin.bytes) &&
      pin.bytes > 0 &&
      pin.bytes <= 268435456 &&
      /^[a-f0-9]{64}$/.test(pin.sha256),
    "PRIVATE_READ_PIN",
  );
  let fd,
    failed = false,
    primary,
    closed = false;
  try {
    await qualificationWithin(state, physical(file));
    qualificationCheck(state);
    const before = await qualificationWithin(
      state,
      fs.lstat(file, { bigint: true }),
    );
    need(
      before.isFile() &&
        before.nlink === 1n &&
        before.size === BigInt(pin.bytes),
      "PRIVATE_READ_FILE",
    );
    // Retain the open promise's eventual creation handle even on timeout, so
    // that a late successful open is closed rather than lost to Promise.race.
    const opening = fs
      .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      .then((handle) => {
        fd = handle;
        if (failed)
          handle.close().catch(() => {
            state.unconfirmedClose = true;
          });
        return handle;
      });
    await qualificationWithin(state, opening);
    qualificationCheck(state);
    const initial = await qualificationWithin(state, fd.stat({ bigint: true }));
    need(signature(initial) === signature(before), "PRIVATE_READ_IDENTITY");
    const exact = async (offset, count) => {
      qualificationCheck(state);
      need(
        Number.isSafeInteger(offset) &&
          Number.isSafeInteger(count) &&
          offset >= 0 &&
          count >= 0 &&
          offset <= pin.bytes &&
          count <= pin.bytes - offset &&
          count <= 65536,
        "PRIVATE_READ_BOUND",
      );
      const raw = Buffer.alloc(count);
      let at = 0;
      while (at < count) {
        const result = await qualificationWithin(
          state,
          fd.read(raw, at, count - at, offset + at),
        );
        qualificationCheck(state);
        need(
          result.bytesRead > 0 && result.bytesRead <= count - at,
          "PRIVATE_READ_SHORT",
        );
        at += result.bytesRead;
      }
      return raw;
    };
    const digest = createHash("sha256");
    for (let at = 0; at < pin.bytes; at += 65536)
      digest.update(await exact(at, Math.min(65536, pin.bytes - at)));
    need(digest.digest("hex") === pin.sha256, "PRIVATE_READ_HASH");
    const projection = inspect ? await inspect(exact, pin.bytes) : null;
    qualificationCheck(state);
    await qualificationWithin(state, physical(file));
    need(
      signature(await qualificationWithin(state, fd.stat({ bigint: true }))) ===
        signature(initial) &&
        signature(
          await qualificationWithin(state, fs.lstat(file, { bigint: true })),
        ) === signature(before),
      "PRIVATE_READ_CHANGED",
    );
    qualificationCheck(state);
    return {
      bytes: pin.bytes,
      sha256: pin.sha256,
      identity: signature(before),
      projection,
    };
  } catch (error) {
    failed = true;
    if (!fd) state.unconfirmedClose = true;
    primary = qualificationPoison(state, error);
    throw primary;
  } finally {
    if (fd) {
      try {
        await qualificationWithin(
          state,
          fd.close(),
          failed ? Math.min(state.end, state.failedAt + 30000) : state.end,
          true,
        );
        closed = true;
      } catch (error) {
        state.unconfirmedClose = true;
        if (!failed) throw qualificationPoison(state, error);
      }
    }
    if (fd && !closed) state.unconfirmedClose = true;
  }
}

// Static import projection only: no image loading, System32 traversal,
// resources, version execution, export/API-set resolution or loader claim.
// Bounds and ambiguity rules mirror extract.py::pe_metadata.
async function qualificationStaticPe(read, length) {
  const dos = await read(0, 64);
  need(dos.toString("ascii", 0, 2) === "MZ", "PRIVATE_PE_DOS");
  const pe = dos.readUInt32LE(60);
  need(pe >= 64, "PRIVATE_PE_SIGNATURE");
  const header = await read(pe, 24);
  need(header.readUInt32LE(0) === 0x00004550, "PRIVATE_PE_SIGNATURE");
  const machine = header.readUInt16LE(4),
    count = header.readUInt16LE(6),
    optSize = header.readUInt16LE(20);
  need(
    count >= 1 && count <= 96 && optSize >= 96 && optSize <= 4096,
    "PRIVATE_PE_HEADER",
  );
  const opt = await read(pe + 24, optSize);
  const magic = opt.readUInt16LE(0),
    base = magic === 0x10b ? 96 : 112;
  need(
    [0x10b, 0x20b].includes(magic) && optSize >= base,
    "PRIVATE_PE_OPTIONAL",
  );
  const dirs = opt.readUInt32LE(base - 4),
    headers = opt.readUInt32LE(60);
  need(
    dirs <= 16 &&
      base + dirs * 8 <= optSize &&
      pe + 24 + optSize + count * 40 <= headers &&
      headers <= length,
    "PRIVATE_PE_DIRECTORIES",
  );
  const rawSections = await read(pe + 24 + optSize, count * 40),
    ranges = [];
  for (let i = 0; i < count; i++) {
    const row = i * 40,
      va = rawSections.readUInt32LE(row + 12),
      size = rawSections.readUInt32LE(row + 16),
      address = rawSections.readUInt32LE(row + 20);
    need(address <= length && size <= length - address, "PRIVATE_PE_SECTION");
    if (size) {
      need(
        address >= headers && va >= headers && va + size <= 0x100000000,
        "PRIVATE_PE_SECTION",
      );
      ranges.push({ start: va, end: va + size, address });
    }
  }
  for (const fields of [
    ["start", "end"],
    ["address", "rawEnd"],
  ]) {
    const ordered = ranges
      .map((row) => ({ ...row, rawEnd: row.address + row.end - row.start }))
      .sort((a, b) => a[fields[0]] - b[fields[0]]);
    for (let i = 1; i < ordered.length; i++)
      need(
        ordered[i - 1][fields[1]] <= ordered[i][fields[0]],
        "PRIVATE_PE_OVERLAP",
      );
  }
  const rva = (value, size) => {
    if (value < headers && size <= headers - value) return value;
    const matches = ranges.filter(
      (row) =>
        row.start <= value && value <= row.end && size <= row.end - value,
    );
    need(matches.length === 1, "PRIVATE_PE_RVA");
    return matches[0].address + value - matches[0].start;
  };
  const imports = async (index, stride) => {
    if (index >= dirs) return [];
    const value = opt.readUInt32LE(base + index * 8),
      size = opt.readUInt32LE(base + index * 8 + 4);
    need(Boolean(value) === Boolean(size), "PRIVATE_PE_DIRECTORY");
    if (!value) return [];
    need(size >= stride && size <= 65536, "PRIVATE_PE_IMPORT_BOUND");
    const descriptors = await read(rva(value, size), size),
      result = [];
    for (let i = 0; i < Math.min(Math.floor(size / stride), 257); i++) {
      const row = descriptors.subarray(i * stride, (i + 1) * stride);
      if (row.every((byte) => byte === 0)) return result;
      need(i < 256, "PRIVATE_PE_IMPORT_BOUND");
      if (index === 13)
        need(row.readUInt32LE(0) === 1, "PRIVATE_PE_DELAY_FORMAT");
      const nameRva = row.readUInt32LE(index === 13 ? 4 : 12),
        name = [];
      let terminated = false;
      for (let n = 0; n <= 128; n++) {
        const byte = (await read(rva(nameRva + n, 1), 1))[0];
        if (byte === 0) {
          terminated = true;
          break;
        }
        name.push(byte);
      }
      const text = Buffer.from(name).toString("ascii");
      need(
        terminated &&
          name.every((byte) => byte < 128) &&
          /^[A-Za-z0-9_.-]{1,124}\.dll$/i.test(text),
        "PRIVATE_PE_IMPORT_NAME",
      );
      result.push(text);
    }
    throw new Error("PRIVATE_PE_IMPORT_TERMINATOR");
  };
  return {
    machine,
    imports: await imports(1, 20),
    delayImports: await imports(13, 32),
  };
}

async function qualificationNoAdjacentDlls(state) {
  const directory = path.join(state.source.root, "llvm/bin");
  await qualificationWithin(state, physical(directory));
  const initial = await qualificationWithin(
    state,
    fs.lstat(directory, { bigint: true }),
  );
  need(initial.isDirectory(), "PRIVATE_LLVM_DIRECTORY");
  let directoryHandle,
    failed = false;
  const opening = fs.opendir(directory).then((handle) => {
    directoryHandle = handle;
    if (failed)
      handle.close().catch(() => {
        state.unconfirmedClose = true;
      });
    return handle;
  });
  try {
    await qualificationWithin(state, opening);
    for (let count = 0; ; count++) {
      qualificationCheck(state);
      const row = await qualificationWithin(state, directoryHandle.read());
      if (row === null) break;
      need(
        count < 4096 &&
          row.name.length <= 255 &&
          !/[\\/:\x00-\x1f]|[. ]$/.test(row.name),
        "PRIVATE_LLVM_ENTRY",
      );
      need(
        !row.isSymbolicLink() && !/\.dll$/i.test(row.name),
        "PRIVATE_ADJACENT_DLL",
      );
    }
    need(
      signature(
        await qualificationWithin(state, fs.lstat(directory, { bigint: true })),
      ) === signature(initial),
      "PRIVATE_LLVM_CHANGED",
    );
    await qualificationWithin(state, physical(directory));
  } catch (error) {
    failed = true;
    if (!directoryHandle) state.unconfirmedClose = true;
    throw qualificationPoison(state, error);
  } finally {
    if (directoryHandle) {
      try {
        await qualificationWithin(
          state,
          directoryHandle.close(),
          failed ? Math.min(state.end, state.failedAt + 30000) : state.end,
          true,
        );
      } catch (error) {
        state.unconfirmedClose = true;
        if (!failed) throw qualificationPoison(state, error);
      }
    }
  }
}

async function issueActualObservation(session, role) {
  const state = qualificationSessions.get(session);
  need(state, "PRIVATE_SESSION");
  try {
    qualificationCheck(state);
    need(
      role === PRIVATE_ROLES[state.next] && !state.running,
      "PRIVATE_OBSERVATION_ROLE",
    );
    const source = state.source,
      policy = JSON.parse(source.privatePolicyRaw);
    need(
      sha(source.privatePolicyRaw) === PRIVATE_PROFILE_SHA256,
      "PRIVATE_POLICY_PIN",
    );
    const paths = [
      ...Object.entries(policy.tools).map(([name, row]) => ({
        role: name,
        file: row.path ?? path.join(source.root, row.relativePath),
        pin: row,
      })),
      {
        role: "llvmArchive",
        file: path.join(source.root, "archives/clang.tar.xz"),
        pin: policy.staticLoadingPolicy.llvmArchive,
      },
      ...QUALIFICATION_PATCHED_INPUTS.map((row) => ({
        role: row.relative,
        file: path.join(source.root, row.relative),
        pin: row,
      })),
      {
        role: "probeSource",
        file: path.join(REPO, policy.probeSource),
        pin: {
          bytes: 2651,
          sha256:
            "0e291acd6f1fdcbd7f79d2874e760927e92bc13eeab241016bb87878867f9220",
        },
      },
    ];
    const readings = {};
    for (const row of paths) {
      const expected = policy.staticLoadingPolicy.llvmStaticTools[row.role];
      const actual = await qualificationHeld(
        row.file,
        row.pin,
        state,
        expected ? qualificationStaticPe : null,
      );
      if (expected)
        need(
          staticProjectionEqual(actual.projection, {
            machine: expected.machine,
            imports: expected.imports,
            delayImports: expected.delayImports,
          }),
          "PRIVATE_TOOL_STATIC_PIN",
        );
      readings[row.role] = actual;
    }
    await qualificationNoAdjacentDlls(state);
    qualificationCheck(state);
    const receipt = Object.freeze({
      kind: "private-actual-static-observation",
      executionAdmitted: false,
    });
    qualificationObservations.set(receipt, {
      session,
      state,
      role,
      epoch: state.epoch,
      readings,
    });
    return receipt;
  } catch (error) {
    throw qualificationPoison(state, error);
  }
}

function qualificationRetireOwned(child) {
  for (const stream of [child.stdout, child.stderr, child.stdin]) {
    try {
      stream?.destroy();
    } catch {
      /* Only this creation's streams. */
    }
    try {
      stream?.unref?.();
    } catch {
      /* Best effort retirement, never joined. */
    }
  }
  try {
    child.unref();
  } catch {
    /* Keep the first failure. */
  }
}

const qualificationStableFile = (s) =>
  [s.dev, s.ino, s.birthtimeNs, s.mode, s.nlink].join(":");

async function qualificationLogDirectory(state) {
  qualificationCheck(state);
  const directory = path.join(state.source.root, "private-qualification-logs");
  await qualificationWithin(state, physical(directory));
  const initial = await qualificationWithin(
    state,
    fs.lstat(directory, { bigint: true }),
  );
  need(initial.isDirectory(), "PRIVATE_LOG_DIRECTORY");
  if (state.logDirectoryIdentity === null) {
    need(
      signature(initial) === state.source.logsIdentity,
      "PRIVATE_LOG_DIRECTORY",
    );
    state.logDirectoryIdentity = qualificationStableFile(initial);
  }
  need(
    qualificationStableFile(initial) === state.logDirectoryIdentity,
    "PRIVATE_LOG_DIRECTORY",
  );
  let directoryHandle,
    failed = false;
  const opening = fs.opendir(directory).then((handle) => {
    directoryHandle = handle;
    if (failed)
      handle.close().catch(() => {
        state.unconfirmedClose = true;
      });
    return handle;
  });
  try {
    await qualificationWithin(state, opening);
    const seen = new Set();
    for (;;) {
      const row = await qualificationWithin(state, directoryHandle.read());
      if (row === null) break;
      need(seen.size < 12 && !seen.has(row.name), "PRIVATE_LOG_ENTRIES");
      seen.add(row.name);
      const owned = state.logFiles.get(row.name);
      need(
        owned && !row.isSymbolicLink() && owned.finalIdentity,
        "PRIVATE_LOG_UNKNOWN",
      );
      const file = path.join(directory, row.name);
      await qualificationWithin(state, physical(file));
      const named = await qualificationWithin(
        state,
        fs.lstat(file, { bigint: true }),
      );
      need(
        named.isFile() &&
          named.nlink === 1n &&
          signature(named) === owned.finalIdentity,
        "PRIVATE_LOG_CHANGED",
      );
    }
    need(seen.size === state.logFiles.size, "PRIVATE_LOG_MISSING");
    need(
      signature(
        await qualificationWithin(state, fs.lstat(directory, { bigint: true })),
      ) === signature(initial),
      "PRIVATE_LOG_DIRECTORY_CHANGED",
    );
    await qualificationWithin(state, physical(directory));
    qualificationCheck(state);
  } catch (error) {
    failed = true;
    if (!directoryHandle) state.unconfirmedClose = true;
    throw qualificationPoison(state, error);
  } finally {
    if (directoryHandle) {
      try {
        await qualificationWithin(
          state,
          directoryHandle.close(),
          failed ? Math.min(state.end, state.failedAt + 30000) : state.end,
          true,
        );
      } catch (error) {
        state.unconfirmedClose = true;
        if (!failed) throw qualificationPoison(state, error);
      }
    }
  }
}

async function qualificationCloseLogs(state, logs, verify) {
  let failed = false,
    primary;
  const fail = (error) => {
    if (!failed) {
      failed = true;
      primary = qualificationPoison(state, error);
    }
  };
  for (const row of logs) {
    if (row.closeAttempted) continue;
    if (verify) {
      try {
        const held = qualificationFdStat(row.fd, { bigint: true });
        need(
          held.isFile() &&
            held.nlink === 1n &&
            qualificationStableFile(held) === row.creationIdentity &&
            held.size === BigInt(row.bytes),
          "PRIVATE_LOG_HELD_CHANGED",
        );
      } catch (error) {
        fail(error);
      }
    }
    // Never retry a numeric descriptor after an uncertain close. Root exit
    // and the enclosing Job own final retirement if this close is unconfirmed.
    row.closeAttempted = true;
    try {
      closeSync(row.fd);
      row.closed = true;
    } catch (error) {
      state.unconfirmedClose = true;
      fail(error);
    }
    if (verify && row.closed) {
      try {
        const named = await qualificationWithin(
          state,
          fs.lstat(row.file, { bigint: true }),
        );
        need(
          named.isFile() &&
            named.nlink === 1n &&
            qualificationStableFile(named) === row.creationIdentity &&
            named.size === BigInt(row.bytes),
          "PRIVATE_LOG_NAMED_CHANGED",
        );
        row.finalIdentity = signature(named);
      } catch (error) {
        fail(error);
      }
    }
  }
  if (failed) throw primary;
}

async function runFixedJoined(session, role, observation) {
  const state = qualificationSessions.get(session);
  need(state, "PRIVATE_SESSION");
  let child,
    timer,
    abort,
    failed = false,
    primary,
    joined = false;
  const logs = [];
  try {
    qualificationCheck(state);
    const actual = qualificationObservations.get(observation);
    need(
      actual?.session === session &&
        actual.state === state &&
        actual.epoch === state.epoch &&
        actual.role === role,
      "PRIVATE_OBSERVATION",
    );
    need(
      role === PRIVATE_ROLES[state.next] && !state.running,
      "PRIVATE_COMMAND_ROLE",
    );
    // This separate barrier remains closed until the genuine graph/header/
    // environment coordinator and source-run issuer have been reviewed.
    need(
      qualificationCoordinatorSources.has(state.sourceToken),
      "PRIVATE_COORDINATOR_CLOSED",
    );
    state.phase.before(role);
    state.running = true;
    const vector = fullMetadataSources.has(state.sourceToken)
      ? fullMetadataCommand(state, role)
      : privateCommandProjections(
          state.source.context,
          state.source.privatePolicyRaw,
          state.source.contextSha,
        )[state.next];
    need(vector.role === role, "PRIVATE_COMMAND_ROLE");
    const environment =
      state.next < 4
        ? await qualificationWithin(
            state,
            state.source.custom.sourceGitEnvironment(
              state.source.gitPolicy,
              state.source.environment,
            ),
          )
        : state.source.compilerEnvironment;
    qualificationCheck(state);
    // Future source-run creation must hold fixed sibling directories and
    // graph authority. Pure caller observations can never satisfy this map.
    await qualificationWithin(state, state.source.validateBefore(role));
    qualificationCheck(state);
    await qualificationLogDirectory(state);
    const directory = path.join(
      state.source.root,
      "private-qualification-logs",
    );
    qualificationCheck(state);
    for (const channel of ["stdout", "stderr"]) {
      const name = role + "." + channel + ".log",
        file = path.join(directory, name);
      const fd = openSync(
        file,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const row = {
        fd,
        name,
        file,
        bytes: 0,
        closeAttempted: false,
        closed: false,
        finalIdentity: null,
      };
      logs.push(row); // Own the descriptor before its first metadata operation.
      const created = qualificationFdStat(fd, { bigint: true });
      need(
        created.isFile() &&
          created.nlink === 1n &&
          created.size === 0n &&
          !state.logFiles.has(name),
        "PRIVATE_LOG_CREATION",
      );
      row.creationIdentity = qualificationStableFile(created);
      state.logFiles.set(name, row);
    }
    qualificationCheck(state);
    let rootExited = false,
      rootClosed = false,
      stdoutClosed = false,
      stderrClosed = false,
      code,
      signal,
      total = 0;
    let settle, firstFailure;
    const closed = new Promise((resolve) => {
      settle = resolve;
    });
    const failedCommand = new Promise((resolve) => {
      firstFailure = resolve;
    });
    const failure = (error) => {
      if (!failed) {
        failed = true;
        primary = qualificationPoison(state, error);
        firstFailure();
      }
      if (!rootExited) {
        try {
          child?.kill("SIGKILL");
        } catch {
          /* No PID or group authority. */
        }
      }
    };
    const maybeClosed = () => {
      if (rootClosed && stdoutClosed && stderrClosed) settle();
    };
    // No generic executable/arguments/environment API is exported. The vector
    // comes only from the existing six-role projection and private session.
    child = spawn(vector.argv[0], vector.argv.slice(1), {
      cwd: vector.cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("error", failure);
    child.once("exit", (exitCode, exitSignal) => {
      rootExited = true;
      code = exitCode;
      signal = exitSignal;
      if (code !== 0 || signal !== null)
        failure(new Error("PRIVATE_COMMAND_EXIT"));
    });
    child.once("close", () => {
      rootExited = true;
      rootClosed = true;
      maybeClosed();
    });
    for (const [index, stream] of [child.stdout, child.stderr].entries()) {
      need(stream, "PRIVATE_COMMAND_PIPE");
      stream.on("error", failure);
      stream.on("data", (raw) => {
        if (failed) return; // Drain/discard after the first failure.
        try {
          qualificationCheck(state);
          need(Buffer.isBuffer(raw), "PRIVATE_COMMAND_OUTPUT");
          total += raw.length;
          state.source.output.bytes += raw.length;
          const cap = state.next < 2 ? 1048576 : 4194304;
          need(
            total <= cap && state.source.output.bytes <= 67108864,
            "PRIVATE_COMMAND_OUTPUT_BOUND",
          );
          let offset = 0;
          while (offset < raw.length) {
            qualificationCheck(state);
            const written = writeSync(
              logs[index].fd,
              raw,
              offset,
              raw.length - offset,
            );
            need(
              written > 0 && written <= raw.length - offset,
              "PRIVATE_LOG_SHORT_WRITE",
            );
            offset += written;
            logs[index].bytes += written;
          }
        } catch (error) {
          failure(error);
        }
      });
      stream.once("close", () => {
        if (index === 0) stdoutClosed = true;
        else stderrClosed = true;
        maybeClosed();
      });
    }
    abort = () => failure(new Error("PRIVATE_CANCELLED"));
    state.source.signal?.addEventListener("abort", abort, { once: true });
    if (state.source.signal?.aborted) abort();
    timer = setTimeout(
      () => failure(new Error("PRIVATE_PHASE_DEADLINE")),
      Math.max(1, Math.ceil(state.end - performance.now())),
    );
    try {
      await qualificationWithin(state, Promise.race([closed, failedCommand]));
    } catch (error) {
      failure(error);
    }
    try {
      // An abort can reject the first wait itself. It must still join this
      // creation's root/pipes under the original, clipped close lease.
      await qualificationWithin(
        state,
        closed,
        failed ? Math.min(state.end, state.failedAt + 30000) : state.end,
        true,
      );
      joined = rootClosed && stdoutClosed && stderrClosed;
      state.locallyJoined = joined;
    } catch (error) {
      failure(error);
    }
    if (failed) throw primary;
    need(joined && code === 0 && signal === null, "PRIVATE_COMMAND_JOIN");
    qualificationCheck(state);
    await qualificationCloseLogs(state, logs, true);
    await qualificationLogDirectory(state);
    qualificationCheck(state);
    await qualificationWithin(state, state.source.validateAfter(role));
    qualificationCheck(state);
    state.phase.after(role);
    state.next++;
    state.epoch++;
    return Object.freeze({
      role,
      rootAndPipesJoined: true,
      outputBytes: total,
      cohortQuietProven: false,
      executionAdmitted: false,
    });
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = qualificationPoison(state, error);
    }
    throw primary;
  } finally {
    clearTimeout(timer);
    if (abort) state.source.signal?.removeEventListener("abort", abort);
    try {
      await qualificationCloseLogs(state, logs, false);
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = qualificationPoison(state, error);
      }
    }
    if (child && !joined) qualificationRetireOwned(child);
    state.running = false;
    if (failed) throw primary;
    qualificationCheck(state);
  }
}
// END INACTIVE JOINED OBSERVATION PRIMITIVES

// BEGIN INACTIVE PURE QUALIFICATION INSPECTORS
// Byte/JSON candidate projections only. These functions perform no IO and do
// not register source runs, produce Job capabilities or enable any executor.
// Canonical references: private_qualification.py and engine_qualification.py.
const QUALIFICATION_PA_GUARD =
  "BASE_ALLOCATOR_PARTITION_ALLOCATOR_SRC_PARTITION_ALLOC_BUILDFLAGS_H_";
const QUALIFICATION_ARM_TOOLCHAIN = "//build/toolchain/win:win_clang_arm64";
const QUALIFICATION_GN_ARGUMENT_SOURCE = Object.freeze({
  url: "https://gn.googlesource.com/gn/+/150a9d6ba0aa7f407aa4feeabc5f03ce9aa7e04b/src/gn/args.cc?format=TEXT",
  bytes: 17609,
  sha256: "2f79a7cf16e873ce7730d3da3e4b8885038ba9b71817fb8be99703814c0e5d29",
});
const QUALIFICATION_DECLARED_ARGS = Object.freeze({
  is_clang: "true",
  use_lld: "true",
  use_remoteexec: "false",
  use_siso: "true",
  is_component_build: "false",
  is_debug: "false",
  enable_backup_ref_ptr_instance_tracer: "false",
  v8_enable_sandbox: "true",
});
const QUALIFICATION_CPU_ARGS = Object.freeze({
  target_cpu: '"arm64"',
  host_cpu: '"x64"',
});
// Python str.splitlines/str.isspace semantics used by the canonical flat GN
// parser. In particular, a UTF-8 BOM is not silently treated as whitespace.
const QUALIFICATION_PY_SPACE =
  "[\\x09-\\x0d\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const QUALIFICATION_GN_LITERAL = new RegExp(
  /^\s*([a-z][a-z0-9_]*)\s*=\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\$\x00-\x1f]|\\["\\])*")\s*(?:#.*)?$/.source.replaceAll(
    "\\s",
    QUALIFICATION_PY_SPACE,
  ),
  "u",
);

function qualificationShape(value, fields, code) {
  need(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === fields.length &&
      fields.every((key) => Object.hasOwn(value, key)),
    code,
  );
}
function qualificationInteger(value, low, high, code) {
  need(Number.isSafeInteger(value) && value >= low && value <= high, code);
}
function qualificationStringBound(value, maximum) {
  if (typeof value !== "string") return false;
  let count = 0;
  for (let at = 0; at < value.length; at++) {
    if (++count > maximum) return false;
    if (value.codePointAt(at) > 0xffff) at++;
  }
  return true;
}
function qualificationCanonical(value) {
  if (Array.isArray(value))
    return "[" + value.map(qualificationCanonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ":" + qualificationCanonical(value[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function qualificationPolicy(rawPolicy, rawCandidatePolicy) {
  need(
    Buffer.isBuffer(rawPolicy) &&
      rawPolicy.length > 0 &&
      rawPolicy.length <= 65536 &&
      sha(rawPolicy) === PRIVATE_PROFILE_SHA256,
    "PRIVATE_POLICY_PIN",
  );
  const policy = JSON.parse(rawPolicy.toString("utf8"));
  need(
    policy.mode === PRIVATE_MODE &&
      policy.ref === PRIVATE_REF &&
      policy.workflow === PRIVATE_WORKFLOW &&
      policy.repository === "supermarsx/sortOfRemoteNG" &&
      policy.repositoryId === "1010282954" &&
      staticProjectionEqual(policy.qualificationRoles, PRIVATE_ROLES),
    "PRIVATE_POLICY_SCOPE",
  );
  need(
    [
      "privateAuthorityAdmitted",
      "workflowActivation",
      "publicExecuteAdmitted",
      "engineCompilationAllowed",
      "sdkAllowed",
      "nativeAcceptance",
      "runtimeReady",
      "environmentContractApproved",
    ].every((key) => policy[key] === false) &&
      policy.sourceClosureStatus === "planned-files-incomplete",
    "PRIVATE_POLICY_CLOSED",
  );
  need(
    Buffer.isBuffer(rawCandidatePolicy) &&
      rawCandidatePolicy.length > 0 &&
      rawCandidatePolicy.length <= 65536 &&
      sha(rawCandidatePolicy) === policy.baseCandidatePolicySha256,
    "PRIVATE_CANDIDATE_POLICY_PIN",
  );
  return { policy, candidate: JSON.parse(rawCandidatePolicy.toString("utf8")) };
}

function qualificationBoundedJson(raw, maximum = 4 * 1024 ** 2) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= maximum &&
      !raw.includes(0),
    "PRIVATE_JSON_BOUND",
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      raw,
    );
  } catch {
    throw new Error("PRIVATE_JSON_SYNTAX");
  }
  let at = 0;
  const space = () => {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++;
  };
  const string = () => {
    need(text[at] === '"', "PRIVATE_JSON_SYNTAX");
    const start = at++;
    let escaped = false;
    while (at < text.length) {
      const char = text[at++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        try {
          return JSON.parse(text.slice(start, at));
        } catch {
          throw new Error("PRIVATE_JSON_SYNTAX");
        }
      }
    }
    throw new Error("PRIVATE_JSON_SYNTAX");
  };
  const value = (depth) => {
    space();
    if (text[at] === '"') return string();
    if (text[at] === "[" || text[at] === "{") {
      need(depth < 32, "PRIVATE_JSON_DEPTH");
      const array = text[at++] === "[",
        end = array ? "]" : "}";
      const result = array ? [] : {},
        seen = new Set();
      space();
      if (text[at] === end) {
        at++;
        return result;
      }
      for (;;) {
        let key;
        if (!array) {
          key = string();
          space();
          need(text[at++] === ":", "PRIVATE_JSON_SYNTAX");
        }
        const entry = value(depth + 1);
        if (array) result.push(entry);
        else {
          need(!seen.has(key), "PRIVATE_JSON_DUPLICATE");
          seen.add(key);
          Object.defineProperty(result, key, {
            value: entry,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        space();
        if (text[at] === end) {
          at++;
          return result;
        }
        need(text[at++] === ",", "PRIVATE_JSON_SYNTAX");
        space();
      }
    }
    for (const [word, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ])
      if (text.startsWith(word, at)) {
        at += word.length;
        return result;
      }
    need(
      !["NaN", "Infinity", "-Infinity"].some((word) =>
        text.startsWith(word, at),
      ),
      "PRIVATE_JSON_CONSTANT",
    );
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = at;
    const match = number.exec(text);
    need(match, "PRIVATE_JSON_SYNTAX");
    at = number.lastIndex;
    return Number(match[0]);
  };
  const result = value(0);
  space();
  need(at === text.length, "PRIVATE_JSON_SYNTAX");
  return result;
}

function qualificationInspectEvaluatedArgs(raw) {
  const rows = qualificationBoundedJson(raw);
  need(
    Array.isArray(rows) && rows.length >= 1 && rows.length <= 8192,
    "PRIVATE_GN_ARGS_ROWS",
  );
  const values = {};
  for (const row of rows) {
    qualificationShape(
      row,
      Object.hasOwn(row ?? {}, "current")
        ? ["name", "default", "current"]
        : ["name", "default"],
      "PRIVATE_GN_ARG_FIELDS",
    );
    need(
      typeof row.name === "string" &&
        /^[a-z][a-z0-9_]{0,127}$/.test(row.name) &&
        !Object.hasOwn(values, row.name),
      "PRIVATE_GN_ARG_NAME",
    );
    for (const key of ["default", "current"])
      if (Object.hasOwn(row, key)) {
        qualificationShape(row[key], ["value"], "PRIVATE_GN_ARG_VALUE_FIELDS");
        need(
          typeof row[key].value === "string" &&
            qualificationStringBound(row[key].value, 65536) &&
            !row[key].value.includes("\0"),
          "PRIVATE_GN_ARG_VALUE",
        );
      }
    values[row.name] =
      row[Object.hasOwn(row, "current") ? "current" : "default"].value;
  }
  for (const [name, expected] of Object.entries(QUALIFICATION_DECLARED_ARGS))
    need(values[name] === expected, "PRIVATE_GN_ARG_CRITICAL");
  for (const [name, expected] of Object.entries(QUALIFICATION_CPU_ARGS))
    need(values[name] === expected, "PRIVATE_GN_ARG_CPU");
  return {
    kind: "windows-arm-candidate-evaluated-args",
    sha256: sha(raw),
    bytes: raw.length,
    values,
    criticalDeclaredValuesMatch: true,
    builtinCpuRowsRequired: true,
    processProvenanceVerified: false,
    executionAdmitted: false,
  };
}

function qualificationInspectAction(raw, role, rawPolicy, rawCandidatePolicy) {
  const { candidate } = qualificationPolicy(rawPolicy, rawCandidatePolicy);
  need(["partitionAlloc", "cefConfig"].includes(role), "PRIVATE_GN_DESC_ROLE");
  const expected = candidate.generatedInputs.find((row) => row.role === role),
    label = expected.label;
  const top = qualificationBoundedJson(raw, 1024 ** 2);
  qualificationShape(top, [label], "PRIVATE_GN_DESC_LABEL");
  const action = top[label];
  qualificationShape(
    action,
    [
      "type",
      "toolchain",
      "metadata",
      "visibility",
      "testonly",
      "check_includes_strict",
      "public",
      "script",
      "args",
      "outputs",
      "deps",
      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),
    ],
    "PRIVATE_GN_DESC_FIELDS",
  );
  need(
    action.type === "action" &&
      action.toolchain === QUALIFICATION_ARM_TOOLCHAIN &&
      staticProjectionEqual(action.metadata, {}) &&
      action.testonly === false &&
      typeof action.check_includes_strict === "boolean" &&
      action.public === "*",
    "PRIVATE_GN_DESC_ACTION",
  );
  need(
    Array.isArray(action.visibility) &&
      action.visibility.length >= 1 &&
      action.visibility.length <= 128 &&
      action.visibility.every(
        (item) =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= 1024 &&
          !/[^\x20-\x7e]/.test(item),
      ),
    "PRIVATE_GN_DESC_VISIBILITY",
  );
  const out = "//out/Release_GN_arm64/";
  need(
    staticProjectionEqual(action.outputs, [out + expected.relativeOutput]),
    "PRIVATE_GN_DESC_OUTPUT",
  );
  let macros = null;
  if (role === "partitionAlloc") {
    const prefix = "//base/allocator/partition_allocator/src/partition_alloc";
    need(
      action.script === prefix + "/write_buildflag_header.py" &&
        staticProjectionEqual(action.args, [
          "--output",
          "base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
          "--rulename",
          label,
          "--gen-dir",
          "gen",
          "--definitions",
          "{{response_file_name}}",
        ]) &&
        staticProjectionEqual(action.deps, [prefix + ":buildflag_macro"]),
      "PRIVATE_GN_DESC_COMMAND",
    );
    const flags = action.response_file_contents,
      names = candidate.partitionAllocMacros;
    need(
      Array.isArray(flags) &&
        flags.length === names.length + 1 &&
        flags[0] === "--flags",
      "PRIVATE_GN_DESC_FLAGS",
    );
    macros = {};
    for (const [index, name] of names.entries()) {
      const flag = flags[index + 1];
      need(
        typeof flag === "string" && flag.startsWith(name + "="),
        "PRIVATE_GN_DESC_FLAG_ORDER",
      );
      const text = flag.slice(name.length + 1);
      if (name === "USER_SPACE_ZERO_SEGMENT_SIZE_MB") {
        need(
          /^(?:0|[1-9][0-9]{0,9})$/.test(text) && Number(text) <= 2147483647,
          "PRIVATE_GN_DESC_FLAG_VALUE",
        );
        macros[name] = Number(text);
      } else {
        need(text === "true" || text === "false", "PRIVATE_GN_DESC_FLAG_VALUE");
        macros[name] = Number(text === "true");
      }
    }
  } else
    need(
      action.script === "//cef/tools/make_config_header.py" &&
        staticProjectionEqual(action.args, [
          "gen/cef/include/cef_config.h",
          "args.gn",
        ]) &&
        staticProjectionEqual(action.inputs, [out + "args.gn"]) &&
        staticProjectionEqual(action.deps, ["//cef:args_gn_source"]),
      "PRIVATE_GN_DESC_COMMAND",
    );
  return {
    kind: "windows-arm-candidate-action-desc",
    role,
    label,
    bytes: raw.length,
    sha256: sha(raw),
    toolchain: QUALIFICATION_ARM_TOOLCHAIN,
    outputs: [...action.outputs],
    evaluatedMacroValues: macros,
    actionProjectionMatches: true,
    processProvenanceVerified: false,
    fullArm64DefaultsQualified: false,
    executionAdmitted: false,
  };
}

function qualificationLines(text) {
  return text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
}
function qualificationTrim(text) {
  return text.replace(
    new RegExp(`^${QUALIFICATION_PY_SPACE}+|${QUALIFICATION_PY_SPACE}+$`, "gu"),
    "",
  );
}
function qualificationParseLiteralArgs(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= 1024 ** 2 &&
      !raw.includes(0),
    "QUAL_ARGS_BOUND",
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      raw,
    );
  } catch {
    throw new Error("QUAL_ARGS_ENCODING");
  }
  const expected = {
    ...QUALIFICATION_CPU_ARGS,
    ...QUALIFICATION_DECLARED_ARGS,
  };
  delete expected.v8_enable_sandbox;
  const values = {},
    lines = qualificationLines(text);
  for (const line of lines) {
    const stripped = qualificationTrim(line);
    if (!stripped || stripped.startsWith("#")) continue;
    const match = QUALIFICATION_GN_LITERAL.exec(line);
    need(match, "QUAL_ARGS_SYNTAX");
    const [, name, value] = match;
    need(
      !Object.hasOwn(values, name) &&
        ![
          "if",
          "else",
          "foreach",
          "true",
          "false",
          "import",
          "template",
        ].includes(name),
      "QUAL_ARGS_DUPLICATE_OR_KEYWORD",
    );
    values[name] = value;
    if (Object.hasOwn(expected, name))
      need(value === expected[name], "QUAL_ARGS_CRITICAL");
    if (name.includes("sandbox")) need(value === "true", "QUAL_ARGS_SANDBOX");
  }
  need(
    Object.keys(expected).every((name) => Object.hasOwn(values, name)),
    "QUAL_ARGS_CRITICAL",
  );
  return {
    values,
    lines,
    projection: {
      kind: "windows-arm-candidate-args",
      bytes: raw.length,
      sha256: sha(raw),
      criticalLiteralDeclarationsVerified: true,
      evaluatedGnVerified: false,
      generatedSecurityHeadersVerified: false,
      executionAdmitted: false,
    },
  };
}
function qualificationHeaderText(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= 65536 &&
      !raw.includes(0) &&
      !raw.includes(92),
    "QUAL_HEADER_BOUND",
  );
  need(
    raw.every((byte) => byte < 128),
    "QUAL_HEADER_ENCODING",
  );
  let text = raw.toString("ascii").replaceAll("\r\n", "\n");
  need(!text.includes("\r"), "QUAL_HEADER_ENCODING");
  text = text
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  need(!text.includes("/*") && !text.includes("*/"), "QUAL_HEADER_COMMENT");
  return qualificationLines(text).map(qualificationTrim).filter(Boolean);
}
function qualificationInspectCefHeader(raw) {
  need(
    staticProjectionEqual(qualificationHeaderText(raw), [
      "#ifndef CEF_INCLUDE_CEF_CONFIG_H_",
      "#define CEF_INCLUDE_CEF_CONFIG_H_",
      "#define CEF_V8_ENABLE_SANDBOX 1",
      "#endif",
    ]),
    "QUAL_CEF_CONFIG",
  );
  return {
    kind: "windows-arm-candidate-cef-config-header",
    bytes: raw.length,
    sha256: sha(raw),
    v8SandboxDeclared: true,
    executionAdmitted: false,
  };
}
function qualificationInspectPaHeader(raw, candidate, evaluatedMacros) {
  const lines = qualificationHeaderText(raw);
  need(
    staticProjectionEqual(lines.slice(0, 3), [
      "#ifndef " + QUALIFICATION_PA_GUARD,
      "#define " + QUALIFICATION_PA_GUARD,
      '#include "partition_alloc/buildflag.h"',
    ]) && staticProjectionEqual(lines.slice(-1), ["#endif"]),
    "PRIVATE_PA_HEADER",
  );
  const macros = {};
  for (const line of lines.slice(3, -1)) {
    const match =
      /^#define PA_BUILDFLAG_INTERNAL_([A-Z][A-Z0-9_]*)\(\) \((0|[1-9][0-9]{0,9})\)$/.exec(
        line,
      );
    need(match && !Object.hasOwn(macros, match[1]), "PRIVATE_PA_MACRO");
    macros[match[1]] = Number(match[2]);
  }
  need(
    staticProjectionEqual(
      Object.keys(macros),
      candidate.partitionAllocMacros,
    ) && staticProjectionEqual(macros, evaluatedMacros),
    "PRIVATE_PA_DESC_HEADER_MISMATCH",
  );
  for (const [name, expected] of Object.entries({
    ...candidate.explicitArgumentInvariants,
    ...candidate.securityPolicyMinimums,
  }))
    need(macros[name] === expected, "PRIVATE_PA_SECURITY_MINIMUM");
  return macros;
}

function qualificationInspectCoff(raw) {
  need(
    Buffer.isBuffer(raw) && raw.length >= 20 && raw.length <= 8 * 1024 ** 2,
    "QUAL_COFF_BOUND",
  );
  const machine = raw.readUInt16LE(0),
    sections = raw.readUInt16LE(2),
    symbolsAt = raw.readUInt32LE(8),
    symbols = raw.readUInt32LE(12),
    optional = raw.readUInt16LE(16),
    flags = raw.readUInt16LE(18);
  need(
    machine === 0xaa64 &&
      optional === 0 &&
      sections >= 1 &&
      sections <= 96 &&
      !(flags & 0x2000) &&
      20 + sections * 40 <= raw.length,
    "QUAL_COFF_HEADER",
  );
  for (let index = 0; index < sections; index++) {
    const at = 20 + index * 40,
      size = raw.readUInt32LE(at + 16),
      offset = raw.readUInt32LE(at + 20);
    need(
      size === 0 ||
        (offset >= 20 + sections * 40 && offset + size <= raw.length),
      "QUAL_COFF_SECTION",
    );
  }
  if (symbolsAt || symbols) {
    qualificationInteger(symbols, 0, 100000, "QUAL_COFF_SYMBOLS");
    const end = symbolsAt + symbols * 18;
    need(
      symbolsAt >= 20 + sections * 40 && end + 4 <= raw.length,
      "QUAL_COFF_SYMBOLS",
    );
    const strings = raw.readUInt32LE(end);
    need(strings >= 4 && end + strings <= raw.length, "QUAL_COFF_SYMBOLS");
  }
  return {
    kind: "windows-arm-candidate-coff",
    machine,
    sections,
    bytes: raw.length,
    sha256: sha(raw),
    structureOnly: true,
    executionAdmitted: false,
  };
}
function qualificationInspectProbePe(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length >= 64 &&
      raw.length <= 8 * 1024 ** 2 &&
      raw.toString("ascii", 0, 2) === "MZ",
    "QUAL_PE_BOUND",
  );
  const offset = raw.readUInt32LE(60);
  need(
    offset >= 64 &&
      offset <= raw.length - 264 &&
      raw.readUInt32LE(offset) === 0x00004550,
    "QUAL_PE_OFFSET",
  );
  const machine = raw.readUInt16LE(offset + 4),
    sections = raw.readUInt16LE(offset + 6),
    optional = raw.readUInt16LE(offset + 20),
    flags = raw.readUInt16LE(offset + 22);
  need(
    machine === 0xaa64 &&
      sections >= 1 &&
      sections <= 96 &&
      optional === 240 &&
      (flags & 2) !== 0 &&
      !(flags & (0x100 | 0x2000)),
    "QUAL_PE_HEADER",
  );
  const header = offset + 24;
  need(
    raw.readUInt16LE(header) === 0x20b &&
      raw.readUInt16LE(header + 68) === 3 &&
      raw.readUInt32LE(header + 108) === 16,
    "QUAL_PE_OPTIONAL",
  );
  for (const directory of [1, 12, 13, 14])
    need(
      raw.readUInt32LE(header + 112 + directory * 8) === 0 &&
        raw.readUInt32LE(header + 116 + directory * 8) === 0,
      "QUAL_PE_IMPORTS",
    );
  const table = header + optional,
    entry = raw.readUInt32LE(header + 16);
  need(table + sections * 40 <= raw.length, "QUAL_PE_SECTIONS");
  let executable = 0;
  for (let index = 0; index < sections; index++) {
    const at = table + index * 40,
      virtualSize = raw.readUInt32LE(at + 8),
      address = raw.readUInt32LE(at + 12),
      size = raw.readUInt32LE(at + 16),
      fileAt = raw.readUInt32LE(at + 20),
      sectionFlags = raw.readUInt32LE(at + 36);
    need(
      size === 0 ||
        (fileAt >= table + sections * 40 && fileAt + size <= raw.length),
      "QUAL_PE_SECTION",
    );
    if (
      size > 0 &&
      address <= entry &&
      entry < address + Math.min(virtualSize, size) &&
      sectionFlags & 0x20000000
    )
      executable++;
  }
  need(entry > 0 && executable === 1, "QUAL_PE_ENTRY");
  return {
    kind: "windows-arm-candidate-pe",
    machine,
    sections,
    bytes: raw.length,
    sha256: sha(raw),
    structureOnly: true,
    outputExecuted: false,
    executionAdmitted: false,
  };
}

function qualificationInspectContext(
  context,
  rawPolicy,
  rawCandidatePolicy,
  wallNow,
  monotonicNow,
) {
  requirePrivateScope(context);
  const { policy, candidate } = qualificationPolicy(
    rawPolicy,
    rawCandidatePolicy,
  );
  qualificationShape(
    context,
    [
      "kind",
      "mode",
      "ref",
      "workflow",
      "repository",
      "repositoryId",
      "visibility",
      "event",
      "head",
      "workflowSha",
      "image",
      "host",
      "root",
      "source",
      "sources",
      "sourceDigest",
      "bindings",
      "wallWorkEnd",
      "monotonicWorkEnd",
    ],
    "PRIVATE_CONTEXT_FIELDS",
  );
  need(
    context.kind === "windows-arm-private-input-projection" &&
      typeof context.head === "string" &&
      /^[a-f0-9]{40}$/.test(context.head) &&
      context.head === context.workflowSha,
    "PRIVATE_CONTEXT_HEAD",
  );
  need(
    typeof context.image === "string" &&
      Object.hasOwn(policy.images, context.image) &&
      staticProjectionEqual(context.host, {
        platform: "win32",
        architecture: "x64",
        runner: policy.runner,
      }),
    "PRIVATE_HOST_IMAGE",
  );
  need(
    typeof context.root === "string" && PRIVATE_ROOT.test(context.root),
    "PRIVATE_ROOT",
  );
  const selected = policy.images[context.image];
  need(
    staticProjectionEqual(context.source, {
      target: "aarch64-pc-windows-msvc",
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    }),
    "PRIVATE_SOURCE_SCOPE",
  );
  need(
    Array.isArray(context.sources) &&
      context.sources.length === policy.sourcePaths.length,
    "PRIVATE_SOURCE_TUPLE",
  );
  for (const [index, row] of context.sources.entries()) {
    qualificationShape(
      row,
      [
        "path",
        "bytes",
        "sha256",
        "canonicalBytes",
        "canonicalSha256",
        "encoding",
      ],
      "PRIVATE_SOURCE_FIELDS",
    );
    need(row.path === policy.sourcePaths[index], "PRIVATE_SOURCE_TUPLE");
    for (const key of ["bytes", "canonicalBytes"])
      qualificationInteger(row[key], 1, 2 * 1024 ** 2, "PRIVATE_SOURCE_BOUND");
    for (const key of ["sha256", "canonicalSha256"])
      need(
        typeof row[key] === "string" && /^[a-f0-9]{64}$/.test(row[key]),
        "PRIVATE_SOURCE_HASH",
      );
    need(
      row.encoding === "exact" ||
        (row.encoding === "git-crlf" && policy.crlfPositions.includes(index)),
      "PRIVATE_SOURCE_ENCODING",
    );
    need(
      row.encoding === "exact"
        ? row.bytes === row.canonicalBytes && row.sha256 === row.canonicalSha256
        : row.bytes >= row.canonicalBytes &&
            row.bytes - row.canonicalBytes <= row.canonicalBytes,
      "PRIVATE_SOURCE_ENCODING",
    );
  }
  need(
    typeof context.sourceDigest === "string" &&
      /^[a-f0-9]{64}$/.test(context.sourceDigest) &&
      sha(Buffer.from(qualificationCanonical(context.sources))) ===
        context.sourceDigest,
    "PRIVATE_SOURCE_DIGEST",
  );
  const bindings = context.bindings,
    out = context.root + "/source-checkout/src/out/Release_GN_arm64";
  qualificationShape(
    bindings,
    ["args", "graph", "graphInventory", "tools"],
    "PRIVATE_BINDING_FIELDS",
  );
  const pin = (row, file, expected) => {
    qualificationShape(row, ["path", "bytes", "sha256"], "PRIVATE_FILE_FIELDS");
    need(
      row.path === file &&
        Number.isSafeInteger(row.bytes) &&
        row.bytes > 0 &&
        row.bytes <= 256 * 1024 ** 2 &&
        typeof row.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(row.sha256),
      "PRIVATE_FILE_PIN",
    );
    if (expected)
      need(
        row.bytes === expected.bytes && row.sha256 === expected.sha256,
        "PRIVATE_TOOL_PIN",
      );
  };
  pin(bindings.args, out + "/args.gn");
  pin(bindings.graph, out + "/build.ninja");
  const inventory = bindings.graphInventory;
  qualificationShape(
    inventory,
    ["files", "visited", "bytes", "sha256"],
    "PRIVATE_GRAPH_FIELDS",
  );
  need(
    Number.isSafeInteger(inventory.files) &&
      inventory.files >= 1 &&
      inventory.files <= 50000 &&
      Number.isSafeInteger(inventory.visited) &&
      inventory.visited >= inventory.files &&
      inventory.visited <= 300000 &&
      Number.isSafeInteger(inventory.bytes) &&
      inventory.bytes > 0 &&
      inventory.bytes <= 8 * 1024 ** 3 &&
      typeof inventory.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(inventory.sha256),
    "PRIVATE_GRAPH_BOUND",
  );
  qualificationShape(
    bindings.tools,
    Object.keys(policy.tools),
    "PRIVATE_TOOL_FIELDS",
  );
  for (const [role, expected] of Object.entries(policy.tools))
    pin(
      bindings.tools[role],
      expected.path ?? context.root + "/" + expected.relativePath,
      expected,
    );
  need(
    [
      context.wallWorkEnd,
      context.monotonicWorkEnd,
      wallNow,
      monotonicNow,
    ].every((value) => typeof value === "number" && Number.isFinite(value)),
    "PRIVATE_CLOCK",
  );
  const remaining = Math.min(
    context.wallWorkEnd - wallNow,
    context.monotonicWorkEnd - monotonicNow,
  );
  need(remaining > 150 && remaining <= 7200, "PRIVATE_DEADLINE");
  return { policy, candidate };
}

function qualificationInspectOutputs(
  context,
  rawPolicy,
  rawCandidatePolicy,
  observations,
  wallNow,
  monotonicNow,
) {
  const { policy, candidate } = qualificationInspectContext(
    context,
    rawPolicy,
    rawCandidatePolicy,
    wallNow,
    monotonicNow,
  );
  qualificationShape(
    observations,
    ["gnDescPartitionAlloc", "gnDescCef", "gnArgs", "files"],
    "PRIVATE_OUTPUT_FIELDS",
  );
  const pa = qualificationInspectAction(
    observations.gnDescPartitionAlloc,
    "partitionAlloc",
    rawPolicy,
    rawCandidatePolicy,
  );
  const cef = qualificationInspectAction(
    observations.gnDescCef,
    "cefConfig",
    rawPolicy,
    rawCandidatePolicy,
  );
  const evaluated = qualificationInspectEvaluatedArgs(observations.gnArgs),
    root = context.root;
  const out = root + "/source-checkout/src/out/Release_GN_arm64/";
  const paths = {
    args: out + "args.gn",
    partitionAlloc: out + candidate.generatedInputs[0].relativeOutput,
    cefConfig: out + candidate.generatedInputs[1].relativeOutput,
    coff: root + "/private-qualification/probe.obj",
    pe: root + "/private-qualification/probe.exe",
  };
  const files = observations.files;
  qualificationShape(files, Object.keys(paths), "PRIVATE_OUTPUT_FILE_FIELDS");
  for (const [role, file] of Object.entries(paths)) {
    const row = files[role];
    qualificationShape(row, ["pin", "raw"], "PRIVATE_OUTPUT_CANDIDATE");
    qualificationShape(
      row.pin,
      ["path", "bytes", "sha256"],
      "PRIVATE_OUTPUT_PIN_FIELDS",
    );
    need(
      Buffer.isBuffer(row.raw) &&
        row.raw.length > 0 &&
        row.raw.length <= 8 * 1024 ** 2 &&
        Number.isSafeInteger(row.pin.bytes) &&
        row.pin.path === file &&
        row.pin.bytes === row.raw.length &&
        row.pin.sha256 === sha(row.raw),
      "PRIVATE_OUTPUT_PIN",
    );
  }
  need(
    staticProjectionEqual(files.args.pin, context.bindings.args),
    "PRIVATE_OUTPUT_ARGS_CHANGED",
  );
  const literal = qualificationParseLiteralArgs(files.args.raw);
  need(
    literal.lines.includes('target_cpu="arm64"'),
    "PRIVATE_CEF_GENERATOR_CPU_LINE",
  );
  const cefHeader = qualificationInspectCefHeader(files.cefConfig.raw),
    coff = qualificationInspectCoff(files.coff.raw),
    pe = qualificationInspectProbePe(files.pe.raw);
  const macros = qualificationInspectPaHeader(
    files.partitionAlloc.raw,
    candidate,
    pa.evaluatedMacroValues,
  );
  for (const [name, value] of Object.entries(literal.values))
    if (Object.hasOwn(evaluated.values, name))
      need(
        value === evaluated.values[name],
        "PRIVATE_LITERAL_EVALUATED_MISMATCH",
      );
  return {
    kind: "windows-arm-private-output-candidate",
    source: structuredClone(context.source),
    image: context.image,
    inputBindings: structuredClone(context.bindings),
    privatePolicySha256: sha(rawPolicy),
    inertPolicySha256: sha(rawCandidatePolicy),
    argumentSchemaSource: { ...QUALIFICATION_GN_ARGUMENT_SOURCE },
    metadata: { partitionAlloc: pa, cefConfig: cef, arguments: evaluated },
    literalArguments: literal.projection,
    partitionAllocMacros: macros,
    cefHeader,
    coff,
    pe,
    filePins: Object.fromEntries(
      Object.entries(files).map(([role, row]) => [role, { ...row.pin }]),
    ),
    policyMinimumsMet: true,
    evaluatedMetadataProjectionMatches: true,
    completeMacroInventoryMatches: true,
    fullArm64DefaultsQualified: false,
    processProvenanceVerified: false,
    liveJobCapability: false,
    generatedSecurityHeadersVerified: false,
    executionAdmitted: false,
    outputsExecuted: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    missing: [...policy.missingBeforePrivateActivation],
  };
}
// END INACTIVE PURE QUALIFICATION INSPECTORS

// BEGIN INACTIVE SOURCE OWNED COORDINATOR
// Only privateSourceBody calls begin/collect/commit. These maps have no public
// setter, diagnostic reader or environment/JSON rehydration path. The source
// entry, Python adapter and policy gates remain independently closed.
const qualificationSourceOwners = new WeakMap();
const qualificationGraphReceipts = new WeakMap();
const qualificationCoordinatorSources = new WeakSet();

function beginQualificationSource(input) {
  const began = performance.now(),
    phase = qualificationPhaseClock(input.budget);
  const owner = Object.freeze({ kind: "private-source-operation" });
  const state = {
    ...input,
    c: structuredClone(input.c),
    privatePolicyRaw: Buffer.from(input.privatePolicyRaw),
    phase,
    end: began + phase.maximumWorkMs,
    retired: false,
    failed: false,
    primary: undefined,
    epoch: 0,
    graphPending: null,
    graphReceipt: null,
    sourceToken: null,
    collecting: false,
    sessions: new Set(),
    directoryIdentities: new Map(),
  };
  qualificationSourceOwners.set(owner, state);
  qualificationOwnerCheck(owner);
  return owner;
}

function qualificationOwnerCheck(owner) {
  const state = qualificationSourceOwners.get(owner);
  need(state, "PRIVATE_SOURCE_OWNER");
  if (state.failed) throw state.primary;
  try {
    need(!state.retired && !state.signal?.aborted, "PRIVATE_SOURCE_RETIRED");
    state.phase.observe();
    need(performance.now() < state.end, "PRIVATE_PHASE_DEADLINE");
    return state;
  } catch (error) {
    retireQualificationSource(owner, true, error);
    throw state.primary;
  }
}

function retireQualificationSource(owner, failed = false, error) {
  const state = qualificationSourceOwners.get(owner);
  if (!state) return;
  // Revoke BEFORE any awaited close/reporting. A pending read/close/callback
  // can settle later but can neither republish a receipt nor resume a role.
  if (failed && !state.failed) {
    state.failed = true;
    state.primary = error;
  }
  if (state.retired) return;
  state.retired = true;
  state.epoch++;
  state.graphPending = null;
  if (state.graphReceipt) qualificationGraphReceipts.delete(state.graphReceipt);
  if (state.sourceToken) {
    qualificationSourceRuns.delete(state.sourceToken);
    qualificationCoordinatorSources.delete(state.sourceToken);
  }
  for (const session of state.sessions) {
    qualificationSessions.delete(session.token);
    session.closed = true;
    session.epoch++;
    if (failed && !session.failed) {
      session.failed = true;
      session.primary = state.primary;
      session.failedAt = performance.now();
    }
  }
}

async function qualificationOwnerAwait(owner, operation) {
  const state = qualificationSourceOwners.get(owner);
  const observed = Promise.resolve(operation);
  observed.catch(() => {});
  let timer;
  try {
    qualificationOwnerCheck(owner);
    const result = await Promise.race([
      observed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PRIVATE_PHASE_DEADLINE")),
          Math.max(1, Math.ceil(state.end - performance.now())),
        );
      }),
    ]);
    qualificationOwnerCheck(owner);
    return result;
  } catch (error) {
    retireQualificationSource(owner, true, error);
    throw state?.failed ? state.primary : error;
  } finally {
    clearTimeout(timer);
  }
}

async function collectQualificationGraph(owner) {
  const state = qualificationOwnerCheck(owner);
  need(
    !state.collecting && state.graphPending === null,
    "PRIVATE_GRAPH_REPEAT",
  );
  state.collecting = true;
  const epoch = state.epoch;
  let calls = 0,
    callbackFailed = false,
    callbackError,
    snapshot;
  const observePins = (value) => {
    try {
      qualificationOwnerCheck(owner);
      need(state.epoch === epoch && ++calls === 1, "PRIVATE_GRAPH_CALLBACK");
      // graphPinSnapshot is a pure canonical string projection, not a brand.
      // Copy its data synchronously BEFORE the callback's first possible await.
      snapshot = JSON.parse(state.checkpoint.graphPinSnapshot(value));
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
      retireQualificationSource(owner, true, error);
      throw error;
    }
  };
  try {
    const summary = await qualificationOwnerAwait(
      owner,
      state.checked(async () => {
        await qualificationSourceDirectories(owner);
        qualificationOwnerCheck(owner);
        const result = await qualificationOwnerAwait(
          owner,
          state.checkpoint.graphInventory(
            path.join(state.files.chromium, "out/Release_GN_arm64"),
            {
              timeoutMs: Math.max(
                1,
                Math.floor(Math.min(180000, state.end - performance.now())),
              ),
              observePins,
            },
          ),
        );
        if (callbackFailed) throw callbackError;
        await qualificationSourceDirectories(owner);
        need(
          calls === 1 &&
            snapshot &&
            snapshot.complete === true &&
            snapshot.kind === "sorng-cef-fresh-graph-pins" &&
            snapshot.sha256 === result.sha256 &&
            snapshot.files === result.files &&
            snapshot.bytes === result.bytes,
          "PRIVATE_GRAPH_SUMMARY",
        );
        return structuredClone(result);
      }),
    );
    await qualificationSourceDirectories(owner);
    qualificationOwnerCheck(owner);
    need(state.epoch === epoch && calls === 1, "PRIVATE_GRAPH_CALLBACK");
    // This is still pending until the enclosing source stage/postchecks return.
    state.graphPending = { summary, snapshot, epoch };
    return {
      summary: structuredClone(summary),
      diagnostic: JSON.stringify(snapshot),
    };
  } catch (error) {
    retireQualificationSource(owner, true, error);
    throw state.failed ? state.primary : error;
  }
}

function commitQualificationGraph(owner) {
  const state = qualificationOwnerCheck(owner),
    pending = state.graphPending;
  need(
    pending &&
      pending.epoch === state.epoch &&
      !state.graphReceipt &&
      !state.sourceToken,
    "PRIVATE_GRAPH_COMMIT",
  );
  const graphReceipt = Object.freeze({ kind: "private-fresh-graph" });
  qualificationGraphReceipts.set(graphReceipt, {
    owner,
    state,
    epoch: state.epoch,
    snapshot: pending.snapshot,
    summary: pending.summary,
  });
  state.graphReceipt = graphReceipt;
  const sourceToken = Object.freeze({ kind: "private-source-run" });
  state.sourceToken = sourceToken;
  const source = {
    owner,
    root: state.root,
    policyImage: state.p.image,
    context: { ...state.c, root: state.root.replaceAll("\\", "/") },
    contextSha: state.contextSha,
    budget: state.budget,
    phase: state.phase,
    end: state.end,
    signal: state.signal,
    sessions: state.sessions,
    privatePolicyRaw: Buffer.from(state.privatePolicyRaw),
    custom: state.custom,
    gitPolicy: state.gitPolicy,
    environment: state.env,
    output: state.output,
    validateBefore: () => validateQualificationSource(owner),
    validateAfter: async (role) => {
      await validateQualificationSource(owner);
      qualificationOwnerCheck(owner);
      await qualificationPostInputs(owner, role);
      qualificationOwnerCheck(owner);
    },
  };
  qualificationSourceRuns.set(sourceToken, source);
  return sourceToken;
}

async function qualificationPostInputs(owner, role) {
  const state = qualificationOwnerCheck(owner);
  try {
    const active = [...state.sessions].find((session) => !session.closed);
    need(
      active?.running && PRIVATE_ROLES[active.next] === role,
      "PRIVATE_POSTREAD_ROLE",
    );
    const policy = JSON.parse(state.privatePolicyRaw);
    need(
      sha(state.privatePolicyRaw) === PRIVATE_PROFILE_SHA256,
      "PRIVATE_POLICY_PIN",
    );
    const rows = [
      ...Object.values(policy.tools).map((pin) => ({
        file: pin.path ?? path.join(state.root, pin.relativePath),
        pin,
      })),
      {
        file: path.join(state.root, "archives/clang.tar.xz"),
        pin: policy.staticLoadingPolicy.llvmArchive,
      },
      ...QUALIFICATION_PATCHED_INPUTS.map((pin) => ({
        file: path.join(state.root, pin.relative),
        pin,
      })),
      {
        file: path.join(REPO, policy.probeSource),
        pin: {
          bytes: 2651,
          sha256:
            "0e291acd6f1fdcbd7f79d2874e760927e92bc13eeab241016bb87878867f9220",
        },
      },
    ];
    for (const { file, pin } of rows) {
      qualificationOwnerCheck(owner);
      // Same byte pins imply the same prechecked static projection; this reread
      // streams the actual FD rather than buffering another executable image.
      await qualificationHeld(file, pin, active);
      qualificationOwnerCheck(owner);
    }
    await qualificationNoAdjacentDlls(active);
    qualificationOwnerCheck(owner);
  } catch (error) {
    retireQualificationSource(owner, true, error);
    throw state.primary;
  }
}

async function qualificationSourceDirectories(owner) {
  const state = qualificationOwnerCheck(owner);
  for (const directory of [
    state.root,
    state.files.chromium,
    path.join(state.files.chromium, "out/Release_GN_arm64"),
  ]) {
    qualificationOwnerCheck(owner);
    await qualificationOwnerAwait(owner, physical(directory));
    const info = await qualificationOwnerAwait(
      owner,
      fs.lstat(directory, { bigint: true }),
    );
    need(
      info.isDirectory() && !info.isSymbolicLink(),
      "PRIVATE_SOURCE_DIRECTORY",
    );
    const identity = qualificationStableFile(info);
    if (state.directoryIdentities.has(directory))
      need(
        state.directoryIdentities.get(directory) === identity,
        "PRIVATE_SOURCE_DIRECTORY_CHANGED",
      );
    else state.directoryIdentities.set(directory, identity);
  }
  qualificationOwnerCheck(owner);
}

async function validateQualificationSource(owner) {
  const state = qualificationOwnerCheck(owner);
  const receipt = qualificationGraphReceipts.get(state.graphReceipt);
  need(
    receipt?.owner === owner &&
      receipt.state === state &&
      receipt.epoch === state.epoch,
    "PRIVATE_GRAPH_RECEIPT",
  );
  await qualificationOwnerAwait(
    owner,
    state.checked(async () => {
      await qualificationSourceDirectories(owner);
      for (const [index, row] of state.c.sources.entries()) {
        qualificationOwnerCheck(owner);
        await qualificationOwnerAwait(
          owner,
          held(path.join(REPO, row.path), 2 * 1024 ** 2, state.budget, row),
        );
        await qualificationOwnerAwait(
          owner,
          held(
            path.join(state.root, "source-inputs", String(index)),
            2 * 1024 ** 2,
            state.budget,
            row,
          ),
        );
      }
      let snapshot,
        callbackFailed = false,
        callbackError;
      const result = await qualificationOwnerAwait(
        owner,
        state.checkpoint.graphInventory(
          path.join(state.files.chromium, "out/Release_GN_arm64"),
          {
            timeoutMs: Math.max(
              1,
              Math.floor(Math.min(180000, state.end - performance.now())),
            ),
            observePins(value) {
              try {
                qualificationOwnerCheck(owner);
                need(snapshot === undefined, "PRIVATE_GRAPH_CALLBACK");
                snapshot = state.checkpoint.graphPinSnapshot(value);
              } catch (error) {
                callbackFailed = true;
                callbackError = error;
                retireQualificationSource(owner, true, error);
                throw error;
              }
            },
          },
        ),
      );
      if (callbackFailed) throw callbackError;
      need(
        snapshot === JSON.stringify(receipt.snapshot) ||
          (snapshot !== undefined &&
            staticProjectionEqual(JSON.parse(snapshot), receipt.snapshot)),
        "PRIVATE_GRAPH_CHANGED",
      );
      need(
        staticProjectionEqual(result, receipt.summary),
        "PRIVATE_GRAPH_CHANGED",
      );
      await qualificationSourceDirectories(owner);
    }),
  );
  qualificationOwnerCheck(owner);
}

function qualificationInspectMetadata(
  context,
  rawPolicy,
  rawCandidatePolicy,
  observations,
  wallNow,
  monotonicNow,
) {
  const { candidate } = qualificationInspectContext(
    context,
    rawPolicy,
    rawCandidatePolicy,
    wallNow,
    monotonicNow,
  );
  qualificationShape(
    observations,
    ["gnDescPartitionAlloc", "gnDescCef", "gnArgs", "files"],
    "PRIVATE_OUTPUT_FIELDS",
  );
  const pa = qualificationInspectAction(
    observations.gnDescPartitionAlloc,
    "partitionAlloc",
    rawPolicy,
    rawCandidatePolicy,
  );
  const cef = qualificationInspectAction(
    observations.gnDescCef,
    "cefConfig",
    rawPolicy,
    rawCandidatePolicy,
  );
  const evaluated = qualificationInspectEvaluatedArgs(observations.gnArgs);
  const out = context.root + "/source-checkout/src/out/Release_GN_arm64/";
  const files = observations.files,
    paths = {
      args: out + "args.gn",
      partitionAlloc: out + candidate.generatedInputs[0].relativeOutput,
      cefConfig: out + candidate.generatedInputs[1].relativeOutput,
    };
  qualificationShape(files, Object.keys(paths), "PRIVATE_METADATA_FILE_FIELDS");
  for (const [role, file] of Object.entries(paths)) {
    const row = files[role];
    qualificationShape(row, ["pin", "raw"], "PRIVATE_OUTPUT_CANDIDATE");
    qualificationShape(
      row.pin,
      ["path", "bytes", "sha256"],
      "PRIVATE_OUTPUT_PIN_FIELDS",
    );
    need(
      Buffer.isBuffer(row.raw) &&
        row.raw.length > 0 &&
        row.raw.length <= 8 * 1024 ** 2 &&
        row.pin.path === file &&
        row.pin.bytes === row.raw.length &&
        row.pin.sha256 === sha(row.raw),
      "PRIVATE_OUTPUT_PIN",
    );
  }
  need(
    staticProjectionEqual(files.args.pin, context.bindings.args),
    "PRIVATE_OUTPUT_ARGS_CHANGED",
  );
  const literal = qualificationParseLiteralArgs(files.args.raw);
  need(
    literal.lines.includes('target_cpu="arm64"'),
    "PRIVATE_CEF_GENERATOR_CPU_LINE",
  );
  const cefHeader = qualificationInspectCefHeader(files.cefConfig.raw);
  const macros = qualificationInspectPaHeader(
    files.partitionAlloc.raw,
    candidate,
    pa.evaluatedMacroValues,
  );
  for (const [name, value] of Object.entries(literal.values))
    if (Object.hasOwn(evaluated.values, name))
      need(
        value === evaluated.values[name],
        "PRIVATE_LITERAL_EVALUATED_MISMATCH",
      );
  return {
    metadata: { partitionAlloc: pa, cefConfig: cef, arguments: evaluated },
    literalArguments: literal.projection,
    partitionAllocMacros: macros,
    cefHeader,
    policyMinimumsMet: true,
    completeMacroInventoryMatches: true,
    fullArm64DefaultsQualified: false,
    compilerExecuted: false,
    cohortQuietProven: false,
    executionAdmitted: false,
  };
}

async function qualificationReadLog(owner, session, index) {
  const state = qualificationOwnerCheck(owner),
    current = qualificationSessions.get(session);
  need(
    current?.sourceToken === state.sourceToken && current.next > index,
    "PRIVATE_METADATA_ROLE",
  );
  await qualificationLogDirectory(current);
  qualificationOwnerCheck(owner);
  const file = path.join(
    state.root,
    "private-qualification-logs",
    PRIVATE_ROLES[index] + ".stdout.log",
  );
  const raw = Buffer.from(
    await qualificationOwnerAwait(
      owner,
      held(file, index < 2 ? 1048576 : 4194304, state.budget),
    ),
  );
  await qualificationLogDirectory(current);
  qualificationOwnerCheck(owner);
  return raw;
}

async function qualificationCandidatePolicy(owner) {
  const state = qualificationOwnerCheck(owner);
  const raw = Buffer.from(
    await qualificationOwnerAwait(
      owner,
      held(
        path.join(HERE, "engine-qualification-profile.json"),
        65536,
        state.budget,
      ),
    ),
  );
  need(
    sha(raw) === state.p.privatePolicy.baseCandidatePolicySha256,
    "PRIVATE_BASE_POLICY_PIN",
  );
  qualificationOwnerCheck(owner);
  return raw;
}

async function qualificationMetadataObservation(owner, session) {
  const state = qualificationOwnerCheck(owner),
    source = qualificationSourceRuns.get(state.sourceToken);
  need(
    source && qualificationSessions.get(session)?.source === source,
    "PRIVATE_SOURCE_RUN",
  );
  const graph = qualificationGraphReceipts.get(state.graphReceipt);
  need(graph?.owner === owner, "PRIVATE_GRAPH_RECEIPT");
  const root = state.root.replaceAll("\\", "/"),
    out = root + "/source-checkout/src/out/Release_GN_arm64/";
  const row = async (file, maximum) => {
    qualificationOwnerCheck(owner);
    const raw = Buffer.from(
      await qualificationOwnerAwait(owner, held(file, maximum, state.budget)),
    );
    return { raw, pin: { path: file, bytes: raw.length, sha256: sha(raw) } };
  };
  const files = {};
  files.args = await row(out + "args.gn", 1024 ** 2);
  for (const [role, item] of [
    ["partitionAlloc", state.p.privatePolicy.generatedInputs[0]],
    ["cefConfig", state.p.privatePolicy.generatedInputs[1]],
  ])
    files[role] = await row(out + item.relativeOutput, 8 * 1024 ** 2);
  const gnDescPartitionAlloc = await qualificationReadLog(owner, session, 0),
    gnDescCef = await qualificationReadLog(owner, session, 1),
    gnArgs = await qualificationReadLog(owner, session, 2);
  const policy = state.p.privatePolicy,
    selected = policy.images[state.p.image];
  const original = (name) =>
    graph.snapshot.pins.find((pin) => pin.path === name);
  for (const name of ["args.gn", "build.ninja"])
    need(original(name), "PRIVATE_GRAPH_INCOMPLETE");
  const projectionPin = (name) => ({
    path: out + name,
    bytes: original(name).bytes,
    sha256: original(name).sha256,
  });
  const remaining = state.budget.remaining() / 1000;
  const context = {
    kind: "windows-arm-private-input-projection",
    mode: state.c.mode,
    ref: state.c.ref,
    workflow: state.c.workflow,
    repository: state.c.repository,
    repositoryId: state.c.repositoryId,
    visibility: state.c.visibility,
    event: state.c.event,
    head: state.c.head,
    workflowSha: state.c.workflowSha,
    image: state.p.image,
    host: {
      platform: process.platform,
      architecture: process.arch,
      runner: policy.runner,
    },
    root,
    source: {
      target: TARGET,
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    },
    sources: structuredClone(state.c.sources),
    sourceDigest: sha(Buffer.from(qualificationCanonical(state.c.sources))),
    bindings: {
      args: projectionPin("args.gn"),
      graph: projectionPin("build.ninja"),
      graphInventory: structuredClone(graph.summary),
      tools: Object.fromEntries(
        Object.entries(policy.tools).map(([role, pin]) => [
          role,
          {
            path: pin.path ?? root + "/" + pin.relativePath,
            bytes: pin.bytes,
            sha256: pin.sha256,
          },
        ]),
      ),
    },
    wallWorkEnd: Math.min(state.c.wallWorkEnd, Date.now() / 1000 + remaining),
    monotonicWorkEnd: performance.now() / 1000 + remaining,
  };
  qualificationOwnerCheck(owner);
  const candidateRaw = await qualificationCandidatePolicy(owner);
  qualificationOwnerCheck(owner);
  return qualificationInspectMetadata(
    context,
    state.privatePolicyRaw,
    candidateRaw,
    { gnDescPartitionAlloc, gnDescCef, gnArgs, files },
    Date.now() / 1000,
    performance.now() / 1000,
  );
}

async function coordinateQualification(sourceToken) {
  const source = qualificationSourceRuns.get(sourceToken);
  need(source, "PRIVATE_SOURCE_RUN");
  const owner = source.owner,
    state = qualificationOwnerCheck(owner);
  let failed = false,
    primary;
  try {
    need(
      state.p.privatePolicy.environmentContractApproved === true,
      "PRIVATE_ENVIRONMENT_UNAVAILABLE",
    );
    await qualificationOwnerAwait(owner, validateQualificationSource(owner));
    for (const relative of [
      "private-qualification",
      "private-qualification-tmp",
      "private-qualification-logs",
    ]) {
      qualificationOwnerCheck(owner);
      await qualificationOwnerAwait(
        owner,
        fs.mkdir(path.join(source.root, relative), { mode: 0o700 }),
      );
    }
    qualificationOwnerCheck(owner);
    const logs = await qualificationOwnerAwait(
      owner,
      fs.lstat(path.join(source.root, "private-qualification-logs"), {
        bigint: true,
      }),
    );
    source.logsIdentity = signature(logs);
    qualificationCoordinatorSources.add(sourceToken);
    const session = createQualificationSession(sourceToken);
    const candidateRaw = await qualificationCandidatePolicy(owner);
    for (const [index, role] of PRIVATE_ROLES.slice(0, 4).entries()) {
      const observation = await issueActualObservation(session, role);
      qualificationOwnerCheck(owner);
      await runFixedJoined(session, role, observation);
      qualificationOwnerCheck(owner);
      // Check action metadata/evaluated args BEFORE Siso can generate files.
      if (index < 2)
        qualificationInspectAction(
          await qualificationReadLog(owner, session, index),
          index === 0 ? "partitionAlloc" : "cefConfig",
          state.privatePolicyRaw,
          candidateRaw,
        );
      else if (index === 2) {
        const evaluated = qualificationInspectEvaluatedArgs(
          await qualificationReadLog(owner, session, index),
        );
        const original = qualificationGraphReceipts
          .get(state.graphReceipt)
          .snapshot.pins.find((pin) => pin.path === "args.gn");
        need(original, "PRIVATE_GRAPH_INCOMPLETE");
        const literal = qualificationParseLiteralArgs(
          await qualificationOwnerAwait(
            owner,
            held(
              path.join(state.files.chromium, "out/Release_GN_arm64/args.gn"),
              1024 ** 2,
              state.budget,
              original,
            ),
          ),
        );
        for (const [name, value] of Object.entries(literal.values))
          if (Object.hasOwn(evaluated.values, name))
            need(
              value === evaluated.values[name],
              "PRIVATE_LITERAL_EVALUATED_MISMATCH",
            );
      }
      qualificationOwnerCheck(owner);
    }
    await qualificationMetadataObservation(owner, session);
    qualificationOwnerCheck(owner);
    // No flag, matching policy minimum or same-operation observation can
    // override the missing independent full61 ARM default qualification.
    throw new Error("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED");
  } catch (error) {
    failed = true;
    primary = error;
    retireQualificationSource(owner, true, error);
    throw state.failed ? state.primary : error;
  } finally {
    retireQualificationSource(owner, failed, primary);
  }
}
// END INACTIVE SOURCE OWNED COORDINATOR

export async function main(argv = process.argv.slice(2)) {
  need(
    argv.length === 4 &&
      argv[0] === "--private-source-gn" &&
      typeof argv[1] === "string" &&
      PRIVATE_ROOT.test(argv[1]) &&
      typeof argv[2] === "string" &&
      /^[a-f0-9]{64}$/.test(argv[2]) &&
      argv[3] === "--execute",
    "PRIVATE_DRIVER_ARGV",
  );
  // A code-pinned false gate stops before input FS or optional helper imports.
  need(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED");
  return privateSourceBody(argv);
}

// BEGIN CLOSED FULL SDK SOURCE BODY
async function fullSourceStage(root, budget, stage, maximumSeconds, action) {
  need(
    (stage === "source-acquisition" && maximumSeconds === 4500) ||
      (stage === "source-hooks-gn" && maximumSeconds === 2700),
    "FULL_SOURCE_STAGE",
  );
  const allowed = Math.min(maximumSeconds * 1000, budget.remaining() - 120000);
  need(allowed > 0, "FULL_SOURCE_RESERVE");
  const began = performance.now();
  const timer = setTimeout(
    () => {
      const report = {
        kind: "windows-arm-source-stage-deadline",
        success: false,
        stage,
        firstFailure: "FULL_SOURCE_STAGE_DEADLINE",
        compilerExecuted: null,
        engineCompilationRequested: false,
        sdkBuilt: false,
        cleanupNotInferred: true,
      };
      try {
        writeFileSync(
          path.join(root, "source-deadline-result.json"),
          JSON.stringify(report) + "\n",
          { flag: "wx" },
        );
      } catch {
        sourceReportingFailure = true;
        try {
          writeSync(
            2,
            Buffer.from(
              JSON.stringify({
                ...report,
                reportingFailure: "FULL_SOURCE_REPORT",
              }) + "\n",
            ),
          );
        } catch {
          /* Preserve the deadline. */
        }
      }
      process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.
    },
    Math.max(1, allowed),
  );
  try {
    const result = await action();
    budget.remaining();
    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

const FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.
const FULL_SOURCE_PROFILE_SHA256 =
  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";
const fullSourceProfiles = new WeakMap();

// Actual full source owner and graph receipts are the only metadata issuers.
// The unchanged private profile below is a pinned data recipe, never full authority.
const fullMetadataOwners = new WeakMap();
const fullMetadataSources = new WeakMap();
const fullMetadataContexts = new WeakMap();
const FULL_METADATA_ROLES = Object.freeze([
  "qual-gn-desc-pa",
  "qual-gn-desc-cef",
  "qual-gn-args",
  "qual-generate-headers",
]);
function fullMetadataOwner(owner) {
  const state = qualificationOwnerCheck(owner),
    binding = fullMetadataOwners.get(owner);
  need(
    binding &&
      fullSourceProfiles.get(state.p) === binding.profile &&
      binding.profile.context === binding.context &&
      state.root === binding.profile.root &&
      state.contextSha === binding.profile.contextPin &&
      staticProjectionEqual(state.c, binding.context),
    "FULL_METADATA_SOURCE_BINDING",
  );
  requireFullSourceContext(binding.context);
  return { state, binding };
}
function beginFullMetadataSource(input) {
  const profile = fullSourceProfiles.get(input.p);
  need(
    profile &&
      input.c === profile.context &&
      input.root === profile.root &&
      input.contextSha === profile.contextPin,
    "FULL_METADATA_SOURCE_BINDING",
  );
  requireFullSourceContext(input.c);
  profile.budget.remaining();
  need(
    Buffer.isBuffer(profile.metadataRecipeRaw) &&
      sha(profile.metadataRecipeRaw) === PRIVATE_PROFILE_SHA256,
    "FULL_METADATA_RECIPE_PIN",
  );
  const recipe = JSON.parse(profile.metadataRecipeRaw);
  const owner = beginQualificationSource({
    ...input,
    privatePolicyRaw: profile.metadataRecipeRaw,
  });
  fullMetadataOwners.set(owner, { profile, context: input.c, recipe });
  fullMetadataOwner(owner);
  return owner;
}
function fullMetadataCommand(state, role) {
  qualificationCheck(state);
  const full = fullMetadataSources.get(state.sourceToken);
  need(
    full &&
      full.owner === state.source.owner &&
      full.state === qualificationSourceOwners.get(full.owner) &&
      qualificationSourceRuns.get(state.sourceToken) === state.source,
    "FULL_METADATA_SOURCE_BINDING",
  );
  const { binding } = fullMetadataOwner(full.owner);
  need(
    state.next < 4 && role === FULL_METADATA_ROLES[state.next],
    "FULL_METADATA_ROLE_CLOSED",
  );
  const source =
      state.source.root.replaceAll("\\", "/") + "/source-checkout/src",
    out = source + "/out/Release_GN_arm64";
  const vectors = [
    [
      source + "/buildtools/win/gn.exe",
      "desc",
      out,
      binding.recipe.generatedInputs[0].label,
      "--format=json",
    ],
    [
      source + "/buildtools/win/gn.exe",
      "desc",
      out,
      binding.recipe.generatedInputs[1].label,
      "--format=json",
    ],
    [
      source + "/buildtools/win/gn.exe",
      "args",
      out,
      "--list",
      "--json",
      "--short",
    ],
    [
      state.source.root.replaceAll("\\", "/") + "/siso/siso.exe",
      "ninja",
      "--offline",
      "-local_jobs=1",
      "-C",
      out,
      ...binding.recipe.generatedInputs.map((row) => row.relativeOutput),
    ],
  ];
  return Object.freeze({
    role,
    argv: Object.freeze(vectors[state.next]),
    cwd: source,
    environmentContract: "live-source-git-policy-required",
    executionAdmitted: false,
  });
}
function fullMetadataContext(context) {
  const issued = fullMetadataContexts.get(context);
  need(issued, "FULL_METADATA_CONTEXT_BRAND");
  const { state, binding } = fullMetadataOwner(issued.owner),
    session = qualificationSessions.get(issued.session);
  need(
    session &&
      session.sourceToken === state.sourceToken &&
      session.epoch === issued.epoch &&
      !session.running &&
      session.next === 4 &&
      !session.closed,
    "FULL_METADATA_CONTEXT_BINDING",
  );
  qualificationCheck(session);
  need(
    context.mode === binding.context.mode &&
      context.ref === binding.context.ref &&
      context.workflow === binding.context.workflow &&
      context.repository === binding.context.repository &&
      context.repositoryId === binding.context.repositoryId &&
      context.visibility === binding.context.visibility &&
      context.event === binding.context.event &&
      context.head === binding.context.head &&
      context.workflowSha === binding.context.workflowSha &&
      context.root === state.root.replaceAll("\\", "/") &&
      context.image === state.p.image,
    "FULL_METADATA_CONTEXT_IDENTITY",
  );
  return { state, binding };
}
async function coordinateFullMetadata(sourceToken) {
  const issued = fullMetadataSources.get(sourceToken);
  need(
    issued && qualificationSourceRuns.get(sourceToken),
    "FULL_METADATA_SOURCE_BINDING",
  );
  const { state } = fullMetadataOwner(issued.owner),
    source = qualificationSourceRuns.get(sourceToken),
    owner = issued.owner;
  let failed = false,
    primary;
  try {
    await qualificationOwnerAwait(owner, validateQualificationSource(owner));
    // Existing joined-runner paths are fixed and contain metadata only in full mode.
    for (const relative of [
      "private-qualification",
      "private-qualification-tmp",
      "private-qualification-logs",
    ]) {
      await qualificationSourceDirectories(owner);
      fullMetadataOwner(owner);
      await qualificationOwnerAwait(
        owner,
        fs.mkdir(path.join(source.root, relative), { mode: 0o700 }),
      );
      await qualificationSourceDirectories(owner);
    }
    fullMetadataOwner(owner);
    const logs = await qualificationOwnerAwait(
      owner,
      fs.lstat(path.join(source.root, "private-qualification-logs"), {
        bigint: true,
      }),
    );
    fullMetadataOwner(owner);
    source.logsIdentity = signature(logs);
    qualificationCoordinatorSources.add(sourceToken);
    const session = createQualificationSession(sourceToken),
      candidateRaw = await fullMetadataCandidatePolicy(owner);
    for (const [index, role] of FULL_METADATA_ROLES.entries()) {
      fullMetadataOwner(owner);
      const observation = await issueActualObservation(session, role);
      await runFixedJoined(session, role, observation);
      fullMetadataOwner(owner);
      if (index < 2)
        qualificationInspectAction(
          await qualificationReadLog(owner, session, index),
          index === 0 ? "partitionAlloc" : "cefConfig",
          state.privatePolicyRaw,
          candidateRaw,
        );
      else if (index === 2) {
        const evaluated = qualificationInspectEvaluatedArgs(
          await qualificationReadLog(owner, session, index),
        );
        const original = qualificationGraphReceipts
          .get(state.graphReceipt)
          .snapshot.pins.find((pin) => pin.path === "args.gn");
        need(original, "PRIVATE_GRAPH_INCOMPLETE");
        const literal = qualificationParseLiteralArgs(
          await qualificationOwnerAwait(
            owner,
            held(
              path.join(state.files.chromium, "out/Release_GN_arm64/args.gn"),
              1024 ** 2,
              state.budget,
              original,
            ),
          ),
        );
        for (const [name, value] of Object.entries(literal.values))
          if (Object.hasOwn(evaluated.values, name))
            need(
              value === evaluated.values[name],
              "PRIVATE_LITERAL_EVALUATED_MISMATCH",
            );
      }
      fullMetadataOwner(owner);
    }
    const metadata = await fullMetadataObservation(owner, session);
    await qualificationSourceDirectories(owner);
    fullMetadataOwner(owner);
    await qualificationOwnerAwait(
      owner,
      fs.writeFile(
        path.join(source.root, "full-metadata-result.json"),
        JSON.stringify(
          {
            kind: "windows-arm-full-source-metadata",
            ...metadata,
            sourceId: state.p.sourceGn.sourceId,
            roleCount: 4,
            fullArm64DefaultsQualified: false,
            compilerExecuted: false,
            executionAdmitted: false,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      ),
    );
    await qualificationSourceDirectories(owner);
    fullMetadataOwner(owner);
    // Source metadata completes here. The parent independently checks fixed expectations.
    // This returns no compiler/default qualification or transferable source capability.
    return;
  } catch (error) {
    failed = true;
    primary = error;
    retireQualificationSource(owner, true, error);
    throw state.failed ? state.primary : error;
  } finally {
    fullMetadataSources.delete(sourceToken);
    fullMetadataOwners.delete(owner);
    retireQualificationSource(owner, failed, primary);
  }
}

function commitFullMetadataGraph(owner) {
  const { state, binding } = fullMetadataOwner(owner),
    pending = state.graphPending;
  need(
    pending &&
      pending.epoch === state.epoch &&
      !state.graphReceipt &&
      !state.sourceToken,
    "PRIVATE_GRAPH_COMMIT",
  );
  const graphReceipt = Object.freeze({ kind: "full-metadata-fresh-graph" });
  qualificationGraphReceipts.set(graphReceipt, {
    owner,
    state,
    epoch: state.epoch,
    snapshot: pending.snapshot,
    summary: pending.summary,
  });
  state.graphReceipt = graphReceipt;
  const sourceToken = Object.freeze({ kind: "full-metadata-source-run" });
  state.sourceToken = sourceToken;
  const source = {
    owner,
    root: state.root,
    policyImage: state.p.image,
    context: { ...state.c, root: state.root.replaceAll("\\", "/") },
    contextSha: state.contextSha,
    budget: state.budget,
    phase: state.phase,
    end: state.end,
    signal: state.signal,
    sessions: state.sessions,
    privatePolicyRaw: Buffer.from(state.privatePolicyRaw),
    custom: state.custom,
    gitPolicy: state.gitPolicy,
    environment: state.env,
    output: state.output,
    validateBefore: () => validateQualificationSource(owner),
    validateAfter: async (role) => {
      await validateQualificationSource(owner);
      qualificationOwnerCheck(owner);
      await qualificationPostInputs(owner, role);
      qualificationOwnerCheck(owner);
    },
  };
  qualificationSourceRuns.set(sourceToken, source);
  fullMetadataSources.set(sourceToken, { owner, state, binding });
  return sourceToken;
}

async function fullMetadataCandidatePolicy(owner) {
  const { state, binding } = fullMetadataOwner(owner);
  const raw = Buffer.from(
    await qualificationOwnerAwait(
      owner,
      held(
        path.join(HERE, "engine-qualification-profile.json"),
        65536,
        state.budget,
      ),
    ),
  );
  need(
    sha(raw) === binding.recipe.baseCandidatePolicySha256,
    "PRIVATE_BASE_POLICY_PIN",
  );
  qualificationOwnerCheck(owner);
  return raw;
}

function fullMetadataInspectContext(
  context,
  rawPolicy,
  rawCandidatePolicy,
  wallNow,
  monotonicNow,
) {
  const full = fullMetadataContext(context);
  const { policy, candidate } = qualificationPolicy(
    rawPolicy,
    rawCandidatePolicy,
  );
  qualificationShape(
    context,
    [
      "kind",
      "mode",
      "ref",
      "workflow",
      "repository",
      "repositoryId",
      "visibility",
      "event",
      "head",
      "workflowSha",
      "image",
      "host",
      "root",
      "source",
      "sources",
      "sourceDigest",
      "bindings",
      "wallWorkEnd",
      "monotonicWorkEnd",
    ],
    "PRIVATE_CONTEXT_FIELDS",
  );
  need(
    context.kind === "windows-arm-full-metadata-input-projection" &&
      typeof context.head === "string" &&
      /^[a-f0-9]{40}$/.test(context.head) &&
      context.head === context.workflowSha,
    "PRIVATE_CONTEXT_HEAD",
  );
  need(
    typeof context.image === "string" &&
      Object.hasOwn(policy.images, context.image) &&
      staticProjectionEqual(context.host, {
        platform: "win32",
        architecture: "x64",
        runner: policy.runner,
      }),
    "PRIVATE_HOST_IMAGE",
  );
  need(
    typeof context.root === "string" && PRIVATE_ROOT.test(context.root),
    "PRIVATE_ROOT",
  );
  const selected = policy.images[context.image];
  need(
    staticProjectionEqual(context.source, {
      target: "aarch64-pc-windows-msvc",
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    }),
    "PRIVATE_SOURCE_SCOPE",
  );
  need(
    Array.isArray(context.sources) &&
      context.sources.length === full.state.c.sources.length,
    "PRIVATE_SOURCE_TUPLE",
  );
  for (const [index, row] of context.sources.entries()) {
    qualificationShape(
      row,
      [
        "path",
        "bytes",
        "sha256",
        "canonicalBytes",
        "canonicalSha256",
        "encoding",
      ],
      "PRIVATE_SOURCE_FIELDS",
    );
    need(
      staticProjectionEqual(row, full.state.c.sources[index]),
      "PRIVATE_SOURCE_TUPLE",
    );
    for (const key of ["bytes", "canonicalBytes"])
      qualificationInteger(row[key], 1, 2 * 1024 ** 2, "PRIVATE_SOURCE_BOUND");
    for (const key of ["sha256", "canonicalSha256"])
      need(
        typeof row[key] === "string" && /^[a-f0-9]{64}$/.test(row[key]),
        "PRIVATE_SOURCE_HASH",
      );
    need(
      row.encoding === "exact" ||
        (row.encoding === "git-crlf" &&
          full.state.c.sources[index].encoding === "git-crlf"),
      "PRIVATE_SOURCE_ENCODING",
    );
    need(
      row.encoding === "exact"
        ? row.bytes === row.canonicalBytes && row.sha256 === row.canonicalSha256
        : row.bytes >= row.canonicalBytes &&
            row.bytes - row.canonicalBytes <= row.canonicalBytes,
      "PRIVATE_SOURCE_ENCODING",
    );
  }
  need(
    typeof context.sourceDigest === "string" &&
      /^[a-f0-9]{64}$/.test(context.sourceDigest) &&
      sha(Buffer.from(qualificationCanonical(context.sources))) ===
        context.sourceDigest,
    "PRIVATE_SOURCE_DIGEST",
  );
  const bindings = context.bindings,
    out = context.root + "/source-checkout/src/out/Release_GN_arm64";
  qualificationShape(
    bindings,
    ["args", "graph", "graphInventory", "tools"],
    "PRIVATE_BINDING_FIELDS",
  );
  const pin = (row, file, expected) => {
    qualificationShape(row, ["path", "bytes", "sha256"], "PRIVATE_FILE_FIELDS");
    need(
      row.path === file &&
        Number.isSafeInteger(row.bytes) &&
        row.bytes > 0 &&
        row.bytes <= 256 * 1024 ** 2 &&
        typeof row.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(row.sha256),
      "PRIVATE_FILE_PIN",
    );
    if (expected)
      need(
        row.bytes === expected.bytes && row.sha256 === expected.sha256,
        "PRIVATE_TOOL_PIN",
      );
  };
  pin(bindings.args, out + "/args.gn");
  pin(bindings.graph, out + "/build.ninja");
  const inventory = bindings.graphInventory;
  qualificationShape(
    inventory,
    ["files", "visited", "bytes", "sha256"],
    "PRIVATE_GRAPH_FIELDS",
  );
  need(
    Number.isSafeInteger(inventory.files) &&
      inventory.files >= 1 &&
      inventory.files <= 50000 &&
      Number.isSafeInteger(inventory.visited) &&
      inventory.visited >= inventory.files &&
      inventory.visited <= 300000 &&
      Number.isSafeInteger(inventory.bytes) &&
      inventory.bytes > 0 &&
      inventory.bytes <= 8 * 1024 ** 3 &&
      typeof inventory.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(inventory.sha256),
    "PRIVATE_GRAPH_BOUND",
  );
  qualificationShape(
    bindings.tools,
    Object.keys(policy.tools),
    "PRIVATE_TOOL_FIELDS",
  );
  for (const [role, expected] of Object.entries(policy.tools))
    pin(
      bindings.tools[role],
      expected.path ?? context.root + "/" + expected.relativePath,
      expected,
    );
  need(
    [
      context.wallWorkEnd,
      context.monotonicWorkEnd,
      wallNow,
      monotonicNow,
    ].every((value) => typeof value === "number" && Number.isFinite(value)),
    "PRIVATE_CLOCK",
  );
  const remaining = Math.min(
    context.wallWorkEnd - wallNow,
    context.monotonicWorkEnd - monotonicNow,
  );
  need(remaining > 150 && remaining <= 7200, "PRIVATE_DEADLINE");
  return { policy, candidate };
}

function fullMetadataInspect(
  context,
  rawPolicy,
  rawCandidatePolicy,
  observations,
  wallNow,
  monotonicNow,
) {
  const { candidate } = fullMetadataInspectContext(
    context,
    rawPolicy,
    rawCandidatePolicy,
    wallNow,
    monotonicNow,
  );
  qualificationShape(
    observations,
    ["gnDescPartitionAlloc", "gnDescCef", "gnArgs", "files"],
    "PRIVATE_OUTPUT_FIELDS",
  );
  const pa = qualificationInspectAction(
    observations.gnDescPartitionAlloc,
    "partitionAlloc",
    rawPolicy,
    rawCandidatePolicy,
  );
  const cef = qualificationInspectAction(
    observations.gnDescCef,
    "cefConfig",
    rawPolicy,
    rawCandidatePolicy,
  );
  const evaluated = qualificationInspectEvaluatedArgs(observations.gnArgs);
  const out = context.root + "/source-checkout/src/out/Release_GN_arm64/";
  const files = observations.files,
    paths = {
      args: out + "args.gn",
      partitionAlloc: out + candidate.generatedInputs[0].relativeOutput,
      cefConfig: out + candidate.generatedInputs[1].relativeOutput,
    };
  qualificationShape(files, Object.keys(paths), "PRIVATE_METADATA_FILE_FIELDS");
  for (const [role, file] of Object.entries(paths)) {
    const row = files[role];
    qualificationShape(row, ["pin", "raw"], "PRIVATE_OUTPUT_CANDIDATE");
    qualificationShape(
      row.pin,
      ["path", "bytes", "sha256"],
      "PRIVATE_OUTPUT_PIN_FIELDS",
    );
    need(
      Buffer.isBuffer(row.raw) &&
        row.raw.length > 0 &&
        row.raw.length <= 8 * 1024 ** 2 &&
        row.pin.path === file &&
        row.pin.bytes === row.raw.length &&
        row.pin.sha256 === sha(row.raw),
      "PRIVATE_OUTPUT_PIN",
    );
  }
  need(
    staticProjectionEqual(files.args.pin, context.bindings.args),
    "PRIVATE_OUTPUT_ARGS_CHANGED",
  );
  const literal = qualificationParseLiteralArgs(files.args.raw);
  need(
    literal.lines.includes('target_cpu="arm64"'),
    "PRIVATE_CEF_GENERATOR_CPU_LINE",
  );
  const cefHeader = qualificationInspectCefHeader(files.cefConfig.raw);
  const macros = qualificationInspectPaHeader(
    files.partitionAlloc.raw,
    candidate,
    pa.evaluatedMacroValues,
  );
  for (const [name, value] of Object.entries(literal.values))
    if (Object.hasOwn(evaluated.values, name))
      need(
        value === evaluated.values[name],
        "PRIVATE_LITERAL_EVALUATED_MISMATCH",
      );
  return {
    metadata: { partitionAlloc: pa, cefConfig: cef, arguments: evaluated },
    literalArguments: literal.projection,
    partitionAllocMacros: macros,
    cefHeader,
    policyMinimumsMet: true,
    completeMacroInventoryMatches: true,
    fullArm64DefaultsQualified: false,
    compilerExecuted: false,
    cohortQuietProven: false,
    executionAdmitted: false,
  };
}

async function fullMetadataObservation(owner, session) {
  const { state, binding } = fullMetadataOwner(owner),
    source = qualificationSourceRuns.get(state.sourceToken);
  need(
    source && qualificationSessions.get(session)?.source === source,
    "PRIVATE_SOURCE_RUN",
  );
  const graph = qualificationGraphReceipts.get(state.graphReceipt);
  need(graph?.owner === owner, "PRIVATE_GRAPH_RECEIPT");
  const root = state.root.replaceAll("\\", "/"),
    out = root + "/source-checkout/src/out/Release_GN_arm64/";
  const row = async (file, maximum) => {
    qualificationOwnerCheck(owner);
    const raw = Buffer.from(
      await qualificationOwnerAwait(owner, held(file, maximum, state.budget)),
    );
    return { raw, pin: { path: file, bytes: raw.length, sha256: sha(raw) } };
  };
  const files = {};
  files.args = await row(out + "args.gn", 1024 ** 2);
  for (const [role, item] of [
    ["partitionAlloc", binding.recipe.generatedInputs[0]],
    ["cefConfig", binding.recipe.generatedInputs[1]],
  ])
    files[role] = await row(out + item.relativeOutput, 8 * 1024 ** 2);
  const gnDescPartitionAlloc = await qualificationReadLog(owner, session, 0),
    gnDescCef = await qualificationReadLog(owner, session, 1),
    gnArgs = await qualificationReadLog(owner, session, 2);
  const policy = binding.recipe,
    selected = policy.images[state.p.image];
  const original = (name) =>
    graph.snapshot.pins.find((pin) => pin.path === name);
  for (const name of ["args.gn", "build.ninja"])
    need(original(name), "PRIVATE_GRAPH_INCOMPLETE");
  const projectionPin = (name) => ({
    path: out + name,
    bytes: original(name).bytes,
    sha256: original(name).sha256,
  });
  const remaining = state.budget.remaining() / 1000;
  const context = {
    kind: "windows-arm-full-metadata-input-projection",
    mode: state.c.mode,
    ref: state.c.ref,
    workflow: state.c.workflow,
    repository: state.c.repository,
    repositoryId: state.c.repositoryId,
    visibility: state.c.visibility,
    event: state.c.event,
    head: state.c.head,
    workflowSha: state.c.workflowSha,
    image: state.p.image,
    host: {
      platform: process.platform,
      architecture: process.arch,
      runner: policy.runner,
    },
    root,
    source: {
      target: TARGET,
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    },
    sources: structuredClone(state.c.sources),
    sourceDigest: sha(Buffer.from(qualificationCanonical(state.c.sources))),
    bindings: {
      args: projectionPin("args.gn"),
      graph: projectionPin("build.ninja"),
      graphInventory: structuredClone(graph.summary),
      tools: Object.fromEntries(
        Object.entries(policy.tools).map(([role, pin]) => [
          role,
          {
            path: pin.path ?? root + "/" + pin.relativePath,
            bytes: pin.bytes,
            sha256: pin.sha256,
          },
        ]),
      ),
    },
    wallWorkEnd: Math.min(state.c.wallWorkEnd, Date.now() / 1000 + remaining),
    monotonicWorkEnd: performance.now() / 1000 + remaining,
  };
  qualificationOwnerCheck(owner);
  const candidateRaw = await fullMetadataCandidatePolicy(owner);
  qualificationOwnerCheck(owner);
  fullMetadataContexts.set(context, {
    owner,
    session,
    epoch: qualificationSessions.get(session).epoch,
  });
  try {
    return fullMetadataInspect(
      context,
      state.privatePolicyRaw,
      candidateRaw,
      { gnDescPartitionAlloc, gnDescCef, gnArgs, files },
      Date.now() / 1000,
      performance.now() / 1000,
    );
  } finally {
    fullMetadataContexts.delete(context);
  }
}
function fullBootstrapAuthority(root, p, contextPin) {
  const state = fullSourceProfiles.get(p);
  if (!state) return null; // Retain the original private branch for its own profile.
  need(
    state.root === root && state.contextPin === contextPin,
    "FULL_SDK_BOOTSTRAP_BINDING",
  );
  requireFullSourceContext(state.context);
  need(state.context.image === p.image, "FULL_SDK_BOOTSTRAP_IMAGE");
  state.budget.remaining();
  return state;
}
function requireFullSourceContext(c) {
  need(
    c &&
      Object.getPrototypeOf(c) === Object.prototype &&
      c.mode === "full-sdk-source-gn" &&
      c.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&
      c.policy === "native/windows-arm-full-sdk/sdk-origin-review.json" &&
      c.ref === "refs/heads/main" &&
      c.repository === "supermarsx/sortOfRemoteNG" &&
      c.repositoryId === "1010282954" &&
      c.visibility === "public" &&
      c.event === "workflow_dispatch" &&
      c.defaultBranch === "main" &&
      c.kind === "windows-arm-full-sdk-context" &&
      c.head === c.workflowSha &&
      /^[a-f0-9]{40}$/.test(c.head) &&
      /^[1-9][0-9]*$/.test(c.runId) &&
      /^[1-9][0-9]*$/.test(c.attempt) &&
      c.inputs &&
      Object.getPrototypeOf(c.inputs) === Object.prototype &&
      Object.keys(c.inputs).length === 1 &&
      typeof c.inputs.restore_run === "string" &&
      /^(?:0|[1-9][0-9]{0,19})$/.test(c.inputs.restore_run),
    "FULL_SDK_SOURCE_CONTEXT",
  );
}
async function loadFullSourceProfile(root, c, provisional, contextPin) {
  requireFullSourceContext(c);
  const raw = await held(
    path.join(HERE, "full-sdk-source-profile.json"),
    65536,
    provisional,
  );
  need(sha(raw) === FULL_SOURCE_PROFILE_SHA256, "FULL_SDK_SOURCE_PROFILE_PIN");
  const full = JSON.parse(raw);
  need(
    full.fullModeBodyImplemented === true &&
      full.sourceSessionIssuerImplemented === true &&
      full.executionAdmitted === false &&
      full.sourceProgramCarryforwardQualified === false &&
      full.fullArm64DefaultsQualified === false &&
      full.sourceQualificationAllowed === true,
    "FULL_SDK_SOURCE_PROFILE_CLOSED",
  );
  const pin = full.images[c.image];
  need(
    pin &&
      c.sourceId === pin.sourceId &&
      c.sourceProfileSha256 === pin.profileSha256,
    "FULL_SDK_SOURCE_IMAGE",
  );
  const policyRaw = await held(
    path.join(REPO, full.policy),
    1024 ** 2,
    provisional,
  );
  need(sha(policyRaw) === c.originPolicySha256, "FULL_SDK_SOURCE_POLICY_PIN");
  const policy = JSON.parse(policyRaw);
  need(
    policy.kind === "sorng-windows-arm64-sdk-origin-policy" &&
      policy.origin === "owned-windows-arm64-full-sdk" &&
      policy.target === TARGET &&
      policy.workflow === full.workflow &&
      Array.isArray(policy.producerInputs) &&
      policy.producerInputs.length > 0 &&
      policy.producerInputs.length <= 128,
    "FULL_SDK_SOURCE_POLICY",
  );
  await held(
    path.join(REPO, full.workflow),
    2 * 1024 ** 2,
    provisional,
    policy.workflowPin,
  );
  need(
    JSON.stringify(c.sources) === JSON.stringify(policy.producerInputs) &&
      new Set(c.sources.map((row) => row.path)).size === c.sources.length &&
      full.requiredProducerPaths.every((name) =>
        c.sources.some((row) => row.path === name),
      ),
    "FULL_SDK_SOURCE_CLOSURE",
  );
  const defaultsInput = c.sources.filter(
    (row) => row.path === "native/windows-arm-full-sdk/expected-defaults.mjs",
  );
  need(
    defaultsInput.length === 1 &&
      defaultsInput[0].bytes === full.expectedDefaultsModulePin.bytes &&
      defaultsInput[0].sha256 === full.expectedDefaultsModulePin.sha256,
    "FULL_SDK_DEFAULTS_MODULE_PIN",
  );
  const baseRaw = await held(
    path.join(HERE, "profile.json"),
    65536,
    provisional,
  );
  need(sha(baseRaw) === full.baseProfileSha256, "FULL_SDK_SOURCE_BASE_PIN");
  const selectedRaw = await held(
    path.join(HERE, pin.profile),
    131072,
    provisional,
  );
  need(sha(selectedRaw) === pin.profileSha256, "FULL_SDK_SOURCE_RECIPE_PIN");
  const selected = JSON.parse(selectedRaw);
  need(
    selected.image === c.image &&
      selected.sourceGn.sourceId === pin.sourceId &&
      selected.baseProfileSha256 === full.baseProfileSha256 &&
      selected.sourceGn.limits.wholeSeconds === 7200 &&
      selected.sourceGn.limits.acquisitionSeconds === 4500 &&
      selected.sourceGn.limits.hooksSeconds === 1800,
    "FULL_SDK_SOURCE_RECIPE",
  );
  const p = {
    ...JSON.parse(baseRaw),
    image: c.image,
    sourceGn: selected.sourceGn,
    sourcePaths: c.sources.map((row) => row.path),
  };
  const initial = sourceBudget(c, p);
  const started = performance.now();
  const original = initial.remaining();
  need(
    Number.isFinite(c.wallWholeEnd) &&
      Number.isFinite(c.monotonicWholeEnd) &&
      Number.isFinite(c.monotonicWorkEnd) &&
      c.wallWorkEnd <= c.wallWholeEnd &&
      c.monotonicWorkEnd <= c.monotonicWholeEnd &&
      c.wallWholeEnd * 1000 - Date.now() <= 21600000,
    "FULL_SDK_SOURCE_ORIGINAL_ENDS",
  );
  const budget = {
    remaining() {
      const remaining = Math.min(
        initial.remaining(),
        original - (performance.now() - started),
        c.wallWholeEnd * 1000 - Date.now(),
      );
      need(remaining > 0, "FULL_SDK_SOURCE_DEADLINE");
      return remaining;
    },
  };
  for (let i = 0; i < c.sources.length; i++) {
    const row = c.sources[i];
    need(
      typeof row.path === "string" &&
        !path.isAbsolute(row.path) &&
        row.path
          .split(/[\\/]/)
          .every((part) => part && part !== "." && part !== ".."),
      "FULL_SDK_SOURCE_INPUT_PATH",
    );
    const live = await held(
      path.join(REPO, row.path),
      2 * 1024 ** 2,
      budget,
      row,
    );
    const saved = await held(
      path.join(root, "source-inputs", String(i)),
      2 * 1024 ** 2,
      budget,
      row,
    );
    need(live.equals(saved), "FULL_SDK_SOURCE_INPUT_CHANGED");
  }
  for (const row of [
    ...p.sourceData,
    ...p.sourceGn.sourceData,
    ...p.sourceGn.helpers,
  ])
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  need(
    Object.values(p.sourceGn.executionPolicy).every((value) => value === true),
    "FULL_SDK_SOURCE_RECIPE_POLICY",
  );
  need(/^[a-f0-9]{64}$/.test(contextPin), "FULL_CONTEXT_PIN");
  const metadataRecipeRaw = await held(
    path.join(HERE, "private-qualification-profile.json"),
    65536,
    budget,
  );
  need(
    sha(metadataRecipeRaw) === PRIVATE_PROFILE_SHA256 &&
      full.metadataRecipeSha256 === PRIVATE_PROFILE_SHA256,
    "FULL_METADATA_RECIPE_PIN",
  );
  // BEGIN HELD FULL SOURCE IMAGE REGISTRATION
  const imageData = JSON.parse(metadataRecipeRaw).images[c.image];
  requireFullSourceContext(c);
  budget.remaining();
  need(
    imageData &&
      c.image === p.image &&
      c.sourceId === pin.sourceId &&
      c.sourceProfileSha256 === pin.profileSha256 &&
      imageData.profile === pin.profile &&
      imageData.profileSha256 === pin.profileSha256 &&
      imageData.sourceId === pin.sourceId &&
      imageData.namespace === p.sourceGn.namespace,
    "FULL_IMAGE_RECIPE_BINDING",
  );
  fullSourceProfiles.set(p, {
    profile: p,
    sourceGn: p.sourceGn,
    root,
    context: c,
    contextPin,
    budget,
    metadataRecipeRaw,
    imageData: Object.freeze({ image: c.image, ...imageData }),
    selectedProfileSha256: sha(selectedRaw),
  });
  try {
    const tools = reviewedHostTools(p),
      files = sourcePaths(root, p);
    reviewedHostClosure(p, c.image);
    fullBootstrapAuthority(root, p, contextPin);
    return { p, budget, tools, files, privatePolicyRaw: raw };
  } catch (error) {
    fullSourceProfiles.delete(p);
    throw error;
  }
  // END HELD FULL SOURCE IMAGE REGISTRATION
}
function fullSourceCommands(root, p, hooks, contextPin) {
  const state = fullSourceProfiles.get(p);
  need(state && state.root === root, "FULL_SDK_SOURCE_RECIPE_BRAND");
  state.budget.remaining();
  const commands = Object.freeze(
    sourceCommands(root, p, hooks, contextPin).map((row) => {
      if (row.role !== "verify-setup") return row;
      need(
        row.args[2] === path.join(HERE, "producer.py") &&
          row.args[3] === "--verify-source-setup",
        "FULL_SDK_SOURCE_SETUP_VECTOR",
      );
      return Object.freeze({
        ...row,
        args: Object.freeze([
          "-I",
          "-B",
          path.join(HERE, "full_sdk_source.py"),
          "--full-sdk-verify-source-setup",
          root,
          contextPin,
          "--execute",
        ]),
      });
    }),
  );
  return Object.freeze([
    ...commands,
    Object.freeze({
      role: "restore-checkpoint",
      executable: p.python.path,
      cwd: root,
      args: Object.freeze([
        "-I",
        "-B",
        path.join(HERE, "compiled_checkpoint.py"),
        "--restore",
        root,
        contextPin,
      ]),
    }),
  ]);
}

// BEGIN SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION
const fullSourceSentinelOwners = new WeakSet();
async function normalizeFullSourceDepotToolsSentinel(root, p, contextPin) {
  const binding = fullBootstrapAuthority(root, p, contextPin);
  need(binding && !fullSourceSentinelOwners.has(p), "FULL_SENTINEL_OWNER");
  const relative =
      "source-checkout/src/third_party/depot_tools/.disable_auto_update",
    file = path.join(root, relative),
    script = path.join(path.dirname(file), "update_depot_tools_toggle.py"),
    scriptPin = {
      bytes: 1205,
      sha256:
        "6797d3ed046e32efbd48e044347dce7703559b76b4adaca1c874f69ff83c1c23",
    };
  const originalRemaining = binding.budget.remaining(),
    began = performance.now(),
    monoEnd = began + Math.min(30000, originalRemaining),
    wallEnd = Math.min(
      Date.now() + 30000,
      binding.context.wallWholeEnd * 1000 - 150000,
    );
  let failed = false,
    primary,
    fd,
    result,
    retired = false;
  const remember = (error) => {
    if (!failed) {
      failed = true;
      primary = error;
    }
  };
  const owner = () => {
    need(
      fullBootstrapAuthority(root, p, contextPin) === binding,
      "FULL_SENTINEL_RETIRED",
    );
    binding.budget.remaining();
    need(
      performance.now() < monoEnd && Date.now() < wallEnd,
      "FULL_SENTINEL_DEADLINE",
    );
  };
  const wait = async (action) => {
    owner();
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          owner();
          return action();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("FULL_SENTINEL_DEADLINE")),
            Math.max(
              1,
              Math.min(
                monoEnd - performance.now(),
                wallEnd - Date.now(),
                binding.budget.remaining(),
              ),
            ),
          );
        }),
      ]);
      owner();
      return value;
    } finally {
      clearTimeout(timer);
    }
  };
  const dirId = (info) => {
    need(
      info.isDirectory() && !info.isSymbolicLink(),
      "FULL_SENTINEL_DIRECTORY",
    );
    return [
      info.dev,
      info.ino,
      info.mode,
      info.uid,
      info.gid,
      info.birthtimeNs,
    ].join(":");
  };
  const parents = [];
  const fence = async () => {
    for (const entry of parents)
      need(
        dirId(await wait(() => fs.lstat(entry.path, { bigint: true }))) ===
          entry.identity,
        "FULL_SENTINEL_ANCESTOR",
      );
    need((await wait(() => physical(file))) === file, "FULL_SENTINEL_ALIAS");
    owner();
  };
  try {
    await wait(() => held(script, scriptPin.bytes, binding.budget, scriptPin));
    for (let current = path.dirname(file); ; current = path.dirname(current)) {
      parents.push({
        path: current,
        identity: dirId(await wait(() => fs.lstat(current, { bigint: true }))),
      });
      if (current === path.dirname(current)) break;
    }
    await fence();
    const pendingOpen = wait(() =>
      fs
        .open(file, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
        .then(async (value) => {
          if (retired) {
            await value.close();
            throw primary;
          }
          fd = value;
          return value;
        }),
    );
    await pendingOpen;
    const before = await wait(() => fd.stat({ bigint: true }));
    need(
      before.isFile() &&
        !before.isSymbolicLink() &&
        before.nlink === 1n &&
        before.size > 0n &&
        before.size <= 4096n,
      "FULL_SENTINEL_FILE",
    );
    const identity = signature(before);
    need(
      signature(await wait(() => fs.lstat(file, { bigint: true }))) ===
        identity,
      "FULL_SENTINEL_CHANGED",
    );
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await wait(() =>
        fd.read(buffer, count, buffer.length - count, count),
      );
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    need(
      count === Number(before.size) &&
        signature(await wait(() => fd.stat({ bigint: true }))) === identity &&
        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===
          identity,
      "FULL_SENTINEL_CHANGED",
    );
    const raw = buffer.subarray(0, count),
      prefix = Buffer.from("Disabled by " + script + " at ", "utf8");
    need(
      raw.length > prefix.length + 2 &&
        raw.subarray(0, prefix.length).equals(prefix) &&
        raw.subarray(-2).equals(Buffer.from("\r\n")),
      "FULL_SENTINEL_GRAMMAR",
    );
    const timestampRaw = raw.subarray(prefix.length, -2);
    need(
      timestampRaw.every((byte) => byte >= 32 && byte <= 126),
      "FULL_SENTINEL_GRAMMAR",
    );
    const timestamp = timestampRaw.toString("ascii"),
      match =
        /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{6})?$/.exec(
          timestamp,
        );
    need(
      match && (timestamp.length === 19 || timestamp.length === 26),
      "FULL_SENTINEL_TIMESTAMP",
    );
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number),
      date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, 0);
    need(
      year >= 1 &&
        year <= 9999 &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        date.getUTCHours() === hour &&
        date.getUTCMinutes() === minute &&
        date.getUTCSeconds() === second,
      "FULL_SENTINEL_TIMESTAMP",
    );
    const canonical = Buffer.concat([
      prefix,
      Buffer.from("1970-01-01 00:00:00\r\n"),
    ]);
    await fence();
    need(
      signature(await wait(() => fd.stat({ bigint: true }))) === identity &&
        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===
          identity,
      "FULL_SENTINEL_CHANGED",
    );
    owner();
    fullSourceSentinelOwners.add(p); // This genuine source lifetime may normalize once.
    if (!raw.equals(canonical)) {
      owner();
      const written = await wait(() =>
        fd.write(canonical, 0, canonical.length, 0),
      );
      need(
        written.bytesWritten === canonical.length,
        "FULL_SENTINEL_PARTIAL_WRITE",
      );
      owner();
      await wait(() => fd.truncate(canonical.length));
      owner();
      await wait(() => fd.sync());
    }
    const after = await wait(() => fd.stat({ bigint: true }));
    need(
      after.isFile() &&
        after.nlink === 1n &&
        after.dev === before.dev &&
        after.ino === before.ino &&
        after.size === BigInt(canonical.length) &&
        signature(after) ===
          signature(await wait(() => fs.lstat(file, { bigint: true }))),
      "FULL_SENTINEL_CHANGED",
    );
    const check = Buffer.alloc(canonical.length + 1);
    let size = 0;
    while (size < check.length) {
      const value = await wait(() =>
        fd.read(check, size, check.length - size, size),
      );
      if (!value.bytesRead) break;
      size += value.bytesRead;
    }
    need(
      size === canonical.length &&
        check.subarray(0, size).equals(canonical) &&
        signature(await wait(() => fd.stat({ bigint: true }))) ===
          signature(after),
      "FULL_SENTINEL_READBACK",
    );
    await fence();
    owner();
    result = {
      dataOnly: true,
      relative,
      bytes: canonical.length,
      sha256: sha(canonical),
    };
  } catch (error) {
    remember(error);
    retired = true;
    fullSourceProfiles.delete(p);
  } finally {
    // Poison before awaited close; no rollback/retry.
    if (fd) {
      let timer;
      const close = Promise.resolve().then(() => fd.close());
      try {
        await Promise.race([
          close,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("FULL_SENTINEL_CLOSE_DEADLINE")),
              Math.max(
                1,
                Math.min(monoEnd - performance.now(), wallEnd - Date.now()),
              ),
            );
          }),
        ]);
      } catch (error) {
        remember(error);
        fullSourceProfiles.delete(p);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  if (failed) throw primary;
  try {
    await fence();
    owner();
    return result;
  } catch (error) {
    retired = true;
    fullSourceProfiles.delete(p);
    throw error;
  }
}
// END SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION

async function runFullSourceBody(argv) {
  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      argv.length === 4 &&
      argv[0] === "--full-sdk-source-gn" &&
      /^[a-f0-9]{64}$/.test(argv[2]) &&
      argv[3] === "--execute",
    "FULL_DRIVER_ARGV",
  );
  const root = await physical(argv[1]);
  need(
    path.dirname(root) === path.join(REPO, ".artifacts") &&
      /^windows-arm-full-sdk-[a-f0-9-]{36}$/.test(path.basename(root)),
    "FULL_DRIVER_ROOT",
  );
  const provisional = { remaining: () => 1 };
  const raw = await held(path.join(root, "context.json"), 131072, provisional);
  need(sha(raw) === argv[2], "FULL_CONTEXT_PIN");
  const c = JSON.parse(raw);
  requireFullSourceContext(c);
  const { p, budget, tools, files, privatePolicyRaw } =
    await loadFullSourceProfile(root, c, provisional, argv[2]);
  await verifyHostClosure(p, budget, c.image);
  need(
    (await fs.realpath(process.execPath)).toLowerCase() ===
      (await fs.realpath(tools.node.path)).toLowerCase(),
    "FULL_DRIVER_NODE",
  );
  const custom = await import(
    pathToFileURL(
      path.join(HELPER_ROOT, "scripts/lib/browser-custom-runtime.mjs"),
    )
  );
  const patched = await import(
    pathToFileURL(path.join(HELPER_ROOT, "scripts/cef-patched-runtime.mjs"))
  );
  const runtime = await import(
    pathToFileURL(path.join(HELPER_ROOT, "scripts/cef-runtime-ci.mjs"))
  );
  const checkpoint = await import(
    pathToFileURL(
      path.join(HELPER_ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
    )
  );
  const lock = custom.validateSourceLock(
    JSON.parse(
      await held(path.join(files.inputs, "source-lock.json"), 65536, budget),
    ),
  );
  need(
    custom.identitySha256(lock) === p.sourceGn.sourceId,
    "FULL_SOURCE_IDENTITY",
  );
  const recipe = await custom.customRuntimeBuildRecipe({
    sourceLock: lock,
    target: TARGET,
    inputsRoot: files.inputs,
    checkouts: {
      chromium: files.chromium,
      cef: files.cef,
      depotTools: files.depot,
    },
  });
  await fs.mkdir(path.join(root, "source-caches"));
  for (const name of ["local", "roaming", "xdg", "cipd", "vpython"])
    await fs.mkdir(path.join(root, "source-caches", name));
  await fs.writeFile(path.join(root, "source-caches/cipd.cfg"), "", {
    flag: "wx",
  });
  const gitPolicy = await custom.prepareSourceGitIsolation(
    path.join(root, "cef-source-git-policy"),
    { windowsLongPaths: true },
  );
  const adapter = await preparePython3Adapter(
    files.commands,
    p.python.path,
    budget,
  );
  const bootstrap = await prepareBootstrap(root, p, argv[2], budget);
  const gnPath = path.join(files.chromium, "buildtools/win/gn.exe"),
    gnPin = p.cipd[0].members.find((row) => row.name === "gn.exe"),
    hookArguments = boundGnArguments(
      runtime.cefHookArguments(files.cef, files.depot),
      gnPath,
      gnPin,
    );
  const env = await custom.sourceGitEnvironment(
      gitPolicy,
      sourceEnvironment(root, p, recipe),
    ),
    commands = fullSourceCommands(
      root,
      p,
      runtime.cefHookArguments(files.cef, files.depot),
      argv[2],
    );
  // The initial plan validates the maintained CEF wrapper; the only replacement
  // is this local closed GN selector wrapper, never caller-supplied command text.
  const executionCommands = Object.freeze(
    commands.map((command) =>
      command.role === "cef-gn"
        ? Object.freeze({ ...command, args: Object.freeze(hookArguments) })
        : command,
    ),
  );
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  await fs.mkdir(files.logs);
  await fs.writeFile(
    path.join(files.logs, "command-plan.json"),
    JSON.stringify(
      {
        kind: "windows-arm-source-command-plan",
        sourceId: p.sourceGn.sourceId,
        helperSourceCommit: p.sourceGn.helpersSourceCommit,
        commands: executionCommands,
        python3Adapter: adapter.pin,
        bootstrapProgram: bootstrap.pin,
        acquisition: patched.acquisitionSourcePlan(files.workspace, TARGET),
        compilerAllowed: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  const limits = { bytes: 0, cap: p.sourceGn.limits.outputBytes };
  let stage = "source-acquire",
    primary,
    failed = false,
    success = false,
    graph = null,
    generatedArguments = null;
  let homeObservation = null;
  const verifyGitPolicy = gitPolicyVerifier(
    path.join(root, "cef-source-git-policy"),
    path.join(files.logs, "sync.stderr.log"),
    budget,
    limits,
    () => custom.sourceGitEnvironment(gitPolicy, env),
    () => homeObservation?.snapshot(),
  );
  const checked = async (action, observeHome = false) => {
    await verifyHostClosure(p, budget, c.image);
    await held(bootstrap.file, 2 * 1024 ** 2, budget, bootstrap.pin);
    if (bootstrap.witnessPin !== null)
      await verifyBootstrap(root, p, bootstrap, budget, argv[2]);
    await held(adapter.file, 4096, budget, adapter.pin);
    for (const primary of HOOK_PRIMARY)
      await held(
        path.join(files.depot, primary.path),
        primary.bytes,
        budget,
        primary,
      );
    await verifyGitPolicy();
    let rejected = false,
      value,
      primary,
      postFailed = false,
      postError,
      observerFailed = false,
      observerError,
      reportFailed = false,
      reportError;
    homeObservation = null;
    if (observeHome) {
      try {
        homeObservation = await observeGitHome(
          path.join(root, "cef-source-git-policy"),
          budget,
        );
      } catch (error) {
        observerFailed = true;
        observerError = error;
        sourceReportingFailure = true;
      }
    }
    if (!observerFailed) {
      try {
        value = await action();
      } catch (error) {
        rejected = true;
        primary = error;
      }
    }
    // Stop/join before postcheck so its first-fault report can include captured
    // events. Observer/retention faults never skip the authoritative postcheck.
    try {
      await homeObservation?.finish();
    } catch (error) {
      observerFailed = true;
      observerError = error;
      sourceReportingFailure = true;
    }
    try {
      await verifyHostClosure(p, budget, c.image);
      await verifyBootstrap(root, p, bootstrap, budget, argv[2]);
      await held(adapter.file, 4096, budget, adapter.pin);
      for (const primary of HOOK_PRIMARY)
        await held(
          path.join(files.depot, primary.path),
          primary.bytes,
          budget,
          primary,
        );
      await verifyGitPolicy();
    } catch (error) {
      postFailed = true;
      postError = error;
      console.error("FULL_BOOTSTRAP_OR_SOURCE_POSTCHECK_FAILURE");
    }
    if (homeObservation && !postFailed) {
      try {
        await appendGitPolicyDiagnostic(
          path.join(files.logs, "sync.stderr.log"),
          withGitHomeEvents(
            {
              kind: "windows-arm-source-home-observation",
              capturedEventsOnly: true,
            },
            homeObservation.snapshot(),
          ),
          budget,
          limits,
        );
      } catch (error) {
        reportFailed = true;
        reportError = error;
        sourceReportingFailure = true;
      }
    }
    if (rejected) throw primary;
    if (postFailed) throw postError;
    if (syncCloseReportingFaults.has(value))
      throw syncCloseReportingFaults.get(value);
    if (observerFailed) throw observerError;
    if (reportFailed) throw reportError;
    return value;
  };
  let qualificationOwner;
  currentProgress = new SourceProgress(root, argv[2]);
  try {
    await sourceStage(root, budget, "source-acquisition", 4500, async () => {
      currentProgress.phase("repository-fetch");
      budget.remaining();
      await patched.acquireSources(
        files.workspace,
        TARGET,
        tools.git.path,
        gitPolicy,
      );
      await verifyHostClosure(p, budget, c.image);
      budget.remaining();
      await runtime.prepareWindowsGitLauncher({
        depot: files.depot,
        gitExecutable: tools.git.path,
        logs: files.logs,
      });
      stage = commands[0].role;
      await checked(
        () =>
          executeCommand(
            commands[0],
            commands,
            env,
            files,
            budget,
            limits,
            false,
            { value: bootstrap, contextSha: argv[2] },
          ),
        true,
      );
    });
    await fullSourceStage(root, budget, "source-hooks-gn", 2700, async () => {
      stage = executionCommands[1].role;
      const projection = validateHookProjection(
        await checked(() =>
          executeCommand(
            executionCommands[1],
            executionCommands,
            env,
            files,
            budget,
            limits,
            true,
            { value: bootstrap, contextSha: argv[2] },
          ),
        ),
      );
      let originBytes = 0;
      // Direct files reported by the pinned Flattener, not a new tree walker.
      for (const origin of projection.origins) {
        const relative = `${origin.hierarchy.at(-1)[0]}/${origin.deps_file}`;
        const raw = await held(
          path.join(files.workspace, relative),
          Math.min(4 * 1024 ** 2, 16 * 1024 ** 2 - originBytes),
          budget,
        );
        originBytes += raw.length;
        need(originBytes <= 16 * 1024 ** 2, "FULL_HOOK_ORIGIN_BYTES");
        origin.bytes = raw.length;
        origin.sha256 = sha(raw);
      }
      // Retain the exact conditions/argv/origins plus their held byte witnesses
      // in the same bounded projection stdout artifact before any runhooks.
      await retainHookOrigins(
        path.join(files.logs, "hook-projection.stdout.log"),
        projection,
        budget,
        limits,
      );
      stage = executionCommands[2].role;
      await checked(() =>
        executeCommand(
          executionCommands[2],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      await custom.verifySourceBuildIsolation(files.chromium);
      const checkouts = {
        chromium: files.chromium,
        cef: files.cef,
        depotTools: files.depot,
      };
      stage = "source-apply";
      currentProgress.phase("patch-apply");
      await custom.applySourcePatches({
        sourceLock: lock,
        inputsRoot: files.inputs,
        checkouts,
        gitExecutable: tools.git.path,
        gitIsolation: gitPolicy,
      });
      for (const command of executionCommands.slice(3, 6)) {
        stage = command.role;
        await checked(() =>
          executeCommand(
            command,
            executionCommands,
            env,
            files,
            budget,
            limits,
            true,
            { value: bootstrap, contextSha: argv[2] },
          ),
        );
      }
      stage = "verify-setup";
      await checked(() =>
        executeCommand(
          executionCommands[6],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      stage = "source-version";
      await checked(() =>
        custom.verifySourceCheckoutVersion(
          p.python.path,
          files.chromium,
          lock.upstream.cef.version,
        ),
      );
      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);
      await normalizeFullSourceDepotToolsSentinel(root, p, argv[2]);
      // BEGIN SOURCE OWNED CHECKPOINT RESTORE
      let restoredCheckpoint;
      if (c.inputs.restore_run !== "0") {
        need(
          c.checkpointRestore &&
            c.checkpointRestore.runId === c.inputs.restore_run,
          "FULL_RESTORE_CONTEXT",
        );
        fullBootstrapAuthority(root, p, argv[2]);
        stage = "restore-checkpoint";
        const rawRestore = await checked(() =>
          executeCommand(
            executionCommands[8],
            executionCommands,
            env,
            files,
            budget,
            limits,
            true,
            { value: bootstrap, contextSha: argv[2] },
          ),
        );
        fullBootstrapAuthority(root, p, argv[2]);
        restoredCheckpoint = qualificationBoundedJson(
          Buffer.from(rawRestore),
          131072,
        );
        need(
          restoredCheckpoint.dataOnly === true &&
            restoredCheckpoint.restored === true &&
            restoredCheckpoint.priorGraphFile ===
              "full-sdk-checkpoint-import/graph.json",
          "FULL_RESTORE_DATA",
        );
        await held(
          path.join(root, restoredCheckpoint.priorGraphFile),
          16 * 1024 ** 2,
          budget,
          restoredCheckpoint.graphPin,
        );
        fullBootstrapAuthority(root, p, argv[2]);
      } else need(c.checkpointRestore === null, "FULL_RESTORE_UNREQUESTED");
      // END SOURCE OWNED CHECKPOINT RESTORE
      stage = "cef-gn";
      await checked(() =>
        executeCommand(
          executionCommands[7],
          executionCommands,
          env,
          files,
          budget,
          limits,
          false,
          { value: bootstrap, contextSha: argv[2] },
        ),
      );
      qualificationOwner = beginFullMetadataSource({
        root,
        c,
        p,
        budget,
        tools,
        files,
        privatePolicyRaw,
        custom,
        checkpoint,
        gitPolicy,
        env,
        checked,
        output: limits,
        contextSha: argv[2],
      });
      await qualificationOwnerAwait(
        qualificationOwner,
        held(
          path.join(files.chromium, "out/Release_GN_arm64/build.ninja"),
          16 * 1024 ** 2,
          budget,
        ),
      );
      generatedArguments = validateGeneratedArguments(
        await qualificationOwnerAwait(
          qualificationOwner,
          held(
            path.join(files.chromium, "out/Release_GN_arm64/args.gn"),
            1024 ** 2,
            budget,
          ),
        ),
      );
      stage = "graph-inventory";
      currentProgress.phase("graph-inventory");
      const capture = await collectQualificationGraph(qualificationOwner);
      graph = capture.summary;
      const snapshot = capture.diagnostic;
      // BEGIN FRESH RESTORED GRAPH COMPARISON
      if (restoredCheckpoint) {
        const priorGraph = qualificationBoundedJson(
          await qualificationOwnerAwait(
            qualificationOwner,
            held(
              path.join(root, "full-sdk-checkpoint-import/graph.json"),
              16 * 1024 ** 2,
              budget,
              restoredCheckpoint.graphPin,
            ),
          ),
          16 * 1024 ** 2,
        );
        fullMetadataOwner(qualificationOwner);
        need(
          staticProjectionEqual(snapshot, priorGraph),
          "FULL_RESTORE_FRESH_GRAPH_MISMATCH",
        );
      }
      // END FRESH RESTORED GRAPH COMPARISON
      budget.remaining();
      await qualificationOwnerAwait(
        qualificationOwner,
        fs.writeFile(
          path.join(files.logs, "fresh-graph-pins.json"),
          JSON.stringify(snapshot) + "\n",
          { flag: "wx" },
        ),
      );
      budget.remaining();
    });
    qualificationOwnerCheck(qualificationOwner);
    stage = "metadata-qualification";
    currentProgress.phase(stage);
    await coordinateFullMetadata(commitFullMetadataGraph(qualificationOwner));
    success = true;
    currentProgress.phase("complete");
    stage = "complete";
  } catch (error) {
    retireQualificationSource(qualificationOwner, true, error);
    failed = true;
    primary = error;
    throw error;
  } finally {
    fullSourceProfiles.delete(p);
    retireQualificationSource(qualificationOwner);
    currentProgress?.close();
    const code =
      typeof primary?.message === "string" &&
      /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(primary.message)
        ? primary.message
        : failed
          ? "FULL_SOURCE_FAILED"
          : null;
    const report = {
      kind: "windows-arm-source-gn",
      success,
      stage: success ? "complete" : stage,
      firstFailure: success ? null : code,
      target: TARGET,
      sourceId: p.sourceGn.sourceId,
      graph,
      generatedArguments,
      compilerExecuted: null,
      engineCompilationRequested: false,
      engineCheckpointImplemented: false,
      sdkBuilt: false,
      nativeAcceptance: false,
      sourceCloseFailure,
      gitPolicy: custom.sourceGitIsolationEvidence(gitPolicy),
      outerJobCleanupNotInferred: true,
    };
    try {
      await fs.writeFile(
        path.join(root, "full-source-gn-result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
      );
    } catch (error) {
      sourceReportingFailure = true;
      if (!failed) throw error;
    }
  }
}
// END CLOSED FULL SDK SOURCE BODY

// BEGIN INACTIVE FULL SDK SOURCE INTERFACE
// Historical derivation marker; admission is a reviewed SOURCE attempt only.
export function fullSdkSourceMain(argv = process.argv.slice(2)) {
  need(
    !utilTypes.isProxy(argv) &&
      Array.isArray(argv) &&
      Object.getPrototypeOf(argv) === Array.prototype &&
      Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===
        "0,1,2,3,length" &&
      Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>
        Object.hasOwn(row, "value"),
      ) &&
      argv.length === 4 &&
      argv.every((value) => typeof value === "string") &&
      argv[0] === "--full-sdk-source-gn" &&
      /^[a-f0-9]{64}$/.test(argv[2]) &&
      argv[3] === "--execute",
    "FULL_DRIVER_ARGV",
  );
  return runFullSourceBody(argv);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  Promise.resolve()
    .then(() => fullSdkSourceMain())
    .catch((error) => {
      const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,80}$/.test(
        error?.message ?? "",
      )
        ? error.message
        : "FULL_SDK_SOURCE_FAILED";
      console.error(
        JSON.stringify({
          success: false,
          firstFailure: code,
          executionAdmitted: false,
        }),
      );
      process.exitCode = 1;
    });
}
// END INACTIVE FULL SDK SOURCE INTERFACE
