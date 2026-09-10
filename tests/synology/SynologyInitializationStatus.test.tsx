import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SynologyInitializationStatus from "../../src/components/synology/synologyPanel/SynologyInitializationStatus";
import { SessionRenderActivityContext } from "../../src/contexts/SessionRenderActivityContext";

const loader = vi.hoisted(() => vi.fn());
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: (props: { size: number; paused: boolean }) => {
    loader(props);
    return <span data-testid="configured-app-loader" />;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  loader.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NAS observed initialization status", () => {
  it("reuses the configured app loader, shows only supplied completions and never estimates percent", () => {
    const cancel = vi.fn();
    render(
      <SynologyInitializationStatus
        phase="signin"
        completed={["Desktop capabilities verified"]}
        onCancel={cancel}
      />,
    );
    expect(screen.getByTestId("configured-app-loader")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledWith(
      expect.objectContaining({ size: 48, paused: false }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("reported together");
    expect(
      screen.getByText("Desktop capabilities verified"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("DSM API session established"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:00");
    act(() => vi.advanceTimersByTime(2500));
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:02");
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("keeps one low-frequency timer under Strict Mode and releases it on phase completion/unmount", () => {
    const { rerender, unmount } = render(
      <React.StrictMode>
        <SynologyInitializationStatus phase="capabilities" />
      </React.StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(61000));
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("1:01");
    rerender(
      <React.StrictMode>
        <SynologyInitializationStatus
          phase="shares"
          completed={["DSM API session established"]}
        />
      </React.StrictMode>,
    );
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:00");
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses ticking in hidden documents and inactive tabs, then catches up without restarting the stage", () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const view = (active: boolean) => (
      <SessionRenderActivityContext.Provider value={{ isActive: active }}>
        <SynologyInitializationStatus phase="signin" />
      </SessionRenderActivityContext.Provider>
    );
    const { rerender, unmount } = render(view(true));
    act(() => vi.advanceTimersByTime(2000));
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    expect(loader).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true }),
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:02");
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:07");
    rerender(view(false));
    expect(vi.getTimerCount()).toBe(0);
    expect(loader).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true }),
    );
    act(() => vi.advanceTimersByTime(3000));
    rerender(view(true));
    expect(
      screen.getByLabelText("Current stage elapsed time"),
    ).toHaveTextContent("0:10");
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses the loader and timer for explicit inactive content without a context provider", () => {
    const { rerender } = render(
      <SynologyInitializationStatus phase="shares" isActive={false} />,
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(loader).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true }),
    );
    rerender(<SynologyInitializationStatus phase="shares" isActive />);
    expect(vi.getTimerCount()).toBe(1);
    expect(loader).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: false }),
    );
  });
});
