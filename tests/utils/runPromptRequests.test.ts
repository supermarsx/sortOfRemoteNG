import { describe, expect, it } from "vitest";
import {
  PROMPT_CANCEL_LABEL,
  PROMPT_HIDDEN_CHARACTERS_NOTICE,
  PROMPT_LIMITS,
  RUN_TRUST_CHOICE,
  RUN_TRUST_LIST_FULL_NOTICE,
  RUN_TRUST_NOT_SAVED_NOTICE,
  bulkCommandRunPrompt,
  bulkTrustedSendNotice,
  bulkScriptDeletePrompt,
  bulkScriptTrashEmptyPrompt,
  countTextLines,
  excerptPreview,
  fileTransferPrompt,
  previewOmittedNotice,
  promptQueueAnnouncement,
  promptQueueLabel,
  remoteDeletePrompt,
  revealHiddenCharacters,
  shortenPath,
  sshMacroReplayPrompt,
  sshScriptRunPrompt,
  targetsOmittedNotice,
  terminalPastePrompt,
  toSingleLine,
  type RunTrustOffer,
} from "../../src/utils/prompts/runPromptRequests";

const session = { name: "web-01", hostname: "10.0.0.1" };
const count = (value: number) => value.toLocaleString();

describe("run prompt wording", () => {
  describe("sshScriptRunPrompt", () => {
    const command = "df -h\n  uptime\t# keep\r\necho done\n";

    it("names the script and the session and previews the passed command unchanged", () => {
      const prompt = sshScriptRunPrompt({
        script: { name: "Disk usage", language: "bash" },
        command,
        session,
      });
      expect(prompt.title).toBe('Run "Disk usage" on web-01?');
      expect(prompt.message).toBe(
        "This runs the commands below in this SSH session.",
      );
      expect(prompt.preview).toEqual({
        label: "Commands to run",
        text: command,
      });
      expect(prompt.preview?.text).toBe(command);
      expect(prompt.confirmLabel).toBe("Run script");
      expect(prompt.tone ?? "default").toBe("default");
      expect(prompt.defaultAction ?? "confirm").toBe("confirm");
      expect(prompt.facts).toEqual(["bash", "3 lines"]);
      expect(prompt.hint).toBe(
        "Settings, Macros: Confirm before running SSH scripts",
      );
      expect(prompt.targets).toEqual({
        label: "Session",
        items: [{ id: "session", name: "web-01", detail: "10.0.0.1" }],
      });
      expect(prompt.dedupeKey).toBeUndefined();
    });

    it("offers the checkbox only when the call site asks for it", () => {
      const base = { script: { name: "Disk usage" }, command: "df", session };
      expect(sshScriptRunPrompt(base).remember).toBeUndefined();
      expect(
        sshScriptRunPrompt({ ...base, offerRemember: false }).remember,
      ).toBeUndefined();
      expect(
        sshScriptRunPrompt({ ...base, offerRemember: true }).remember,
      ).toEqual({
        label: "Don't ask again for this script in this session",
        hint: "You are asked again if the script changes or the session ends.",
      });
    });

    it("uses the singular for one line and falls back to the host name", () => {
      const prompt = sshScriptRunPrompt({
        script: { name: "Uptime" },
        command: "uptime",
        session: { name: "", hostname: "10.0.0.1" },
      });
      expect(prompt.title).toBe('Run "Uptime" on 10.0.0.1?');
      expect(prompt.facts).toEqual(["1 line"]);
    });
  });

  describe("sshMacroReplayPrompt", () => {
    const steps = [
      { command: "sudo -i", delayMs: 500, sendNewline: true },
      { command: "tail -f /var/log/syslog", delayMs: 0, sendNewline: true },
      { command: "q", delayMs: 250, sendNewline: false },
    ];

    it("lists one numbered line per step with its pause and its Enter", () => {
      const prompt = sshMacroReplayPrompt({
        macro: { name: "Follow log", steps },
        session,
      });
      expect(prompt.title).toBe('Replay "Follow log" on web-01?');
      expect(prompt.message).toBe("This types 3 steps into this SSH session.");
      expect(prompt.preview).toEqual({
        label: "Steps",
        text: [
          "1. sudo -i  [then wait 500 ms]",
          "2. tail -f /var/log/syslog",
          "3. q  [no Enter]",
        ].join("\n"),
      });
      expect(prompt.confirmLabel).toBe("Replay macro");
      expect(prompt.tone ?? "default").toBe("default");
      expect(prompt.defaultAction ?? "confirm").toBe("confirm");
      expect(prompt.facts).toEqual(["3 steps"]);
      expect(prompt.hint).toBe("Settings, Macros: Confirm before replay");
      expect(prompt.remember).toBeUndefined();
    });

    it("uses the singular for one step and offers the checkbox on request", () => {
      const prompt = sshMacroReplayPrompt({
        macro: { name: "Top", steps: [steps[1]] },
        session,
        offerRemember: true,
      });
      expect(prompt.message).toBe("This types 1 step into this SSH session.");
      expect(prompt.facts).toEqual(["1 step"]);
      expect(prompt.remember).toEqual({
        label: "Don't ask again for this macro in this session",
        hint: "You are asked again if the macro changes or the session ends.",
      });
    });

    it("keeps a step that spans lines under its own number", () => {
      const prompt = sshMacroReplayPrompt({
        macro: {
          name: "Heredoc",
          steps: [
            {
              command: "cat <<EOF\n2. fake\nEOF",
              delayMs: 0,
              sendNewline: true,
            },
            { command: "exit", delayMs: 0, sendNewline: true },
          ],
        },
        session,
      });
      expect(prompt.preview?.text).toBe(
        ["1. cat <<EOF", "   2. fake", "   EOF", "2. exit"].join("\n"),
      );
    });
  });

  describe("terminalPastePrompt", () => {
    const text = "cd /srv\nrm -rf cache\n";

    it("warns about several lines", () => {
      const prompt = terminalPastePrompt({ text, session, multiLine: true });
      expect(prompt.title).toBe("Paste into web-01?");
      expect(prompt.message).toBe(
        "The text contains multiple lines. It may run commands as soon as it is pasted.",
      );
      expect(prompt.preview).toEqual({ label: "Text to paste", text });
      expect(prompt.confirmLabel).toBe("Paste");
      expect(prompt.tone).toBe("warning");
      expect(prompt.defaultAction ?? "confirm").toBe("confirm");
      expect(prompt.hint).toBe(
        "Settings, Behavior: Warn before pasting multi-line text",
      );
      expect(prompt.facts).toEqual([
        "2 lines",
        `${count(text.length)} characters`,
      ]);
      expect(prompt.remember).toBeUndefined();
    });

    it("warns about several lines and the length limit together", () => {
      const long = `${"x".repeat(1_500)}\ny`;
      const prompt = terminalPastePrompt({
        text: long,
        session,
        multiLine: true,
        lengthLimit: 1_000,
      });
      expect(prompt.message).toBe(
        `The text contains multiple lines and ${count(1_502)} characters, over the limit of ${count(1_000)}. It may run commands as soon as it is pasted.`,
      );
      expect(prompt.preview?.text).toBe(long);
    });

    it("warns about the length limit alone", () => {
      const long = "x".repeat(1_500);
      const prompt = terminalPastePrompt({
        text: long,
        session,
        multiLine: false,
        lengthLimit: 1_000,
      });
      expect(prompt.message).toBe(
        `The text contains ${count(1_500)} characters, over the limit of ${count(1_000)}. It may run commands as soon as it is pasted.`,
      );
      expect(prompt.facts).toEqual(["1 line", `${count(1_500)} characters`]);
    });

    it("counts a carriage return as a line end, as a terminal does", () => {
      const prompt = terminalPastePrompt({
        text: "a\rb\r\nc",
        session,
        multiLine: true,
      });
      expect(prompt.facts?.[0]).toBe("3 lines");
    });
  });

  describe("bulkCommandRunPrompt", () => {
    const sessions = [
      { id: "s1", name: "web-01", hostname: "10.0.0.1" },
      { id: "s2", name: "db-01", hostname: "10.0.0.2" },
    ];

    it("asks to send a standard command and lists every session", () => {
      const prompt = bulkCommandRunPrompt({
        command: "uptime",
        sessions,
        destructive: false,
        policy: "always",
      });
      expect(prompt.title).toBe("Send this command to 2 SSH sessions?");
      expect(prompt.message).toBeUndefined();
      expect(prompt.preview).toEqual({ label: "Command", text: "uptime" });
      expect(prompt.confirmLabel).toBe("Send to 2 sessions");
      expect(prompt.tone ?? "default").toBe("default");
      expect(prompt.defaultAction ?? "confirm").toBe("confirm");
      expect(prompt.targets).toEqual({
        label: "Runs on",
        items: [
          { id: "s1", name: "web-01", detail: "10.0.0.1" },
          { id: "s2", name: "db-01", detail: "10.0.0.2" },
        ],
      });
      expect(prompt.hint).toBe("Script library, Confirm run: Always");
      expect(prompt.remember).toBeUndefined();
    });

    it("marks a destructive command and puts the focus on Cancel", () => {
      const prompt = bulkCommandRunPrompt({
        command: "reboot",
        sessions,
        destructive: true,
        policy: "destructive-only",
        scriptName: "Restart fleet",
      });
      expect(prompt.title).toBe(
        "Send a destructive command to 2 SSH sessions?",
      );
      expect(prompt.message).toBe(
        "This command may make destructive changes on every selected session.",
      );
      expect(prompt.preview).toEqual({ label: "Command", text: "reboot" });
      expect(prompt.confirmLabel).toBe("Send to 2 sessions");
      expect(prompt.tone).toBe("danger");
      expect(prompt.defaultAction).toBe("cancel");
      expect(prompt.targets?.items).toHaveLength(2);
      expect(prompt.facts).toEqual(['Script "Restart fleet"']);
      expect(prompt.hint).toBe("Script library, Confirm run: Destructive");
    });

    it("uses the singular for one session and omits a host equal to the name", () => {
      const one = [{ id: "s1", name: "", hostname: "10.0.0.1" }];
      const standard = bulkCommandRunPrompt({
        command: "uptime",
        sessions: one,
        destructive: false,
      });
      expect(standard.title).toBe("Send this command to 1 SSH session?");
      expect(standard.confirmLabel).toBe("Send to 1 session");
      expect(standard.targets?.items).toEqual([{ id: "s1", name: "10.0.0.1" }]);
      expect(standard.hint).toBeUndefined();
      expect(standard.facts).toBeUndefined();

      const destructive = bulkCommandRunPrompt({
        command: "reboot",
        sessions: one,
        destructive: true,
      });
      expect(destructive.title).toBe(
        "Send a destructive command to 1 SSH session?",
      );
      expect(destructive.message).toBe(
        "This command may make destructive changes on the selected session.",
      );
    });
  });

  describe("bulkScriptDeletePrompt", () => {
    it("asks before moving a script to the trash", () => {
      const prompt = bulkScriptDeletePrompt({
        name: "Disk usage",
        permanent: false,
      });
      expect(prompt.title).toBe('Move "Disk usage" to trash?');
      expect(prompt.message).toBe("You can restore it from the trash.");
      expect(prompt.confirmLabel).toBe("Move to trash");
      expect(prompt.tone ?? "default").toBe("default");
      expect(prompt.defaultAction ?? "confirm").toBe("confirm");
      expect(prompt.preview).toBeUndefined();
    });

    it("marks a permanent delete and puts the focus on Cancel", () => {
      const prompt = bulkScriptDeletePrompt({
        name: "Disk usage",
        permanent: true,
      });
      expect(prompt.title).toBe('Permanently delete "Disk usage"?');
      expect(prompt.message).toBe("This cannot be undone.");
      expect(prompt.confirmLabel).toBe("Delete permanently");
      expect(prompt.tone).toBe("danger");
      expect(prompt.defaultAction).toBe("cancel");
      expect(prompt.preview).toBeUndefined();
    });
  });

  describe("bulkScriptTrashEmptyPrompt", () => {
    it("counts the scripts, singular and plural", () => {
      const many = bulkScriptTrashEmptyPrompt({ count: 3 });
      expect(many.title).toBe("Permanently delete 3 trashed scripts?");
      expect(many.message).toBe("This cannot be undone.");
      expect(many.confirmLabel).toBe("Empty trash");
      expect(many.tone).toBe("danger");
      expect(many.defaultAction).toBe("cancel");
      expect(many.preview).toBeUndefined();
      expect(bulkScriptTrashEmptyPrompt({ count: 1 }).title).toBe(
        "Permanently delete 1 trashed script?",
      );
    });
  });

  describe("fileTransferPrompt", () => {
    it("states the number of files, the size and the session", () => {
      const many = fileTransferPrompt({ count: 3, size: "4.2 MB", session });
      expect(many.title).toBe("Send 3 files to web-01?");
      expect(many.message).toBe("4.2 MB will be copied to the remote session.");
      expect(many.confirmLabel).toBe("Send files");
      expect(many.tone ?? "default").toBe("default");
      expect(many.defaultAction ?? "confirm").toBe("confirm");
      expect(many.preview).toBeUndefined();

      const one = fileTransferPrompt({ count: 1, size: "12 KB", session });
      expect(one.title).toBe("Send 1 file to web-01?");
      expect(one.confirmLabel).toBe("Send file");
    });

    // A session known by its name alone: these requests are exactly what they
    // were before the host row existed (see "the session's host" below).
    const named = { name: "web-01" };

    it("is exactly what it was when no folders are given", () => {
      const expected = {
        title: "Send 3 files to web-01?",
        message: "4.2 MB will be copied to the remote session.",
        confirmLabel: "Send files",
      };
      for (const folders of [undefined, 0, -1, Number.NaN])
        expect(
          fileTransferPrompt({
            count: 3,
            size: "4.2 MB",
            session: named,
            folders,
          }),
        ).toEqual(expected);
      expect(
        fileTransferPrompt({ count: 0, size: "0 B", session: named }),
      ).toEqual({
        title: "Send 0 files to web-01?",
        message: "0 B will be copied to the remote session.",
        confirmLabel: "Send files",
      });
    });

    it("counts the folders the files are in", () => {
      expect(
        fileTransferPrompt({
          count: 3,
          size: "4.2 MB",
          session: named,
          folders: 2,
        }),
      ).toEqual({
        title: "Send 3 files in 2 folders to web-01?",
        message: "4.2 MB will be copied to the remote session.",
        confirmLabel: "Send files",
      });
      expect(
        fileTransferPrompt({
          count: 1,
          size: "12 KB",
          session: named,
          folders: 1,
        }),
      ).toEqual({
        title: "Send 1 file in 1 folder to web-01?",
        message: "12 KB will be copied to the remote session.",
        confirmLabel: "Send file",
      });
    });

    it("asks about empty folders without a file count or a size", () => {
      expect(
        fileTransferPrompt({
          count: 0,
          size: "0 B",
          session: named,
          folders: 2,
        }),
      ).toEqual({
        title: "Send 2 empty folders to web-01?",
        message:
          "Only the folders are created in the remote session; no files are copied.",
        confirmLabel: "Send folders",
      });
      expect(
        fileTransferPrompt({
          count: 0,
          size: "0 B",
          session: named,
          folders: 1,
        }),
      ).toEqual({
        title: "Send 1 empty folder to web-01?",
        message:
          "Only the folder is created in the remote session; no files are copied.",
        confirmLabel: "Send folder",
      });
    });
  });

  describe("remoteDeletePrompt", () => {
    it("asks before deleting a file", () => {
      const prompt = remoteDeletePrompt({ name: "notes.txt" });
      expect(prompt.title).toBe('Permanently delete "notes.txt"?');
      expect(prompt.message).toBe("This cannot be undone.");
      expect(prompt.confirmLabel).toBe("Delete");
      expect(prompt.tone).toBe("danger");
      expect(prompt.defaultAction).toBe("cancel");
      expect(prompt.preview).toBeUndefined();
    });

    it("says that a folder goes with everything inside it", () => {
      expect(remoteDeletePrompt({ name: "logs", isFolder: true }).message).toBe(
        "This cannot be undone. Everything inside it is deleted too.",
      );
    });

    it("is exactly what it was when no path is given", () => {
      const file = {
        title: 'Permanently delete "notes.txt"?',
        message: "This cannot be undone.",
        confirmLabel: "Delete",
        tone: "danger",
        defaultAction: "cancel",
      };
      expect(remoteDeletePrompt({ name: "notes.txt" })).toEqual(file);
      expect(remoteDeletePrompt({ name: "notes.txt", path: "" })).toEqual(file);
      expect(
        remoteDeletePrompt({ name: "notes.txt", path: undefined }),
      ).toEqual(file);
      expect(remoteDeletePrompt({ name: "logs", isFolder: true })).toEqual({
        ...file,
        title: 'Permanently delete "logs"?',
        message: "This cannot be undone. Everything inside it is deleted too.",
      });
    });

    it("shows the path of the entry under its name, unchanged", () => {
      const path = "/srv/www/site one/notes.txt";
      const prompt = remoteDeletePrompt({ name: "notes.txt", path });
      expect(prompt.preview).toEqual({ label: "Path", text: path });
      expect(prompt.title).toBe('Permanently delete "notes.txt"?');
      expect(prompt.tone).toBe("danger");
      expect(prompt.defaultAction).toBe("cancel");
      expect(
        remoteDeletePrompt({ name: "logs", isFolder: true, path: "/var/logs/" })
          .preview,
      ).toEqual({ label: "Path", text: "/var/logs/" });
    });

    it("hands hidden characters in a path to the preview, which marks them", () => {
      const path = "/srv/\u{202E}gnp.exe\r/x";
      expect(remoteDeletePrompt({ name: "x", path }).preview?.text).toBe(path);
    });

    it("leaves out the middle of a long path and never its final segment", () => {
      const middle = Array.from({ length: 300 }, (_, i) => `dir${i}`).join("/");
      const path = `/srv/data/${middle}/2024/final segment.tar.gz`;
      const prompt = remoteDeletePrompt({ name: "final segment.tar.gz", path });
      const text = prompt.preview!.text;
      expect(text.length).toBeLessThanOrEqual(PROMPT_LIMITS.path);
      expect(text.startsWith("/srv/data/dir0/")).toBe(true);
      expect(text.endsWith("/2024/final segment.tar.gz")).toBe(true);
      // Cut at folder boundaries: "…/" stands for the folders left out.
      const [head, tail] = text.split("…");
      expect(head.endsWith("/")).toBe(true);
      expect(tail.startsWith("/")).toBe(true);
      expect(path.startsWith(head)).toBe(true);
      expect(path.endsWith(tail)).toBe(true);
      const omitted = path.length - head.length - tail.length;
      expect(omitted).toBeGreaterThan(0);
      expect(prompt.preview!.label).toBe(
        `Path (${count(omitted)} characters in the middle are not shown)`,
      );
    });
  });

  describe("shortenPath", () => {
    const limit = 60;

    it("returns a path within the limit untouched", () => {
      expect(shortenPath("/a/b/c.txt", limit)).toEqual({
        text: "/a/b/c.txt",
        omitted: 0,
      });
      const exact = `/${"x".repeat(limit - 1)}`;
      expect(shortenPath(exact, limit)).toEqual({ text: exact, omitted: 0 });
    });

    it.each([
      ["a file", "/final.log"],
      ["a folder with its trailing separator", "/final/"],
      ["a Windows path", "\\final.log"],
    ])("keeps the start and the final segment of %s", (_kind, last) => {
      const separator = last[0];
      const path = `${separator}root${`${separator}middle`.repeat(40)}${last}`;
      const { text, omitted } = shortenPath(path, limit);
      expect(text.length).toBeLessThanOrEqual(limit);
      const [head, tail] = text.split("…");
      expect(head.startsWith(`${separator}root${separator}`)).toBe(true);
      expect(head.endsWith(separator)).toBe(true);
      // The folders nearest the entry come with it while they fit in half the limit.
      const nearest = Math.floor((limit / 2 - last.length) / "/middle".length);
      expect(nearest).toBeGreaterThan(1);
      expect(tail).toBe(`${`${separator}middle`.repeat(nearest)}${last}`);
      expect(path.startsWith(head) && path.endsWith(tail)).toBe(true);
      expect(omitted).toBe(path.length - head.length - tail.length);
    });

    it("keeps a final segment that is longer than the limit whole", () => {
      const last = `/${"n".repeat(200)}.bin`;
      const path = `/srv/backups/2024/daily${last}`;
      const { text, omitted } = shortenPath(path, limit);
      expect(text.endsWith(last)).toBe(true);
      expect(text.startsWith("/srv/")).toBe(true);
      expect(omitted).toBe(path.length - (text.length - 1));
      // Nothing to leave out when the long segment is all there is.
      const only = `/${"n".repeat(200)}`;
      expect(shortenPath(only, limit)).toEqual({ text: only, omitted: 0 });
      expect(shortenPath("n".repeat(200), limit).omitted).toBe(0);
    });

    it("never cuts a character in half", () => {
      const face = "\u{1F600}";
      const path = `/${face.repeat(40)}/${"m".repeat(80)}/end`;
      for (const cap of [58, 59, 60, 61]) {
        const [head, tail] = shortenPath(path, cap).text.split("…");
        expect(tail).toBe("/end");
        expect(head.length).toBeGreaterThan(40);
        expect(head).toBe(`/${face.repeat((head.length - 1) / 2)}`);
      }
    });
  });

  describe("the session's host", () => {
    const both = { name: "Production web", hostname: "10.0.0.5" };
    const macro = {
      name: "m",
      steps: [{ command: "q", delayMs: 0, sendNewline: true }],
    };
    // Every single-session builder, for one session.
    const requestsFor = (where: { name?: string; hostname?: string }) => ({
      script: sshScriptRunPrompt({
        script: { name: "s" },
        command: "id",
        session: where,
      }),
      macro: sshMacroReplayPrompt({ macro, session: where }),
      paste: terminalPastePrompt({
        text: "a\nb",
        session: where,
        multiLine: true,
      }),
      transfer: fileTransferPrompt({ count: 2, size: "1 KB", session: where }),
      emptyFolders: fileTransferPrompt({
        count: 0,
        size: "0 B",
        session: where,
        folders: 1,
      }),
    });

    it("is shown beside the name, in the body, by every builder that knows both", () => {
      const row = {
        label: "Session",
        items: [{ id: "session", name: "Production web", detail: "10.0.0.5" }],
      };
      for (const [builder, request] of Object.entries(requestsFor(both)))
        expect([builder, request.targets]).toEqual([builder, row]);
      expect(remoteDeletePrompt({ name: "f", session: both }).targets).toEqual(
        row,
      );
    });

    it("changes no title and nothing else of the request", () => {
      const withHost = requestsFor(both);
      const nameOnly = requestsFor({ name: "Production web" });
      expect(withHost.script.title).toBe('Run "s" on Production web?');
      expect(withHost.macro.title).toBe('Replay "m" on Production web?');
      expect(withHost.paste.title).toBe("Paste into Production web?");
      expect(withHost.transfer.title).toBe("Send 2 files to Production web?");
      for (const builder of Object.keys(withHost) as Array<
        keyof typeof withHost
      >) {
        const { targets, ...rest } = withHost[builder];
        expect(targets).toBeDefined();
        expect([builder, rest]).toEqual([builder, nameOnly[builder]]);
      }
    });

    it.each([
      ["only a name", { name: "web-01" }],
      ["only a host", { hostname: "10.0.0.5" }],
      ["an empty host", { name: "web-01", hostname: "" }],
      ["a host that is the name", { name: "10.0.0.5", hostname: "10.0.0.5" }],
      [
        "a host that reads as the name",
        { name: " web-01 ", hostname: "web-01" },
      ],
      ["nothing", {}],
    ])("adds nothing for a session with %s", (_what, where) => {
      for (const [builder, request] of Object.entries(requestsFor(where)))
        expect([builder, request.targets]).toEqual([builder, undefined]);
    });

    it("says where a remote delete happens with whatever is known, and nothing when nothing is", () => {
      const where = (session: { name?: string; hostname?: string }) =>
        remoteDeletePrompt({ name: "f", session }).targets;
      expect(where({ name: "Files" })).toEqual({
        label: "Session",
        items: [{ id: "session", name: "Files" }],
      });
      expect(where({ hostname: "10.0.0.5" })).toEqual({
        label: "Session",
        items: [{ id: "session", name: "10.0.0.5" }],
      });
      expect(where({ name: "10.0.0.5", hostname: "10.0.0.5" })).toEqual({
        label: "Session",
        items: [{ id: "session", name: "10.0.0.5" }],
      });
      expect(where({})).toBeUndefined();
      // The title never names the session, with or without the field.
      expect(remoteDeletePrompt({ name: "f", session: both }).title).toBe(
        'Permanently delete "f"?',
      );
      const { targets, ...rest } = remoteDeletePrompt({
        name: "f",
        isFolder: true,
        path: "/srv/f/",
        session: both,
      });
      expect(targets).toBeDefined();
      expect(rest).toEqual(
        remoteDeletePrompt({ name: "f", isFolder: true, path: "/srv/f/" }),
      );
    });

    it("marks hidden characters in a host, so two hosts cannot look the same", () => {
      const hidden = String.fromCodePoint(0x200b);
      const override = String.fromCodePoint(0x202e);
      const host = `evil${hidden}.example${override}moc.\r`;
      const shown = "evil⟨U+200B⟩.example⟨U+202E⟩moc.␍\n";
      expect(
        sshScriptRunPrompt({
          script: { name: "s" },
          command: "id",
          session: { name: "web", hostname: host },
        }).targets?.items[0],
      ).toEqual({ id: "session", name: "web", detail: shown });
      expect(
        bulkCommandRunPrompt({
          command: "id",
          sessions: [{ id: "s1", name: "web", hostname: host }],
          destructive: false,
        }).targets?.items[0],
      ).toEqual({ id: "s1", name: "web", detail: shown });
      // An ordinary host is passed on as it is.
      expect(
        bulkCommandRunPrompt({
          command: "id",
          sessions: [{ id: "s1", name: "web", hostname: "10.0.0.5" }],
          destructive: false,
        }).targets?.items[0],
      ).toEqual({ id: "s1", name: "web", detail: "10.0.0.5" });
    });
  });

  describe("destructive requests", () => {
    const sessions = [{ id: "s1", name: "web-01", hostname: "10.0.0.1" }];
    const macro = {
      name: "m",
      steps: [{ command: "q", delayMs: 0, sendNewline: true }],
    };
    const every = {
      script: sshScriptRunPrompt({
        script: { name: "s" },
        command: "id",
        session,
      }),
      macro: sshMacroReplayPrompt({ macro, session }),
      paste: terminalPastePrompt({ text: "a\nb", session, multiLine: true }),
      bulkStandard: bulkCommandRunPrompt({
        command: "uptime",
        sessions,
        destructive: false,
      }),
      bulkDestructive: bulkCommandRunPrompt({
        command: "reboot",
        sessions,
        destructive: true,
      }),
      scriptToTrash: bulkScriptDeletePrompt({ name: "s", permanent: false }),
      scriptDelete: bulkScriptDeletePrompt({ name: "s", permanent: true }),
      trashEmpty: bulkScriptTrashEmptyPrompt({ count: 2 }),
      transfer: fileTransferPrompt({ count: 2, size: "1 KB", session }),
      transferFolders: fileTransferPrompt({
        count: 0,
        size: "0 B",
        session,
        folders: 1,
      }),
      remoteFile: remoteDeletePrompt({ name: "f" }),
      remoteFolder: remoteDeletePrompt({
        name: "d",
        isFolder: true,
        path: "/srv/d/",
      }),
    };

    it("are the five that delete for good or send a destructive command", () => {
      const danger = Object.entries(every)
        .filter(([, request]) => request.tone === "danger")
        .map(([name]) => name);
      expect(danger).toEqual([
        "bulkDestructive",
        "scriptDelete",
        "trashEmpty",
        "remoteFile",
        "remoteFolder",
      ]);
    });

    it("say themselves that they open on Cancel, and no other request does", () => {
      for (const [name, request] of Object.entries(every))
        expect([name, request.defaultAction]).toEqual([
          name,
          request.tone === "danger" ? "cancel" : undefined,
        ]);
    });
  });

  describe("untrusted names", () => {
    it("are kept on one line, without control or direction characters, and bounded", () => {
      const hostile = `evil\u{202E}gnp.exe\r\nline two\u0007${"x".repeat(500)}`;
      const prompt = sshScriptRunPrompt({
        script: { name: hostile },
        command: "id",
        session: { name: hostile, hostname: "h" },
      });
      const controls = Array.from(prompt.title).filter((character) => {
        const code = character.codePointAt(0)!;
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
      });
      expect(controls).toEqual([]);
      expect(prompt.title).not.toMatch(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u);
      expect(prompt.title.length).toBeLessThan(260);
      expect(prompt.title.startsWith('Run "evil')).toBe(true);
      expect(prompt.title).toContain("…");
      expect(prompt.title.endsWith("?")).toBe(true);
    });

    it("never reach the preview, which stays the exact payload", () => {
      const payload = "echo \u{202E}\u0007 \r\n";
      expect(
        sshScriptRunPrompt({
          script: { name: "x" },
          command: payload,
          session,
        }).preview?.text,
      ).toBe(payload);
      expect(
        terminalPastePrompt({ text: payload, session, multiLine: true }).preview
          ?.text,
      ).toBe(payload);
      expect(
        bulkCommandRunPrompt({
          command: payload,
          sessions: [{ id: "s1", name: "a" }],
          destructive: false,
        }).preview?.text,
      ).toBe(payload);
    });

    it("fall back to a neutral name when a session has none", () => {
      expect(
        terminalPastePrompt({ text: "a\nb", session: {}, multiLine: true })
          .title,
      ).toBe("Paste into this session?");
    });
  });

  describe("shared dialog wording", () => {
    it("has the Cancel default and the queue position", () => {
      expect(PROMPT_CANCEL_LABEL).toBe("Cancel");
      expect(promptQueueLabel(1, 2)).toBe("1 of 2");
      expect(promptQueueLabel(1, 12)).toBe("1 of 12");
      expect(promptQueueAnnouncement(1, 3)).toBe("Prompt 1 of 3");
    });

    it("says how much of a long preview is not shown", () => {
      expect(previewOmittedNotice({ lines: 12, characters: 3_456 })).toBe(
        `and 12 more lines (${count(3_456)} characters) are not shown`,
      );
      expect(previewOmittedNotice({ lines: 1, characters: 40 })).toBe(
        "and 1 more line (40 characters) is not shown",
      );
      expect(previewOmittedNotice({ lines: 0, characters: 3_456 })).toBe(
        `${count(3_456)} more characters are not shown`,
      );
      expect(previewOmittedNotice({ lines: 0, characters: 1 })).toBe(
        "1 more character is not shown",
      );
    });

    it("says how many targets are not listed", () => {
      expect(targetsOmittedNotice(12)).toBe("and 12 more");
    });

    it("explains the symbols that stand for hidden characters", () => {
      expect(PROMPT_HIDDEN_CHARACTERS_NOTICE).toBe(
        "Hidden control characters are shown as symbols.",
      );
    });
  });
});

