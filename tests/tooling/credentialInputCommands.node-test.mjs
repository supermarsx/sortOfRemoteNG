import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractNativeCommandNames } from "../ipc/nativeCommandInventory.ts";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ssh = read("src-tauri/crates/sorng-ssh/src/ssh/commands_cmds.rs");
const rdp = read("src-tauri/crates/sorng-rdp/src/rdp/commands_cmds.rs");
const core = read("src-tauri/crates/sorng-commands-core/src/core_handler.rs");

function command(source, name) {
  const start = source.indexOf(`pub async fn ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf("#[tauri::command]", start);
  return source.slice(start, end < 0 ? undefined : end);
}

test("credential commands have dedicated reachable core registrations", () => {
  const names = extractNativeCommandNames(core);
  const registrations = core.split("#[cfg(test)]")[0];
  for (const [module, name] of [
    ["ssh_commands", "send_ssh_credential_input"],
    ["rdp_commands", "rdp_send_credential_input"],
  ]) {
    assert.ok(names.has(name), `${name} must be routed`);
    assert.equal(registrations.split(`${module}::${name},`).length - 1, 1);
  }
  assert.match(
    read("src-tauri/src/rdp.rs"),
    /disabled_commands!\([\s\S]*\brdp_send_credential_input,/,
  );
});

test("ordinary input commands retain their original APIs and paths", () => {
  const ordinarySsh = command(ssh, "send_ssh_input");
  assert.doesNotMatch(
    ordinarySsh,
    /sensitive|expected_shell_id|validity|bound_secret/,
  );
  assert.match(ordinarySsh, /send_shell_input\(&session_id, data\)/);
  const ordinaryRdp = command(rdp, "rdp_send_input");
  assert.match(ordinaryRdp, /events: Vec<RdpInputAction>/);
  assert.doesNotMatch(ordinaryRdp, /validity|credential_text_input/);
});

test("SSH credential command requires shell binding and has no ordinary-input fallback", () => {
  const source = command(ssh, "send_ssh_credential_input");
  assert.match(source, /expected_shell_id: String/);
  assert.match(source, /validity: Option<SshCredentialInputValidity>/);
  assert.match(source, /zeroize::Zeroizing::new\(data\)/);
  assert.ok(
    source.indexOf("state.lock().await") <
      source.indexOf("send_shell_bound_secret_input("),
  );
  assert.doesNotMatch(source, /send_shell_input\(/);
});

test("RDP credential command accepts text and checks validity under lock before enqueue", () => {
  const source = command(rdp, "rdp_send_credential_input");
  assert.match(source, /data: String/);
  assert.doesNotMatch(source, /events: Vec<RdpInputAction>/);
  assert.match(source, /credential_text_input\(&data\)/);
  const locked = source.indexOf("state.lock().await");
  const validated = source.indexOf("validity.assert_current(");
  const queued = source.indexOf("enqueue_session_command(");
  assert.ok(locked >= 0 && locked < validated && validated < queued);
  assert.doesNotMatch(source, /rdp_send_input\(/);
});
