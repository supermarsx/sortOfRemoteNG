import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  prepareLinuxPackageSandbox,
  applyLinuxPackageSandbox,
} from "../../scripts/lib/linux-package-sandbox.mjs";

const elf = (machine) => {
  const raw = Buffer.alloc(80, 7);
  Buffer.from([127, 69, 76, 70, 2, 1]).copy(raw);
  raw.writeUInt16LE(3, 16);
  raw.writeUInt16LE(machine, 18);
  return raw;
};
async function fixture(t, target = "x86_64-unknown-linux-gnu") {
  const root = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "sorng-linux-package-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = path.join(root, "payload"),
    runtime = path.join(root, "runtime");
  await mkdir(payload);
  await mkdir(runtime);
  const raw = elf(target.startsWith("aarch64") ? 183 : 62);
  for (const base of [payload, runtime])
    await writeFile(path.join(base, "chrome-sandbox"), raw, { mode: 0o755 });
  return {
    plan: {
      root,
      payload,
      platform: "linux",
      target,
      productName: "sortOfRemoteNG",
    },
    runtime,
    raw,
  };
}

test("generated DEB/RPM hooks bind verified helper bytes/path and preserve other package configuration", async (t) => {
  for (const target of [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
  ]) {
    const { plan, runtime, raw } = await fixture(t, target);
    const token = await prepareLinuxPackageSandbox(plan, {
      runtimeRoot: runtime,
    });
    const config = {
      productName: plan.productName,
      bundle: {
        linux: {
          rpm: { desktopTemplate: "existing.desktop", depends: ["kept"] },
          appimage: { bundleMediaFramework: true },
        },
      },
    };
    applyLinuxPackageSandbox(config, plan, token);
    assert.deepEqual(config.bundle.linux.rpm.depends, ["kept", "python3"]);
    assert.deepEqual(config.bundle.linux.deb.depends, ["python3"]);
    assert.equal(config.bundle.linux.rpm.desktopTemplate, "existing.desktop");
    assert.equal(config.bundle.linux.appimage.bundleMediaFramework, true);
    for (const kind of ["deb", "rpm"]) {
      const text = await readFile(
        config.bundle.linux[kind].postInstallScript,
        "utf8",
      );
      assert(text.includes("HELPER='/usr/lib/sortOfRemoteNG/chrome-sandbox'"));
      assert(text.includes(createHash("sha256").update(raw).digest("hex")));
      assert(!text.includes("@@"));
      assert(text.includes("/usr/bin/python3 -I -B"));
      assert(!text.includes("--no-sandbox"));
    }
    assert.throws(
      () => applyLinuxPackageSandbox({ bundle: {} }, plan, {}),
      /LPKG_POLICY_REQUIRED/,
    );
    assert.throws(
      () =>
        applyLinuxPackageSandbox(
          {
            productName: plan.productName,
            bundle: { linux: { deb: { postInstallScript: "foreign" } } },
          },
          plan,
          token,
        ),
      /LPKG_HOOK_COLLISION/,
    );
    assert.throws(
      () =>
        applyLinuxPackageSandbox(
          { bundle: {} },
          { ...plan, productName: "other" },
          token,
        ),
      /LPKG_POLICY_REQUIRED/,
    );
  }
});

test("source generation denies wrong architecture, changed provenance, unsafe product and linked input", async (t) => {
  for (const change of ["machine", "bytes", "product", "hardlink", "symlink"]) {
    const { plan, runtime } = await fixture(t);
    if (change === "machine")
      await writeFile(path.join(plan.payload, "chrome-sandbox"), elf(183));
    if (change === "bytes")
      await writeFile(
        path.join(runtime, "chrome-sandbox"),
        Buffer.concat([elf(62), Buffer.from("changed")]),
      );
    if (change === "product") plan.productName = "../outside";
    if (change === "hardlink") {
      const { link } = await import("node:fs/promises");
      await link(
        path.join(plan.payload, "chrome-sandbox"),
        path.join(plan.payload, "second"),
      );
    }
    if (change === "symlink") {
      await rm(path.join(plan.payload, "chrome-sandbox"));
      try {
        await symlink(
          path.join(runtime, "chrome-sandbox"),
          path.join(plan.payload, "chrome-sandbox"),
        );
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EPERM", "EACCES"].includes(error.code)
        ) {
          t.diagnostic("owned symlink privilege unavailable");
          continue;
        }
        throw error;
      }
    }
    await assert.rejects(
      prepareLinuxPackageSandbox(plan, { runtimeRoot: runtime }),
      /LPKG_/,
    );
  }
});

