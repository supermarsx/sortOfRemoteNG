// Source generation only. This module never installs packages or changes ownership.
import { constants } from "node:fs";
import {
  lstat,
  realpath,
  open,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templates = fileURLToPath(
  new URL("../../packaging/linux/", import.meta.url),
);
const policies = new WeakMap();
const targetMachine = Object.freeze({
  "x86_64-unknown-linux-gnu": 62,
  "aarch64-unknown-linux-gnu": 183,
});
const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const signature = (s) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode, s.nlink].join(":");
const shared = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.nlink].join(":");

export const linuxSandboxInstallerBody = String.raw`
import hashlib,json,os,stat,sys
HELPER='@@HELPER_PATH@@'
EXPECTED_SHA='@@HELPER_SHA@@'
EXPECTED_BYTES=@@HELPER_BYTES@@
EXPECTED_MACHINE=@@HELPER_MACHINE@@
class SandboxDenied(Exception):pass
def need(ok,code):
    if not ok:raise SandboxDenied(code)
def signature(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def file_identity(s):return (s.st_dev,s.st_ino,s.st_nlink,s.st_size,s.st_mtime_ns)
def regular(s,mode):
    need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode) in mode and s.st_size==EXPECTED_BYTES,'LPKG_FILE')
def directory(s):
    need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not (s.st_mode & 0o022),'LPKG_DIRECTORY')
class SystemOps:
    def root(self):return os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    def directory(self,parent,name):return os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
    def file(self,parent,name):return os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=parent)
    def stat(self,parent,name):return os.stat(name,dir_fd=parent,follow_symlinks=False)
    def fstat(self,fd):return os.fstat(fd)
    def read(self,fd,count):return os.read(fd,count)
    def rewind(self,fd):os.lseek(fd,0,os.SEEK_SET)
    def chown(self,fd):os.fchown(fd,0,0)
    def chmod(self,fd,mode):os.fchmod(fd,mode)
    def close(self,fd):os.close(fd)
    def privileged(self):return sys.platform=='linux' and os.geteuid()==0
def hash_file(ops,fd):
    ops.rewind(fd);digest=hashlib.sha256();count=0;header=b''
    while count<EXPECTED_BYTES:
        chunk=ops.read(fd,min(65536,EXPECTED_BYTES-count))
        need(bool(chunk),'LPKG_SIZE');count+=len(chunk)
        need(count<=EXPECTED_BYTES,'LPKG_SIZE')
        if len(header)<64:header=(header+chunk)[:64]
        digest.update(chunk)
    need(len(header)>=64 and header[:6]==b'\x7fELF\x02\x01' and int.from_bytes(header[16:18],'little') in (2,3) and int.from_bytes(header[18:20],'little')==EXPECTED_MACHINE,'LPKG_ELF')
    need(digest.hexdigest()==EXPECTED_SHA,'LPKG_HASH')
def install(ops):
    need(ops.privileged(),'LPKG_AUTHORITY')
    need(HELPER.startswith('/usr/lib/') and HELPER.endswith('/chrome-sandbox') and len(HELPER.split('/'))==5,'LPKG_PATH')
    handles=[];directories=[];fd=None;primary=None;modified=False;cleanup_failure=False;close_failure=False;ready=False
    try:
        parent=ops.root();handles.append(parent);before=ops.fstat(parent);directory(before)
        directories.append((None,'/',parent,before))
        for name in HELPER.split('/')[1:-1]:
            before=ops.stat(parent,name);directory(before)
            child=ops.directory(parent,name);handles.append(child)
            need(signature(before)==signature(ops.fstat(child)),'LPKG_DIRECTORY_CHANGED')
            directories.append((parent,name,child,before));parent=child
        name='chrome-sandbox';before=ops.stat(parent,name);regular(before,(0o755,0o4755))
        fd=ops.file(parent,name);handles.append(fd)
        need(signature(before)==signature(ops.fstat(fd)),'LPKG_CHANGED')
        hash_file(ops,fd)
        need(signature(before)==signature(ops.fstat(fd)) and signature(before)==signature(ops.stat(parent,name)),'LPKG_CHANGED')
        for base,entry,handle,original in directories:
            need(signature(original)==signature(ops.fstat(handle)),'LPKG_DIRECTORY_CHANGED')
            if base is not None:need(signature(original)==signature(ops.stat(base,entry)),'LPKG_DIRECTORY_CHANGED')
        # Always ownership first: chown may clear setuid. Only this held FD changes.
        modified=True;ops.chown(fd);ops.chmod(fd,0o4755)
        after=ops.fstat(fd);regular(after,(0o4755,))
        need(file_identity(before)==file_identity(after) and signature(after)==signature(ops.stat(parent,name)),'LPKG_CHANGED')
        hash_file(ops,fd)
        need(signature(after)==signature(ops.fstat(fd)) and signature(after)==signature(ops.stat(parent,name)),'LPKG_CHANGED')
        for base,entry,handle,original in directories:
            need(signature(original)==signature(ops.fstat(handle)),'LPKG_DIRECTORY_CHANGED')
            if base is not None:need(signature(original)==signature(ops.stat(base,entry)),'LPKG_DIRECTORY_CHANGED')
        ready=True
    except BaseException as error:
        primary=error
        if modified and fd is not None:
            try:ops.chmod(fd,0o755)
            except BaseException:cleanup_failure=True
    finally:
        for handle in reversed(handles):
            try:ops.close(handle)
            except BaseException as error:
                close_failure=True
                if primary is None:primary=error
    report={'kind':'linux-installed-cef-sandbox','configured':ready and primary is None,'sandboxExecutionVerified':False,'cleanupFailure':cleanup_failure,'closeFailure':close_failure}
    if primary is not None:
        try:primary.sandbox_report=report
        except BaseException:pass
        raise primary
    return report
if __name__=='__main__':
    try:
        print(json.dumps(install(SystemOps()),separators=(',',':')))
    except BaseException as error:
        report=getattr(error,'sandbox_report',{'kind':'linux-installed-cef-sandbox','configured':False,'sandboxExecutionVerified':False})
        report['failure']=str(error) if isinstance(error,SandboxDenied) else 'LPKG_OS'
        print(json.dumps(report,separators=(',',':')),file=sys.stderr);raise SystemExit(1)
`;