describe("what the dialog may show of untrusted text", () => {
  it("has the limits the plan sets", () => {
    expect(PROMPT_LIMITS.previewCharacters).toBe(20_000);
    expect(PROMPT_LIMITS.previewLines).toBe(1_000);
    expect(PROMPT_LIMITS.targets).toBe(500);
  });

  describe("countTextLines", () => {
    it.each([
      ["", 0],
      ["one", 1],
      ["one\n", 1],
      ["one\ntwo", 2],
      ["one\r\ntwo\r\n", 2],
      ["one\rtwo\rthree", 3],
      ["\n\n", 2],
      ["a\r\n\rb", 3],
    ])("counts %j as %i", (text, expected) => {
      expect(countTextLines(text)).toBe(expected);
    });
  });

  describe("excerptPreview", () => {
    it("returns short text untouched", () => {
      const text = "df -h\nuptime\n";
      expect(excerptPreview(text)).toEqual({
        text,
        omittedLines: 0,
        omittedCharacters: 0,
      });
      expect(excerptPreview("")).toEqual({
        text: "",
        omittedLines: 0,
        omittedCharacters: 0,
      });
    });

    it("keeps exactly the character limit and counts the rest", () => {
      const exact = "x".repeat(20_000);
      expect(excerptPreview(exact).omittedCharacters).toBe(0);
      const over = `${exact}yz`;
      expect(excerptPreview(over)).toEqual({
        text: exact,
        omittedLines: 0,
        omittedCharacters: 2,
      });
    });

    it("cuts at the line limit, before the line break", () => {
      const lines = Array.from({ length: 1_003 }, (_, index) => `l${index}`);
      const excerpt = excerptPreview(lines.join("\r\n"));
      expect(excerpt.text).toBe(lines.slice(0, 1_000).join("\r\n"));
      expect(excerpt.omittedLines).toBe(3);
      expect(excerpt.omittedCharacters).toBe(
        lines.join("\r\n").length - excerpt.text.length,
      );
    });

    it("counts the lines after a cut in the middle of a line", () => {
      const text = `${"x".repeat(20_010)}\nsecond\nthird`;
      expect(excerptPreview(text)).toEqual({
        text: "x".repeat(20_000),
        omittedLines: 2,
        omittedCharacters: text.length - 20_000,
      });
    });

    it("never cuts a character in half", () => {
      const text = `${"x".repeat(19_999)}\u{1F600}tail`;
      const excerpt = excerptPreview(text);
      expect(excerpt.text).toBe("x".repeat(19_999));
      expect(excerpt.omittedCharacters).toBe(text.length - 19_999);
    });

    it("stays quick on a 40 MB payload", () => {
      // Work that grew with the square of the length would not finish in time.
      const huge = "0123456789abcdef".repeat(2_500_000);
      const started = Date.now();
      const excerpt = excerptPreview(huge);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(excerpt.text.length).toBe(20_000);
      expect(excerpt.omittedCharacters).toBe(huge.length - 20_000);
      expect(excerpt.omittedLines).toBe(0);
    });
  });

  describe("revealHiddenCharacters", () => {
    it("leaves ordinary text, tabs and line breaks alone", () => {
      const text = "café 日本語\n\tindented \u{1F600}";
      expect(revealHiddenCharacters(text)).toBe(text);
    });

    it("shows a Windows line end as one line break", () => {
      expect(revealHiddenCharacters("a\r\nb\r\n")).toBe("a\nb\n");
    });

    it("shows a lone carriage return, which a terminal takes as Enter", () => {
      expect(revealHiddenCharacters("echo ok\rrm -rf /")).toBe(
        "echo ok␍\nrm -rf /",
      );
    });

    it("shows control characters as their control pictures", () => {
      expect(revealHiddenCharacters("\u0000\u0007\u0008\u001B\u007F")).toBe(
        "␀␇␈␛␡",
      );
    });

    it("shows direction overrides and other invisible characters by code point", () => {
      expect(
        revealHiddenCharacters(
          "a\u{202E}b\u{200B}c\u{2066}d\u{FEFF}e\u0085f\u{2028}g",
        ),
      ).toBe("a⟨U+202E⟩b⟨U+200B⟩c⟨U+2066⟩d⟨U+FEFF⟩e⟨U+0085⟩f⟨U+2028⟩g");
    });
  });

  // Written as numbers so that no invisible character sits in this file.
  const INVISIBLE: Array<[number, string]> = [
    [0x00ad, "soft hyphen"],
    [0x0600, "Arabic number sign (format)"],
    [0x061c, "Arabic letter mark"],
    [0x06dd, "Arabic end of ayah (format)"],
    [0x070f, "Syriac abbreviation mark (format)"],
    [0x115f, "Hangul choseong filler"],
    [0x1160, "Hangul jungseong filler"],
    [0x180e, "Mongolian vowel separator"],
    [0x200b, "zero width space"],
    [0x200c, "zero width non-joiner"],
    [0x200d, "zero width joiner"],
    [0x200e, "left-to-right mark"],
    [0x200f, "right-to-left mark"],
    [0x2028, "line separator"],
    [0x2029, "paragraph separator"],
    [0x202a, "left-to-right embedding"],
    [0x202b, "right-to-left embedding"],
    [0x202c, "pop directional formatting"],
    [0x202d, "left-to-right override"],
    [0x202e, "right-to-left override"],
    [0x2060, "word joiner"],
    [0x2061, "function application"],
    [0x2064, "invisible plus"],
    [0x2066, "left-to-right isolate"],
    [0x2067, "right-to-left isolate"],
    [0x2068, "first strong isolate"],
    [0x2069, "pop directional isolate"],
    [0x206a, "inhibit symmetric swapping"],
    [0x206f, "nominal digit shapes"],
    [0x3164, "Hangul filler"],
    [0xfe00, "variation selector 1"],
    [0xfe0d, "variation selector 14"],
    [0xfe0e, "text presentation selector"],
    [0xfe0f, "emoji presentation selector"],
    [0xfeff, "byte order mark"],
    [0xffa0, "halfwidth Hangul filler"],
    [0xfff9, "interlinear annotation anchor"],
    [0xfffa, "interlinear annotation separator"],
    [0xfffb, "interlinear annotation terminator"],
    [0x110bd, "Kaithi number sign (format)"],
    [0x1d173, "musical begin beam (format)"],
    [0xe0000, "start of the tag block"],
    [0xe0001, "language tag"],
    [0xe0020, "tag space"],
    [0xe007f, "cancel tag"],
    [0xe0100, "variation selector 17"],
    [0xe01ef, "variation selector 256"],
    [0xe0fff, "end of the tag block"],
  ];

  describe("characters that draw nothing", () => {
    const hex = (code: number) =>
      code.toString(16).toUpperCase().padStart(4, "0");
    const label = (code: number) => `⟨U+${hex(code)}⟩`;

    it.each(INVISIBLE.map(([code, name]) => [hex(code), name, code] as const))(
      "U+%s (%s) is marked in a preview and dropped from a name",
      (_hex, _name, code) => {
        const hidden = String.fromCodePoint(code);
        expect(revealHiddenCharacters(`rm -rf a${hidden}b`)).toBe(
          `rm -rf a${label(code)}b`,
        );
        expect(revealHiddenCharacters(hidden.repeat(2))).toBe(
          label(code).repeat(2),
        );
        expect(toSingleLine(`a${hidden}b`, 80)).toBe("ab");
      },
    );

    it("writes the code point with at least four digits, more when it needs them", () => {
      expect(label(0xad)).toBe("⟨U+00AD⟩");
      expect(label(0xe0001)).toBe("⟨U+E0001⟩");
    });

    it.each(
      (
        [
          [0x2764, "heavy black heart"],
          [0x26a0, "warning sign"],
          [0x2714, "heavy check mark"],
          [0x2139, "information source"],
          [0x25b6, "play button"],
          [0x00a9, "copyright sign"],
          [0x1f170, "A button"],
          [0x1f5a5, "desktop computer"],
        ] as Array<[number, string]>
      ).map(([code, name]) => [hex(code), name, code] as const),
    )(
      "leaves the presentation selector of an emoji (U+%s, %s) alone",
      (_hex, _name, code) => {
        const base = String.fromCodePoint(code);
        for (const selector of [0xfe0e, 0xfe0f]) {
          const emoji = `${base}${String.fromCodePoint(selector)}`;
          expect(revealHiddenCharacters(`echo ${emoji} done`)).toBe(
            `echo ${emoji} done`,
          );
          expect(toSingleLine(`web ${emoji}`, 80)).toBe(`web ${emoji}`);
        }
        // Only the two presentation selectors, and only once.
        const odd = String.fromCodePoint(0xfe00);
        expect(revealHiddenCharacters(`${base}${odd}`)).toBe(
          `${base}${label(0xfe00)}`,
        );
        const twice = String.fromCodePoint(0xfe0f).repeat(2);
        expect(revealHiddenCharacters(`${base}${twice}`)).toBe(
          `${base}${String.fromCodePoint(0xfe0f)}${label(0xfe0f)}`,
        );
      },
    );

    it.each(["a", "1", "#", "*", "/", " ", ".", "é", "日"])(
      "marks a presentation selector that follows %j, where it can only hide",
      (base) => {
        const selector = String.fromCodePoint(0xfe0f);
        expect(revealHiddenCharacters(`${base}${selector}`)).toBe(
          `${base}${label(0xfe0f)}`,
        );
        expect(revealHiddenCharacters(selector)).toBe(label(0xfe0f));
        expect(toSingleLine(`x${base}${selector}y`, 80)).toBe(
          `x${base}y`.replace(/\s+/g, " "),
        );
      },
    );

    it("leaves visible text of every script and plain emoji alone", () => {
      const text = [
        "Ελληνικά Кириллица עברית العربية हिन्दी ไทย 한국어 日本語",
        `${String.fromCodePoint(0x1f600)} ${String.fromCodePoint(0x1f680)} ${String.fromCodePoint(0x2705)}`,
        "tabs\tand spaces  stay",
      ].join("\n");
      expect(revealHiddenCharacters(text)).toBe(text);
    });
  });

  describe("a line feed at the very end", () => {
    const whole = { markFinalLineFeed: true };

    it.each([
      ["ls -la\n", "ls -la␊"],
      ["ls -la\r\n", "ls -la␊"],
      ["a\n\n", "a\n␊"],
      ["\n", "␊"],
      ["cd /srv\nrm -rf cache\n", "cd /srv\nrm -rf cache␊"],
    ])(
      "of %j is shown, as it decides whether the last line runs",
      (text, shown) => {
        expect(revealHiddenCharacters(text, whole)).toBe(shown);
      },
    );

    it.each([
      ["ls -la", "ls -la"],
      ["", ""],
      ["a\nb", "a\nb"],
      // A lone carriage return is already shown; the break after it is ours.
      ["ls -la\r", "ls -la␍\n"],
    ])("is not invented for %j", (text, shown) => {
      expect(revealHiddenCharacters(text, whole)).toBe(shown);
    });

    it("is left as it is for a text that is only an excerpt", () => {
      expect(revealHiddenCharacters("ls -la\n")).toBe("ls -la\n");
      expect(
        revealHiddenCharacters("ls -la\n", { markFinalLineFeed: false }),
      ).toBe("ls -la\n");
    });
  });

  describe("toSingleLine", () => {
    it("leaves an ordinary name alone", () => {
      expect(toSingleLine("web-01 (prod)", 80)).toBe("web-01 (prod)");
    });

    it("joins lines, drops invisible characters and trims", () => {
      expect(toSingleLine("  web\r\n-01\t\u{202E}x\u0007y\u{200B}  ", 80)).toBe(
        "web -01 x y",
      );
    });

    it("cuts at the limit with an ellipsis, never inside a character", () => {
      expect(toSingleLine("x".repeat(100), 10)).toBe(`${"x".repeat(10)}…`);
      expect(toSingleLine("x".repeat(10), 10)).toBe("x".repeat(10));
      expect(toSingleLine(`${"x".repeat(9)}\u{1F600}z`, 10)).toBe(
        `${"x".repeat(9)}…`,
      );
    });

    it("copes with values that are not strings", () => {
      expect(toSingleLine(undefined as unknown as string, 10)).toBe("");
      expect(toSingleLine(42 as unknown as string, 10)).toBe("42");
    });
  });
});

