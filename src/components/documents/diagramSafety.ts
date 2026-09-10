export function validateDiagramSource(source: string) {
  if (
    source.length > 32768 ||
    !/^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram)\b/.test(
      source,
    ) ||
    /%%\{|<\/?[a-z!]|(?:https?|data|javascript|file):|\/\/|url\s*\(|@\{|^\s*click\b/im.test(
      source,
    )
  )
    throw new Error(
      "Use a local flowchart, sequence, class, state or ER diagram. Directives, HTML, images, links and remote resources are disabled.",
    );
}
export async function sanitizeDiagramSvg(svg: string): Promise<string> {
  if (svg.length > 2 * 1024 * 1024)
    throw new Error("The diagram preview is too large.");
  const { default: purify } = await import("dompurify");
  const clean = purify.sanitize(svg, {
    ALLOWED_TAGS: [
      "svg",
      "g",
      "path",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
      "defs",
      "marker",
      "title",
      "desc",
    ],
    ALLOWED_ATTR: [
      "id",
      "viewBox",
      "width",
      "height",
      "x",
      "y",
      "x1",
      "x2",
      "y1",
      "y2",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "d",
      "points",
      "transform",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "opacity",
      "text-anchor",
      "dominant-baseline",
      "font-size",
      "font-weight",
      "marker-end",
      "marker-start",
      "marker-mid",
      "markerWidth",
      "markerHeight",
      "refX",
      "refY",
      "orient",
      "xmlns",
      "role",
      "aria-label",
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "foreignObject", "image", "a", "script"],
    FORBID_ATTR: ["style", "href", "xlink:href"],
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw new Error("The diagram preview is invalid.");
  for (const node of doc.querySelectorAll("*"))
    for (const attr of Array.from(node.attributes)) {
      if (
        /url\s*\(/i.test(attr.value) &&
        !/^url\(#[A-Za-z0-9_.:-]+\)$/.test(attr.value)
      )
        node.removeAttribute(attr.name);
      if (
        /(?:https?|data|javascript|file):|\/\//i.test(attr.value) &&
        attr.name !== "xmlns"
      )
        node.removeAttribute(attr.name);
    }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
