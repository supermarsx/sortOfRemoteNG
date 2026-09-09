/** Passive, portable icon data. No markup is ever inserted into the DOM. */
export const MAX_ICON_IMPORT_BYTES = 1024 * 1024;
export const MAX_ICON_SVG_BYTES = 64 * 1024;
export const MAX_CUSTOM_ICONS = 250;
export type CustomIconKey = `custom:${string}`;
export interface IconMetadata {
  label: string;
  notes: string;
}
export interface PassiveSvgNode {
  tag:
    | "svg"
    | "g"
    | "path"
    | "circle"
    | "ellipse"
    | "rect"
    | "line"
    | "polyline"
    | "polygon";
  attrs: Record<string, string>;
  children: PassiveSvgNode[];
}
export interface CustomLibraryIcon extends IconMetadata {
  key: CustomIconKey;
  svg: PassiveSvgNode;
}
export interface IconLibraryData {
  version: 1;
  customIcons: CustomLibraryIcon[];
  builtInOverrides: Record<string, IconMetadata>;
}
export interface IconLibraryPack {
  format: "sorng-icon-library";
  version: 1;
  customIcons: CustomLibraryIcon[];
  builtInIcons: Array<IconMetadata & { key: string }>;
}
export const EMPTY_ICON_LIBRARY: IconLibraryData = Object.freeze({
  version: 1,
  customIcons: [],
  builtInOverrides: {},
});
const CUSTOM_KEY =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tags = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);
const shared = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "clip-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
];
const attributes: Record<string, string[]> = {
  svg: ["viewBox", "xmlns", "width", "height", "x", "y"],
  g: [],
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "x2", "y1", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};
function fail(message: string): never {
  throw new Error(`Icon library: ${message}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("unsupported data field");
}
export function iconTextBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
export function validateIconMetadata(value: unknown): IconMetadata {
  const item = object(value);
  const label = item.label;
  const notes = item.notes;
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 120 ||
    Array.from(label).some((char) => char.charCodeAt(0) < 32)
  )
    fail("label must contain 1–120 printable characters");
  if (
    typeof notes !== "string" ||
    notes.length > 2000 ||
    Array.from(notes).some(
      (char) =>
        char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
    )
  )
    fail("notes exceed the supported limit");
  return { label: label.trim(), notes };
}
const numberPattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
function numbers(value: string, count?: number): number[] {
  const matches = value.match(numberPattern) ?? [];
  const result = matches.map(Number);
  if (
    !result.length ||
    (count !== undefined && result.length !== count) ||
    result.length > 4096 ||
    result.some((n) => !Number.isFinite(n) || Math.abs(n) > 32768)
  )
    fail("nonfinite or oversized geometry");
  return result;
}
function validateAttribute(name: string, value: string): string {
  if (value.length > 16384) fail("SVG attribute is too large");
  if (name === "xmlns") {
    if (value !== "http://www.w3.org/2000/svg")
      fail("unsupported SVG namespace");
    return value;
  }
  if (["fill", "stroke"].includes(name)) {
    if (
      !/^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|[a-z]{1,24})$/i.test(
        value,
      ) ||
      /^(?:url|inherit|initial|unset)$/i.test(value)
    )
      fail("only literal colors are supported");
  } else if (name === "stroke-linecap") {
    if (!["butt", "round", "square"].includes(value)) fail("invalid line cap");
  } else if (name === "stroke-linejoin") {
    if (!["miter", "round", "bevel"].includes(value)) fail("invalid line join");
  } else if (["fill-rule", "clip-rule"].includes(name)) {
    if (!["evenodd", "nonzero"].includes(value)) fail("invalid fill rule");
  } else if (name === "d") {
    if (
      !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(value) ||
      !/^[Mm]/.test(value.trim())
    )
      fail("unsupported path data");
    numbers(value);
  } else if (name === "transform") {
    if (
      !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+0-9.eE,\s]+\)\s*)+$/.test(
        value,
      ) ||
      (value.match(/\(/g)?.length ?? 0) > 8
    )
      fail("unsupported transform");
    numbers(value.replace(/[a-zA-Z]+\s*\(/g, "("));
  } else {
    if (!/^[-+0-9.eE,\s]+$/.test(value))
      fail("only numeric geometry is supported");
    const parsed = numbers(
      value,
      name === "viewBox" ? 4 : name === "points" ? undefined : 1,
    );
    if (
      name === "viewBox" &&
      (parsed[2] <= 0 || parsed[3] <= 0 || parsed[2] > 4096 || parsed[3] > 4096)
    )
      fail("invalid viewBox");
    if (
      ["width", "height", "r", "rx", "ry", "stroke-width"].includes(name) &&
      parsed[0] < 0
    )
      fail("negative dimensions");
    if (name.includes("opacity") && (parsed[0] < 0 || parsed[0] > 1))
      fail("invalid opacity");
    if (name === "points" && parsed.length % 2 !== 0) fail("invalid points");
  }
  return value;
}
export function validatePassiveSvg(value: unknown): PassiveSvgNode {
  let count = 0;
  function visit(candidate: unknown, depth: number): PassiveSvgNode {
    if (++count > 256 || depth > 16) fail("SVG is too complex");
    const item = object(candidate);
    keys(item, ["tag", "attrs", "children"]);
    if (
      typeof item.tag !== "string" ||
      !tags.has(item.tag) ||
      (depth === 0 && item.tag !== "svg")
    )
      fail("unsupported SVG element");
    const attrs = object(item.attrs);
    const clean: Record<string, string> = {};
    for (const [name, raw] of Object.entries(attrs)) {
      if (
        ![...shared, ...attributes[item.tag]].includes(name) ||
        typeof raw !== "string"
      )
        fail("unsupported SVG attribute");
      clean[name] = validateAttribute(name, raw.trim());
    }
    if (depth === 0 && !clean.viewBox) fail("SVG requires a finite viewBox");
    if (
      !Array.isArray(item.children) ||
      item.children.length > 256 ||
      (!["svg", "g"].includes(item.tag) && item.children.length)
    )
      fail("invalid SVG children");
    return {
      tag: item.tag as PassiveSvgNode["tag"],
      attrs: clean,
      children: item.children.map((child) => visit(child, depth + 1)),
    };
  }
  const validated = visit(value, 0);
  if (iconTextBytes(JSON.stringify(validated)) > MAX_ICON_SVG_BYTES)
    fail("SVG is too large");
  return validated;
}
export function parsePassiveSvg(source: string): PassiveSvgNode {
  if (iconTextBytes(source) > MAX_ICON_SVG_BYTES) fail("SVG exceeds 64 KiB");
  if (/<!|<\?/.test(source))
    fail(
      "SVG declarations, entities and processing instructions are not supported",
    );
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.tagName !== "svg")
    fail("malformed SVG");
  let nodes = 0;
  function convert(element: Element, depth = 0): unknown {
    if (++nodes > 256 || depth > 16) fail("SVG is too complex");
    if (
      element.namespaceURI !== "http://www.w3.org/2000/svg" &&
      element.namespaceURI !== null
    )
      fail("unsupported namespace");
    if (
      Array.from(element.childNodes).some(
        (node) =>
          node.nodeType !== 1 &&
          (node.nodeType !== 3 || !!node.textContent?.trim()),
      )
    )
      fail("SVG text/comments are not supported");
    return {
      tag: element.tagName,
      attrs: Object.fromEntries(
        Array.from(element.attributes, (attr) => [attr.name, attr.value]),
      ),
      children: Array.from(element.children, (child) =>
        convert(child, depth + 1),
      ),
    };
  }
  return validatePassiveSvg(convert(doc.documentElement));
}
export function validateCustomIcon(value: unknown): CustomLibraryIcon {
  const item = object(value);
  keys(item, ["key", "label", "notes", "svg"]);
  if (typeof item.key !== "string" || !CUSTOM_KEY.test(item.key))
    fail("invalid custom UUID key");
  return {
    key: item.key as CustomIconKey,
    ...validateIconMetadata(item),
    svg: validatePassiveSvg(item.svg),
  };
}
export function validateIconLibrary(value: unknown): IconLibraryData {
  if (value === undefined)
    return { version: 1, customIcons: [], builtInOverrides: {} };
  if (iconTextBytes(JSON.stringify(value)) > MAX_ICON_IMPORT_BYTES)
    fail("library exceeds 1 MiB");
  const item = object(value);
  keys(item, ["version", "customIcons", "builtInOverrides"]);
  if (
    item.version !== 1 ||
    !Array.isArray(item.customIcons) ||
    item.customIcons.length > MAX_CUSTOM_ICONS
  )
    fail("unsupported library version or icon count");
  const customIcons = item.customIcons.map(validateCustomIcon);
  if (new Set(customIcons.map((icon) => icon.key)).size !== customIcons.length)
    fail("duplicate custom keys");
  const overrides = object(item.builtInOverrides);
  if (Object.keys(overrides).length > 4000) fail("too many metadata overrides");
  const builtInOverrides: Record<string, IconMetadata> = {};
  for (const [key, metadata] of Object.entries(overrides)) {
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(key)) fail("invalid built-in key");
    keys(object(metadata), ["label", "notes"]);
    builtInOverrides[key] = validateIconMetadata(metadata);
  }
  return { version: 1, customIcons, builtInOverrides };
}
export function parseIconPack(source: string): IconLibraryPack {
  if (iconTextBytes(source) > MAX_ICON_IMPORT_BYTES) fail("pack exceeds 1 MiB");
  const value = object(JSON.parse(source));
  keys(value, ["format", "version", "customIcons", "builtInIcons"]);
  if (
    value.format !== "sorng-icon-library" ||
    value.version !== 1 ||
    !Array.isArray(value.builtInIcons) ||
    value.builtInIcons.length > 4000
  )
    fail("unsupported icon pack");
  const builtInOverrides: Record<string, IconMetadata> = {};
  for (const entry of value.builtInIcons) {
    const item = object(entry);
    keys(item, ["key", "label", "notes"]);
    if (
      typeof item.key !== "string" ||
      Object.prototype.hasOwnProperty.call(builtInOverrides, item.key)
    )
      fail("duplicate or invalid built-in reference");
    Object.defineProperty(builtInOverrides, item.key, {
      value: validateIconMetadata(item),
      enumerable: true,
    });
  }
  const library = validateIconLibrary({
    version: 1,
    customIcons: value.customIcons,
    builtInOverrides,
  });
  return {
    format: "sorng-icon-library",
    version: 1,
    customIcons: library.customIcons,
    builtInIcons: Object.entries(library.builtInOverrides).map(
      ([key, metadata]) => ({ key, ...metadata }),
    ),
  };
}
export function serializePassiveSvg(node: PassiveSvgNode): string {
  const escaped = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<${node.tag}${Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escaped(value)}"`)
    .join(
      "",
    )}>${node.children.map(serializePassiveSvg).join("")}</${node.tag}>`;
}
