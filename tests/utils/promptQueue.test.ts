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
  type PromptChoiceOption,
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

  describe("a group of choices", () => {
    // Fresh, mutable objects each time, so a case can change them afterwards.
    const group = (): NonNullable<PromptRequest["choices"]> => ({
      label: "Next time this script is run",
      options: [
        { id: "ask", label: "Ask every time" },
        {
          id: "session",
          label: "Don't ask again in this session",
          hint: "Until the session ends or the script changes.",
        },
        {
          id: "connection",
          label: "Always run it without asking on this connection",
          hint: "Only this exact script, only on this saved connection.",
        },
        {
          id: "everywhere",
          label: "Always run it without asking on every connection",
          hint: "Only this exact script, in any SSH session.",
        },
      ],
      note: "A lasting choice covers this exact script.",
    });
    const shownChoices = () => getPromptSnapshot()[0]?.request.choices;

    beforeEach(() => {
      registerPromptHost();
    });

    it("is copied and frozen, so the caller cannot change what is shown", () => {
      const choices = group();
      const options = choices.options as PromptChoiceOption[];
      void requestPrompt(
        request({ choices: { ...choices, noteTone: "danger" } }),
      );
      choices.label = "changed";
      options[0].label = "Always, everywhere";
      options[1].hint = "changed";
      options.reverse();
      options.push({ id: "extra", label: "extra" });

      const shown = shownChoices();
      expect(shown).toEqual({ ...group(), noteTone: "danger" });
      expect(Object.isFrozen(shown)).toBe(true);
      expect(Object.isFrozen(shown?.options)).toBe(true);
      for (const option of shown!.options)
        expect(Object.isFrozen(option)).toBe(true);
    });

    it("keeps only the fields it knows, so no request can preselect an answer", () => {
      const choices = group();
      void requestPrompt(
        request({
          choices: {
            ...choices,
            selected: "everywhere",
            defaultValue: "everywhere",
            options: choices.options.map((option, index) => ({
              ...option,
              ...(index === 3
                ? { checked: true, selected: true, default: true }
                : {}),
            })),
          } as PromptRequest["choices"],
        }),
      );
      expect(shownChoices()).toStrictEqual(group());
      expect(Object.keys(shownChoices()!.options[0])).toEqual(["id", "label"]);
      expect(Object.keys(shownChoices()!.options[3])).toEqual([
        "id",
        "label",
        "hint",
      ]);
    });

    it("keeps two to six answers", () => {
      const options = Array.from({ length: 6 }, (_, index) => ({
        id: `o${index}`,
        label: `Option ${index}`,
      }));
      void requestPrompt(
        request({
          title: "two",
          choices: { label: "l", options: options.slice(0, 2) },
        }),
      );
      void requestPrompt(
        request({ title: "six", choices: { label: "l", options } }),
      );
      const [two, six] = getPromptSnapshot();
      expect(two.request.choices?.options).toHaveLength(2);
      expect(six.request.choices?.options).toHaveLength(6);
    });

    it.each([
      ["no answers", { label: "l", options: [] }],
      ["one answer", { label: "l", options: [{ id: "a", label: "A" }] }],
      [
        "seven answers",
        {
          label: "l",
          options: Array.from({ length: 7 }, (_, index) => ({
            id: `o${index}`,
            label: `Option ${index}`,
          })),
        },
      ],
      [
        "a repeated id",
        {
          label: "l",
          options: [
            { id: "ask", label: "Ask every time" },
            { id: "ask", label: "Always" },
          ],
        },
      ],
      [
        "an empty id",
        {
          label: "l",
          options: [
            { id: "ask", label: "A" },
            { id: "", label: "B" },
          ],
        },
      ],
      [
        "an id that is not a string",
        {
          label: "l",
          options: [
            { id: "ask", label: "A" },
            { id: 7, label: "B" },
          ],
        },
      ],
      [
        "a label that is not a string",
        {
          label: "l",
          options: [
            { id: "ask", label: "A" },
            { id: "b", label: null },
          ],
        },
      ],
      [
        "a hint that is not a string",
        {
          label: "l",
          options: [
            { id: "ask", label: "A" },
            { id: "b", label: "B", hint: 3 },
          ],
        },
      ],
      [
        "an answer that is not an object",
        { label: "l", options: [{ id: "ask", label: "A" }, "b"] },
      ],
      ["answers that are not a list", { label: "l", options: "ask,b" }],
      [
        "a legend that is not a string",
        {
          label: 1,
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
      [
        "a note that is not a string",
        {
          label: "l",
          note: {},
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
      [
        "an unknown tone",
        {
          label: "l",
          noteTone: "red",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
      ["null", null],
      ["a string", "ask"],
    ])(
      "drops a group with %s and keeps the prompt usable",
      async (_what, choices) => {
        const outcome = requestPrompt(
          request({
            message: "kept",
            choices: choices as unknown as PromptRequest["choices"],
          }),
        );
        const shown = getPromptSnapshot()[0].request;
        expect(shown.message).toBe("kept");
        expect("choices" in shown).toBe(false);
        settlePrompt(headId()!, {
          confirmed: true,
          remember: false,
          choice: "b",
        });
        await expect(outcome).resolves.toStrictEqual(CONFIRMED);
      },
    );

    it("is never joined with a request whose group differs, whatever the key", async () => {
      const options = group().options;
      const variants: Array<PromptRequest["choices"]> = [
        { ...group(), label: "Next time this macro is replayed" },
        { ...group(), note: "Another note." },
        { ...group(), noteTone: "danger" },
        { ...group(), note: undefined },
        { ...group(), options: options.slice(0, 3) },
        { ...group(), options: [...options].reverse() },
        {
          ...group(),
          options: options.map((option, index) =>
            index === 2 ? { ...option, id: "connection-2" } : option,
          ),
        },
        {
          ...group(),
          options: options.map((option, index) =>
            index === 2 ? { ...option, label: "Always" } : option,
          ),
        },
        {
          ...group(),
          options: options.map((option, index) =>
            index === 2 ? { ...option, hint: "Anywhere." } : option,
          ),
        },
        {
          ...group(),
          options: options.map((option, index) =>
            index === 1 ? { id: option.id, label: option.label } : option,
          ),
        },
        undefined,
      ];
      const reviewed = requestPrompt(
        request({ dedupeKey: "script:1:s1", choices: group() }),
      );
      for (const choices of variants)
        void requestPrompt(request({ dedupeKey: "script:1:s1", choices }));
      expect(getPromptSnapshot()).toHaveLength(1 + variants.length);

      settlePrompt(headId()!, {
        confirmed: true,
        remember: false,
        choice: "everywhere",
      });
      await expect(reviewed).resolves.toStrictEqual({
        ...CONFIRMED,
        choice: "everywhere",
      });
      expect(getPromptSnapshot()).toHaveLength(variants.length);
    });

    it("joins an identical request, and both callers receive the same choice", async () => {
      const first = requestPrompt(
        request({ dedupeKey: "script:1:s1", choices: group() }),
      );
      const second = requestPrompt(
        request({ dedupeKey: "script:1:s1", choices: group() }),
      );
      expect(getPromptSnapshot()).toHaveLength(1);
      settlePrompt(headId()!, {
        confirmed: true,
        remember: false,
        choice: "connection",
      });
      const answer = { ...CONFIRMED, choice: "connection" };
      await expect(first).resolves.toStrictEqual(answer);
      await expect(second).resolves.toStrictEqual(answer);
    });

    it("passes a choice on only with a confirm and only when the request offered it", async () => {
      const answerFor = async (decision: unknown) => {
        const outcome = requestPrompt(request({ choices: group() }));
        settlePrompt(headId()!, decision as PromptDecision);
        return outcome;
      };
      for (const id of ["ask", "session", "connection", "everywhere"])
        expect(
          await answerFor({ confirmed: true, remember: false, choice: id }),
        ).toStrictEqual({ ...CONFIRMED, choice: id });
      for (const choice of [
        "always",
        "Everywhere",
        "",
        "toString",
        "__proto__",
        1,
        null,
        {},
        ["everywhere"],
        undefined,
      ])
        expect(
          await answerFor({ confirmed: true, remember: false, choice }),
        ).toStrictEqual(CONFIRMED);
      expect(
        await answerFor({ confirmed: true, remember: false }),
      ).toStrictEqual(CONFIRMED);
      // The checkbox is still reported only when it was offered.
      expect(
        await answerFor({
          confirmed: true,
          remember: true,
          choice: "everywhere",
        }),
      ).toStrictEqual({ ...CONFIRMED, choice: "everywhere" });
    });

    it("answers a cancel with exactly what it always did, whatever was chosen", async () => {
      for (const decision of [
        { confirmed: false, remember: false, choice: "everywhere" },
        { confirmed: false, remember: true, choice: "connection" },
        { confirmed: "yes", remember: false, choice: "everywhere" },
        null,
      ]) {
        const outcome = requestPrompt(request({ choices: group() }));
        settlePrompt(headId()!, decision as unknown as PromptDecision);
        await expect(outcome).resolves.toStrictEqual(CANCELLED);
      }

      const controller = new AbortController();
      const aborted = requestPrompt(request({ choices: group() }), {
        signal: controller.signal,
      });
      controller.abort();
      await expect(aborted).resolves.toStrictEqual(CANCELLED);

      const closing = requestPrompt(request({ choices: group() }));
      cancelAllPrompts();
      await expect(closing).resolves.toStrictEqual(CANCELLED);
    });

    it("adds no key to a request or a decision that has no group", async () => {
      void requestPrompt(request({ remember: { label: "Don't ask again" } }));
      expect("choices" in getPromptSnapshot()[0].request).toBe(false);
      const decisions: PromptDecision[] = [];
      const ask = () => {
        const outcome = requestPrompt(request());
        void outcome.then((decision) => decisions.push(decision));
        return outcome;
      };
      settlePrompt(headId()!, {
        confirmed: true,
        remember: true,
        choice: "ask",
      });
      const confirmed = ask();
      settlePrompt(headId()!, {
        confirmed: true,
        remember: false,
        choice: "everywhere",
      });
      await expect(confirmed).resolves.toStrictEqual(CONFIRMED);
      const cancelled = ask();
      settlePrompt(headId()!, {
        confirmed: false,
        remember: false,
        choice: "everywhere",
      });
      await expect(cancelled).resolves.toStrictEqual(CANCELLED);
      for (const decision of decisions)
        expect(Object.keys(decision)).toEqual(["confirmed", "remember"]);
    });
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
