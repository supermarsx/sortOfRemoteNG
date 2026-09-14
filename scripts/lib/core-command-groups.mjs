import { sortCommands } from "./command-inventory.mjs";

const groupPattern = () =>
  /define_command_group!\(\s*(\w+),\s*(\w+),\s*(\w+),\s*\[([\s\S]*?)\]\s*\);/g;

/** Parse the existing canonical Rust lists without interpreting command bodies. */
export function parseCoreCommandGroups(source) {
  return [...source.matchAll(groupPattern())].map((group) => {
    const body = group[4];
    const entries = [];
    let cursor = 0;
    for (const match of body.matchAll(
      /^[ \t]*(\w+::\w+),[ \t]*(?:\/\/[^\r\n]*)?\r?$/gm,
    )) {
      const prefix = body.slice(cursor, match.index);
      const attributes = [...prefix.matchAll(/#\[([\s\S]*?)\]/g)].map(
        (attribute) => attribute[1].trim(),
      );
      const remainder = prefix
        .replace(/\/\/[^\r\n]*/g, "")
        .replace(/#\[[\s\S]*?\]/g, "")
        .trim();
      if (
        remainder ||
        attributes.some(
          (attribute) =>
            !attribute.startsWith("cfg(") || !attribute.endsWith(")"),
        )
      )
        throw new Error(`Unsupported canonical group syntax: ${group[1]}`);
      const gates = attributes.map((attribute) =>
        attribute.slice(4, -1).replace(/\s+/g, " ").trim(),
      );
      entries.push({
        path: match[1],
        ...(gates.length
          ? { cfg: gates.length === 1 ? gates[0] : `all(${gates.join(", ")})` }
          : {}),
        prefix,
        line: match[0],
      });
      cursor = match.index + match[0].length;
    }
    if (!entries.length) throw new Error(`Empty canonical group: ${group[1]}`);
    const tail = body.slice(cursor);
    if (tail.trim())
      throw new Error(`Unexpected canonical group suffix: ${group[1]}`);
    return {
      predicate: group[1],
      builder: group[2],
      names: group[3],
      entries,
      tail,
    };
  });
}

export function commandManifestEntry({ path, cfg }) {
  return { path, ...(cfg === undefined ? {} : { cfg }) };
}

export function rewriteCoreCommandGroups(
  source,
  select = (entries) => entries,
) {
  const groups = parseCoreCommandGroups(source);
  let index = 0;
  return source.replace(
    groupPattern(),
    (whole, predicate, builder, names, body) => {
      const group = groups[index++];
      const selected = select(group.entries, group);
      if (!selected.length)
        throw new Error(`Cannot empty canonical group: ${predicate}`);
      const sorted = sortCommands(selected);
      const replacement =
        sorted.map(({ prefix, line }) => prefix + line).join("") + group.tail;
      return whole.replace(body, replacement);
    },
  );
}
