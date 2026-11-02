// Closed Windows ARM source/GN adapter. Import is inert; no compiler entry.
import fs from "node:fs/promises";
import {
  constants,
  openSync,
  writeSync,
  closeSync,
  writeFileSync,
  watch,
} from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
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
    tools = reviewedHostTools(p);
  keys(value, ["image", "rows", "peBytes", "edgeCount", "edgeSha256"]);
  need(
    image === value.image && image === p.image && image === "20261021.278.1",
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
  need(
    p.sourceGn.mode === "source-gn" &&
      p.sourceGn.sourceId ===
        "b04bd747863065cb2cd5a52088ac36d24427b1e505b269c234d4ee5f444077be" &&
      p.sourceGn.namespace ===
        "native/cef-build-inputs/20261026-r5-capsule23-windows-arm64-cross-x64-external-webview/" &&
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
  need(/^[a-f0-9]{64}$/.test(contextSha), "FULL_CONTEXT_PIN");
  const policy = {
    root: root.replaceAll("\\", "/"),
    depot: files.depot.replaceAll("\\", "/"),
    commands: files.commands.replaceAll("\\", "/"),
    native: HERE.replaceAll("\\", "/"),
    workspace: files.workspace.replaceAll("\\", "/"),
    python: p.python.path,
    contextSha,
    enabled:
      p.phaseAdmission["source-gn"] === true &&
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
 data.need(P['enabled'] is True and value['mode']=='source-gn' and value['image']==P['image']=='20261021.278.1' and value['repositoryId']=='1010282954' and value['visibility']=='public' and value['event']=='workflow_dispatch' and value['ref']=='refs/heads/codex/windows-arm-source-gn-20261026','FULL_BOOTSTRAP_AUTHORITY')
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
def run_checked(command,clock):
 seconds=clock.remaining()-120;data.need(seconds>0,'FULL_SOURCE_RESERVE')
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
def execute(role,args,expected,guard_sha,runner=run_checked):
 data.need(role in ('cipd','vpython'),'FULL_BOOTSTRAP_ROLE');arguments(role,args)
 value,clock=verify(expected,guard_sha);failed=False
 try:
  code=runner([value['client'if role=='cipd'else 'vpython']['path'],*args],clock)
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
   values=list(args[1:]);arguments('cipd',values);inherited_environment(approved,kwargs.get('env'));current,_=verify(expected,guard_sha);kwargs['shell']=False
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
    `import sys,os,json
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
flat=gclient.Flattener(client,pin_all_deps=True)
hooks=[]
for kind,rows in [('hooks',flat._hooks),('pre_deps_hooks',flat._pre_deps_hooks)]:
 for dep,hook in rows:
  if len(hooks)>=512: raise RuntimeError('FULL_HOOK_COUNT')
  hooks.append(dict(kind=kind,name=hook.name,condition=hook.condition,pattern=hook.pattern,cwd=os.path.relpath(hook.effective_cwd).replace('\\\\','/'),action=hook.action))
origins=[dict(url=url,deps_file=filename,hierarchy=hierarchy) for url,filename,hierarchy in sorted(flat.deps_files)]
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
def admitted_dispatch(command,*args,**kwargs):
 if not getattr(scope,'active',False): return dispatch(command,*args,**kwargs)
 if type(command) is not list or not command or len(command)>64 or command[0] not in ('python3','vpython3.bat'): raise RuntimeError('FULL_HOOK_ENTRY')
 for value in command:
  if type(value) is not str or len(value)>4096 or any(c in value for c in '\\x00\\r\\n%&|<>!^'): raise RuntimeError('FULL_HOOK_SHELL_ARGUMENT')
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
 mapped=[adapter if command[0]=='python3' else os.path.join(os.path.dirname(adapter),'vpython3.bat'),*command[1:]]
 return dispatch(mapped,*args,**kwargs)
def admitted(self):
 previous=getattr(scope,'active',False)
 scope.active=True
 try: return original(self)
 finally: scope.active=previous
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
import gclient_util
original=gclient_util.RunAction
def reviewed_action(directory,command):
 if command and command[0]=='gn':
  if len(command)<3 or command[1]!='gen': raise RuntimeError('FULL_GN_COMMAND')
  command=[sys.executable,'-B','-c',${JSON.stringify(runner)},gn,expected,size,digest,*command[1:]]
 return original(directory,command)
gclient_util.RunAction=reviewed_action
sys.argv=[hook]
runpy.run_path(hook,run_name='__main__')
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

export async function main(argv = process.argv.slice(2)) {
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      argv.length === 4 &&
      argv[0] === "--source-gn" &&
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
    c.mode === "source-gn" &&
      c.ref === "refs/heads/codex/windows-arm-source-gn-20261026" &&
      c.repositoryId === "1010282954" &&
      c.visibility === "public" &&
      c.event === "workflow_dispatch",
    "FULL_DRIVER_AUTHORITY",
  );
  const profileRow = c.sources.find(
    (row) => row.path === "native/windows-arm-full-sdk/profile.json",
  );
  const p = JSON.parse(
    await held(path.join(HERE, "profile.json"), 65536, provisional, profileRow),
  );
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
    p.phaseAdmission["source-gn"] === true,
    "FULL_SOURCE_ADMISSION_UNAVAILABLE",
  );
  need(
    c.sources.length === 11 && p.sourcePaths.length === 11,
    "FULL_DRIVER_SOURCES",
  );
  for (let i = 0; i < c.sources.length; i++) {
    const row = c.sources[i];
    need(row.path === p.sourcePaths[i], "FULL_DRIVER_SOURCES");
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  }
  for (const row of [...p.sourceGn.helpers, ...p.sourceGn.sourceData])
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  await verifyHostClosure(p, budget, c.image);
  need(
    (await fs.realpath(process.execPath)).toLowerCase() ===
      (await fs.realpath(tools.node.path)).toLowerCase(),
    "FULL_DRIVER_NODE",
  );
  const custom = await import(
    pathToFileURL(path.join(REPO, "scripts/lib/browser-custom-runtime.mjs"))
  );
  const patched = await import(
    pathToFileURL(path.join(REPO, "scripts/cef-patched-runtime.mjs"))
  );
  const runtime = await import(
    pathToFileURL(path.join(REPO, "scripts/cef-runtime-ci.mjs"))
  );
  const checkpoint = await import(
    pathToFileURL(path.join(REPO, "scripts/lib/cef-engineering-checkpoint.mjs"))
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
  try {
    await sourceStage(root, budget, "source-acquisition", 4500, async () => {
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
      await held(
        path.join(files.chromium, "out/Release_GN_arm64/build.ninja"),
        16 * 1024 ** 2,
        budget,
      );
      generatedArguments = validateGeneratedArguments(
        await held(
          path.join(files.chromium, "out/Release_GN_arm64/args.gn"),
          1024 ** 2,
          budget,
        ),
      );
      stage = "graph-inventory";
      let snapshot;
      const maximum = Math.min(180000, Math.floor(budget.remaining() - 120000));
      need(maximum > 0, "FULL_SOURCE_RESERVE");
      graph = await checkpoint.graphInventory(
        path.join(files.chromium, "out/Release_GN_arm64"),
        {
          timeoutMs: maximum,
          observePins: (value) => {
            snapshot = checkpoint.graphPinSnapshot(value);
          },
        },
      );
      need(snapshot !== undefined, "FULL_GRAPH_PINS");
      budget.remaining();
      await fs.writeFile(
        path.join(files.logs, "fresh-graph-pins.json"),
        JSON.stringify(snapshot) + "\n",
        { flag: "wx" },
      );
      budget.remaining();
    });
    success = true;
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
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
      stage,
      firstFailure: code,
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = /^(?:FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(error?.message ?? "")
      ? error.message
      : "FULL_SOURCE_UNAVAILABLE";
    console.error(
      JSON.stringify({
        success: false,
        firstFailure: code,
        sourceCloseFailure,
        sourceReportingFailure,
        sdkBuilt: false,
      }),
    );
    // Enclosing actual Job owns/reaps all descendants, including a command
    // whose pipes remain open after an earlier stream/log/clock failure.
    process.exit(1);
  });
}
