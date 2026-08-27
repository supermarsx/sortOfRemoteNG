// Re-export barrel fixture: exercises both `export * from` and the renaming
// `export { X as Y } from` form. See `./commands.ts`.

export * from "./barrelSource";
export { FIXTURE_SOURCE_COMMAND as FIXTURE_RENAMED_COMMAND } from "./commands";
