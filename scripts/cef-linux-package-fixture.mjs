// Explicit disposable package experiment. Import and plan never execute tools.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, watch } from "node:fs";
import { compileSlice } from "./lib/cef-engineering-checkpoint.mjs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fixtureClientBuild,
  fixtureRunArguments,
  nativeChildEnvironment,
} from "./cef-runtime-acceptance-ci.mjs";
import {
  prepareCustomRuntime,
  customRuntimeEnvironment,
  stageCustomRuntimePackage,
} from "./lib/browser-custom-runtime.mjs";
import { resolveLocalRuntime } from "./lib/browser-local-runtime.mjs";
import {
  bundleConfiguration,
  linuxLauncher,
  copyTreeExclusive,
} from "./browser-app-build.mjs";
import {
  prepareLinuxPackageSandbox,
  linuxSandboxInstallerBody,
} from "./lib/linux-package-sandbox.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const FIXTURE_REF = "refs/heads/codex/ci-linux-package-fixture-20261027";
export const TARGET = "x86_64-unknown-linux-gnu";
export const PRODUCT = "sortOfRemoteNG";
export const FIXTURE = "sorng-cef-tls-acceptance";
const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const failureCode = (error) => {
  try {
    const code = error?.message;
    if (typeof code === "string" && /^LPF_[A-Z_]+$/.test(code)) return code;
  } catch {
    /* Closed code only. */
  }
  return "LPF_OPERATION_FAILED";
};
export const SDK = Object.freeze({
  releaseId: 424940739,
  tag: "cef-patched-8e8641855d7f7ddc63ce7bfd3e9b5adcc5f5ffc64103b0fc469c69608538f279-x86_64-unknown-linux-gnu",
  producerHead: "48085e3c65a834c8a9fc92a515eb73679c8fe5d2",
  sourceId: "8e8641855d7f7ddc63ce7bfd3e9b5adcc5f5ffc64103b0fc469c69608538f279",
  descriptorSha256:
    "5f8c8dd960303b1046d4669b89f4a10c47dd01e70f639a4d6d52ca2c601a7db3",
  assets: [
    [
      680059714,
      "manifest.json",
      203381,
      "0291ead14718d1735c90c2deca7311c635b888f2fea68ded12431999202dd5e7",
    ],
    [
      680059753,
      "receipt.json",
      469,
      "a1a9ebfb2cc75ae3494fd4952c3fb65a05fb9974d27e7db728ceacacc11ac34e",
    ],
    [
      680060254,
      "runtime.json",
      1789,
      "5f8c8dd960303b1046d4669b89f4a10c47dd01e70f639a4d6d52ca2c601a7db3",
    ],
    [
      680059795,
      "sorng-cef-custom-8e8641855d7f7ddc63ce7bfd3e9b5adcc5f5ffc64103b0fc469c69608538f279-x86_64-unknown-linux-gnu.tar.bz2",
      250575999,
      "21402ae497a824d19de82784e4c501f92bdaa2a7e8125c911e052d920c366947",
    ],
    [
      680059695,
      "source-lock.json",
      6534,
      "d158677523e1db2bf730c9f18a219a93b823c7c09e349b87ae3fb2a3ae0de441",
    ],
  ],
});
const descriptorUrl = `https://github.com/supermarsx/sortOfRemoteNG/releases/download/${SDK.tag}/runtime.json`;
export function fixtureAuthority(env, event) {
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REF === FIXTURE_REF &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        `supermarsx/sortOfRemoteNG/.github/workflows/browser-native-packages.yml@${FIXTURE_REF}` &&
      event?.repository?.id === 1010282954 &&
      event.repository.full_name === env.GITHUB_REPOSITORY &&
      event.repository.private === false &&
      event.repository.visibility === "public" &&
      event.repository.default_branch === "main" &&
      (event.inputs == null ||
        (typeof event.inputs === "object" &&
          !Array.isArray(event.inputs) &&
          Object.keys(event.inputs).length === 0)),
    "LPF_AUTHORITY",
  );
}
export function fixtureBudget(wall = Date.now, mono = () => performance.now()) {
  const begin = wall(),
    start = mono(),
    workMs = 120 * 60_000;
  return {
    remaining(reserve = 10 * 60_000) {
      const value =
        Math.min(begin + workMs - wall(), workMs - (mono() - start)) - reserve;
      need(Number.isFinite(value) && value > 0, "LPF_DEADLINE");
      return value;
    },
    phase(maximum) {
      return Math.min(maximum, this.remaining());
    },
    cleanupRemaining() {
      return Math.max(
        0,
        Math.min(
          begin + workMs + 30000 - wall(),
          workMs + 30000 - (mono() - start),
        ),
      );
    },
  };
}
export function validatePublishedSdk(value) {
  need(
    value?.id === SDK.releaseId &&
      value.tag_name === SDK.tag &&
      value.target_commitish === SDK.producerHead &&
      value.draft === false &&
      value.prerelease === true &&
      Array.isArray(value.assets) &&
      value.assets.length === 5,
    "LPF_RELEASE",
  );
  for (const [id, name, size, hash] of SDK.assets) {
    const matches = value.assets.filter((a) => a.name === name);
    need(
      matches.length === 1 &&
        matches[0].id === id &&
        matches[0].size === size &&
        matches[0].state === "uploaded" &&
        matches[0].digest === `sha256:${hash}` &&
        matches[0].browser_download_url ===
          descriptorUrl.replace(/runtime\.json$/, name),
      "LPF_ASSET",
    );
  }
  return value;
}
export function packageFixturePlan(root) {
  need(path.isAbsolute(root), "LPF_ROOT");
  const cargo = path.join(root, "raw-cargo"),
    published = path.join(root, "published-cargo");
  const client = fixtureClientBuild(TARGET, "tls");
  return {
    kind: "disposable-linux-package-fixture",
    target: TARGET,
    productName: PRODUCT,
    appName: FIXTURE,
    root,
    payload: path.join(root, "payload"),
    platform: "linux",
    cargo,
    published,
    fixtureBuild: client.args,
    helperBuild: [
      "scripts/native-build-env.mjs",
      "cargo",
      "build",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "-p",
      "sorng-browser-host",
      "--features",
      "cef-host",
      "--bin",
      "sorng-cef-helper",
      "--locked",
      "--target",
      TARGET,
      "-j2",
    ],
    fetch: [
      "scripts/cef-runtime-fetch.mjs",
      "--descriptor-url",
      descriptorUrl,
      "--descriptor-sha256",
      SDK.descriptorSha256,
      "--target",
      TARGET,
      "--cache-root",
      path.join(root, "sdk-cache"),
      "--selection",
      path.join(root, "selection.json"),
      "--python",
      "/usr/bin/python3",
    ],
    installedHelper: `/usr/lib/${PRODUCT}/chrome-sandbox`,
    installedFixture: `/usr/lib/${PRODUCT}/${FIXTURE}.bin`,
    wholeSeconds: 7200,
    cleanupSeconds: 30,
    insideReserveSeconds: 600,
    formats: ["deb", "rpm", "appimage"],
    fixtureOnly: true,
    releaseAppAccepted: false,
  };
}
async function physical(file) {
  need(
    path.isAbsolute(file) && (await fs.realpath(file)) === file,
    "LPF_ALIAS",
  );
  for (let at = file; ; at = path.dirname(at)) {
    need(!(await fs.lstat(at)).isSymbolicLink(), "LPF_LINK");
    if (path.dirname(at) === at) break;
  }
}
async function json(file, maximum = 1024 ** 2) {
  return JSON.parse((await measure(file, maximum, true)).raw.toString("utf8"));
}
let reportBytes = 0;
async function save(file, value) {
  const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  need(
    raw.length <= 1024 ** 2 && reportBytes + raw.length <= 16 * 1024 ** 2,
    "LPF_REPORT_BOUND",
  );
  reportBytes += raw.length;
  await fs.writeFile(file, raw, { flag: "wx" });
}
async function measure(file, maximum = 1024 ** 3, retain = false) {
  need(!retain || maximum <= 1024 ** 2, "LPF_JSON_BOUND");
  await physical(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximum),
    "LPF_FILE",
  );
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let failed = false;
  const sig = (s) =>
    [s.dev, s.ino, s.size, s.nlink, s.mtimeNs, s.ctimeNs].join(":");
  try {
    need(sig(before) === sig(await fd.stat({ bigint: true })), "LPF_CHANGED");
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(65536),
      chunks = [];
    let bytes = 0;
    while (bytes < Number(before.size)) {
      const { bytesRead } = await fd.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - bytes),
        null,
      );
      need(bytesRead > 0, "LPF_TRUNCATED");
      bytes += bytesRead;
      digest.update(buffer.subarray(0, bytesRead));
      if (retain) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    need(
      sig(before) === sig(await fd.stat({ bigint: true })) &&
        sig(before) === sig(await fs.lstat(file, { bigint: true })),
      "LPF_CHANGED",
    );
    return {
      bytes,
      sha256: digest.digest("hex"),
      ...(retain ? { raw: Buffer.concat(chunks, bytes) } : {}),
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
}

