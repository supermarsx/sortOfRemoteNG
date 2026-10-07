import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NETWORK_TOOL_IDS } from "../../src/types/network/networkToolkit";

describe("Network Toolkit native integration contract", () => {
  it("keeps all 26 native dispatch IDs aligned with the frontend", () => {
    const source = readFileSync(
      "src-tauri/crates/sorng-network/src/toolkit/mod.rs",
      "utf8",
    );
    const tools = source.match(
      /pub const TOOLS: &\[&str\] = &\[([\s\S]*?)\];/,
    )?.[1];
    expect(tools).toBeDefined();
    const native = [...tools!.matchAll(/"([a-zA-Z]+)"/g)].map(
      (match) => match[1],
    );
    expect(native).toHaveLength(26);
    expect(new Set(native).size).toBe(26);
    expect(native.sort()).toEqual([...NETWORK_TOOL_IDS].sort());
  });

  it("registers toolkit commands in a sorted binary-search dispatch group", () => {
    const source = readFileSync(
      "src-tauri/crates/sorng-commands-core/src/core_handler.rs",
      "utf8",
    );
    const group = source
      .split("GROUP_B_COMMANDS,")[1]
      ?.split("define_command_group!(")[0];
    expect(group).toBeDefined();
    const names = [...group!.matchAll(/^\s*\w+::(\w+),?\s*$/gm)].map(
      (match) => match[1],
    );
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      "network_toolkit_cancel",
      "network_toolkit_run",
      "check_port",
      "check_tls",
    ]) {
      expect(names).toContain(name);
      // Mirror the native slice lookup rather than merely checking membership.
      let size = names.length;
      let base = 0;
      while (size > 1) {
        const half = Math.floor(size / 2);
        const mid = base + half;
        if (names[mid] <= name) base = mid;
        size -= half;
      }
      expect(names[base]).toBe(name);
    }
  });
});
