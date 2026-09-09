import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { expectedAssetNames } from "../../scripts/ci/verify-published-release-assets.mjs";
import {
  mountReleaseChooser,
  platformHint,
  readPreferences,
  releaseAssets,
} from "../../docs/assets/js/release-chooser.js";

const repository = "https://github.com/supermarsx/sortOfRemoteNG";
const names = expectedAssetNames("26.45.0", "signed");
const release = {
  tag_name: "26.45",
  draft: false,
  prerelease: false,
  assets: names.map((name: string) => ({
    name,
    size: 10485760,
    browser_download_url: `${repository}/releases/download/26.45/${name}`,
  })),
};
const markup = readFileSync(
  "docs/_includes/release-chooser.html",
  "utf8",
).replace("{{ site.repository_url }}", repository);
const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount(
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => release }),
) {
  document.body.innerHTML = markup;
  const root = document.querySelector<HTMLElement>("[data-release-chooser]")!;
  disposals.push(
    mountReleaseChooser(root, {
      fetcher,
      navigatorLike: { platform: "Win32" },
      storage: localStorage,
    }),
  );
  return {
    root,
    fetcher,
    os: root.querySelector<HTMLSelectElement>("[data-release-os]")!,
    arch: root.querySelector<HTMLSelectElement>("[data-release-arch]")!,
    format: root.querySelector<HTMLSelectElement>("[data-release-package]")!,
    download: root.querySelector<HTMLAnchorElement>("[data-release-download]")!,
    status: root.querySelector<HTMLElement>("[data-release-status]")!,
    retry: root.querySelector<HTMLButtonElement>("[data-release-retry]")!,
  };
}

describe("published release selection", () => {
  it("matches all 16 real public installers in the release validator, excluding updater and provenance assets", () => {
    const assets = releaseAssets(release, repository);
    expect(assets).toHaveLength(16);
    expect(assets.map((item) => item.name).sort()).toEqual(
      names
        .filter((name: string) =>
          /\.(AppImage|deb|rpm|flatpak|dmg|msi|exe|zip)$/.test(name),
        )
        .sort(),
    );
    expect(new Set(assets.map((item) => `${item.os}/${item.arch}`)).size).toBe(
      6,
    );
  });
  it("never invents assets and rejects foreign, mismatched, credential-bearing and malformed URLs", () => {
    const asset = release.assets[0];
    for (const url of [
      "https://evil.example/install.exe",
      asset.browser_download_url.replace("26.45/", "26.44/"),
      asset.browser_download_url + "?token=secret",
      asset.browser_download_url.replace("https://", "https://user:secret@"),
      "bad-url",
    ]) {
      expect(
        releaseAssets(
          { ...release, assets: [{ ...asset, browser_download_url: url }] },
          repository,
        ),
      ).toEqual([]);
    }
    expect(releaseAssets({ ...release, assets: [] }, repository)).toEqual([]);
    expect(() =>
      releaseAssets({ ...release, draft: true }, repository),
    ).toThrow();
    expect(() =>
      releaseAssets({ ...release, prerelease: true }, repository),
    ).toThrow();
    expect(() => releaseAssets(release, "https://evil.example/repo")).toThrow();
  });
  it.each([
    [{ platform: "Win32" }, "windows"],
    [{ userAgentData: { platform: "macOS" } }, "darwin"],
    [{ platform: "Linux x86_64" }, "linux"],
    [{ userAgent: "Android Linux" }, ""],
    [{ platform: "MacIntel", maxTouchPoints: 5 }, ""],
    [{}, ""],
  ])("uses desktop OS only as a hint (%j)", (input, expected) =>
    expect(platformHint(input)).toBe(expected),
  );
  it("ignores malformed preferences and private-storage errors", () => {
    localStorage.setItem(
      "sorng.docs.download",
      '{"os":"windows","arch":"guess","package":"nsis"}',
    );
    expect(readPreferences(localStorage)).toBeNull();
    expect(
      readPreferences({
        getItem: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBeNull();
  });
  it("requires explicit architecture, permits every manual override, and persists choices without downloading", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.root).toHaveAttribute("aria-busy", "false"),
    );
    expect(view.os.value).toBe("windows");
    expect(view.arch.value).toBe("");
    expect(view.download).not.toHaveAttribute("href");
    fireEvent.change(view.arch, { target: { value: "aarch64" } });
    fireEvent.change(view.format, { target: { value: "portable" } });
    expect(view.download.href).toBe(
      `${repository}/releases/download/26.45/sortOfRemoteNG_26.45.0_windows-aarch64-portable.zip`,
    );
    fireEvent.change(view.os, { target: { value: "linux" } });
    fireEvent.change(view.format, { target: { value: "deb" } });
    expect(view.download.href).toContain("linux-aarch64.deb");
    expect(readPreferences(localStorage)).toEqual({
      os: "linux",
      arch: "aarch64",
      package: "deb",
    });
    expect(view.fetcher).toHaveBeenCalledTimes(1);
    expect(view.fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/supermarsx/sortOfRemoteNG/releases/latest",
      expect.objectContaining({ credentials: "omit" }),
    );
  });
  it("restores preferences even when browser hints differ", async () => {
    localStorage.setItem(
      "sorng.docs.download",
      JSON.stringify({ os: "darwin", arch: "aarch64", package: "dmg" }),
    );
    const view = mount();
    await waitFor(() => expect(view.download).toHaveAttribute("href"));
    expect(view.download.href).toContain("darwin-aarch64.dmg");
    expect(view.root).toHaveTextContent("Using your saved choices");
  });
  it("shows an unavailable selection without a fabricated download", async () => {
    const view = mount(
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...release,
          assets: release.assets.filter(
            (asset) => !asset.name.endsWith(".msi"),
          ),
        }),
      }),
    );
    fireEvent.change(view.arch, { target: { value: "x86_64" } });
    fireEvent.change(view.format, { target: { value: "msi" } });
    await waitFor(() => expect(view.status).toHaveTextContent("not published"));
    expect(view.download).not.toHaveAttribute("href");
  });
  it("surfaces API failure, retries only intentionally, and recovers", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValue({ ok: true, json: async () => release });
    const view = mount(fetcher);
    await waitFor(() => expect(view.retry.hidden).toBe(false));
    expect(view.status).toHaveTextContent("unavailable or rate-limited");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(view.retry);
    fireEvent.click(view.retry);
    await waitFor(() =>
      expect(view.root).toHaveAttribute("aria-busy", "false"),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.retry.hidden).toBe(true);
  });
  it("aborts on disposal and ignores a late response", async () => {
    let resolve!: (value: unknown) => void;
    const view = mount(
      vi.fn().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    disposals.pop()!();
    const previous = view.status.textContent;
    resolve({ ok: true, json: async () => release });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(view.status.textContent).toBe(previous);
    expect(view.download).not.toHaveAttribute("href");
  });
});
