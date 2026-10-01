import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("cloud sync stored-size native command contract", () => {
  it("registers the metadata command exactly once in the core invoke handler", () => {
    const handler = read(
      "src-tauri/crates/sorng-commands-core/src/core_handler.rs",
    );
    const groups = [
      ...handler.matchAll(/^define_command_group!\([\s\S]*?^\);/gm),
    ];
    const registrations = groups.flatMap(([group]) => [
      ...group.matchAll(/\bdatabase_files::get_database_file_sizes\b/g),
    ]);
    expect(registrations).toHaveLength(1);
    const group = groups.find(([source]) =>
      source.includes("database_files::get_database_file_sizes"),
    )![0];
    expect(group).not.toMatch(
      /#\[cfg[^\n]*\]\s*database_files::get_database_file_sizes/,
    );
    // The shared macro generates routing and invocation from the same list.
    expect(handler).toContain("tauri::generate_handler!");
    expect(handler).toContain("stringify!($command)");
  });

  it("accepts database IDs and resolves the storage root natively without requiring unlock", () => {
    const files = read("src-tauri/src/database_files.rs");
    const command = files.match(
      /^#\[tauri::command\]\s*pub async fn get_database_file_sizes\([\s\S]*?^\}/m,
    )?.[0];
    expect(command).toBeDefined();
    expect(command).toMatch(
      /app:\s*AppHandle,\s*database_ids:\s*Vec<String>,?\s*\)/,
    );
    expect(command).toContain(
      "database_size::validate_database_ids(&database_ids)?",
    );
    expect(command).toContain("databases_dir(&app)");
    expect(command).toMatch(
      /database_size::get_database_file_sizes\(&dir,\s*database_ids\)\.await/,
    );
    expect(command).not.toMatch(
      /EncryptionState|require_database_access|encrypted_load|recover_database_transactions|safe_read/,
    );
  });

  it("delegates to a metadata-only helper for the current canonical file", () => {
    const helper = read(
      "src-tauri/crates/sorng-storage/src/database_size.rs",
    ).split("#[cfg(test)]")[0];
    expect(helper).toContain("validate_database_ids(&database_ids)?");
    expect(helper).toMatch(
      /fs::symlink_metadata\(root\.join\(format!\("\{database_id\}\.json"\)\)\)/,
    );
    expect(helper).toContain("metadata.len()");
    expect(helper).not.toMatch(
      /(?:fs::(?:read|read_to_string|write|create_dir_all)|File::open|safe_read|encrypted_load|decrypt|recover_database_transactions)\s*\(/,
    );
  });

  it("uses the same resolved app-data root as native database storage and managed protection", () => {
    const files = read("src-tauri/src/database_files.rs");
    const directory = files.slice(
      files.indexOf("fn databases_dir("),
      files.indexOf("fn index_path("),
    );
    expect(directory).toMatch(/\.path\(\)\s*\.app_data_dir\(\)/);
    expect(directory).toContain('.join("databases")');
    const databasePath = files.match(/^fn per_db_path\([\s\S]*?^\}/m)?.[0];
    expect(databasePath).toContain(
      'databases_dir(app)?.join(format!("{id}.json"))',
    );
    const startup = read("src-tauri/crates/sorng-app-startup-state/src/lib.rs");
    expect(startup).toContain("let app_dir = app.path().app_data_dir()?;");
    expect(startup).toMatch(
      /artifact_policy::initialize\(\s*&enc_state,\s*&app_dir,/,
    );
    const protection = read("src-tauri/src/database_protection.rs");
    const nativeRoot = protection.slice(
      protection.indexOf("fn native_root"),
      protection.indexOf("fn scope<"),
    );
    expect(nativeRoot).toContain("state.artifact_policy_root()");
    expect(nativeRoot).toContain(".app_data_dir()");
  });
});
