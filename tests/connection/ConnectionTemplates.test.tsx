import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import ConnectionTemplates from "../../src/components/connection/ConnectionTemplates";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

// Mock the Select component to render a simple <select>
vi.mock("../../src/components/ui/forms", () => ({
  Select: ({ value, onChange, options }: any) => (
    <select
      data-testid="select"
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
    >
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const STORAGE_KEY = "sor-connection-templates";

describe("ConnectionTemplates", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetInvokeCache();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_app_data") return Promise.resolve(null);
      if (command === "compare_and_swap_app_data") return Promise.resolve(true);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the template list with builtin templates", () => {
    render(<ConnectionTemplates />);
    expect(screen.getByText("Connection Templates")).toBeInTheDocument();
    expect(screen.getByText("SSH Linux Server")).toBeInTheDocument();
    expect(screen.getByText("RDP Windows Server")).toBeInTheDocument();
    expect(screen.getByText("VNC Server")).toBeInTheDocument();
  });

  it("shows template details when a card is clicked", () => {
    render(<ConnectionTemplates />);
    fireEvent.click(screen.getByText("SSH Linux Server"));
    // Detail panel should show description (appears in card + detail, so use getAllByText)
    const descs = screen.getAllByText(
      /Standard SSH connection to a Linux server/,
    );
    expect(descs.length).toBeGreaterThanOrEqual(2); // card desc + detail desc
    // Shows tags
    expect(screen.getByText("linux")).toBeInTheDocument();
    // Shows settings table
    expect(screen.getByText("authMethod")).toBeInTheDocument();
  });

  it("fires onCreateFromTemplate when Use Template is clicked", () => {
    const onCreate = vi.fn();
    render(<ConnectionTemplates onCreateFromTemplate={onCreate} />);
    // Click the first "Use Template" button directly (not from detail panel)
    const useButtons = screen.getAllByText("Use Template");
    fireEvent.click(useButtons[0]);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "SSH Linux Server" }),
    );
  });

  it("normalises the template protocol to the canonical lower-case value when used (t71)", () => {
    const onCreate = vi.fn();
    render(<ConnectionTemplates onCreateFromTemplate={onCreate} />);
    const card = screen
      .getByText("HTTP API")
      .closest('[data-testid="template-item"]') as HTMLElement;
    fireEvent.click(within(card).getByText("Use Template"));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "HTTP API", protocol: "http" }),
    );
  });

  it("never turns an unknown template protocol into RDP", async () => {
    const onCreate = vi.fn();
    const userTemplate = {
      id: "tpl-web",
      name: "Portal (user)",
      description: "",
      protocol: "Web",
      port: 443,
      category: "web",
      icon: "🌐",
      settings: {},
      tags: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      usageCount: 0,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_app_data") {
        return Promise.resolve(JSON.stringify([userTemplate]));
      }
      if (command === "compare_and_swap_app_data") return Promise.resolve(true);
      return Promise.resolve([]);
    });
    render(<ConnectionTemplates onCreateFromTemplate={onCreate} />);
    const name = await screen.findByText("Portal (user)");
    const card = name.closest('[data-testid="template-item"]') as HTMLElement;
    fireEvent.click(within(card).getByText("Use Template"));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "https", port: 443 }),
    );
  });

  it("offers one Browser type with HTTPS by default and a separate HTTP choice", () => {
    render(<ConnectionTemplates />);
    fireEvent.click(screen.getByText(/New Template/));
    const selects = screen.getAllByTestId("select") as HTMLSelectElement[];
    const protocolSelect = selects.find((el) =>
      Array.from(el.options).some((o) => o.value === "browser"),
    );
    expect(protocolSelect).toBeDefined();
    expect(
      Array.from(protocolSelect!.options).filter((o) => o.label === "Browser"),
    ).toHaveLength(1);
    expect(
      Array.from(protocolSelect!.options).some(
        (o) => o.value === "http" || o.value === "https",
      ),
    ).toBe(false);
    expect(protocolSelect!.value).toBe("ssh");
    fireEvent.change(protocolSelect!, { target: { value: "browser" } });
    const transport = screen
      .getAllByTestId("select")
      .find((el) => (el as HTMLSelectElement).value === "https")!;
    expect(transport).toHaveValue("https");
    expect(screen.getByRole("spinbutton")).toHaveValue(443);
    fireEvent.change(transport, { target: { value: "http" } });
    expect(transport).toHaveValue("http");
    expect(screen.getByRole("spinbutton")).toHaveValue(80);
    expect(protocolSelect!).toHaveValue("browser");
  });

  it.each(["http", "https"])(
    "saves an existing %s template unchanged through the Browser picker",
    async (protocol) => {
      const template = {
        id: "personal-browser",
        name: "Personal portal",
        description: "",
        protocol,
        port: 8443,
        category: "web",
        icon: "🌐",
        settings: {
          hostname: `${protocol}://portal.example.test:8443/a?b=%2F#c`,
        },
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        usageCount: 0,
      };
      invokeMock.mockImplementation((command: string) => {
        if (command === "read_app_data")
          return Promise.resolve(JSON.stringify([template]));
        if (command === "compare_and_swap_app_data")
          return Promise.resolve(true);
        return Promise.resolve([]);
      });
      render(<ConnectionTemplates />);
      fireEvent.click(await screen.findByText("Personal portal"));
      fireEvent.click(screen.getByText("Edit"));
      expect(
        screen
          .getAllByTestId("select")
          .some((el) => (el as HTMLSelectElement).value === "browser"),
      ).toBe(true);
      expect(
        screen
          .getAllByTestId("select")
          .some((el) => (el as HTMLSelectElement).value === protocol),
      ).toBe(true);
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith(
          "compare_and_swap_app_data",
          expect.anything(),
        ),
      );
      const args = invokeMock.mock.calls.find(
        ([command]) => command === "compare_and_swap_app_data",
      )![1];
      expect(JSON.parse(args.replacement)[0]).toMatchObject({
        protocol,
        port: 8443,
        settings: template.settings,
      });
      expect(args.replacement).not.toContain('"protocol":"browser"');
    },
  );

  it("switches a Browser template URL scheme without changing its explicit port or URL suffix", async () => {
    const template = {
      id: "custom-browser",
      name: "Custom portal",
      description: "",
      protocol: "http",
      port: 80,
      category: "web",
      icon: "🌐",
      settings: { hostname: "http://portal.example.test:80/a?b=%2F#c" },
      tags: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      usageCount: 0,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_app_data")
        return Promise.resolve(JSON.stringify([template]));
      if (command === "compare_and_swap_app_data") return Promise.resolve(true);
      return Promise.resolve([]);
    });
    render(<ConnectionTemplates />);
    fireEvent.click(await screen.findByText("Custom portal"));
    fireEvent.click(screen.getByText("Edit"));
    const transport = screen
      .getAllByTestId("select")
      .find((el) => (el as HTMLSelectElement).value === "http")!;
    fireEvent.change(transport, { target: { value: "https" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "compare_and_swap_app_data",
        expect.anything(),
      ),
    );
    const args = invokeMock.mock.calls.find(
      ([command]) => command === "compare_and_swap_app_data",
    )![1];
    expect(JSON.parse(args.replacement)[0]).toMatchObject({
      protocol: "https",
      port: 80,
      settings: { hostname: "https://portal.example.test:80/a?b=%2F#c" },
    });
  });

  it("does not persist usage counts for built-in templates", async () => {
    const onCreate = vi.fn();
    render(<ConnectionTemplates onCreateFromTemplate={onCreate} />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("read_app_data", {
        key: "connection.templates",
      });
    });
    invokeMock.mockClear();

    fireEvent.click(screen.getAllByText("Use Template")[0]);
    await Promise.resolve();

    expect(onCreate).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "compare_and_swap_app_data",
      expect.anything(),
    );
  });

  it("does not update state when persistence rejects after unmount", async () => {
    const userTemplate = {
      id: "user-template",
      name: "Personal SSH",
      description: "A durable user template",
      protocol: "SSH",
      port: 22,
      category: "ssh",
      icon: "server",
      settings: {},
      tags: ["personal"],
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      usageCount: 0,
    };
    let rejectPersistence: ((reason?: unknown) => void) | undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_app_data") {
        return Promise.resolve(JSON.stringify([userTemplate]));
      }
      if (command === "compare_and_swap_app_data") {
        return new Promise<boolean>((_resolve, reject) => {
          rejectPersistence = reject;
        });
      }
      return Promise.resolve([]);
    });

    const { unmount } = render(<ConnectionTemplates />);
    const templateName = await screen.findByText("Personal SSH");
    const templateCard = templateName.closest('[data-testid="template-item"]');
    expect(templateCard).not.toBeNull();

    fireEvent.click(
      within(templateCard as HTMLElement).getByText("Use Template"),
    );
    await waitFor(() => {
      expect(rejectPersistence).toBeTypeOf("function");
    });
    unmount();

    vi.stubGlobal("window", undefined);
    try {
      rejectPersistence?.(new Error("persistence rejected"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("filters templates by search query", () => {
    render(<ConnectionTemplates />);
    const searchInput = screen.getByPlaceholderText(
      "Search templates by name or tag…",
    );
    fireEvent.change(searchInput, { target: { value: "postgres" } });
    expect(screen.getByText("Database PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("SSH Linux Server")).not.toBeInTheDocument();
  });

  it("ships MariaDB and MongoDB database templates next to MySQL", () => {
    render(<ConnectionTemplates />);
    const searchInput = screen.getByPlaceholderText(
      "Search templates by name or tag\u2026",
    );
    fireEvent.change(searchInput, { target: { value: "mariadb" } });
    expect(screen.getByText("Database MariaDB")).toBeInTheDocument();
    expect(screen.getByText("Database MySQL")).toBeInTheDocument();
    expect(screen.queryByText("Database MongoDB")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "nosql" } });
    expect(screen.getByText("Database MongoDB")).toBeInTheDocument();
    expect(screen.queryByText("Database MySQL")).not.toBeInTheDocument();
  });

  it("filters templates by category pill", () => {
    render(<ConnectionTemplates />);
    // Click the RDP pill specifically (not the badge)
    const pills = screen.getAllByText("RDP");
    const rdpPill = pills.find((el) => el.classList.contains("sor-tpl-pill"))!;
    fireEvent.click(rdpPill);
    expect(screen.getByText("RDP Windows Server")).toBeInTheDocument();
    expect(screen.getByText("RDP Workstation")).toBeInTheDocument();
    expect(screen.queryByText("SSH Linux Server")).not.toBeInTheDocument();
  });

  it('shows "No templates match" when search yields no results', () => {
    render(<ConnectionTemplates />);
    const searchInput = screen.getByPlaceholderText(
      "Search templates by name or tag…",
    );
    fireEvent.change(searchInput, { target: { value: "zzz_nonexistent_zzz" } });
    expect(
      screen.getByText("No templates match your search."),
    ).toBeInTheDocument();
  });

  it("opens create form when New Template is clicked", () => {
    render(<ConnectionTemplates />);
    fireEvent.click(screen.getByText(/New Template/));
    expect(screen.getByText("Create Template")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<ConnectionTemplates onClose={onClose} />);
    // The header close button has title="Close"
    const closeBtn = screen.getByTitle("Close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
