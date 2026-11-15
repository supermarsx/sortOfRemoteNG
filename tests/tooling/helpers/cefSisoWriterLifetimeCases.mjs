import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
  readlink,
} from "node:fs/promises";
import { hostname, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileSlice,
  removeQuiescentSisoLog,
  observeThenRemoveSisoLog,
  sisoLoggerIdentity,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
async function scratch(t) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "cef-siso-lifetime-"));
  assert.equal(path.dirname(root), parent);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export function registerSisoWriterLifetimeTests() {
  for (const mode of [
    "complete",
    "failed",
    "replaced",
    "late",
    "foreign",
    "failed-late",
  ]) {
    test(
      `Siso writer lifetime ${mode} retains only a live creation-owned alias witness`,
      { skip: process.platform === "win32" },
      async (t) => {
        const root = await scratch(t);
        const prefix = sisoLoggerIdentity(
          hostname(),
          userInfo().username,
        ).prefix;
        const actor = path.join(root, "writer.cjs");
        const launcher = path.join(root, "launcher.cjs");
        await writeFile(
          actor,
          String.raw`
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const [out,prefix,mode]=process.argv.slice(2);
const digits=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
const target=path.join(os.tmpdir(),prefix+digits.slice(0,8)+'-'+digits.slice(8)+'.'+(mode==='foreign'?1:process.pid));
fs.writeFileSync(path.join(out,'writer-target'),target);
if(!mode.endsWith('late'))fs.symlinkSync(target,path.join(out,'siso.INFO'));
setTimeout(()=>process.exit(mode.startsWith('failed')?1:0),1500);
`,
        );
        await writeFile(
          launcher,
          String.raw`
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const [out,prefix,mode]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(out,'writer.cjs'),out,prefix,mode],{stdio:'inherit'});
child.once('close',code=>{
  const alias=path.join(out,'siso.INFO');
  const target=fs.readFileSync(path.join(out,'writer-target'),'utf8');
  if(mode==='replaced'){fs.unlinkSync(alias);fs.symlinkSync(target,alias);}
  if(mode.endsWith('late'))fs.symlinkSync(target,alias);
  setTimeout(()=>process.exit(code),750);
});
`,
        );
        const compile = await compileSlice(
          process.execPath,
          [launcher, root, prefix, mode],
          {
            cwd: root,
            env: { PATH: path.dirname(process.execPath) },
            logs: root,
            out: root,
            milliseconds: 8000,
          },
        );
        assert.equal(
          compile.outcome,
          mode.startsWith("failed") ? "compiler-failed" : "compiler-complete",
        );
        const raw = await readFile(path.join(root, "writer-target"), "utf8");
        const writerPid = Number(/\.([1-9][0-9]*)$/.exec(raw)[1]);
        // The final cleanup cohort correctly retired this exited child. A set
        // of all historical PIDs would wrongly accept the late/replaced cases.
        assert(!compile.observed.some((row) => row.pid === writerPid));
        if (mode === "failed-late") {
          await assert.rejects(
            observeThenRemoveSisoLog(root, root, compile, { log: () => {} }),
            (error) =>
              error.code === "COMPILER_EXIT_NONZERO" &&
              error.exitCode === 1 &&
              /Siso log PID not observed/.test(error.cause.message),
          );
          compile.outcome = "compiler-complete";
          compile.exitCode = 0;
          await assert.rejects(
            observeThenRemoveSisoLog(root, root, compile, { log: () => {} }),
            (error) =>
              error.code === "COMPILER_EXIT_NONZERO" &&
              error.exitCode === 1 &&
              /Genuine in-process/.test(error.cause.message),
          );
          assert.equal(await readlink(path.join(root, "siso.INFO")), raw);
        } else if (mode === "complete" || mode === "failed") {
          assert.equal(
            (await removeQuiescentSisoLog(root, compile)).removed,
            true,
          );
          await assert.rejects(readlink(path.join(root, "siso.INFO")), {
            code: "ENOENT",
          });
        } else {
          await assert.rejects(
            removeQuiescentSisoLog(root, compile),
            /Siso log PID not observed/,
          );
          assert.equal(await readlink(path.join(root, "siso.INFO")), raw);
        }
      },
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  registerSisoWriterLifetimeTests();
