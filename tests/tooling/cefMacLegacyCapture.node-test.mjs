import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  cp,
  writeFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  identitySha256,
  validateSourceLock,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { plan } from "../../scripts/cef-runtime-ci.mjs";

const exec = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const parent =
  "native/cef-build-inputs/20261023-registration-retirement-lf-macintel-xcode26-3-sdk26-2";
const inputs =
  "native/cef-build-inputs/20261024-registration-retirement-lf-macintel-sdk26-2-capture-compat";
const patchName =
  "patches/0013-webrtc-macos-legacy-capture-deprecation-compat.patch";
const revision = "3a8b0c76e6b7bf0e72141047f82eb2c3f4862c8d";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) =>
  JSON.parse(await readFile(path.join(root, file), "utf8"));

async function scratch(run) {
  const base = path.join(root, ".orchestration/scratch");
  await mkdir(base, { recursive: true });
  const owned = await mkdtemp(path.join(base, "mac-capture-contract-"));
  try {
    return await run(owned);
  } finally {
    const resolved = await realpath(owned);
    assert.equal(path.dirname(resolved), await realpath(base));
    assert.ok(path.basename(resolved).startsWith("mac-capture-contract-"));
    await rm(resolved, { recursive: true });
  }
}

test("Mac compatibility appends only one scoped patch and preserves every inherited source/tool byte", async () => {
  const old = validateSourceLock(await json(`${parent}/source-lock.json`));
  const current = validateSourceLock(await json(`${inputs}/source-lock.json`));
  assert.equal(
    identitySha256(old),
    "e352e163ad465051f66fce6b8f3705ce2a201383ada954d7986525edb1e254bd",
  );
  assert.deepEqual(current.upstream, old.upstream);
  assert.deepEqual(current.bridge, old.bridge);
  assert.deepEqual(current.builds, old.builds);
  assert.deepEqual(current.patches.slice(0, 12), old.patches);
  assert.equal(current.patches.length, 13);
  const added = current.patches[12];
  assert.equal(added.path, patchName);
  assert.equal(added.repository, "cef");
  const patch = await readFile(path.join(root, inputs, patchName));
  assert.equal(sha(patch), added.sha256);
  for (const pin of [
    ...old.patches,
    old.bridge.header,
    ...old.builds.flatMap((build) => [build.gnArgs, build.toolchainLock]),
    { path: "cef-ci-runner-x86_64-apple-darwin.json" },
  ]) {
    assert.deepEqual(
      await readFile(path.join(root, inputs, pin.path)),
      await readFile(path.join(root, parent, pin.path)),
      pin.path,
    );
  }
  const receipt = await json(`${inputs}/review-receipt.json`);
  assert.equal(receipt.sourceLockIdentity, identitySha256(current));
  assert.equal(receipt.engineBuilt, false);
  assert.equal(receipt.nativeAcceptancePassed, false);
  assert.equal(receipt.published, false);
  assert.equal(receipt.pinnedWebRtcCommit, revision);
  assert.notEqual(receipt.sourceLockIdentity, identitySha256(old));
});

test("production plan validates new Intel identity and rejects missing ARM before acquisition", async () => {
  const result = await plan({
    inputs,
    target: "x86_64-apple-darwin",
    checkout: root,
    runnerMode: "hosted",
  });
  assert.ok(
    JSON.stringify(result).includes(
      identitySha256(await json(`${inputs}/source-lock.json`)),
    ),
  );
  await assert.rejects(
    plan({
      inputs,
      target: "aarch64-apple-darwin",
      checkout: root,
      runnerMode: "hosted",
    }),
    /target|build/i,
  );
});

test("changed inherited pins and patch13 are rejected before any acquisition", async () => {
  await scratch(async (owned) => {
    const destination = path.join(owned, inputs);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, inputs), destination, {
      recursive: true,
      errorOnExist: true,
    });
    for (const file of [
      patchName,
      "include/cef_sorng_tls_bridge.h",
      "gn/x86_64-apple-darwin.gn",
      "tools/x86_64-apple-darwin.json",
      "cef-ci-runner-x86_64-apple-darwin.json",
    ]) {
      const target = path.join(destination, file);
      const original = await readFile(target);
      await writeFile(
        target,
        Buffer.concat([original, Buffer.from("\nchanged\n")]),
      );
      await assert.rejects(
        plan({
          inputs,
          target: "x86_64-apple-darwin",
          checkout: owned,
          runnerMode: "hosted",
        }),
        /mismatch|hash|changed|pin|JSON|Unexpected/i,
      );
      await writeFile(target, original);
    }
  });
});

