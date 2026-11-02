import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn as nativeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import YAML from "yaml";
import os from "node:os";
import * as syncFs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { types as diagnosticTypes } from "node:util";
import ts from "typescript";
import {
  CASES,
  inspectAuthority,
  extractSubject,
  caseFileScope,
  validateControllerResult,
  validateControllerFailure,
  main,
  readReviewedProofPolicy,
} from "../fixtures/cef/windows_arm_qualification_job_proof.mjs";

const KERNEL_DIAGNOSTIC_INVERSE = {
  python: [
    [
      '    "parent-observation-failed": "NATIVE_PARENT_OBSERVATION_FAILED",\n    "prototype-policy-mismatch": "NATIVE_POLICY_MISMATCH",\n}\n_controller_observation = {"phase": "entry", "case": None, "completedCases": 0, "kernel": None}\n\n\ndef _observe_controller(phase, case=None, completed=0):\n    # Observation only: no paths, probes, clocks, assertions or authority.\n    try:\n        if phase in _CONTROLLER_PHASES and (case is None or case in CASES) and type(completed) is int and 0 <= completed <= len(CASES):\n            _controller_observation.update(phase=phase, case=case, completedCases=completed, kernel=None)\n    except BaseException:\n        pass\n\n\n# BEGIN closed kernel result observation\n_KERNEL_OUTCOMES = frozenset(("launcher-failure", "running", "cancelled", "deadline", "log-failure", "output-cap", "success", "compiler-failure", "descendants-left"))\n_KERNEL_BOOL_FIELDS = ("cleanupVerified", "logReadersStopped", "rootReaped", "observerStopped", "started", "resumed", "assignedBeforeResume")\n\n\ndef _observe_kernel_result(result):\n    # Only the exact returned dict\'s primitive fields; no accessors, raw logs,\n    # messages, paths, exception objects or additional native observation.\n    try:\n        _controller_observation["kernel"] = None\n        if type(result) is not dict or len(result) > 64 or not all(type(key) is str and len(key) <= 64 for key in dict.keys(result)) or dict.get(_controller_observation, "phase") != "case-readback":\n            return\n        value = {"outcome": None, "rootExit": None, "nativeStage": None, "nativeErrno": None, "activeAtEnd": None}\n        for name in _KERNEL_BOOL_FIELDS:\n            field = dict.get(result, name)\n            value[name] = field if type(field) is bool else None\n        field = dict.get(result, "outcome")\n        if type(field) is str and len(field) <= 64 and field in _KERNEL_OUTCOMES:\n            value["outcome"] = field\n        for original, projected, maximum in (("rootExit", "rootExit", 4294967295), ("winerror", "nativeErrno", 4294967295), ("activeAtEnd", "activeAtEnd", 64)):\n            field = dict.get(result, original)\n            if type(field) is int and 0 <= field <= maximum:\n                value[projected] = field\n        field = dict.get(result, "failureStage")\n        if type(field) is str and len(field) <= 64 and (field in _CONTROLLER_STAGES or field == "launcher-io"):\n            value["nativeStage"] = field\n        _controller_observation["kernel"] = value\n    except BaseException:\n        pass\n# END closed kernel result observation\n\n\ndef controller_failure(error):\n    value = {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",\n             "complete": False, "failure": "PROOF_DENIED", "phase": "entry",\n             "case": None, "completedCases": 0, "code": "UNKNOWN",\n             "nativeStage": None, "nativeErrno": None, "kernel": None,\n             "productionAdmission": False, "runtimeReady": False}\n    try:\n        phase = dict.get(_controller_observation, "phase")\n',
      '    "parent-observation-failed": "NATIVE_PARENT_OBSERVATION_FAILED",\n    "prototype-policy-mismatch": "NATIVE_POLICY_MISMATCH",\n}\n_controller_observation = {"phase": "entry", "case": None, "completedCases": 0}\n\n\ndef _observe_controller(phase, case=None, completed=0):\n    # Observation only: no paths, probes, clocks, assertions or authority.\n    try:\n        if phase in _CONTROLLER_PHASES and (case is None or case in CASES) and type(completed) is int and 0 <= completed <= len(CASES):\n            _controller_observation.update(phase=phase, case=case, completedCases=completed)\n    except BaseException:\n        pass\n\n\ndef controller_failure(error):\n    value = {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",\n             "complete": False, "failure": "PROOF_DENIED", "phase": "entry",\n             "case": None, "completedCases": 0, "code": "UNKNOWN",\n             "nativeStage": None, "nativeErrno": None,\n             "productionAdmission": False, "runtimeReady": False}\n    try:\n        phase = dict.get(_controller_observation, "phase")\n',
    ],
    [
      '            value["case"] = case\n        if type(completed) is int and 0 <= completed <= len(CASES):\n            value["completedCases"] = completed\n        # The observer already copied every permitted primitive. Copy again so\n        # the emitted envelope cannot alias even that private observation dict.\n        kernel = dict.get(_controller_observation, "kernel")\n        if value["phase"] == "case-readback" and type(kernel) is dict:\n            value["kernel"] = dict.copy(kernel)\n        # Built-in descriptors bypass user __getattribute__, properties and str.\n        args = BaseException.args.__get__(error, BaseException)\n        if type(args) is tuple and len(args) == 1 and type(args[0]) is str and len(args[0]) <= 64:\n',
      '            value["case"] = case\n        if type(completed) is int and 0 <= completed <= len(CASES):\n            value["completedCases"] = completed\n        # Built-in descriptors bypass user __getattribute__, properties and str.\n        args = BaseException.args.__get__(error, BaseException)\n        if type(args) is tuple and len(args) == 1 and type(args[0]) is str and len(args[0]) <= 64:\n',
    ],
    [
      '    return {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",\n            "complete": False, "failure": "PROOF_DENIED", "phase": "entry",\n            "case": None, "completedCases": 0, "code": "UNKNOWN",\n            "nativeStage": None, "nativeErrno": None, "kernel": None,\n            "productionAdmission": False, "runtimeReady": False}\n# END bounded controller failure observation\n\n',
      '    return {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",\n            "complete": False, "failure": "PROOF_DENIED", "phase": "entry",\n            "case": None, "completedCases": 0, "code": "UNKNOWN",\n            "nativeStage": None, "nativeErrno": None,\n            "productionAdmission": False, "runtimeReady": False}\n# END bounded controller failure observation\n\n',
    ],
    [
      '            _observe_controller("case-run", name, len(case_rows))  # controller-observation\n            result = kernel.run_job(command, case, case / "jobs" / role, seconds, cancel=Cancellation(), cap=p["caseOutputCapBytes"], _test_observe=observer)\n            _observe_controller("case-readback", name, len(case_rows))  # controller-observation\n            _observe_kernel_result(result)  # closed-kernel-observation\n            clock.left()\n            held(Path(p["python"]["path"]), p["python"]["bytes"], p["python"])\n            held(Path(p["node"]["path"]), p["node"]["bytes"], p["node"])\n',
      '            _observe_controller("case-run", name, len(case_rows))  # controller-observation\n            result = kernel.run_job(command, case, case / "jobs" / role, seconds, cancel=Cancellation(), cap=p["caseOutputCapBytes"], _test_observe=observer)\n            _observe_controller("case-readback", name, len(case_rows))  # controller-observation\n            clock.left()\n            held(Path(p["python"]["path"]), p["python"]["bytes"], p["python"])\n            held(Path(p["node"]["path"]), p["node"]["bytes"], p["node"])\n',
    ],
  ],
  node: [
    [
      '  "verify-child-job",\n  "wait-root",\n]);\n// BEGIN closed kernel result validation\nconst CONTROLLER_KERNEL_OUTCOMES = new Set([\n  "launcher-failure",\n  "running",\n  "cancelled",\n  "deadline",\n  "log-failure",\n  "output-cap",\n  "success",\n  "compiler-failure",\n  "descendants-left",\n]);\nfunction validateKernelFailure(value) {\n  if (value === null) return;\n  exact(value, [\n    "outcome",\n    "rootExit",\n    "nativeStage",\n    "nativeErrno",\n    "activeAtEnd",\n    "cleanupVerified",\n    "logReadersStopped",\n    "rootReaped",\n    "observerStopped",\n    "started",\n    "resumed",\n    "assignedBeforeResume",\n  ]);\n  const integer = (field, maximum) =>\n    field === null ||\n    (Number.isSafeInteger(field) && field >= 0 && field <= maximum);\n  need(\n    value.outcome === null ||\n      (typeof value.outcome === "string" &&\n        CONTROLLER_KERNEL_OUTCOMES.has(value.outcome)),\n    "PROOF_SCHEMA",\n  );\n  need(\n    integer(value.rootExit, 4294967295) &&\n      integer(value.nativeErrno, 4294967295) &&\n      integer(value.activeAtEnd, 64),\n    "PROOF_SCHEMA",\n  );\n  need(\n    value.nativeStage === null ||\n      (typeof value.nativeStage === "string" &&\n        (CONTROLLER_FAILURE_STAGES.has(value.nativeStage) ||\n          value.nativeStage === "launcher-io")),\n    "PROOF_SCHEMA",\n  );\n  for (const key of [\n    "cleanupVerified",\n    "logReadersStopped",\n    "rootReaped",\n    "observerStopped",\n    "started",\n    "resumed",\n    "assignedBeforeResume",\n  ])\n    need(\n      value[key] === null || typeof value[key] === "boolean",\n      "PROOF_SCHEMA",\n    );\n}\n// END closed kernel result validation\nexport function validateControllerFailure(raw) {\n  try {\n    if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > 2048)\n',
      '  "verify-child-job",\n  "wait-root",\n]);\nexport function validateControllerFailure(raw) {\n  try {\n    if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > 2048)\n',
    ],
    [
      '      "code",\n      "nativeStage",\n      "nativeErrno",\n      "kernel",\n      "productionAdmission",\n      "runtimeReady",\n    ]);\n',
      '      "code",\n      "nativeStage",\n      "nativeErrno",\n      "productionAdmission",\n      "runtimeReady",\n    ]);\n',
    ],
    [
      '      ) ||\n      value.productionAdmission !== false ||\n      value.runtimeReady !== false\n    )\n      return null;\n    validateKernelFailure(value.kernel);\n    if (\n      value.kernel !== null &&\n      (value.phase !== "case-readback" || !CASES.includes(value.case))\n    )\n      return null;\n    return value;\n',
      "      ) ||\n      value.productionAdmission !== false ||\n      value.runtimeReady !== false\n    )\n      return null;\n    return value;\n",
    ],
  ],
};
function previousActorLiveness(text) {
  const start = text.indexOf(
    '  if (kind === "orphan" || kind === "pipe-descendant" || kind === "middle") {\n',
  );
  assert(start > 0);
  const end = text.indexOf('  need(false, "PROOF_ACTOR");', start);
  assert(end > start);
  const branch = text.slice(start, end);
  assert.equal(branch.split("        detached: true,\n").length, 2);
  return (
    text.slice(0, start) +
    branch.replace("        detached: true,\n", "        detached: false,\n") +
    text.slice(end)
  );
}
function previousKernelResultDiagnostics(text, role) {
  if (role === "node") text = previousActorLiveness(text);
  for (const [current, previous] of KERNEL_DIAGNOSTIC_INVERSE[role]) {
    assert.equal(
      text.split(current).length,
      2,
      role + " exact closed-kernel inverse",
    );
    text = text.replace(current, previous);
  }
  return text;
}

