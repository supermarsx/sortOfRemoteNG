import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  useSynologyFileStation,
  validSynologyName,
  validSynologyPath,
} from "../../src/hooks/synology/useSynologyFileStation";
import type { FileListResult } from "../../src/types/hardware/synology";
import type { SynologyFileTaskStatus } from "../../src/types/hardware/synologyFileStation";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const files: FileListResult = {
  files: [
    {
      name: "notes.txt",
      path: "/public/notes.txt",
      isdir: false,
      additional: { size: 0 },
    },
    { name: "docs", path: "/public/docs", isdir: true },
  ],
  total: 205,
  offset: 0,
};
const list = (command: string) =>
  Promise.resolve(command === "syn_fs_list" ? files : undefined);
const setup = async () => {
  const hook = renderHook(
    ({ receipt, active }) =>
      useSynologyFileStation("instance-a", receipt, active),
    { initialProps: { receipt: "receipt-a", active: true } },
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  act(() => hook.result.current.navigateToFolder("/public"));
  await waitFor(() => expect(hook.result.current.fileList).toEqual(files));
  return hook;
};
beforeEach(() => vi.mocked(invoke).mockReset().mockImplementation(list));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("File Station session and operation lifecycle", () => {
  it("lists shares at root, then scopes paged/sorted directory requests", async () => {
    const { result } = await setup();
    expect(invoke).toHaveBeenCalledWith("syn_fs_list", {
      instanceId: "instance-a",
      expectedSessionId: "receipt-a",
      folderPath: null,
      offset: 0,
      limit: 100,
      sortBy: "name",
      sortDirection: "asc",
    });
    act(() => {
      result.current.setPage(1);
      result.current.setSortBy("mtime");
      result.current.setSortDirection("desc");
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("syn_fs_list", {
        instanceId: "instance-a",
        expectedSessionId: "receipt-a",
        folderPath: "/public",
        offset: 100,
        limit: 100,
        sortBy: "mtime",
        sortDirection: "desc",
      }),
    );
  });
  it("new NAS resets folder/page/search instead of requesting the old NAS path", async () => {
    const { result, rerender } = await setup();
    act(() => {
      result.current.setPage(2);
      result.current.setFileSearch("private-folder");
    });
    vi.mocked(invoke).mockClear();
    rerender({ receipt: "receipt-b", active: true });
    await waitFor(() => expect(result.current.currentPath).toBe("/"));
    expect(result.current.page).toBe(0);
    expect(result.current.fileSearch).toBe("");
    const requests = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "syn_fs_list");
    expect(requests.length).toBeGreaterThan(0);
    for (const [, args] of requests)
      expect(args).toMatchObject({
        instanceId: "instance-a",
        expectedSessionId: "receipt-b",
        folderPath: null,
        offset: 0,
      });
  });
  it.each(["cancel", "replacement", "session"])(
    "refuses a retained confirmation after %s",
    async (change) => {
      const { result, rerender } = await setup();
      act(() => result.current.requestReview("create"));
      const confirm = result.current.confirmReview;
      if (change === "cancel") act(() => result.current.cancelReview());
      if (change === "replacement")
        act(() => result.current.requestReview("create"));
      if (change === "session")
        rerender({ receipt: "receipt-b", active: true });
      await act(() => confirm("should-not-exist"));
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([cmd]) => cmd === "syn_fs_create_folder"),
      ).toBe(false);
    },
  );
  it("mutation invalidates pending list without stranding loading or hiding its own failure", async () => {
    const { result } = await setup();
    const oldList = deferred<FileListResult>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_list"
        ? oldList.promise
        : command === "syn_fs_create_folder"
          ? Promise.reject(new Error("Permission denied"))
          : Promise.resolve(),
    );
    act(() => {
      void result.current.refresh();
    });
    expect(result.current.loading).toBe(true);
    act(() => result.current.requestReview("create"));
    await act(() => result.current.confirmReview("new-folder"));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Permission denied");
    expect(result.current.review).not.toBeNull();
    await act(async () => oldList.resolve({ files: [], total: 0, offset: 0 }));
    expect(result.current.error).toBe("Permission denied");
    expect(result.current.fileList).toEqual(files);
  });
  it.each(["copy", "move", "delete"] as const)(
    "waits for %s task completion, with no silent overwrite/skip",
    async (kind) => {
      const { result } = await setup();
      const status = deferred<SynologyFileTaskStatus>();
      vi.mocked(invoke).mockImplementation((command) =>
        command === "syn_fs_start_task"
          ? Promise.resolve({ taskId: "task-a" })
          : command === "syn_fs_task_status"
            ? status.promise
            : list(command),
      );
      act(() => result.current.toggleSelection("/public/notes.txt"));
      act(() => result.current.requestReview(kind));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.confirmReview(
          kind === "delete" ? "" : "/public/destination",
        );
      });
      await waitFor(() => expect(result.current.task?.taskId).toBe("task-a"));
      expect(result.current.busy).toBe(true);
      expect(result.current.message).toBeNull();
      expect(invoke).toHaveBeenCalledWith(
        "syn_fs_start_task",
        expect.objectContaining({
          instanceId: "instance-a",
          expectedSessionId: "receipt-a",
          operation: kind,
          paths: ["/public/notes.txt"],
          overwrite: null,
        }),
      );
      await act(async () => {
        status.resolve({
          taskId: "task-a",
          operation: kind,
          finished: true,
          progress: 1,
        });
        await pending;
      });
      expect(result.current.message).toContain("completed on the NAS");
      expect(result.current.busy).toBe(false);
    },
  );
  it("failed task cancellation retains the receipt for explicit retry", async () => {
    const { result } = await setup();
    const status = deferred<SynologyFileTaskStatus>();
    let stops = 0;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_start_task"
        ? Promise.resolve({ taskId: "task-a" })
        : command === "syn_fs_task_status"
          ? status.promise
          : command === "syn_fs_stop_task"
            ? ++stops === 1
              ? Promise.reject("Stop unreachable")
              : Promise.resolve()
            : list(command),
    );
    act(() => result.current.toggleSelection("/public/notes.txt"));
    act(() => result.current.requestReview("delete"));
    let running!: Promise<void>;
    act(() => {
      running = result.current.confirmReview("");
    });
    await waitFor(() => expect(result.current.task?.taskId).toBe("task-a"));
    await act(() => result.current.cancelTask());
    expect(result.current.error).toContain("Retry Cancel task");
    expect(result.current.task?.taskId).toBe("task-a");
    await act(() => result.current.cancelTask());
    expect(stops).toBe(2);
    expect(result.current.task).toBeNull();
    await act(async () => {
      status.resolve({
        taskId: "task-a",
        operation: "delete",
        finished: true,
        progress: 1,
      });
      await running;
    });
    expect(result.current.message).not.toContain("Delete completed");
  });
  it("search waits for completion then pages results with the captured task receipt", async () => {
    const { result } = await setup();
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_start_task"
        ? { taskId: "search-a" }
        : command === "syn_fs_task_status"
          ? {
              taskId: "search-a",
              operation: "search",
              finished: true,
              progress: null,
              files,
            }
          : command === "syn_fs_list"
            ? files
            : undefined,
    );
    act(() => result.current.setFileSearch("*.txt"));
    await act(() => result.current.searchFiles());
    act(() => result.current.setPage(1));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("syn_fs_task_status", {
        instanceId: "instance-a",
        expectedSessionId: "receipt-a",
        taskId: "search-a",
        offset: 100,
        limit: 100,
      }),
    );
    act(() => result.current.setFileSearch(""));
    await act(() => result.current.searchFiles());
    expect(invoke).toHaveBeenCalledWith("syn_fs_stop_task", {
      instanceId: "instance-a",
      expectedSessionId: "receipt-a",
      taskId: "search-a",
    });
  });
  it("new NAS can start tasks after cancellation was refused by the old session", async () => {
    const { result, rerender } = await setup();
    const oldStatus = deferred<SynologyFileTaskStatus>();
    vi.mocked(invoke).mockImplementation((command, args) => {
      const payload = args as Record<string, unknown>;
      if (command === "syn_fs_start_task")
        return Promise.resolve({
          taskId:
            payload.expectedSessionId === "receipt-a" ? "old-task" : "new-task",
        });
      if (command === "syn_fs_task_status")
        return payload.expectedSessionId === "receipt-a"
          ? oldStatus.promise
          : Promise.resolve({
              taskId: "new-task",
              operation: "copy",
              finished: true,
              progress: 1,
            });
      if (command === "syn_fs_stop_task")
        return Promise.reject(
          new Error("Old receipt no longer owns the client"),
        );
      return list(command);
    });
    act(() => result.current.toggleSelection("/public/notes.txt"));
    act(() => result.current.requestReview("delete"));
    let oldRun!: Promise<void>;
    act(() => {
      oldRun = result.current.confirmReview("");
    });
    await waitFor(() => expect(result.current.task?.taskId).toBe("old-task"));
    await act(() => result.current.cancelTask());
    expect(result.current.error).toContain("Retry Cancel task");
    rerender({ receipt: "receipt-b", active: true });
    act(() => result.current.navigateToFolder("/public"));
    await waitFor(() => expect(result.current.fileList).toEqual(files));
    expect(result.current.task).toBeNull();
    expect(result.current.error).toBeNull();
    act(() => result.current.toggleSelection("/public/notes.txt"));
    act(() => result.current.requestReview("copy"));
    await act(() => result.current.confirmReview("/public/destination"));
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_start_task",
      expect.objectContaining({
        instanceId: "instance-a",
        expectedSessionId: "receipt-b",
        operation: "copy",
      }),
    );
    expect(result.current.message).toBe("Copy completed on the NAS.");
    await act(async () => {
      oldStatus.resolve({
        taskId: "old-task",
        operation: "delete",
        finished: true,
        progress: 1,
      });
      await oldRun;
    });
    expect(result.current.message).toBe("Copy completed on the NAS.");
  });
  it("leaving a completed search does not reuse its old task for the new folder list", async () => {
    const { result } = await setup();
    const stopping = deferred<void>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_start_task"
        ? Promise.resolve({ taskId: "search-a" })
        : command === "syn_fs_task_status"
          ? Promise.resolve({
              taskId: "search-a",
              operation: "search",
              finished: true,
              progress: null,
              files,
            })
          : command === "syn_fs_stop_task"
            ? stopping.promise
            : list(command),
    );
    act(() => result.current.setFileSearch("notes"));
    await act(() => result.current.searchFiles());
    vi.mocked(invoke).mockClear();
    act(() => result.current.navigateToFolder("/public/docs"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_fs_list",
        expect.objectContaining({ folderPath: "/public/docs" }),
      ),
    );
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([cmd]) => cmd === "syn_fs_task_status"),
    ).toBe(false);
    await act(async () => stopping.resolve());
  });
  it("native dialog cancellation is not successful transfer and accepts no frontend local paths", async () => {
    const { result } = await setup();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_upload" || command === "syn_fs_download"
        ? Promise.resolve({ cancelled: true })
        : list(command),
    );
    await act(() => result.current.upload());
    expect(invoke).toHaveBeenCalledWith("syn_fs_upload", {
      instanceId: "instance-a",
      expectedSessionId: "receipt-a",
      folderPath: "/public",
      overwrite: null,
    });
    expect(result.current.message).toBeNull();
    act(() => result.current.toggleSelection("/public/notes.txt"));
    await act(() => result.current.download());
    expect(invoke).toHaveBeenCalledWith("syn_fs_download", {
      instanceId: "instance-a",
      expectedSessionId: "receipt-a",
      path: "/public/notes.txt",
    });
    expect(result.current.message).toBeNull();
  });
  it("late file dialog completion cannot report success in a replacement session", async () => {
    const { result, rerender } = await setup();
    const transfer = deferred<{ cancelled: boolean }>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_upload" ? transfer.promise : list(command),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.upload();
    });
    rerender({ receipt: "receipt-b", active: true });
    await act(async () => {
      transfer.resolve({ cancelled: false });
      await pending;
    });
    expect(result.current.message).toBeNull();
    expect(result.current.currentPath).toBe("/");
  });
  it("bounds traversal/control names and paths", () => {
    expect(validSynologyPath("/public/docs")).toBe(true);
    for (const path of [
      "relative",
      "/public/../private",
      "/public/./docs",
      "/public/\nsecret",
    ])
      expect(validSynologyPath(path)).toBe(false);
    for (const name of ["", "..", ".", "a/b", "a\\b", "a\u0000b"])
      expect(validSynologyName(name)).toBe(false);
  });
});