describe("lasting choices (trusted scripts)", () => {
  const script = { name: "Disk usage", language: "bash" };
  const command = "df -h\nuptime";
  const macro = {
    name: "Follow log",
    steps: [
      { command: "sudo -i", delayMs: 500, sendNewline: true },
      { command: "q", delayMs: 0, sendNewline: false },
    ],
  };
  const sessions = [
    { id: "s1", name: "web-01", hostname: "10.0.0.1" },
    { id: "s2", name: "db-01", hostname: "10.0.0.2" },
  ];
  const ALL: RunTrustOffer = { connection: true, everywhere: true };
  const NONE: RunTrustOffer = { connection: false, everywhere: false };

  const SCRIPT_NOTE =
    "A lasting choice covers this exact script. You are asked again when it changes. Take it back in Settings, Macros, Trusted scripts.";
  const MACRO_NOTE =
    "A lasting choice covers this exact macro. You are asked again when it changes. Take it back in Settings, Macros, Trusted scripts.";
  const BULK_NOTE =
    "A lasting choice covers this exact script. You are asked again when it changes. Take it back in the script library or in Settings, Macros, Trusted scripts.";

  it("names the four answers", () => {
    expect(RUN_TRUST_CHOICE).toEqual({
      ask: "ask",
      session: "session",
      connection: "connection",
      everywhere: "everywhere",
    });
  });

  it("bounds the group the dialog shows", () => {
    expect(PROMPT_LIMITS.choices).toBe(6);
    expect(PROMPT_LIMITS.choiceLabel).toBe(120);
  });

  describe("without them, every request is exactly what it was", () => {
    it("for a script, with and without the checkbox", () => {
      const plain = {
        title: 'Run "Disk usage" on web-01?',
        message: "This runs the commands below in this SSH session.",
        confirmLabel: "Run script",
        targets: {
          label: "Session",
          items: [{ id: "session", name: "web-01", detail: "10.0.0.1" }],
        },
        preview: { label: "Commands to run", text: command },
        facts: ["bash", "2 lines"],
        hint: "Settings, Macros: Confirm before running SSH scripts",
      };
      const remember = {
        label: "Don't ask again for this script in this session",
        hint: "You are asked again if the script changes or the session ends.",
      };
      const base = { script, command, session };
      expect(sshScriptRunPrompt(base)).toStrictEqual(plain);
      expect(sshScriptRunPrompt({ ...base, trust: undefined })).toStrictEqual(
        plain,
      );
      expect(sshScriptRunPrompt({ ...base, offerRemember: true })).toEqual({
        ...plain,
        remember,
      });
      expect(
        sshScriptRunPrompt({ ...base, offerRemember: true, trust: undefined }),
      ).toEqual({ ...plain, remember });
    });

    it("for a macro, with and without the checkbox", () => {
      const plain = {
        title: 'Replay "Follow log" on web-01?',
        message: "This types 2 steps into this SSH session.",
        confirmLabel: "Replay macro",
        targets: {
          label: "Session",
          items: [{ id: "session", name: "web-01", detail: "10.0.0.1" }],
        },
        preview: {
          label: "Steps",
          text: "1. sudo -i  [then wait 500 ms]\n2. q  [no Enter]",
        },
        facts: ["2 steps"],
        hint: "Settings, Macros: Confirm before replay",
      };
      expect(sshMacroReplayPrompt({ macro, session })).toStrictEqual(plain);
      expect(
        sshMacroReplayPrompt({ macro, session, offerRemember: true }),
      ).toEqual({
        ...plain,
        remember: {
          label: "Don't ask again for this macro in this session",
          hint: "You are asked again if the macro changes or the session ends.",
        },
      });
    });

    it("for a bulk send, standard and destructive", () => {
      const targets = {
        label: "Runs on",
        items: [
          { id: "s1", name: "web-01", detail: "10.0.0.1" },
          { id: "s2", name: "db-01", detail: "10.0.0.2" },
        ],
      };
      expect(
        bulkCommandRunPrompt({
          command: "uptime",
          sessions,
          destructive: false,
          policy: "always",
          scriptName: "Uptime",
        }),
      ).toStrictEqual({
        title: "Send this command to 2 SSH sessions?",
        confirmLabel: "Send to 2 sessions",
        preview: { label: "Command", text: "uptime" },
        targets,
        facts: ['Script "Uptime"'],
        hint: "Script library, Confirm run: Always",
      });
      expect(
        bulkCommandRunPrompt({
          command: "reboot",
          sessions,
          destructive: true,
        }),
      ).toStrictEqual({
        title: "Send a destructive command to 2 SSH sessions?",
        message:
          "This command may make destructive changes on every selected session.",
        tone: "danger",
        defaultAction: "cancel",
        confirmLabel: "Send to 2 sessions",
        preview: { label: "Command", text: "reboot" },
        targets,
      });
    });

    it("when no lasting answer can be offered", () => {
      const base = { script, command, session };
      expect(sshScriptRunPrompt({ ...base, trust: NONE })).toStrictEqual(
        sshScriptRunPrompt(base),
      );
      expect(
        sshScriptRunPrompt({ ...base, trust: { ...NONE, destructive: true } }),
      ).toStrictEqual(sshScriptRunPrompt(base));
      // The session answer alone is the checkbox, as before.
      expect(
        sshScriptRunPrompt({ ...base, offerRemember: true, trust: NONE }),
      ).toStrictEqual(sshScriptRunPrompt({ ...base, offerRemember: true }));
      expect(
        sshMacroReplayPrompt({ macro, session, trust: NONE }),
      ).toStrictEqual(sshMacroReplayPrompt({ macro, session }));
      expect(
        sshMacroReplayPrompt({
          macro,
          session,
          offerRemember: true,
          trust: NONE,
        }),
      ).toStrictEqual(
        sshMacroReplayPrompt({ macro, session, offerRemember: true }),
      );
    });
  });

  describe("a script", () => {
    const base = { script, command, session };

    it("offers every answer, asking every time first", () => {
      expect(
        sshScriptRunPrompt({ ...base, offerRemember: true, trust: ALL })
          .choices,
      ).toStrictEqual({
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
        note: SCRIPT_NOTE,
      });
    });

    it("offers the session answer only where the call site acts on it", () => {
      const ids = (offerRemember?: boolean) =>
        sshScriptRunPrompt({
          ...base,
          offerRemember,
          trust: ALL,
        }).choices?.options.map((option) => option.id);
      expect(ids()).toEqual(["ask", "connection", "everywhere"]);
      expect(ids(false)).toEqual(["ask", "connection", "everywhere"]);
      expect(ids(true)).toEqual(["ask", "session", "connection", "everywhere"]);
    });

    it("offers this connection only when it can be bound, and every connection only when allowed", () => {
      const ids = (trust: RunTrustOffer) =>
        sshScriptRunPrompt({
          ...base,
          offerRemember: true,
          trust,
        }).choices?.options.map((option) => option.id);
      expect(ids({ connection: false, everywhere: true })).toEqual([
        "ask",
        "session",
        "everywhere",
      ]);
      expect(ids({ connection: true, everywhere: false })).toEqual([
        "ask",
        "session",
        "connection",
      ]);
      expect(
        sshScriptRunPrompt({
          ...base,
          trust: { connection: false, everywhere: true },
        }).choices?.options.map((option) => option.id),
      ).toEqual(["ask", "everywhere"]);
    });

    it("replaces the checkbox, never adds to it, and changes nothing else", () => {
      const withTrust = sshScriptRunPrompt({
        ...base,
        offerRemember: true,
        trust: ALL,
      });
      expect("remember" in withTrust).toBe(false);
      const { choices, ...rest } = withTrust;
      expect(choices).toBeDefined();
      expect(rest).toStrictEqual(sshScriptRunPrompt(base));
    });

    it("warns that a destructive script would then run at once", () => {
      const choices = sshScriptRunPrompt({
        ...base,
        trust: { ...ALL, destructive: true },
      }).choices;
      expect(choices?.note).toBe(
        `This script may make destructive changes. With a lasting choice it runs at once, without this question. ${SCRIPT_NOTE}`,
      );
      expect(choices?.noteTone).toBe("danger");
      expect(
        "noteTone" in
          sshScriptRunPrompt({ ...base, trust: { ...ALL, destructive: false } })
            .choices!,
      ).toBe(false);
      // The prompt's own tone and focus stay as they were.
      const request = sshScriptRunPrompt({
        ...base,
        trust: { ...ALL, destructive: true },
      });
      expect(request.tone).toBeUndefined();
      expect(request.defaultAction).toBeUndefined();
    });
  });

  describe("a macro", () => {
    it("offers every answer, asking every time first", () => {
      expect(
        sshMacroReplayPrompt({
          macro,
          session,
          offerRemember: true,
          trust: ALL,
        }).choices,
      ).toStrictEqual({
        label: "Next time this macro is replayed",
        options: [
          { id: "ask", label: "Ask every time" },
          {
            id: "session",
            label: "Don't ask again in this session",
            hint: "Until the session ends or the macro changes.",
          },
          {
            id: "connection",
            label: "Always replay it without asking on this connection",
            hint: "Only this exact macro, only on this saved connection.",
          },
          {
            id: "everywhere",
            label: "Always replay it without asking on every connection",
            hint: "Only this exact macro, in any SSH session.",
          },
        ],
        note: MACRO_NOTE,
      });
    });

    it("follows the same offers as a script", () => {
      const ids = (trust: RunTrustOffer, offerRemember?: boolean) =>
        sshMacroReplayPrompt({
          macro,
          session,
          offerRemember,
          trust,
        }).choices?.options.map((option) => option.id);
      expect(ids(ALL)).toEqual(["ask", "connection", "everywhere"]);
      expect(ids({ connection: true, everywhere: false }, true)).toEqual([
        "ask",
        "session",
        "connection",
      ]);
      expect(ids({ connection: false, everywhere: true })).toEqual([
        "ask",
        "everywhere",
      ]);
    });

    it("replaces the checkbox, never adds to it, and changes nothing else", () => {
      const withTrust = sshMacroReplayPrompt({
        macro,
        session,
        offerRemember: true,
        trust: ALL,
      });
      expect("remember" in withTrust).toBe(false);
      const { choices, ...rest } = withTrust;
      expect(choices).toBeDefined();
      expect(rest).toStrictEqual(sshMacroReplayPrompt({ macro, session }));
    });

    it("warns that a destructive macro would then run at once", () => {
      const choices = sshMacroReplayPrompt({
        macro,
        session,
        trust: { ...ALL, destructive: true },
      }).choices;
      expect(choices?.note).toBe(
        `This macro may make destructive changes. With a lasting choice it runs at once, without this question. ${MACRO_NOTE}`,
      );
      expect(choices?.noteTone).toBe("danger");
    });
  });

  describe("a bulk send", () => {
    const base = {
      command: "uptime",
      sessions,
      destructive: false,
      policy: "always" as const,
      scriptName: "Uptime",
    };

    it("offers asking every time and sending without asking, and nothing else", () => {
      expect(
        bulkCommandRunPrompt({ ...base, trust: {} }).choices,
      ).toStrictEqual({
        label: "Next time this script is sent",
        options: [
          { id: "ask", label: "Ask every time" },
          {
            id: "everywhere",
            label: "Always send it without asking",
            hint: "Only this exact script. The sessions it goes to are not shown first.",
          },
        ],
        note: BULK_NOTE,
      });
    });

    it("changes nothing else of the request", () => {
      const { choices, ...rest } = bulkCommandRunPrompt({
        ...base,
        trust: {},
      });
      expect(choices).toBeDefined();
      expect(rest).toStrictEqual(bulkCommandRunPrompt(base));
      const destructive = { ...base, command: "reboot", destructive: true };
      const { choices: dangerChoices, ...dangerRest } = bulkCommandRunPrompt({
        ...destructive,
        trust: { destructive: true },
      });
      expect(dangerChoices).toBeDefined();
      expect(dangerRest).toStrictEqual(bulkCommandRunPrompt(destructive));
    });

    it("warns that a destructive command would then go to every session at once", () => {
      const note = `This command may make destructive changes. With a lasting choice it is sent at once to every selected session, without this question. ${BULK_NOTE}`;
      const choices = bulkCommandRunPrompt({
        ...base,
        trust: { destructive: true },
      }).choices;
      expect(choices?.note).toBe(note);
      expect(choices?.noteTone).toBe("danger");
      // A command the prompt already calls destructive gets the warning too.
      expect(
        bulkCommandRunPrompt({
          ...base,
          command: "reboot",
          destructive: true,
          trust: {},
        }).choices,
      ).toMatchObject({ note, noteTone: "danger" });
      expect(
        "noteTone" in bulkCommandRunPrompt({ ...base, trust: {} }).choices!,
      ).toBe(false);
    });
  });

  describe("notices for the call sites", () => {
    it("says when the choice could not be saved", () => {
      expect(RUN_TRUST_NOT_SAVED_NOTICE).toBe(
        "The choice to stop asking could not be saved. You will be asked again.",
      );
    });

    it("says when the list of trusted scripts is full", () => {
      expect(RUN_TRUST_LIST_FULL_NOTICE).toBe(
        "The list of trusted scripts is full, so the choice to stop asking was not saved. Take some back in Settings, Macros, Trusted scripts. You will be asked again.",
      );
    });

    it("says why a bulk script went without a list of sessions", () => {
      expect(bulkTrustedSendNotice("Disk usage", 3)).toBe(
        '"Disk usage" is trusted, so it is sent to 3 sessions without asking.',
      );
      expect(bulkTrustedSendNotice("Disk usage", 1)).toBe(
        '"Disk usage" is trusted, so it is sent to 1 session without asking.',
      );
      expect(bulkTrustedSendNotice("Disk usage", 1234)).toBe(
        `"Disk usage" is trusted, so it is sent to ${count(1234)} sessions without asking.`,
      );
      const notice = bulkTrustedSendNotice(
        `evil\u{202E}txt.exe\r\n${"x".repeat(200)}`,
        2,
      );
      expect(notice).not.toMatch(/[\u{202A}-\u{202E}\r\n]/u);
      expect(notice.startsWith('"evil')).toBe(true);
      expect(notice).toContain("\u{2026}");
    });
  });
});