async function physical(file) {
  need(path.isAbsolute(file), "LPKG_SOURCE_PATH");
  need((await realpath(file)) === file, "LPKG_SOURCE_ALIAS");
  for (let at = file; ; at = path.dirname(at)) {
    need(!(await lstat(at)).isSymbolicLink(), "LPKG_SOURCE_LINK");
    if (path.dirname(at) === at) break;
  }
}
async function heldHelper(file, machine) {
  await physical(file);
  const before = await lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size >= 64n &&
      before.size <= 64n * 1024n ** 2n,
    "LPKG_SOURCE_FILE",
  );
  const fd = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let failed = false;
  try {
    const opened = await fd.stat({ bigint: true });
    need(shared(before) === shared(opened), "LPKG_SOURCE_CHANGED");
    const hash = createHash("sha256"),
      header = Buffer.alloc(64),
      buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (bytes < Number(before.size)) {
      const { bytesRead } = await fd.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - bytes),
        null,
      );
      need(bytesRead > 0, "LPKG_SOURCE_SIZE");
      if (bytes < 64)
        buffer.copy(header, bytes, 0, Math.min(bytesRead, 64 - bytes));
      bytes += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    need(
      signature(before) === signature(await lstat(file, { bigint: true })) &&
        signature(opened) === signature(await fd.stat({ bigint: true })),
      "LPKG_SOURCE_CHANGED",
    );
    need(
      header.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])) &&
        [2, 3].includes(header.readUInt16LE(16)) &&
        header.readUInt16LE(18) === machine,
      "LPKG_SOURCE_ELF",
    );
    return { bytes, sha256: hash.digest("hex") };
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

export async function prepareLinuxPackageSandbox(plan, { runtimeRoot }) {
  need(
    plan.platform === "linux" && Object.hasOwn(targetMachine, plan.target),
    "LPKG_TARGET",
  );
  need(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(plan.productName) &&
      ![".", ".."].includes(plan.productName),
    "LPKG_PRODUCT",
  );
  await physical(runtimeRoot);
  const machine = targetMachine[plan.target],
    helper = await heldHelper(
      path.join(plan.payload, "chrome-sandbox"),
      machine,
    );
  const original = await heldHelper(
    path.join(runtimeRoot, "chrome-sandbox"),
    machine,
  );
  need(
    helper.bytes === original.bytes && helper.sha256 === original.sha256,
    "LPKG_SOURCE_PROVENANCE",
  );
  await physical(plan.root);
  const output = path.join(plan.root, "linux-package-sandbox");
  await mkdir(output);
  const installPath = `/usr/lib/${plan.productName}/chrome-sandbox`,
    hooks = {};
  for (const kind of ["deb", "rpm"]) {
    const template = await readFile(
      path.join(templates, `cef-sandbox-${kind}.postinst.sh`),
      "utf8",
    );
    need(template.split("@@PYTHON_BODY@@").length === 2, "LPKG_TEMPLATE");
    const body = linuxSandboxInstallerBody
      .replace("@@HELPER_PATH@@", installPath)
      .replace("@@HELPER_SHA@@", helper.sha256)
      .replace("@@HELPER_BYTES@@", String(helper.bytes))
      .replace("@@HELPER_MACHINE@@", String(machine));
    const rendered = template.replace("@@PYTHON_BODY@@", body);
    need(!rendered.includes("@@"), "LPKG_TEMPLATE");
    hooks[kind] = path.join(output, `${kind}.postinst.sh`);
    await writeFile(hooks[kind], rendered, { flag: "wx", mode: 0o755 });
  }
  const token = Object.freeze({ kind: "linux-installed-sandbox-policy" });
  policies.set(token, {
    target: plan.target,
    payload: plan.payload,
    productName: plan.productName,
    hooks,
    helper,
    installPath,
  });
  await writeFile(
    path.join(output, "policy.json"),
    JSON.stringify(
      {
        kind: token.kind,
        target: plan.target,
        helper,
        installPath,
        preModes: ["0755", "4755"],
        postMode: "4755",
        uid: 0,
        gid: 0,
        appImageInstalledAcceptance: false,
        sandboxExecutionVerified: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return token;
}

export function applyLinuxPackageSandbox(config, plan, token) {
  const p = policies.get(token);
  need(
    p &&
      p.target === plan.target &&
      p.payload === plan.payload &&
      p.productName === plan.productName &&
      config.productName === p.productName,
    "LPKG_POLICY_REQUIRED",
  );
  const linux = (config.bundle.linux ??= {});
  for (const kind of ["deb", "rpm"]) {
    const options = (linux[kind] ??= {});
    need(options.postInstallScript == null, "LPKG_HOOK_COLLISION");
    need(
      options.depends == null ||
        (Array.isArray(options.depends) &&
          options.depends.every((x) => typeof x === "string")),
      "LPKG_DEPENDENCIES",
    );
    options.depends = [...new Set([...(options.depends ?? []), "python3"])];
    options.postInstallScript = p.hooks[kind];
  }
  return config;
}
