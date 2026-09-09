import { invoke } from "@tauri-apps/api/core";
import { invokeWrapped } from "./wrapper";

const CMD = "fixture_module_command";
export function moduleCommand() {
  invoke(CMD);
}
export function shadowedLocal() {
  const CMD = "fixture_shadowed_missing";
  invoke(CMD);
}
export function shadowedParameter(CMD: string) {
  invoke(CMD);
}

export function finite(action: "start" | "stop", select: boolean) {
  const command = select ? "fixture_first" : "fixture_second";
  invoke(command);
  invoke(`fixture_${action}`);
  invoke("fixture_" + action);
  const commands = { start: "fixture_map_start", stop: "fixture_map_stop" };
  invoke(commands[action]);
  invokeWrapped("fixture_imported_wrapper");
}

export function isolated() {
  const command = "fixture_other_scope";
  invoke(command);
}

export function openEnded(command: string) {
  invoke(command);
}
