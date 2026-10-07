"""Adversarial extraction fixtures; these are not real runtime build evidence."""
import io
import pathlib
import tarfile
import tempfile
import unittest
from extract_runtime import extract


class ExtractionTests(unittest.TestCase):
    def reject(self, name, link=None, member_type=tarfile.REGTYPE):
        with tempfile.TemporaryDirectory(prefix="sorng-cef-extract-test-") as temp:
            root = pathlib.Path(temp)
            archive = root / "test.tar.bz2"
            with tarfile.open(archive, "w:bz2") as package:
                member = tarfile.TarInfo(name)
                member.type = member_type
                if link:
                    member.linkname = link
                package.addfile(member, io.BytesIO(b""))
            with self.assertRaises((ValueError, tarfile.FilterError)):
                extract(archive, root / "output")
            self.assertFalse((root / "escape").exists())

    def test_parent_traversal(self):
        self.reject("../escape")

    def test_absolute_member(self):
        self.reject("/escape")

    def test_drive_member(self):
        self.reject("C:/escape")

    def test_symlink_escape(self):
        self.reject("cef_binary_test/link", "../../escape", tarfile.SYMTYPE)

    def test_hardlink_escape(self):
        self.reject("cef_binary_test/link", "../../escape", tarfile.LNKTYPE)

    def test_device(self):
        self.reject("cef_binary_test/device", member_type=tarfile.CHRTYPE)

    def test_destination_reuse(self):
        with tempfile.TemporaryDirectory(prefix="sorng-cef-extract-test-") as temp:
            root = pathlib.Path(temp)
            archive = root / "test.tar.bz2"
            archive.touch()
            with self.assertRaises(FileExistsError):
                extract(archive, root)


if __name__ == "__main__":
    unittest.main()
