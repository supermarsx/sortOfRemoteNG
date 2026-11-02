// Fixed child of the creation-assigned engine Job. No standalone SDK authority.
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { types as utilTypes } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fullSdkSourceRootName } from "./source-root.mjs";

export const ENGINE_WORKER_ADMITTED = true; // Reviewed fixed execution attempt, not a qualification fact.
export const EXPENSIVE_ENGINE_ADMITTED = true; // Original slice/whole limits and checkpoint alternative remain.
const HERE = fileURLToPath(new URL("./", import.meta.url));
const REPO = path.resolve(HERE, "../..");
const ROLES = [
  "probe-clang",
  "probe-link",
  "cef-engine",
  "package",
  "checkpoint-seal",
];
const METADATA_MAXIMA = [
  65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072,
];
// Exact existing bounded SDK extractor source, transported as fixed DATA.
const EXTRACT_PIN = {
  bytes: 4123,
  sha256: "701f220319cb2aed27ae903f3f41abc3469ee457ac3cb04349ec71fc8482935f",
};
const EXTRACT_DEFLATE =
  "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";

const states = new WeakMap();
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
function need(ok, code) {
  if (!ok) throw new Error("FULL_SDK_ENGINE_" + code);
}
function shape(value, fields) {
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === fields.length &&
      fields.every((key) => Object.hasOwn(value, key)),
    "FIELDS",
  );
}
function strictRecord(raw) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw),
    value = JSON.parse(text);
  need(
    text.replaceAll("\r\n", "\n") === JSON.stringify(value, null, 2) + "\n",
    "JSON_FORMAT",
  );
  return value;
}
function validatePacket(packet, source, role) {
  need(
    packet.target === "aarch64-pc-windows-msvc" &&
      packet.role === role &&
      source.kind === "windows-arm-full-sdk-context" &&
      source.mode === "full-sdk-source-gn" &&
      source.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&
      source.ref === "refs/heads/main" &&
      source.event === "workflow_dispatch" &&
      source.visibility === "public" &&
      source.repositoryId === "1010282954" &&
      source.head === source.workflowSha &&
      /^[a-f0-9]{40}$/.test(source.head) &&
      source.wallWholeEnd === packet.wallWholeEnd &&
      source.monotonicWholeEnd === packet.monotonicWholeEnd &&
      source.image === packet.image &&
      source.sourceId === packet.sourceId &&
      source.target === packet.target &&
      Number.isSafeInteger(packet.parentPid) &&
      packet.parentPid > 0 &&
      packet.parentPid <= 0xffffffff &&
      typeof packet.parentCreationFiletime === "string" &&
      /^[1-9][0-9]{0,19}$/.test(packet.parentCreationFiletime) &&
      typeof packet.sourceContextSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(packet.sourceContextSha256) &&
      Number.isFinite(packet.monotonicWholeEnd) &&
      Number.isFinite(packet.monotonicPhaseEnd) &&
      packet.monotonicPhaseEnd <= packet.monotonicWholeEnd - 150,
    "CONTEXT_SCOPE",
  );
  const expected = [
    "private-qualification-profile.json",
    "engine-qualification-profile.json",
  ].map((file) => {
    const name = "native/windows-arm-full-sdk/" + file;
    need(
      source.sources.filter((row) => row.path === name).length === 1,
      "INPUT",
    );
    return (
      "source-inputs/" + source.sources.findIndex((row) => row.path === name)
    );
  });
  const out = "source-checkout/src/out/Release_GN_arm64/";
  expected.push(
    ...[
      "qual-gn-desc-pa.stdout.log",
      "qual-gn-desc-cef.stdout.log",
      "qual-gn-args.stdout.log",
    ].map((name) => "private-qualification-logs/" + name),
    out + "args.gn",
    out +
      "gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
    out + "gen/cef/include/cef_config.h",
    "full-metadata-result.json",
  );
  for (const [key, names] of [
    ["metadataFiles", expected],
    [
      "gitPolicyFiles",
      [
        "full-sdk-control/cef-source-git-policy/global.gitconfig",
        "full-sdk-control/cef-source-git-policy/system.gitconfig",
      ],
    ],
  ]) {
    need(
      Array.isArray(packet[key]) && packet[key].length === names.length,
      "RECORDS",
    );
    for (const [index, row] of packet[key].entries()) {
      shape(row, ["relative", "bytes", "sha256"]);
      need(
        row.relative === names[index] &&
          Number.isSafeInteger(row.bytes) &&
          row.bytes >= (key === "gitPolicyFiles" && index === 1 ? 0 : 1) &&
          row.bytes <=
            (key === "metadataFiles" ? METADATA_MAXIMA[index] : 65536) &&
          typeof row.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(row.sha256),
        "RECORD_PIN",
      );
      if (key === "gitPolicyFiles" && index === 1)
        need(
          row.bytes === 0 && row.sha256 === hash(Buffer.alloc(0)),
          "GIT_SYSTEM_PIN",
        );
    }
  }
  if (role === "probe-clang") need(packet.prior === null, "PRIOR");
  else {
    const sliceSeal = role === "checkpoint-seal";
    shape(
      packet.prior,
      sliceSeal
        ? ["result", "receipt", "closure", "launch"]
        : ["result", "receipt"],
    );
    if (sliceSeal) need(packet.prior.result === null, "PRIOR_SLICE_RESULT");
    for (const pin of Object.entries(packet.prior)
      .filter(([name]) => !sliceSeal || name !== "result")
      .map(([, value]) => value)) {
      shape(pin, ["bytes", "sha256"]);
      need(
        Number.isSafeInteger(pin.bytes) &&
          pin.bytes > 0 &&
          pin.bytes <= 2097152 &&
          typeof pin.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(pin.sha256),
        "PRIOR_PIN",
      );
    }
  }
}
function check(token) {
  const s = states.get(token);
  need(s && !s.closed, "BRAND");
  if (s.failed) throw s.primary;
  need(
    Date.now() < s.packet.wallPhaseEnd * 1000 &&
      Date.now() < s.packet.wallWholeEnd * 1000 - 150000 &&
      performance.now() < s.monoEnd,
    "DEADLINE",
  );
  return s;
}
function identity(info) {
  need(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, "FILE");
  return [
    info.dev,
    info.ino,
    info.mode,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
}
async function fence(token) {
  const s = check(token);
  for (const [name, id] of s.fence) {
    const info = await fs.lstat(name, { bigint: true });
    check(token);
    need(
      info.isDirectory() &&
        !info.isSymbolicLink() &&
        [info.dev, info.ino, info.mode, info.birthtimeNs].join(":") === id,
      "ROOT_CHANGED",
    );
  }
  need((await fs.realpath(s.root)) === s.root, "ROOT_ALIAS");
  check(token);
}
async function hold(token, file, maximum, expected) {
  await fence(token);
  check(token);
  for (let current = path.dirname(file); ; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    check(token);
    need(info.isDirectory() && !info.isSymbolicLink(), "PARENT_ALIAS");
    if (current === path.dirname(current)) break;
  }
  const fd = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let failed = false,
    primary,
    raw;
  try {
    check(token);
    const before = await fd.stat({ bigint: true });
    check(token);
    const id = identity(before);
    need(
      before.size >= (expected?.bytes === 0 ? 0n : 1n) &&
        before.size <= BigInt(maximum),
      "FILE_BOUND",
    );
    const chunks = [];
    let size = 0;
    while (size <= Number(before.size)) {
      const chunk = Buffer.alloc(
        Math.min(1048576, Number(before.size) + 1 - size),
      );
      const { bytesRead } = await fd.read(chunk, 0, chunk.length, size);
      check(token);
      if (!bytesRead) break;
      size += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    raw = Buffer.concat(chunks, size);
    need(
      size === Number(before.size) &&
        identity(await fd.stat({ bigint: true })) === id &&
        identity(await fs.lstat(file, { bigint: true })) === id,
      "FILE_CHANGED",
    );
    check(token);
    if (expected)
      need(size === expected.bytes && hash(raw) === expected.sha256, "PIN");
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
  check(token);
  await fence(token);
  return raw;
}
async function save(token, name, value) {
  const s = check(token);
  await fence(token);
  check(token);
  const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  need(raw.length <= 1048576, "REPORT_BOUND");
  await fs.writeFile(path.join(s.root, name), raw, { flag: "wx" });
  check(token);
  await fence(token);
  return { bytes: raw.length, sha256: hash(raw) };
}
async function outputPin(token, file, maximum = 8388608) {
  const raw = await hold(token, file, maximum);
  return { bytes: raw.length, sha256: hash(raw) };
}
function inspectProbeObject(raw) {
  need(
    raw.length >= 20 &&
      raw.readUInt16LE(0) === 0xaa64 &&
      raw.readUInt16LE(2) >= 1 &&
      raw.readUInt16LE(2) <= 96 &&
      raw.readUInt16LE(16) === 0 &&
      20 + raw.readUInt16LE(2) * 40 <= raw.length,
    "PROBE_COFF",
  );
}
function inspectProbeExecutable(raw) {
  need(raw.length >= 64 && raw.toString("ascii", 0, 2) === "MZ", "PROBE_PE");
  const at = raw.readUInt32LE(60);
  need(
    at >= 64 &&
      at + 264 <= raw.length &&
      raw.readUInt32LE(at) === 0x4550 &&
      raw.readUInt16LE(at + 4) === 0xaa64 &&
      raw.readUInt16LE(at + 20) === 240 &&
      raw.readUInt16LE(at + 24) === 0x20b,
    "PROBE_PE",
  );
  for (const dir of [1, 12, 13, 14])
    need(
      raw.readUInt32LE(at + 24 + 112 + dir * 8) === 0 &&
        raw.readUInt32LE(at + 24 + 116 + dir * 8) === 0,
      "PROBE_IMPORT",
    );
}
function freshEnvironment(root) {
  const p = path.join(root, "full-sdk-control/cef-source-git-policy");
  return {
    HOME: path.join(p, "home"),
    USERPROFILE: path.join(p, "runtime-profile"),
    XDG_CONFIG_HOME: path.join(p, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: path.join(p, "system.gitconfig"),
    GIT_CONFIG_GLOBAL: path.join(p, "global.gitconfig"),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_TEMPLATE_DIR: path.join(p, "hooks"),
    GIT_ALLOW_PROTOCOL: "https",
    GIT_PROTOCOL_FROM_USER: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
function vectors(
  root,
  recipe,
  candidate,
  python,
  commands,
  sourceContextSha256,
) {
  const source = path.join(root, "source-checkout/src"),
    out = path.join(source, "out/Release_GN_arm64"),
    probe = path.join(root, "full-sdk-engine-probe");
  return {
    "probe-clang": {
      executable: path.join(root, "llvm/bin/clang-cl.exe"),
      cwd: probe,
      args: [
        "--target=aarch64-pc-windows-msvc",
        "/c",
        "/nologo",
        "/X",
        "/GS",
        "/Zl",
        "/std:c++20",
        "/clang:-nostdinc",
        "/I" + path.join(source, "base/allocator/partition_allocator/src"),
        "/I" + path.join(out, "gen/base/allocator/partition_allocator/src"),
        "/I" + path.join(out, "gen"),
        "/Fo" + path.join(probe, "probe.obj"),
        path.join(REPO, candidate.probeSource),
      ],
    },
    "probe-link": {
      executable: path.join(root, "llvm/bin/lld-link.exe"),
      cwd: probe,
      args: [
        "/lldignoreenv",
        "/nodefaultlib",
        "/machine:arm64",
        "/subsystem:console",
        "/entry:" + candidate.probeEntry,
        "/manifest:no",
        "/out:" + path.join(probe, "probe.exe"),
        path.join(probe, "probe.obj"),
      ],
    },
    "cef-engine": { executable: python, cwd: source, args: commands[1].args },
    "checkpoint-seal": {
      executable: python,
      cwd: root,
      args: [
        "-I",
        "-B",
        path.join(REPO, "native/windows-arm-full-sdk/compiled_checkpoint.py"),
        "--seal",
        root,
        sourceContextSha256,
      ],
    },
    package: {
      executable: python,
      cwd: recipe.commands[2].cwd,
      args: recipe.commands[2].args,
    },
  };
}
async function recheck(token) {
  const s = check(token);
  for (const row of s.packet.metadataFiles.concat(s.packet.gitPolicyFiles))
    await hold(
      token,
      path.join(s.root, row.relative),
      Math.max(row.bytes, 1),
      row,
    );
  for (const [file, pin] of s.inputs) await hold(token, file, 2097152, pin);
  for (const [file, pin] of s.tools) await hold(token, file, 268435456, pin);
  await fence(token);
}
async function runFixed(token, command, environment) {
  await recheck(token);
  const s = check(token);
  let child,
    timer,
    failed = false,
    primary;
  try {
    const result = await new Promise((resolve, reject) => {
      const deny = (error) => {
        if (!failed) {
          failed = true;
          primary = error;
        }
        try {
          child?.kill();
        } catch {
          /* Native creation Job owns cohort retirement. */
        }
        reject(primary);
      };
      child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: environment,
        shell: false,
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.once("error", deny);
      child.once("close", (code, signal) => {
        if (failed) reject(primary);
        else if (code === 0 && signal === null) resolve(code);
        else deny(new Error("FULL_SDK_ENGINE_CHILD_FAILED"));
      });
      // Only the fixed CEF slice delegates expiry to its genuine Python Job.
      // Probe/package/seal retain their own strict inner deadline.
      if (s.packet.role !== "cef-engine")
        timer = setTimeout(
          () => deny(new Error("FULL_SDK_ENGINE_DEADLINE")),
          Math.max(
            1,
            Math.min(
              s.monoEnd - performance.now(),
              s.packet.wallPhaseEnd * 1000 - Date.now(),
            ),
          ),
        );
    });
    need(result === 0, "CHILD_FAILED");
    check(token);
    await recheck(token);
  } finally {
    clearTimeout(timer);
  }
}
async function initialPacket(file) {
  const fd = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let failed = false,
    primary,
    raw;
  try {
    const before = await fd.stat({ bigint: true }),
      id = identity(before);
    need(before.size > 0n && before.size <= 131072n, "CONTEXT_BOUND");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await fd.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    need(
      size === Number(before.size) &&
        identity(await fd.stat({ bigint: true })) === id &&
        identity(await fs.lstat(file, { bigint: true })) === id,
      "CONTEXT_CHANGED",
    );
    raw = buffer.subarray(0, size);
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
  return raw;
}
async function load(role, root, sha, began) {
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      ROLES.includes(role),
    "HOST",
  );
  need(
    path.dirname(root) === path.join(REPO, ".artifacts") &&
      (await fs.realpath(root)) === root,
    "ROOT",
  );
  const raw = await initialPacket(
    path.join(root, "full-sdk-engine-" + role + "-context.json"),
  );
  need(
    raw.length > 0 && raw.length <= 131072 && hash(raw) === sha,
    "CONTEXT_PIN",
  );
  const packet = strictRecord(raw);
  shape(packet, [
    "schemaVersion",
    "kind",
    "mode",
    "role",
    "sourceContextSha256",
    "image",
    "sourceId",
    "target",
    "wallWholeEnd",
    "monotonicWholeEnd",
    "wallPhaseEnd",
    "monotonicPhaseEnd",
    "parentPid",
    "parentCreationFiletime",
    "metadataFiles",
    "gitPolicyFiles",
    "prior",
  ]);
  need(
    packet.schemaVersion === 1 &&
      packet.kind === "windows-arm-full-sdk-engine-context" &&
      packet.mode === "full-sdk-engine" &&
      packet.role === role &&
      packet.target === "aarch64-pc-windows-msvc" &&
      root ===
        path.join(
          REPO,
          ".artifacts",
          fullSdkSourceRootName(packet.image, packet.sourceId),
        ),
    "CONTEXT_SCOPE",
  );
  need(
    Number.isFinite(packet.wallWholeEnd) &&
      Number.isFinite(packet.wallPhaseEnd) &&
      packet.wallPhaseEnd <= packet.wallWholeEnd - 150,
    "ORIGINAL_ENDS",
  );
  const token = Object.freeze({}),
    state = {
      root,
      packet,
      failed: false,
      closed: false,
      primary: undefined,
      inputs: [],
      tools: [],
      fence: [],
      monoEnd:
        began +
        Math.min(
          packet.wallPhaseEnd * 1000 - Date.now(),
          packet.wallWholeEnd * 1000 - Date.now() - 150000,
        ),
    };
  states.set(token, state);
  try {
    for (let current = root; ; current = path.dirname(current)) {
      const info = await fs.lstat(current, { bigint: true });
      check(token);
      need(info.isDirectory() && !info.isSymbolicLink(), "ROOT_ALIAS");
      state.fence.push([
        current,
        [info.dev, info.ino, info.mode, info.birthtimeNs].join(":"),
      ]);
      if (current === path.dirname(current)) break;
    }
    const sourceRaw = await hold(
      token,
      path.join(root, "context.json"),
      131072,
      {
        bytes: (await fs.stat(path.join(root, "context.json"))).size,
        sha256: packet.sourceContextSha256,
      },
    );
    const source = strictRecord(sourceRaw);
    state.inputs.push([
      path.join(root, "context.json"),
      { bytes: sourceRaw.length, sha256: packet.sourceContextSha256 },
    ]);
    state.inputs.push([
      path.join(root, "full-sdk-engine-" + role + "-context.json"),
      { bytes: raw.length, sha256: sha },
    ]);
    validatePacket(packet, source, role);
    const launch = JSON.parse(
      await hold(
        token,
        path.join(root, "full-sdk-engine-" + role + "-launch.json"),
        65536,
      ),
    );
    shape(launch, [
      "kind",
      "role",
      "ownPid",
      "ownCreationFiletime",
      "parentPid",
      "parentCreationFiletime",
      "contextSha256",
    ]);
    need(
      launch.kind === "windows-arm-full-sdk-engine-launch" &&
        launch.role === role &&
        launch.ownPid === process.ppid &&
        launch.parentPid === packet.parentPid &&
        launch.parentCreationFiletime === packet.parentCreationFiletime &&
        launch.contextSha256 === sha,
      "LAUNCHER",
    );
    const readInput = async (name) => {
      const index = source.sources.findIndex((row) => row.path === name);
      need(
        index >= 0 &&
          source.sources.filter((row) => row.path === name).length === 1,
        "INPUT",
      );
      const pin = source.sources[index],
        file = path.join(REPO, name),
        saved = path.join(root, "source-inputs", String(index));
      const value = await hold(token, file, 2097152, pin);
      await hold(token, saved, 2097152, pin);
      state.inputs.push([file, pin], [saved, pin]);
      return value;
    };
    for (const row of source.sources) await readInput(row.path);
    const profile = JSON.parse(
      await readInput(
        "native/windows-arm-full-sdk/full-sdk-source-profile.json",
      ),
    );
    const selected = profile.images[packet.image];
    need(selected.sourceId === packet.sourceId, "SOURCE");
    const imageRaw = await readInput(
      "native/windows-arm-full-sdk/" + selected.profile,
    );
    need(hash(imageRaw) === selected.profileSha256, "IMAGE_PROFILE_PIN");
    for (const [file, pin] of [
      [process.execPath, profile.node],
      [profile.python.path, profile.python],
    ]) {
      need(
        path.resolve(profile.node.path) === path.resolve(process.execPath),
        "NODE_PATH",
      );
      await hold(token, file, 268435456, pin);
      state.tools.push([file, pin]);
    }
    const base = JSON.parse(
        await readInput("native/windows-arm-full-sdk/profile.json"),
      ),
      image = JSON.parse(imageRaw);
    const p = {
      ...base,
      image: packet.image,
      sourceGn: image.sourceGn,
      sourcePaths: source.sources.map((row) => row.path),
    };
    const candidate = JSON.parse(
        await readInput(
          "native/windows-arm-full-sdk/engine-qualification-profile.json",
        ),
      ),
      privatePolicy = JSON.parse(
        await readInput(
          "native/windows-arm-full-sdk/private-qualification-profile.json",
        ),
      );
    need(
      candidate.target === packet.target &&
        privatePolicy.probeEntry === "sorng_arm64_qualification_entry" &&
        privatePolicy.probeSource ===
          "native/windows-arm-full-sdk/compiler_input_probe.cc",
      "PROBE_POLICY",
    );
    await readInput(privatePolicy.probeSource);
    for (const [key, name] of [
      ["clang", "clang-cl.exe"],
      ["lld", "lld-link.exe"],
    ]) {
      const tool = privatePolicy.tools[key];
      need(tool.relativePath === "llvm/bin/" + name, "TOOL_PATH");
      await hold(token, path.join(root, tool.relativePath), 268435456, tool);
      state.tools.push([path.join(root, tool.relativePath), tool]);
    }
    const imported = async (name) =>
      import(
        pathToFileURL(path.join(HERE, "current-source-helpers/scripts", name))
      );
    const custom = await imported("lib/browser-custom-runtime.mjs"),
      runtime = await imported("cef-runtime-ci.mjs"),
      inventory = await imported("cef-custom-artifact-inventory.mjs"),
      sourceDriver = await import("./full-sdk-source-driver.mjs");
    check(token);
    const inputsRoot = path.join(REPO, p.sourceGn.namespace),
      lock = custom.validateSourceLock(
        JSON.parse(await readInput(p.sourceGn.namespace + "source-lock.json")),
      );
    need(custom.identitySha256(lock) === packet.sourceId, "SOURCE_LOCK");
    const checkouts = {
      chromium: path.join(root, "source-checkout/src"),
      cef: path.join(root, "source-checkout/src/cef"),
      depotTools: path.join(root, "source-checkout/depot_tools"),
    };
    const recipe = await custom.customRuntimeBuildRecipe({
      sourceLock: lock,
      target: packet.target,
      inputsRoot,
      checkouts,
    });
    check(token);
    const commands = runtime.boundedBuildCommands(recipe, 4),
      env = {
        ...sourceDriver.sourceEnvironment(root, p, recipe),
        ...freshEnvironment(root),
      };
    return {
      token,
      state,
      profile,
      p,
      privatePolicy,
      candidate,
      custom,
      runtime,
      inventory,
      inputsRoot,
      lock,
      recipe,
      commands,
      vector: vectors(
        root,
        recipe,
        privatePolicy,
        profile.python.path,
        commands,
        packet.sourceContextSha256,
      ),
      environment: env,
    };
  } catch (error) {
    state.failed = true;
    state.primary = error;
    state.closed = true;
    states.delete(token);
    throw error;
  }
}
// BEGIN FIXED NATIVE SLICE READER
export function inspectNativeSlice(value, seconds) {
  need(
    Number.isSafeInteger(seconds) &&
      seconds > 0 &&
      seconds <= 10800 &&
      value &&
      value.kind === "owned-job-proof" &&
      value.outcome === "deadline" &&
      value.success === false &&
      value.rootExit === null &&
      value.finalRootExit === 124 &&
      value.rootReaped === true &&
      value.activeAtEnd === 0 &&
      value.cleanupVerified === true &&
      value.logReadersStopped === true &&
      value.cleanupBudgetMs === 30000 &&
      Number.isSafeInteger(value.elapsedMs) &&
      value.elapsedMs >= seconds * 1000 &&
      value.started === true &&
      value.jobCreated === true &&
      value.assignedBeforeResume === true &&
      value.resumed === true &&
      value.assignedAtCreationVerified === true &&
      value.assignmentMode === "creation-attribute" &&
      value.handleListOnly === true &&
      value.jobHandleInheritable === false &&
      value.jobHandleInStdioAllowlist === false &&
      Number.isSafeInteger(value.rootPid) &&
      value.rootPid > 0 &&
      typeof value.rootCreationFiletime === "string" &&
      /^[1-9][0-9]{0,19}$/.test(value.rootCreationFiletime) &&
      (!Object.hasOwn(value, "observerStopped") ||
        value.observerStopped === true) &&
      value.outputCapBytes === 67108864 &&
      Number.isSafeInteger(value.capturedBytes) &&
      value.capturedBytes >= 0 &&
      value.capturedBytes <= value.outputCapBytes,
    "SLICE_NATIVE_DEADLINE",
  );
  const policy = {
    flags: 8712,
    activeProcessLimit: 64,
    jobMemoryBytes: "8589934592",
    cpuFlags: 5,
    cpuRate: 2500,
    inheritedHandles: 3,
    affinityChanged: false,
  };
  shape(value.policyReadback, Object.keys(policy));
  need(
    Object.entries(policy).every(
      ([key, expected]) => value.policyReadback[key] === expected,
    ),
    "SLICE_POLICY",
  );
  return value; // Data only; no source/compiler/checkpoint capability is issued.
}
async function deadlinePrior(job) {
  const { token, state } = job,
    pins = state.packet.prior;
  need(
    state.packet.role === "checkpoint-seal" && pins.result === null,
    "PRIOR_SLICE",
  );
  const rows = [
    ["jobs/cef-engine/receipt.json", pins.receipt],
    ["full-sdk-engine-closed-cef-engine.json", pins.closure],
    ["full-sdk-engine-cef-engine-launch.json", pins.launch],
  ];
  const values = [];
  for (const [relative, pin] of rows) {
    values.push(
      JSON.parse(
        await hold(token, path.join(state.root, relative), 1048576, pin),
      ),
    );
    state.inputs.push([path.join(state.root, relative), pin]);
  }
  const [receipt, closed, launch] = values;
  inspectNativeSlice(receipt, closed.jobSeconds);
  need(
    closed.kind === "windows-arm-full-sdk-engine-launcher-close" &&
      closed.role === "cef-engine" &&
      closed.completion === "native-slice-ended" &&
      closed.success === true &&
      closed.parentHandleClosed === true &&
      closed.ownHandleClosed === true &&
      closed.sdkBuilt === false &&
      closed.nativeAcceptance === false &&
      closed.ownPid === launch.ownPid &&
      closed.ownCreationFiletime === launch.ownCreationFiletime &&
      closed.parentPid === state.packet.parentPid &&
      closed.parentCreationFiletime === state.packet.parentCreationFiletime &&
      closed.sourceContextSha256 === state.packet.sourceContextSha256 &&
      closed.receiptPin?.bytes === pins.receipt.bytes &&
      closed.receiptPin?.sha256 === pins.receipt.sha256 &&
      launch.kind === "windows-arm-full-sdk-engine-launch" &&
      launch.role === "cef-engine" &&
      launch.parentPid === state.packet.parentPid &&
      launch.parentCreationFiletime === state.packet.parentCreationFiletime &&
      receipt.rootPid !== launch.ownPid &&
      typeof launch.contextSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(launch.contextSha256),
    "PRIOR_SLICE_CLOSE",
  );
  const contextFile = path.join(
      state.root,
      "full-sdk-engine-cef-engine-context.json",
    ),
    raw = await hold(token, contextFile, 131072);
  need(hash(raw) === launch.contextSha256, "PRIOR_SLICE_CONTEXT");
  const previous = JSON.parse(raw);
  need(
    previous.role === "cef-engine" &&
      previous.sourceContextSha256 === state.packet.sourceContextSha256 &&
      previous.image === state.packet.image &&
      previous.sourceId === state.packet.sourceId &&
      previous.wallWholeEnd === state.packet.wallWholeEnd &&
      previous.monotonicWholeEnd === state.packet.monotonicWholeEnd &&
      previous.wallPhaseEnd <= previous.wallWholeEnd - 3600 &&
      previous.monotonicPhaseEnd <= previous.monotonicWholeEnd - 3600,
    "PRIOR_SLICE_SCOPE",
  );
  state.inputs.push([contextFile, { bytes: raw.length, sha256: hash(raw) }]);
  await recheck(token);
}
// END FIXED NATIVE SLICE READER

async function prior(job) {
  if (job.state.packet.role === "checkpoint-seal") return deadlinePrior(job);
  const { token, state } = job,
    index = ROLES.indexOf(state.packet.role);
  if (index === 0) {
    need(state.packet.prior === null, "PRIOR");
    return;
  }
  const previous = ROLES[index - 1],
    pins = state.packet.prior;
  shape(pins, ["result", "receipt"]);
  const result = JSON.parse(
      await hold(
        token,
        path.join(state.root, "full-sdk-engine-" + previous + "-result.json"),
        1048576,
        pins.result,
      ),
    ),
    receipt = JSON.parse(
      await hold(
        token,
        path.join(state.root, "jobs", previous, "receipt.json"),
        65536,
        pins.receipt,
      ),
    );
  need(
    result.kind === "windows-arm-full-sdk-engine-worker-result" &&
      result.role === previous &&
      result.sourceContextSha256 === state.packet.sourceContextSha256 &&
      result.sourceId === state.packet.sourceId &&
      result.image === state.packet.image &&
      result.success === true &&
      receipt.success === true &&
      receipt.cleanupVerified === true &&
      receipt.rootExit === 0 &&
      receipt.rootReaped === true &&
      receipt.logReadersStopped === true &&
      receipt.activeAtEnd === 0,
    "PRIOR",
  );
  state.inputs.push(
    [
      path.join(state.root, "full-sdk-engine-" + previous + "-result.json"),
      pins.result,
    ],
    [path.join(state.root, "jobs", previous, "receipt.json"), pins.receipt],
  );
  if (previous === "probe-clang" || previous === "probe-link") {
    shape(result.output, ["bytes", "sha256"]);
    need(
      Number.isSafeInteger(result.output.bytes) &&
        result.output.bytes > 0 &&
        result.output.bytes <= 8388608 &&
        /^[a-f0-9]{64}$/.test(result.output.sha256),
      "PRIOR_OUTPUT_PIN",
    );
    state.tools.push([
      path.join(
        state.root,
        "full-sdk-engine-probe",
        previous === "probe-clang" ? "probe.obj" : "probe.exe",
      ),
      result.output,
    ]);
  }
  if (previous === "probe-clang")
    inspectProbeObject(
      await hold(
        token,
        path.join(state.root, "full-sdk-engine-probe/probe.obj"),
        8388608,
        result.output,
      ),
    );
  if (previous === "probe-link")
    inspectProbeExecutable(
      await hold(
        token,
        path.join(state.root, "full-sdk-engine-probe/probe.exe"),
        8388608,
        result.output,
      ),
    );
  if (previous === "cef-engine") need(result.engineComplete === true, "PRIOR");
}
async function packageSdk(job) {
  const { token, state: s, runtime, custom, inventory, lock, inputsRoot } = job;
  await runFixed(token, job.vector.package, job.environment);
  const cef = path.join(s.root, "source-checkout/src/cef"),
    distributions = (
      await fs.readdir(path.join(cef, "binary_distrib"), {
        withFileTypes: true,
      })
    ).filter(
      (entry) =>
        entry.isDirectory() && /^cef_binary_.+_minimal$/.test(entry.name),
    );
  check(token);
  need(distributions.length === 1, "DISTRIBUTION");
  const archiveRoot = distributions[0].name,
    work = path.join(s.root, "full-sdk-package"),
    bundle = path.join(work, "bundle");
  await fs.mkdir(work);
  check(token);
  await fs.mkdir(bundle);
  check(token);
  const sdk = await runtime.flattenSdk(
    path.join(cef, "binary_distrib", archiveRoot),
    path.join(work, archiveRoot),
    lock,
    inputsRoot,
  );
  check(token);
  const identity = runtime.releaseIdentity(lock, s.packet.target);
  await fs.writeFile(
    path.join(bundle, "source-lock.json"),
    runtime.stableJson(lock),
    { flag: "wx" },
  );
  check(token);
  await runFixed(
    token,
    {
      executable: job.profile.python.path,
      args: [
        "-I",
        "-c",
        runtime.PACK_PYTHON,
        sdk,
        path.join(bundle, identity.archive),
      ],
      cwd: work,
    },
    job.environment,
  );
  check(token);
  await inventory.inventoryCustomArtifact({
    lock: path.join(bundle, "source-lock.json"),
    target: s.packet.target,
    sdk,
    "artifact-root": bundle,
    archive: identity.archive,
    manifest: "manifest.json",
    receipt: "receipt.json",
  });
  check(token);
  const extract = inflateRawSync(Buffer.from(EXTRACT_DEFLATE, "base64"), {
    maxOutputLength: EXTRACT_PIN.bytes,
  });
  need(
    extract.length === EXTRACT_PIN.bytes &&
      hash(extract) === EXTRACT_PIN.sha256,
    "EXTRACT_PIN",
  );
  await runFixed(
    token,
    {
      executable: job.profile.python.path,
      cwd: work,
      args: [
        "-I",
        "-c",
        extract.toString("utf8"),
        path.join(bundle, identity.archive),
        path.join(work, "roundtrip"),
        path.join(bundle, "manifest.json"),
        s.packet.target,
        archiveRoot,
        String(32 * 1024 ** 3),
        "50000",
      ],
    },
    job.environment,
  );
  await custom.preflightCustomRuntime({
    sourceLock: lock,
    manifest: JSON.parse(
      await hold(token, path.join(bundle, "manifest.json"), 33554432),
    ),
    target: s.packet.target,
    artifactRoot: bundle,
    sdkRoot: path.join(work, "roundtrip", archiveRoot),
  });
  check(token);
  const descriptor = await runtime.descriptorFor({
    bundle,
    sourceLock: lock,
    target: s.packet.target,
    repository: "supermarsx/sortOfRemoteNG",
    archiveRoot,
  });
  check(token);
  await fs.writeFile(
    path.join(bundle, "runtime.json"),
    runtime.stableJson(descriptor),
    { flag: "wx" },
  );
  check(token);
  return {
    bundle: "full-sdk-package/bundle",
    assets: await Promise.all(
      [
        "runtime.json",
        "source-lock.json",
        "manifest.json",
        "receipt.json",
        identity.archive,
      ].map(async (name) => ({
        name,
        ...(await runtime.measure(path.join(bundle, name))),
      })),
    ),
  };
}
async function execute(job) {
  const { token, state: s } = job,
    role = s.packet.role;
  await recheck(token);
  await prior(job);
  check(token);
  let output = null;
  if (role === "probe-clang") {
    await fs.mkdir(path.join(s.root, "full-sdk-engine-probe"));
    check(token);
  }
  if (role === "package") output = await packageSdk(job);
  else if (role === "checkpoint-seal") {
    await runFixed(token, job.vector[role], job.environment);
    const raw = await hold(
      token,
      path.join(s.root, "full-sdk-checkpoint-seal-result.json"),
      131072,
    );
    const result = JSON.parse(raw);
    need(
      result.schemaVersion === 1 &&
        result.kind === "windows-arm-full-sdk-checkpoint-seal-result" &&
        result.sourceContextSha256 === s.packet.sourceContextSha256 &&
        result.dataOnly === true &&
        result.sealed === true &&
        result.outcome === "quiet-deadline" &&
        result.bundle === "full-sdk-checkpoint-output" &&
        result.sdkBuilt === false &&
        result.nativeAcceptance === false &&
        result.executionAdmitted === false,
      "CHECKPOINT_SEAL_RESULT",
    );
    output = { ...result, result: { bytes: raw.length, sha256: hash(raw) } };
  } else {
    const environment = role.startsWith("probe-")
      ? {
          SystemRoot: "C:/Windows",
          WINDIR: "C:/Windows",
          PATH: "C:/Windows/System32",
          TEMP: path.join(s.root, "tmp"),
          TMP: path.join(s.root, "tmp"),
        }
      : job.environment;
    await runFixed(token, job.vector[role], environment);
    if (role === "probe-clang" || role === "probe-link") {
      const file = path.join(
          s.root,
          "full-sdk-engine-probe",
          role === "probe-clang" ? "probe.obj" : "probe.exe",
        ),
        raw = await hold(token, file, 8388608);
      if (role === "probe-clang") inspectProbeObject(raw);
      else inspectProbeExecutable(raw);
      output = { bytes: raw.length, sha256: hash(raw) };
    }
  }
  await recheck(token);
  check(token);
  await save(token, "full-sdk-engine-" + role + "-result.json", {
    kind: "windows-arm-full-sdk-engine-worker-result",
    role,
    sourceContextSha256: s.packet.sourceContextSha256,
    image: s.packet.image,
    sourceId: s.packet.sourceId,
    success: true,
    output,
    engineComplete: role === "cef-engine",
    sdkBuilt: role === "package",
    nativeAcceptance: false,
    runtimeReady: false,
  });
}
export async function engineWorkerMain(argv = process.argv.slice(2)) {
  const began = performance.now();
  need(ENGINE_WORKER_ADMITTED, "NATIVE_CLOSED");
  need(
    !utilTypes.isProxy(argv) &&
      Array.isArray(argv) &&
      Object.getPrototypeOf(argv) === Array.prototype &&
      Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===
        "0,1,2,3,4,length" &&
      Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>
        Object.hasOwn(row, "value"),
      ) &&
      argv.length === 5 &&
      argv.every((value) => typeof value === "string") &&
      argv[0] === "--full-sdk-engine-worker" &&
      ROLES.includes(argv[1]) &&
      /^[a-f0-9]{64}$/.test(argv[3]) &&
      argv[4] === "--execute",
    "ARGV",
  );
  need(
    argv[1] !== "cef-engine" || EXPENSIVE_ENGINE_ADMITTED,
    "EXPENSIVE_ENGINE_CLOSED",
  );
  const job = await load(argv[1], argv[2], argv[3], began);
  try {
    await execute(job);
  } catch (error) {
    job.state.failed = true;
    job.state.primary = error;
    throw error;
  } finally {
    job.state.closed = true;
    states.delete(job.token);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  engineWorkerMain().catch(() => {
    console.error("FULL_SDK_ENGINE_DENIED");
    process.exitCode = 1;
  });
