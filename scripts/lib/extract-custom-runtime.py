"""Extract only a reviewed SDK inventory into a NEW directory, preserving layout.

Called with a raw-digest-verified archive and manifest by cef-runtime-fetch.mjs.
No downloads, metadata synthesis, executable loading, or source builds.
"""
import json
import pathlib
import sys
import tarfile


class BoundedTarInfo(tarfile.TarInfo):
    """Cap extension headers before tarfile allocates/decodes their payloads."""

    def _check_extension(self, archive):
        if self.size > 1024 * 1024:
            raise ValueError("Oversized tar extension header")
        total = getattr(archive, "_sorng_extension_bytes", 0) + self.size
        if total > 16 * 1024 * 1024:
            raise ValueError("Excessive tar extension metadata")
        archive._sorng_extension_bytes = total

    def _proc_pax(self, archive):
        self._check_extension(archive)
        return super()._proc_pax(archive)

    def _proc_gnulong(self, archive):
        self._check_extension(archive)
        return super()._proc_gnulong(archive)


def extract(archive, destination, manifest_file, target, root, max_bytes, max_members):
    if sys.version_info < (3, 12):
        raise RuntimeError("Safe CEF extraction requires Python 3.12 or newer")
    destination = pathlib.Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("Extraction destination must be new")
    if not root or root in (".", "..") or any(char in root for char in "/\\:"):
        raise ValueError("Invalid SDK root")
    # Hard ceilings also apply to direct helper invocations.
    max_bytes = min(int(max_bytes), 32 * 1024 ** 3)
    max_members = min(int(max_members), 50000)
    with open(manifest_file, encoding="utf-8") as source:
        artifact = next(item for item in json.load(source)["artifacts"] if item["target"] == target)
    expected = {root + "/" + entry["path"]: entry for entry in artifact["sdkFiles"]}
    directories = {root}
    for name in expected:
        parts = pathlib.PurePosixPath(name).parts
        if ".." in parts or "\\" in name or ":" in name or name.startswith("/"):
            raise ValueError("Unsafe SDK inventory path")
        directories.update(str(parent) for parent in pathlib.PurePosixPath(name).parents if str(parent) != ".")
    seen = set()
    leaves = set()
    total = 0
    # Validate every member before any filesystem extraction. This permits the
    # flat prepared SDK as well as Release/Resources inventories without rewriting.
    with tarfile.open(archive, "r:bz2", tarinfo=BoundedTarInfo) as package:
        for member in package:
            name = member.name.rstrip("/")
            if name in seen or len(seen) >= max_members:
                raise ValueError("Duplicate/excessive archive members")
            seen.add(name)
            if member.isdir():
                if name not in directories or member.size != 0:
                    raise ValueError("Unreviewed archive directory")
            else:
                entry = expected.get(name)
                if entry is None:
                    raise ValueError("Unreviewed/escaping archive member")
                leaves.add(name)
                if entry["type"] == "file":
                    if not member.isfile() or member.size != entry["size"] or member.sparse is not None:
                        raise ValueError("Archive file kind/size differs from reviewed inventory")
                    total += member.size
                elif entry["type"] != "symlink" or not member.issym() or member.linkname != entry["target"] or member.size != 0:
                    raise ValueError("Archive link differs from reviewed inventory")
            if total > max_bytes:
                raise ValueError("Expanded archive exceeds bound")
            tarfile.data_filter(member, str(destination))
        if leaves != set(expected):
            raise ValueError("Archive is missing reviewed SDK members")
        destination.mkdir(parents=False, exist_ok=False)
        package.extractall(destination, members=package.getmembers(), filter="data")


if __name__ == "__main__":
    extract(*sys.argv[1:])
