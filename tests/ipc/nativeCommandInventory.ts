import fs from "node:fs";
import path from "node:path";

/** Mask comments while retaining offsets and strings for balanced Rust lists. */
function withoutComments(source: string): string {
  return source.replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('"') ? token : token.replace(/[^\n]/g, " ")),
  );
}

function balanced(
  source: string,
  start: number,
): { body: string; end: number } {
  const close: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack = [close[source[start]]];
  let quoted = false;
  for (let cursor = start + 1; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (quoted) {
      if (char === "\\") cursor++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (close[char]) stack.push(close[char]);
    else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length)
        return { body: source.slice(start + 1, cursor), end: cursor + 1 };
    }
  }
  throw new Error(`Unbalanced native command list at ${start}`);
}

function commandPaths(body: string): string[] {
  const clean = body.replace(/#\s*\[[^\]]*\]/g, "");
  return clean.split(",").flatMap((entry) => {
    const value = entry.trim();
    if (!/^(?:[A-Za-z_]\w*::)*[a-z_]\w*$/.test(value)) return [];
    return [value.split("::").pop()!];
  });
}

/** Extract executable handler lists, never comments, assertions or quoted decoys. */
export function extractNativeCommandNames(input: string): Set<string> {
  const source = withoutComments(input);
  const searchable = source.replace(/"(?:\\.|[^"\\])*"/g, (token) =>
    " ".repeat(token.length),
  );
  const names = new Set<string>();
  for (const match of searchable.matchAll(
    /(?:\w+::)*generate_handler!\s*\[/g,
  )) {
    const list = balanced(source, match.index! + match[0].lastIndexOf("["));
    if (!list.body.includes("$"))
      commandPaths(list.body).forEach((name) => names.add(name));
  }
  // The source macro must actually generate a Tauri handler. This supports
  // identifier lists (LLM/Telegram) and grouped path lists (core) without a
  // growing allowlist of command names or accepting arbitrary Rust strings.
  for (const definition of searchable.matchAll(/macro_rules!\s+(\w+)\s*\{/g)) {
    const macroBody = balanced(
      source,
      definition.index! + definition[0].lastIndexOf("{"),
    );
    if (!macroBody.body.includes("generate_handler!")) continue;
    const invocations = new RegExp(`\\b${definition[1]}!\\s*\\(`, "g");
    for (const invocation of searchable.matchAll(invocations)) {
      const args = balanced(
        source,
        invocation.index! + invocation[0].lastIndexOf("("),
      );
      const bracket = args.body.indexOf("[");
      const list = bracket >= 0 ? balanced(args.body, bracket).body : args.body;
      commandPaths(list).forEach((name) => names.add(name));
    }
  }
  // Startup commands capture the issuing document synchronously, so they use
  // a hand-written dispatcher instead of Tauri's generated async wrapper.
  // Require the executable command match AND an awaited implementation inside
  // respond_async; an is_command string or an unused function is not evidence.
  for (const entry of searchable.matchAll(
    /\bfn\s+dispatch_startup\([^)]*\)\s*->\s*bool\s*\{/g,
  )) {
    const body = balanced(
      source,
      entry.index! + entry[0].lastIndexOf("{"),
    ).body;
    const code = body.replace(/"(?:\\.|[^"\\])*"/g, (token) =>
      " ".repeat(token.length),
    );
    const dispatch = /match\s+message\.command\(\)\s*\{/.exec(code);
    if (!dispatch) continue;
    const routes = balanced(
      body,
      dispatch.index + dispatch[0].lastIndexOf("{"),
    ).body;
    const implementations = new Set<string>();
    for (const response of code.matchAll(
      /resolver\.respond_async\(async\s+move\s*\{/g,
    )) {
      const task = balanced(
        code,
        response.index! + response[0].lastIndexOf("{"),
      ).body;
      for (const call of task.matchAll(/\b([a-z_]\w*)\s*\(/g)) {
        const args = balanced(task, call.index! + call[0].lastIndexOf("("));
        if (/^\s*\.await\b/.test(task.slice(args.end)))
          implementations.add(call[1]);
      }
    }
    for (const route of routes.matchAll(/"([a-z_]\w*)"\s*=>\s*"\1"/g)) {
      if (
        implementations.has(route[1]) &&
        new RegExp(`\\basync\\s+fn\\s+${route[1]}\\s*\\(`).test(searchable)
      )
        names.add(route[1]);
    }
  }
  return names;
}

/** Handler files reachable from native command crate module declarations. */
export function reachableNativeHandlers(root: string): string[] {
  const router = path.join(root, "src-tauri/src/invoke_handler.rs");
  const files = new Set<string>([router]);
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file) || !fs.existsSync(file)) return;
    visited.add(file);
    const text = withoutComments(fs.readFileSync(file, "utf8"));
    if (/handler\.rs$/.test(file)) files.add(file);
    for (const call of text.matchAll(
      /return\s+crate::(\w+)::dispatch_startup\(invoke\)/g,
    )) {
      const dispatcher = path.join(root, "src-tauri/src", `${call[1]}.rs`);
      files.add(dispatcher);
      visit(dispatcher);
    }
    // Facades may route to separately compiled command crates. Follow actual
    // builder calls, not every Cargo dependency or stale source directory.
    for (const match of text.matchAll(/(sorng_commands_\w+)::build\(/g)) {
      visit(
        path.join(
          root,
          "src-tauri/crates",
          match[1].replace(/_/g, "-"),
          "src/lib.rs",
        ),
      );
    }
    for (const match of text.matchAll(
      /(?:#\[path\s*=\s*"([^"]+)"\]\s*)?(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g,
    )) {
      const directory = path.dirname(file);
      const next = match[1]
        ? path.resolve(directory, match[1])
        : path.join(directory, `${match[2]}.rs`);
      // Command definitions may be path-included from the app; recurse only
      // in the command crate itself, where routing modules are owned.
      if (next.includes(`${path.sep}sorng-commands-`)) visit(next);
    }
  };
  visit(router);
  return [...files].sort();
}
