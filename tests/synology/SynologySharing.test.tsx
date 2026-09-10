import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SynologySessionContent } from "../../src/components/synology/SynologyPanel";
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import { useSynologyFileSharing } from "../../src/hooks/synology/useSynologyFileSharing";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
const c = {
  instanceId: "instance-a",
  sessionId: "session-a",
  host: "nas.test",
  port: 5001,
  connectionStatus: "connected",
  assertSessionAccess: () => {},
  notifySessionExpired: vi.fn(),
  disconnect: vi.fn(),
} as unknown as ReturnType<typeof useSynologyFileConnection>;
const link = {
  id: "link-a",
  path: "/public/readme.txt",
  url: "https://nas.test/sharing/opaque",
  dateExpired: "2026-10-01",
  hasPassword: true,
};
const native = async (command: string, args?: Record<string, unknown>) => {
  if (command === "syn_fs_list")
    return {
      files: [
        {
          name: "readme.txt",
          path: "/public/readme.txt",
          isdir: false,
          additional: {
            size: 123,
            owner: { user: "owner-alice", group: "staff" },
            perm: { posix: 420, is_acl_mode: true },
            realPath: "/volume1/public/readme.txt",
            time: { mtime: 123456 },
          },
        },
      ],
      total: 1,
      offset: 0,
    };
  if (command === "syn_fs_list_share_links")
    return { links: [link], total: 123, offset: args?.offset ?? 0 };
  if (command === "syn_fs_create_share_link") return link;
  return null;
};
beforeEach(() =>
  vi
    .mocked(invoke)
    .mockReset()
    .mockImplementation((command, args) =>
      native(command, args as Record<string, unknown>),
    ),
);
afterEach(cleanup);
describe("File Station metadata and sharing", () => {
  it("shows listing metadata and POSIX/ACL facts without inventing ACL editing", async () => {
    render(<SynologySessionContent connection={c} />);
    await screen.findByText("readme.txt");
    fireEvent.click(screen.getByLabelText("Select readme.txt"));
    fireEvent.click(
      screen.getByRole("button", { name: "Details & permissions" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "File details and permissions",
    });
    expect(within(dialog).getByText("owner-alice")).toBeInTheDocument();
    expect(within(dialog).getByText("0o644")).toHaveAttribute(
      "data-tooltip",
      "Raw: 420",
    );
    expect(
      within(dialog).getByText("/volume1/public/readme.txt"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/ACLs are read-only/)).toBeInTheDocument();
  });
  it("creates only on explicit review with real date/max16 password, shows URL without auto-open", async () => {
    render(<SynologySessionContent connection={c} />);
    await screen.findByText("readme.txt");
    fireEvent.click(screen.getByLabelText("Select readme.txt"));
    fireEvent.click(
      screen.getByRole("button", { name: "Share selected item" }),
    );
    const dialog = screen.getByRole("dialog", { name: "File sharing links" });
    expect(invoke).not.toHaveBeenCalledWith(
      "syn_fs_create_share_link",
      expect.anything(),
    );
    const password = within(dialog).getByLabelText(/Sharing password/);
    expect(password).toHaveAttribute("maxlength", "16");
    fireEvent.change(password, { target: { value: "short-secret" } });
    fireEvent.change(within(dialog).getByLabelText(/Expiry date/), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create sharing link" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_create_share_link", {
        instanceId: "instance-a",
        expectedSessionId: "session-a",
        path: "/public/readme.txt",
        password: "short-secret",
        expireDate: "2026-10-01",
      }),
    );
    expect(await screen.findByLabelText("Created sharing URL")).toHaveValue(
      link.url,
    );
    expect(screen.queryByLabelText(/Sharing password/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: link.url }),
    ).not.toBeInTheDocument();
  });
  it("loads bounded link pages and revokes only reviewed ID", async () => {
    render(<SynologySessionContent connection={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Sharing links" }));
    const dialog = screen.getByRole("dialog", { name: "File sharing links" });
    await within(dialog).findByText(link.url);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Next link page" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_list_share_links", {
        instanceId: "instance-a",
        expectedSessionId: "session-a",
        offset: 50,
        limit: 50,
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Revoke" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(invoke).not.toHaveBeenCalledWith(
      "syn_fs_delete_share_links",
      expect.anything(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Revoke sharing link" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_delete_share_links", {
        instanceId: "instance-a",
        expectedSessionId: "session-a",
        ids: ["link-a"],
      }),
    );
  });
  it("keeps failed revocation review for manual retry without false success", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) =>
      cmd === "syn_fs_delete_share_links"
        ? Promise.reject(new Error("Permission denied"))
        : native(cmd, args as Record<string, unknown>),
    );
    render(<SynologySessionContent connection={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Sharing links" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke sharing link" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permission denied",
    );
    expect(
      screen.getByRole("button", { name: "Revoke sharing link" }),
    ).toBeEnabled();
  });
  it("revokes stale review callbacks across scope changes and cancellation", async () => {
    const call = vi.fn().mockResolvedValue({ links: [], offset: 0, total: 0 });
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useSynologyFileSharing({ scopeKey, invoke: call }),
      { initialProps: { scopeKey: "a" } },
    );
    act(() => result.current.requestRevoke(link));
    const stale = result.current.confirm;
    act(() => result.current.cancelReview());
    await act(async () => expect(await stale("", "")).toBe(false));
    act(() => result.current.requestCreate(link.path));
    const switched = result.current.confirm;
    rerender({ scopeKey: "b" });
    await act(async () => expect(await switched("secret", "")).toBe(false));
    expect(call).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });
  it("drops late response after replacement and allows new owner's request", async () => {
    let complete!: (value: unknown) => void;
    const delayed = new Promise((resolve) => {
      complete = resolve;
    });
    const call = vi
      .fn()
      .mockReturnValueOnce(delayed)
      .mockResolvedValue({ links: [], offset: 0, total: 0 });
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useSynologyFileSharing({ scopeKey, invoke: call }),
      { initialProps: { scopeKey: "a" } },
    );
    act(() => result.current.show());
    rerender({ scopeKey: "b" });
    await act(async () => complete({ links: [link], offset: 0, total: 1 }));
    expect(result.current.data).toBeNull();
    act(() => result.current.show());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.current.data?.links).toEqual([]);
  });
});
