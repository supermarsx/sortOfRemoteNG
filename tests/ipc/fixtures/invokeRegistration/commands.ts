// Fixture module for `tests/ipc/invokeRegistration.test.ts`. It is never
// executed: the suite only reads it with the TypeScript parser to prove that
// command names reached through constants are resolved. It lives outside
// `src`/`app` so the real registration scan never sees it.

export const FIXTURE_IMPORTED_COMMAND = "fixture_imported_command";

export const FIXTURE_SOURCE_COMMAND = "fixture_renamed_command";

export const FIXTURE_COMMANDS = {
  close: "fixture_object_command",
} as const;
