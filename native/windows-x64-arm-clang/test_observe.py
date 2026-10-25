"""Pure and owned temporary-file tests; no Windows APIs or vendor execution."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("inventory", Path(__file__).with_name("observe.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PROFILE = m.profile(Path(__file__).with_name("profile.json").read_bytes())


def snapshot(**changes):
    fields = dict(st_dev=1, st_ino=2, st_mode=stat.S_IFREG | 0o644, st_size=3,
                  st_mtime_ns=4, st_ctime_ns=5, st_nlink=1, st_birthtime_ns=6, st_file_attributes=0)
    fields.update(changes)
    return types.SimpleNamespace(**fields)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(strict=True)

    def test_profile_pin_and_exact_target(self):
        self.assertEqual(PROFILE["mode"], "inventory")
        self.assertEqual(PROFILE["toolset"], "14.51.36231")
        raw = Path(__file__).with_name("profile.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "INV_PROFILE"):
            m.profile(raw + b" ")

    def test_canonical_windows_paths(self):
        self.assertEqual(m.windows_absolute("C:\\Program Files\\VS\\file.lib"), "C:/Program Files/VS/file.lib")
        for value in ("relative", "C:/a/../b", "C:/a/./b", "C:/a//b", "C:/a/D:evil", "//server/share/a", "C:/a\n", "C:/a/"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                m.windows_absolute(value)

    def test_held_hash_and_bounded_prefix(self):
        p = self.root / "fixed"
        p.write_bytes(b"fixed-public-data")
        row, prefix = m.file_record(p, m.Budget(), retain=5)
        self.assertEqual(prefix, b"fixed")
        self.assertEqual(row["bytes"], 17)
        self.assertTrue(row["stableHeldIdentity"])
        self.assertEqual(row["sha256"], m.hashlib.sha256(p.read_bytes()).hexdigest())

    def test_missing_role_is_explicit(self):
        row, raw = m.file_record(self.root / "absent" / "fixed", m.Budget())
        self.assertEqual((row, raw), ({"present": False}, b""))

    def test_hardlink_is_denied(self):
        p, q = self.root / "first", self.root / "alias"
        p.write_bytes(b"x")
        os.link(p, q)
        with self.assertRaisesRegex(ValueError, "INV_LINK"):
            m.file_record(q, m.Budget())

    def test_symlink_is_denied(self):
        p, q = self.root / "first", self.root / "alias"
        p.write_bytes(b"x")
        try:
            q.symlink_to(p)
        except OSError:
            self.skipTest("owned symlink privilege unavailable")
        with self.assertRaisesRegex(ValueError, "INV_PATH|INV_LINK"):
            m.file_record(q, m.Budget())

    def test_metadata_cap_prevents_open(self):
        p = self.root / "metadata"
        p.write_bytes(b"12345")
        with patch.object(Path, "open", side_effect=AssertionError("must-not-open")):
            with self.assertRaisesRegex(ValueError, "INV_FILE_BOUND"):
                m.file_record(p, m.Budget(), retain=4, maximum=4)

    def test_views_allow_different_ctime_and_mode_only_when_each_stable(self):
        p, f = snapshot(), snapshot(st_ctime_ns=10, st_mode=stat.S_IFREG | 0o755)
        m.stable(p, f, p, f, True)
        for field in ("st_ino", "st_size", "st_mtime_ns", "st_birthtime_ns", "st_nlink"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                other = snapshot(**{field: 99})
                m.stable(p, other, p, other, True)

    def test_per_view_change_is_denied(self):
        for field in ("st_mode", "st_ctime_ns", "st_file_attributes"):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "INV_CHANGED"):
                m.stable(snapshot(), snapshot(), snapshot(**{field: 99}), snapshot(), True)
        with self.assertRaisesRegex(ValueError, "INV_BIRTH"):
            m.shared(snapshot(st_birthtime_ns=None), True)

    def test_budget_file_total_row_deadline_bounds(self):
        now = [0]
        b = m.Budget(180, lambda: now[0])
        with self.assertRaisesRegex(ValueError, "INV_FILE_BOUND"):
            b.admit(m.MAX_FILE + 1)
        b.total = m.MAX_TOTAL
        with self.assertRaisesRegex(ValueError, "INV_TOTAL_BOUND"):
            b.admit(1)
        b.total, b.rows = 0, m.MAX_ROWS
        with self.assertRaisesRegex(ValueError, "INV_ROW_BOUND"):
            b.admit(0)
        now[0] = 180
        with self.assertRaisesRegex(ValueError, "INV_DEADLINE"):
            b.check()

    def test_directory_count_is_bounded(self):
        for i in range(9):
            (self.root / f"14.51.{i}").mkdir()
        with self.assertRaisesRegex(ValueError, "INV_DIRECTORY_BOUND"):
            m.immediate_directories(self.root, 8, m.Budget(), r"\d+\.\d+\.\d+")

    def test_unknown_directory_entry_not_opened(self):
        p = self.root / "unknown-secret.txt"
        p.write_bytes(b"not-read")
        with patch.object(Path, "open", side_effect=AssertionError("unknown-open")):
            with self.assertRaisesRegex(ValueError, "INV_DIRECTORY"):
                m.immediate_directories(self.root, 8, m.Budget(), r"\d+\.\d+\.\d+")

    def test_directory_versions(self):
        (self.root / "14.51.36231").mkdir()
        self.assertEqual(m.immediate_directories(self.root, 8, m.Budget(), r"\d+\.\d+\.\d+"), ["14.51.36231"])

    def test_json_duplicates_invalid_utf8_and_limit(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":"\xff"}', b"[]", b"x" * (4 * 1024**2 + 1)):
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                m.json_object(raw)

    def test_public_provenance_projection_excludes_private_fields(self):
        data = {"installationPath": PROFILE["visualStudioRoot"], "installationVersion": PROFILE["visualStudioVersion"],
                "private": "must-not-escape", "packages": [{"id": c, "version": "18.10.12020.329", "private": "never"} for c in PROFILE["components"]]}
        result = m.provenance_projection(data, PROFILE)
        self.assertTrue(result["requiredComponentsObserved"])
        self.assertNotIn("private", json.dumps(result))
        self.assertTrue(result["manifestVersionMatch"])
        data["packages"].append(data["packages"][0])
        with self.assertRaisesRegex(ValueError, "INV_PROVENANCE"):
            m.provenance_projection(data, PROFILE)

    def test_provenance_wrong_root_and_version(self):
        for data in ({"installationPath": "C:/Foreign", "installationVersion": "18.10.12224.181", "packages": []},
                     {"installationPath": PROFILE["visualStudioRoot"], "installationVersion": "private text", "packages": []}):
            with self.assertRaisesRegex(ValueError, "INV_PROVENANCE"):
                m.provenance_projection(data, PROFILE)

    def test_closed_targets_and_aggregate_maximum(self):
        rows = m.targets(PROFILE)
        self.assertEqual(len(rows), 21)
        self.assertEqual(len({r[0] for r in rows}), 21)
        self.assertTrue(all("arm64" in str(p) or k.startswith("header-") or k.startswith("sdk-") for k, p, _ in rows))
        self.assertNotIn("subprocess", Path(__file__).with_name("observe.py").read_text())

    def test_inventory_reports_absent_sdk_without_claiming_compatibility(self):
        state = {"installationPath": PROFILE["visualStudioRoot"], "installationVersion": PROFILE["visualStudioVersion"], "packages": []}
        state_raw = json.dumps(state).encode()
        def read(path, budget, retain=0, maximum=m.MAX_FILE):
            if str(path).endswith("state.json"):
                return {"present": True, "bytes": len(state_raw), "sha256": "a" * 64}, state_raw
            return {"present": False}, b""
        with patch.object(m, "immediate_directories", side_effect=[[PROFILE["toolset"]], ["1234abcd"]]), patch.object(m, "file_record", side_effect=read):
            result = m.inventory(PROFILE, m.Budget())
        self.assertFalse(result["sdk28000Complete"])
        self.assertEqual(len(result["missingRoles"]), 21)
        self.assertFalse(result["publicSetupProvenance"]["requiredComponentsObserved"])

    def test_inventory_rejects_ambiguous_setup_match(self):
        raw = json.dumps({"installationPath": PROFILE["visualStudioRoot"], "installationVersion": PROFILE["visualStudioVersion"], "packages": []}).encode()
        def read(path, budget, retain=0, maximum=m.MAX_FILE):
            return ({"present": True}, raw) if str(path).endswith("state.json") else ({"present": False}, b"")
        with patch.object(m, "immediate_directories", side_effect=[[PROFILE["toolset"]], ["1234abcd", "abcd1234"]]), patch.object(m, "file_record", side_effect=read):
            with self.assertRaisesRegex(ValueError, "INV_PROVENANCE"):
                m.inventory(PROFILE, m.Budget())

    def test_failure_retains_only_closed_current_role_and_completed_rows(self):
        budget, progress = m.Budget(), {}
        def read(path, budget, retain=0, maximum=m.MAX_FILE):
            if budget.role == "host-link.exe":
                raise ValueError("INV_CHANGED")
            return {"present": False}, b""
        with patch.object(m, "immediate_directories", return_value=[PROFILE["toolset"]]), patch.object(m, "file_record", side_effect=read):
            with self.assertRaisesRegex(ValueError, "INV_CHANGED"):
                m.inventory(PROFILE, budget, progress)
        self.assertEqual(budget.stage, "installed-file")
        self.assertEqual(budget.role, "host-link.exe")
        self.assertEqual(len(progress["partialFixedFileRows"]), 1)
        with self.assertRaisesRegex(ValueError, "INV_PROFILE"):
            budget.phase("installed-file", "arbitrary-private-name")

    def test_pe_machine_header_without_image_execution(self):
        raw = bytearray(128)
        raw[:2] = b"MZ"
        struct.pack_into("<I", raw, 60, 64)
        raw[64:68] = b"PE\0\0"
        struct.pack_into("<H", raw, 68, 0xaa64)
        self.assertEqual(m.pe_machine(raw, len(raw)), 0xaa64)
        for bad in (b"", bytes(128)):
            with self.assertRaisesRegex(ValueError, "INV_PE"):
                m.pe_machine(bad, len(bad))

    def test_output_and_runtime_projection_bounds(self):
        with self.assertRaisesRegex(ValueError, "INV_OUTPUT"):
            m.encode({"public": "a" * m.MAX_OUTPUT})
        result = m.runtime_fields({"ImageOS": "win25", "ImageVersion": "20261007.264.1", "RUNNER_ARCH": "X64", "SECRET": "never"})
        self.assertEqual(set(result), {"ImageOS", "ImageVersion", "RUNNER_ARCH"})
        with self.assertRaisesRegex(ValueError, "INV_RUNTIME"):
            m.runtime_fields({"ImageOS": "private\ntext"})

    def test_error_projection_does_not_leak_arbitrary_exceptions(self):
        self.assertEqual(m.code(OSError("private-path-secret")), "INV_INCOMPLETE")
        self.assertEqual(m.code(ValueError("private-path-secret")), "INV_INCOMPLETE")
        self.assertEqual(m.code(ValueError("INV_CHANGED")), "INV_CHANGED")


if __name__ == "__main__":
    unittest.main()
