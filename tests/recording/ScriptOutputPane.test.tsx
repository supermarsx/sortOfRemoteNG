import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ScriptOutputPane, {
  FOLLOW_THRESHOLD_PX,
  MIN_PANE_HEIGHT_PX,
  type ScriptOutputChunkLike,
} from "../../src/components/recording/scriptManager/ScriptOutputPane";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// ── jsdom scroll geometry ───────────────────────────────────────────
// jsdom has no layout, so scrollHeight/clientHeight are always 0. We
// model a scroller whose content height grows with the number of
// characters rendered and whose viewport is a fixed 200px.

const CLIENT_HEIGHT = 200;
let contentHeight = 0;
let scrollTopStore = 0;

function installScrollGeometry() {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "script-output-scroller"
        ? CLIENT_HEIGHT
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "script-output-scroller"
        ? contentHeight
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "script-output-scroller"
        ? scrollTopStore
        : 0;
    },
    set(v: number) {
      if ((this as HTMLElement).dataset.testid !== "script-output-scroller")
        return;
      const max = Math.max(0, contentHeight - CLIENT_HEIGHT);
      scrollTopStore = Math.min(max, Math.max(0, v));
    },
  });
}

function chunk(
  sequence: number,
  data: string,
  stream: "stdout" | "stderr" = "stdout",
): ScriptOutputChunkLike {
  return { sequence, data, stream };
}

function scroller() {
  return screen.getByTestId("script-output-scroller");
}