// Exact historical views are used only by the pre-registry inverse guards.
const REVIEWED_REGISTRY_INVERSE = {
  python: [
    [
      "import time\nimport types\n\nPROFILE_SHA = \"63c72846b9506a78f6d968a64445a9f495bc04523509327c43286dde1baa6240\"\nREPO = Path(__file__).resolve().parents[2]\nPROFILE = Path(__file__).with_name(\"qualification-job-proof-profile.json\")\n# BEGIN fixed reviewed-image registry\nREVIEWED_IMAGES = {'20261021.278.1': {'profile': 'qualification-job-proof-20261021-profile.json', 'bytes': 3210, 'sha256': 'bf1d4969b8b2a20164440e7a3b52a6ca5d64d80f2427192cbb9bb8cf918850c2', 'sourceProfile': 'image-qualified-20261021-profile.json', 'sourceBytes': 35867, 'sourceSha256': '3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637', 'sourceId': 'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa'}, '20261030.294.1': {'profile': 'qualification-job-proof-20261030-profile.json', 'bytes': 3210, 'sha256': '44ab70cfc7a8a37c3e79c96d2a1c167830d3d3af57116d5ff83b4918023edad9', 'sourceProfile': 'image-qualified-current-profile.json', 'sourceBytes': 34813, 'sourceSha256': '55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041', 'sourceId': 'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90'}}\nPRIVATE_POLICY = {'path': 'private-qualification-profile.json', 'bytes': 22347, 'sha256': 'e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052'}\ndef selected_profile_sha(p):\n    return REVIEWED_IMAGES[p[\"image\"]][\"sha256\"]\n# END fixed reviewed-image registry\nCASES = (\n    \"six-role-normal\", \"second-role-nonzero\", \"session-cancel-after-owned-output\",\n    \"preaborted\", \"outer-cancel-after-assignment-before-resume\",\n",
      'import time\nimport types\n\nPROFILE_SHA = "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c"\nREPO = Path(__file__).resolve().parents[2]\nPROFILE = Path(__file__).with_name("qualification-job-proof-profile.json")\nCASES = (\n    "six-role-normal", "second-role-nonzero", "session-cancel-after-owned-output",\n    "preaborted", "outer-cancel-after-assignment-before-resume",\n',
    ],
    [
      '\n\ndef profile():\n    image = os.environ.get("ImageVersion")\n    need(image in REVIEWED_IMAGES, "PROOF_AUTHORITY")\n    row = REVIEWED_IMAGES[image]\n    raw = held(PROFILE, 65536)\n    need(sha(raw) == PROFILE_SHA, "PROOF_PROFILE")\n    registry = json.loads(raw)\n    value = json.loads(held(PROFILE.parent / row["profile"], row["bytes"], row))\n    source = json.loads(held(PROFILE.parent / row["sourceProfile"], row["sourceBytes"], {"bytes":row["sourceBytes"], "sha256":row["sourceSha256"]}))\n    private = json.loads(held(PROFILE.parent / PRIVATE_POLICY["path"], PRIVATE_POLICY["bytes"], PRIVATE_POLICY))\n    need(registry["profiles"] == REVIEWED_IMAGES and registry["kind"] == "windows-benign-reviewed-image-registry" and registry["schemaVersion"] == 1 and\n         all(value[key] == registry[key] for key in ("ref", "workflow", "repository", "repositoryId", "sourcePaths")) and\n         value["image"] == image == os.environ.get("ImageVersion") and len(value["sourcePaths"]) == 12 and\n         source["image"] == image and private["images"][image]["sourceId"] == row["sourceId"] and private["images"][image]["profileSha256"] == row["sourceSha256"] and\n         private["tools"]["python"] == value["python"] and private["driverNode"] == value["node"] and\n         private["staticLoadingPolicy"]["systemImageIsTrustedTcb"] is True and private["staticLoadingPolicy"]["actualLoaderClosureApproved"] is False and private["staticLoadingPolicy"]["system32ByteSetProven"] is False and\n         value["cases"] == list(CASES) and value["suiteSeconds"] == 300 and value["workSeconds"] == 150 and value["finalReserveSeconds"] == 150, "PROOF_POLICY")\n    return value\n\n\n',
      '\n\ndef profile():\n    raw = held(PROFILE, 65536)\n    need(sha(raw) == PROFILE_SHA, "PROOF_PROFILE")\n    value = json.loads(raw)\n    need(value["cases"] == list(CASES) and value["suiteSeconds"] == 300 and value["workSeconds"] == 150 and value["finalReserveSeconds"] == 150, "PROOF_POLICY")\n    return value\n\n\n',
    ],
    [
      '    return module\n\n\ndef launch_environment(root, image):\n    need(image in REVIEWED_IMAGES and os.environ.get("ImageVersion") == image, "PROOF_ENVIRONMENT")\n    value = {"ImageVersion": image, "SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "PATH": "C:/Windows/System32", "TEMP": str(root / "tmp"), "TMP": str(root / "tmp"), "USERPROFILE": str(root / "home"), "PYTHONDONTWRITEBYTECODE": "1"}\n    tracking = os.environ.get("RUNNER_TRACKING_ID")\n    if tracking:\n        need(len(tracking) <= 256 and tracking.isascii() and all(32 <= ord(c) < 127 for c in tracking), "PROOF_TRACKING")\n',
      '    return module\n\n\ndef launch_environment(root):\n    value = {"SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "PATH": "C:/Windows/System32", "TEMP": str(root / "tmp"), "TMP": str(root / "tmp"), "USERPROFILE": str(root / "home"), "PYTHONDONTWRITEBYTECODE": "1"}\n    tracking = os.environ.get("RUNNER_TRACKING_ID")\n    if tracking:\n        need(len(tracking) <= 256 and tracking.isascii() and all(32 <= ord(c) < 127 for c in tracking), "PROOF_TRACKING")\n',
    ],
    [
      '    _observe_controller("suite-context")  # controller-observation\n    context = json.loads(context_raw)\n    clock = SuiteClock(context["startedMs"])\n    need(context["kind"] == "windows-benign-job-preparation" and context["head"] == os.environ.get("GITHUB_SHA") and context["image"] == p["image"] and context["selectedProfileSha256"] == selected_profile_sha(p), "PROOF_CONTEXT")\n    root = checked_root(root, context["nonce"])\n    root_identity = identity(root.lstat())\n    _observe_controller("source-witnesses")  # controller-observation\n',
      '    _observe_controller("suite-context")  # controller-observation\n    context = json.loads(context_raw)\n    clock = SuiteClock(context["startedMs"])\n    need(context["kind"] == "windows-benign-job-preparation" and context["head"] == os.environ.get("GITHUB_SHA"), "PROOF_CONTEXT")\n    root = checked_root(root, context["nonce"])\n    root_identity = identity(root.lstat())\n    _observe_controller("source-witnesses")  # controller-observation\n',
    ],
    [
      '        event = threading.Event()\n        if name == "preaborted":\n            event.set()\n        case_context = {"image": p["image"], "selectedProfileSha256": selected_profile_sha(p), "kind": "windows-benign-job-case", "case": name, "root": str(case), "nonce": context["nonce"], "head": context["head"], "sourceHead": context["head"], "workEndMs": min(context["startedMs"] + 150000, int(time.time() * 1000 + (20 if name == "deadline-with-pipe-descendant" else seconds) * 1000)), "subjectSha256": p["subject"]["sha256"]}\n        raw = (json.dumps(case_context, separators=(",", ":")) + "\\n").encode()\n        case_file = case / "case.json"\n        with case_file.open("xb") as stream:\n',
      '        event = threading.Event()\n        if name == "preaborted":\n            event.set()\n        case_context = {"kind": "windows-benign-job-case", "case": name, "root": str(case), "nonce": context["nonce"], "head": context["head"], "sourceHead": context["head"], "workEndMs": min(context["startedMs"] + 150000, int(time.time() * 1000 + (20 if name == "deadline-with-pipe-descendant" else seconds) * 1000)), "subjectSha256": p["subject"]["sha256"]}\n        raw = (json.dumps(case_context, separators=(",", ":")) + "\\n").encode()\n        case_file = case / "case.json"\n        with case_file.open("xb") as stream:\n',
    ],
    [
      '        previous = sys.modules.get("producer")\n        sys.modules["producer"] = producer\n        kernel.approved_tool_command = lambda argv, cwd: role if argv == command and Path(cwd) == case else need(False, "PROOF_COMMAND")\n        kernel.launch_environment = lambda selected, cwd: launch_environment(case, p["image"]) if selected == role and Path(cwd) == case else need(False, "PROOF_ENVIRONMENT")\n        ledger = CloseLedger(kernel.close, p["maxCloseCalls"], kernel.C.get_last_error, kernel.C.set_last_error)\n        native_close = kernel.close\n        kernel.close = ledger\n',
      '        previous = sys.modules.get("producer")\n        sys.modules["producer"] = producer\n        kernel.approved_tool_command = lambda argv, cwd: role if argv == command and Path(cwd) == case else need(False, "PROOF_COMMAND")\n        kernel.launch_environment = lambda selected, cwd: launch_environment(case) if selected == role and Path(cwd) == case else need(False, "PROOF_ENVIRONMENT")\n        ledger = CloseLedger(kernel.close, p["maxCloseCalls"], kernel.C.get_last_error, kernel.C.set_last_error)\n        native_close = kernel.close\n        kernel.close = ledger\n',
    ],
    [
      '    cleanup = remove_owned_tree(root, root_identity, clock, cleanup_paths())\n    need(cleanup["readHandlesClosed"] is True, "PROOF_CLEANUP_CLOSE")\n    clock.left()\n    return {"schemaVersion": 2, "image": p["image"], "selectedProfileSha256": selected_profile_sha(p), "kind": "windows-benign-job-controller-result", "complete": True, "nonce": context["nonce"], "head": context["head"], "cases": case_rows, "rawReceipts": receipts, "scratchRemoved": True, "productionAdmission": False, "sourceGnQualified": False, "compilerAdmission": False, "nativeAcceptance": False, "runtimeReady": False}\n\n\ndef main(argv):\n',
      '    cleanup = remove_owned_tree(root, root_identity, clock, cleanup_paths())\n    need(cleanup["readHandlesClosed"] is True, "PROOF_CLEANUP_CLOSE")\n    clock.left()\n    return {"schemaVersion": 1, "kind": "windows-benign-job-controller-result", "complete": True, "nonce": context["nonce"], "head": context["head"], "cases": case_rows, "rawReceipts": receipts, "scratchRemoved": True, "productionAdmission": False, "sourceGnQualified": False, "compilerAdmission": False, "nativeAcceptance": False, "runtimeReady": False}\n\n\ndef main(argv):\n',
    ],
  ],
  node: [
    [
      '  "native/windows-arm-full-sdk/qualification-job-proof-profile.json",\n);\nconst PROFILE_SHA =\n  "63c72846b9506a78f6d968a64445a9f495bc04523509327c43286dde1baa6240";\n// BEGIN fixed reviewed-image registry\nconst REVIEWED_IMAGES = Object.freeze({\n  "20261021.278.1": {\n    profile: "qualification-job-proof-20261021-profile.json",\n    bytes: 3210,\n    sha256: "bf1d4969b8b2a20164440e7a3b52a6ca5d64d80f2427192cbb9bb8cf918850c2",\n    sourceProfile: "image-qualified-20261021-profile.json",\n    sourceBytes: 35867,\n    sourceSha256:\n      "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n    sourceId:\n      "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",\n  },\n  "20261030.294.1": {\n    profile: "qualification-job-proof-20261030-profile.json",\n    bytes: 3210,\n    sha256: "44ab70cfc7a8a37c3e79c96d2a1c167830d3d3af57116d5ff83b4918023edad9",\n    sourceProfile: "image-qualified-current-profile.json",\n    sourceBytes: 34813,\n    sourceSha256:\n      "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n    sourceId:\n      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",\n  },\n});\nconst PRIVATE_POLICY = Object.freeze({\n  path: "private-qualification-profile.json",\n  bytes: 22347,\n  sha256: "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",\n});\nconst selectedProfileSha = (p) => REVIEWED_IMAGES[p.image]?.sha256;\nfunction freezePolicy(value) {\n  if (value && typeof value === "object") {\n    for (const child of Object.values(value)) freezePolicy(child);\n    Object.freeze(value);\n  }\n  return value;\n}\n// END fixed reviewed-image registry\nconst ROLES = Object.freeze([\n  "qual-gn-desc-pa",\n  "qual-gn-desc-cef",\n',
      '  "native/windows-arm-full-sdk/qualification-job-proof-profile.json",\n);\nconst PROFILE_SHA =\n  "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c";\nconst ROLES = Object.freeze([\n  "qual-gn-desc-pa",\n  "qual-gn-desc-cef",\n',
    ],
    [
      '  }\n}\nasync function policy(end = Infinity) {\n  const image = process.env.ImageVersion;\n  need(Object.hasOwn(REVIEWED_IMAGES, image ?? ""), "PROOF_AUTHORITY");\n  const row = REVIEWED_IMAGES[image];\n  const { raw } = await held(PROFILE, 65536, undefined, true, end);\n  need(hash(raw) === PROFILE_SHA, "PROOF_PROFILE");\n  const registry = JSON.parse(raw);\n  const selected = await held(\n    path.join(path.dirname(PROFILE), row.profile),\n    row.bytes,\n    row,\n    true,\n    end,\n  );\n  const p = JSON.parse(selected.raw);\n  const source = await held(\n    path.join(path.dirname(PROFILE), row.sourceProfile),\n    row.sourceBytes,\n    { bytes: row.sourceBytes, sha256: row.sourceSha256 },\n    true,\n    end,\n  );\n  const sourcePolicy = JSON.parse(source.raw);\n  const privateRaw = await held(\n    path.join(path.dirname(PROFILE), PRIVATE_POLICY.path),\n    PRIVATE_POLICY.bytes,\n    PRIVATE_POLICY,\n    true,\n    end,\n  );\n  const privatePolicy = JSON.parse(privateRaw.raw);\n  need(\n    JSON.stringify(registry.profiles) === JSON.stringify(REVIEWED_IMAGES) &&\n      registry.kind === "windows-benign-reviewed-image-registry" &&\n      registry.schemaVersion === 1 &&\n      p.ref === registry.ref &&\n      p.workflow === registry.workflow &&\n      p.repository === registry.repository &&\n      p.repositoryId === registry.repositoryId &&\n      p.image === image &&\n      process.env.ImageVersion === image &&\n      p.sourcePaths.length === 12 &&\n      JSON.stringify(p.sourcePaths) === JSON.stringify(registry.sourcePaths) &&\n      sourcePolicy.image === image &&\n      privatePolicy.images[image].sourceId === row.sourceId &&\n      privatePolicy.images[image].profileSha256 === row.sourceSha256 &&\n      JSON.stringify(privatePolicy.tools.python) === JSON.stringify(p.python) &&\n      JSON.stringify(privatePolicy.driverNode) === JSON.stringify(p.node) &&\n      privatePolicy.staticLoadingPolicy.systemImageIsTrustedTcb === true &&\n      privatePolicy.staticLoadingPolicy.actualLoaderClosureApproved === false &&\n      privatePolicy.staticLoadingPolicy.system32ByteSetProven === false &&\n      JSON.stringify(p.cases) === JSON.stringify(CASES) &&\n      p.suiteSeconds === 300 &&\n      p.workSeconds === 150 &&\n      p.finalReserveSeconds === 150,\n    "PROOF_POLICY",\n  );\n  checkEnd(end);\n  return freezePolicy(p);\n}\n// Metadata only: returns held, fixed data, never a production capability.\nexport { policy as readReviewedProofPolicy };\nexport function inspectAuthority(p, env, host) {\n  need(\n    p.workflowActivation === true && p.proofExecutionAdmitted === true,\n',
      '  }\n}\nasync function policy(end = Infinity) {\n  const { raw } = await held(PROFILE, 65536, undefined, true, end);\n  need(hash(raw) === PROFILE_SHA, "PROOF_PROFILE");\n  const p = JSON.parse(raw);\n  need(\n    JSON.stringify(p.cases) === JSON.stringify(CASES) &&\n      p.suiteSeconds === 300 &&\n      p.workSeconds === 150 &&\n      p.finalReserveSeconds === 150,\n    "PROOF_POLICY",\n  );\n  return p;\n}\nexport function inspectAuthority(p, env, host) {\n  need(\n    p.workflowActivation === true && p.proofExecutionAdmitted === true,\n',
    ],
    [
      'export function validateControllerResult(value, p, nonce, head) {\n  exact(value, [\n    "schemaVersion",\n    "image",\n    "selectedProfileSha256",\n    "kind",\n    "complete",\n    "nonce",\n',
      'export function validateControllerResult(value, p, nonce, head) {\n  exact(value, [\n    "schemaVersion",\n    "kind",\n    "complete",\n    "nonce",\n',
    ],
    [
      '    "runtimeReady",\n  ]);\n  need(\n    value.schemaVersion === 2 &&\n      Object.hasOwn(REVIEWED_IMAGES, p.image ?? "") &&\n      value.image === p.image &&\n      value.selectedProfileSha256 === selectedProfileSha(p) &&\n      value.kind === "windows-benign-job-controller-result" &&\n      value.complete === true &&\n      value.nonce === nonce &&\n',
      '    "runtimeReady",\n  ]);\n  need(\n    value.schemaVersion === 1 &&\n      value.kind === "windows-benign-job-controller-result" &&\n      value.complete === true &&\n      value.nonce === nonce &&\n',
    ],
    [
      '  });\n  return {\n    proof: {\n      schemaVersion: 2,\n      image: p.image,\n      selectedProfileSha256: selectedProfileSha(p),\n      kind: "windows-private-benign-job-proof",\n      complete: true,\n      nonce,\n',
      '  });\n  return {\n    proof: {\n      schemaVersion: 1,\n      kind: "windows-private-benign-job-proof",\n      complete: true,\n      nonce,\n',
    ],
    [
      '    "sourceHead",\n    "workEndMs",\n    "subjectSha256",\n    "image",\n    "selectedProfileSha256",\n  ]);\n  need(\n    context.kind === "windows-benign-job-case" &&\n      context.image === p.image &&\n      context.selectedProfileSha256 === selectedProfileSha(p) &&\n      context.case === name &&\n      context.nonce === nonce &&\n      context.subjectSha256 === p.subject.sha256 &&\n',
      '    "sourceHead",\n    "workEndMs",\n    "subjectSha256",\n  ]);\n  need(\n    context.kind === "windows-benign-job-case" &&\n      context.case === name &&\n      context.nonce === nonce &&\n      context.subjectSha256 === p.subject.sha256 &&\n',
    ],
    [
      "    ).raw,\n  );\n  need(\n    context.image === p.image &&\n      context.selectedProfileSha256 === selectedProfileSha(p) &&\n      context.case === name &&\n      context.nonce === nonce &&\n      Date.now() < context.workEndMs &&\n      path.dirname(file) === context.root,\n",
      "    ).raw,\n  );\n  need(\n    context.case === name &&\n      context.nonce === nonce &&\n      Date.now() < context.workEndMs &&\n      path.dirname(file) === context.root,\n",
    ],
    [
      '  const preparation = Buffer.from(\n    JSON.stringify({\n      kind: "windows-benign-job-preparation",\n      image: p.image,\n      selectedProfileSha256: selectedProfileSha(p),\n      nonce,\n      head,\n      startedMs,\n',
      '  const preparation = Buffer.from(\n    JSON.stringify({\n      kind: "windows-benign-job-preparation",\n      nonce,\n      head,\n      startedMs,\n',
    ],
  ],
  workflow: [
    [
      "  cancel-in-progress: false\njobs:\n  proof:\n    if: github.event_name == 'workflow_dispatch' && github.event.repository.visibility == 'public' && github.repository == 'supermarsx/sortOfRemoteNG' && github.repository_id == '1010282954' && github.event.repository.default_branch == 'main' && github.ref == 'refs/heads/codex/windows-arm-benign-reviewed-images-20261102'\n    runs-on: windows-2025-vs2026\n    timeout-minutes: 10\n    env:\n",
      "  cancel-in-progress: false\njobs:\n  proof:\n    if: github.event_name == 'workflow_dispatch' && github.event.repository.visibility == 'public' && github.repository == 'supermarsx/sortOfRemoteNG' && github.repository_id == '1010282954' && github.event.repository.default_branch == 'main' && github.ref == 'refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102'\n    runs-on: windows-2025-vs2026\n    timeout-minutes: 10\n    env:\n",
    ],
    [
      "        run: |\n          $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n          \"CEF_WINDOWS_BENIGN_JOB_STARTED_MS=$started\" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append\n          if ($env:ImageVersion -cne '20261021.278.1' -and $env:ImageVersion -cne '20261030.294.1') { throw 'PROOF_IMAGE_DENIED' }\n          $present = Test-Path -LiteralPath 'C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe' -PathType Leaf\n          \"python_required=$((-not $present).ToString().ToLowerInvariant())\" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append\n      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n",
      "        run: |\n          $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n          \"CEF_WINDOWS_BENIGN_JOB_STARTED_MS=$started\" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append\n          if ($env:ImageVersion -cne '20261021.278.1') { throw 'PROOF_IMAGE_DENIED' }\n          $present = Test-Path -LiteralPath 'C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe' -PathType Leaf\n          \"python_required=$((-not $present).ToString().ToLowerInvariant())\" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append\n      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n",
    ],
    [
      "          await physical(root);\n          const before = new Set(await fs.readdir(artifacts).catch(error => {if(error.code==='ENOENT')return [];throw error;}));\n          phase = 'import';\n          const {main, readReviewedProofPolicy, inspectAuthority, validateControllerResult} = await import('./tests/fixtures/cef/windows_arm_qualification_job_proof.mjs');\n          phase = 'policy';\n          const policy = await readReviewedProofPolicy(clock.monotonicEnd);\n          phase = 'authority';\n          inspectAuthority(policy,process.env,process);\n          // Every checkout/setup/import consumes the original job envelope.\n",
      "          await physical(root);\n          const before = new Set(await fs.readdir(artifacts).catch(error => {if(error.code==='ENOENT')return [];throw error;}));\n          phase = 'import';\n          const {main, inspectAuthority, validateControllerResult} = await import('./tests/fixtures/cef/windows_arm_qualification_job_proof.mjs');\n          phase = 'policy';\n          const policy = JSON.parse(await fs.readFile('native/windows-arm-full-sdk/qualification-job-proof-profile.json','utf8'));\n          phase = 'authority';\n          inspectAuthority(policy,process.env,process);\n          // Every checkout/setup/import consumes the original job envelope.\n",
    ],
    [
      "          const proofRaw=await held('proof.json'),proof=JSON.parse(proofRaw);\n          const receipts=[];for(let i=0;i<9;i++)receipts.push(await held(`receipt-${i}.json`));\n          phase = 'validate';\n          const checked=validateControllerResult({schemaVersion:2,image:proof.image,selectedProfileSha256:proof.selectedProfileSha256,kind:'windows-benign-job-controller-result',complete:proof.complete,nonce:proof.nonce,head:proof.head,cases:proof.cases,rawReceipts:receipts.map(raw=>raw.toString('base64')),scratchRemoved:proof.scratchRemoved,productionAdmission:proof.productionAdmission,sourceGnQualified:proof.sourceGnQualified,compilerAdmission:proof.compilerAdmission,nativeAcceptance:proof.nativeAcceptance,runtimeReady:proof.runtimeReady},policy,nonce,process.env.GITHUB_SHA);\n          assert.deepEqual(checked.proof,proof,'PROOF_REPORT_BINDING');\n          assert(signature(await fs.lstat(directory,{bigint:true}))===directoryIdentity,'PROOF_REPORT_ROOT');\n          checkOriginalJob(clock);\n",
      "          const proofRaw=await held('proof.json'),proof=JSON.parse(proofRaw);\n          const receipts=[];for(let i=0;i<9;i++)receipts.push(await held(`receipt-${i}.json`));\n          phase = 'validate';\n          const checked=validateControllerResult({schemaVersion:1,kind:'windows-benign-job-controller-result',complete:proof.complete,nonce:proof.nonce,head:proof.head,cases:proof.cases,rawReceipts:receipts.map(raw=>raw.toString('base64')),scratchRemoved:proof.scratchRemoved,productionAdmission:proof.productionAdmission,sourceGnQualified:proof.sourceGnQualified,compilerAdmission:proof.compilerAdmission,nativeAcceptance:proof.nativeAcceptance,runtimeReady:proof.runtimeReady},policy,nonce,process.env.GITHUB_SHA);\n          assert.deepEqual(checked.proof,proof,'PROOF_REPORT_BINDING');\n          assert(signature(await fs.lstat(directory,{bigint:true}))===directoryIdentity,'PROOF_REPORT_ROOT');\n          checkOriginalJob(clock);\n",
    ],
  ],
};
function previousReviewedImages(text, role) {
  if (role !== "workflow") text = previousKernelResultDiagnostics(text, role);
  for (const [current, previous] of REVIEWED_REGISTRY_INVERSE[role]) {
    assert.equal(
      text.split(current).length,
      2,
      role + " exact registry inverse",
    );
    text = text.replace(current, previous);
  }
  return text;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = path.join(ROOT, "native/windows-arm-full-sdk");
const rawRegistry = await fs.readFile(
  path.join(DIR, "qualification-job-proof-profile.json"),
);
const registry = JSON.parse(rawRegistry);
const rawPolicy = await fs.readFile(
  path.join(DIR, registry.profiles["20261021.278.1"].profile),
);
const policy = JSON.parse(rawPolicy);
const legacyPolicy = {
  ...policy,
  ref: "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102",
  sourcePaths: policy.sourcePaths.slice(0, 8),
};
const legacyRawPolicy = Buffer.from(
  JSON.stringify(legacyPolicy, null, 2) + "\n",
);
const fixture = await fs
  .readFile(
    path.join(
      ROOT,
      "tests/fixtures/cef/windows_arm_qualification_job_proof.mjs",
    ),
    "utf8",
  )
  .then((raw) => raw.replaceAll("\r\n", "\n"));
const adapter = await fs
  .readFile(path.join(DIR, "qualification-job-proof.py"), "utf8")
  .then((raw) => raw.replaceAll("\r\n", "\n"));
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const nonce = "12345678-1234-4123-8123-123456789abc",
  head = "a".repeat(40);
const host = { platform: "win32", arch: "x64" };
const admitted = {
  ...policy,
  workflowActivation: true,
  proofExecutionAdmitted: true,
};
function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: policy.repository,
    GITHUB_REPOSITORY_ID: policy.repositoryId,
    GITHUB_REF: policy.ref,
    ImageVersion: policy.image,
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_WORKFLOW_REF: `${policy.repository}/${policy.workflow}@${policy.ref}`,
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "1",
  };
}
function synthetic() {
  const result = {
    schemaVersion: 2,
    image: policy.image,
    selectedProfileSha256: registry.profiles[policy.image].sha256,
    kind: "windows-benign-job-controller-result",
    complete: true,
    nonce,
    head,
    cases: [],
    rawReceipts: [],
    scratchRemoved: true,
    productionAdmission: false,
    sourceGnQualified: false,
    compilerAdmission: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  for (const name of CASES) {
    const created = name !== "preaborted",
      resumed =
        created && name !== "outer-cancel-after-assignment-before-resume";
    const outcome = [
      "preaborted",
      "outer-cancel-after-assignment-before-resume",
    ].includes(name)
      ? "cancelled"
      : name === "deadline-with-pipe-descendant"
        ? "deadline"
        : ["closed-pipe-orphan", "reparented-descendant"].includes(name)
          ? "descendants-left"
          : "success";
    const kernel = {
      kind: "owned-job-proof",
      outcome,
      started: created,
      assignedBeforeResume: created,
      resumed,
      jobCreated: created,
      cleanupVerified: true,
      activeAtEnd: 0,
      logReadersStopped: true,
      success: outcome === "success",
      rootExit:
        outcome === "success" || outcome === "descendants-left" ? 0 : null,
      observedChildrenReaped: outcome === "descendants-left" ? 1 : 0,
      ...(created
        ? {
            assignedAtCreationVerified: true,
            observerStopped: true,
            handleListOnly: true,
            assignmentMode: "creation-attribute",
            rootReaped: true,
            policyReadback: {
              flags: 8712,
              activeProcessLimit: 64,
              jobMemoryBytes: "8589934592",
              cpuFlags: 5,
              cpuRate: 2500,
              inheritedHandles: 3,
              affinityChanged: false,
            },
            jobHandleInheritable: false,
            jobHandleInStdioAllowlist: false,
          }
        : {}),
    };
    const raw = Buffer.from(JSON.stringify(kernel) + "\n");
    const failure =
      {
        "second-role-nonzero": "PRIVATE_COMMAND_EXIT",
        "session-cancel-after-owned-output": "PRIVATE_CANCELLED",
        "bounded-output-failure": "PRIVATE_COMMAND_OUTPUT_BOUND",
      }[name] ?? null;
    const node = [
      "preaborted",
      "outer-cancel-after-assignment-before-resume",
      "deadline-with-pipe-descendant",
    ].includes(name)
      ? null
      : {
          schemaVersion: 1,
          kind: "windows-benign-node-provisional",
          case: name,
          complete: failure === null,
          failure,
          rolesStarted:
            name === "six-role-normal"
              ? 6
              : name === "second-role-nonzero"
                ? 2
                : 1,
          rolesJoined: name === "six-role-normal" ? 6 : failure ? 0 : 1,
          logFiles: name === "six-role-normal" ? 12 : 2,
          unconfirmedClose: false,
          fileChecks: name === "six-role-normal",
          closedEntryDenied: true,
          rootAndPipesJoined: true,
          cohortQuietProven: false,
          productionAdmission: false,
        };
    result.cases.push({
      case: name,
      expectedOutcome: outcome,
      kernelOutcome: outcome,
      workerStarted: created,
      assignedBeforeResume: created,
      resumed,
      activeAtEnd: 0,
      rootReaped: created ? true : null,
      readersJoined: true,
      closeCalls: created ? 4 : 2,
      checkedCloseCallsSucceeded: true,
      foreignControllerPreserved: true,
      assignmentObserverVerified: created,
      reparentedDescendantVerified: name === "reparented-descendant",
      node,
      kernelReceiptPin: { bytes: raw.length, sha256: hash(raw) },
    });
    result.rawReceipts.push(raw.toString("base64"));
  }
  return result;
}
function python(code) {
  return execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-c",
      code,
      path.join(DIR, "qualification-job-proof.py"),
      path.join(DIR, "job.py"),
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20000 },
  );
}