export function parseProcStat(raw) {
  const end = raw.lastIndexOf(")"),
    first = /^([1-9][0-9]*) \(/.exec(raw);
  need(first && end > first[0].length, "LPF_PROC_STAT");
  const fields = raw
      .slice(end + 1)
      .trim()
      .split(/\s+/),
    pid = Number(first[1]),
    parent = Number(fields[1]),
    group = Number(fields[2]),
    start = Number(fields[19]);
  need(
    [pid, parent, group, start].every(Number.isSafeInteger) &&
      pid > 0 &&
      parent >= 0 &&
      group > 0 &&
      start > 0,
    "LPF_PROC_STAT",
  );
  return { pid, parent, group, start };
}
// Only /proc descendants of the actual held child are admitted. No system PID scan.
export async function observeFixture(
  rootPid,
  budget,
  stopped,
  io = fs,
  expected = null,
  onRoot,
) {
  const records = new Map(),
    facts = [];
  let bytes = 0,
    complete = false,
    failed = false;
  async function open(pid) {
    return io.open(
      `/proc/${pid}`,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  }
  async function read(record, leaf, maximum) {
    need(bytes < 65536, "LPF_OBSERVATION_BOUND");
    const file = await io.open(
      `/proc/self/fd/${record.fd.fd}/${leaf}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let failed = false;
    try {
      const buffer = Buffer.alloc(Math.min(maximum, 65536 - bytes));
      const result = await file.read(buffer, 0, buffer.length, null);
      bytes += result.bytesRead;
      need(result.bytesRead < buffer.length, "LPF_OBSERVATION_BOUND");
      return buffer.subarray(0, result.bytesRead).toString("utf8");
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await file.close();
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }
  const namespaces = async (record) => {
    const result = {};
    for (const name of ["user", "pid", "mnt"]) {
      const value = await io.readlink(
        `/proc/self/fd/${record.fd.fd}/ns/${name}`,
      );
      bytes += Buffer.byteLength(value);
      need(
        bytes <= 65536 && new RegExp(`^${name}:\\[[0-9]{1,20}\\]$`).test(value),
        "LPF_NAMESPACE",
      );
      result[name] = value;
    }
    return result;
  };
  try {
    const seed = { pid: rootPid, fd: await open(rootPid) };
    records.set(rootPid, seed);
    Object.assign(seed, parseProcStat(await read(seed, "stat", 4096)));
    need(
      seed.pid === rootPid && seed.parent === process.pid,
      "LPF_ROOT_MEMBERSHIP",
    );
    const parentNamespaces = await namespaces(seed);
    await onRoot?.();
    for (let turn = 0; !stopped() && turn < 256; turn++) {
      budget.remaining();
      for (const original of [...records.values()]) {
        let current;
        try {
          current = parseProcStat(await read(original, "stat", 4096));
        } catch (error) {
          if (error?.code === "ENOENT" || error?.code === "ESRCH") continue;
          throw error;
        }
        need(
          current.start === original.start &&
            current.parent === original.parent,
          "LPF_PROCESS_REPLACED",
        );
        const children = (
          await read(original, `task/${original.pid}/children`, 4096)
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        need(
          children.length <= 16 &&
            children.every((p) => /^[1-9][0-9]{0,9}$/.test(p)),
          "LPF_CHILD_BOUND",
        );
        for (const child of children) {
          const pid = Number(child);
          if (records.has(pid)) continue;
          need(records.size < 16, "LPF_CHILD_BOUND");
          const record = { pid, fd: await open(pid) };
          records.set(pid, record);
          Object.assign(
            record,
            parseProcStat(await read(record, "stat", 4096)),
          );
          need(
            record.pid === pid &&
              record.parent === original.pid &&
              record.start >= seed.start,
            "LPF_CHILD_MEMBERSHIP",
          );
        }
      }
      for (const record of [...records.values()].slice(1)) {
        const status = await read(record, "status", 8192),
          command = await read(record, "cmdline", 4096);
        const uid = /^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/m.exec(
            status,
          ),
          nnp = /^NoNewPrivs:\s+([01])$/m.exec(status),
          seccomp = /^Seccomp:\s+([012])$/m.exec(status);
        need(uid && nnp && seccomp, "LPF_STATUS");
        const ns = await namespaces(record),
          after = parseProcStat(await read(record, "stat", 4096));
        need(
          after.start === record.start && after.parent === record.parent,
          "LPF_PROCESS_REPLACED",
        );
        const role = command.split("\0").includes("--type=renderer")
          ? "renderer"
          : "owned-other";
        const fact = {
          pid: record.pid,
          start: record.start,
          role,
          uid: uid.slice(1).map(Number),
          noNewPrivs: Number(nnp[1]),
          seccomp: Number(seccomp[1]),
          userNamespaceDifferent: ns.user !== parentNamespaces.user,
          pidNamespaceDifferent: ns.pid !== parentNamespaces.pid,
          mountNamespaceDifferent: ns.mnt !== parentNamespaces.mnt,
        };
        if (role === "renderer") {
          need(
            expected && expected.helper && expected.format,
            "LPF_EXECUTABLE_AUTHORITY",
          );
          const executable = await io.readlink(
            `/proc/self/fd/${record.fd.fd}/exe`,
          );
          const installed = `/usr/lib/${PRODUCT}/${FIXTURE}.helper`,
            mounted = new RegExp(
              `^/tmp/\\.mount_[A-Za-z0-9_.-]+/usr/lib/${PRODUCT}/${FIXTURE}\\.helper$`,
            ).test(executable);
          need(
            expected.format === "appimage" ? mounted : executable === installed,
            "LPF_LOADED_PATH",
          );
          const fd = await io.open(
            `/proc/self/fd/${record.fd.fd}/exe`,
            constants.O_RDONLY,
          );
          let failed = false;
          try {
            const before = await fd.stat({ bigint: true });
            need(
              before.isFile() &&
                before.nlink === 1n &&
                before.size === BigInt(expected.helper.bytes),
              "LPF_LOADED_FILE",
            );
            const hash = createHash("sha256"),
              buffer = Buffer.alloc(65536);
            let count = 0;
            while (count < expected.helper.bytes) {
              budget.remaining();
              const part = await fd.read(
                buffer,
                0,
                Math.min(buffer.length, expected.helper.bytes - count),
                null,
              );
              need(part.bytesRead > 0, "LPF_LOADED_SIZE");
              count += part.bytesRead;
              hash.update(buffer.subarray(0, part.bytesRead));
            }
            const after = await fd.stat({ bigint: true });
            need(
              ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
                (key) => before[key] === after[key],
              ) && hash.digest("hex") === expected.helper.sha256,
              "LPF_LOADED_HASH",
            );
            fact.executableVerified = true;
            fact.loadedHelperSha256 = expected.helper.sha256;
            fact.loadedHelperBytes = count;
            fact.helperMode = Number(before.mode & 0o7777n);
            fact.mountedAppImage = mounted;
            fact.executablePath = executable;
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            try {
              await fd.close();
            } catch (error) {
              if (!failed) throw error;
            }
          }
          const bound = parseProcStat(await read(record, "stat", 4096));
          need(
            bound.start === record.start && bound.parent === record.parent,
            "LPF_PROCESS_REPLACED",
          );
        }
        const index = facts.findIndex((row) => row.pid === record.pid);
        if (index < 0) facts.push(fact);
        else facts[index] = fact;
        if (role === "renderer" && fact.noNewPrivs === 1 && fact.seccomp === 2)
          complete = true;
      }
      if (complete) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      kind: "owned-linux-fixture-namespaces",
      complete,
      bytesRead: bytes,
      processes: records.size,
      facts,
      rawArgvRetained: false,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    let secondary,
      closeFailed = false;
    for (const record of [...records.values()].reverse())
      try {
        await record.fd.close();
      } catch (error) {
        if (!closeFailed) {
          closeFailed = true;
          secondary = error;
        }
      }
    if (!failed && closeFailed) throw secondary;
  }
}
export function namespaceAccepted(report, uid) {
  return (
    report?.complete === true &&
    report.facts.some(
      (r) =>
        r.role === "renderer" &&
        r.uid.every((u) => u === uid) &&
        r.executableVerified === true &&
        r.helperMode === 0o755 &&
        r.mountedAppImage === true &&
        r.noNewPrivs === 1 &&
        r.seccomp === 2 &&
        r.userNamespaceDifferent &&
        r.pidNamespaceDifferent &&
        r.mountNamespaceDifferent,
    )
  );
}

// The install module's exact read/hash/ancestor contract, with no ownership write.
export function installedAuditProgram(helper) {
  need(
    /^[a-f0-9]{64}$/.test(helper.sha256) &&
      Number.isSafeInteger(helper.bytes) &&
      helper.bytes >= 64,
    "LPF_HELPER_PIN",
  );
  const base = linuxSandboxInstallerBody
    .replace("@@HELPER_PATH@@", `/usr/lib/${PRODUCT}/chrome-sandbox`)
    .replace("@@HELPER_SHA@@", helper.sha256)
    .replace("@@HELPER_BYTES@@", String(helper.bytes))
    .replace("@@HELPER_MACHINE@@", "62");
  return (
    `BODY=${JSON.stringify(base)}\n` +
    `scope=dict(__name__='read_only_contract');exec(compile(BODY,'reviewed-sandbox-contract','exec'),scope)\n` +
    String.raw`
ops=scope['SystemOps']();handles=[];rows=[];primary=None
try:
 p=ops.root();handles.append(p);s=ops.fstat(p);scope['directory'](s);rows.append((None,'/',p,s))
 for name in scope['HELPER'].split('/')[1:-1]:
  s=ops.stat(p,name);scope['directory'](s);child=ops.directory(p,name);handles.append(child)
  scope['need'](scope['signature'](s)==scope['signature'](ops.fstat(child)),'LPKG_DIRECTORY_CHANGED');rows.append((p,name,child,s));p=child
 s=ops.stat(p,'chrome-sandbox');scope['regular'](s,(0o4755,));fd=ops.file(p,'chrome-sandbox');handles.append(fd)
 scope['need'](scope['signature'](s)==scope['signature'](ops.fstat(fd)),'LPKG_CHANGED');scope['hash_file'](ops,fd)
 scope['need'](scope['signature'](s)==scope['signature'](ops.fstat(fd))==scope['signature'](ops.stat(p,'chrome-sandbox')),'LPKG_CHANGED')
 for parent,name,held,before in rows:
  scope['need'](scope['signature'](before)==scope['signature'](ops.fstat(held)),'LPKG_DIRECTORY_CHANGED')
  if parent is not None:scope['need'](scope['signature'](before)==scope['signature'](ops.stat(parent,name)),'LPKG_DIRECTORY_CHANGED')
 print(scope['json'].dumps(dict(rootOwned=True,mode=2541,singleLink=True,sha256=scope['EXPECTED_SHA'],bytes=scope['EXPECTED_BYTES'],ownershipModified=False)))
except BaseException as error:primary=error;raise
finally:
 secondary=None
 for fd in reversed(handles):
  try:ops.close(fd)
  except BaseException as error:secondary=secondary or error
 if primary is None and secondary is not None:raise secondary
`
  );
}

function actorPackage(root, pkg) {
  need(
    pkg &&
      Object.keys(pkg).sort().join() === "bytes,file,format,sha256" &&
      ["deb", "appimage"].includes(pkg.format) &&
      Number.isSafeInteger(pkg.bytes) &&
      pkg.bytes > 0 &&
      pkg.bytes <= 1024 ** 3 &&
      /^[a-f0-9]{64}$/.test(pkg.sha256) &&
      typeof pkg.file === "string" &&
      path.dirname(pkg.file) === path.join(root, "packages") &&
      /^[A-Za-z0-9_.+-]+$/.test(path.basename(pkg.file)) &&
      pkg.file.endsWith(pkg.format === "deb" ? ".deb" : ".AppImage"),
    "LPF_ACTOR_PACKAGE",
  );
  return pkg.file;
}
// Fixed role selection, never a serialized executable/argv runner.
export function fixtureActorCommand(root, role, pkg = null, lock) {
  const plan = packageFixturePlan(root),
    metadata = path.join(root, "bundle-project");
  const packagePath = () => actorPackage(root, pkg);
  let executable = process.execPath,
    args,
    cwd = ROOT,
    expectedExit = 0;
  switch (role) {
    case "sdk-fetch":
      args = plan.fetch;
      break;
    case "build-helper":
      args = plan.helperBuild;
      break;
    case "build-tls":
      args = plan.fixtureBuild;
      break;
    case "bundle":
      cwd = metadata;
      args = [
        path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
        "bundle",
        "--target",
        TARGET,
        "--debug",
        "--config",
        path.join(metadata, "tauri.conf.json"),
        "--bundles",
        "deb",
        "rpm",
        "appimage",
      ];
      break;
    case "deb-absent":
      executable = "/usr/bin/dpkg-query";
      args = ["--status", "sort-of-remote-ng"];
      expectedExit = 1;
      break;
    case "install-deb":
      need(pkg?.format === "deb", "LPF_ACTOR_PACKAGE");
      executable = "/usr/bin/sudo";
      args = ["-n", "/usr/bin/apt-get", "install", "-y", packagePath()];
      break;
    case "audit-deb":
      executable = "/usr/bin/python3";
      args = ["-I", "-B", path.join(root, "installed-audit.py")];
      break;
    case "native-deb":
    case "native-appimage": {
      const format = role.slice(7);
      need(pkg?.format === format && lock, "LPF_ACTOR_PACKAGE");
      const file = packagePath();
      executable = "/usr/bin/dbus-run-session";
      args = [
        "--",
        "/usr/bin/xvfb-run",
        "-a",
        process.execPath,
        ...fixtureRunArguments(
          "tls",
          format === "deb" ? plan.installedFixture : file,
          path.join(root, "acceptance-" + format),
          undefined,
          lock,
        ),
      ];
      break;
    }
    default:
      throw new Error("LPF_ACTOR_ROLE");
  }
  return { executable, args, cwd, expectedExit };
}
export async function waitActorFile(directory, name, wallEnd, signal) {
  need(["ready.json", "go.json"].includes(name), "LPF_ACTOR_LEAF");
  const file = path.join(directory, name);
  return new Promise((resolve, reject) => {
    let timer,
      watcher,
      checking = false,
      again = false,
      ended = false,
      closed = false,
      failed = false,
      firstError,
      result,
      checkPending;
    const settle = () => {
      // A closed watcher is not a joined metadata read. The existing supervisor
      // bounds an unjoined check; no timeout pretends that its FD has closed.
      if (ended && closed && !checking) {
        if (failed) reject(firstError);
        else resolve(result);
      }
    };
    const finish = (rejected, error, value) => {
      if (ended) return;
      ended = true;
      failed = rejected;
      firstError = error;
      result = value;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const done = () => {
        closed = true;
        settle();
      };
      if (watcher) {
        watcher.once("close", done);
        try {
          watcher.close();
        } catch (closeError) {
          watcher.removeListener("close", done);
          if (!failed) {
            failed = true;
            firstError = closeError;
          }
          done();
        }
      } else done();
      settle();
    };
    const abort = () => finish(true, new Error("LPF_ACTOR_ABORTED"));
    const check = () => {
      if (ended) return;
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      checkPending = (async () => {
        try {
          const value = await json(file, 4096);
          finish(false, undefined, value);
        } catch (error) {
          if (error?.code !== "ENOENT") finish(true, error);
        } finally {
          checking = false;
          if (ended) settle();
          else if (again) {
            again = false;
            check();
          }
        }
      })();
      checkPending.catch((error) => {
        finish(true, error);
        checking = false;
        settle();
      });
    };
    try {
      need(
        Number.isFinite(wallEnd) && wallEnd > Date.now(),
        "LPF_ACTOR_DEADLINE",
      );
      watcher = watch(directory, check);
      watcher.once("error", (error) => finish(true, error));
      timer = setTimeout(
        () => finish(true, new Error("LPF_ACTOR_DEADLINE")),
        wallEnd - Date.now(),
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    } catch (error) {
      finish(true, error);
    }
  });
}
export async function fixtureActor(root, role, contextSha) {
  need(
    [
      "sdk-fetch",
      "build-helper",
      "build-tls",
      "bundle",
      "deb-absent",
      "install-deb",
      "audit-deb",
      "native-deb",
      "native-appimage",
    ].includes(role),
    "LPF_ACTOR_ROLE",
  );
  need(
    process.platform === "linux" &&
      process.getuid() > 0 &&
      /^[a-f0-9]{64}$/.test(contextSha),
    "LPF_ACTOR_AUTHORITY",
  );
  await physical(root);
  need(
    path.dirname(root) === (await fs.realpath(process.env.RUNNER_TEMP)) &&
      /^sorng-linux-package-fixture-[a-f0-9-]{36}$/.test(path.basename(root)),
    "LPF_ACTOR_ROOT",
  );
  const directory = path.join(root, "actors", role),
    contextFile = path.join(directory, "context.json");
  const pin = await measure(contextFile, 4096, true);
  need(pin.sha256 === contextSha, "LPF_ACTOR_CONTEXT");
  const context = JSON.parse(pin.raw.toString("utf8"));
  need(
    Object.keys(context).sort().join() ===
      "audit,lock,parentPid,pkg,role,root,sourceSha,wallEnd" &&
      context.root === root &&
      context.role === role &&
      context.parentPid === process.ppid &&
      context.sourceSha ===
        (await measure(fileURLToPath(import.meta.url))).sha256 &&
      Number.isSafeInteger(context.wallEnd) &&
      context.wallEnd > Date.now() &&
      context.wallEnd <= Date.now() + 7200000 &&
      [context.audit, context.lock].every(
        (value) => value === null || /^[a-f0-9]{64}$/.test(value),
      ),
    "LPF_ACTOR_CONTEXT",
  );
  await save(path.join(directory, "ready.json"), {
    pid: process.pid,
    parent: process.ppid,
    contextSha,
  });
  const gate = await waitActorFile(directory, "go.json", context.wallEnd);
  need(
    Object.keys(gate).sort().join() === "contextSha,parent,pid,start" &&
      gate.pid === process.pid &&
      gate.parent === process.ppid &&
      gate.contextSha === contextSha &&
      typeof gate.start === "string" &&
      gate.start.length > 0 &&
      gate.start.length <= 64,
    "LPF_ACTOR_GATE",
  );
  need(
    role.startsWith("native-") || role === "install-deb"
      ? context.pkg !== null
      : context.pkg === null,
    "LPF_ACTOR_PACKAGE",
  );
  need(
    role.startsWith("native-") ? context.lock !== null : context.lock === null,
    "LPF_ACTOR_LOCK",
  );
  need(
    role === "audit-deb" ? context.audit !== null : context.audit === null,
    "LPF_ACTOR_AUDIT",
  );
  if (context.pkg)
    need(
      JSON.stringify(await measure(actorPackage(root, context.pkg))) ===
        JSON.stringify({
          bytes: context.pkg.bytes,
          sha256: context.pkg.sha256,
        }),
      "LPF_ACTOR_PACKAGE",
    );
  let lock;
  if (context.lock) {
    const held = await measure(
      path.join(root, "fixture-lock.json"),
      1024 ** 2,
      true,
    );
    need(held.sha256 === context.lock, "LPF_ACTOR_LOCK");
    lock = JSON.parse(held.raw.toString("utf8"));
  }
  if (context.audit)
    need(
      (await measure(path.join(root, "installed-audit.py"))).sha256 ===
        context.audit,
      "LPF_ACTOR_AUDIT",
    );
  const command = fixtureActorCommand(root, role, context.pkg, lock);
  // The admitted actor remains alive until the actual fixed tool closes. The
  // maintained outer supervisor owns descendants and inherited-pipe failure.
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (value, signal) =>
      signal === null && Number.isInteger(value)
        ? resolve(value)
        : reject(new Error("LPF_ACTOR_EXIT")),
    );
  });
  process.exitCode = code;
}
let commandQuiescent = false;
export async function command(
  executable,
  args,
  {
    root,
    role,
    cwd = ROOT,
    env,
    budget,
    maximum,
    ledger,
    observe = false,
    expectedExit = 0,
    pkg = null,
    lock,
  },
) {
  commandQuiescent = false;
  const planned = fixtureActorCommand(root, role, pkg, lock);
  need(
    planned.executable === executable &&
      planned.cwd === cwd &&
      planned.expectedExit === expectedExit &&
      JSON.stringify(planned.args) === JSON.stringify(args),
    "LPF_ACTOR_VECTOR",
  );
  const milliseconds = Math.floor(budget.phase(maximum)),
    wallEnd = Date.now() + milliseconds,
    monoEnd = performance.now() + milliseconds;
  const directory = path.join(root, "actors", role);
  await fs.mkdir(directory);
  const logs = path.join(directory, "logs");
  await fs.mkdir(logs);
  const context = {
    root,
    role,
    parentPid: process.pid,
    wallEnd,
    sourceSha: (await measure(fileURLToPath(import.meta.url))).sha256,
    pkg,
    lock: role.startsWith("native-")
      ? (await measure(path.join(root, "fixture-lock.json"))).sha256
      : null,
    audit:
      role === "audit-deb"
        ? (await measure(path.join(root, "installed-audit.py"))).sha256
        : null,
  };
  const contextFile = path.join(directory, "context.json");
  await save(contextFile, context);
  const contextSha = (await measure(contextFile)).sha256;
  let observation;
  const result = await compileSlice(
    process.execPath,
    [fileURLToPath(import.meta.url), "--owned-actor", root, role, contextSha],
    {
      cwd: ROOT,
      env,
      logs,
      milliseconds: Math.floor(
        Math.min(
          wallEnd - Date.now(),
          monoEnd - performance.now(),
          budget.remaining(),
        ),
      ),
      outputLedger: ledger,
      observeRoot: async (identity, control) => {
        const ready = await waitActorFile(
          directory,
          "ready.json",
          wallEnd,
          control.signal,
        );
        need(
          Object.keys(ready).sort().join() === "contextSha,parent,pid" &&
            ready.pid === identity.pid &&
            ready.parent === process.pid &&
            ready.contextSha === contextSha,
          "LPF_ACTOR_READY",
        );
        const release = async () => {
          budget.remaining();
          need(
            !control.signal.aborted && Date.now() < wallEnd,
            "LPF_ACTOR_DEADLINE",
          );
          await save(path.join(directory, "go.json"), {
            ...identity,
            contextSha,
          });
        };
        if (observe)
          observation = await observeFixture(
            identity.pid,
            budget,
            () => control.rootExited() || control.signal.aborted,
            fs,
            observe,
            release,
          );
        else await release();
      },
    },
  );
  need(
    result.quiescent === true &&
      !result.ownTimerExpired &&
      result.outcome !== "slice-ended",
    "LPF_COMMAND_SUPERVISION",
  );
  // Only confirmed joined results can produce a business exit, never an unknown
  // cohort. Callers must stop the whole fixture on any earlier throw.
  for (const suffix of ["stdout.log", "stderr.log", "outcome.json"]) {
    const original = path.join(logs, "checkpoint-compile." + suffix),
      destination = path.join(root, "logs", role + "." + suffix);
    await fs.rename(original, destination);
  }
  commandQuiescent = true;
  need(result.exitCode === expectedExit, "LPF_COMMAND_EXIT");
  return observation;
}
async function publishedMetadata(budget) {
  const response = await fetch(
    `https://api.github.com/repos/supermarsx/sortOfRemoteNG/releases/${SDK.releaseId}`,
    {
      redirect: "error",
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(Math.min(30000, budget.remaining())),
    },
  );
  need(response.ok, "LPF_RELEASE_HTTP");
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      need(bytes <= 65536, "LPF_RELEASE_BOUND");
      chunks.push(chunk);
    }
  } finally {
    if (!response.bodyUsed) await response.body?.cancel();
  }
  return validatePublishedSdk(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}
export async function main(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  if (argv.length === 4 && argv[0] === "--owned-actor")
    return fixtureActor(argv[1], argv[2], argv[3]);
  if (argv.length === 1 && argv[0] === "plan")
    return packageFixturePlan(
      path.resolve(".artifacts/linux-package-fixture-plan"),
    );
  need(
    argv.length === 1 && argv[0] === "--execute",
    "LPF_EXPLICIT_EXECUTE_REQUIRED",
  );
  need(
    process.platform === "linux" &&
      process.arch === "x64" &&
      process.getuid() > 0,
    "LPF_NATIVE_UNPRIVILEGED_HOST",
  );
  const event = await json(environment.GITHUB_EVENT_PATH, 65536);
  fixtureAuthority(environment, event);
  const budget = fixtureBudget(),
    parent = await fs.realpath(environment.RUNNER_TEMP);
  await physical(parent);
  const root = path.join(parent, "sorng-linux-package-fixture-" + randomUUID());
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, "logs"));
  await fs.mkdir(path.join(root, "actors"));
  reportBytes = 0;
  const plan = packageFixturePlan(root),
    ledger = { bytes: 0, cap: 64 * 1024 ** 2 },
    results = [];
  let firstFailure,
    hasFailure = false;
  const report = {
    kind: "disposable-linux-package-fixture",
    fixtureOnly: true,
    sourceHead: environment.GITHUB_SHA,
    releaseId: SDK.releaseId,
    sourceId: SDK.sourceId,
    stage: "capacity",
    image: environment.ImageVersion ?? null,
    nodeVersion: process.version,
    rustToolchain: environment.RUSTUP_TOOLCHAIN ?? null,
    releaseAppAccepted: false,
    allLinuxArchitecturesAccepted: false,
    formats: results,
    success: false,
  };
  try {
    const mem = /^MemAvailable:\s+([0-9]+) kB$/m.exec(
        await fs.readFile("/proc/meminfo", "utf8"),
      ),
      disk = await fs.statfs(root, { bigint: true });
    need(
      mem &&
        Number(mem[1]) * 1024 >= 8 * 1024 ** 3 &&
        disk.bavail * disk.bsize >= 30n * 1024n ** 3n,
      "LPF_CAPACITY",
    );
    await save(
      path.join(root, "publication.json"),
      await publishedMetadata(budget),
    );
    let env = nativeChildEnvironment(environment, "", plan.cargo),
      sourceLock;

    const run = (role, exe, args, maximum, extra = {}) => {
      report.stage = role;
      return command(exe, args, {
        root,
        role,
        env,
        budget,
        maximum,
        ledger,
        lock: sourceLock,
        ...extra,
      });
    };
    await run("sdk-fetch", process.execPath, plan.fetch, 20 * 60_000);
    const selected = resolveLocalRuntime(
      { target: TARGET },
      { selectionFile: path.join(root, "selection.json") },
    );
    const manifest = await json(selected.customManifest),
      lock = await json(selected.sourceLock);
    sourceLock = lock;
    await save(path.join(root, "fixture-lock.json"), lock);
    report.stage = "sdk-prepare";
    const prepared = await prepareCustomRuntime({
      manifest,
      sourceLock: lock,
      target: TARGET,
      artifactRoot: selected.artifactRoot,
      sdkRoot: selected.sdk,
      output: path.join(root, "prepared-sdk"),
    });
    env = customRuntimeEnvironment(
      nativeChildEnvironment(environment, prepared.sdk, plan.cargo),
    );
    const buildMilliseconds = budget.phase(45 * 60_000),
      buildWall = Date.now() + buildMilliseconds,
      buildMono = performance.now() + buildMilliseconds;
    const buildRemaining = () => {
      const value = Math.min(
        buildWall - Date.now(),
        buildMono - performance.now(),
      );
      need(value > 0, "LPF_BUILD_DEADLINE");
      return value;
    };
    await run(
      "build-helper",
      process.execPath,
      plan.helperBuild,
      buildRemaining(),
    );
    await run(
      "build-tls",
      process.execPath,
      plan.fixtureBuild,
      buildRemaining(),
    );
    const raw = path.join(plan.cargo, TARGET, "debug"),
      app = path.join(raw, FIXTURE),
      helper = path.join(raw, "sorng-cef-helper");
    await save(path.join(root, "fixture-build.json"), {
      application: await measure(app),
      helper: await measure(helper),
      cargoLock: await measure(
        path.join(
          ROOT,
          "src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance/Cargo.lock",
        ),
      ),
      releaseAppBuilt: false,
    });
    const stage = await stageCustomRuntimePackage({
      plan: { ...prepared, target: TARGET, appName: FIXTURE },
      application: app,
      helper,
      output: plan.payload,
    });
    await save(path.join(plan.payload, "acceptance-staging.json"), stage);
    const sandbox = await prepareLinuxPackageSandbox(plan, {
      runtimeRoot: stage.staging.runtime,
    });
    const payloadFiles = (
      await fs.readdir(plan.payload, { withFileTypes: true })
    )
      .map((item) => item.name + (item.isDirectory() ? "/" : ""))
      .sort();
    const config = bundleConfiguration(
      {
        productName: PRODUCT,
        version: "0.1.0",
        identifier: "com.sortofremote.ng.package-fixture",
        mainBinaryName: FIXTURE,
        build: { frontendDist: "./frontend" },
        bundle: {
          active: true,
          targets: ["deb", "rpm", "appimage"],
          resources: {},
          shortDescription: "Disposable CEF TLS package fixture",
          icon: [path.join(ROOT, "src-tauri/icons/icon.png")],
        },
      },
      plan,
      payloadFiles,
      sandbox,
    );
    report.stage = "bundle-metadata";
    const metadata = path.join(root, "bundle-project");
    await fs.mkdir(metadata);
    const fixtureSource = path.join(
      ROOT,
      "src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance",
    );
    await copyTreeExclusive(
      path.join(fixtureSource, "src"),
      path.join(metadata, "src"),
    );
    const originalManifest = await fs.readFile(
      path.join(fixtureSource, "Cargo.toml"),
      "utf8",
    );
    const relocated = originalManifest
      .replace(
        'path = "../.."',
        `path = ${JSON.stringify(path.join(ROOT, "src-tauri/crates/sorng-browser-host"))}`,
      )
      .replace(
        'path = "../../../sorng-protocols"',
        `path = ${JSON.stringify(path.join(ROOT, "src-tauri/crates/sorng-protocols"))}`,
      );
    need(relocated !== originalManifest, "LPF_BUNDLE_METADATA");
    await fs.writeFile(path.join(metadata, "Cargo.toml"), relocated, {
      flag: "wx",
    });
    await fs.copyFile(
      path.join(fixtureSource, "Cargo.lock"),
      path.join(metadata, "Cargo.lock"),
      constants.COPYFILE_EXCL,
    );
    await fs.copyFile(
      path.join(fixtureSource, "build.rs"),
      path.join(metadata, "build.rs"),
      constants.COPYFILE_EXCL,
    );
    await fs.mkdir(path.join(metadata, "frontend"));
    await fs.writeFile(
      path.join(metadata, "frontend/index.html"),
      "<!doctype html><title>Engineering fixture</title>",
      { flag: "wx" },
    );
    const entry = path.join(plan.published, TARGET, "debug");
    await fs.mkdir(entry, { recursive: true });
    await fs.writeFile(
      path.join(entry, FIXTURE),
      linuxLauncher(FIXTURE, PRODUCT),
      { flag: "wx", mode: 0o755 },
    );
    await save(path.join(metadata, "tauri.conf.json"), config);
    need(
      (await json(path.join(ROOT, "node_modules/@tauri-apps/cli/package.json")))
        .version === "2.11.4",
      "LPF_TAURI_VERSION",
    );
    await run(
      "bundle",
      process.execPath,
      [
        path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
        "bundle",
        "--target",
        TARGET,
        "--debug",
        "--config",
        path.join(metadata, "tauri.conf.json"),
        "--bundles",
        "deb",
        "rpm",
        "appimage",
      ],
      15 * 60_000,
      { cwd: metadata, env: { ...env, CARGO_TARGET_DIR: plan.published } },
    );
    const packages = [];
    await fs.mkdir(path.join(root, "packages"));
    for (const format of plan.formats) {
      const directory = path.join(entry, "bundle", format),
        names = (await fs.readdir(directory)).filter((name) =>
          name.endsWith(format === "appimage" ? ".AppImage" : "." + format),
        );
      need(names.length === 1, "LPF_PACKAGE_AMBIGUOUS");
      need(/^[A-Za-z0-9_.+-]+$/.test(names[0]), "LPF_PACKAGE_NAME");
      const file = path.join(root, "packages", names[0]),
        source = path.join(directory, names[0]),
        pin = await measure(source);
      await fs.copyFile(source, file, constants.COPYFILE_EXCL);
      need(
        JSON.stringify(await measure(file)) === JSON.stringify(pin),
        "LPF_PACKAGE_CHANGED",
      );
      packages.push({ format, file, ...pin });
    }
    const sandboxPin = await measure(path.join(plan.payload, "chrome-sandbox")),
      compiledHelper = await measure(helper);
    for (const pkg of packages) {
      const result = {
        format: pkg.format,
        package: pkg,
        installed: false,
        nativeAccepted: false,
        namespaceAccepted: false,
        success: false,
      };
      results.push(result);
      try {
        if (pkg.format === "rpm")
          throw new Error("LPF_RPM_NATIVE_HOST_REQUIRED");
        let executable = pkg.file;
        if (pkg.format === "deb") {
          for (const previous of [`/usr/lib/${PRODUCT}`, `/usr/bin/${FIXTURE}`])
            try {
              await fs.lstat(previous);
              throw new Error("LPF_INSTALL_PREEXISTING");
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          await run(
            "deb-absent",
            "/usr/bin/dpkg-query",
            ["--status", "sort-of-remote-ng"],
            30000,
            { expectedExit: 1 },
          );
          await run(
            "install-deb",
            "/usr/bin/sudo",
            ["-n", "/usr/bin/apt-get", "install", "-y", pkg.file],
            10 * 60_000,
            { pkg },
          );
          result.installed = true;
          const audit = path.join(root, "installed-audit.py");
          await fs.writeFile(audit, installedAuditProgram(sandboxPin), {
            flag: "wx",
          });
          await run(
            "audit-deb",
            "/usr/bin/python3",
            ["-I", "-B", audit],
            30000,
          );
          executable = plan.installedFixture;
        }
        const output = path.join(root, "acceptance-" + pkg.format);
        const observer = await run(
          "native-" + pkg.format,
          "/usr/bin/dbus-run-session",
          [
            "--",
            "/usr/bin/xvfb-run",
            "-a",
            process.execPath,
            ...fixtureRunArguments("tls", executable, output, undefined, lock),
          ],
          10 * 60_000,
          { pkg, observe: { format: pkg.format, helper: compiledHelper } },
        );
        const directories = await fs.readdir(output),
          reports = directories.filter((name) => name.startsWith("run-"));
        need(reports.length === 1, "LPF_ACCEPTANCE_REPORT");
        const acceptance = await json(path.join(output, "acceptance.json"));
        need(
          acceptance.ok === true &&
            acceptance.nativeTlsFixtureAccepted === true &&
            acceptance.exitCode === 0 &&
            !acceptance.timedOut,
          "LPF_NATIVE_REJECTED",
        );
        result.nativeAccepted = true;
        result.namespaceAccepted = namespaceAccepted(
          observer,
          process.getuid(),
        );
        await save(path.join(root, pkg.format + "-namespaces.json"), observer);
        if (pkg.format === "appimage")
          need(result.namespaceAccepted, "LPF_APPIMAGE_NAMESPACE_UNPROVEN");
        need(
          JSON.stringify(await measure(pkg.file)) ===
            JSON.stringify({ bytes: pkg.bytes, sha256: pkg.sha256 }),
          "LPF_PACKAGE_CHANGED",
        );
        result.fallbackConfigured = pkg.format === "deb";
        result.suidBackendSelected = "not-inferred";
        result.success = true;
      } catch (error) {
        result.failure = failureCode(error);
        if (!hasFailure) {
          hasFailure = true;
          firstFailure = error;
        }
        if (
          !commandQuiescent &&
          error?.message !== "LPF_RPM_NATIVE_HOST_REQUIRED"
        )
          throw error;
      }
      await save(path.join(root, pkg.format + "-result.json"), result);
    }
    report.success = results.length === 3 && results.every((r) => r.success);
    if (hasFailure) throw firstFailure;
  } catch (error) {
    if (!hasFailure) {
      hasFailure = true;
      firstFailure = error;
    }
  } finally {
    report.firstFailure = hasFailure ? failureCode(firstFailure) : null;
    try {
      await save(path.join(root, "fixture-result.json"), report);
    } catch (error) {
      if (!hasFailure) {
        hasFailure = true;
        firstFailure = error;
      }
      report.success = false;
      report.reportingFailure = true;
    }
    console.log(
      JSON.stringify({
        root,
        success: report.success,
        firstFailure: report.firstFailure,
        fixtureOnly: true,
      }),
    );
  }
  if (hasFailure) throw firstFailure;
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((value) => {
      if (value) console.log(JSON.stringify(value));
    })
    .catch((error) => {
      console.error(failureCode(error));
      process.exitCode = 1;
    });