/** Simulate the user dragging the scrollbar to `top` (fires scroll). */
function userScrollTo(top: number) {
  const el = scroller();
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe("ScriptOutputPane", () => {
  beforeEach(() => {
    contentHeight = 0;
    scrollTopStore = 0;
    installScrollGeometry();
  });

  it("follows the bottom while at the bottom", () => {
    contentHeight = 1000;
    const { rerender } = render(
      <ScriptOutputPane chunks={[chunk(1, "a\n")]} status="running" />,
    );
    // Initial mount while following → pinned to the bottom.
    expect(scroller().scrollTop).toBe(800);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();

    contentHeight = 1400;
    rerender(
      <ScriptOutputPane
        chunks={[chunk(1, "a\n"), chunk(2, "b\n")]}
        status="running"
      />,
    );
    expect(scroller().scrollTop).toBe(1200);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();
  });

  it("stays following when within the 8px threshold", () => {
    contentHeight = 1000;
    const { rerender } = render(
      <ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />,
    );
    userScrollTo(800 - FOLLOW_THRESHOLD_PX);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();

    contentHeight = 1200;
    rerender(
      <ScriptOutputPane
        chunks={[chunk(1, "a"), chunk(2, "b")]}
        status="running"
      />,
    );
    expect(scroller().scrollTop).toBe(1000);
  });

  it("stops following after the user scrolls up and shows the pill", () => {
    contentHeight = 1000;
    render(<ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />);
    userScrollTo(300);
    expect(screen.getByTestId("script-output-follow")).toBeInTheDocument();
    expect(screen.getByTestId("script-output-follow")).toHaveTextContent(
      "Jump to latest",
    );
  });

  it("preserves the scroll offset on append when not following", () => {
    contentHeight = 1000;
    const { rerender } = render(
      <ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />,
    );
    userScrollTo(300);

    contentHeight = 1600;
    rerender(
      <ScriptOutputPane
        chunks={[chunk(1, "a"), chunk(2, "b"), chunk(3, "c")]}
        status="running"
      />,
    );
    expect(scroller().scrollTop).toBe(300);
    expect(screen.getByTestId("script-output-follow")).toBeInTheDocument();
  });

  it("resumes following when the pill is clicked", () => {
    contentHeight = 1000;
    const { rerender } = render(
      <ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />,
    );
    userScrollTo(300);
    fireEvent.click(screen.getByTestId("script-output-follow"));
    expect(scroller().scrollTop).toBe(800);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();

    contentHeight = 1500;
    rerender(
      <ScriptOutputPane
        chunks={[chunk(1, "a"), chunk(2, "b")]}
        status="running"
      />,
    );
    expect(scroller().scrollTop).toBe(1300);
  });

  it("resumes following when the user scrolls back to the bottom", () => {
    contentHeight = 1000;
    render(<ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />);
    userScrollTo(300);
    expect(screen.getByTestId("script-output-follow")).toBeInTheDocument();
    userScrollTo(800);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();
  });

  it("sets overscroll-behavior: contain and no smooth scrolling on the scroller", () => {
    render(<ScriptOutputPane chunks={[]} status="running" />);
    const el = scroller();
    expect(el.style.overscrollBehavior).toBe("contain");
    expect(el.style.scrollBehavior).toBe("auto");
    expect(el.style.minHeight).toBe(`${MIN_PANE_HEIGHT_PX}px`);
  });

  it("wrap toggle flips white-space (default off)", () => {
    render(<ScriptOutputPane chunks={[chunk(1, "x")]} status="finished" />);
    const pre = screen.getByTestId("script-output-text");
    expect(pre.style.whiteSpace).toBe("pre");
    fireEvent.click(screen.getByTestId("script-output-wrap"));
    expect(pre.style.whiteSpace).toBe("pre-wrap");
    expect(screen.getByTestId("script-output-wrap")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("script-output-wrap"));
    expect(pre.style.whiteSpace).toBe("pre");
  });

  it("renders stdout and stderr interleaved by arrival with stderr tinted", () => {
    render(
      <ScriptOutputPane
        chunks={[
          chunk(1, "out1\n"),
          chunk(2, "err1\n", "stderr"),
          chunk(3, "out2\n"),
        ]}
        status="finished"
        exitCode={0}
      />,
    );
    const pre = screen.getByTestId("script-output-text");
    const spans = Array.from(pre.querySelectorAll("span[data-stream]"));
    expect(spans.map((s) => s.getAttribute("data-stream"))).toEqual([
      "stdout",
      "stderr",
      "stdout",
    ]);
    expect(spans[1]).toHaveClass("script-output-stderr");
    expect(spans[1]).toHaveTextContent("err1");
    expect(spans[0]).not.toHaveClass("script-output-stderr");
  });

  it("coalesces adjacent same-stream chunks into one node", () => {
    render(
      <ScriptOutputPane
        chunks={[chunk(1, "a"), chunk(2, "b"), chunk(3, "c")]}
        status="finished"
      />,
    );
    const spans = screen
      .getByTestId("script-output-text")
      .querySelectorAll("span[data-stream]");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toHaveTextContent("abc");
  });

  it("resize handle changes the height (clamped to the minimum)", () => {
    render(
      <ScriptOutputPane chunks={[]} status="running" initialHeight={300} />,
    );
    const el = scroller();
    expect(el.style.height).toBe("300px");

    const handle = screen.getByTestId("script-output-resize");
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(document, { clientY: 250 });
    expect(el.style.height).toBe("450px");
    fireEvent.pointerUp(document, { clientY: 250 });

    // Moving after release does nothing.
    fireEvent.pointerMove(document, { clientY: 600 });
    expect(el.style.height).toBe("450px");

    // Dragging way up clamps to the minimum.
    fireEvent.pointerDown(handle, { clientY: 500 });
    fireEvent.pointerMove(document, { clientY: 0 });
    expect(el.style.height).toBe(`${MIN_PANE_HEIGHT_PX}px`);
    fireEvent.pointerUp(document);
  });

  it("Home/End keys jump and toggle following", () => {
    contentHeight = 1000;
    render(<ScriptOutputPane chunks={[chunk(1, "a")]} status="running" />);
    const el = scroller();
    fireEvent.keyDown(el, { key: "Home" });
    expect(el.scrollTop).toBe(0);
    expect(screen.getByTestId("script-output-follow")).toBeInTheDocument();
    fireEvent.keyDown(el, { key: "End" });
    expect(el.scrollTop).toBe(800);
    expect(screen.queryByTestId("script-output-follow")).toBeNull();
  });

  it("shows exit badge, cancel while running, dismiss when done", () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ScriptOutputPane
        chunks={[]}
        status="running"
        onCancel={onCancel}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText("Running…")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("script-output-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Dismiss")).toBeNull();

    rerender(
      <ScriptOutputPane
        chunks={[]}
        status="finished"
        exitCode={3}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("script-output-exit")).toHaveTextContent(
      "exit 3",
    );
    expect(screen.getByText("(no output)")).toBeInTheDocument();
    expect(screen.queryByTestId("script-output-cancel")).toBeNull();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders error text, cancelled title, truncated badge and notices", () => {
    const { rerender } = render(
      <ScriptOutputPane
        chunks={[]}
        status="failed"
        error="Connection refused"
      />,
    );
    expect(screen.getByText("Execution Failed")).toBeInTheDocument();
    expect(screen.getByText("Connection refused")).toBeInTheDocument();

    rerender(
      <ScriptOutputPane
        chunks={[chunk(1, "partial")]}
        status="cancelled"
        truncated
        notices={["Output capped at 4 MiB"]}
      />,
    );
    expect(screen.getByText("Execution Cancelled")).toBeInTheDocument();
    expect(screen.getByText("truncated")).toBeInTheDocument();
    expect(screen.getByText("Output capped at 4 MiB")).toBeInTheDocument();
  });
});
