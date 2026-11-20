import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Run 44633550604 (restore_run=44552110281) re-ran the whole source phase and then died in the source-phase
// restore with SIDECAR_NAME_SET: the sealed input sidecar describes the COMPLETE tree (cef-gn output and the
// materialized SDK/LLVM/Rust/runtime/GN/Siso namespaces), which does not exist yet while the source job runs.
const repo = fileURLToPath(new URL("../../", import.meta.url));
const dir = path.join(repo, "native/windows-arm-full-sdk");
const read = (p) =>
  readFileSync(path.join(repo, p), "utf8").replaceAll("\r\n", "\n");
const python = ["python", "python3"].find(
  (name) => spawnSync(name, ["--version"]).status === 0,
);
const body = (text, header, next) => {
  const start = text.indexOf(header);
  assert(start >= 0, header);
  const end = text.indexOf(next, start + header.length);
  assert(end > start, next);
  return text.slice(start, end);
};

test("the source-phase restore never applies the sidecar; the cef-engine launcher applies it before the compile", () => {
  const codec = read("native/windows-arm-full-sdk/compiled_checkpoint.py");
  const restore = body(
    codec,
    "def restore_checkpoint(",
    "def apply_restored_inputs(",
  );
  assert(!restore.includes("apply_inputs"));
  assert(!restore.includes("inputs.SIDECAR"));
  const apply = body(
    codec,
    "def apply_restored_inputs(",
    "def _restore_request(",
  );
  assert(apply.includes("inputs.apply_inputs("));
  assert(apply.includes("validate_record(record, identity)"));
  assert(apply.includes("os.unlink(sidecar)"));
  const engine = read("native/windows-arm-full-sdk/full_sdk_engine.py");
  const run = body(engine, "def _run(state):", "def main(");
  const audit = run.indexOf("_early_link_audit(state)"),
    applied = run.indexOf("_apply_restored_inputs(state)"),
    job = run.indexOf("job.run_job(");
  assert(audit > 0 && applied > audit && job > applied);
  assert(
    /if role == 'cef-engine':\n\s+_early_link_audit\(state\)\n\s+_apply_restored_inputs\(state\)/.test(
      run,
    ),
  );
  // The driver still restores before cef-gn and compares the fresh graph; only the sidecar moved.
  const driver = read("native/windows-arm-full-sdk/full-sdk-source-driver.mjs");
  assert(driver.includes('"--restore"'));
  assert(!driver.includes("--restore-apply"));
});

test("restore verifies and applies the sidecar by reading each file once, names every difference, and exempts only acquisition logs by name", () => {
  const code = `
import sys, unittest
sys.path.insert(0, ${JSON.stringify(dir)})
import test_checkpoint_inputs as a, test_compiled_checkpoint as b, test_full_sdk_engine as c
names = [
  a.CheckpointInputTests('test_continuation_tree_missing_post_source_names_is_reported_by_name_and_mutates_nothing'),
  a.CheckpointInputTests('test_extra_tree_name_is_reported_as_only_in_the_tree'),
  a.CheckpointInputTests('test_restore_verify_reports_every_changed_file_before_denying_and_never_retimes'),
  a.CheckpointInputTests('test_acquisition_logs_are_name_checked_but_not_byte_checked_or_retimed_on_restore'),
  a.CheckpointInputTests('test_apply_reads_every_file_once_and_proves_the_rest_by_metadata'),
  a.CheckpointInputTests('test_metadata_mutation_pass_still_denies_a_file_changed_after_the_verify'),
  a.CheckpointInputTests('test_change_after_complete_validation_reheld_before_first_mutation'),
  b.CodecTests('test_actual_codec_fresh_restore_same_canonical_root_before_gn_and_metadata'),
  b.CodecTests('test_engine_entry_is_a_no_op_for_a_first_run_without_a_restore_packet'),
  c.EngineTests('test_cef_engine_applies_the_restored_sidecar_after_the_audit_and_before_the_compile_job'),
  c.EngineTests('test_first_run_engine_does_no_sidecar_work_and_other_roles_never_apply'),
]
result = unittest.TextTestRunner(verbosity=1).run(unittest.TestSuite(names))
sys.exit(0 if result.wasSuccessful() else 1)`;
  const result = spawnSync(python, ["-B", "-c", code], {
    cwd: dir,
    encoding: "utf8",
    timeout: 240000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
