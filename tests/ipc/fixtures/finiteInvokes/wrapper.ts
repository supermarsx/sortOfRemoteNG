import { invoke } from "@tauri-apps/api/core";
export function invokeWrapped(command: string) {
  return invoke(command);
}
