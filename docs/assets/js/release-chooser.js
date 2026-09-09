export const PACKAGES = {
  windows: [
    {
      id: "nsis",
      suffix: "-setup.exe",
      label: "Installer (.exe)",
      help: "Run the installer. Choose MSI below for a Windows Installer package.",
    },
    {
      id: "msi",
      suffix: ".msi",
      label: "Windows Installer (.msi)",
      help: "Windows Installer package. Installation and MSI updates can require administrator approval.",
    },
    {
      id: "portable",
      suffix: "-portable.zip",
      label: "Portable ZIP",
      help: "Extract the whole ZIP and run the app. Portable means installer-free delivery; it does not guarantee all settings or credentials stay in that folder. Update by replacing it with a newer matching package.",
    },
  ],
  darwin: [
    {
      id: "dmg",
      suffix: ".dmg",
      label: "Disk image (.dmg)",
      help: "Open the disk image and install the app. Choose ARM64 for Apple silicon or x64 for an Intel Mac.",
    },
  ],
  linux: [
    {
      id: "appimage",
      suffix: ".AppImage",
      label: "AppImage",
      help: "Make the downloaded AppImage executable, then run it. AppImage runtime requirements vary by distribution.",
    },
    {
      id: "deb",
      suffix: ".deb",
      label: "Debian / Ubuntu (.deb)",
      help: "Install the downloaded local package with your distribution's package installer or apt. Update with a newer matching .deb.",
    },
    {
      id: "rpm",
      suffix: ".rpm",
      label: "Fedora / openSUSE (.rpm)",
      help: "Install the downloaded local package with your distribution's package installer, dnf or zypper. Update with a newer matching .rpm.",
    },
    {
      id: "flatpak",
      suffix: ".flatpak",
      label: "Flatpak bundle",
      help: "Install this local .flatpak bundle. Its GNOME runtime may be downloaded from Flathub; the app itself is supplied by this GitHub asset, not an asserted Flathub listing.",
    },
  ],
};

export function platformHint(navigatorLike = {}) {
  const value = `${navigatorLike.userAgentData?.platform ?? ""} ${navigatorLike.platform ?? ""} ${navigatorLike.userAgent ?? ""}`;
  if (/Android|iPhone|iPad|iPod/i.test(value)) return "";
  if (/Mac/i.test(value) && navigatorLike.maxTouchPoints > 1) return "";
  if (/Windows|Win32|Win64/i.test(value)) return "windows";
  if (/Mac/i.test(value)) return "darwin";
  if (/Linux|X11/i.test(value)) return "linux";
  return "";
}

export function readPreferences(storage) {
  try {
    const value = JSON.parse(storage?.getItem("sorng.docs.download") ?? "null");
    if (!value || !Object.hasOwn(PACKAGES, value.os)) return null;
    if (!["x86_64", "aarch64", ""].includes(value.arch)) return null;
    if (!PACKAGES[value.os].some((item) => item.id === value.package))
      return null;
    return { os: value.os, arch: value.arch, package: value.package };
  } catch {
    return null;
  }
}

export function releaseAssets(release, repository) {
  const repo = new URL(repository);
  if (
    repo.origin !== "https://github.com" ||
    !/^\/[\w.-]+\/[\w.-]+\/?$/.test(repo.pathname)
  )
    throw new Error("Invalid release repository.");
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    typeof release.tag_name !== "string" ||
    !/^\d{2}\.\d+$/.test(release.tag_name) ||
    !Array.isArray(release.assets)
  )
    throw new Error("No valid published release was returned.");
  const prefix = `${repo.pathname.replace(/\/$/, "")}/releases/download/${encodeURIComponent(release.tag_name)}/`;
  const version = `${release.tag_name}.0`;
  const found = [];
  for (const asset of release.assets) {
    if (
      !asset ||
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string"
    )
      continue;
    let url;
    try {
      url = new URL(asset.browser_download_url);
    } catch {
      continue;
    }
    if (
      url.origin !== repo.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== prefix + encodeURIComponent(asset.name)
    )
      continue;
    for (const [os, formats] of Object.entries(PACKAGES))
      for (const arch of ["x86_64", "aarch64"])
        for (const format of formats) {
          if (
            asset.name !==
            `sortOfRemoteNG_${version}_${os}-${arch}${format.suffix}`
          )
            continue;
          if (
            found.some(
              (item) =>
                item.os === os &&
                item.arch === arch &&
                item.package === format.id,
            )
          )
            continue;
          found.push({
            os,
            arch,
            package: format.id,
            name: asset.name,
            url: url.href,
            size:
              Number.isSafeInteger(asset.size) && asset.size >= 0
                ? asset.size
                : null,
          });
        }
  }
  return found;
}

/**
 * @param {HTMLElement} root
 * @param {{fetcher?: typeof fetch, navigatorLike?: {platform?: string, userAgent?: string, userAgentData?: {platform?: string}, maxTouchPoints?: number}, storage?: Pick<Storage, "getItem" | "setItem">, timeoutMs?: number}} [options]
 */
