import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const dir = path.join(repo, "native/windows-arm-full-sdk");
const read = (p) =>
  readFileSync(path.join(repo, p), "utf8").replaceAll("\r\n", "\n");
const python = ["python", "python3"].find(
  (name) => spawnSync(name, ["--version"]).status === 0,
);
const NAMESPACES = [
  "source-checkout",
  "Windows Kits",
  "llvm",
  "rust",
  "siso",
  "gn",
  "custom-vs",
  "runtime",
];

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), "link-audit-"));
  for (const name of NAMESPACES) mkdirSync(path.join(root, name));
  mkdirSync(path.join(root, "source-checkout/src/out"), { recursive: true });
  mkdirSync(path.join(root, "source-checkout/.git"));
  writeFileSync(path.join(root, "source-checkout/src/a.cc"), "a");
  writeFileSync(path.join(root, "llvm/tool.exe"), "t");
  return root;
}
function audit(root, extra = "") {
  const code = `
import sys, json
sys.path.insert(0, ${JSON.stringify(dir)})
import checkpoint_inputs as c
r = c.audit_links(sys.argv[1])
${extra}
print(json.dumps(r))`;
  const result = spawnSync(python, ["-I", "-c", code, root], {
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

test(
  "link audit names every hardlink and symlink with path, check, nlink and namespace",
  {
    skip: !python && "python unavailable",
  },
  () => {
    const root = tree();
    try {
      const clean = audit(root);
      assert.equal(clean.violationCount, 0);
      assert.deepEqual(clean.missingNamespaces, []);
      linkSync(
        path.join(root, "llvm/tool.exe"),
        path.join(root, "source-checkout/src/hard.exe"),
      );
      let symlinked = true;
      try {
        symlinkSync(
          path.join(root, "source-checkout/src/a.cc"),
          path.join(root, "rust/sym"),
        );
      } catch {
        symlinked = false; // Windows without symlink privilege: hardlinks still run.
      }
      // Excluded outputs and git metadata never count.
      writeFileSync(path.join(root, "source-checkout/src/out/o.obj"), "o");
      linkSync(
        path.join(root, "source-checkout/src/out/o.obj"),
        path.join(root, "source-checkout/src/out/o2.obj"),
      );
      const report = audit(root);
      const rows = Object.fromEntries(
        report.violations.map((r) => [r.path, r]),
      );
      assert.deepEqual(rows["llvm/tool.exe"].checks, ["nlink>1"]);
      assert.equal(rows["llvm/tool.exe"].nlink, 2);
      assert.equal(
        rows["source-checkout/src/hard.exe"].namespace,
        "source-checkout",
      );
      assert.equal(rows["source-checkout/src/hard.exe"].code, "REGULAR");
      assert.equal(
        Object.keys(rows).some((p) => p.includes("/out/")),
        false,
      );
      if (symlinked) {
        assert.ok(rows["rust/sym"].checks.includes("symlink"));
        assert.equal(report.violationCount, 3);
      } else assert.equal(report.violationCount, 2);
      assert.equal(report.firstCode, "REGULAR");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "link audit lists at most the cap but counts all violations",
  {
    skip: !python && "python unavailable",
  },
  () => {
    const root = tree();
    try {
      for (let i = 0; i < 6; i++)
        linkSync(
          path.join(root, "llvm/tool.exe"),
          path.join(root, `siso/h${i}`),
        );
      const report = audit(root, "r = c.audit_links(sys.argv[1], cap=2)");
      assert.equal(report.violationCount, 7);
      assert.equal(report.violations.length, 2);
      assert.equal(report.capped, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("the early walk precedes the compile job and the diagnostics are in an always() upload", () => {
  const engine = read("native/windows-arm-full-sdk/full_sdk_engine.py");
  const run = engine.slice(engine.indexOf("def _run(state):"));
  const audit = run.indexOf("_early_link_audit(state)");
  assert.ok(audit > 0 && audit < run.indexOf("job.run_job("));
  assert.ok(run.slice(0, audit).includes("if role == 'cef-engine':"));
  assert.ok(
    engine.includes(
      "raise ValueError('FULL_SDK_ENGINE_SIDECAR_' + report['firstCode'])",
    ),
  );
  const inputs = read("native/windows-arm-full-sdk/checkpoint_inputs.py");
  // The seal pre-pass runs before the sidecar is created or any file is hashed.
  const record = inputs.slice(inputs.indexOf("def record_inputs("));
  assert.ok(
    record.indexOf("audit_links(guard.root") > 0 &&
      record.indexOf("audit_links(guard.root") <
        record.indexOf("with _file(guard.root / SIDECAR"),
  );
  const workflow = read(".github/workflows/windows-arm-full-sdk.yml");
  const records = workflow.slice(
    workflow.indexOf("Retain bounded qualification records"),
  );
  assert.match(records, /if: always\(\)/);
  assert.ok(
    records.includes(
      ".artifacts/windows-arm-full-sdk-*/full-sdk-engine-*.json",
    ),
  );
  assert.match(
    "full-sdk-engine-cef-engine-link-audit.json",
    /^full-sdk-engine-.*\.json$/,
  );
  assert.match(
    "full-sdk-engine-checkpoint-seal-link-violations.json",
    /^full-sdk-engine-.*\.json$/,
  );
});
