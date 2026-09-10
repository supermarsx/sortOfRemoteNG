// Trusted, bundled renderer. The input document is data, never markup or code.
const name = document.getElementById("name");
const status = document.getElementById("status");
const content = document.getElementById("content");
const controls = document.getElementById("controls");
const previous = document.getElementById("previous");
const next = document.getElementById("next");
const pageLabel = document.getElementById("page");
const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_EDGE = 16384;
let loadingTask;
let pdf;
let rendering;
let stopped = false;
function fail() {
  status.textContent =
    "This file could not be displayed safely. Close this window to return.";
  controls.hidden = true;
  content.replaceChildren();
}
function canvasFor(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width * height > MAX_PIXELS
  )
    throw new Error("limit");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "contain";
  return canvas;
}
async function open() {
  const metadata = await (
    await fetch("/metadata.json", { credentials: "omit", cache: "no-store" })
  ).json();
  name.textContent = metadata.name;
  const response = await fetch("/document", {
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("read");
  if (metadata.kind === "text") {
    const pre = document.createElement("pre");
    pre.className = `font-${metadata.display.textFontSize}${metadata.display.textWrap ? " wrap" : ""}`;
    pre.textContent = await response.text();
    content.replaceChildren(pre);
  } else if (metadata.kind === "image") {
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = canvasFor(bitmap.width, bitmap.height);
      if (metadata.display.imageFit === "actual") canvas.className = "";
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      content.replaceChildren(canvas);
    } finally {
      bitmap.close();
    }
  } else if (metadata.kind === "pdf") {
    const { getDocument, GlobalWorkerOptions } = await import("/pdf.min.mjs");
    GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    loadingTask = getDocument({
      data: new Uint8Array(await response.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      useWasm: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      stopAtErrors: true,
      maxImageSize: MAX_PIXELS,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
      enableXfa: false,
    });
    pdf = await loadingTask.promise;
    if (stopped || pdf.numPages < 1 || pdf.numPages > 10000)
      throw new Error("limit");
    let pageNumber = 1;
    async function showPage(target) {
      if (rendering || stopped) return;
      previous.disabled = true;
      next.disabled = true;
      status.textContent = "Rendering page…";
      rendering = true;
      try {
        const page = await pdf.getPage(target);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, 1500 / Math.max(1, base.width));
        const viewport = page.getViewport({ scale });
        const canvas = canvasFor(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
        if (stopped) return;
        pageNumber = target;
        content.replaceChildren(canvas);
        pageLabel.textContent = `${pageNumber} / ${pdf.numPages}`;
        status.textContent =
          "PDF canvas preview. Links, scripts, forms, attachments and external resources are disabled.";
      } catch {
        fail();
      } finally {
        rendering = false;
        previous.disabled = pageNumber <= 1;
        next.disabled = pageNumber >= pdf.numPages;
      }
    }
    previous.addEventListener("click", () => {
      if (pageNumber > 1) void showPage(pageNumber - 1);
    });
    next.addEventListener("click", () => {
      if (pageNumber < pdf.numPages) void showPage(pageNumber + 1);
    });
    controls.hidden = false;
    await showPage(1);
    return;
  } else throw new Error("kind");
  status.textContent = "Read-only preview. Close this window to return.";
}
window.addEventListener(
  "pagehide",
  () => {
    stopped = true;
    if (loadingTask) void loadingTask.destroy();
  },
  { once: true },
);
void open().catch(fail);
