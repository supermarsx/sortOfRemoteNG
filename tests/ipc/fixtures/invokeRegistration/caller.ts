// Call-site fixture for `tests/ipc/invokeRegistration.test.ts`. Every form below
// mirrors one that exists (or has existed) in `src/`. Nothing here runs — the
// suite parses the file. See `./commands.ts`.

import * as core from "@tauri-apps/api/core";
import { invoke, invoke as tauriInvoke } from "@tauri-apps/api/core";

import { FIXTURE_COMMANDS, FIXTURE_IMPORTED_COMMAND } from "./commands";
import { FIXTURE_BARREL_COMMAND, FIXTURE_RENAMED_COMMAND } from ".";

const FIXTURE_LOCAL_COMMAND = "fixture_local_const_command" as const;

export const runLiteral = (): Promise<unknown> =>
  invoke("fixture_literal_command");

export const runLocalConstant = (): Promise<unknown> =>
  invoke(FIXTURE_LOCAL_COMMAND);

export const runImportedConstant = (): Promise<unknown> =>
  invoke(FIXTURE_IMPORTED_COMMAND);

export const runBarrelConstant = (): Promise<unknown> =>
  invoke(FIXTURE_BARREL_COMMAND);

export const runRenamedConstant = (): Promise<unknown> =>
  invoke(FIXTURE_RENAMED_COMMAND);

export const runObjectConstant = (): Promise<unknown> =>
  invoke(FIXTURE_COMMANDS.close);

export const runAliasedInvoke = (): Promise<unknown> =>
  tauriInvoke("fixture_aliased_invoke_command");

export const runNamespaceInvoke = (): Promise<unknown> =>
  core.invoke("fixture_namespace_command");

export const runConditional = (recursive: boolean): Promise<unknown> =>
  invoke(recursive ? "fixture_conditional_command" : FIXTURE_LOCAL_COMMAND);

/** Dynamic wrapper: the command name is not knowable from this file. */
export const runDynamic = (command: string): Promise<unknown> =>
  invoke(command);
