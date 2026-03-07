import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMacroRecorder } from "../../src/hooks/recording/useMacroRecorder";

describe("useMacroRecorder", () => {
  it("starts with initial state", () => {
    const { result } = renderHook(() => useMacroRecorder());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.steps).toEqual([]);
    expect(result.current.currentCommand).toBe("");
  });

  it("startRecording sets isRecording to true", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  it("records typed characters into currentCommand", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("s");
    });

    expect(result.current.currentCommand).toBe("ls");
  });

  it("handles backspace", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("s");
      result.current.recordInput("\x7f");
    });

    expect(result.current.currentCommand).toBe("l");
  });

  it("records a step on Enter", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("s");
      result.current.recordInput("\r");
    });

    expect(result.current.steps).toHaveLength(1);
    expect(result.current.steps[0].command).toBe("ls");
    expect(result.current.steps[0].sendNewline).toBe(true);
    expect(result.current.currentCommand).toBe("");
  });

  it("records multiple steps", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("s");
      result.current.recordInput("\r");
    });
    act(() => {
      result.current.recordInput("p");
      result.current.recordInput("w");
      result.current.recordInput("d");
      result.current.recordInput("\r");
    });

    expect(result.current.steps).toHaveLength(2);
    expect(result.current.steps[0].command).toBe("ls");
    expect(result.current.steps[1].command).toBe("pwd");
  });

  it("handles pasted text", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("echo hello world");
    });

    expect(result.current.currentCommand).toBe("echo hello world");
  });

  it("ignores escape sequences", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("\x1b[A"); // Up arrow
      result.current.recordInput("s");
    });

    expect(result.current.currentCommand).toBe("ls");
  });

  it("stopRecording captures remaining buffer as partial step", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("p");
      result.current.recordInput("a");
      result.current.recordInput("r");
      result.current.recordInput("t");
    });

    let steps: ReturnType<typeof result.current.stopRecording>;
    act(() => {
      steps = result.current.stopRecording();
    });

    expect(steps!).toHaveLength(1);
    expect(steps![0].command).toBe("part");
    expect(steps![0].sendNewline).toBe(false);
    expect(result.current.isRecording).toBe(false);
  });

  it("stopRecording returns completed steps when buffer is empty", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("l");
      result.current.recordInput("s");
      result.current.recordInput("\r");
    });

    let steps: ReturnType<typeof result.current.stopRecording>;
    act(() => {
      steps = result.current.stopRecording();
    });

    expect(steps!).toHaveLength(1);
    expect(steps![0].command).toBe("ls");
  });

  it("first step has delayMs of 0", () => {
    const { result } = renderHook(() => useMacroRecorder());

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.recordInput("x");
      result.current.recordInput("\r");
    });

    expect(result.current.steps[0].delayMs).toBe(0);
  });
});