test("actual generated installer body denies adversarial metadata and preserves first failure through cleanup", async (t) => {
  const { plan, runtime, raw } = await fixture(t);
  const policy = await prepareLinuxPackageSandbox(plan, {
    runtimeRoot: runtime,
  });
  const config = { productName: plan.productName, bundle: {} };
  applyLinuxPackageSandbox(config, plan, policy);
  const rendered = await readFile(
    config.bundle.linux.deb.postInstallScript,
    "utf8",
  );
  const body = rendered
    .split("<<'SORNG_FIXED_SANDBOX_PY'\n")[1]
    .split("\nSORNG_FIXED_SANDBOX_PY")[0];
  assert(body.includes("EXPECTED_MACHINE=62"));
  const pythonFixture = String.raw`
import types,copy
RAW=bytes.fromhex('${raw.toString("hex")}')
def meta(mode,ino,**kw):
 d=dict(st_dev=1,st_ino=ino,st_mode=mode,st_uid=0,st_gid=0,st_nlink=1,st_size=4096 if stat.S_ISDIR(mode) else len(RAW),st_mtime_ns=10,st_ctime_ns=10);d.update(kw);return types.SimpleNamespace(**d)
class Fake:
 def __init__(self,case='good'):
  self.case=case;self.nodes={i:meta(stat.S_IFDIR|0o755,i)for i in range(4)};self.nodes[4]=meta(stat.S_IFREG|0o755,4);self.offset=0;self.opened=[];self.closed=[];self.actions=[];self.failure=OSError('private sentinel');self.changed=False
  if case=='ancestor-write':self.nodes[2].st_mode|=0o020
  if case=='ancestor-owner':self.nodes[2].st_uid=1000
  if case=='ancestor-group':self.nodes[2].st_gid=1000
  if case=='ancestor-link':self.nodes[2].st_mode=stat.S_IFLNK|0o777
  if case=='hardlink':self.nodes[4].st_nlink=2
  if case=='file-owner':self.nodes[4].st_uid=1000
  if case=='file-group':self.nodes[4].st_gid=1000
  if case=='file-link':self.nodes[4].st_mode=stat.S_IFLNK|0o755
  if case=='mode':self.nodes[4].st_mode=stat.S_IFREG|0o777
  if case=='size':self.nodes[4].st_size+=1
  if case=='already':self.nodes[4].st_mode=stat.S_IFREG|0o4755
 def privileged(self):return self.case!='authority'
 def root(self):self.opened.append(0);return 0
 def directory(self,parent,name):self.opened.append(parent+1);return parent+1
 def file(self,parent,name):self.opened.append(4);return 4
 def stat(self,parent,name):return copy.copy(self.nodes[4 if name=='chrome-sandbox'else parent+1])
 def fstat(self,fd):return copy.copy(self.nodes[fd])
 def rewind(self,fd):self.offset=0
 def read(self,fd,count):
  data=RAW[self.offset:self.offset+count];self.offset+=len(data)
  if self.case in ('hash','hash-close')and data:data=data[:-1]+bytes([data[-1]^1])
  if self.case=='swap'and not self.changed:self.nodes[4].st_ino+=1;self.changed=True
  if self.case=='ancestor-change'and not self.changed:self.nodes[2].st_ctime_ns+=1;self.changed=True
  return data
 def chown(self,fd):
  self.actions.append(['chown',fd,0,0])
  if self.case=='dual':raise self.failure
  self.nodes[fd].st_ctime_ns+=1
 def chmod(self,fd,mode):
  self.actions.append(['chmod',fd,mode])
  if self.case=='dual':raise RuntimeError('secondary private cleanup')
  self.nodes[fd].st_mode=stat.S_IFREG|mode;self.nodes[fd].st_ctime_ns+=1
  if self.case=='post-hash'and mode==0o4755:self.case='hash'
 def close(self,fd):
  self.closed.append(fd)
  if self.case in ('close','dual','hash-close'):raise self.failure if self.case=='close'else RuntimeError('secondary private close')
results=[]
for case in ['good','already','authority','ancestor-write','ancestor-owner','ancestor-group','ancestor-link','hardlink','file-owner','file-group','file-link','mode','size','hash','hash-close','swap','ancestor-change','post-hash','dual','close']:
 ops=Fake(case)
 try:
  report=install(ops);assert case in ('good','already')and report['configured']and not report['sandboxExecutionVerified'];assert ops.actions==[['chown',4,0,0],['chmod',4,0o4755]]
 except BaseException as error:
  assert case not in ('good','already'),(case,type(error).__name__)
  if case in ('dual','close'):assert error is ops.failure
  if case=='dual':assert error.sandbox_report['cleanupFailure']and error.sandbox_report['closeFailure']
  if case=='close':assert not error.sandbox_report['configured']and error.sandbox_report['closeFailure']
  if case=='hash-close':assert isinstance(error,SandboxDenied)and str(error)=='LPKG_HASH'and error.sandbox_report['closeFailure']
  if case=='post-hash':assert ops.actions[-1]==['chmod',4,0o755]
  if case in ('authority','ancestor-write','ancestor-owner','ancestor-group','ancestor-link','hardlink','file-owner','file-group','file-link','mode','size','hash','swap','ancestor-change'):assert not ops.actions
 assert ops.closed==list(reversed(ops.opened)),case
 results.append(case)
print(json.dumps({'actualBodyCases':results,'privilegedSystemCalls':0}))
`;
  const result = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-c",
      `scope={'__name__':'fixture'}
exec(${JSON.stringify(body)},scope)
exec(${JSON.stringify(pythonFixture)},scope)`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 65536 },
  );
  assert.equal(JSON.parse(result).actualBodyCases.length, 20);
  assert.equal(JSON.parse(result).privilegedSystemCalls, 0);
});