test("held Windows cross-interface identity handles actual inert exe decoration without weakening same-interface guards", () => {
  const value = JSON.parse(
    python(String.raw`
import hashlib,json,os,re,stat,sys,tempfile,types
from pathlib import Path
text=Path(sys.argv[1]).read_text()
prior,count=re.subn(r'^# BEGIN Windows held-interface identity\n[\s\S]*?^# END Windows held-interface identity\n\n\n','',text,flags=re.M)
assert count==1
current='need(_held_cross_identity(opened) == _held_cross_identity(before), "PROOF_FILE_IDENTITY")'
assert prior.count(current)==1
prior=prior.replace(current,'need(identity(opened) == identity(before), "PROOF_FILE_IDENTITY")')
ns={'__name__':'held_review_model','__file__':sys.argv[1]}
exec(compile(text,sys.argv[1],'exec'),ns)
old={'__name__':'prior_held_review_model','__file__':sys.argv[1]}
exec(compile(prior,sys.argv[1],'exec'),old)
expected={'8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c':'0f2fccfbf4ce8074fd5815cfaa5d7e8c65cd78d9dd40a2528a514e1bef20cd9c',
          '51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e':'c6c4e698901cdd4ca69eef64c9cfd6a172e0162c0afe510a9ca9331467411d8e'}
assert '_held_cross_identity(opened)' not in prior
def denied(action,code):
 try:action()
 except ValueError as error:assert error.args==(code,)
 else:raise AssertionError('required denial missing')
actual_os=ns['os']
with tempfile.TemporaryDirectory(prefix='held-exe-data-only-') as directory:
 path=Path(directory).resolve()/'owned.exe'
 raw=b'inert data never executed'
 path.write_bytes(raw)
 before=path.lstat()
 with path.open('rb')as stream:opened=os.fstat(stream.fileno())
 if os.name=='nt':
  assert before.st_mode^opened.st_mode==0o111
  denied(lambda:old['held'](path,64),'PROOF_FILE_IDENTITY')
 else:assert old['held'](path,64)==raw
 assert ns['held'](path,64,{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})==raw
 path.chmod(stat.S_IREAD)
 try:assert ns['held'](path,64)==raw
 finally:path.chmod(stat.S_IREAD|stat.S_IWRITE)
 for changed in ('st_dev','st_ino','st_nlink','filetype','permission'):
  def first_changed(fd):
   info=actual_os.fstat(fd)
   fields={key:getattr(info,key)for key in ('st_dev','st_ino','st_mode','st_nlink')}
   if changed in ('st_dev','st_ino','st_nlink'):fields[changed]+=1
   elif changed=='filetype':fields['st_mode']=(fields['st_mode']&0o7777)|stat.S_IFDIR
   else:fields['st_mode']^=stat.S_IWUSR
   return types.SimpleNamespace(**fields)
  ns['os']=types.SimpleNamespace(name=os.name,fstat=first_changed)
  try:denied(lambda:ns['held'](path,64),'PROOF_FILE_IDENTITY')
  finally:ns['os']=actual_os
 for changed in ('fd-execute-mode','path-permission'):
  calls=[0]
  def later_changed(fd):
   info=actual_os.fstat(fd);calls[0]+=1
   if calls[0]==2:
    if changed=='path-permission':path.chmod(stat.S_IREAD)
    else:return types.SimpleNamespace(st_dev=info.st_dev,st_ino=info.st_ino,st_mode=info.st_mode^0o111,st_nlink=info.st_nlink)
   return info
  ns['os']=types.SimpleNamespace(name=os.name,fstat=later_changed)
  try:denied(lambda:ns['held'](path,64),'PROOF_FILE_CHANGED')
  finally:ns['os']=actual_os;path.chmod(stat.S_IREAD|stat.S_IWRITE)
 ns['os']=types.SimpleNamespace(name='nt')
 a=types.SimpleNamespace(st_dev=1,st_ino=2,st_nlink=1,st_mode=stat.S_IFREG|0o777)
 b=types.SimpleNamespace(st_dev=1,st_ino=2,st_nlink=1,st_mode=stat.S_IFREG|0o666)
 assert ns['_held_cross_identity'](a)==ns['_held_cross_identity'](b)
 ns['os']=types.SimpleNamespace(name='posix')
 assert ns['_held_cross_identity'](a)!=ns['_held_cross_identity'](b)
 ns['os']=actual_os
print(json.dumps({'hostOs':os.name,'actualWindowsExeRedGreen':os.name=='nt','sameInterfaceNegatives':True,'nonWindowsUnchanged':True,'dataExecuted':False}))
`),
  );
  assert.equal(value.sameInterfaceNegatives, true);
  assert.equal(value.nonWindowsUnchanged, true);
  assert.equal(value.dataExecuted, false);
  if (process.platform === "win32")
    assert.equal(value.actualWindowsExeRedGreen, true);
});

test("controller failure observation projects only fixed Python phase code and numeric native fields without getters", () => {
  const output = JSON.parse(
    python(String.raw`
import ast,json,sys
from pathlib import Path
namespace={'__name__':'review_only','__file__':sys.argv[1]}
exec(compile(Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),namespace)
namespace['_observe_controller']('case-parent',namespace['CASES'][0],0)
error=OSError(5,'PRIVATE_PATH_COMMAND_TOKEN')
error.stage='proof-controller-handle'
native=namespace['controller_failure'](error)
assert native['nativeStage']=='proof-controller-handle' and native['nativeErrno']==5
assert native['code']=='NATIVE_OS_ERROR' and native['phase']=='case-parent'
assert native['case']=='six-role-normal' and native['completedCases']==0
class Hostile(ValueError):
 def __getattribute__(self,name):raise AssertionError('getter must not run')
 def __str__(self):raise AssertionError('str must not run')
 @property
 def __dict__(self):raise AssertionError('dict getter must not run')
value=namespace['controller_failure'](Hostile('PRIVATE_PATH_COMMAND_TOKEN'))
assert value['code']=='UNKNOWN' and value['nativeStage'] is None and value['nativeErrno'] is None
assert namespace['controller_failure'](ValueError('PROOF_CONTEXT'))['code']=='PROOF_CONTEXT'
assert namespace['controller_failure'](ValueError('PROOF_NOT_REVIEWED_PRIVATE'))['code']=='UNKNOWN'
assert namespace['controller_failure'](ValueError('PRIVATE_PATH_COMMAND_TOKEN'*10000))['code']=='UNKNOWN'
error.stage='PRIVATE_PATH_COMMAND_TOKEN';error.errno=True
value=namespace['controller_failure'](error)
assert value['nativeStage'] is None and value['nativeErrno'] is None
for value in (None,False,0,'PRIVATE_PATH_COMMAND_TOKEN'):
 assert namespace['controller_failure'](value)['code']=='UNKNOWN'
native_labels=set()
for filename in (sys.argv[1],sys.argv[2]):
 for node in ast.walk(ast.parse(Path(filename).read_bytes())):
  if isinstance(node,ast.Call) and len(node.args)>1 and isinstance(node.args[1],ast.Constant) and isinstance(node.args[1].value,str):
   if isinstance(node.func,ast.Attribute) and node.func.attr=='checked' or isinstance(node.func,ast.Name) and node.func.id=='checked':native_labels.add(node.args[1].value)
assert native_labels <= namespace['_CONTROLLER_STAGES']
print(json.dumps({'native':native,'codes':sorted(namespace['_CONTROLLER_CODES']),'phases':sorted(namespace['_CONTROLLER_PHASES']),'stages':sorted(namespace['_CONTROLLER_STAGES'])}))
`),
  );
  assert(!JSON.stringify(output).includes("PRIVATE_PATH_COMMAND_TOKEN"));
  assert.equal(
    validateControllerFailure(Buffer.from(JSON.stringify(output.native))).code,
    "NATIVE_OS_ERROR",
  );
  const block = fixture.slice(
    fixture.indexOf("// BEGIN bounded controller failure validation"),
    fixture.indexOf("// END bounded controller failure validation"),
  );
  const enums = vm.runInNewContext(
    block.replace(
      "export function validateControllerFailure",
      "function validateControllerFailure",
    ) +
      ";({phases:[...CONTROLLER_FAILURE_PHASES],codes:[...CONTROLLER_FAILURE_CODES],stages:[...CONTROLLER_FAILURE_STAGES]});",
    { Buffer, CASES, exact: () => {} },
  );
  assert.deepEqual([...enums.phases].sort(), output.phases);
  assert.deepEqual([...enums.stages].sort(), output.stages);
  for (const code of output.codes) assert(enums.codes.includes(code));
});

function controllerFailureFixture() {
  return {
    schemaVersion: 1,
    kind: "windows-benign-job-controller-failure",
    complete: false,
    failure: "PROOF_DENIED",
    phase: "case-parent",
    case: CASES[0],
    completedCases: 0,
    code: "NATIVE_OS_ERROR",
    nativeStage: "proof-controller-handle",
    nativeErrno: 5,
    kernel: null,
    productionAdmission: false,
    runtimeReady: false,
  };
}

test("controller failure observation strict Node selector rejects raw output private additions invalid fields and success claims", () => {
  const raw = Buffer.from(JSON.stringify(controllerFailureFixture()));
  assert.equal(validateControllerFailure(raw).nativeErrno, 5);
  for (const [key, value] of [
    ["phase", "PRIVATE_SECRET"],
    ["case", "PRIVATE_SECRET"],
    ["completedCases", -1],
    ["completedCases", 10],
    ["completedCases", true],
    ["code", "PROOF_NOT_REVIEWED_PRIVATE"],
    ["nativeStage", "PRIVATE_SECRET"],
    ["nativeErrno", -1],
    ["nativeErrno", true],
    ["nativeErrno", 4294967296],
    ["runtimeReady", true],
    ["productionAdmission", true],
    ["complete", true],
  ])
    assert.equal(
      validateControllerFailure(
        Buffer.from(
          JSON.stringify({ ...controllerFailureFixture(), [key]: value }),
        ),
      ),
      null,
    );
  assert.equal(
    validateControllerFailure(
      Buffer.from(
        JSON.stringify({
          ...controllerFailureFixture(),
          private: "PRIVATE_SECRET",
        }),
      ),
    ),
    null,
  );
  assert.equal(
    validateControllerFailure(Buffer.from("PRIVATE_SECRET\n" + raw)),
    null,
  );
  assert.equal(validateControllerFailure(Buffer.alloc(2049)), null);
  assert.equal(validateControllerFailure("PRIVATE_SECRET"), null);
  assert.equal(
    validateControllerFailure(
      Buffer.from('{"complete":false,"failure":"PROOF_DENIED"}'),
    ),
    null,
  );
});