function nestedPatch(outer) {
  const marker =
    "+++ b/patch/patches/sorng_webrtc_mac_capture_deprecation.patch\n";
  const added = outer.slice(outer.indexOf(marker) + marker.length).split("\n");
  assert.match(added.shift(), /^@@ -0,0 \+1,\d+ @@$/);
  return (
    added
      .filter((line) => line.startsWith("+"))
      .map((line) => line.slice(1))
      .join("\n") + "\n"
  );
}

test("CEF hook registers one target-local Objective-C++ warning exception without capture-policy changes", async () => {
  const outer = await readFile(path.join(root, inputs, patchName), "utf8");
  assert.deepEqual(
    [...outer.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((row) => [
      row[1],
      row[2],
    ]),
    [
      ["patch/patch.cfg", "patch/patch.cfg"],
      [
        "patch/patches/sorng_webrtc_mac_capture_deprecation.patch",
        "patch/patches/sorng_webrtc_mac_capture_deprecation.patch",
      ],
    ],
  );
  assert.match(outer, /'name': 'sorng_webrtc_mac_capture_deprecation'/);
  assert.match(outer, /'path': 'third_party\/webrtc'/);
  const inner = nestedPatch(outer);
  assert.deepEqual(
    [...inner.matchAll(/^diff --git (\S+) (\S+)$/gm)].map((row) => [
      row[1],
      row[2],
    ]),
    [["modules/desktop_capture/BUILD.gn", "modules/desktop_capture/BUILD.gn"]],
  );
  assert.match(inner, /^--- modules\/desktop_capture\/BUILD.gn$/m);
  assert.match(inner, /^\+\+\+ modules\/desktop_capture\/BUILD.gn$/m);
  const additions = inner
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  assert.deepEqual(
    additions.filter((line) => !/^\+\s*#/.test(line)),
    ['+    cflags_objcc = [ "-Wno-error=deprecated-declarations" ]'],
  );
  assert.doesNotMatch(
    inner,
    /-Wno-deprecated-declarations|-Wno-error"|treat_warnings_as_errors|allow_sck|mac_deployment_target|sdk_path/,
  );
});

test(
  "actual isolated CEF HEAD index accepts the full queue and its original patcher applies the registered WebRTC patch",
  {
    skip: !process.env.SORNG_CEF_CHECKOUT || !process.env.SORNG_WEBRTC_CHECKOUT,
  },
  async () => {
    const cef = path.resolve(process.env.SORNG_CEF_CHECKOUT);
    const webrtc = path.resolve(process.env.SORNG_WEBRTC_CHECKOUT);
    const cefRevision = "682c378d70d5780061e96644dca16ddd8fd157a9";
    const options = { maxBuffer: 16 * 1024 * 1024, timeout: 20000 };
    const { stdout: head } = await exec(
      "git",
      ["-C", cef, "rev-parse", "HEAD"],
      options,
    );
    assert.equal(head.trim(), cefRevision);
    const { stdout: original } = await exec(
      "git",
      ["-C", webrtc, "show", `${revision}:modules/desktop_capture/BUILD.gn`],
      options,
    );
    const { stdout: objects } = await exec(
      "git",
      [
        "-C",
        cef,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects",
      ],
      options,
    );
    await scratch(async (owned) => {
      const objectRoot = path.join(owned, "objects");
      await mkdir(objectRoot);
      const env = {
        ...process.env,
        GIT_INDEX_FILE: path.join(owned, "isolated-index"),
        GIT_OBJECT_DIRECTORY: objectRoot,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: objects.trim(),
      };
      await exec("git", ["-C", cef, "read-tree", cefRevision], {
        ...options,
        env,
      });
      const lock = await json(`${inputs}/source-lock.json`);
      for (const patch of lock.patches.filter(
        (row) => row.repository === "cef",
      )) {
        await exec(
          "git",
          [
            "-C",
            cef,
            "apply",
            "--cached",
            "--whitespace=error-all",
            "--",
            path.join(root, inputs, patch.path),
          ],
          { ...options, env },
        );
      }
      const ownedCef = path.join(owned, "cef");
      await mkdir(path.join(ownedCef, "patch/patches"), { recursive: true });
      await mkdir(path.join(ownedCef, "tools"));
      for (const file of [
        "patch/patch.cfg",
        "patch/patches/sorng_webrtc_mac_capture_deprecation.patch",
      ]) {
        const { stdout } = await exec("git", ["-C", cef, "show", ":" + file], {
          ...options,
          env,
        });
        await writeFile(path.join(ownedCef, file), stdout);
      }
      for (const file of [
        "patcher.py",
        "file_util.py",
        "git_util.py",
        "exec_util.py",
      ]) {
        const { stdout } = await exec(
          "git",
          ["-C", cef, "show", `${cefRevision}:tools/${file}`],
          options,
        );
        await writeFile(path.join(ownedCef, "tools", file), stdout);
      }
      const nested = path.join(owned, "third_party/webrtc");
      await mkdir(path.join(nested, "modules/desktop_capture"), {
        recursive: true,
      });
      await exec("git", ["init", "--quiet", nested]);
      await exec("git", ["-C", nested, "config", "core.autocrlf", "false"]);
      const destination = path.join(nested, "modules/desktop_capture/BUILD.gn");
      await writeFile(destination, original);
      // Select the actual registered cfg entry, then execute the original CEF
      // patcher option path used by its config loop, without stubbing Git/apply.
      const driver = path.join(owned, "registered.py");
      await writeFile(
        driver,
        `import pathlib,runpy,sys\nroot=pathlib.Path(sys.argv[1])\nscope={}\nconfig=root/'patch/patch.cfg'\nexec(compile(config.read_bytes(),str(config),'exec'),scope)\nentry=scope['patches'][-1]\nassert entry=={'name':'sorng_webrtc_mac_capture_deprecation','path':'third_party/webrtc'}\nsys.path.insert(0,str(root/'tools'))\nsys.argv=[str(root/'tools/patcher.py'),'--patch-file',entry['name'],'--patch-dir',entry['path']]\nrunpy.run_path(sys.argv[0],run_name='__main__')\n`,
      );
      const actual = await exec("python", ["-B", driver, ownedCef], options);
      assert.match(actual.stdout, /apply|Apply|success/i);
      const applied = (await readFile(destination, "utf8")).replaceAll(
        "\r\n",
        "\n",
      );
      assert.match(
        applied,
        /cflags_objcc = \[ "-Wno-error=deprecated-declarations" \]/,
      );
      assert.equal(
        applied.match(/-Wno-error=deprecated-declarations/g)?.length,
        1,
      );
      const again = await exec("python", ["-B", driver, ownedCef], options);
      assert.match(again.stdout, /already applied/i);
    });
  },
);

test(
  "actual Clang retains the deprecation warning but all unrelated Werror remains fatal",
  { skip: !process.env.SORNG_CEF_CLANG },
  async () => {
    await scratch(async (owned) => {
      const file = path.join(owned, "legacy.mm");
      await writeFile(
        file,
        "extern void legacy_capture() __attribute__((availability(macos,introduced=10.6,deprecated=14.0)));\nvoid use_legacy(){ legacy_capture(); }\n",
      );
      const args = [
        "--driver-mode=g++",
        "--target=x86_64-apple-macos14.0",
        "-x",
        "objective-c++",
        "-fsyntax-only",
        "-Werror",
        "-Wdeprecated-declarations",
        file,
      ];
      await assert.rejects(
        exec(process.env.SORNG_CEF_CLANG, args, { timeout: 20000 }),
        (error) => error.code !== 0 && /error:.*deprecated/.test(error.stderr),
      );
      const positive = await exec(
        process.env.SORNG_CEF_CLANG,
        [...args, "-Wno-error=deprecated-declarations"],
        { timeout: 20000 },
      );
      assert.match(positive.stderr, /warning:.*deprecated/);
      await writeFile(
        file,
        "extern void legacy_capture() __attribute__((availability(macos,introduced=10.6,deprecated=14.0)));\nvoid use_legacy(){ legacy_capture(); int unrelated_unused; }\n",
      );
      await assert.rejects(
        exec(
          process.env.SORNG_CEF_CLANG,
          [...args, "-Wno-error=deprecated-declarations", "-Wunused-variable"],
          { timeout: 20000 },
        ),
        (error) =>
          error.code !== 0 && /error:.*unused variable/.test(error.stderr),
      );
    });
  },
);
