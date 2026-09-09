/** Pinned renderer, loaded only on pages that opt into diagrams. Source remains readable offline. */
const diagrams = Array.from(document.querySelectorAll("pre.mermaid"));
if (diagrams.length) {
  const sources = diagrams.map((node) => node.textContent);
  diagrams.forEach((node) => {
    node.dataset.diagramState = "rendering";
  });
  try {
    const { default: mermaid } =
      await import("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "system-ui, sans-serif",
      htmlLabels: false,
      flowchart: { nodeSpacing: 40, rankSpacing: 50, padding: 12 },
    });
    await mermaid.run({ nodes: diagrams });
    diagrams.forEach((node) => {
      const svg = node.querySelector("svg");
      const bounds = svg?.querySelector("g")?.getBBox();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0)
        throw new Error("Empty rendered diagram");
      // Use the completed graph's transformed bounds. The renderer's initial
      // label-local viewBox can otherwise crop lower nodes or add empty margins.
      const width = Math.ceil(bounds.width + 24);
      svg.setAttribute(
        "viewBox",
        `${bounds.x - 12} ${bounds.y - 12} ${width} ${Math.ceil(bounds.height + 24)}`,
      );
      if (!svg || !Number.isFinite(width) || width <= 0)
        throw new Error("Invalid rendered diagram");
      // Keep labels at their intended size; small screens scroll the figure.
      svg.style.width = `${Math.ceil(width)}px`;
      svg.style.maxWidth = "none";
      const figure = node.closest("figure");
      if (figure) figure.tabIndex = 0;
      node.dataset.diagramState = "ready";
    });
  } catch {
    diagrams.forEach((node, index) => {
      node.textContent = sources[index];
      node.removeAttribute("data-processed");
      node.dataset.diagramState = "fallback";
    });
    const notice = document.createElement("p");
    notice.textContent =
      "Diagram rendering is unavailable. The readable diagram source is shown; the explanation below remains available.";
    notice.setAttribute("role", "status");
    diagrams[0].before(notice);
  }
}
