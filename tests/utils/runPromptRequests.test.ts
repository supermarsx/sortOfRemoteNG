import { describe, expect, it } from "vitest";
import {
  PROMPT_CANCEL_LABEL,
  PROMPT_HIDDEN_CHARACTERS_NOTICE,
  PROMPT_LIMITS,
  bulkCommandRunPrompt,
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
  sshMacroReplayPrompt,
  sshScriptRunPrompt,
  targetsOmittedNotice,
  terminalPastePrompt,
  toSingleLine,
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
      expect(prompt.targets).toBeUndefined();
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