test("controller failure observation logs only validated closed data after actual child close and keeps original failure", async () => {
  const from = fixture.indexOf("async function runController("),
    until = fixture.indexOf("export function validateControllerResult(");
  const body = fixture.slice(from, until);
  for (const mode of ["known", "private", "logger-fault", "first-falsy"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false,
      kills = 0;
    const logged = [];
    child.kill = () => {
      kills++;
      return true;
    };
    child.unref = () => {};
    const run = vm.runInNewContext(body + ";runController", {
      path,
      Buffer,
      performance,
      setTimeout,
      clearTimeout,
      ROOT,
      validateControllerFailure,
      checkEnd: (end) => {
        if (performance.now() >= end) throw new Error("PROOF_DEADLINE");
      },
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      console: {
        error(raw) {
          assert(closed);
          if (mode === "logger-fault") throw "PRIVATE_LOGGER";
          logged.push(raw);
        },
      },
      spawn: () => {
        queueMicrotask(async () => {
          child.stdout.write(
            mode === "private"
              ? "PRIVATE_STDOUT"
              : JSON.stringify(controllerFailureFixture()),
          );
          child.stderr.write("PRIVATE_STDERR");
          if (mode === "first-falsy") child.stdout.emit("error", false);
          child.emit("exit", 1, null);
          await Promise.resolve();
          assert.equal(logged.length, 0, "root exit alone is not child close");
          closed = true;
          child.emit("close", 1, null);
        });
        return child;
      },
    });
    let rejected = false;
    try {
      await run(
        policy,
        "owned-model-only",
        "a".repeat(64),
        performance.now() + 1000,
        environment(),
      );
    } catch (error) {
      rejected = true;
      if (mode === "first-falsy") assert.equal(error, false);
      else assert.equal(error.message, "PROOF_CONTROLLER_EXIT");
    }
    assert(rejected);
    assert.equal(kills, mode === "first-falsy" ? 1 : 0);
    assert.equal(logged.length, mode === "known" ? 1 : 0);
    assert(!logged.join().includes("PRIVATE"));
    if (logged.length)
      assert.equal(
        JSON.parse(logged[0]).nativeStage,
        "proof-controller-handle",
      );
  }
});

test("controller failure observation inverse restores complete e46 Python and Node with kernel profile subject unchanged", async () => {
  for (const [body, pythonBody, bytes, digest] of [
    [
      adapter,
      true,
      32305,
      "c0d5b2db0392f00a7314557b44719635303ab411e8d80e30af80f9b48be21bd1",
    ],
    [
      fixture,
      false,
      38078,
      "cca6f37e2452c16902b57492d6c0e4d007fb557fe8687a9945d27ae29b968ead",
    ],
  ]) {
    const original = previousControllerFailureObservation(body, pythonBody);
    assert.equal(Buffer.byteLength(original), bytes);
    assert.equal(hash(original), digest);
  }
  assert.equal(
    hash(legacyRawPolicy),
    "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c",
  );
  assert.equal(
    hash(await fs.readFile(path.join(DIR, "job.py"))),
    policy.kernel.sha256,
  );
  assert.equal(
    hash(await fs.readFile(path.join(ROOT, policy.subject.path))),
    policy.subject.sha256,
  );
});

test("only the benign proof profile is active across exactly seven paths, without production activation", async () => {
  assert.equal(policy.workflowActivation, true);
  assert.equal(policy.proofExecutionAdmitted, true);
  for (const key of [
    "sourceMigrationAdmitted",
    "compilerAdmission",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(policy[key], false);
  assert.deepEqual(policy.cases, CASES);
  assert.equal(CASES.length, 9);
  assert.equal(policy.suiteSeconds, 300);
  assert.equal(policy.finalReserveSeconds, 150);
  assert.equal(policy.kernelCleanupSeconds, 30);
  assert.equal(policy.image, "20261021.278.1");
  assert.equal(
    policy.kernel.sha256,
    "70f10cc78c6b75519d3b33cb02788b49f058bdfdf0780b27aeb7becde0b5e716",
  );
  assert.equal(
    policy.subject.sha256,
    "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",
  );
  assert.equal(
    hash(rawRegistry),
    /const PROFILE_SHA\s*=\s*"([a-f0-9]{64})"/.exec(fixture)[1],
  );
  assert.equal(
    hash(rawRegistry),
    /PROFILE_SHA = "([a-f0-9]{64})"/.exec(adapter)[1],
  );
  assert((await fs.stat(path.join(ROOT, policy.workflow))).isFile());
});

function restoreCurrentImageSelection(text) {
  for (const [selected, previous] of [
    [
      "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102",
      "refs/heads/codex/windows-arm-benign-job-proof-20261102",
    ],
    ["20261021.278.1", "20261030.294.1"],
  ]) {
    assert.equal(text.split(selected).length, 2);
    text = text.replace(selected, previous);
  }
  return text;
}
function previousHeldInterfaceIdentity(text) {
  const block =
    /^# BEGIN Windows held-interface identity\n[\s\S]*?^# END Windows held-interface identity\n\n\n/m;
  assert.equal([...text.matchAll(new RegExp(block.source, "gm"))].length, 1);
  const current =
    'need(_held_cross_identity(opened) == _held_cross_identity(before), "PROOF_FILE_IDENTITY")';
  assert.equal(text.split(current).length, 2);
  return text
    .replace(block, "")
    .replace(
      current,
      'need(identity(opened) == identity(before), "PROOF_FILE_IDENTITY")',
    );
}
function previousControllerFailureObservation(text, pythonBody = false) {
  text = previousReviewedImages(text, pythonBody ? "python" : "node");
  if (pythonBody) text = previousHeldInterfaceIdentity(text);
  if (pythonBody) {
    const block =
      /\n# BEGIN bounded controller failure observation\n[\s\S]*?# END bounded controller failure observation\n\n\n/;
    assert.equal([...text.matchAll(new RegExp(block.source, "g"))].length, 1);
    text = text.replace(block, "");
    const caught =
      "    except BaseException as error:  # controller-observation\n";
    assert.equal(text.split(caught).length, 2);
    text = text.replace(caught, "    except BaseException:\n");
    const printed =
      '        print(json.dumps(controller_failure(error), separators=(",", ":")), flush=True)  # controller-observation\n';
    assert.equal(text.split(printed).length, 2);
    text = text.replace(
      printed,
      '        print(\'{"complete":false,"failure":"PROOF_DENIED"}\', flush=True)\n',
    );
    return text.replace(
      /^ *_observe_controller\([^\n]*# controller-observation\n/gm,
      "",
    );
  }
  for (const pattern of [
    /\/\/ BEGIN bounded controller failure validation\n[\s\S]*?\/\/ END bounded controller failure validation\n{1,3}/,
    /^    \/\/ BEGIN bounded controller failure logging\n[\s\S]*?^    \/\/ END bounded controller failure logging\n/m,
  ]) {
    assert.equal(
      [...text.matchAll(new RegExp(pattern.source, pattern.flags + "g"))]
        .length,
      1,
    );
    text = text.replace(pattern, "");
  }
  return text;
}

test("the two proof flags and two exact pin literals invert through the entire current-image baseline to reviewed inactive bytes", () => {
  const old =
      "f923354c8141f946a464d7ff1dbb68dc9cc917fc693ee75c4d8041e1ee7eee49",
    current = hash(legacyRawPolicy),
    reviewedCurrent =
      "0e5bf412b6575a4e1f576d257bc4e047f02082d75566dee982f6cf68fcbfc24b";
  let inverse = restoreCurrentImageSelection(legacyRawPolicy.toString());
  assert.equal(hash(inverse), reviewedCurrent);
  assert.equal(Buffer.byteLength(inverse), 2897);
  for (const key of ["workflowActivation", "proofExecutionAdmitted"]) {
    const token = `"${key}": true`;
    assert.equal(inverse.split(token).length, 2);
    inverse = inverse.replace(token, `"${key}": false`);
  }
  assert.equal(hash(inverse), old);
  assert.equal(Buffer.byteLength(inverse), 2899);
  for (const [body, bytes, currentDigest, digest] of [
    [
      adapter,
      32305,
      "e066b97a9205d63598c8bbc198e94b8560c0336f196ce5ee5cd4d530830a5601",
      "c5f3bbe050f3ab3c85121ff9022fe9994db9fbc9b35d135a969d7e880947a662",
    ],
    [
      fixture,
      38078,
      "2778c7e1c4e7d51a1d241a8f2efcdde22b5c5bc3c4fd20c04cb810b4e47fab62",
      "ecaedcbe0ef4adee1a89b2262136c3437c3430611f76373a5c55dc0f21f3ea38",
    ],
  ]) {
    const beforeDiagnostics = previousControllerFailureObservation(
      body,
      body === adapter,
    );
    assert.equal(beforeDiagnostics.split(current).length, 2);
    const currentBody = beforeDiagnostics.replace(current, reviewedCurrent);
    assert.equal(hash(currentBody), currentDigest);
    const previous = currentBody.replace(reviewedCurrent, old);
    assert.equal(Buffer.byteLength(previous), bytes);
    assert.equal(hash(previous), digest);
  }
});

test("actual admitted Node entry still denies a foreign scope before any worker or controller", async () => {
  const before = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    await assert.rejects(main([]), /PROOF_HOST|PROOF_AUTHORITY/);
  } finally {
    if (before === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = before;
  }
});
test("fixed actual authority has no alternate image branch workflow repository or mixed head", () => {
  assert.doesNotThrow(() => inspectAuthority(admitted, environment(), host));
  for (const [key, bad] of Object.entries({
    ImageVersion: "20261030.294.1",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY_VISIBILITY: "private",
    GITHUB_REPOSITORY: "foreign/repo",
    GITHUB_REPOSITORY_ID: "2",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "foreign/workflow",
    GITHUB_RUN_ID: "0",
    GITHUB_RUN_ATTEMPT: "01",
  }))
    assert.throws(
      () => inspectAuthority(admitted, { ...environment(), [key]: bad }, host),
      /PROOF_AUTHORITY/,
    );
  for (const bad of [
    { platform: "linux", arch: "x64" },
    { platform: "win32", arch: "arm64" },
  ])
    assert.throws(
      () => inspectAuthority(admitted, environment(), bad),
      /PROOF_(HOST|AUTHORITY)/,
    );
  assert.throws(
    () =>
      inspectAuthority(
        { ...policy, workflowActivation: false, proofExecutionAdmitted: false },
        new Proxy(
          {},
          {
            get() {
              assert.fail("inactive inspected env");
            },
          },
        ),
        host,
      ),
    /PROOF_INACTIVE/,
  );
});
test("unchanged Node inactive gate in isolated legacy model denies before caller-selected arguments or paths", async () => {
  const inactiveMain = vm.runInNewContext("(" + main.toString() + ")", {
    Date,
    performance,
    policy: async () => ({
      ...policy,
      workflowActivation: false,
      proofExecutionAdmitted: false,
    }),
    need: (condition, code) => {
      if (!condition) throw Error(code);
    },
  });
  let reads = 0;
  await assert.rejects(
    inactiveMain(
      new Proxy([], {
        get() {
          reads++;
          throw new Error("untrusted argv");
        },
      }),
    ),
    /PROOF_INACTIVE/,
  );
  assert.equal(reads, 0);
});
test("unchanged Python inactive gate in legacy data model denies before selected root and native kernel import", () => {
  const output = python(
    "import importlib.util,sys\ns=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)\noriginal={'workflowActivation':False,'proofExecutionAdmitted':False}\np.profile=lambda:original\ntry:p.main(['--suite','C:/unowned','a'*64]);raise AssertionError('admitted')\nexcept ValueError as e:assert str(e)=='PROOF_INACTIVE'\nassert '_sorng_benign_job_proof_kernel' not in sys.modules\nprint('inactive-before-native')",
  );
  assert.match(output, /inactive-before-native/);
});

test("actual admitted Python entry denies a foreign scope before root reads or native imports", () => {
  const output = python(
    "import importlib.util,sys,os\ns=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)\nos.environ['GITHUB_REF']='refs/heads/closed-negative'\ntry:p.main(['--suite','C:/unowned','a'*64]);raise AssertionError('admitted')\nexcept ValueError as e:assert str(e) in ('PROOF_HOST','PROOF_AUTHORITY')\nassert '_sorng_benign_job_proof_kernel' not in sys.modules\nprint('foreign-before-native')",
  );
  assert.match(output, /foreign-before-native/);
});
test("only exact owned UUID case file paths can reach worker reads", () => {
  const good = path.join(
    ROOT,
    ".artifacts",
    "windows-arm-job-proof-" + nonce,
    CASES[0],
    "case.json",
  );
  assert.equal(caseFileScope(good, CASES[0]), nonce);
  for (const [file, name] of [
    [path.join(ROOT, "arbitrary.json"), CASES[0]],
    [good, CASES[1]],
    [good + ".extra", CASES[0]],
    [good.replace(nonce, "not-a-uuid"), CASES[0]],
    ["relative/case.json", CASES[0]],
  ])
    assert.throws(() => caseFileScope(file, name), /PROOF_CASE_PATH/);
});
test("held subject and exact extracted blocks preserve the root-carried source and closed entry", async () => {
  const raw = await fs.readFile(path.join(ROOT, policy.subject.path));
  const parts = extractSubject(raw, policy);
  assert.match(parts.joined, /qualificationSourceRuns = new WeakMap/);
  assert.doesNotMatch(parts.joined, /^export /m);
  assert.equal(parts.joined.includes("import { fstatSync"), false);
  for (const bad of [
    Buffer.concat([raw, Buffer.from("\n")]),
    Buffer.from(raw).fill(32, 0, 1),
  ])
    assert.throws(() => extractSubject(bad, policy), /PROOF_SUBJECT/);
  const changed = structuredClone(policy);
  changed.subject.joinedSha256 = "0".repeat(64);
  assert.throws(() => extractSubject(raw, changed), /PROOF_SUBJECT_SPAN/);
  const source = raw.toString("utf8");
  assert.match(source, /export const PRIVATE_DRIVER_ADMITTED = false;/);
  assert.match(source, /PRIVATE_ROLES\.slice\(0, 4\)/);
  assert.match(
    source,
    /await qualificationMetadataObservation\(owner, session\);\s+qualificationOwnerCheck\(owner\);[\s\S]{0,200}throw new Error\("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED"\);/,
  );
});
test("native CloseHandle forwarding ledger calls once and preserves returns errors and last-error state", () => {
  const output = python(`import importlib.util,sys
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
for result in [0,1,False,True]:
 calls=[];last=[123];seen=[]
 def native(*args):calls.append(args);return result
 ledger=p.CloseLedger(native,get_error=lambda:last[0],set_error=lambda value:seen.append(value))
 assert ledger('exact',7) is result and calls==[('exact',7)] and seen==[123]
 assert ledger.snapshot(True)['checkedCloseCallsSucceeded'] is bool(result)
original=RuntimeError('original native exception')
def throwing(*args):raise original
try:p.CloseLedger(throwing)('owned');raise AssertionError('lost')
except RuntimeError as e:assert e is original
calls=[];ledger=p.CloseLedger(lambda *args:(calls.append(args),1)[1],maximum=1)
ledger(1);ledger(2);assert calls==[(1,),(2,)] and ledger.snapshot(True)['checkedCloseCallsSucceeded'] is False
assert p.CloseLedger(lambda _:1).snapshot(True)['checkedCloseCallsSucceeded'] is False
def broken(*args):raise RuntimeError('observer-only fault')
for options in [dict(get_error=broken),dict(get_error=lambda:0,set_error=broken)]:
 calls=[];ledger=p.CloseLedger(lambda *args:(calls.append(args),1)[1],**options)
 assert ledger('owned')==1 and calls==[('owned',)] and ledger.snapshot(True)['checkedCloseCallsSucceeded'] is False
print('ledger-forwarded-once')`);
  assert.match(output, /ledger-forwarded-once/);
});
test("one original suite work end and final reserve cannot reset across cases", () => {
  const output = python(`import importlib.util,sys
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
wall=[1000.0];mono=[20.0];c=p.SuiteClock(1000000,lambda:wall[0],lambda:mono[0]);assert c.case_seconds(p.CASES[0])==20
wall[0]+=146;mono[0]+=146;assert c.case_seconds(p.CASES[0])==4
try:c.case_seconds('deadline-with-pipe-descendant');raise AssertionError('fresh lease')
except ValueError as e:assert str(e)=='PROOF_RESERVE'
wall[0]+=5;mono[0]+=5
try:c.case_seconds(p.CASES[1]);raise AssertionError('late')
except ValueError:pass
assert c.left()==129
wall[0]+=4
try:c.left();raise AssertionError('clock drift')
except ValueError as e:assert str(e)=='PROOF_CLOCK_DRIFT'
print('single-original-clock')`);
  assert.match(output, /single-original-clock/);
});
test("actual kernel body and supported assignment observer remain byte and AST exact", () => {
  const output = python(`import ast,hashlib,pathlib,sys
raw=pathlib.Path(sys.argv[2]).read_bytes();assert hashlib.sha256(raw).hexdigest()=='70f10cc78c6b75519d3b33cb02788b49f058bdfdf0780b27aeb7becde0b5e716'
tree=ast.parse(raw);f=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run_job')
assert hashlib.sha256(ast.dump(f,include_attributes=False).encode()).hexdigest()=='f27430844c58da35e566d19f2a1da15a8fc15ea62cad62b61cbe4d4a5c58977f'
assert [x.arg for x in f.args.kwonlyargs]==['cancel','_test_fault','cap','_test_cleanup_seconds','_test_observe']
text=raw.decode();a=text.index("result['assignedAtCreationVerified']=True");b=text.index('_test_observe(job,pi.process,pi.pid',a);c=text.index('if cancel is not None and cancel.is_set():',b);d=text.index('checked(resume(pi.thread)',c);assert a<b<c<d
adapter=ast.parse(pathlib.Path(sys.argv[1]).read_bytes());calls=[n for n in ast.walk(adapter) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='run_job'];assert len(calls)==1
assert [k.arg for k in calls[0].keywords]==['cancel','cap','_test_observe']
print('unchanged-real-observer-order')`);
  assert.match(output, /unchanged-real-observer-order/);
});
test("strict report accepts a synthetic complete envelope but grants no production authority", () => {
  const { proof, receipts } = validateControllerResult(
    synthetic(),
    policy,
    nonce,
    head,
  );
  assert.equal(proof.complete, true);
  assert.equal(receipts.length, 9);
  for (const key of [
    "productionAdmission",
    "sourceGnQualified",
    "compilerAdmission",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(proof[key], false);
});
test("strict report rejects missing cases changed outcomes close ambiguity stale freshness and copied raw receipts", () => {
  const changes = [
    (v) => {
      v.complete = false;
    },
    (v) => {
      v.nonce = "foreign";
    },
    (v) => {
      v.head = "b".repeat(40);
    },
    (v) => {
      v.productionAdmission = true;
    },
    (v) => {
      v.scratchRemoved = false;
    },
    (v) => {
      v.extra = true;
    },
    (v) => {
      v.cases.pop();
    },
    (v) => {
      v.cases[1] = v.cases[0];
    },
    (v) => {
      v.rawReceipts.reverse();
    },
    (v) => {
      v.cases[0].checkedCloseCallsSucceeded = false;
    },
    (v) => {
      v.cases[0].foreignControllerPreserved = false;
    },
    (v) => {
      v.cases[0].activeAtEnd = false;
    },
    (v) => {
      v.cases[0].closeCalls = 0;
    },
    (v) => {
      v.cases[0].readersJoined = false;
    },
    (v) => {
      v.cases[0].node.cohortQuietProven = true;
    },
    (v) => {
      v.cases[0].node.rolesStarted = 7;
    },
    (v) => {
      v.cases[0].node.unconfirmedClose = true;
    },
    (v) => {
      v.cases[0].node.rootAndPipesJoined = false;
    },
    (v) => {
      const row = JSON.parse(Buffer.from(v.rawReceipts[0], "base64"));
      row.observerStopped = false;
      const raw = Buffer.from(JSON.stringify(row) + "\n");
      v.rawReceipts[0] = raw.toString("base64");
      v.cases[0].kernelReceiptPin = { bytes: raw.length, sha256: hash(raw) };
    },
    (v) => {
      v.cases[0].node.rolesJoined = "6";
    },
    (v) => {
      v.cases[0].node.closedEntryDenied = false;
    },
    (v) => {
      v.cases[3].workerStarted = true;
    },
    (v) => {
      v.cases[4].resumed = true;
    },
    (v) => {
      v.cases[4].assignmentObserverVerified = false;
    },
    (v) => {
      v.cases[5].node = v.cases[0].node;
    },
    (v) => {
      v.cases[7].reparentedDescendantVerified = false;
    },
    (v) => {
      v.cases[1].node.failure = null;
    },
    (v) => {
      v.cases[0].kernelReceiptPin.sha256 = "0".repeat(64);
    },
    (v) => {
      v.rawReceipts[0] += "\n";
    },
  ];
  for (const change of changes) {
    const value = synthetic();
    change(value);
    assert.throws(
      () => validateControllerResult(value, policy, nonce, head),
      /PROOF_/,
    );
  }
});
test("portable six-role model uses the actual subject block and real log FDs without starting an actor", async (t) => {
  const subject =
    await import("../../native/windows-arm-full-sdk/private-source-driver.mjs");
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "windows-job-proof-model-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  const logs = path.join(root, "private-qualification-logs");
  await fs.mkdir(logs);
  const begin = "function realm(",
    end = "async function worker(";
  assert.equal(fixture.split(begin).length, 2);
  assert.equal(fixture.split(end).length, 2);
  const body = fixture.slice(fixture.indexOf(begin), fixture.indexOf(end));
  const roles = [
    "qual-gn-desc-pa",
    "qual-gn-desc-cef",
    "qual-gn-args",
    "qual-generate-headers",
    "qual-clang-probe",
    "qual-link-probe",
  ];
  const make = vm.runInNewContext(body + ";realm", {
    vm,
    fs,
    syncFs,
    path,
    Buffer,
    createHash,
    performance,
    setTimeout,
    clearTimeout,
    ROOT,
    ROLES: roles,
    hash,
    need: (ok, code) => {
      if (!ok) throw new Error(code);
    },
  });
  const vectors = roles.map((role) => ({
    role,
    argv: [policy.node.path, "fixed-model-only"],
    cwd: root,
  }));
  let starts = 0;
  const modeledSpawn = () => {
    starts++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => assert.fail("normal model killed");
    setImmediate(() => {
      child.stdout.write("fixed stdout");
      child.stderr.write("fixed stderr");
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdout.destroy();
      child.stderr.destroy();
      child.emit("close", 0, null);
    });
    return child;
  };
  const raw = await fs.readFile(path.join(ROOT, policy.subject.path));
  const model = make(
    extractSubject(raw, policy),
    subject.qualificationPhaseClock,
    vectors,
    modeledSpawn,
  );
  const token = Object.freeze({ onlyIsolatedModel: true }),
    signal = new AbortController();
  const stamp = (info) =>
    [
      info.dev,
      info.ino,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
      info.birthtimeNs,
      info.mode,
      info.nlink,
    ].join(":");
  const stateSource = {
    root,
    budget: { remaining: () => 155000 },
    signal: signal.signal,
    context: {},
    privatePolicyRaw: Buffer.from("{}"),
    contextSha: "a".repeat(64),
    logsIdentity: stamp(await fs.lstat(logs, { bigint: true })),
    output: { bytes: 0 },
    environment: { FIXED_MODEL: "1" },
    compilerEnvironment: { FIXED_MODEL: "1" },
    custom: { sourceGitEnvironment: async (_policy, env) => ({ ...env }) },
    gitPolicy: { onlyIsolatedModel: true },
    validateBefore: async () => {},
    validateAfter: async () => {},
  };
  stateSource.phase = subject.qualificationPhaseClock(stateSource.budget);
  stateSource.end = performance.now() + 5000;
  model.qualificationSourceRuns.set(token, stateSource);
  model.qualificationCoordinatorSources.add(token);
  const session = model.createQualificationSession(token),
    state = model.qualificationSessions.get(session);
  for (const role of roles) {
    const observation = Object.freeze({ onlyIsolatedModel: true });
    model.qualificationObservations.set(observation, {
      session,
      state,
      role,
      epoch: state.epoch,
    });
    const result = await model.runFixedJoined(session, role, observation);
    assert.equal(result.rootAndPipesJoined, true);
    assert.equal(result.cohortQuietProven, false);
  }
  assert.equal(starts, 6);
  assert.equal(state.next, 6);
  assert.equal(state.logFiles.size, 12);
  assert.equal(subject.PRIVATE_DRIVER_ADMITTED, false);
  assert.equal(subject.qualificationSourceRuns, undefined);
});
test("proof adapter and subject harness contain only fixed vectors and never a production issuer writer", () => {
  assert.doesNotMatch(
    adapter,
    /subprocess\.(?:run|Popen)|_test_fault\s*=|_test_cleanup_seconds\s*=/,
  );
  assert.match(adapter, /kernel\.close = ledger/);
  assert.match(adapter, /event\.set\(\)/);
  assert.match(adapter, /kernel\.ParentCancel\(event\)/);
  assert.match(fixture, /qualificationSourceRuns\.set\(token, sourceState\)/);
  assert.match(fixture, /vm\.runInNewContext/);
  assert.doesNotMatch(fixture, /subject\.qualificationSourceRuns/);
  assert.match(fixture, /cohortQuietProven: false/);
});

test("actual controller body rejects nonzero or late fulfillment and retires only its own unjoined streams", async () => {
  const from = "async function runController(",
    until = "export function validateControllerResult(";
  assert.equal(fixture.split(from).length, 2);
  assert.equal(fixture.split(until).length, 2);
  const body = fixture.slice(fixture.indexOf(from), fixture.indexOf(until));
  for (const mode of ["exit7", "late-close", "cap-then-unjoined"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let kills = 0,
      unrefs = 0,
      options;
    child.kill = () => {
      kills++;
      return true;
    };
    child.unref = () => {
      unrefs++;
    };
    const run = vm.runInNewContext(body + ";runController", {
      path,
      Buffer,
      performance,
      setTimeout,
      clearTimeout,
      ROOT,
      checkEnd: (end) => {
        if (performance.now() >= end) throw new Error("PROOF_DEADLINE");
      },
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      spawn: (_exe, _args, passed) => {
        options = passed;
        queueMicrotask(() => {
          if (mode === "cap-then-unjoined") {
            child.stdout.write(Buffer.alloc(262145));
            return;
          }
          if (mode === "late-close") {
            const stop = performance.now() + 35;
            while (performance.now() < stop) {
              /* Deliberately defer timers beyond original end. */
            }
          }
          child.stdout.write('{"complete":true}');
          child.emit("exit", mode === "exit7" ? 7 : 0, null);
          child.emit("close", mode === "exit7" ? 7 : 0, null);
        });
        return child;
      },
    });
    const end = performance.now() + (mode === "exit7" ? 100 : 20);
    await assert.rejects(
      run(policy, "fixed-owned-model-root", "a".repeat(64), end, {
        ...environment(),
        GH_TOKEN: "fixture-only-secret",
      }),
      new RegExp(
        mode === "exit7"
          ? "PROOF_CONTROLLER_EXIT"
          : mode === "late-close"
            ? "PROOF_DEADLINE"
            : "PROOF_CONTROLLER_OUTPUT",
      ),
    );
    assert.equal(options.env.GH_TOKEN, undefined);
    assert.equal(options.env.GITHUB_SHA, head);
    assert.deepEqual([...options.stdio], ["ignore", "pipe", "pipe"]);
    if (mode === "cap-then-unjoined") {
      assert(kills >= 1);
      assert.equal(unrefs, 1);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
    } else
      assert.equal(kills, 0, "never signal a root after its observed exit");
  }
});

test("actual tiny cleanup is causal: legacy deletes foreign replacement, repaired guards preserve root leaf and final-root replacements", () => {
  const output =
    python(String.raw`import importlib.util,sys,pathlib,tempfile,types,hashlib,json,os
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
old='''def remove_owned_tree(root, original, clock):
    # No unknown roots/links/recursion: deny rather than following a junction.
    need(identity(root.lstat()) == original, "PROOF_ROOT_CHANGED")
    rows = []
    for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
        clock.left()
        path = Path(base)
        need(len(path.relative_to(root).parts) <= 8, "PROOF_CLEANUP_DEPTH")
        for name in dirs + files:
            item = physical(path / name)
            need(item.is_dir() or (item.is_file() and item.stat().st_nlink == 1), "PROOF_CLEANUP_TYPE")
            rows.append(item)
            need(len(rows) <= 4096, "PROOF_CLEANUP_BOUND")
    for item in reversed(rows):
        clock.left()
        item.rmdir() if item.is_dir() else item.unlink()
    need(identity(root.lstat()) == original, "PROOF_ROOT_CHANGED")
    root.rmdir()
'''
assert hashlib.sha256(old.encode()).hexdigest()=='caa227f90db496f1cdb2a4f253d196102d15dbea3f86da04e43d40e197f9e5ff'
scope=dict(p.__dict__);exec(old,scope);legacy=scope['remove_owned_tree']
native_unlink=pathlib.Path.unlink
clock=types.SimpleNamespace(left=lambda:10)

def run(mode,guarded):
 base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-causal-')).resolve();root=base/'owned';saved=base/'saved';displaced=base/'displaced.bin';root.mkdir()
 names=('a.bin',)if mode=='final-root'else('a.bin','b.bin')
 for name in names:(root/name).write_bytes(b'OWNED')
 original=p.identity(root.lstat());changed=[False];foreign=[None];error=[None];deleted=[False]
 reader=p.WindowsCleanupRead if os.name=='nt'else p.CleanupRead;native_close=reader.close
 try:
  def replace():
   changed[0]=True
   if mode in ('root','final-root'):
    remaining=next(root.iterdir()).name if mode=='root'else'FOREIGN.bin';root.rename(saved);root.mkdir();foreign[0]=root/remaining
   elif mode=='leaf':
    remaining=next(root.iterdir());remaining.rename(displaced);foreign[0]=root/remaining.name
   else:foreign[0]=root/'FOREIGN.bin'
   foreign[0].write_bytes(b'FOREIGN SENTINEL')
  def intercept(item,*args,**kwargs):
   result=native_unlink(item,*args,**kwargs)
   if not changed[0] and item.parent==root:
    deleted[0]=True
    if not guarded:replace()
   return result
  def after_owned_close(self):
   result=native_close(self)
   if guarded and deleted[0] and not changed[0]:replace()
   return result
  pathlib.Path.unlink=intercept
  reader.close=after_owned_close
  try:
   if guarded:p.remove_owned_tree(root,original,clock,frozenset(names))
   else:legacy(root,original,clock)
  except BaseException as caught:error[0]=caught
  assert changed[0],('replacement boundary not reached',mode,error[0])
  if guarded:
   assert isinstance(error[0],ValueError),(mode,error[0])
   assert foreign[0].read_bytes()==b'FOREIGN SENTINEL',(mode,error[0])
  return foreign[0] is not None and not foreign[0].exists()
 finally:
  pathlib.Path.unlink=native_unlink
  reader.close=native_close
  for folder in(root,saved):
   if folder.exists():
    assert folder.resolve()==folder and folder.parent==base
    for name in('a.bin','b.bin','FOREIGN.bin'):
     item=folder/name
     if item.exists():native_unlink(item)
    folder.rmdir()
  if displaced.exists():native_unlink(displaced)
  base.rmdir()

assert run('root',False)is True
for mode in('root','leaf','unknown','final-root'):assert run(mode,True)is False
base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-positive-')).resolve();root=base/'owned';root.mkdir();(root/'nested').mkdir();(root/'nested/a.bin').write_bytes(b'x');(root/'empty.log').write_bytes(b'')
result=p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('nested','nested/a.bin','empty.log')))
assert result['readHandlesClosed']is True and result['sourceInodeCas']is False and result['closeCalls']>=4 and not root.exists();base.rmdir()
print(json.dumps({'legacyForeignDeleted':True,'repairedForeignPreserved':True,'finalRootPreserved':True,'ordinaryNestedCleanup':True,'nativeJobExecuted':False}))`);
  const result = JSON.parse(output);
  assert.equal(result.legacyForeignDeleted, true);
  assert.equal(result.repairedForeignPreserved, true);
  assert.equal(result.finalRootPreserved, true);
  assert.equal(result.ordinaryNestedCleanup, true);
  assert.equal(result.nativeJobExecuted, false);
});

test("cleanup known-name ledger and actual close failure deny without deleting unknown content", () => {
  const output =
    python(String.raw`import importlib.util,sys,pathlib,tempfile,types,os
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-close-')).resolve();root=base/'owned';root.mkdir();leaf=root/'known.bin';leaf.write_bytes(b'OWNED');unknown=root/'FOREIGN.bin';unknown.write_bytes(b'FOREIGN');clock=types.SimpleNamespace(left=lambda:10)
try:
 try:p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('known.bin',)));raise AssertionError('unknown deleted')
 except ValueError as e:assert str(e)=='PROOF_CLEANUP_UNKNOWN'
 assert unknown.read_bytes()==b'FOREIGN';unknown.unlink()
 name='WindowsCleanupRead'if os.name=='nt'else'CleanupRead';original=getattr(p,name)
 class FailedClose(original):
  def __init__(self,*args):
   super().__init__(*args)
   if os.name=='nt':
    native=self.native_close
    self.native_close=lambda handle:(native(handle),False)[1]
  def close(self):
   live=self.handle is not None if os.name=='nt'else self.fd is not None
   super().close()
   if live and os.name!='nt':raise ValueError('PROOF_CLEANUP_CLOSE')
 setattr(p,name,FailedClose)
 try:
  try:p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('known.bin',)));raise AssertionError('close claim accepted')
  except ValueError as e:assert str(e)=='PROOF_CLEANUP_CLOSE'
 finally:setattr(p,name,original)
 assert leaf.read_bytes()==b'OWNED'
 assert root.resolve()==root and root.parent==base
finally:
 for item in(leaf,unknown):
  if item.exists():item.unlink()
 root.rmdir();base.rmdir()
print('known-names-and-close-fail-closed')`);
  assert.match(output, /known-names-and-close-fail-closed/);
});

const workflowText = await fs
  .readFile(path.join(ROOT, policy.workflow), "utf8")
  .then((raw) => raw.replaceAll("\r\n", "\n"));
const workflow = YAML.parse(workflowText),
  proofJob = workflow.jobs.proof;
const proofStep = proofJob.steps.find((step) => step.id === "proof");
const programMatch = /@'\n([\s\S]+)\n'@ \| node --input-type=module/.exec(
  proofStep.run,
);
assert(programMatch, "fixed PowerShell Node program");
const carrierProgram = programMatch[1];

function withoutCarrierFailureDiagnostics(text) {
  text = previousReviewedImages(text, "workflow");
  for (const name of ["import", "projection"]) {
    const begin = `          // BEGIN fixed carrier failure diagnostic ${name}\n`,
      end = `          // END fixed carrier failure diagnostic ${name}\n`;
    assert.equal(text.split(begin).length, 2);
    assert.equal(text.split(end).length, 2);
    text = text.replace(
      text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
      "",
    );
  }
  for (const phase of [
    "import",
    "policy",
    "authority",
    "main",
    "reportscan",
    "reportread",
    "validate",
    "output",
  ]) {
    const line = `          phase = '${phase}';\n`;
    assert.equal(text.split(line).length, 2);
    text = text.replace(line, "");
  }
  const begin = "          // BEGIN fixed carrier failure diagnostic catch\n",
    end = "          // END fixed carrier failure diagnostic catch\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  return text.replace(
    text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
    "          } catch { console.error('PROOF_CARRIER_DENIED'); process.exitCode = 1; }\n",
  );
}
function failureProjection(overrides = {}) {
  const begin = carrierProgram.indexOf(
      "// BEGIN fixed carrier failure diagnostic projection",
    ),
    end = carrierProgram.indexOf(
      "// END fixed carrier failure diagnostic projection",
    );
  assert(begin > 0 && end > begin);
  return vm.runInNewContext(
    carrierProgram.slice(begin, end) +
      "\n({FAILURE_PHASES,FAILURE_CODES,carrierFailureCode,carrierFailure})",
    { diagnosticTypes, Buffer, ...overrides },
  );
}

test("carrier failure whitelist is exactly the actual main reachable and outer assertion labels", () => {
  const ast = ts.createSourceFile(
    "proof.mjs",
    fixture,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const functions = new Map(
    ast.statements
      .filter(ts.isFunctionDeclaration)
      .filter((node) => node.name)
      .map((node) => [node.name.text, node]),
  );
  const visited = new Set(),
    expected = new Set();
  const inspect = (name) => {
    if (
      visited.has(name) ||
      ["worker", "actor"].includes(name) ||
      !functions.has(name)
    )
      return;
    visited.add(name);
    const walk = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (
          node.expression.text === "need" &&
          node.arguments[1] &&
          ts.isStringLiteral(node.arguments[1])
        )
          expected.add(node.arguments[1].text);
        inspect(node.expression.text);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Error" &&
        node.arguments?.[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        expected.add(node.arguments[0].text);
      ts.forEachChild(node, walk);
    };
    walk(functions.get(name));
  };
  inspect("main");
  const previous = YAML.parse(withoutCarrierFailureDiagnostics(workflowText));
  const program = /@'\n([\s\S]+)\n'@ \| node --input-type=module/.exec(
    previous.jobs.proof.steps.find((step) => step.id === "proof").run,
  )[1];
  const outer = ts.createSourceFile(
    "carrier.mjs",
    program,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const walk = (node) => {
    if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression)
        ? node.expression.text === "assert"
        : ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "assert")
    ) {
      const value = node.arguments.at(-1);
      if (value && ts.isStringLiteral(value)) expected.add(value.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(outer);
  const api = failureProjection();
  assert.equal(expected.size, 60);
  assert.deepEqual([...api.FAILURE_CODES].sort(), [...expected].sort());
  assert.equal(new Set(api.FAILURE_CODES).size, 60);
  assert.deepEqual(
    [...api.FAILURE_PHASES],
    [
      "before",
      "import",
      "policy",
      "authority",
      "main",
      "reportscan",
      "reportread",
      "validate",
      "output",
    ],
  );
  for (const code of api.FAILURE_CODES)
    for (const phase of api.FAILURE_PHASES) {
      const raw = api.carrierFailure(phase, Error(code)),
        row = JSON.parse(raw);
      assert.equal(api.carrierFailureCode(Error(code)), code);
      assert.deepEqual(row, {
        kind: "windows-benign-job-carrier-failure",
        complete: false,
        phase,
        code,
        runtimeReady: false,
      });
      assert(Buffer.byteLength(raw, "utf8") <= 256);
    }
});

test("carrier failure inspection rejects getters proxies inherited messages and unknown or falsy throws without disclosure", () => {
  const api = failureProjection();
  let invoked = 0;
  const getter = Object.defineProperty({}, "message", {
    get() {
      invoked++;
      throw Error("PRIVATE getter");
    },
  });
  const forged = new Proxy(Error("PROOF_PIN"), {
    getOwnPropertyDescriptor() {
      invoked++;
      return { value: "PROOF_PIN", configurable: true };
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const error of [
    false,
    0,
    1n,
    Symbol("PRIVATE"),
    null,
    undefined,
    "PROOF_PIN",
    Error("PROOF_PIN PRIVATE"),
    Error("PRIVATE".repeat(10000)),
    { code: "ENOENT" },
    Object.create({ message: "PROOF_PIN" }),
    getter,
    forged,
    revoked.proxy,
    new Proxy(
      {},
      {
        get() {
          invoked++;
          throw Error("PRIVATE proxy");
        },
      },
    ),
  ]) {
    assert.equal(api.carrierFailureCode(error), "UNKNOWN");
    const raw = api.carrierFailure("main", error);
    assert.equal(JSON.parse(raw).code, "UNKNOWN");
    assert(!raw.includes("PRIVATE"));
    assert(Buffer.byteLength(raw, "utf8") <= 256);
  }
  assert.equal(invoked, 0);
  assert.equal(api.carrierFailure("PRIVATE", Error("PROOF_PIN")), null);
  assert.equal(
    failureProjection({
      JSON: {
        stringify() {
          throw Error("PRIVATE projection");
        },
      },
    }).carrierFailure("main", Error("PROOF_PIN")),
    null,
  );
  assert.equal(
    failureProjection({ Buffer: { byteLength: () => 257 } }).carrierFailure(
      "main",
      Error("PROOF_PIN"),
    ),
    null,
  );
});

async function modelCarrier(options = {}) {
  const {
    failPhase,
    actualMain = false,
    loggingFails = false,
    projectionFails = false,
  } = options;
  const error = Object.hasOwn(options, "error")
    ? options.error
    : Error("PROOF_PIN");
  // Actual fixed workflow program; only module loading, FS/host, and native
  // suite fulfillment are modeled. No Job, actor, Python, or source fetch runs.
  const loading =
    "await import('./tests/fixtures/cef/windows_arm_qualification_job_proof.mjs')";
  assert.equal(carrierProgram.split(loading).length, 2);
  const body = carrierProgram
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(loading, "await modelImport()");
  const checked = validateControllerResult(synthetic(), admitted, nonce, head),
    root = "C:\\owned",
    artifacts = path.win32.join(root, ".artifacts"),
    reportDirectory = path.win32.join(
      artifacts,
      "windows-arm-job-report-" + nonce,
    ),
    names = [
      "proof.json",
      ...Array.from({ length: 9 }, (_, i) => `receipt-${i}.json`),
    ];
  const content = new Map([
    [
      path.win32.join(reportDirectory, "proof.json"),
      Buffer.from(JSON.stringify(checked.proof)),
    ],
    ...checked.receipts.map((raw, index) => [
      path.win32.join(reportDirectory, `receipt-${index}.json`),
      raw,
    ]),
  ]);
  const state = {
    errors: [],
    logs: [],
    appended: [],
    reportScans: 0,
    reportReads: 0,
    mainCalls: 0,
    process: {
      cwd: () => root,
      env: {
        CEF_WINDOWS_BENIGN_JOB_STARTED_MS: "1793606908000",
        GITHUB_SHA: head,
        GITHUB_RUN_ID: "100",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_OUTPUT: "C:\\PRIVATE-output",
      },
    },
  };
  let realmArray;
  const info = (name, bigint) => {
    const number = (value) => (bigint ? BigInt(value) : value);
    return {
      dev: number(1),
      ino: number(2),
      size: number(content.get(name)?.length ?? 0),
      mode: number(0o100600),
      nlink: number(1),
      birthtimeNs: number(1),
      mtimeNs: number(1),
      ctimeNs: number(1),
      isFile: () => content.has(name),
      isSymbolicLink: () => false,
    };
  };
  const api = {
    realpath: async (name) => {
      if (failPhase === "before") throw error;
      return name;
    },
    lstat: async (name, options) => info(name, options?.bigint),
    readdir: async (name) => {
      if (name === artifacts) {
        if (!state.mainCalls) return [];
        state.reportScans++;
        if (failPhase === "reportscan") throw error;
        return [path.win32.basename(reportDirectory)];
      }
      return realmArray.from(names);
    },
    readFile: async () => {
      if (failPhase === "policy") throw error;
      return JSON.stringify(admitted);
    },
    open: async (name) => {
      state.reportReads++;
      if (failPhase === "reportread") throw error;
      const raw = content.get(name);
      assert(raw);
      return {
        stat: async () => info(name, true),
        read: async (buffer, offset, length, position) => {
          const bytesRead = Math.min(
            length,
            Math.max(0, raw.length - position),
          );
          raw.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        close: async () => {},
      };
    },
    appendFile: async (...args) => {
      if (failPhase === "output") throw error;
      state.appended.push(args);
    },
  };
  const modelModule = {
    readReviewedProofPolicy: async () => {
      if (failPhase === "policy") throw error;
      return admitted;
    },
    inspectAuthority: () => {
      if (failPhase === "authority") throw error;
    },
    main: async (args) => {
      assert.deepEqual([...args], []);
      state.mainCalls++;
      if (actualMain) await main([]);
      if (failPhase === "main") throw error;
    },
    validateControllerResult: (...args) => {
      if (failPhase === "validate") throw error;
      return validateControllerResult(...args);
    },
  };
  const scope = vm.createContext({
    assert,
    fs: api,
    path: path.win32,
    createHash,
    diagnosticTypes,
    Buffer,
    JSON,
    process: state.process,
    Date: { now: () => 1793606908000 },
    performance: { now: () => 0 },
    modelImport: async () => {
      if (failPhase === "import") throw error;
      return modelModule;
    },
    console: {
      error: (value) => {
        assert.equal(state.process.exitCode, 1);
        if (loggingFails) throw Error("PRIVATE logging");
        state.errors.push(value);
      },
      log: (value) => state.logs.push(value),
    },
    ...(projectionFails
      ? {
          JSON: {
            parse: JSON.parse,
            stringify() {
              throw Error("PRIVATE projection");
            },
          },
        }
      : {}),
  });
  realmArray = vm.runInContext("Array", scope);
  await vm.runInContext("(async()=>{\n" + body + "\n})()", scope);
  return state;
}

test("actual fixed carrier reports each phase while preserving nonzero failure and the fulfillment-only report gate", async () => {
  for (const phase of failureProjection().FAILURE_PHASES) {
    const state = await modelCarrier({ failPhase: phase });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.errors[0], "PROOF_CARRIER_DENIED");
    const diagnostic = JSON.parse(state.errors[1]);
    assert.equal(diagnostic.phase, phase);
    assert.equal(diagnostic.code, "PROOF_PIN");
    assert.equal(diagnostic.complete, false);
    assert.equal(diagnostic.runtimeReady, false);
    assert.equal(state.appended.length, 0);
    assert.equal(state.logs.length, 0);
    if (["before", "import", "policy", "authority", "main"].includes(phase)) {
      assert.equal(state.reportScans, 0);
      assert.equal(state.reportReads, 0);
    }
  }
  const success = await modelCarrier();
  assert.equal(success.process.exitCode, undefined);
  assert.equal(success.errors.length, 0);
  assert.equal(success.appended.length, 1);
  assert.equal(success.reportReads, 10);
  assert.equal(JSON.parse(success.logs[0]).complete, true);
  for (const error of [false, 0, null, undefined]) {
    const state = await modelCarrier({ failPhase: "main", error });
    assert.equal(state.process.exitCode, 1);
    assert.equal(JSON.parse(state.errors[1]).code, "UNKNOWN");
    assert.equal(state.appended.length, 0);
  }
  for (const options of [{ loggingFails: true }, { projectionFails: true }]) {
    const state = await modelCarrier({ failPhase: "import", ...options });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.appended.length, 0);
    assert(!JSON.stringify(state.errors).includes("PRIVATE"));
  }
});

test("genuine existing main authority rejection cannot select or publish valid-looking modeled reports", async () => {
  const original = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    const state = await modelCarrier({ actualMain: true });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.mainCalls, 1);
    assert.equal(state.reportScans, 0);
    assert.equal(state.reportReads, 0);
    assert.equal(state.appended.length, 0);
    const diagnostic = JSON.parse(state.errors[1]);
    assert.equal(diagnostic.phase, "main");
    assert(["PROOF_HOST", "PROOF_AUTHORITY"].includes(diagnostic.code));
  } finally {
    if (original === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = original;
  }
});

test("carrier diagnostics exact inverse restores the complete detached old-image workflow", () => {
  const previous = withoutCarrierFailureDiagnostics(workflowText);
  assert.equal(Buffer.byteLength(previous), 9136);
  assert.equal(
    hash(previous),
    "22a349c7bafd67feff54a6f164ae8df1e32635ffd88b0cfd16eb5a5e83417a73",
  );
});

test("new workflow is no-input private-branch image-bound and uploads only validated ten report leaves", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: null });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(proofJob["runs-on"], "windows-2025-vs2026");
  assert.equal(proofJob["timeout-minutes"], 10);
  for (const condition of [
    "github.event_name == 'workflow_dispatch'",
    "github.event.repository.visibility == 'public'",
    "github.repository == 'supermarsx/sortOfRemoteNG'",
    "github.repository_id == '1010282954'",
    "github.event.repository.default_branch == 'main'",
    `github.ref == '${policy.ref}'`,
  ])
    assert(proofJob.if.includes(condition));
  const first = proofJob.steps[0];
  assert.equal(first.id, "original");
  assert(
    first.run.indexOf("CEF_WINDOWS_BENIGN_JOB_STARTED_MS") <
      first.run.indexOf("ImageVersion"),
  );
  assert(first.run.includes("20261021.278.1"));
  const checkout = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(
    checkout.uses,
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  );
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.env.GIT_CONFIG_VALUE_0, "false");
  const setup = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  assert.equal(
    setup.uses,
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  );
  assert.equal(setup.with["node-version-file"], ".node-version");
  const pythonStep = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/setup-python@"),
  );
  assert.equal(
    pythonStep.uses,
    "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1",
  );
  assert.equal(
    pythonStep.if,
    "steps.original.outputs.python_required == 'true'",
  );
  assert.equal(pythonStep.with["python-version"], "3.12.10");
  assert.equal(pythonStep.with["update-environment"], false);
  const upload = proofJob.steps.at(-1);
  assert.equal(
    upload.uses,
    "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  );
  assert.equal(upload.with.path, "${{ steps.proof.outputs.paths }}");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["include-hidden-files"], true);
  assert.equal(upload.if, undefined);
  assert.equal(upload["continue-on-error"], undefined);
  assert(!workflowText.includes("GH_TOKEN"));
  assert(!workflowText.includes("github.token"));
  assert(!workflowText.includes("always()"));
  assert(
    carrierProgram.indexOf("await main([])") <
      carrierProgram.indexOf("const candidates"),
  );
  assert(
    carrierProgram.indexOf("validateControllerResult(") <
      carrierProgram.indexOf("fs.appendFile(process.env.GITHUB_OUTPUT"),
  );
  assert(carrierProgram.includes("Array.from({length:9}"));
  assert(carrierProgram.includes("'proof.json'"));
  assert(!carrierProgram.includes("Promise.race"));
  assert(!carrierProgram.includes("**"));
  const canonicalLine = carrierProgram
    .split("\n")
    .find((line) => line.includes("const canonical ="));
  const canonicalPath = vm.runInNewContext(canonicalLine + "\ncanonical", {
    path: path.win32,
  });
  assert.equal(canonicalPath("C:\\OWNED\\report.json"), "c:/owned/report.json");
  assert(carrierProgram.includes("PROOF_CARRIER_DENIED"));
});

test("actual workflow clock consumes checkout/setup and leaves inner300 and kernel deadlines unchanged", () => {
  const start = carrierProgram.indexOf("// BEGIN BENIGN ORIGINAL JOB CLOCK"),
    end = carrierProgram.indexOf("// END BENIGN ORIGINAL JOB CLOCK");
  assert(start >= 0 && end > start);
  let wall = 1793664000000,
    mono = 100;
  const api = vm.runInNewContext(
    carrierProgram.slice(start, end) +
      "\n({originalJobDeadline,checkOriginalJob})",
    { assert, Date: { now: () => wall }, performance: { now: () => mono } },
  );
  const clock = api.originalJobDeadline(String(wall - 200000), wall, mono);
  assert.equal(clock.wallEnd, wall + 370000);
  assert.equal(clock.monotonicEnd, 370100);
  api.checkOriginalJob(clock);
  wall += 300000;
  mono += 300000;
  api.checkOriginalJob(clock);
  assert.equal(clock.monotonicEnd, 370100);
  mono = clock.monotonicEnd;
  assert.throws(() => api.checkOriginalJob(clock), /DEADLINE/);
  mono = 100;
  wall = clock.wallEnd;
  assert.throws(() => api.checkOriginalJob(clock), /DEADLINE/);
  for (const value of [
    String(wall + 1),
    String(wall - 270001),
    "0",
    "foreign",
    undefined,
  ])
    assert.throws(() => api.originalJobDeadline(value, wall, 100));
  assert(
    carrierProgram.includes(
      "Math.min(clock.wallEnd-Date.now(),clock.monotonicEnd-performance.now()) >= 300000",
    ),
  );
});

test("existing CI explicit proof contract and exact Node inventory entries are registered once", async () => {
  const ci = YAML.parse(
    await fs.readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
  );
  const step = ci.jobs["browser-transport-contracts"].steps.find(
    (step) => step.name === "Runtime package layout and whole-matrix contract",
  );
  assert.equal(
    step.run
      .split(/\s+/)
      .filter(
        (name) =>
          name ===
          "tests/tooling/windowsArmQualificationJobProof.node-test.mjs",
      ).length,
    1,
  );
  assert.equal(step["continue-on-error"], undefined);
  const inventory = await fs.readFile(
    path.join(ROOT, "tests/tooling/nodeToolchain.node-test.mjs"),
    "utf8",
  );
  assert.equal(
    inventory.split('"windows-arm-qualification-job-proof.yml": 1,').length,
    2,
  );
  assert.equal(
    inventory.split('"windows-arm-source-preflight.yml": 1,').length,
    2,
  );
});

test("fixed old-image proof reuses exact reviewed old source and executable pins without admitting another image", async () => {
  assert.equal(
    policy.ref,
    "refs/heads/codex/windows-arm-benign-reviewed-images-20261102",
  );
  assert.equal(policy.image, "20261021.278.1");
  const oldRaw = await fs
    .readFile(path.join(DIR, "image-qualified-20261021-profile.json"))
    .then((raw) => Buffer.from(raw.toString().replaceAll("\r\n", "\n")));
  assert.equal(oldRaw.length, 35867);
  assert.equal(
    hash(oldRaw),
    "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
  );
  const old = JSON.parse(oldRaw);
  const privateRaw = await fs
    .readFile(path.join(DIR, "private-qualification-profile.json"))
    .then((raw) => Buffer.from(raw.toString().replaceAll("\r\n", "\n")));
  assert.equal(
    hash(privateRaw),
    "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",
  );
  const privatePolicy = JSON.parse(privateRaw);
  assert.equal(privatePolicy.images[policy.image].profileSha256, hash(oldRaw));
  assert.equal(old.image, policy.image);
  assert.equal(
    old.sourceGn.sourceId,
    "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
  );
  const namespace = old.sourceGn.namespace;
  const lock = JSON.parse(
    await fs.readFile(path.join(ROOT, namespace, "source-lock.json")),
  );
  const tableRaw = await fs
    .readFile(path.join(ROOT, namespace, "tools/aarch64-pc-windows-msvc.json"))
    .then((raw) => Buffer.from(raw.toString().replaceAll("\r\n", "\n")));
  assert.equal(
    hash(tableRaw),
    "3fcbd983ae525c55b575f06b64f4c7663351535deabdce74a8df3b2a73c77113",
  );
  assert.equal(lock.builds[0].toolchainLock.sha256, hash(tableRaw));
  const { releaseIdentity } = await import("../../scripts/cef-runtime-ci.mjs");
  assert.equal(
    releaseIdentity(lock, "aarch64-pc-windows-msvc").sourceLockSha256,
    old.sourceGn.sourceId,
  );
  const rows = JSON.parse(tableRaw).files;
  for (const role of ["python", "node"]) {
    const observed = rows.find(
      (row) => row.path === policy[role].path.slice(3),
    );
    assert(observed);
    assert.equal(observed.size, policy[role].bytes);
    assert.equal(observed.sha256, policy[role].sha256);
  }
  assert.deepEqual(privatePolicy.tools.python, policy.python);
  assert.deepEqual(privatePolicy.driverNode, policy.node);
  assert.deepEqual(old.sourceGn.hostTools.node, policy.node);
  assert(privatePolicy.staticLoadingPolicy.images.includes(policy.image));
  assert.equal(privatePolicy.staticLoadingPolicy.systemImageIsTrustedTcb, true);
  assert.equal(
    privatePolicy.staticLoadingPolicy.actualLoaderClosureApproved,
    false,
  );
  assert.equal(privatePolicy.staticLoadingPolicy.system32ByteSetProven, false);
  assert.equal(policy.sourcePaths.length, 12);
  for (const image of [
    "20261030.294.1",
    "20261021.278.2",
    "20261021.278.1 ",
    "unknown",
  ])
    assert.throws(
      () =>
        inspectAuthority(
          policy,
          { ...environment(), ImageVersion: image },
          host,
        ),
      /PROOF_AUTHORITY/,
    );
  const originalRef = "refs/heads/codex/windows-arm-benign-job-proof-20261102";
  assert.throws(
    () =>
      inspectAuthority(
        policy,
        {
          ...environment(),
          GITHUB_REF: originalRef,
          GITHUB_WORKFLOW_REF: `${policy.repository}/${policy.workflow}@${originalRef}`,
        },
        host,
      ),
    /PROOF_AUTHORITY/,
  );
});

test("old-image workflow has only exact ref and image delta from immutable88258 current proof", () => {
  const detachedRef = "          ref: ${{ github.sha }}\n";
  assert.equal(workflowText.split(detachedRef).length, 2);
  const oldSelected = withoutCarrierFailureDiagnostics(workflowText).replace(
    detachedRef,
    "",
  );
  assert.equal(Buffer.byteLength(oldSelected), 9103);
  assert.equal(
    hash(oldSelected),
    "a0c3543b255803fb0779b1aaf830043a3a22fb6f5d9b5d7f1df72f90dfe765d0",
  );
  const previous = restoreCurrentImageSelection(oldSelected);
  assert.equal(Buffer.byteLength(previous), 9094);
  assert.equal(
    hash(previous),
    "a299e9bc4fba7248584091d34334eb9ca912452246ca5e20a8f912d769339350",
  );
  assert.equal(
    policy.workflow,
    ".github/workflows/windows-arm-qualification-job-proof.yml",
  );
  assert(!proofJob.if.includes("||"));
  assert(
    !previousReviewedImages(workflowText, "workflow").includes(
      "20261030.294.1",
    ),
  );
});

test(
  "actual forty-one-byte HEAD guard rejects a symbolic branch and accepts exact detached checkout",
  { timeout: 20000 },
  async (t) => {
    const source = fixture.replaceAll("\r\n", "\n");
    const span = (begin, end) => {
      const first = "\n" + begin,
        last = "\n" + end;
      assert.equal(source.split(first).length, 2, begin);
      assert.equal(source.split(last).length, 2, end);
      const a = source.indexOf(first) + 1,
        b = source.indexOf(last, a) + 1;
      assert(b > a);
      return source.slice(a, b);
    };
    const guard = span(
      "  const gitHead = (\n",
      "  const sources = await sourceWitness(p, head, end);\n",
    );
    assert.match(guard, /path\.join\(ROOT, "\.git\/HEAD"\), 41/);
    assert.match(guard, /gitHead === head \+ "\\n"/);
    const io =
      span(
        "const need = (condition, code) => {",
        "function exact(value, fields) {",
      ) +
      span(
        "async function physical(file) {",
        "async function policy(end = Infinity) {",
      ) +
      span(
        "function checkEnd(end) {",
        "async function writeExclusive(file, raw, end) {",
      );
    const temp = await fs.realpath(os.tmpdir());
    const owned = await fs.realpath(
      await fs.mkdtemp(path.join(temp, "benign-proof-head-")),
    );
    t.after(async () => {
      assert.equal(path.dirname(owned), temp);
      assert.match(path.basename(owned), /^benign-proof-head-/);
      assert.equal(await fs.realpath(owned), owned);
      await fs.rm(owned, { recursive: true });
    });
    const hooks = path.join(owned, "empty-hooks"),
      config = path.join(owned, "empty-config");
    await fs.mkdir(hooks);
    await fs.writeFile(config, "", { flag: "wx" });
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=" + hooks,
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Portable fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-C",
          owned,
          ...args,
        ],
        {
          env,
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 128 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
        .toString()
        .trim();
    git("init", "--initial-branch=proof");
    git("commit", "--allow-empty", "--no-gpg-sign", "-m", "owned fixture");
    const actualHead = git("rev-parse", "HEAD");
    const end = performance.now() + 10000;
    const actualCheck = vm.runInNewContext(
      io + "\nasync function actualCheck(){" + guard + "}\nactualCheck",
      {
        fs,
        syncFs,
        path,
        createHash,
        Buffer,
        performance,
        setTimeout,
        clearTimeout,
        ROOT: owned,
        head: actualHead,
        end,
      },
    );
    const symbolic = await fs.readFile(path.join(owned, ".git/HEAD"), "ascii");
    assert.equal(symbolic, "ref: refs/heads/proof\n");
    await assert.rejects(actualCheck(), /PROOF_HEAD/);
    git("checkout", "--detach", actualHead);
    const detached = await fs.readFile(path.join(owned, ".git/HEAD"));
    assert.equal(detached.length, 41);
    assert.equal(detached.toString("ascii"), actualHead + "\n");
    await actualCheck();
    assert.equal(checkoutRef(), "${{ github.sha }}");
    function checkoutRef() {
      return proofJob.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      ).with.ref;
    }
  },
);

test("reviewed image registry whole inverses preserve old043 and current7f reader bodies and fixed source closure", async () => {
  const expected = {
    python: [
      40363,
      "82f3642cbb75ed8ca43909bba30712f503a54777c0b27e400033109a18fb23af",
      "e74541f4ec1dc6ef1db561c09a7065e3311c5e04ea53bef31c983e5d427dd687",
    ],
    node: [
      43128,
      "2c4fc66bfcc383ebf7e94883f28e8cea855e4983dbeb511330938dfc611d7c20",
      "a2e646fe17b62e9c30ee76bb4d328dce4d824248a4911278750dbed4a1226358",
    ],
    workflow: [
      12491,
      "0fa77c91624fb8beefc8e9023921d79cbb194dcee0c0f58441c86d78a587f98c",
      "81a9b80fdccda02890275e28fa45f17583a9b355ccd365aaec6a7b1bd12297e0",
    ],
  };
  for (const [role, body] of [
    ["python", adapter],
    ["node", fixture],
    ["workflow", workflowText],
  ]) {
    const old = previousReviewedImages(body, role);
    assert.equal(Buffer.byteLength(old), expected[role][0]);
    assert.equal(hash(old), expected[role][1]);
    let current = old;
    if (role !== "workflow")
      current = current.replace(
        hash(legacyRawPolicy),
        "51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e",
      );
    else
      current = current
        .replaceAll(
          legacyPolicy.ref,
          "refs/heads/codex/windows-arm-benign-current-controller-20261102",
        )
        .replace("20261021.278.1", "20261030.294.1");
    assert.equal(hash(current), expected[role][2]);
  }
  assert.equal(
    hash(legacyRawPolicy),
    "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c",
  );
  assert.equal(registry.sourcePaths.length, 12);
  assert.equal(new Set(registry.sourcePaths).size, 12);
  assert.deepEqual(registry.sourcePaths, policy.sourcePaths);
  assert.deepEqual(Object.keys(registry.profiles), [
    "20261021.278.1",
    "20261030.294.1",
  ]);
  for (const [image, row] of Object.entries(registry.profiles)) {
    const raw = await fs.readFile(path.join(DIR, row.profile));
    assert.equal(raw.length, row.bytes);
    assert.equal(hash(raw), row.sha256);
    const p = JSON.parse(raw);
    assert.equal(p.image, image);
    assert.equal(p.ref, policy.ref);
    assert.deepEqual(p.sourcePaths, registry.sourcePaths);
    const old = {
      ...p,
      ref:
        image === "20261021.278.1"
          ? legacyPolicy.ref
          : "refs/heads/codex/windows-arm-benign-current-controller-20261102",
      sourcePaths: p.sourcePaths.slice(0, 8),
    };
    assert.equal(
      hash(JSON.stringify(old, null, 2) + "\n"),
      image === "20261021.278.1"
        ? hash(legacyRawPolicy)
        : "51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e",
    );
  }
});

test("reviewed image schema2 success binds actual selected image and profile and rejects archived or mixed records", async () => {
  const unknown = synthetic();
  unknown.image = "unknown";
  unknown.selectedProfileSha256 = undefined;
  assert.throws(
    () =>
      validateControllerResult(
        unknown,
        { ...policy, image: "unknown" },
        nonce,
        head,
      ),
    /PROOF_RESULT/,
  );
  for (const [image, row] of Object.entries(registry.profiles)) {
    const p = JSON.parse(await fs.readFile(path.join(DIR, row.profile)));
    const value = synthetic();
    value.image = image;
    value.selectedProfileSha256 = row.sha256;
    const checked = validateControllerResult(value, p, nonce, head);
    assert.equal(checked.proof.schemaVersion, 2);
    assert.equal(checked.proof.image, image);
    assert.equal(checked.proof.selectedProfileSha256, row.sha256);
    for (const change of [
      { schemaVersion: 1 },
      { image: "unknown" },
      { selectedProfileSha256: "0".repeat(64) },
      {
        image: image === "20261021.278.1" ? "20261030.294.1" : "20261021.278.1",
      },
    ])
      assert.throws(
        () => validateControllerResult({ ...value, ...change }, p, nonce, head),
        /PROOF_RESULT/,
      );
    for (const key of [
      "productionAdmission",
      "sourceGnQualified",
      "compilerAdmission",
      "nativeAcceptance",
      "runtimeReady",
    ])
      assert.equal(checked.proof[key], false);
  }
});

test("reviewed image actual held Node reader selects only fixed profile bytes and rejects tamper and image changes", async (t) => {
  const base = await fs.realpath(os.tmpdir());
  const owned = await fs.mkdtemp(path.join(base, "benign-registry-held-"));
  t.after(async () => {
    assert.equal(path.dirname(owned), base);
    assert.equal(await fs.realpath(owned), owned);
    await fs.rm(owned, { recursive: true });
  });
  const directory = path.join(owned, "native/windows-arm-full-sdk");
  await fs.mkdir(directory, { recursive: true });
  for (const name of [
    "qualification-job-proof-profile.json",
    ...Object.values(registry.profiles).flatMap((row) => [
      row.profile,
      row.sourceProfile,
    ]),
    registry.privatePolicy.path,
  ]) {
    const raw = Buffer.from(
      (await fs.readFile(path.join(DIR, name), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
    );
    await fs.writeFile(path.join(directory, name), raw, { flag: "wx" });
  }
  const rootLine =
    'const ROOT = fileURLToPath(new URL("../../../", import.meta.url));';
  assert.equal(fixture.split(rootLine).length, 2);
  const module = path.join(owned, "reader.mjs");
  await fs.writeFile(
    module,
    fixture.replace(rootLine, `const ROOT = ${JSON.stringify(owned)};`),
    { flag: "wx" },
  );
  // Only fixed ROOT is redirected to owned canonical data. All held readers,
  // actual OS file handles, pins, actual environment selection and clocks stay real.
  const api = await import(
    new URL("file:///" + module.replaceAll("\\", "/")).href
  );
  const prior = process.env.ImageVersion;
  try {
    for (const image of Object.keys(registry.profiles)) {
      process.env.ImageVersion = image;
      const p = await api.readReviewedProofPolicy(performance.now() + 5000);
      assert.equal(p.image, image);
      assert(
        Object.isFrozen(p) &&
          Object.isFrozen(p.sourcePaths) &&
          Object.isFrozen(p.node),
      );
      const selected = path.join(directory, registry.profiles[image].profile),
        raw = await fs.readFile(selected);
      await fs.writeFile(
        selected,
        Buffer.from(
          raw
            .toString()
            .replace(
              image,
              image === "20261021.278.1" ? "20261030.294.1" : "20261021.278.1",
            ),
        ),
      );
      await assert.rejects(
        api.readReviewedProofPolicy(performance.now() + 5000),
        /PROOF_PIN/,
      );
      await fs.writeFile(selected, raw);
      await assert.rejects(
        api.readReviewedProofPolicy(performance.now() - 1),
        /PROOF_DEADLINE/,
      );
    }
    for (const image of [
      "unknown",
      "20261021.278.2",
      "20261030.294.1 ",
      "__proto__",
      undefined,
    ]) {
      if (image === undefined) delete process.env.ImageVersion;
      else process.env.ImageVersion = image;
      await assert.rejects(
        api.readReviewedProofPolicy(performance.now() + 5000),
        /PROOF_AUTHORITY/,
      );
      await assert.rejects(
        readReviewedProofPolicy(performance.now() + 5000),
        /PROOF_AUTHORITY/,
      );
    }
  } finally {
    if (prior === undefined) delete process.env.ImageVersion;
    else process.env.ImageVersion = prior;
  }
});

test("reviewed image actual Python held reader and fixed child environment preserve variant binding without caller grants", () => {
  const result = python(String.raw`
import importlib.util,json,os,sys,tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('proof_reader_data_only',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
original=p.PROFILE.parent
registry=json.loads((original/'qualification-job-proof-profile.json').read_text())
prior=os.environ.get('ImageVersion')
with tempfile.TemporaryDirectory(prefix='benign-reader-data-only-')as name:
 root=Path(name).resolve()
 for leaf in ['qualification-job-proof-profile.json',registry['privatePolicy']['path']]+[row[key]for row in registry['profiles'].values()for key in('profile','sourceProfile')]:
  (root/leaf).write_bytes((original/leaf).read_bytes().replace(b'\r\n',b'\n'))
 p.PROFILE=root/'qualification-job-proof-profile.json'
 try:
  for image,row in registry['profiles'].items():
   os.environ['ImageVersion']=image;value=p.profile();assert value['image']==image
   os.environ['GH_TOKEN']='PRIVATE';env=p.launch_environment(root,image);assert env['ImageVersion']==image and 'GH_TOKEN'not in env
   assert set(env)<=set(('ImageVersion','SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','PYTHONDONTWRITEBYTECODE','RUNNER_TRACKING_ID'))
   other=next(candidate for candidate in registry['profiles']if candidate!=image)
   try:p.launch_environment(root,other);raise AssertionError('mixed env accepted')
   except ValueError as e:assert e.args==('PROOF_ENVIRONMENT',)
   raw=(root/row['profile']).read_bytes();(root/row['profile']).write_bytes(raw.replace(image.encode(),other.encode()))
   try:p.profile();raise AssertionError('mixed profile accepted')
   except ValueError as e:assert e.args==('PROOF_PIN',)
   (root/row['profile']).write_bytes(raw)
   # Exact suite preparation check precedes root reads, kernel import and actors.
   marker=object();calls=[]
   def stop(*args):calls.append(args);raise ValueError('owned-root-test-stop')
   p.checked_root=stop;os.environ['GITHUB_SHA']='a'*40
   context={'kind':'windows-benign-job-preparation','head':'a'*40,'startedMs':int(p.time.time()*1000),'image':image,'selectedProfileSha256':row['sha256'],'nonce':'unit'}
   for key,bad in [('image',other),('selectedProfileSha256','0'*64)]:
    try:p.suite(root,json.dumps({**context,key:bad}),value);raise AssertionError('mixed preparation accepted')
    except ValueError as e:assert e.args==('PROOF_CONTEXT',)
   assert calls==[]
   try:p.suite(root,json.dumps(context),value);raise AssertionError('root test stop absent')
   except ValueError as e:assert e.args==('owned-root-test-stop',)
   assert len(calls)==1
  for image in ('unknown','20261021.278.2','20261030.294.1 ','__proto__'):
   os.environ['ImageVersion']=image
   try:p.profile();raise AssertionError('unreviewed image accepted')
   except ValueError as e:assert e.args==('PROOF_AUTHORITY',)
 finally:
  if prior is None:os.environ.pop('ImageVersion',None)
  else:os.environ['ImageVersion']=prior
print('two-fixed-held-readers-and-environments')`);
  assert.match(result, /two-fixed-held-readers-and-environments/);
});

test("reviewed image worker and actor actual context guards reject mixed image or profile before actor behavior", () => {
  for (const [start, last, code] of [
    ["async function worker(", "async function actor(", "PROOF_CASE_CONTEXT"],
    [
      "async function actor(",
      "export async function main(",
      "PROOF_ACTOR_CONTEXT",
    ],
  ]) {
    const a = fixture.indexOf(start),
      b = fixture.indexOf(last, a + 1);
    assert(a >= 0 && b > a);
    const part = fixture.slice(a, b);
    const label = `    "${code}",`;
    const end = part.indexOf(label);
    assert(end > 0);
    const begin = part.lastIndexOf("  need(\n", end);
    assert(begin >= 0);
    const guard = part.slice(begin, part.indexOf("  );", end) + 5);
    const good = {
      image: policy.image,
      selectedProfileSha256: registry.profiles[policy.image].sha256,
      kind: "windows-benign-job-case",
      case: CASES[0],
      nonce,
      root: "C:/owned",
      subjectSha256: policy.subject.sha256,
      workEndMs: Date.now() + 10000,
    };
    const need = (ok, value) => assert(ok, value);
    const run = (context) =>
      vm.runInNewContext(guard, {
        context,
        p: policy,
        selectedProfileSha: (p) => registry.profiles[p.image].sha256,
        name: CASES[0],
        nonce,
        path,
        file: "C:/owned/case.json",
        Date,
        Number,
        need,
      });
    run(good);
    for (const change of [
      { image: "20261030.294.1" },
      { selectedProfileSha256: "0".repeat(64) },
    ])
      assert.throws(() => run({ ...good, ...change }), new RegExp(code));
  }
  assert.match(adapter, /launch_environment\(case, p\["image"\]\)/);
  assert.match(workflowText, /readReviewedProofPolicy\(clock\.monotonicEnd\)/);
  assert.match(
    proofJob.steps[0].run,
    /-cne '20261021\.278\.1' -and \$env:ImageVersion -cne '20261030\.294\.1'/,
  );
});

test("closed kernel result diagnostic copies only bounded own primitives and never changes a primary failure", () => {
  const output = JSON.parse(
    python(String.raw`
import ast,json,sys
from pathlib import Path
ns={'__name__':'closed_kernel_diagnostic_model','__file__':sys.argv[1]}
exec(compile(Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),ns)
case=ns['CASES'][5];observe=ns['_observe_controller'];copy=ns['_observe_kernel_result'];failure=ns['controller_failure']
observe('case-readback',case,5)
raw={'outcome':'compiler-failure','rootExit':1,'failureStage':'root-exit','winerror':5,'activeAtEnd':0,'cleanupVerified':True,'logReadersStopped':True,'rootReaped':True,'observerStopped':True,'started':True,'resumed':True,'assignedBeforeResume':True,'stderr':'PRIVATE_PATH_COMMAND_TOKEN','message':'PRIVATE_PATH_COMMAND_TOKEN'}
copy(raw);primary=ValueError('PROOF_CASE_OUTCOME');value=failure(primary)
assert primary.args==('PROOF_CASE_OUTCOME',) and value['code']=='PROOF_CASE_OUTCOME'
assert value['kernel']=={'outcome':'compiler-failure','rootExit':1,'nativeStage':'root-exit','nativeErrno':5,'activeAtEnd':0,'cleanupVerified':True,'logReadersStopped':True,'rootReaped':True,'observerStopped':True,'started':True,'resumed':True,'assignedBeforeResume':True}
raw['rootExit']=99;assert value['kernel']['rootExit']==1
ns['_controller_observation']['kernel']['rootExit']=33;assert value['kernel']['rootExit']==1
joined=value
class Hostile:
 def __getattribute__(self,key):raise AssertionError('object getter invoked')
 def __str__(self):raise AssertionError('object string invoked')
 def __bool__(self):raise AssertionError('object boolean invoked')
class Mapping(dict):
 def get(self,*args):raise AssertionError('mapping getter invoked')
 def keys(self):raise AssertionError('mapping keys invoked')
for bad in(None,False,Hostile(),Mapping(raw),{Hostile():1},{str(i):i for i in range(65)}):
 copy(bad);assert failure(primary)['kernel']is None
unknown={key:Hostile()for key in raw if key not in('stderr','message')};copy(unknown)
assert all(field is None for field in failure(primary)['kernel'].values())
for key,bad in [('outcome','PRIVATE_PATH_COMMAND_TOKEN'),('outcome','x'*100000),('rootExit',True),('rootExit',-1),('rootExit',4294967296),('winerror',False),('winerror',-1),('activeAtEnd',65),('cleanupVerified',1),('failureStage','PRIVATE_PATH_COMMAND_TOKEN')]:
 changed={**raw,key:bad};copy(changed);projected={'winerror':'nativeErrno','failureStage':'nativeStage'}.get(key,key)
 assert failure(primary)['kernel'][projected] is None
copy({'outcome':'launcher-failure','failureStage':'launcher-io','winerror':4294967295,'rootExit':4294967295})
boundary=failure(primary);assert boundary['kernel']['nativeStage']=='launcher-io' and boundary['kernel']['nativeErrno']==4294967295
observe('case-prepare',ns['CASES'][6],5);assert failure(primary)['kernel']is None
copy(raw);assert failure(primary)['kernel']is None
assert len(json.dumps(joined,separators=(',',':')).encode())<=2048
assert 'PRIVATE_PATH_COMMAND_TOKEN'not in json.dumps(joined)
# Closed enum is derived from the unchanged actual kernel's outcome literals.
tree=ast.parse(Path(sys.argv[2]).read_bytes());labels=set()
for node in ast.walk(tree):
 if isinstance(node,ast.Assign)and any(isinstance(t,ast.Subscript)and isinstance(t.value,ast.Name)and t.value.id=='result'and isinstance(t.slice,ast.Constant)and t.slice.value=='outcome'for t in node.targets):
  labels.update(item.value for item in ast.walk(node.value)if isinstance(item,ast.Constant)and isinstance(item.value,str))
assert labels<=ns['_KERNEL_OUTCOMES']
print(json.dumps({'observed':joined,'boundary':boundary,'outcomes':sorted(ns['_KERNEL_OUTCOMES'])}))`),
  );
  const selected = validateControllerFailure(
    Buffer.from(JSON.stringify(output.observed)),
  );
  assert(selected);
  assert.equal(selected.kernel.rootExit, 1);
  assert.equal(selected.kernel.cleanupVerified, true);
  assert(
    validateControllerFailure(Buffer.from(JSON.stringify(output.boundary))),
  );
  assert(!JSON.stringify(output).includes("PRIVATE_PATH_COMMAND_TOKEN"));
  assert.match(
    adapter,
    /_observe_controller\("case-readback", name, len\(case_rows\)\)[^\n]*\n            _observe_kernel_result\(result\)/,
  );
  const block = fixture.slice(
    fixture.indexOf("// BEGIN closed kernel result validation"),
    fixture.indexOf("// END closed kernel result validation"),
  );
  const enums = vm.runInNewContext(
    block + ";([...CONTROLLER_KERNEL_OUTCOMES])",
  );
  assert.deepEqual([...enums].sort(), output.outcomes);
});

test("closed kernel failure Node selector rejects unknown fields malformed enums and forged join or numeric types", () => {
  const envelope = {
    ...controllerFailureFixture(),
    phase: "case-readback",
    case: CASES[5],
    completedCases: 5,
    code: "PROOF_CASE_OUTCOME",
    kernel: {
      outcome: "descendants-left",
      rootExit: 0,
      nativeStage: null,
      nativeErrno: null,
      activeAtEnd: 0,
      cleanupVerified: true,
      logReadersStopped: true,
      rootReaped: true,
      observerStopped: true,
      started: true,
      resumed: true,
      assignedBeforeResume: true,
    },
  };
  const select = (value) =>
    validateControllerFailure(Buffer.from(JSON.stringify(value)));
  assert(select(envelope));
  for (const [key, value] of [
    ["outcome", "PRIVATE_SECRET"],
    ["outcome", null],
    ["rootExit", true],
    ["rootExit", 4294967296],
    ["nativeErrno", -1],
    ["activeAtEnd", 65],
    ["activeAtEnd", 0.5],
    ["nativeStage", "PRIVATE_SECRET"],
    ["cleanupVerified", 1],
    ["rootReaped", "true"],
    ["private", "PRIVATE_SECRET"],
  ]) {
    const candidate = {
      ...envelope,
      kernel: { ...envelope.kernel, [key]: value },
    };
    if (key === "outcome" && value === null) assert(select(candidate));
    else assert.equal(select(candidate), null);
  }
  const missing = { ...envelope, kernel: { ...envelope.kernel } };
  delete missing.kernel.rootExit;
  assert.equal(select(missing), null);
  assert.equal(select({ ...envelope, phase: "case-run" }), null);
  assert.equal(select({ ...envelope, case: null }), null);
  assert.equal(select({ ...envelope, kernel: [] }), null);
  assert.equal(select({ ...envelope, kernel: 42 }), null);
  const old = { ...envelope };
  delete old.kernel;
  assert.equal(select(old), null);
});

function actualActorSource(text) {
  const start = text.indexOf("async function actor(");
  const end = text.indexOf("export async function main(", start);
  assert(start > 0 && end > start);
  return text.slice(start, end);
}

test("actor hold-child detachment exact inverse restores complete053 before kernel and registry history", () => {
  const old = previousActorLiveness(fixture);
  assert.equal(Buffer.byteLength(old), 48966);
  assert.equal(
    hash(old),
    "1890a4b7b32a6ac4b213a850e612dbe576978db8e6dfd097e91e801ddf0e9e3e",
  );
  assert.equal(actualActorSource(fixture).split("detached: true").length, 2);
  assert.equal(actualActorSource(fixture).split("detached: false").length, 2);
});

test("actual actor forwards only orphan pipe-descendant and middle hold children detached while reparent remains joined (modeled process)", async () => {
  for (const kind of ["orphan", "pipe-descendant", "middle", "reparent"]) {
    const observations = [];
    for (const text of [previousActorLiveness(fixture), fixture]) {
      const calls = [];
      const writes = [];
      const file = path.join("owned", "case", "case.json");
      const context = {
        image: policy.image,
        selectedProfileSha256: registry.profiles[policy.image].sha256,
        case: "case",
        nonce,
        root: path.dirname(file),
        workEndMs: Date.now() + 10000,
      };
      const run = vm.runInNewContext(`(${actualActorSource(text)})`, {
        process: {
          platform: "win32",
          arch: "x64",
          env: { FIXED_MODELED_ENV: "same" },
          stdout: { write: (raw) => writes.push(raw) },
        },
        path,
        Date,
        JSON,
        SELF: "fixed-fixture.mjs",
        need: (ok, code) => assert(ok, code),
        caseFileScope: () => nonce,
        selectedProfileSha: () => context.selectedProfileSha256,
        held: async () => ({ raw: Buffer.from(JSON.stringify(context)) }),
        fs: {
          stat: async () => ({ size: 1 }),
          writeFile: async () => {},
        },
        spawn: (executable, argv, options) => {
          calls.push(JSON.parse(JSON.stringify({ executable, argv, options })));
          const child = new EventEmitter();
          child.pid = 12345;
          child.stdout = new EventEmitter();
          child.unref = () => writes.push("unref");
          queueMicrotask(() => {
            child.emit("spawn");
            child.stdout.emit("data", Buffer.from("PROOF_CHILD:23456\n"));
            child.emit("close", 0);
          });
          return child;
        },
      });
      await run(kind, file, "a".repeat(64), policy);
      assert.equal(calls.length, 1);
      observations.push({ call: calls[0], writes });
    }
    const [old, current] = observations;
    assert.equal(old.call.options.detached, false);
    assert.equal(current.call.options.detached, kind !== "reparent");
    assert.deepEqual(current.writes, old.writes);
    const expected = structuredClone(old.call);
    expected.options.detached = kind !== "reparent";
    assert.deepEqual(current.call, expected);
    assert.equal(current.call.argv[4], kind === "reparent" ? "middle" : "hold");
    assert.deepEqual(
      current.call.options.stdio,
      kind === "reparent"
        ? ["ignore", "pipe", "pipe"]
        : kind === "pipe-descendant"
          ? ["ignore", "inherit", "inherit"]
          : "ignore",
    );
  }
});

test(
  "Windows actual extracted actor RED non-detached and GREEN detached hold liveness across parent exit (no kernel Job qualification)",
  {
    skip: process.platform !== "win32" || process.arch !== "x64",
    timeout: 35000,
  },
  async (t) => {
    t.diagnostic(
      `Local fixture semantics only: ${process.version}; hosted Node24.19 source binding is separate`,
    );
    const owned = await fs.mkdtemp(path.join(os.tmpdir(), "cef-actor-exit-"));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const exists = async (file) =>
      fs.stat(file).then(
        () => true,
        () => false,
      );
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
      }
    };
    const until = async (predicate, end) => {
      while (!(await predicate())) {
        assert(Date.now() < end, "finite actor observation deadline");
        await sleep(20);
      }
    };
    let childPid;
    try {
      for (const [label, text, expectedAlive] of [
        ["red", previousActorLiveness(fixture), false],
        ["green", fixture, true],
      ]) {
        const root = path.join(owned, label);
        await fs.mkdir(root);
        const file = path.join(root, "case.json");
        const context = {
          image: "inert-test",
          selectedProfileSha256: "b".repeat(64),
          case: label,
          nonce,
          root,
          workEndMs: Date.now() + 30000,
        };
        const raw = Buffer.from(JSON.stringify(context));
        await fs.writeFile(file, raw);
        const script = path.join(root, "actor.cjs");
        await fs.writeFile(
          script,
          `const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'), syncFs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const SELF=__filename, p={image:'inert-test',node:{path:process.execPath}};
const need=(ok,code)=>{if(!ok)throw new Error(code)},caseFileScope=()=>${JSON.stringify(nonce)},selectedProfileSha=()=>${JSON.stringify(context.selectedProfileSha256)};
const held=async(file,cap,pin)=>{const raw=await fs.readFile(file);need(raw.length===pin.bytes&&raw.length<=cap&&createHash('sha256').update(raw).digest('hex')===pin.sha256,'INERT_PIN');return {raw}};
${actualActorSource(text)}
actor(process.argv[3],process.argv[4],process.argv[5],p).then(()=>{
if(process.argv[3]==='hold'){
syncFs.writeFileSync(path.join(path.dirname(process.argv[4]),'ready'),'ready');
process.once('exit',()=>syncFs.writeFileSync(path.join(path.dirname(process.argv[4]),'done'),'done'));
}
}).catch(()=>{process.exitCode=1});
`,
        );
        const parent = nativeSpawn(
          process.execPath,
          [
            "--disable-proto=throw",
            "--no-addons",
            script,
            "--actor",
            "middle",
            file,
            hash(raw),
          ],
          {
            cwd: root,
            windowsHide: true,
            detached: false,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        parent.stdout.on("data", (raw) => {
          stdout += raw;
        });
        parent.stderr.on("data", (raw) => {
          stderr += raw;
        });
        const code = await new Promise((resolve, reject) => {
          parent.once("error", reject);
          parent.once("close", resolve);
        });
        assert.equal(code, 0, stderr);
        const matched = /^PROOF_CHILD:([1-9][0-9]{0,9})\n$/.exec(stdout);
        assert(matched);
        childPid = Number(matched[1]);
        if (expectedAlive) {
          await until(
            () => exists(path.join(root, "ready")),
            Date.now() + 3000,
          );
          assert.equal(
            alive(childPid),
            true,
            "detached hold survives spawning parent exit",
          );
          await until(
            () => exists(path.join(root, "done")),
            Date.now() + 22000,
          );
        }
        await until(() => !alive(childPid), Date.now() + 3000);
        childPid = undefined;
      }
    } finally {
      // The exact hold actor self-exits after20s; no kill, adoption or Job probe.
      if (childPid !== undefined)
        await until(() => !alive(childPid), Date.now() + 23000);
      await fs.rm(owned, { recursive: true, force: true });
    }
  },
);

test("closed kernel diagnostics exact inverse preserves full reviewed89a Python and Node and every original outcome actor and lease", async () => {
  const expected = {
    python: [
      43258,
      "6a9fa579246ff0ba0d011e688ab72c63f6cfc9eb7c80f04b94b5ac5cd21e36b2",
    ],
    node: [
      47206,
      "1819b4c3b8febb915c66d244626157d29774112841e2ea09e78322550d321bd9",
    ],
  };
  for (const [role, body] of [
    ["python", adapter],
    ["node", fixture],
  ]) {
    const old = previousKernelResultDiagnostics(body, role);
    assert.equal(Buffer.byteLength(old), expected[role][0]);
    assert.equal(hash(old), expected[role][1]);
  }
  const kernel = Buffer.from(
    (await fs.readFile(path.join(DIR, "job.py"), "utf8")).replaceAll(
      "\r\n",
      "\n",
    ),
  );
  assert.equal(kernel.length, 23788);
  assert.equal(
    hash(kernel),
    "70f10cc78c6b75519d3b33cb02788b49f058bdfdf0780b27aeb7becde0b5e716",
  );
  assert.equal(
    hash(rawRegistry),
    "63c72846b9506a78f6d968a64445a9f495bc04523509327c43286dde1baa6240",
  );
});
