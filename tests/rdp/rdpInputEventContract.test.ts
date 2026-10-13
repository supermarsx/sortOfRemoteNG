import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `rdp_send_input` deserializes each event into the Rust `RdpInputAction`
// enum by its `type` tag. A name the enum does not know rejects the whole
// call, so the names and fields the hook builds are checked against the enum
// source itself: a rename on either side fails here.

const lines = (text: string) => text.split(/\r?\n/);

/** The Rust `RdpInputAction` enum: its attributes, its body, and each variant
 * with its field names. */
function nativeInputActions() {
  const source = lines(
    readFileSync("src-tauri/crates/sorng-rdp/src/rdp/types.rs", "utf8"),
  );
  const start = source.indexOf("pub enum RdpInputAction {");
  let firstAttribute = Math.max(start, 0);
  while (source[firstAttribute - 1]?.startsWith("#[")) firstAttribute--;
  const attributes = source.slice(firstAttribute, Math.max(start, 0));
  const body =
    start < 0
      ? ""
      : source.slice(start + 1, source.indexOf("}", start)).join("\n");
  const variants: Record<string, string[]> = Object.fromEntries(
    [...body.matchAll(/(\w+)\s*\{([^}]*)\}/g)].map(([, name, fields]) => [
      name,
      [...fields.matchAll(/(\w+)\s*:/g)].map(([, field]) => field),
    ]),
  );
  return { attributes: attributes.join("\n"), body, variants };
}

/** Property names of one object literal, shorthand included. */
function propertyNames(literal: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let property = "";
  for (const character of `${literal.slice(1, -1)},`) {
    if ("([".includes(character)) depth++;
    if (")]".includes(character)) depth--;
    if (character !== "," || depth > 0) {
      property += character;
      continue;
    }
    const name = property.trim().match(/^(\w+)\s*(?::|$)/)?.[1];
    if (name) names.push(name);
    else if (property.trim()) names.push(`<unreadable: ${property.trim()}>`);
    property = "";
  }
  return names;
}

interface SentEvent {
  line: number;
  name: string;
  fields: string[];
}

/** Every input event the hook builds: pushed onto an `events` list or passed
 * to `sendInput([...])`. */
function hookInputEvents(): SentEvent[] {
  const hook = readFileSync("src/hooks/rdp/useRDPClient.ts", "utf8");
  const literals: { index: number; text: string }[] = [];
  for (const push of hook.matchAll(/events\.push\(\s*(\{[^{}]*\})/g))
    literals.push({ index: push.index, text: push[1] });
  for (const call of hook.matchAll(/sendInput\(\s*\[([^\]]*)\]/g))
    for (const literal of call[1].matchAll(/\{[^{}]*\}/g))
      literals.push({ index: call.index, text: literal[0] });

  return literals.map(({ index, text }) => {
    const properties = propertyNames(text);
    return {
      line: lines(hook.slice(0, index)).length,
      name: text.match(/\btype:\s*"(\w+)"/)?.[1] ?? "<no type literal>",
      fields: properties.filter((property) => property !== "type").sort(),
    };
  });
}

describe("RDP input events built by useRDPClient", () => {
  const { attributes, body, variants: native } = nativeInputActions();
  const sent = hookInputEvents();

  it("reads the native enum as serde does: tagged by `type`, nothing renamed", () => {
    // A variant's identifier is its wire name only while this holds. If serde
    // starts renaming, map the names in `nativeInputActions` the same way.
    expect(attributes).toContain('#[serde(tag = "type")]');
    expect(attributes).not.toContain("rename");
    expect(body).not.toContain("#[serde(");
    expect(Object.keys(native).length).toBeGreaterThan(0);
    for (const fields of Object.values(native))
      expect(fields.length).toBeGreaterThan(0);
  });

  it("finds every event the hook builds", () => {
    // Guards the extraction. If the hook starts building events another way,
    // extend `hookInputEvents` instead of lowering this.
    expect(sent.length).toBeGreaterThanOrEqual(13);
  });

  it("names every event as the native enum deserializes it", () => {
    const unknown = sent
      .filter((event) => !(event.name in native))
      .map((event) => `"${event.name}" at line ${event.line}`);
    expect(unknown).toEqual([]);
  });

  it("gives every event exactly the fields of its native variant", () => {
    const mismatched = sent
      .filter((event) => event.name in native)
      .filter(
        (event) =>
          event.fields.join() !== [...native[event.name]].sort().join(),
      )
      .map(
        (event) =>
          `${event.name} at line ${event.line}: sends [${event.fields}], native takes [${[...native[event.name]].sort()}]`,
      );
    expect(mismatched).toEqual([]);
  });
});
