import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PromptHostUnavailableError,
  cancelAllPrompts,
  createPromptMemory,
  getPromptSnapshot,
  registerPromptHost,
  requestPrompt,
  resetPromptQueueForTests,
  settlePrompt,
  subscribePrompts,
  type PromptDecision,
  type PromptRequest,
} from "../../src/utils/prompts/promptQueue";

const CANCELLED: PromptDecision = { confirmed: false, remember: false };
const CONFIRMED: PromptDecision = { confirmed: true, remember: false };

const request = (overrides: Partial<PromptRequest> = {}): PromptRequest => ({
  title: 'Run "Disk usage" on web-01?',
  confirmLabel: "Run script",
  ...overrides,
});

const headId = () => getPromptSnapshot()[0]?.id;
const titles = () => getPromptSnapshot().map((entry) => entry.request.title);

/** Resolves to "pending" when the promise has not settled yet. */
const stateOf = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 0)),
  ]);

describe("prompt queue", () => {
  let nativeConfirm: ReturnType<typeof vi.spyOn>;
  let nativeAlert: ReturnType<typeof vi.spyOn>;
  let nativePrompt: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPromptQueueForTests();
    nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    nativeAlert = vi.spyOn(window, "alert").mockImplementation(() => {});
    nativePrompt = vi.spyOn(window, "prompt").mockReturnValue("yes");
  });

  afterEach(() => {
    // No path through the store may reach the webview's own dialogs. The
    // cleanup runs whatever the checks say, so a failure stays in its case.
    try {
      expect(nativeConfirm).not.toHaveBeenCalled();
      expect(nativeAlert).not.toHaveBeenCalled();
      expect(nativePrompt).not.toHaveBeenCalled();
    } finally {
      resetPromptQueueForTests();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  describe("without a host", () => {
    it("rejects with PromptHostUnavailableError and queues nothing", async () => {
      const outcome = requestPrompt(request());
      await expect(outcome).rejects.toBeInstanceOf(PromptHostUnavailableError);
      await expect(outcome).rejects.toMatchObject({
        name: "PromptHostUnavailableError",
      });
      expect(getPromptSnapshot()).toHaveLength(0);
    });

    it("rejects again once the last host has gone", async () => {
      const unregister = registerPromptHost();
      unregister();
      await expect(requestPrompt(request())).rejects.toBeInstanceOf(
        PromptHostUnavailableError,
      );
    });
  });

  describe("with a host", () => {
    beforeEach(() => {
      registerPromptHost();
    });

    it("shows requests first in, first out and answers each with its own decision", async () => {
      const first = requestPrompt(request({ title: "first" }));
      const second = requestPrompt(request({ title: "second" }));
      const third = requestPrompt(request({ title: "third" }));
      expect(titles()).toEqual(["first", "second", "third"]);

      settlePrompt(headId()!, CONFIRMED);
      await expect(first).resolves.toEqual(CONFIRMED);
      expect(titles()).toEqual(["second", "third"]);
      expect(await stateOf(second)).toBe("pending");

      settlePrompt(headId()!, CANCELLED);
      await expect(second).resolves.toEqual(CANCELLED);
      expect(titles()).toEqual(["third"]);

      settlePrompt(headId()!, CONFIRMED);
      await expect(third).resolves.toEqual(CONFIRMED);
      expect(getPromptSnapshot()).toHaveLength(0);
    });

    it("ignores a settle for a prompt that is not the visible one", async () => {
      const first = requestPrompt(request({ title: "first" }));
      const second = requestPrompt(request({ title: "second" }));
      const [, queued] = getPromptSnapshot();

      settlePrompt(queued.id, CONFIRMED);
      settlePrompt(9_999, CONFIRMED);

      expect(titles()).toEqual(["first", "second"]);
      expect(await stateOf(first)).toBe("pending");
      expect(await stateOf(second)).toBe("pending");
    });

    it("ignores a second settle of the same prompt", async () => {
      const first = requestPrompt(request({ title: "first" }));
      const second = requestPrompt(request({ title: "second" }));
      const id = headId()!;

      settlePrompt(id, CANCELLED);
      settlePrompt(id, CONFIRMED);

      await expect(first).resolves.toEqual(CANCELLED);
      expect(titles()).toEqual(["second"]);
      expect(await stateOf(second)).toBe("pending");
    });

    it("confirms only on a literal true and remembers only what was offered and confirmed", async () => {
      const truthy = requestPrompt(request({ title: "truthy" }));
      settlePrompt(headId()!, {
        confirmed: "yes",
        remember: true,
      } as unknown as PromptDecision);
      await expect(truthy).resolves.toEqual(CANCELLED);

      const notOffered = requestPrompt(request({ title: "not offered" }));
      settlePrompt(headId()!, { confirmed: true, remember: true });
      await expect(notOffered).resolves.toEqual(CONFIRMED);

      const cancelledTicked = requestPrompt(
        request({ title: "ticked", remember: { label: "Don't ask again" } }),
      );
      settlePrompt(headId()!, { confirmed: false, remember: true });
      await expect(cancelledTicked).resolves.toEqual(CANCELLED);

      const offered = requestPrompt(
        request({ title: "offered", remember: { label: "Don't ask again" } }),
      );
      settlePrompt(headId()!, { confirmed: true, remember: true });
      await expect(offered).resolves.toEqual({
        confirmed: true,
        remember: true,
      });
    });

    describe("identical pending requests", () => {
      it("join the pending prompt instead of queueing a second one", async () => {
        const first = requestPrompt(request({ dedupeKey: "script:1:s1" }));
        const second = requestPrompt(request({ dedupeKey: "script:1:s1" }));
        expect(getPromptSnapshot()).toHaveLength(1);

        settlePrompt(headId()!, CONFIRMED);
        await expect(first).resolves.toEqual(CONFIRMED);
        await expect(second).resolves.toEqual(CONFIRMED);
        expect(getPromptSnapshot()).toHaveLength(0);
      });

      it("never lend an answer to a request with the same key but other content", async () => {
        const reviewed = requestPrompt(
          request({
            dedupeKey: "script:1:s1",
            preview: { label: "Commands to run", text: "df -h" },
          }),
        );
        const different = requestPrompt(
          request({
            dedupeKey: "script:1:s1",
            preview: { label: "Commands to run", text: "rm -rf /" },
          }),
        );
        expect(getPromptSnapshot()).toHaveLength(2);

        settlePrompt(headId()!, CONFIRMED);
        await expect(reviewed).resolves.toEqual(CONFIRMED);
        expect(await stateOf(different)).toBe("pending");
        expect(getPromptSnapshot()[0].request.preview?.text).toBe("rm -rf /");
      });

      it("do not merge without a key, even when the content is equal", () => {
        void requestPrompt(request());
        void requestPrompt(request());
        expect(getPromptSnapshot()).toHaveLength(2);
      });

      it("release only the caller that aborted and keep the prompt for the other", async () => {
        const firstAbort = new AbortController();
        const first = requestPrompt(request({ dedupeKey: "k" }), {
          signal: firstAbort.signal,
        });
        const second = requestPrompt(request({ dedupeKey: "k" }));

        firstAbort.abort();
        await expect(first).resolves.toEqual(CANCELLED);
        expect(getPromptSnapshot()).toHaveLength(1);
        expect(await stateOf(second)).toBe("pending");

        settlePrompt(headId()!, CONFIRMED);
        await expect(second).resolves.toEqual(CONFIRMED);
      });

      it("leave the queue once every caller has aborted", async () => {
        const firstAbort = new AbortController();
        const secondAbort = new AbortController();
        const first = requestPrompt(request({ dedupeKey: "k" }), {
          signal: firstAbort.signal,
        });
        const second = requestPrompt(request({ dedupeKey: "k" }), {
          signal: secondAbort.signal,
        });
        firstAbort.abort();
        secondAbort.abort();
        await expect(first).resolves.toEqual(CANCELLED);
        await expect(second).resolves.toEqual(CANCELLED);
        expect(getPromptSnapshot()).toHaveLength(0);
      });
    });

    describe("abort", () => {
      it("before the request resolves as not confirmed and never queues", async () => {
        const controller = new AbortController();
        controller.abort();
        const outcome = requestPrompt(request(), { signal: controller.signal });
        expect(getPromptSnapshot()).toHaveLength(0);
        await expect(outcome).resolves.toEqual(CANCELLED);
      });

      it("while visible resolves as not confirmed and shows the next prompt", async () => {
        const controller = new AbortController();
        const first = requestPrompt(request({ title: "first" }), {
          signal: controller.signal,
        });
        const second = requestPrompt(request({ title: "second" }));
        const staleId = headId()!;

        controller.abort();

        await expect(first).resolves.toEqual(CANCELLED);
        expect(titles()).toEqual(["second"]);
        // A late answer from the dialog that was showing it changes nothing.
        settlePrompt(staleId, CONFIRMED);
        expect(titles()).toEqual(["second"]);
        expect(await stateOf(second)).toBe("pending");
      });

      it("while waiting behind another prompt removes only that request", async () => {
        const controller = new AbortController();
        const first = requestPrompt(request({ title: "first" }));
        const second = requestPrompt(request({ title: "second" }), {
          signal: controller.signal,
        });

        controller.abort();

        await expect(second).resolves.toEqual(CANCELLED);
        expect(titles()).toEqual(["first"]);
        expect(await stateOf(first)).toBe("pending");
      });

      it("after the answer changes nothing and leaves no listener on the signal", async () => {
        const controller = new AbortController();
        const added = vi.spyOn(controller.signal, "addEventListener");
        const removed = vi.spyOn(controller.signal, "removeEventListener");
        const outcome = requestPrompt(request(), { signal: controller.signal });

        settlePrompt(headId()!, CONFIRMED);
        await expect(outcome).resolves.toEqual(CONFIRMED);
        expect(added).toHaveBeenCalledTimes(1);
        expect(removed).toHaveBeenCalledTimes(1);
        expect(removed.mock.calls[0][1]).toBe(added.mock.calls[0][1]);

        controller.abort();
        await expect(outcome).resolves.toEqual(CONFIRMED);
      });

      it("never rejects, whatever the abort reason", async () => {
        const controller = new AbortController();
        const outcome = requestPrompt(request(), { signal: controller.signal });
        controller.abort(new Error("session ended"));
        await expect(outcome).resolves.toEqual(CANCELLED);
      });
    });

    describe("hosts", () => {
      it("cancel every pending prompt when the last one unregisters", async () => {
        resetPromptQueueForTests();
        const unregister = registerPromptHost();
        const first = requestPrompt(request({ title: "first" }));
        const second = requestPrompt(request({ title: "second" }));

        unregister();

        await expect(first).resolves.toEqual(CANCELLED);
        await expect(second).resolves.toEqual(CANCELLED);
        expect(getPromptSnapshot()).toHaveLength(0);
      });

      it("keep prompts while another host is still registered", async () => {
        const unregisterSecond = registerPromptHost();
        const pending = requestPrompt(request());

        unregisterSecond();
        unregisterSecond();

        expect(getPromptSnapshot()).toHaveLength(1);
        expect(await stateOf(pending)).toBe("pending");
      });

      it("treat a repeated unregister as one", async () => {
        resetPromptQueueForTests();
        const unregisterFirst = registerPromptHost();
        const unregisterSecond = registerPromptHost();
        unregisterFirst();
        unregisterFirst();
        const pending = requestPrompt(request());
        expect(await stateOf(pending)).toBe("pending");
        unregisterSecond();
        await expect(pending).resolves.toEqual(CANCELLED);
      });
    });

    it("cancels everything on request, for a window that is going away", async () => {
      const first = requestPrompt(request({ title: "first" }));
      const second = requestPrompt(request({ title: "second" }));
      cancelAllPrompts();
      await expect(first).resolves.toEqual(CANCELLED);
      await expect(second).resolves.toEqual(CANCELLED);
      expect(getPromptSnapshot()).toHaveLength(0);
      // The host is still there: the next request is shown normally.
      void requestPrompt(request({ title: "third" }));
      expect(titles()).toEqual(["third"]);
    });

    describe("snapshot", () => {
      it("keeps its identity between changes and replaces it on each change", () => {
        const empty = getPromptSnapshot();
        expect(getPromptSnapshot()).toBe(empty);

        void requestPrompt(request({ title: "first" }));
        const one = getPromptSnapshot();
        expect(one).not.toBe(empty);
        expect(getPromptSnapshot()).toBe(one);

        settlePrompt(9_999, CONFIRMED);
        expect(getPromptSnapshot()).toBe(one);

        void requestPrompt(request({ title: "second" }));
        const two = getPromptSnapshot();
        expect(two).not.toBe(one);
        expect(two[0]).toBe(one[0]);

        settlePrompt(two[0].id, CANCELLED);
        expect(getPromptSnapshot()).not.toBe(two);
      });

      it("tells subscribers once per change and stops after unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribePrompts(listener);

        void requestPrompt(request({ title: "first" }));
        expect(listener).toHaveBeenCalledTimes(1);
        // Joining a pending prompt changes nothing on screen.
        void requestPrompt(request({ dedupeKey: "k" }));
        void requestPrompt(request({ dedupeKey: "k" }));
        expect(listener).toHaveBeenCalledTimes(2);

        settlePrompt(headId()!, CANCELLED);
        expect(listener).toHaveBeenCalledTimes(3);

        unsubscribe();
        settlePrompt(headId()!, CANCELLED);
        expect(listener).toHaveBeenCalledTimes(3);
      });

      it("still answers when a subscriber throws", async () => {
        subscribePrompts(() => {
          throw new Error("subscriber failed");
        });
        const later = vi.fn();
        subscribePrompts(later);
        const outcome = requestPrompt(request());
        settlePrompt(headId()!, CONFIRMED);
        await expect(outcome).resolves.toEqual(CONFIRMED);
        expect(later).toHaveBeenCalledTimes(2);
        expect(getPromptSnapshot()).toHaveLength(0);
      });

      it("shows what was requested even if the caller changes its objects afterwards", () => {
        const items = [{ id: "s1", name: "web-01", detail: "10.0.0.1" }];
        const mutable = request({
          preview: { label: "Command", text: "df -h" },
          targets: { label: "Runs on", items },
          facts: ["bash"],
        });
        void requestPrompt(mutable);

        mutable.title = "changed";
        mutable.preview!.text = "rm -rf /";
        items[0].name = "db-01";
        items.push({ id: "s2", name: "db-02", detail: "10.0.0.2" });
        mutable.facts!.push("root");

        const shown = getPromptSnapshot()[0].request;
        expect(shown.title).toBe('Run "Disk usage" on web-01?');
        expect(shown.preview?.text).toBe("df -h");
        expect(shown.targets?.items).toEqual([
          { id: "s1", name: "web-01", detail: "10.0.0.1" },
        ]);
        expect(shown.facts).toEqual(["bash"]);
        expect(Object.isFrozen(shown)).toBe(true);
        expect(Object.isFrozen(shown.targets?.items)).toBe(true);
      });

      it("keeps nothing of a request once it is answered", async () => {
        const secret = "export TOKEN=hunter2";
        const outcome = requestPrompt(
          request({ preview: { label: "Commands to run", text: secret } }),
        );
        settlePrompt(headId()!, CONFIRMED);
        await outcome;
        expect(JSON.stringify(getPromptSnapshot())).not.toContain("hunter2");
        expect(getPromptSnapshot()).toHaveLength(0);
      });
    });

    it("writes nothing to the console at any point", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map(
        (method) => vi.spyOn(console, method).mockImplementation(() => {}),
      );
      const controller = new AbortController();
      const first = requestPrompt(
        request({
          preview: { label: "Commands", text: "export TOKEN=hunter2" },
        }),
        { signal: controller.signal },
      );
      const second = requestPrompt(request({ dedupeKey: "k" }));
      controller.abort();
      settlePrompt(headId()!, CONFIRMED);
      cancelAllPrompts();
      await Promise.all([first, second]);
      await requestPrompt(request(), { signal: controller.signal });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it("does not stop timers while a prompt is pending", async () => {
      vi.useFakeTimers();
      try {
        const tick = vi.fn();
        const timer = setInterval(tick, 100);
        const outcome = requestPrompt(request());
        vi.advanceTimersByTime(350);
        expect(tick).toHaveBeenCalledTimes(3);
        clearInterval(timer);
        settlePrompt(headId()!, CANCELLED);
        await expect(outcome).resolves.toEqual(CANCELLED);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("reset for tests cancels what is pending and forgets the hosts", async () => {
    registerPromptHost();
    const pending = requestPrompt(request());
    resetPromptQueueForTests();
    await expect(pending).resolves.toEqual(CANCELLED);
    expect(getPromptSnapshot()).toHaveLength(0);
    await expect(requestPrompt(request())).rejects.toBeInstanceOf(
      PromptHostUnavailableError,
    );
  });
});

describe("prompt memory (don't ask again)", () => {
  const scope = {
    kind: "ssh-script",
    id: "script-1",
    sessionId: "backend-1",
    content: "df -h\nuptime",
  };

  it("remembers nothing until told to", () => {
    const memory = createPromptMemory();
    expect(memory.has(scope)).toBe(false);
  });

  it("applies only to the same kind, item, session and exact content", () => {
    const memory = createPromptMemory();
    memory.remember(scope);
    expect(memory.has({ ...scope })).toBe(true);
    expect(memory.has({ ...scope, kind: "ssh-macro" })).toBe(false);
    expect(memory.has({ ...scope, id: "script-2" })).toBe(false);
    expect(memory.has({ ...scope, sessionId: "backend-2" })).toBe(false);
    expect(memory.has(scope)).toBe(true);
  });

  it("forgets an item as soon as its content differs, even if it changes back", () => {
    const memory = createPromptMemory();
    memory.remember(scope);
    expect(memory.has({ ...scope, content: "df -h\nuptime " })).toBe(false);
    expect(memory.has(scope)).toBe(false);
  });

  it("forgets a session that ended without touching the others", () => {
    const memory = createPromptMemory();
    const other = { ...scope, sessionId: "backend-2" };
    memory.remember(scope);
    memory.remember(other);
    memory.forgetSession("backend-1");
    expect(memory.has(scope)).toBe(false);
    expect(memory.has(other)).toBe(true);
    memory.clear();
    expect(memory.has(other)).toBe(false);
  });

  it("is separate per instance, so one terminal never answers for another", () => {
    const first = createPromptMemory();
    const second = createPromptMemory();
    first.remember(scope);
    expect(second.has(scope)).toBe(false);
  });

  it("never remembers an item or session without an identity", () => {
    const memory = createPromptMemory();
    for (const blank of [
      { ...scope, id: "" },
      { ...scope, sessionId: "" },
      { ...scope, kind: "" },
    ]) {
      memory.remember(blank);
      expect(memory.has(blank)).toBe(false);
    }
  });

  it("does not confuse ids that only look alike when joined", () => {
    const memory = createPromptMemory();
    memory.remember({ ...scope, sessionId: "a", id: "b:c" });
    expect(memory.has({ ...scope, sessionId: "a:b", id: "c" })).toBe(false);
  });

  it("touches no storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const memory = createPromptMemory();
    memory.remember(scope);
    memory.has(scope);
    memory.forgetSession(scope.sessionId);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    setItem.mockRestore();
  });
});