export function mountReleaseChooser(
  root,
  {
    fetcher = window.fetch.bind(window),
    navigatorLike = navigator,
    storage,
    timeoutMs = 15000,
  } = {},
) {
  const repository = root.dataset.repository;
  const os = root.querySelector("[data-release-os]");
  const arch = root.querySelector("[data-release-arch]");
  const format = root.querySelector("[data-release-package]");
  const status = root.querySelector("[data-release-status]");
  const hint = root.querySelector("[data-platform-hint]");
  const help = root.querySelector("[data-package-help]");
  const download = root.querySelector("[data-release-download]");
  const file = root.querySelector("[data-release-file]");
  const retry = root.querySelector("[data-release-retry]");
  if (
    ![os, arch, format, status, hint, help, download, file, retry].every(
      Boolean,
    )
  )
    return () => {};
  let assets = [];
  let version = "";
  let failure = "";
  let loading = false;
  let disposed = false;
  let request = null;
  try {
    storage ??= window.localStorage;
  } catch {
    /* Private browsing may disable storage. */
  }
  const preference = readPreferences(storage);
  os.value = preference?.os ?? platformHint(navigatorLike);
  arch.value = preference?.arch ?? "";
  hint.textContent = preference
    ? "Using your saved choices. Change them below for a different computer."
    : os.value
      ? `Browser suggests ${os.options[os.selectedIndex].text}. Confirm the system and processor; this is not a hardware check.`
      : "Select the computer where you will install the app. Browser detection could not identify a supported desktop system.";
  const populatePackages = (preferred) => {
    format.replaceChildren();
    const choices = PACKAGES[os.value] ?? [];
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.label;
      format.append(option);
    }
    format.disabled = choices.length === 0;
    if (choices.some((choice) => choice.id === preferred))
      format.value = preferred;
  };
  populatePackages(preference?.package);
  const render = () => {
    download.hidden = true;
    download.removeAttribute("href");
    file.textContent = "";
    file.removeAttribute("title");
    help.textContent =
      PACKAGES[os.value]?.find((item) => item.id === format.value)?.help ?? "";
    root.setAttribute("aria-busy", String(loading));
    retry.hidden = !failure;
    retry.disabled = loading;
    if (loading) {
      status.textContent = "Checking the latest published release…";
      return;
    }
    if (failure) {
      status.textContent = failure;
      return;
    }
    if (!os.value || !arch.value) {
      status.textContent = `${version ? `Release ${version}. ` : ""}Choose your operating system and processor.`;
      return;
    }
    const asset = assets.find(
      (item) =>
        item.os === os.value &&
        item.arch === arch.value &&
        item.package === format.value,
    );
    if (!asset) {
      status.textContent = `This package is not published for your selection${version ? ` in release ${version}` : ""}. Choose another package or browse all releases.`;
      return;
    }
    status.textContent = `Release ${version} · available for your selection`;
    download.href = asset.url;
    download.textContent = `Download ${PACKAGES[os.value].find((item) => item.id === format.value).label}`;
    download.hidden = false;
    file.textContent =
      asset.name +
      (asset.size === null
        ? ""
        : ` · ${(asset.size / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`);
    if (asset.size !== null)
      file.title = `${asset.size.toLocaleString()} bytes`;
  };
  const changed = (event) => {
    if (event.target === os) populatePackages();
    try {
      storage?.setItem(
        "sorng.docs.download",
        JSON.stringify({
          os: os.value,
          arch: arch.value,
          package: format.value,
        }),
      );
    } catch {
      /* Selection still works without persistence. */
    }
    render();
  };
  const load = async () => {
    if (loading || disposed) return;
    loading = true;
    failure = "";
    render();
    request = new AbortController();
    const timer = setTimeout(() => request?.abort(), timeoutMs);
    try {
      const repo = new URL(repository);
      if (
        repo.origin !== "https://github.com" ||
        !/^\/[\w.-]+\/[\w.-]+\/?$/.test(repo.pathname)
      )
        throw new Error("Invalid repository");
      const response = await fetcher(
        `https://api.github.com/repos${repo.pathname.replace(/\/$/, "")}/releases/latest`,
        {
          signal: request.signal,
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit",
        },
      );
      if (!response.ok) throw new Error("Release lookup failed");
      const release = await response.json();
      const next = releaseAssets(release, repository);
      if (disposed) return;
      assets = next;
      version = release.tag_name;
      if (!assets.length)
        failure =
          "No matching install assets were found in the latest release. Browse all releases to inspect available files.";
    } catch {
      if (!disposed)
        failure =
          "Release lookup is unavailable or rate-limited. Retry, or use All releases & downloads to choose a file directly.";
    } finally {
      clearTimeout(timer);
      loading = false;
      if (!disposed) render();
    }
  };
  for (const select of [os, arch, format])
    select.addEventListener("change", changed);
  retry.addEventListener("click", load);
  void load();
  return () => {
    disposed = true;
    request?.abort();
    for (const select of [os, arch, format])
      select.removeEventListener("change", changed);
    retry.removeEventListener("click", load);
  };
}

if (typeof document !== "undefined")
  for (const root of document.querySelectorAll("[data-release-chooser]"))
    mountReleaseChooser(root);
