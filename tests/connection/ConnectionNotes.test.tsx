import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ConnectionNotes } from "../../src/components/connection/ConnectionNotes";

const vaultMocks = vi.hoisted(() => ({
  readConnectionNotesSecret: vi.fn(),
  saveConnectionNotesSecret: vi.fn(),
}));

vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  MAX_CONNECTION_NOTES_UTF8_BYTES: 2_048,
  MAX_CONNECTION_NOTES_CODE_UNITS: Math.floor(2_048 / 3),
  readConnectionNotesSecret: vaultMocks.readConnectionNotesSecret,
  saveConnectionNotesSecret: vaultMocks.saveConnectionNotesSecret,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

interface TestNotesData {
  content: string;
  tags: string[];
  lastModified: number;
  runbookSteps: unknown[];
}

function makeNotesData(content = ""): TestNotesData {
  return {
    content,
    tags: [],
    lastModified: Date.now(),
    runbookSteps: [],
  };
}

function mockVaultNotes(data: TestNotesData) {
  vaultMocks.readConnectionNotesSecret.mockResolvedValueOnce(
    JSON.stringify(data),
  );
}

async function renderLoadedNotes(
  props: ComponentProps<typeof ConnectionNotes>,
) {
  const result = render(<ConnectionNotes {...props} />);
  await act(async () => {
    const reads = vaultMocks.readConnectionNotesSecret.mock.results;
    await reads[reads.length - 1]?.value;
    await Promise.resolve();
  });
  expect(vaultMocks.readConnectionNotesSecret).toHaveBeenCalledWith(
    props.connectionId,
  );
  expect(screen.getByPlaceholderText("Write your notes here…")).toBeEnabled();
  return result;
}

describe("ConnectionNotes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vaultMocks.readConnectionNotesSecret.mockReset();
    vaultMocks.saveConnectionNotesSecret.mockReset();
    vaultMocks.readConnectionNotesSecret.mockResolvedValue(
      JSON.stringify(makeNotesData()),
    );
    vaultMocks.saveConnectionNotesSecret.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      vi.clearAllTimers();
    });
    vi.useRealTimers();
  });

  it("renders header with connection name", async () => {
    await renderLoadedNotes({
      connectionId: "c1",
      connectionName: "My Server",
    });
    expect(screen.getByText(/Notes — My Server/)).toBeInTheDocument();
  });

  it("shows empty state placeholder when no notes exist", async () => {
    await renderLoadedNotes({ connectionId: "c1", connectionName: "Server" });
    expect(
      screen.getByPlaceholderText("Write your notes here…"),
    ).toBeInTheDocument();
  });

  it("renders existing notes from the secure vault", async () => {
    mockVaultNotes(makeNotesData("Existing note text"));
    await renderLoadedNotes({ connectionId: "c2", connectionName: "Server" });
    const textarea = screen.getByPlaceholderText(
      "Write your notes here…",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Existing note text");
  });

  it("user can edit notes by typing in textarea", async () => {
    await renderLoadedNotes({ connectionId: "c3", connectionName: "Server" });
    const textarea = screen.getByPlaceholderText(
      "Write your notes here…",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello world" } });
    expect(textarea.value).toBe("Hello world");
  });

  it("persists notes to the secure vault after debounce", async () => {
    await renderLoadedNotes({ connectionId: "c4", connectionName: "Server" });
    const textarea = screen.getByPlaceholderText(
      "Write your notes here…",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Saved content" } });
    // Advance past the 2000ms debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(vaultMocks.saveConnectionNotesSecret).toHaveBeenCalledTimes(1);
    const [savedConnectionId, serialized] =
      vaultMocks.saveConnectionNotesSecret.mock.calls[0];
    const stored = JSON.parse(serialized);
    expect(savedConnectionId).toBe("c4");
    expect(stored.content).toBe("Saved content");
  });

  it("shows char and word count in footer", async () => {
    mockVaultNotes(makeNotesData("three word count"));
    await renderLoadedNotes({ connectionId: "c5", connectionName: "Server" });
    expect(screen.getByText("16/512 chars · 3 words")).toBeInTheDocument();
  });

  it("handles long vault-backed text within the secure limit", async () => {
    const longText = "word ".repeat(100).trim();
    mockVaultNotes(makeNotesData(longText));
    await renderLoadedNotes({ connectionId: "c6", connectionName: "Server" });
    const textarea = screen.getByPlaceholderText(
      "Write your notes here…",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(longText);
    expect(screen.getByText(/100 words/)).toBeInTheDocument();
  });

  it("renders close button and calls onClose", async () => {
    const onClose = vi.fn();
    await renderLoadedNotes({
      connectionId: "c7",
      connectionName: "Server",
      onClose,
    });
    const closeBtn = screen.getByLabelText("Close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders Notes and Runbooks tabs", async () => {
    await renderLoadedNotes({ connectionId: "c8", connectionName: "Server" });
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Runbooks")).toBeInTheDocument();
  });

  it("renders Markdown formatting without turning note content into executable markup", async () => {
    const content = [
      "# Safe heading",
      "",
      "**bold** [safe link](https://example.com)",
      "",
      '[unsafe link](javascript:alert(1)) <img src=x onerror="alert(2)">',
    ].join("\n");
    mockVaultNotes(makeNotesData(content));

    const { container } = await renderLoadedNotes({
      connectionId: "c9",
      connectionName: "Server",
    });
    const preview = container.querySelector(
      ".sor-notes-preview",
    ) as HTMLElement;
    const safeLink = screen.getByRole("link", { name: "safe link" });

    expect(
      screen.getByRole("heading", { name: "Safe heading" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(safeLink).toHaveAttribute("href", "https://example.com");
    expect(preview.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(preview.querySelector("img, script, [onerror]")).toBeNull();
    expect(preview.textContent).toContain('<img src=x onerror="alert(2)">');
  });
});
