"""Windows compiled checkpoint codec and fixed GitHub transport; DATA only.

Only dedicated download/upload CLI modes read GH_TOKEN. Codec/source modes do
not read credentials, start processes, issue source capabilities, or admit SDKs.
"""
from contextlib import contextmanager
import base64
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checkpoint_inputs as inputs

EXECUTION_ADMITTED = False
REPO = Path(__file__).resolve().parents[2]
REPOSITORY = 'supermarsx/sortOfRemoteNG'
REPOSITORY_ID = 1010282954
WORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'
API = 'https://api.github.com'
UPLOADS = 'https://uploads.github.com'
HELPER = 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-checkpoint-archive.py'
HELPER_PIN = dict(bytes=154847, sha256='043659e63e1cfc50b5af8209a1e30fd924ed379e7355069fa654b657bc789113')
OUTPUT = 'full-sdk-checkpoint-output'
OUT = 'source-checkout/src/out/Release_GN_arm64'
MAX_RECORD = 2 * 1024**2
MAX_CHUNK = 1024**3
MAX_TOTAL = 32 * 1024**3 + inputs.MAX_SIDECAR + 160 * 1024**2 + 2 * MAX_RECORD
GRAPH_FILE = 'source-gn-logs/fresh-graph-pins.json'
TOOL_FILE = 'installed-source-inventory.json'
SEAL_ZIP_MAX = 3 * 1024**2
SDK_TARGET = 'aarch64-pc-windows-msvc'
SDK_BUNDLE = 'full-sdk-package/bundle'
SDK_MAX_ASSET = 2 * 1024**3 - 1
STAGES = {'identity', 'source-chain', 'engine-chain', 'sidecar-record', 'pack', 'independent-restore',
          'record-seal', 'restore-input', 'restore-out', 'restore-install', 'sidecar-apply', 'api-scope',
          'api-tree', 'api-run', 'release', 'asset-download', 'asset-upload', 'ready'}

# Closed labels derived from reviewed literal predicates, never raw exceptions.
SAFE_CODES = frozenset(['API_CLOSED_ROUTE', 'API_ROUTE', 'ARCHIVE', 'ARGV', 'ASSET_COUNT', 'ASSET_GROWTH', 'ASSET_HASH', 'ASSET_LENGTH', 'ASSET_REDIRECT', 'ASSET_ROW', 'ASSET_SET', 'ASSET_SIZE', 'ASSET_WRITE', 'BLOB', 'BLOB_PIN', 'BOOTSTRAP_BOUND', 'BOOTSTRAP_CHANGED', 'BOOTSTRAP_IDENTITY', 'BOOTSTRAP_PIN', 'CANONICAL_ROOT', 'CHAIN_CHANGED', 'CHUNK_NAME', 'COMMIT', 'COMPRESSED_BOUND', 'COPY', 'CURRENT_HEAD', 'CURRENT_SCOPE', 'DEADLINE_CHAIN', 'ENGINE_CLOSE', 'ENGINE_CONTEXT', 'ENGINE_RESULT', 'EVIDENCE_BINDING', 'EVIDENCE_DEADLINE', 'EVIDENCE_FULFILLED', 'EVIDENCE_PIN', 'EVIDENCE_ROW', 'EVIDENCE_SET', 'EVIDENCE_SOURCE_CLOSE', 'FILE_BOUND', 'FILE_CHANGED', 'FILE_GROWTH', 'FILE_PIN', 'GRAPH_DIGEST', 'GRAPH_PATH', 'GRAPH_SHAPE', 'HELPER_PIN', 'HELPER_PRODUCER', 'HTTP_BODY', 'HTTP_ENCODING', 'HTTP_HEADERS', 'HTTP_LENGTH', 'HTTP_STATUS', 'IDENTITY', 'IMAGE', 'INVENTORY', 'JOB_CLOSURE', 'JOB_IDENTITY', 'JOB_POLICY', 'JSON_BOUND', 'JSON_DUPLICATE', 'JSON_NUMBER', 'LAUNCH_IDENTITY', 'LEASE', 'LIVE_BOUND', 'LIVE_PIN', 'METADATA_CHAIN', 'MODULE_ROOT', 'ORIGINAL_RESERVE', 'ORIGINAL_SOURCE_DEADLINE', 'PACK_COMPLETE', 'PIN', 'POLICY', 'PRIOR_ATTEMPT', 'PRIOR_BINDING', 'PRIOR_CHANGED', 'PRODUCER_COUNT', 'PRODUCER_PATH', 'PRODUCER_ROW', 'RAW_CHAIN', 'RAW_DEADLINE', 'RAW_SUCCESS', 'READY_PIN', 'READY_READBACK', 'READY_SCOPE', 'READY_WRITE', 'RECORD', 'RECORD_ASSET', 'RECORD_BOUND', 'RELATIVE', 'RELEASE_ID', 'RELEASE_SCOPE', 'RESTORE_ASSET_GROWTH', 'RESTORE_ASSET_IDENTITY', 'RESTORE_ASSET_PIN', 'RESTORE_ASSET_SIZE', 'RESTORE_COMPLETE', 'RESTORE_ORDER', 'RESTORE_OUT', 'RESTORE_PACKET', 'RESTORE_PRIOR_RUN', 'RESTORE_RECORD_PIN', 'RESTORE_SOURCE', 'RESTORE_SOURCE_PIN', 'ROOT_ARGUMENT', 'RUNNER_TEMP', 'RUN_ID', 'RUN_SCOPE', 'SDK_ARCHIVE_BINDING', 'SDK_ASSET_ROW', 'SDK_ASSET_SET', 'SDK_CEF_FULFILLED', 'SDK_CONTROLLER_REPORT', 'SDK_CURRENT_BINDING', 'SDK_DESCRIPTOR_PIN', 'SDK_METADATA_BINDING', 'SDK_PACKAGE_PIN', 'SDK_PHASE_CHANGED', 'SDK_PHASE_CLOSE', 'SDK_PHASE_RESULT', 'SDK_QUARANTINE_RELEASE', 'SDK_REPORT_CHANGED', 'SDK_SOURCE_LOCK', 'SDK_UPLOADED_PIN', 'SDK_UPLOADED_SET', 'SEAL_ARTIFACT_COUNT', 'SEAL_ARTIFACT_HASH', 'SEAL_ARTIFACT_MATCH', 'SEAL_ARTIFACT_SCOPE', 'SEAL_ARTIFACT_SIZE', 'SEAL_ASSET', 'SEAL_ASSET_BINDING', 'SEAL_RELEASE', 'SEAL_SCOPE', 'SEAL_WRITE', 'SEAL_ZIP_BOUND', 'SEAL_ZIP_MEMBER', 'SEAL_ZIP_MEMBERS', 'SEAL_ZIP_SIZE', 'SOURCE_CHAIN', 'SOURCE_CONTEXT_PIN', 'SOURCE_EPOCH', 'SOURCE_POLICY', 'SOURCE_SCOPE', 'STAGE', 'TOKEN', 'TOOLS_PROOF', 'TRANSPORT_CLOCK_DURATION', 'TRANSPORT_CLOCK_INTEGER', 'TRANSPORT_CLOCK_ROLLBACK', 'TRANSPORT_CLOCK_SCOPE', 'TRANSPORT_DEADLINE', 'TRANSPORT_FIRST_CLOCK', 'TREE_BOUND', 'TREE_DUPLICATE', 'TREE_PATH', 'UPLOADED_SET', 'UPLOAD_ASSET', 'UPLOAD_BINDING', 'UPLOAD_BODY', 'UPLOAD_RELEASE', 'UPLOAD_ROOT', 'WORKFLOW', 'WRITE'])
SIDECAR_CODES = {'CHECKPOINT_INPUTS_BYTES': 'SIDECAR_BYTES', 'CHECKPOINT_INPUTS_CASE_ALIAS': 'SIDECAR_CASE_ALIAS', 'CHECKPOINT_INPUTS_CHANGED': 'SIDECAR_CHANGED', 'CHECKPOINT_INPUTS_CLOCK_ROLLBACK': 'SIDECAR_CLOCK_ROLLBACK', 'CHECKPOINT_INPUTS_DEADLINE': 'SIDECAR_DEADLINE', 'CHECKPOINT_INPUTS_DIRECTORY': 'SIDECAR_DIRECTORY', 'CHECKPOINT_INPUTS_DIRECTORY_CHANGED': 'SIDECAR_DIRECTORY_CHANGED', 'CHECKPOINT_INPUTS_END': 'SIDECAR_END', 'CHECKPOINT_INPUTS_ENTRIES': 'SIDECAR_ENTRIES', 'CHECKPOINT_INPUTS_EPOCH': 'SIDECAR_EPOCH', 'CHECKPOINT_INPUTS_FILE_BOUND': 'SIDECAR_FILE_BOUND', 'CHECKPOINT_INPUTS_GIT_METADATA_BOUND': 'SIDECAR_GIT_METADATA_BOUND', 'CHECKPOINT_INPUTS_GROWTH': 'SIDECAR_GROWTH', 'CHECKPOINT_INPUTS_HEADER': 'SIDECAR_HEADER', 'CHECKPOINT_INPUTS_IDENTITY': 'SIDECAR_IDENTITY', 'CHECKPOINT_INPUTS_JSON_CANONICAL': 'SIDECAR_JSON_CANONICAL', 'CHECKPOINT_INPUTS_JSON_DUPLICATE': 'SIDECAR_JSON_DUPLICATE', 'CHECKPOINT_INPUTS_JSON_NUMBER': 'SIDECAR_JSON_NUMBER', 'CHECKPOINT_INPUTS_LINE': 'SIDECAR_LINE', 'CHECKPOINT_INPUTS_MTIME': 'SIDECAR_MTIME', 'CHECKPOINT_INPUTS_MTIME_CHANGED': 'SIDECAR_MTIME_CHANGED', 'CHECKPOINT_INPUTS_MTIME_PRECISION': 'SIDECAR_MTIME_PRECISION', 'CHECKPOINT_INPUTS_NAMESPACE': 'SIDECAR_NAMESPACE', 'CHECKPOINT_INPUTS_NAME_SET': 'SIDECAR_NAME_SET', 'CHECKPOINT_INPUTS_OPEN': 'SIDECAR_OPEN', 'CHECKPOINT_INPUTS_PATH': 'SIDECAR_PATH', 'CHECKPOINT_INPUTS_PRODUCER': 'SIDECAR_PRODUCER', 'CHECKPOINT_INPUTS_RAW_BOUND': 'SIDECAR_RAW_BOUND', 'CHECKPOINT_INPUTS_REGULAR': 'SIDECAR_REGULAR', 'CHECKPOINT_INPUTS_ROOT': 'SIDECAR_ROOT', 'CHECKPOINT_INPUTS_ROOT_ALIAS': 'SIDECAR_ROOT_ALIAS', 'CHECKPOINT_INPUTS_ROOT_CHANGED': 'SIDECAR_ROOT_CHANGED', 'CHECKPOINT_INPUTS_ROW': 'SIDECAR_ROW', 'CHECKPOINT_INPUTS_SET_MTIME': 'SIDECAR_SET_MTIME', 'CHECKPOINT_INPUTS_SIDECAR_BOUND': 'SIDECAR_SIDECAR_BOUND', 'CHECKPOINT_INPUTS_SIDECAR_CHANGED': 'SIDECAR_SIDECAR_CHANGED', 'CHECKPOINT_INPUTS_SIDECAR_PIN': 'SIDECAR_SIDECAR_PIN', 'CHECKPOINT_INPUTS_SOURCE': 'SIDECAR_SOURCE', 'CHECKPOINT_INPUTS_WRITE': 'SIDECAR_WRITE'}
ARCHIVE_CODES = {'archive-deadline': 'ARCHIVE_ARCHIVE_DEADLINE', 'asset-hash': 'ARCHIVE_ASSET_HASH', 'asset-size': 'ARCHIVE_ASSET_SIZE', 'checkpoint-envelope': 'ARCHIVE_CHECKPOINT_ENVELOPE', 'chunk-bound': 'ARCHIVE_CHUNK_BOUND', 'chunk-name': 'ARCHIVE_CHUNK_NAME', 'compressed-bound': 'ARCHIVE_COMPRESSED_BOUND', 'deadline-bound': 'ARCHIVE_DEADLINE_BOUND', 'decoded-byte-bound': 'ARCHIVE_DECODED_BYTE_BOUND', 'decoded-read-bound': 'ARCHIVE_DECODED_READ_BOUND', 'diagnostic': 'ARCHIVE_DIAGNOSTIC', 'external-link-diagnostic-shape': 'ARCHIVE_EXTERNAL_LINK_DIAGNOSTIC_SHAPE', 'external-member-diagnostic-bound': 'ARCHIVE_EXTERNAL_MEMBER_DIAGNOSTIC_BOUND', 'generated-link-kind': 'ARCHIVE_GENERATED_LINK_KIND', 'generated-link-owner': 'ARCHIVE_GENERATED_LINK_OWNER', 'generated-link-recipe': 'ARCHIVE_GENERATED_LINK_RECIPE', 'generated-link-recipe-mismatch': 'ARCHIVE_GENERATED_LINK_RECIPE_MISMATCH', 'generated-link-state': 'ARCHIVE_GENERATED_LINK_STATE', 'generated-link-target': 'ARCHIVE_GENERATED_LINK_TARGET', 'input-alias': 'ARCHIVE_INPUT_ALIAS', 'input-bound': 'ARCHIVE_INPUT_BOUND', 'input-link': 'ARCHIVE_INPUT_LINK', 'inventory-file-alias': 'ARCHIVE_INVENTORY_FILE_ALIAS', 'inventory-file-pin': 'ARCHIVE_INVENTORY_FILE_PIN', 'inventory-files': 'ARCHIVE_INVENTORY_FILES', 'inventory-mode': 'ARCHIVE_INVENTORY_MODE', 'inventory-row': 'ARCHIVE_INVENTORY_ROW', 'inventory-shape': 'ARCHIVE_INVENTORY_SHAPE', 'inventory-stamp': 'ARCHIVE_INVENTORY_STAMP', 'link-recipe': 'ARCHIVE_LINK_RECIPE', 'link-recipe-bound': 'ARCHIVE_LINK_RECIPE_BOUND', 'lossless-inventory-stamp': 'ARCHIVE_LOSSLESS_INVENTORY_STAMP', 'manifest-bound': 'ARCHIVE_MANIFEST_BOUND', 'manifest-required': 'ARCHIVE_MANIFEST_REQUIRED', 'member-alias': 'ARCHIVE_MEMBER_ALIAS', 'member-hash': 'ARCHIVE_MEMBER_HASH', 'member-path': 'ARCHIVE_MEMBER_PATH', 'member-pax': 'ARCHIVE_MEMBER_PAX', 'member-pax-bound': 'ARCHIVE_MEMBER_PAX_BOUND', 'member-size': 'ARCHIVE_MEMBER_SIZE', 'member-type': 'ARCHIVE_MEMBER_TYPE', 'metadata-bound': 'ARCHIVE_METADATA_BOUND', 'missing-generated-link': 'ARCHIVE_MISSING_GENERATED_LINK', 'missing-member': 'ARCHIVE_MISSING_MEMBER', 'output-bound': 'ARCHIVE_OUTPUT_BOUND', 'overlap': 'ARCHIVE_OVERLAP', 'pin-bound': 'ARCHIVE_PIN_BOUND', 'pin-shape': 'ARCHIVE_PIN_SHAPE', 'restore-output': 'ARCHIVE_RESTORE_OUTPUT', 'restored-metadata': 'ARCHIVE_RESTORED_METADATA', 'seal-bound': 'ARCHIVE_SEAL_BOUND', 'seal-zip-bound': 'ARCHIVE_SEAL_ZIP_BOUND', 'seal-zip-members': 'ARCHIVE_SEAL_ZIP_MEMBERS', 'short-member': 'ARCHIVE_SHORT_MEMBER', 'short-write': 'ARCHIVE_SHORT_WRITE', 'source-changed': 'ARCHIVE_SOURCE_CHANGED', 'source-cipd-current': 'ARCHIVE_SOURCE_CIPD_CURRENT', 'source-cipd-description': 'ARCHIVE_SOURCE_CIPD_DESCRIPTION', 'source-cipd-duplicate': 'ARCHIVE_SOURCE_CIPD_DUPLICATE', 'source-cipd-layout': 'ARCHIVE_SOURCE_CIPD_LAYOUT', 'source-cipd-link': 'ARCHIVE_SOURCE_CIPD_LINK', 'source-context-bound': 'ARCHIVE_SOURCE_CONTEXT_BOUND', 'source-context-required': 'ARCHIVE_SOURCE_CONTEXT_REQUIRED', 'source-detached-head': 'ARCHIVE_SOURCE_DETACHED_HEAD', 'source-diagnostic-root': 'ARCHIVE_SOURCE_DIAGNOSTIC_ROOT', 'source-entry-bound': 'ARCHIVE_SOURCE_ENTRY_BOUND', 'source-excluded-link': 'ARCHIVE_SOURCE_EXCLUDED_LINK', 'source-external-aggregate': 'ARCHIVE_SOURCE_EXTERNAL_AGGREGATE', 'source-external-changed': 'ARCHIVE_SOURCE_EXTERNAL_CHANGED', 'source-external-input-unattested': 'ARCHIVE_SOURCE_EXTERNAL_INPUT_UNATTESTED', 'source-external-link': 'ARCHIVE_SOURCE_EXTERNAL_LINK', 'source-external-link-cycle': 'ARCHIVE_SOURCE_EXTERNAL_LINK_CYCLE', 'source-external-link-kind': 'ARCHIVE_SOURCE_EXTERNAL_LINK_KIND', 'source-external-report-readback': 'ARCHIVE_SOURCE_EXTERNAL_REPORT_READBACK', 'source-file-changed': 'ARCHIVE_SOURCE_FILE_CHANGED', 'source-file-size': 'ARCHIVE_SOURCE_FILE_SIZE', 'source-fixed-paths': 'ARCHIVE_SOURCE_FIXED_PATHS', 'source-git-admin-kind': 'ARCHIVE_SOURCE_GIT_ADMIN_KIND', 'source-identity': 'ARCHIVE_SOURCE_IDENTITY', 'source-image': 'ARCHIVE_SOURCE_IMAGE', 'source-json-duplicate': 'ARCHIVE_SOURCE_JSON_DUPLICATE', 'source-link': 'ARCHIVE_SOURCE_LINK', 'source-link-changed': 'ARCHIVE_SOURCE_LINK_CHANGED', 'source-link-cycle': 'ARCHIVE_SOURCE_LINK_CYCLE', 'source-link-kind': 'ARCHIVE_SOURCE_LINK_KIND', 'source-linux-only': 'ARCHIVE_SOURCE_LINUX_ONLY', 'source-mac-birth-unavailable': 'ARCHIVE_SOURCE_MAC_BIRTH_UNAVAILABLE', 'source-mac-capability-cleanup': 'ARCHIVE_SOURCE_MAC_CAPABILITY_CLEANUP', 'source-mac-capability-deadline': 'ARCHIVE_SOURCE_MAC_CAPABILITY_DEADLINE', 'source-mac-capability-exists': 'ARCHIVE_SOURCE_MAC_CAPABILITY_EXISTS', 'source-mac-capability-identity': 'ARCHIVE_SOURCE_MAC_CAPABILITY_IDENTITY', 'source-mac-capability-link': 'ARCHIVE_SOURCE_MAC_CAPABILITY_LINK', 'source-mac-capability-link-target-changed': 'ARCHIVE_SOURCE_MAC_CAPABILITY_LINK_TARGET_CHANGED', 'source-mac-capability-mode': 'ARCHIVE_SOURCE_MAC_CAPABILITY_MODE', 'source-mac-capability-output-bound': 'ARCHIVE_SOURCE_MAC_CAPABILITY_OUTPUT_BOUND', 'source-mac-capability-report-readback': 'ARCHIVE_SOURCE_MAC_CAPABILITY_REPORT_READBACK', 'source-mac-context': 'ARCHIVE_SOURCE_MAC_CONTEXT', 'source-mac-context-path': 'ARCHIVE_SOURCE_MAC_CONTEXT_PATH', 'source-mac-directory': 'ARCHIVE_SOURCE_MAC_DIRECTORY', 'source-mac-directory-changed': 'ARCHIVE_SOURCE_MAC_DIRECTORY_CHANGED', 'source-mac-file-changed': 'ARCHIVE_SOURCE_MAC_FILE_CHANGED', 'source-mac-file-identity': 'ARCHIVE_SOURCE_MAC_FILE_IDENTITY', 'source-mac-host-scope': 'ARCHIVE_SOURCE_MAC_HOST_SCOPE', 'source-mac-identity-scope': 'ARCHIVE_SOURCE_MAC_IDENTITY_SCOPE', 'source-mac-intel-darwin-capability-unreviewed': 'ARCHIVE_SOURCE_MAC_INTEL_DARWIN_CAPABILITY_UNREVIEWED', 'source-mac-limits': 'ARCHIVE_SOURCE_MAC_LIMITS', 'source-mac-nlink': 'ARCHIVE_SOURCE_MAC_NLINK', 'source-mac-only': 'ARCHIVE_SOURCE_MAC_ONLY', 'source-mac-output': 'ARCHIVE_SOURCE_MAC_OUTPUT', 'source-mac-output-owner': 'ARCHIVE_SOURCE_MAC_OUTPUT_OWNER', 'source-mac-pins': 'ARCHIVE_SOURCE_MAC_PINS', 'source-mac-required-pin': 'ARCHIVE_SOURCE_MAC_REQUIRED_PIN', 'source-mac-root-changed': 'ARCHIVE_SOURCE_MAC_ROOT_CHANGED', 'source-mac-root-kind': 'ARCHIVE_SOURCE_MAC_ROOT_KIND', 'source-mac-roots': 'ARCHIVE_SOURCE_MAC_ROOTS', 'source-mac-write-identity': 'ARCHIVE_SOURCE_MAC_WRITE_IDENTITY', 'source-member-policy': 'ARCHIVE_SOURCE_MEMBER_POLICY', 'source-metadata-postcheck': 'ARCHIVE_SOURCE_METADATA_POSTCHECK', 'source-metadata-read-bound': 'ARCHIVE_SOURCE_METADATA_READ_BOUND', 'source-metadata-read-changed': 'ARCHIVE_SOURCE_METADATA_READ_CHANGED', 'source-mode': 'ARCHIVE_SOURCE_MODE', 'source-mtime': 'ARCHIVE_SOURCE_MTIME', 'source-mtime-readback': 'ARCHIVE_SOURCE_MTIME_READBACK', 'source-nearby-absence': 'ARCHIVE_SOURCE_NEARBY_ABSENCE', 'source-nearby-binding': 'ARCHIVE_SOURCE_NEARBY_BINDING', 'source-nearby-changed': 'ARCHIVE_SOURCE_NEARBY_CHANGED', 'source-nearby-link': 'ARCHIVE_SOURCE_NEARBY_LINK', 'source-output-root': 'ARCHIVE_SOURCE_OUTPUT_ROOT', 'source-owner': 'ARCHIVE_SOURCE_OWNER', 'source-phase': 'ARCHIVE_SOURCE_PHASE', 'source-platform-policy': 'ARCHIVE_SOURCE_PLATFORM_POLICY', 'source-registry-kind': 'ARCHIVE_SOURCE_REGISTRY_KIND', 'source-registry-label': 'ARCHIVE_SOURCE_REGISTRY_LABEL', 'source-registry-name': 'ARCHIVE_SOURCE_REGISTRY_NAME', 'source-registry-value': 'ARCHIVE_SOURCE_REGISTRY_VALUE', 'source-repositories-bound': 'ARCHIVE_SOURCE_REPOSITORIES_BOUND', 'source-repositories-changed': 'ARCHIVE_SOURCE_REPOSITORIES_CHANGED', 'source-repositories-shape': 'ARCHIVE_SOURCE_REPOSITORIES_SHAPE', 'source-repository-changed': 'ARCHIVE_SOURCE_REPOSITORY_CHANGED', 'source-repository-or-total-changed': 'ARCHIVE_SOURCE_REPOSITORY_OR_TOTAL_CHANGED', 'source-repository-root': 'ARCHIVE_SOURCE_REPOSITORY_ROOT', 'source-repository-value': 'ARCHIVE_SOURCE_REPOSITORY_VALUE', 'source-required-repositories': 'ARCHIVE_SOURCE_REQUIRED_REPOSITORIES', 'source-root': 'ARCHIVE_SOURCE_ROOT', 'source-root-changed': 'ARCHIVE_SOURCE_ROOT_CHANGED', 'source-root-readback': 'ARCHIVE_SOURCE_ROOT_READBACK', 'source-sidecar-binding': 'ARCHIVE_SOURCE_SIDECAR_BINDING', 'source-sidecar-bound': 'ARCHIVE_SOURCE_SIDECAR_BOUND', 'source-sidecar-readback': 'ARCHIVE_SOURCE_SIDECAR_READBACK', 'source-sidecar-role': 'ARCHIVE_SOURCE_SIDECAR_ROLE', 'source-sidecar-shape': 'ARCHIVE_SOURCE_SIDECAR_SHAPE', 'source-stat-reuse': 'ARCHIVE_SOURCE_STAT_REUSE', 'source-toggle-sentinel': 'ARCHIVE_SOURCE_TOGGLE_SENTINEL', 'source-tree-changed': 'ARCHIVE_SOURCE_TREE_CHANGED', 'source-unknown-git-root': 'ARCHIVE_SOURCE_UNKNOWN_GIT_ROOT', 'source-write-identity': 'ARCHIVE_SOURCE_WRITE_IDENTITY', 'special-input': 'ARCHIVE_SPECIAL_INPUT', 'unexpected-member': 'ARCHIVE_UNEXPECTED_MEMBER', 'unreviewed-generated-link': 'ARCHIVE_UNREVIEWED_GENERATED_LINK'}


class CheckpointFailure(ValueError):
    def __init__(self, code):
        self.code = code if code in SAFE_CODES or code == 'API_STATUS' else 'UNKNOWN'
        super().__init__('COMPILED_CHECKPOINT_' + self.code)


def need(ok, code):
    if not ok:
        raise CheckpointFailure(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def strict_json(raw, maximum=MAX_RECORD):
    need(type(raw) is bytes and 0 < len(raw) <= maximum, 'JSON_BOUND')
    def pairs(rows):
        value = {}
        for key, item in rows:
            need(key not in value, 'JSON_DUPLICATE')
            value[key] = item
        return value
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: need(False, 'JSON_NUMBER'))


@contextmanager
def owned(resource):
    failed, primary = False, None
    try:
        yield resource
    except BaseException as error:
        failed, primary = True, error
    finally:
        try:
            resource.close()
        except BaseException as error:
            if not failed:
                failed, primary = True, error
    if failed:
        raise primary


@contextmanager
def stage(name, relative=None, **counts):
    need(name in STAGES, 'STAGE')
    try:
        yield
    except BaseException as error:
        context = dict(stage=name, code='IO', **counts)
        if relative is not None:
            context['relativeNameSha256'] = sha(relative.encode())
            if type(relative) is str and len(relative) <= 512 and not relative.startswith(('/', '\\')) and '..' not in relative:
                context['relativeName'] = relative
        if type(error) is CheckpointFailure:
            context['code'] = error.code
            if type(vars(error).get('http_status')) is int and 100 <= error.http_status <= 599:
                context['httpStatus'] = error.http_status
        elif type(error) is ValueError and str(error) in SIDECAR_CODES:
            context['code'] = SIDECAR_CODES[str(error)]
        try:
            existing = vars(error).get('checkpoint_context')
            if type(existing) is dict and existing.get('stage') in STAGES:
                context = {**context, **existing}  # First predicate wins; add missing candidate/counts.
            object.__setattr__(error, 'checkpoint_context', context)
        except BaseException:
            pass
        raise


def failure_context(error):
    try:
        value = vars(error).get('checkpoint_context')
        if type(value) is dict and value.get('stage') in STAGES:
            labels = SAFE_CODES | frozenset(SIDECAR_CODES.values()) | frozenset(ARCHIVE_CODES.values()) | {'IO', 'UNKNOWN', 'API_STATUS'}
            copied = dict(stage=value['stage'], code=value.get('code') if value.get('code') in labels else 'UNKNOWN')
            name = value.get('relativeName')
            digest = value.get('relativeNameSha256')
            if type(digest) is str and re.fullmatch('[a-f0-9]{64}', digest):
                copied['relativeNameSha256'] = digest
                if type(name) is str and 0 < len(name) <= 512 and not name.startswith(('/', '\\')) and '..' not in name and sha(name.encode()) == digest:
                    copied['relativeName'] = name
            for key in ('files', 'bytes', 'entries', 'rawBytes', 'paths'):
                if type(value.get(key)) is int and 0 <= value[key] <= inputs.MAX_RAW:
                    copied[key] = value[key]
            if type(value.get('httpStatus')) is int and 100 <= value['httpStatus'] <= 599:
                copied['httpStatus'] = value['httpStatus']
            return copied
    except BaseException:
        pass
    return dict(stage='identity', code='UNKNOWN')


@contextmanager
def archive_stage(helper, name, **counts):
    try:
        with stage(name, **counts):
            yield
    except BaseException as error:
        if type(error) is helper.CheckpointError and str(error) in ARCHIVE_CODES:
            context = failure_context(error)
            context['code'] = ARCHIVE_CODES[str(error)]
            object.__setattr__(error, 'checkpoint_context', context)
        raise


def bootstrap_read(path, maximum, expected=None):
    """Bounded initial DATA read before the original source context is known."""
    for parent in path.parents:
        inputs._directory(parent.lstat())
    before = inputs._signature(path.lstat())
    need(before[3] <= maximum, 'BOOTSTRAP_BOUND')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        stream = os.fdopen(descriptor, 'rb', buffering=0)
    except BaseException:
        try:
            os.close(descriptor)
        except BaseException:
            pass
        raise
    with owned(stream):
        fd_before = inputs._signature(os.fstat(stream.fileno()))
        need(inputs._shared(fd_before) == inputs._shared(before), 'BOOTSTRAP_IDENTITY')
        raw = stream.read(maximum + 1)
        need(len(raw) == before[3] and inputs._signature(os.fstat(stream.fileno())) == fd_before and
             inputs._signature(path.lstat()) == before, 'BOOTSTRAP_CHANGED')
        need(expected is None or dict(bytes=len(raw), sha256=sha(raw)) == expected, 'BOOTSTRAP_PIN')
    return raw


def pin(value, maximum=MAX_RECORD, empty=False):
    need(type(value) is dict and set(value) == {'bytes', 'sha256'} and type(value['bytes']) is int and
         (0 if empty else 1) <= value['bytes'] <= maximum and type(value['sha256']) is str and
         re.fullmatch('[a-f0-9]{64}', value['sha256']), 'PIN')
    return value


def producer_digest(rows):
    need(type(rows) is list and 0 < len(rows) <= 128, 'PRODUCER_COUNT')
    seen, copied = set(), []
    for row in rows:
        need(type(row) is dict and set(row) == {'path', 'bytes', 'sha256'}, 'PRODUCER_ROW')
        name = row['path']
        need(type(name) is str and re.fullmatch('[A-Za-z0-9_./-]{1,512}', name) and
             all(p not in ('', '.', '..') for p in name.split('/')) and name.casefold() not in seen and
             name != 'native/windows-arm-full-sdk/sdk-origin-review.json', 'PRODUCER_PATH')
        seen.add(name.casefold())
        pin(dict(bytes=row['bytes'], sha256=row['sha256']))
        copied.append(dict(row))
    return sha(canonical(sorted(copied, key=lambda row: row['path'])))


def identity_header(identity):
    need(type(identity) is dict and set(identity) == {'image', 'sourceId', 'producerSha256', 'sourceDateEpoch',
                                                    'canonicalRoot', 'toolProofPin', 'graphPin'}, 'IDENTITY')
    basic = {key: identity[key] for key in ('image', 'sourceId', 'producerSha256', 'sourceDateEpoch')}
    header = inputs._identity(basic)
    need(identity['canonicalRoot'] == header['canonicalRoot'], 'CANONICAL_ROOT')
    # Both fixed reviewed Windows recipes omit SOURCE_DATE_EPOCH. Preserve the
    # actual absence; the unrelated Linux source-metadata epoch is not imported.
    need(identity['sourceDateEpoch'] == dict(present=False, value=None), 'SOURCE_EPOCH')
    pin(identity['toolProofPin'], 16 * 1024**2)
    pin(identity['graphPin'], 16 * 1024**2)
    return json.loads(json.dumps(identity)), basic, header


def guard_for(root, identity, clock, fence):
    expected, basic, header = identity_header(identity)
    need(inputs.REPO == REPO, 'MODULE_ROOT')
    return inputs._Guard(root, header, clock, fence), expected, basic


def held(guard, relative, maximum=MAX_RECORD, expected=None, retain=True):
    need(type(relative) is str and not relative.startswith(('/', '\\')) and '\\' not in relative and
         all(p not in ('', '.', '..') for p in relative.split('/')), 'RELATIVE')
    path = guard.root / relative
    for parent in (path.parent, *path.parent.parents):
        inputs._directory(parent.lstat())
        if parent == guard.root:
            break
    with inputs._file(path, guard) as stream:
        before, path_before = inputs._signature(os.fstat(stream.fileno())), inputs._signature(path.lstat())
        need(inputs._shared(before) == inputs._shared(path_before) and 0 <= before[3] <= maximum, 'FILE_BOUND')
        if expected is not None:
            pin(expected, maximum, empty=True)
        digest, total, chunks = hashlib.sha256(), 0, []
        while True:
            guard.check()
            chunk = stream.read(1024**2)
            if not chunk:
                break
            total += len(chunk)
            need(total <= maximum and total <= before[3], 'FILE_GROWTH')
            digest.update(chunk)
            if retain:
                chunks.append(chunk)
        need(total == before[3] and inputs._signature(os.fstat(stream.fileno())) == before and
             inputs._signature(path.lstat()) == path_before, 'FILE_CHANGED')
        result = dict(bytes=total, sha256=digest.hexdigest())
        need(expected is None or result == expected, 'FILE_PIN')
    return result, b''.join(chunks) if retain else None


def read(guard, relative, expected=None):
    seal, raw = held(guard, relative, expected=expected)
    return strict_json(raw), seal


def live_file(guard, path, maximum, expected):
    for parent in path.parents:
        inputs._directory(parent.lstat())
    with inputs._file(path, guard) as stream:
        before, path_before = inputs._signature(os.fstat(stream.fileno())), inputs._signature(path.lstat())
        need(inputs._shared(before) == inputs._shared(path_before) and before[3] <= maximum, 'LIVE_BOUND')
        raw = stream.read(maximum + 1)
        need(dict(bytes=len(raw), sha256=sha(raw)) == expected and
             inputs._signature(os.fstat(stream.fileno())) == before and inputs._signature(path.lstat()) == path_before, 'LIVE_PIN')
    return raw


def write(guard, relative, value):
    raw = canonical(value) + b'\n'
    need(len(raw) <= MAX_RECORD, 'RECORD_BOUND')
    with inputs._file(guard.root / relative, guard, create=True) as stream:
        need(stream.write(raw) == len(raw), 'WRITE')
    return held(guard, relative, expected=dict(bytes=len(raw), sha256=sha(raw)))[0]


def _source(guard, identity):
    source, source_pin = read(guard, 'context.json')
    need(source.get('kind') == 'windows-arm-full-sdk-context' and source.get('mode') == 'full-sdk-source-gn' and
         source.get('repository') == REPOSITORY and source.get('repositoryId') == str(REPOSITORY_ID) and
         source.get('workflow') == WORKFLOW and source.get('ref') == 'refs/heads/main' and
         source.get('event') == 'workflow_dispatch' and source.get('visibility') == 'public' and
         source.get('image') == identity['image'] and source.get('sourceId') == identity['sourceId'] and
         source.get('head') == source.get('workflowSha') and re.fullmatch('[a-f0-9]{40}', source.get('head', '')) and
         re.fullmatch('[1-9][0-9]{0,19}', source.get('runId', '')) and
         re.fullmatch('[1-9][0-9]{0,8}', source.get('attempt', '')) and
         producer_digest(source['sources']) == identity['producerSha256'], 'SOURCE_SCOPE')
    for row in source['sources']:
        index = source['sources'].index(row)
        held(guard, 'source-inputs/' + str(index), expected={k: row[k] for k in ('bytes', 'sha256')})
        live_file(guard, REPO / row['path'], MAX_RECORD, {k: row[k] for k in ('bytes', 'sha256')})
    policy_raw = live_file(guard, REPO / 'native/windows-arm-full-sdk/sdk-origin-review.json', MAX_RECORD,
                           dict(bytes=(REPO / 'native/windows-arm-full-sdk/sdk-origin-review.json').stat().st_size,
                                sha256=source['originPolicySha256']))
    policy = strict_json(policy_raw)
    need(policy.get('origin') == 'owned-windows-arm64-full-sdk' and policy.get('workflow') == WORKFLOW and
         policy.get('target') == SDK_TARGET and policy.get('producerInputs') == source['sources'], 'SOURCE_POLICY')
    live_file(guard, REPO / WORKFLOW, MAX_RECORD, pin(policy['workflowPin']))
    return source, source_pin


def _job(value, deadline=False, *, output_cap=64 * 1024**2):
    need(type(output_cap) is int and output_cap in (131072, 64 * 1024**2), 'JOB_POLICY')
    need(type(value) is dict and value.get('kind') == 'owned-job-proof' and
         all(value.get(key) is True for key in ('started', 'jobCreated', 'assignedBeforeResume', 'resumed',
             'assignedAtCreationVerified', 'handleListOnly', 'cleanupVerified', 'rootReaped', 'logReadersStopped')) and
         value.get('assignmentMode') == 'creation-attribute' and value.get('activeAtEnd') == 0 and
         type(value.get('activeAtEnd')) is int and value.get('jobHandleInheritable') is False and
         value.get('jobHandleInStdioAllowlist') is False and value.get('cleanupBudgetMs') == 30000 and
         value.get('outputCapBytes') == output_cap and type(value.get('capturedBytes')) is int and
         0 <= value['capturedBytes'] <= output_cap, 'JOB_CLOSURE')
    expected = dict(flags=0x2000 | 0x200 | 0x8, activeProcessLimit=64, jobMemoryBytes=str(8 * 1024**3),
                    cpuFlags=5, cpuRate=2500, inheritedHandles=3, affinityChanged=False)
    need(value.get('policyReadback') == expected, 'JOB_POLICY')
    need(type(value.get('rootPid')) is int and value['rootPid'] > 0 and
         re.fullmatch('[1-9][0-9]{0,19}', value.get('rootCreationFiletime', '')), 'JOB_IDENTITY')
    if deadline:
        need(value.get('success') is False and value.get('outcome') == 'deadline' and
             value.get('rootExit') is None and value.get('finalRootExit') == 124 and
             type(value.get('elapsedMs')) is int, 'RAW_DEADLINE')
    else:
        need(value.get('success') is True and value.get('outcome') == 'success' and
             type(value.get('rootExit')) is int and value['rootExit'] == 0 and
             type(value.get('finalRootExit')) is int and value['finalRootExit'] == 0, 'RAW_SUCCESS')


def validate_chain(guard, identity):
    """Validate fixed raw creation/close chain, never a caller quiet boolean."""
    source, source_pin = _source(guard, identity)
    packet, packet_pin = read(guard, 'full-sdk-engine-cef-engine-context.json')
    launch, launch_pin = read(guard, 'full-sdk-engine-cef-engine-launch.json')
    job, job_pin = read(guard, 'jobs/cef-engine/receipt.json')
    closed, closed_pin = read(guard, 'full-sdk-engine-closed-cef-engine.json')
    deadline = job.get('outcome') == 'deadline'
    _job(job, deadline)
    from full_sdk_engine import validate_packet
    validate_packet(packet, 'cef-engine', source)
    need(packet.get('role') == 'cef-engine' and packet.get('mode') == 'full-sdk-engine' and
         packet.get('sourceContextSha256') == source_pin['sha256'] and
         packet.get('image') == identity['image'] and packet.get('sourceId') == identity['sourceId'] and
         packet.get('wallWholeEnd') == source['wallWholeEnd'] and
         packet.get('monotonicWholeEnd') == source['monotonicWholeEnd'], 'ENGINE_CONTEXT')
    need(type(launch.get('ownPid')) is int and launch['ownPid'] > 0 and
         re.fullmatch('[1-9][0-9]{0,19}', launch.get('ownCreationFiletime', '')) and
         type(launch.get('parentPid')) is int and launch['parentPid'] > 0, 'LAUNCH_IDENTITY')
    need(type(packet.get('metadataFiles')) is list and len(packet['metadataFiles']) == 9 and
         len({r['relative'] for r in packet['metadataFiles']}) == 9, 'METADATA_CHAIN')
    for row in packet['metadataFiles']:
        held(guard, row['relative'], 8 * 1024**2, {k: row[k] for k in ('bytes', 'sha256')}, retain=False)
    need(launch.get('kind') == 'windows-arm-full-sdk-engine-launch' and launch.get('role') == 'cef-engine' and
         launch.get('contextSha256') == packet_pin['sha256'] and launch.get('ownPid') != job['rootPid'] and
         closed.get('kind') == 'windows-arm-full-sdk-engine-launcher-close' and closed.get('role') == 'cef-engine' and
         closed.get('ownPid') == launch['ownPid'] and closed.get('ownCreationFiletime') == launch['ownCreationFiletime'] and
         closed.get('parentPid') == launch['parentPid'] == packet['parentPid'] and
         closed.get('parentCreationFiletime') == launch['parentCreationFiletime'] == packet['parentCreationFiletime'] and
         closed.get('sourceContextSha256') == source_pin['sha256'] and
         closed.get('parentHandleClosed') is True and closed.get('ownHandleClosed') is True and
         closed.get('sdkBuilt') is False and closed.get('nativeAcceptance') is False, 'ENGINE_CLOSE')
    if deadline:
        need(closed.get('completion') == 'native-slice-ended' and closed.get('success') is True and
             closed.get('receiptPin') == job_pin and
             type(closed.get('jobSeconds')) is int and 0 < closed['jobSeconds'] <= 10800 and
             job['elapsedMs'] >= closed['jobSeconds'] * 1000 and
             not (guard.root / 'full-sdk-engine-cef-engine-result.json').exists(), 'DEADLINE_CHAIN')
    else:
        result, _ = read(guard, 'full-sdk-engine-cef-engine-result.json')
        need(closed.get('success') is True and result.get('success') is True and result.get('engineComplete') is True and
             result.get('role') == 'cef-engine' and result.get('sourceContextSha256') == source_pin['sha256'] and
             result.get('image') == identity['image'] and result.get('sourceId') == identity['sourceId'], 'ENGINE_RESULT')
    # Source completion was independently joined before compiler admission. Bind
    # its raw outer Job and launcher/close rather than trusting a summary flag.
    source_job, sj_pin = read(guard, 'jobs/full-source-operation/receipt.json')
    _job(source_job, output_cap=131072)
    launcher, sl_pin = read(guard, 'full-source-launcher-result.json')
    source_close, sc_pin = read(guard, 'full-source-closed-launcher.json')
    need(launcher.get('success') is True and launcher.get('sdkBuilt') is False and
         launcher.get('originalOperationJob') == source_job and source_close.get('success') is True and
         source_close.get('parentHandleClosed') is True and source_close.get('ownHandleClosed') is True and
         source_close.get('ownPid') == launcher.get('ownPid') and
         source_close.get('ownCreationFiletime') == launcher.get('ownCreationFiletime') and
         source_close.get('parentCreationFiletime') == packet.get('parentCreationFiletime') and
         (source_job['rootPid'], source_job['rootCreationFiletime']) != (job['rootPid'], job['rootCreationFiletime']), 'SOURCE_CHAIN')
    return source, dict(outcome='quiet-deadline' if deadline else 'engine-complete', sourceContext=source_pin,
                        engineContext=packet_pin, launch=launch_pin, job=job_pin, close=closed_pin,
                        sourceJob=sj_pin, sourceLauncher=sl_pin, sourceClose=sc_pin)


def _helper(guard):
    raw = live_file(guard, REPO / HELPER, HELPER_PIN['bytes'], HELPER_PIN)
    need(len(raw) == HELPER_PIN['bytes'] and sha(raw) == HELPER_PIN['sha256'], 'HELPER_PIN')
    source, _ = read(guard, 'context.json')
    need(any(row == dict(path=HELPER, **HELPER_PIN) for row in source['sources']), 'HELPER_PRODUCER')
    spec = importlib.util.spec_from_file_location('_fixed_windows_checkpoint_archive', REPO / HELPER)
    module = importlib.util.module_from_spec(spec)
    # Execute these exact held bytes, never re-open a possibly replaced program.
    exec(compile(raw, str(REPO / HELPER), 'exec'), module.__dict__)
    return module


def verify_graph(guard, graph, prefix=OUT):
    need(type(graph) is dict and set(graph) == {'kind', 'complete', 'files', 'bytes', 'sha256', 'pins'} and
         graph['kind'] == 'sorng-cef-fresh-graph-pins' and graph['complete'] is True and
         type(graph['files']) is int and 0 < graph['files'] <= 100000 and type(graph['pins']) is list and
         len(graph['pins']) == graph['files'], 'GRAPH_SHAPE')
    previous, total = '', 0
    for row in graph['pins']:
        need(type(row) is dict and set(row) == {'path', 'name', 'bytes', 'sha256'} and type(row['path']) is str and
             row['path'] > previous and row['name'] == row['path'].split('/')[-1] and
             (row['name'] == 'args.gn' or row['name'].endswith('.ninja')), 'GRAPH_PATH')
        expected = {key: row[key] for key in ('bytes', 'sha256')}
        pin(expected, 128 * 1024**2, empty=True)
        with stage('restore-out' if prefix != OUT else 'record-seal', row['path'], files=graph['files'], bytes=graph['bytes']):
            held(guard, prefix + '/' + row['path'], 128 * 1024**2, expected, retain=False)
        total += row['bytes']
        previous = row['path']
    need(type(graph['bytes']) is int and graph['bytes'] == total and
         sha(json.dumps(graph['pins'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == graph['sha256'], 'GRAPH_DIGEST')


def _bindings(guard, identity):
    _, raw = held(guard, GRAPH_FILE, 16 * 1024**2, identity['graphPin'])
    graph = strict_json(raw, 16 * 1024**2)
    verify_graph(guard, graph)
    _, raw = held(guard, TOOL_FILE, 16 * 1024**2, identity['toolProofPin'])
    tools = strict_json(raw, 16 * 1024**2)
    need(type(tools) is dict and tools.get('kind') == 'windows-arm-full-installed-source-inventory' and
         tools.get('executed') is False and tools.get('previous14AreCompleteClosure') is False and
         type(tools.get('files')) is list and 0 < len(tools['files']) <= 100000 and
         sha(canonical(tools['files'])) == tools.get('sha256'), 'TOOLS_PROOF')
    return graph


def _seconds(guard):
    guard.check()
    left = guard.clock.remaining()
    need(type(left) in (int, float) and math.isfinite(left), 'LEASE')
    source, _ = read(guard, 'context.json')
    seconds = math.floor(min(600, left - 150,
                            source['wallWholeEnd'] - time.time() - 150,
                            source['monotonicWholeEnd'] - time.monotonic() - 150))
    need(seconds > 0, 'ORIGINAL_RESERVE')
    return seconds


def _copy(guard, source, destination, expected, maximum):
    # Source and destination are fixed owned relative paths chosen in this file.
    seal, raw = held(guard, source, maximum, expected)
    with inputs._file(guard.root / destination, guard, create=True) as stream:
        need(stream.write(raw) == len(raw), 'COPY')
    held(guard, destination, maximum, seal, retain=False)


def seal_checkpoint(root, identity, clock, fence):
    guard, identity, basic = guard_for(root, identity, clock, fence)
    with stage('engine-chain'):
        source, chain = validate_chain(guard, identity)
        _bindings(guard, identity)
    with stage('sidecar-record'):
        sidecar = inputs.record_inputs(root, basic, clock, fence)
    helper = _helper(guard)
    with archive_stage(helper, 'pack', relative=OUT):
        archive = helper.pack(guard.root / OUT, guard.root / OUTPUT, seconds=_seconds(guard))
        guard.check()
        need(archive.get('complete') is True and archive.get('linksIncluded') is False, 'PACK_COMPLETE')
    with archive_stage(helper, 'independent-restore', entries=archive['entries'], rawBytes=archive['rawBytes']):
        restored = helper.restore(guard.root / OUTPUT, guard.root / 'full-sdk-checkpoint-roundtrip', archive,
                                  seconds=_seconds(guard))
        guard.check()
        need(restored.get('complete') is True and restored.get('entries') == archive['entries'] and
             restored.get('linksExtracted') is False, 'RESTORE_COMPLETE')
    with stage('record-seal'):
        # Exact final original creation chain and complete input namespace again.
        need(validate_chain(guard, identity)[1] == chain, 'CHAIN_CHANGED')
        inputs._verify(guard, inputs._identity(basic), sidecar['sidecar'], require_mtime=True)
        _bindings(guard, identity)
        _copy(guard, inputs.SIDECAR, OUTPUT + '/inputs.jsonl', sidecar['sidecar'], inputs.MAX_SIDECAR)
        _copy(guard, GRAPH_FILE, OUTPUT + '/graph.json', identity['graphPin'], 16 * 1024**2)
        _copy(guard, TOOL_FILE, OUTPUT + '/tools.json', identity['toolProofPin'], 16 * 1024**2)
        paths = ('context.json', 'full-sdk-engine-cef-engine-context.json', 'full-sdk-engine-cef-engine-launch.json',
                 'jobs/cef-engine/receipt.json', 'full-sdk-engine-closed-cef-engine.json',
                 'jobs/full-source-operation/receipt.json', 'full-source-launcher-result.json', 'full-source-closed-launcher.json')
        evidence = {}
        for path in paths:
            seal, raw = held(guard, path)
            evidence[path] = dict(**seal, base64=base64.b64encode(raw).decode())
        evidence_pin = write(guard, OUTPUT + '/native-chain.json', evidence)
        record = dict(schemaVersion=1, kind='windows-arm-full-sdk-compiled-checkpoint', identity=identity,
                      workflow=dict(repository=REPOSITORY, repositoryId=REPOSITORY_ID, path=WORKFLOW,
                                    ref='refs/heads/main', head=source['head'], runId=source['runId'], attempt=source['attempt']),
                      producerInputs=source['sources'], outArchive=archive, inputSidecar=sidecar['sidecar'],
                      rawChain=chain, nativeEvidence=evidence_pin, codec=HELPER_PIN, sourceQualified=False, sdkBuilt=False,
                      nativeAcceptance=False, executionAdmitted=False)
        record_pin = write(guard, OUTPUT + '/checkpoint.json', record)
        return dict(dataOnly=True, checkpoint=record_pin, record=record)


def validate_record(record, identity):
    expected, _, _ = identity_header(identity)
    fields = {'schemaVersion', 'kind', 'identity', 'workflow', 'producerInputs', 'outArchive', 'inputSidecar',
              'rawChain', 'nativeEvidence', 'codec', 'sourceQualified', 'sdkBuilt', 'nativeAcceptance', 'executionAdmitted'}
    need(type(record) is dict and set(record) == fields and type(record['schemaVersion']) is int and
         record['schemaVersion'] == 1 and record['kind'] == 'windows-arm-full-sdk-compiled-checkpoint' and
         canonical(record['identity']) == canonical(expected) and record['codec'] == HELPER_PIN and
         all(record[key] is False for key in ('sourceQualified', 'sdkBuilt', 'nativeAcceptance', 'executionAdmitted')) and
         producer_digest(record['producerInputs']) == expected['producerSha256'], 'RECORD')
    workflow = record['workflow']
    need(type(workflow) is dict and set(workflow) == {'repository', 'repositoryId', 'path', 'ref', 'head', 'runId', 'attempt'} and
         workflow['repository'] == REPOSITORY and type(workflow['repositoryId']) is int and workflow['repositoryId'] == REPOSITORY_ID and
         workflow['path'] == WORKFLOW and workflow['ref'] == 'refs/heads/main' and
         re.fullmatch('[a-f0-9]{40}', workflow['head']) and re.fullmatch('[1-9][0-9]{0,19}', workflow['runId']) and
         re.fullmatch('[1-9][0-9]{0,8}', workflow['attempt']), 'WORKFLOW')
    pin(record['inputSidecar'], inputs.MAX_SIDECAR)
    archive = record['outArchive']
    need(type(archive) is dict and set(archive) == {'complete', 'chunks', 'inventory', 'rawBytes', 'compressedBytes', 'entries', 'linksIncluded'} and
         archive['complete'] is True and archive['linksIncluded'] is False and type(archive['entries']) is int and
         0 < archive['entries'] <= 300000 and type(archive['rawBytes']) is int and 0 <= archive['rawBytes'] <= inputs.MAX_RAW and
         type(archive['chunks']) is list and 0 < len(archive['chunks']) <= 32, 'ARCHIVE')
    pin(record['nativeEvidence'])
    need(type(record['rawChain']) is dict and set(record['rawChain']) == {'outcome', 'sourceContext', 'engineContext', 'launch', 'job', 'close', 'sourceJob', 'sourceLauncher', 'sourceClose'} and
         record['rawChain']['outcome'] in ('quiet-deadline', 'engine-complete'), 'RAW_CHAIN')
    for key in set(record['rawChain']) - {'outcome'}:
        pin(record['rawChain'][key])
    assets = [dict(name='inputs.jsonl', **record['inputSidecar']), dict(name='graph.json', **expected['graphPin']),
              dict(name='tools.json', **expected['toolProofPin']), dict(name='native-chain.json', **record['nativeEvidence'])]
    for index, chunk in enumerate(archive['chunks']):
        need(type(chunk) is dict and set(chunk) == {'name', 'bytes', 'sha256'} and chunk['name'] == 'checkpoint-%05d.bin' % index, 'CHUNK_NAME')
        pin({key: chunk[key] for key in ('bytes', 'sha256')}, MAX_CHUNK)
        assets.append(dict(chunk))
    inventory = archive['inventory']
    need(type(inventory) is dict and set(inventory) == {'name', 'bytes', 'sha256'} and inventory['name'] == 'inventory.json', 'INVENTORY')
    pin({key: inventory[key] for key in ('bytes', 'sha256')}, 128 * 1024**2)
    need(type(archive['compressedBytes']) is int and archive['compressedBytes'] == sum(row['bytes'] for row in archive['chunks']) <= 32 * 1024**3,
         'COMPRESSED_BOUND')
    assets.append(dict(inventory))
    return assets


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Github:
    """Fixed repo HTTPS only. Credentials never follow an asset redirect."""
    def __init__(self, token, clock):
        need(type(token) is str and 0 < len(token) <= 1024 and '\n' not in token and '\r' not in token, 'TOKEN')
        self.token, self.clock = token, clock
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    @staticmethod
    def phase(route, method='GET', asset=False):
        return ('asset-download' if asset else 'asset-upload' if method == 'POST' and '/assets?' in route else
                'api-tree' if '/git/' in route else 'api-run' if '/actions/runs/' in route else
                'release' if '/releases' in route else 'api-scope')

    def response(self, method, route, data=None, asset=False, maximum=MAX_RECORD):
        with stage(self.phase(route, method, asset)):
            return self._response(method, route, data, asset, maximum)

    def _response(self, method, route, data=None, asset=False, maximum=MAX_RECORD):
        need((route == '/repos/' + REPOSITORY or route.startswith('/repos/' + REPOSITORY + '/')) and
             not any(c in route for c in ('\r', '\n', '#')), 'API_ROUTE')
        tail = route.removeprefix('/repos/' + REPOSITORY)
        get_routes = (r'', r'/actions/runs/[1-9][0-9]{0,19}', r'/actions/runs/[1-9][0-9]{0,19}/attempts/[1-9][0-9]{0,8}',
                      r'/actions/runs/[1-9][0-9]{0,19}/artifacts\?per_page=100', r'/actions/artifacts/[1-9][0-9]{0,19}/zip',
                      r'/actions/workflows/windows-arm-full-sdk\.yml', r'/git/commits/[a-f0-9]{40}',
                      r'/git/trees/[a-f0-9]{40}\?recursive=1', r'/git/blobs/[a-f0-9]{40}',
                      r'/releases\?per_page=100', r'/releases/[1-9][0-9]{0,19}', r'/releases/[1-9][0-9]{0,19}/assets\?per_page=100',
                      r'/releases/assets/[1-9][0-9]{0,19}')
        post_routes = (r'/releases', r'/releases/[1-9][0-9]{0,19}/assets\?name=(?:checkpoint\.json|inventory\.json|inputs\.jsonl|graph\.json|tools\.json|native-chain\.json|checkpoint-[0-9]{5}\.bin|runtime\.json|source-lock\.json|manifest\.json|receipt\.json|sorng-cef-custom-[a-f0-9]{64}-aarch64-pc-windows-msvc\.tar\.bz2)')
        need(method in ('GET', 'POST') and any(re.fullmatch(pattern, tail) for pattern in (get_routes if method == 'GET' else post_routes)), 'API_CLOSED_ROUTE')
        origin = UPLOADS if method == 'POST' and '/assets?name=' in route else API
        url, authenticated = origin + route, True
        for redirects in range(3):
            left = self.clock.remaining()
            need(type(left) in (int, float) and math.isfinite(left) and left > 0, 'TRANSPORT_DEADLINE')
            headers = {'Accept': 'application/octet-stream' if asset and '/releases/assets/' in route else 'application/vnd.github+json', 'Accept-Encoding': 'identity',
                       'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sorng-windows-compiled-checkpoint'}
            if authenticated:
                headers['Authorization'] = 'Bearer ' + self.token
            if data is not None:
                headers['Content-Type'] = 'application/octet-stream' if '/assets?name=' in route else 'application/json'
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                response = self.opener.open(request, timeout=min(600 if asset or origin == UPLOADS else 60, left))
            except urllib.error.HTTPError as error:
                if asset and error.code in (301, 302, 303, 307, 308):
                    target = error.headers.get('Location', '')
                    error.close()
                    parsed = urllib.parse.urlsplit(target)
                    azure = re.fullmatch(r'productionresultssa(0|[1-9][0-9]*)\.blob\.core\.windows\.net', parsed.hostname or '')
                    # Same reviewed closed accounts as the unchanged helper's downloadHost.
                    known_azure = azure is not None and int(azure[1]) in {*range(20), *range(30, 50), *range(100, 200)}
                    need(parsed.scheme == 'https' and (parsed.hostname in ('release-assets.githubusercontent.com', 'objects.githubusercontent.com') or known_azure) and
                         parsed.port is None and parsed.username is None and parsed.password is None and not parsed.fragment and redirects < 2,
                         'ASSET_REDIRECT')
                    url, authenticated = target, False
                    continue
                status = error.code
                error.close()
                failure = CheckpointFailure('API_STATUS')
                failure.http_status = status
                raise failure from None
            break
        try:
            need(response.status in (200, 201), 'HTTP_STATUS')
            need(len(response.headers) <= 64 and sum(len(k) + len(v) for k, v in response.headers.items()) <= 65536, 'HTTP_HEADERS')
            length = response.headers.get('Content-Length')
            need(len(response.headers.get_all('Content-Length', [])) <= 1 and
                 (length is None or re.fullmatch('0|[1-9][0-9]{0,12}', length) and int(length) <= maximum), 'HTTP_LENGTH')
            transfer = response.headers.get('Transfer-Encoding')
            need(transfer in (None, 'chunked') and not (transfer is not None and length is not None), 'HTTP_HEADERS')
            encoding = response.headers.get('Content-Encoding')
            need(encoding in (None, 'identity'), 'HTTP_ENCODING')
        except BaseException:
            try:
                response.close()
            except BaseException:
                pass
            raise
        return response, int(length) if length is not None else None

    def get(self, route, maximum=MAX_RECORD):
        with stage(self.phase(route)):
            return self._get(route, maximum)

    def _get(self, route, maximum=MAX_RECORD):
        response, length = self.response('GET', route, maximum=maximum)
        with owned(response):
            raw = response.read(maximum + 1)
            need(length is None or len(raw) == length, 'HTTP_BODY')
            self.clock.remaining()
        return strict_json(raw, maximum)

    def post(self, route, value):
        with stage(self.phase(route, 'POST')):
            return self._post(route, value)

    def _post(self, route, value):
        response, length = self.response('POST', route, canonical(value))
        with owned(response):
            raw = response.read(MAX_RECORD + 1)
            need(length is None or len(raw) == length, 'HTTP_BODY')
        return strict_json(raw)


def _run(client, run_id, attempt, terminal=True):
    need(re.fullmatch('[1-9][0-9]{0,19}', run_id) and re.fullmatch('[1-9][0-9]{0,8}', attempt), 'RUN_ID')
    run = client.get('/repos/' + REPOSITORY + '/actions/runs/' + run_id + '/attempts/' + attempt)
    workflow = client.get('/repos/' + REPOSITORY + '/actions/workflows/windows-arm-full-sdk.yml')
    actual_repository = client.get('/repos/' + REPOSITORY)
    repository = run.get('repository', {})
    need(type(run.get('id')) is int and str(run['id']) == run_id and str(run.get('run_attempt')) == attempt and
         repository.get('id') == REPOSITORY_ID and repository.get('full_name') == REPOSITORY and repository.get('private') is False and
         actual_repository.get('id') == REPOSITORY_ID and actual_repository.get('full_name') == REPOSITORY and
         actual_repository.get('private') is False and actual_repository.get('default_branch') == 'main' and
         run.get('path') == WORKFLOW and run.get('head_branch') == 'main' and run.get('event') == 'workflow_dispatch' and
         run.get('workflow_id') == workflow.get('id') and workflow.get('path') == WORKFLOW and
         re.fullmatch('[a-f0-9]{40}', run.get('head_sha', '')) and
         (run.get('status') == 'completed' and run.get('conclusion') == 'success' if terminal else run.get('status') == 'in_progress'), 'RUN_SCOPE')
    return run


def _tree(client, head, rows, workflow_pin):
    # A recursive truncation never proves the requested complete binding.
    commit = client.get('/repos/' + REPOSITORY + '/git/commits/' + head)
    need(commit.get('sha') == head and re.fullmatch('[a-f0-9]{40}', commit.get('tree', {}).get('sha', '')), 'COMMIT')
    tree = client.get('/repos/' + REPOSITORY + '/git/trees/' + commit['tree']['sha'] + '?recursive=1', maximum=32 * 1024**2)
    need(tree.get('truncated') is False and type(tree.get('tree')) is list and len(tree['tree']) <= 100000, 'TREE_BOUND')
    by_name = {}
    for row in tree['tree']:
        name = row.get('path')
        need(type(name) is str and name not in by_name, 'TREE_DUPLICATE')
        by_name[name] = row
    for expected in [*rows, dict(path=WORKFLOW, **workflow_pin)]:
        name = expected['path']
        with stage('api-tree', name, paths=len(rows)):
            actual = by_name.get(name, {})
            need(actual.get('type') == 'blob' and actual.get('mode') in ('100644', '100755') and
                 actual.get('size') == expected['bytes'] and re.fullmatch('[a-f0-9]{40}', actual.get('sha', '')), 'TREE_PATH')
            blob = client.get('/repos/' + REPOSITORY + '/git/blobs/' + actual['sha'])
            need(blob.get('sha') == actual['sha'] and blob.get('encoding') == 'base64' and blob.get('size') == expected['bytes'], 'BLOB')
            raw = base64.b64decode(blob['content'].replace('\n', ''), validate=True)
            need(len(raw) == expected['bytes'] and sha(raw) == expected['sha256'] and
                 hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest() == actual['sha'], 'BLOB_PIN')


def tag(record, record_pin):
    workflow = record['workflow']
    return 'windows-arm-checkpoint-' + workflow['runId'] + '-' + workflow['attempt'] + '-' + record['identity']['sourceId'][:12] + '-' + record_pin['sha256'][:16]


def _transport_scope(client):
    need(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY and os.environ.get('GITHUB_REPOSITORY_ID') == str(REPOSITORY_ID) and
         os.environ.get('GITHUB_REF') == 'refs/heads/main' and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and
         os.environ.get('GITHUB_SHA') == os.environ.get('GITHUB_WORKFLOW_SHA'), 'CURRENT_SCOPE')
    current = _run(client, os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', ''), terminal=False)
    need(current['head_sha'] == os.environ['GITHUB_SHA'], 'CURRENT_HEAD')
    policy_raw = bootstrap_read(REPO / 'native/windows-arm-full-sdk/sdk-origin-review.json', MAX_RECORD)
    policy = strict_json(policy_raw)
    need(policy.get('origin') == 'owned-windows-arm64-full-sdk' and policy.get('workflow') == WORKFLOW and
         policy.get('target') == 'aarch64-pc-windows-msvc', 'POLICY')
    producer_digest(policy['producerInputs'])
    pin(policy['workflowPin'])
    _tree(client, current['head_sha'], [*policy['producerInputs'],
          dict(path='native/windows-arm-full-sdk/sdk-origin-review.json', bytes=len(policy_raw), sha256=sha(policy_raw))], policy['workflowPin'])
    return current, policy


def _release_assets(client, release, expected_names=None):
    release_id = release.get('id')
    need(type(release_id) is int and release_id > 0, 'RELEASE_ID')
    rows = client.get('/repos/' + REPOSITORY + '/releases/' + str(release_id) + '/assets?per_page=100')
    need(type(rows) is list and 0 < len(rows) <= 38, 'ASSET_COUNT')
    assets = {}
    for row in rows:
        name = row.get('name')
        allowed = (name in expected_names if expected_names is not None else
                   type(name) is str and re.fullmatch('checkpoint\\.json|inventory\\.json|inputs\\.jsonl|graph\\.json|tools\\.json|native-chain\\.json|checkpoint-[0-9]{5}\\.bin', name))
        need(type(name) is str and name not in assets and allowed and
             row.get('state') == 'uploaded' and type(row.get('id')) is int and row['id'] > 0 and type(row.get('size')) is int, 'ASSET_ROW')
        assets[name] = row
    return assets


def _sdk_phases(guard, source, source_pin):
    from full_sdk_engine import validate_packet
    evidence, previous = {}, None
    for role in ('probe-clang', 'probe-link', 'cef-engine', 'package'):
        names = {'packet': f'full-sdk-engine-{role}-context.json', 'launch': f'full-sdk-engine-{role}-launch.json',
                 'job': f'jobs/{role}/receipt.json', 'close': f'full-sdk-engine-closed-{role}.json',
                 'result': f'full-sdk-engine-{role}-result.json'}
        values, pins = {}, {}
        for key, relative in names.items():
            seal, raw = held(guard, relative)
            values[key], pins[key] = strict_json(raw), seal
            evidence[relative] = dict(**seal, base64=base64.b64encode(raw).decode())
        packet, launch, raw_job, closed, result = (values[k] for k in ('packet', 'launch', 'job', 'close', 'result'))
        validate_packet(packet, role, source)
        _job(raw_job)
        need(packet['sourceContextSha256'] == source_pin['sha256'] and
             packet['prior'] == (None if previous is None else dict(result=previous['result'], receipt=previous['job'])) and
             launch.get('kind') == 'windows-arm-full-sdk-engine-launch' and launch.get('role') == role and
             launch.get('contextSha256') == pins['packet']['sha256'] and type(launch.get('ownPid')) is int and
             launch['ownPid'] > 0 and launch['ownPid'] != raw_job['rootPid'] and
             closed.get('kind') == 'windows-arm-full-sdk-engine-launcher-close' and closed.get('role') == role and
             closed.get('success') is True and closed.get('parentHandleClosed') is True and closed.get('ownHandleClosed') is True and
             closed.get('ownPid') == launch['ownPid'] and closed.get('ownCreationFiletime') == launch['ownCreationFiletime'] and
             closed.get('parentPid') == launch.get('parentPid') == packet['parentPid'] and
             closed.get('parentCreationFiletime') == launch.get('parentCreationFiletime') == packet['parentCreationFiletime'] and
             closed.get('sourceContextSha256') == source_pin['sha256'] and closed.get('sdkBuilt') is False and
             closed.get('nativeAcceptance') is False, 'SDK_PHASE_CLOSE')
        need(result.get('kind') == 'windows-arm-full-sdk-engine-worker-result' and result.get('role') == role and
             result.get('success') is True and result.get('sourceContextSha256') == source_pin['sha256'] and
             result.get('image') == source['image'] and result.get('sourceId') == source['sourceId'] and
             result.get('engineComplete') is (role == 'cef-engine') and result.get('sdkBuilt') is (role == 'package') and
             result.get('nativeAcceptance') is False and result.get('runtimeReady') is False, 'SDK_PHASE_RESULT')
        for row in packet['metadataFiles']:
            held(guard, row['relative'], 8 * 1024**2, {k: row[k] for k in ('bytes', 'sha256')}, retain=False)
        if role in ('probe-clang', 'probe-link'):
            held(guard, 'full-sdk-engine-probe/probe.' + ('obj' if role == 'probe-clang' else 'exe'), 8 * 1024**2, result['output'], retain=False)
        previous = pins
    return evidence, values['result']


def sdk_quarantine(client, root, report, clock, fence, current, policy):
    """Five actual SDK assets in a reversible draft. No legacy-origin grant."""
    source_raw = bootstrap_read(root / 'context.json', 131072)
    source = strict_json(source_raw, 131072)
    tools = bootstrap_read(root / TOOL_FILE, 16 * 1024**2)
    graph = bootstrap_read(root / GRAPH_FILE, 16 * 1024**2)
    identity = dict(image=source['image'], sourceId=source['sourceId'], producerSha256=producer_digest(source['sources']),
                    sourceDateEpoch=dict(present=False, value=None), canonicalRoot=root.name,
                    toolProofPin=dict(bytes=len(tools), sha256=sha(tools)), graphPin=dict(bytes=len(graph), sha256=sha(graph)))
    guard, identity, _ = guard_for(root, identity, clock, fence)
    source, source_pin = _source(guard, identity)
    need(source['head'] == current['head_sha'] and source['runId'] == str(current['id']) and source['attempt'] == str(current['run_attempt']) and
         identity['producerSha256'] == producer_digest(policy['producerInputs']), 'SDK_CURRENT_BINDING')
    fields = {'kind', 'sourceId', 'image', 'target', 'sdkBuilt', 'nativeAcceptance', 'runtimeReady', 'publicationAllowed', 'bundle', 'assets'}
    need(type(report) is dict and set(report) == fields and report['kind'] == 'windows-arm-full-sdk-produced' and
         report['sourceId'] == source['sourceId'] and report['image'] == source['image'] and report['target'] == SDK_TARGET and
         report['sdkBuilt'] is True and report['nativeAcceptance'] is False and report['runtimeReady'] is False and
         report['publicationAllowed'] is False and report['bundle'] == SDK_BUNDLE, 'SDK_CONTROLLER_REPORT')
    _bindings(guard, identity)
    # The CEF/source chain independently rejects a deadline on the SDK path.
    _, cef_chain = validate_chain(guard, identity)
    need(cef_chain['outcome'] == 'engine-complete', 'SDK_CEF_FULFILLED')
    phase_evidence, package = _sdk_phases(guard, source, source_pin)
    archive = 'sorng-cef-custom-' + source['sourceId'] + '-' + SDK_TARGET + '.tar.bz2'
    names = {'runtime.json', 'source-lock.json', 'manifest.json', 'receipt.json', archive}
    need(type(report['assets']) is list and len(report['assets']) == 5 and {row['name'] for row in report['assets']} == names and
         type(package.get('output')) is dict and package['output'].get('bundle') == SDK_BUNDLE and
         type(package['output'].get('assets')) is list and len(package['output']['assets']) == 5 and
         {row['name'] for row in package['output']['assets']} == names, 'SDK_ASSET_SET')
    assets = []
    for row in report['assets']:
        need(type(row) is dict and set(row) == {'name', 'size', 'sha256', 'identity'} and type(row['identity']) is str, 'SDK_ASSET_ROW')
        seal = pin(dict(bytes=row['size'], sha256=row['sha256']), SDK_MAX_ASSET if row['name'] == archive else 32 * 1024**2)
        declared = next(item for item in package['output']['assets'] if item['name'] == row['name'])
        need(declared == {key: row[key] for key in ('name', 'size', 'sha256')}, 'SDK_PACKAGE_PIN')
        with stage('asset-upload', row['name'], bytes=seal['bytes']):
            held(guard, SDK_BUNDLE + '/' + row['name'], SDK_MAX_ASSET, seal, retain=False)
        assets.append(dict(name=row['name'], **seal))
    json_values = {}
    for name in names - {archive}:
        _, raw = held(guard, SDK_BUNDLE + '/' + name, 32 * 1024**2)
        json_values[name] = strict_json(raw, 32 * 1024**2)
    need(sha(json.dumps(json_values['source-lock.json'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == source['sourceId'], 'SDK_SOURCE_LOCK')
    descriptor, manifest, receipt = (json_values[name] for name in ('runtime.json', 'manifest.json', 'receipt.json'))
    need(descriptor.get('kind') == 'sorng-cef-runtime-release' and descriptor.get('target') == SDK_TARGET and
         manifest.get('kind') == 'sorng-cef-custom-runtime' and manifest.get('sourceLockSha256') == source['sourceId'] and
         type(manifest.get('artifacts')) is list and len(manifest['artifacts']) == 1 and manifest['artifacts'][0].get('target') == SDK_TARGET and
         receipt.get('kind') == 'sorng-cef-custom-build-receipt' and receipt.get('target') == SDK_TARGET and
         receipt.get('sourceLockSha256') == source['sourceId'], 'SDK_METADATA_BINDING')
    by_name = {row['name']: row for row in assets}
    for field, name in (('sourceLock', 'source-lock.json'), ('manifest', 'manifest.json'), ('receipt', 'receipt.json'), ('archive', archive)):
        item = descriptor.get(field, {})
        expected = by_name[name]
        need(item.get('path') == name and item.get('size') == expected['bytes'] and item.get('sha256') == expected['sha256'], 'SDK_DESCRIPTOR_PIN')
    need(receipt.get('archiveSha256') == by_name[archive]['sha256'] and
         manifest['artifacts'][0].get('archive', {}).get('sha256') == by_name[archive]['sha256'], 'SDK_ARCHIVE_BINDING')
    report_pin, report_raw = held(guard, 'full-sdk-controller-result.json')
    need(strict_json(report_raw) == report, 'SDK_REPORT_CHANGED')
    release_tag = 'windows-arm-full-sdk-quarantine-' + source['runId'] + '-' + source['attempt'] + '-' + source['sourceId'][:12] + '-' + report_pin['sha256'][:16]
    release = client.post('/repos/' + REPOSITORY + '/releases', dict(tag_name=release_tag, name=release_tag,
                         target_commitish=current['head_sha'], draft=True, prerelease=True))
    need(type(release.get('id')) is int and release['id'] > 0 and release.get('draft') is True and release.get('prerelease') is True and
         release.get('tag_name') == release_tag and release.get('target_commitish') == current['head_sha'], 'SDK_QUARANTINE_RELEASE')
    for row in assets:
        with stage('asset-upload', row['name'], bytes=row['bytes']):
            _, raw = held(guard, SDK_BUNDLE + '/' + row['name'], SDK_MAX_ASSET, {key: row[key] for key in ('bytes', 'sha256')})
            response, length = client.response('POST', '/repos/' + REPOSITORY + '/releases/' + str(release['id']) + '/assets?name=' + urllib.parse.quote(row['name']), raw)
            with owned(response):
                body = response.read(MAX_RECORD + 1)
                need(length is None or len(body) == length, 'UPLOAD_BODY')
                actual = strict_json(body)
            need(actual.get('name') == row['name'] and actual.get('size') == row['bytes'] and
                 actual.get('digest') == 'sha256:' + row['sha256'] and actual.get('state') == 'uploaded', 'SDK_UPLOADED_PIN')
    uploaded = _release_assets(client, release, names)
    need(set(uploaded) == names and all(uploaded[row['name']]['size'] == row['bytes'] and
         uploaded[row['name']].get('digest') == 'sha256:' + row['sha256'] for row in assets), 'SDK_UPLOADED_SET')
    # Rehold all actual source/phase/bundle facts before writing the immutable
    # Actions handoff. It is a new truthful SDK DATA origin, never old import.
    _source(guard, identity)
    _bindings(guard, identity)
    final_phases, _ = _sdk_phases(guard, source, source_pin)
    need(final_phases == phase_evidence, 'SDK_PHASE_CHANGED')
    for row in assets:
        held(guard, SDK_BUNDLE + '/' + row['name'], SDK_MAX_ASSET, {key: row[key] for key in ('bytes', 'sha256')}, retain=False)
    source_native = {}
    for relative in ('context.json', 'full-sdk-engine-cef-engine-context.json', 'full-sdk-engine-cef-engine-launch.json',
                     'jobs/cef-engine/receipt.json', 'full-sdk-engine-closed-cef-engine.json',
                     'jobs/full-source-operation/receipt.json', 'full-source-launcher-result.json', 'full-source-closed-launcher.json'):
        seal, raw = held(guard, relative)
        source_native[relative] = dict(**seal, base64=base64.b64encode(raw).decode())
    raw_seal = dict(schemaVersion=1, kind='windows-arm-full-sdk-quarantine-seal', origin='owned-windows-arm64-full-sdk',
                    target=SDK_TARGET, identity=identity, workflow=dict(repository=REPOSITORY, repositoryId=REPOSITORY_ID,
                    path=WORKFLOW, ref='refs/heads/main', head=source['head'], runId=source['runId'], attempt=source['attempt']),
                    release=dict(id=release['id'], tag=release_tag, head=source['head']),
                    assets=[dict(id=uploaded[row['name']]['id'], **row) for row in assets],
                    controller=dict(**report_pin, base64=base64.b64encode(report_raw).decode()), nativePhases=phase_evidence,
                    sourceChain=cef_chain, sourceNative=source_native, sdkBuilt=True, nativeAcceptance=False, runtimeReady=False, publicationAllowed=False)
    seal_pin = write(guard, 'full-sdk-sdk-seal.json', raw_seal)
    return dict(dataOnly=True, uploaded=True, kind='sdk', quarantine=True, tag=release_tag, sealFile='full-sdk-sdk-seal.json',
                seal=seal_pin, artifactName=seal_name(source['runId'], source['attempt'], sdk=True),
                nativeAcceptance=False, runtimeReady=False, publicationAllowed=False, usableOnlyAfterWorkflowSuccess=True)


def validate_evidence(record, evidence):
    mapping = {'sourceContext': 'context.json', 'engineContext': 'full-sdk-engine-cef-engine-context.json',
               'launch': 'full-sdk-engine-cef-engine-launch.json', 'job': 'jobs/cef-engine/receipt.json',
               'close': 'full-sdk-engine-closed-cef-engine.json', 'sourceJob': 'jobs/full-source-operation/receipt.json',
               'sourceLauncher': 'full-source-launcher-result.json', 'sourceClose': 'full-source-closed-launcher.json'}
    need(type(evidence) is dict and set(evidence) == set(mapping.values()), 'EVIDENCE_SET')
    parsed = {}
    for key, name in mapping.items():
        row = evidence[name]
        need(type(row) is dict and set(row) == {'bytes', 'sha256', 'base64'} and type(row['base64']) is str and
             len(row['base64']) <= 4 * MAX_RECORD // 3 + 4, 'EVIDENCE_ROW')
        raw = base64.b64decode(row['base64'], validate=True)
        need(dict(bytes=len(raw), sha256=sha(raw)) == record['rawChain'][key] == {k: row[k] for k in ('bytes', 'sha256')}, 'EVIDENCE_PIN')
        parsed[key] = strict_json(raw)
    source, packet, launch, job, closed = (parsed[k] for k in ('sourceContext', 'engineContext', 'launch', 'job', 'close'))
    from full_sdk_engine import validate_packet
    validate_packet(packet, 'cef-engine', source)
    deadline = record['rawChain']['outcome'] == 'quiet-deadline'
    _job(job, deadline)
    _job(parsed['sourceJob'], output_cap=131072)
    need(source.get('head') == record['workflow']['head'] and source.get('runId') == record['workflow']['runId'] and
         source.get('attempt') == record['workflow']['attempt'] and source.get('workflow') == WORKFLOW and
         source.get('ref') == 'refs/heads/main' and source.get('image') == record['identity']['image'] and
         source.get('sourceId') == record['identity']['sourceId'] and source.get('sources') == record['producerInputs'] and
         packet.get('sourceContextSha256') == record['rawChain']['sourceContext']['sha256'] and
         launch.get('contextSha256') == record['rawChain']['engineContext']['sha256'] and
         launch.get('ownPid') != job['rootPid'] and closed.get('ownPid') == launch.get('ownPid') and
         closed.get('ownCreationFiletime') == launch.get('ownCreationFiletime') and
         closed.get('parentPid') == launch.get('parentPid') == packet.get('parentPid') and
         closed.get('parentCreationFiletime') == launch.get('parentCreationFiletime') == packet.get('parentCreationFiletime') and
         closed.get('sourceContextSha256') == packet.get('sourceContextSha256') and
         closed.get('parentHandleClosed') is True and closed.get('ownHandleClosed') is True, 'EVIDENCE_BINDING')
    if deadline:
        need(closed.get('completion') == 'native-slice-ended' and closed.get('success') is True and
             closed.get('receiptPin') == record['rawChain']['job'] and type(closed.get('jobSeconds')) is int and
             0 < closed['jobSeconds'] <= 10800 and job['elapsedMs'] >= closed['jobSeconds'] * 1000, 'EVIDENCE_DEADLINE')
    else:
        need(closed.get('success') is True, 'EVIDENCE_FULFILLED')
    launcher, source_close = parsed['sourceLauncher'], parsed['sourceClose']
    need(launcher.get('success') is True and launcher.get('originalOperationJob') == parsed['sourceJob'] and
         source_close.get('success') is True and source_close.get('ownPid') == launcher.get('ownPid') and
         source_close.get('ownCreationFiletime') == launcher.get('ownCreationFiletime') and
         source_close.get('parentHandleClosed') is True and source_close.get('ownHandleClosed') is True and
         source_close.get('parentCreationFiletime') == packet.get('parentCreationFiletime') and
         (parsed['sourceJob']['rootPid'], parsed['sourceJob']['rootCreationFiletime']) != (job['rootPid'], job['rootCreationFiletime']), 'EVIDENCE_SOURCE_CLOSE')
    return parsed


def _download_asset(client, asset, path, expected, maximum):
    pin(expected, maximum)
    need(asset['size'] == expected['bytes'], 'ASSET_SIZE')
    response, length = client.response('GET', '/repos/' + REPOSITORY + '/releases/assets/' + str(asset['id']), asset=True, maximum=maximum)
    digest, total = hashlib.sha256(), 0
    with owned(response), owned(path.open('xb')) as stream:
        need(length is None or length == expected['bytes'], 'ASSET_LENGTH')
        while True:
            client.clock.remaining()
            chunk = response.read(min(1024**2, expected['bytes'] + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            need(total <= expected['bytes'], 'ASSET_GROWTH')
            need(stream.write(chunk) == len(chunk), 'ASSET_WRITE')
            digest.update(chunk)
        need(total == expected['bytes'] and digest.hexdigest() == expected['sha256'], 'ASSET_HASH')


def seal_name(run_id, attempt, sdk=False):
    need(re.fullmatch('[1-9][0-9]{0,19}', run_id) and re.fullmatch('[1-9][0-9]{0,8}', attempt), 'RUN_ID')
    return 'windows-arm-full-sdk-' + ('' if sdk else 'checkpoint-') + 'seal-' + run_id + '-' + attempt


def unpack_raw_seal(raw, member):
    """Exact one regular member, bounded memory; never filesystem extraction."""
    need(type(raw) is bytes and 0 < len(raw) <= SEAL_ZIP_MAX, 'SEAL_ZIP_BOUND')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        rows = archive.infolist()
        need(len(rows) == 1 and not archive.comment, 'SEAL_ZIP_MEMBERS')
        row = rows[0]
        mode = row.external_attr >> 16
        need(row.filename == member and not row.is_dir() and not row.flag_bits & 1 and
             row.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
             stat.S_IFMT(mode) in (0, stat.S_IFREG) and not (row.external_attr & 0x10) and
             0 < row.file_size <= MAX_RECORD and 0 < row.compress_size <= SEAL_ZIP_MAX, 'SEAL_ZIP_MEMBER')
        with archive.open(row) as stream:
            decoded = stream.read(MAX_RECORD + 1)
            need(len(decoded) == row.file_size and stream.read(1) == b'', 'SEAL_ZIP_SIZE')
    return strict_json(decoded)


def authenticated_seal(client, prior, run_id, attempt, destination):
    listing = client.get('/repos/' + REPOSITORY + '/actions/runs/' + run_id + '/artifacts?per_page=100')
    need(type(listing) is dict and type(listing.get('total_count')) is int and 0 < listing['total_count'] <= 100 and
         type(listing.get('artifacts')) is list and len(listing['artifacts']) == listing['total_count'], 'SEAL_ARTIFACT_COUNT')
    matches = [row for row in listing['artifacts'] if row.get('name') == seal_name(run_id, attempt)]
    need(len(matches) == 1, 'SEAL_ARTIFACT_MATCH')
    artifact = matches[0]
    workflow = artifact.get('workflow_run', {})
    need(type(artifact.get('id')) is int and artifact['id'] > 0 and artifact.get('expired') is False and
         type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= SEAL_ZIP_MAX and
         re.fullmatch('sha256:[a-f0-9]{64}', artifact.get('digest', '')) and workflow.get('id') == int(run_id) and
         workflow.get('repository_id') == REPOSITORY_ID and workflow.get('head_repository_id') == REPOSITORY_ID and
         workflow.get('head_branch') == 'main' and workflow.get('head_sha') == prior['head_sha'], 'SEAL_ARTIFACT_SCOPE')
    expected = dict(bytes=artifact['size_in_bytes'], sha256=artifact['digest'][7:])
    response, length = client.response('GET', '/repos/' + REPOSITORY + '/actions/artifacts/' + str(artifact['id']) + '/zip',
                                       asset=True, maximum=SEAL_ZIP_MAX)
    with owned(response):
        need(length is None or length == expected['bytes'], 'SEAL_ARTIFACT_SIZE')
        raw = response.read(SEAL_ZIP_MAX + 1)
        need(dict(bytes=len(raw), sha256=sha(raw)) == expected, 'SEAL_ARTIFACT_HASH')
        client.clock.remaining()
    seal = unpack_raw_seal(raw, 'checkpoint-seal.json')
    fields = {'schemaVersion', 'kind', 'workflow', 'identity', 'release', 'record', 'assets', 'nativeEvidence', 'sourceContext'}
    need(type(seal) is dict and set(seal) == fields and type(seal['schemaVersion']) is int and seal['schemaVersion'] == 1 and
         seal['kind'] == 'windows-arm-full-sdk-immutable-checkpoint-seal' and
         seal['workflow']['runId'] == run_id and seal['workflow']['attempt'] == attempt and seal['workflow']['head'] == prior['head_sha'] and
         seal['workflow']['path'] == WORKFLOW and seal['workflow']['repositoryId'] == REPOSITORY_ID, 'SEAL_SCOPE')
    pin(seal['record'])
    pin(seal['nativeEvidence'])
    pin(seal['sourceContext'])
    need(type(seal['release']) is dict and set(seal['release']) == {'id', 'tag', 'head'} and
         type(seal['release']['id']) is int and seal['release']['id'] > 0 and seal['release']['head'] == prior['head_sha'] and
         type(seal['assets']) is list and 1 <= len(seal['assets']) <= 38, 'SEAL_RELEASE')
    names = set()
    for row in seal['assets']:
        need(type(row) is dict and set(row) == {'id', 'name', 'bytes', 'sha256'} and
             type(row['id']) is int and row['id'] > 0 and type(row['name']) is str and row['name'] not in names,
             'SEAL_ASSET')
        pin({key: row[key] for key in ('bytes', 'sha256')}, inputs.MAX_SIDECAR)
        names.add(row['name'])
    with owned((destination / 'authenticated-seal.json').open('xb')) as stream:
        encoded = canonical(seal) + b'\n'
        need(stream.write(encoded) == len(encoded), 'SEAL_WRITE')
    return seal, dict(id=artifact['id'], **expected)


def transport_download(client, prior_run, prior_attempt, image):
    with stage('api-scope'):
        current, policy = _transport_scope(client)
    with stage('api-run'):
        prior = _run(client, prior_run, prior_attempt)
        need(inputs.SOURCES.get(image) is not None, 'IMAGE')
        _tree(client, prior['head_sha'], policy['producerInputs'], policy['workflowPin'])
    temp = REPO.parent.parent / '_temp'
    need(Path(os.environ.get('RUNNER_TEMP', '')).resolve() == temp.resolve(), 'RUNNER_TEMP')
    inputs._directory(temp.lstat())
    destination = temp / ('sorng-windows-arm-checkpoint-' + str(current['id']) + '-' + str(current['run_attempt']))
    destination.mkdir()  # Exclusive; partial/old handoffs are never overwritten.
    with stage('api-run'):
        immutable, artifact_pin = authenticated_seal(client, prior, prior_run, prior_attempt, destination)
    need(immutable['identity']['image'] == image and immutable['identity']['sourceId'] == inputs.SOURCES[image] and
         immutable['identity']['producerSha256'] == producer_digest(policy['producerInputs']), 'SEAL_SCOPE')
    release = client.get('/repos/' + REPOSITORY + '/releases/' + str(immutable['release']['id']))
    need(release.get('id') == immutable['release']['id'] and release.get('tag_name') == immutable['release']['tag'] and
         release.get('draft') is True and release.get('prerelease') is True and release.get('target_commitish') == prior['head_sha'], 'RELEASE_SCOPE')
    assets = _release_assets(client, release)
    need('checkpoint.json' in assets and 0 < assets['checkpoint.json']['size'] <= MAX_RECORD, 'RECORD_ASSET')
    # Record digest is committed in the fixed tag; full asset digest from API is
    # required too, before downloading or using any declared member paths.
    need(set(assets) == {row['name'] for row in immutable['assets']} and all(
         assets[row['name']]['id'] == row['id'] and assets[row['name']]['size'] == row['bytes'] and
         assets[row['name']].get('digest') == 'sha256:' + row['sha256'] for row in immutable['assets']), 'SEAL_ASSET_BINDING')
    record_pin = immutable['record']
    _download_asset(client, assets['checkpoint.json'], destination / 'checkpoint.json', record_pin, MAX_RECORD)
    record = strict_json(bootstrap_read(destination / 'checkpoint.json', MAX_RECORD, record_pin))
    need(record['workflow']['runId'] == prior_run and record['workflow']['attempt'] == prior_attempt and
         record['workflow']['head'] == prior['head_sha'] and record['identity']['image'] == image and
         record['identity']['producerSha256'] == producer_digest(policy['producerInputs']) and tag(record, record_pin) == release['tag_name'] and
         canonical(record['identity']) == canonical(immutable['identity']) and record['nativeEvidence'] == immutable['nativeEvidence'] and
         record['rawChain']['sourceContext'] == immutable['sourceContext'], 'PRIOR_BINDING')
    expected = validate_record(record, record['identity'])
    need(set(assets) == {'checkpoint.json', *(row['name'] for row in expected)} and
         sum(row['size'] for row in assets.values()) <= MAX_TOTAL, 'ASSET_SET')
    for row in expected:
        with stage('asset-download', row['name'], bytes=row['bytes']):
            _download_asset(client, assets[row['name']], destination / row['name'],
                            {key: row[key] for key in ('bytes', 'sha256')}, max(MAX_CHUNK, inputs.MAX_SIDECAR))
    validate_evidence(record, strict_json(bootstrap_read(destination / 'native-chain.json', MAX_RECORD, record['nativeEvidence'])))
    # Reauthenticate terminal state after all bytes arrive; a rerun or moving
    # attempt never inherits the earlier successful response.
    need(_run(client, prior_run, prior_attempt)['head_sha'] == prior['head_sha'], 'PRIOR_CHANGED')
    ready = dict(kind='windows-arm-full-sdk-checkpoint-download', schemaVersion=1, record=record_pin,
                 priorRunId=prior_run, priorAttempt=prior_attempt, currentRunId=str(current['id']),
                 currentAttempt=str(current['run_attempt']), head=prior['head_sha'], identity=record['identity'], sealArtifact=artifact_pin)
    ready_raw = canonical(ready) + b'\n'
    with owned((destination / 'ready.json').open('xb')) as stream:
        need(stream.write(ready_raw) == len(ready_raw), 'READY_WRITE')
    need(bootstrap_read(destination / 'ready.json', MAX_RECORD) == ready_raw, 'READY_READBACK')
    return dict(dataOnly=True, readyPin=dict(bytes=len(ready_raw), sha256=sha(ready_raw)))


def transport_upload(client, image, clock, fence):
    current, policy = _transport_scope(client)
    root = REPO / '.artifacts' / inputs.root_name(image, inputs.SOURCES.get(image))
    outcome = root / 'full-sdk-controller-result.json'
    if outcome.exists():
        report = strict_json(bootstrap_read(outcome, 131072))
        if report.get('sdkBuilt') is True:
            return sdk_quarantine(client, root, report, clock, fence, current, policy)
    # Read identity from a fixed path, then validate all fields and actual raw
    # closure again. API current-run scope is not an engine completion grant.
    record = strict_json(bootstrap_read(root / OUTPUT / 'checkpoint.json', MAX_RECORD))
    guard, identity, _ = guard_for(root, record['identity'], clock, fence)
    source, chain = validate_chain(guard, identity)
    expected = validate_record(record, identity)
    record_pin, _ = held(guard, OUTPUT + '/checkpoint.json')
    need(record['rawChain'] == chain and record['workflow']['runId'] == str(current['id']) and
         record['workflow']['attempt'] == str(current['run_attempt']) and record['workflow']['head'] == current['head_sha'] and
         source['head'] == current['head_sha'] and identity['image'] == image and
         identity['producerSha256'] == producer_digest(policy['producerInputs']), 'UPLOAD_BINDING')
    release = client.post('/repos/' + REPOSITORY + '/releases',
                          dict(tag_name=tag(record, record_pin), target_commitish=current['head_sha'],
                               name=tag(record, record_pin), draft=True, prerelease=True))
    need(type(release.get('id')) is int and release.get('draft') is True and release.get('prerelease') is True and
         release.get('target_commitish') == current['head_sha'] and release.get('tag_name') == tag(record, record_pin), 'UPLOAD_RELEASE')
    for row in [dict(name='checkpoint.json', **record_pin), *expected]:
        with stage('asset-upload', row['name'], bytes=row['bytes']):
            seal, raw = held(guard, OUTPUT + '/' + row['name'], max(MAX_CHUNK, inputs.MAX_SIDECAR),
                             {key: row[key] for key in ('bytes', 'sha256')})
            response, length = client.response('POST', '/repos/' + REPOSITORY + '/releases/' + str(release['id']) + '/assets?name=' + urllib.parse.quote(row['name']), raw)
            with owned(response):
                raw_response = response.read(MAX_RECORD + 1)
                need(length is None or len(raw_response) == length, 'UPLOAD_BODY')
                uploaded = strict_json(raw_response)
            need(uploaded.get('name') == row['name'] and uploaded.get('size') == seal['bytes'] and
                 uploaded.get('state') == 'uploaded' and uploaded.get('digest') == 'sha256:' + seal['sha256'], 'UPLOAD_ASSET')
    actual_assets = _release_assets(client, release)
    all_expected = [dict(name='checkpoint.json', **record_pin), *expected]
    need(set(actual_assets) == {row['name'] for row in all_expected} and
         all(actual_assets[row['name']]['size'] == row['bytes'] and actual_assets[row['name']].get('digest') == 'sha256:' + row['sha256']
             for row in all_expected), 'UPLOADED_SET')
    raw_seal = dict(schemaVersion=1, kind='windows-arm-full-sdk-immutable-checkpoint-seal', workflow=record['workflow'],
                    identity=identity, release=dict(id=release['id'], tag=release['tag_name'], head=current['head_sha']),
                    record=record_pin, assets=[dict(id=actual_assets[row['name']]['id'], **row) for row in all_expected],
                    nativeEvidence=record['nativeEvidence'], sourceContext=chain['sourceContext'])
    seal_pin = write(guard, OUTPUT + '/checkpoint-seal.json', raw_seal)
    return dict(dataOnly=True, uploaded=True, kind='checkpoint', usableOnlyAfterWorkflowSuccess=True, tag=release['tag_name'],
                sealFile=OUTPUT + '/checkpoint-seal.json', seal=seal_pin,
                artifactName=seal_name(str(current['id']), str(current['run_attempt'])))


def restore_checkpoint(root, identity, source_context_sha256, ready_pin, clock, fence):
    guard, identity, basic = guard_for(root, identity, clock, fence)
    source, source_pin = _source(guard, identity)
    need(source_pin['sha256'] == source_context_sha256, 'RESTORE_SOURCE_PIN')
    need(not any((guard.root / path).exists() for path in ('full-sdk-engine-probe', 'jobs/probe-clang',
             'full-sdk-engine-cef-engine-context.json', 'full-metadata-result.json', 'full-source-gn-result.json')), 'RESTORE_ORDER')
    need(source.get('image') == identity['image'] and source.get('sourceId') == identity['sourceId'] and
         producer_digest(source['sources']) == identity['producerSha256'], 'RESTORE_SOURCE')
    download = REPO.parent.parent / '_temp' / ('sorng-windows-arm-checkpoint-' + source['runId'] + '-' + source['attempt'])
    inputs._directory(download.lstat())
    # The only external read root is this fixed dedicated transport handoff.
    before = inputs._signature((download / 'ready.json').lstat())
    with inputs._file(download / 'ready.json', guard) as stream:
        raw = stream.read(MAX_RECORD + 1)
        need(dict(bytes=len(raw), sha256=sha(raw)) == pin(ready_pin) and inputs._signature((download / 'ready.json').lstat()) == before, 'READY_PIN')
    ready = strict_json(raw)
    need(ready.get('kind') == 'windows-arm-full-sdk-checkpoint-download' and ready.get('currentRunId') == source['runId'] and
         ready.get('currentAttempt') == source['attempt'] and canonical(ready['identity']) == canonical(identity), 'READY_SCOPE')
    # Rehold every downloaded asset into a fixed root-owned import directory;
    # no archive extraction is allowed to use caller-supplied paths.
    imported = guard.root / 'full-sdk-checkpoint-import'
    imported.mkdir()
    with inputs._file(download / 'checkpoint.json', guard) as stream:
        raw = stream.read(MAX_RECORD + 1)
    need(dict(bytes=len(raw), sha256=sha(raw)) == ready['record'], 'RESTORE_RECORD_PIN')
    record = strict_json(raw)
    expected = validate_record(record, identity)
    for row in [dict(name='checkpoint.json', **ready['record']), *expected]:
        file = download / row['name']
        before = inputs._signature(file.lstat())
        need(before[3] == row['bytes'], 'RESTORE_ASSET_SIZE')
        digest, count = hashlib.sha256(), 0
        with inputs._file(file, guard) as stream, inputs._file(imported / row['name'], guard, create=True) as target:
            fd_before = inputs._signature(os.fstat(stream.fileno()))
            need(inputs._shared(fd_before) == inputs._shared(before), 'RESTORE_ASSET_IDENTITY')
            while True:
                guard.check()
                chunk = stream.read(min(1024**2, row['bytes'] + 1 - count))
                if not chunk:
                    break
                count += len(chunk)
                need(count <= row['bytes'] and target.write(chunk) == len(chunk), 'RESTORE_ASSET_GROWTH')
                digest.update(chunk)
            need(count == row['bytes'] and digest.hexdigest() == row['sha256'] and
                 inputs._signature(os.fstat(stream.fileno())) == fd_before and inputs._signature(file.lstat()) == before, 'RESTORE_ASSET_PIN')
    helper = _helper(guard)
    validate_evidence(record, read(guard, 'full-sdk-checkpoint-import/native-chain.json', record['nativeEvidence'])[0])
    with archive_stage(helper, 'restore-out'):
        restored = guard.root / 'source-checkout/src/out/checkpoint-restored'
        if not restored.parent.exists():
            restored.parent.mkdir()
        inputs._directory(restored.parent.lstat())
        result = helper.restore(imported, restored, record['outArchive'], seconds=_seconds(guard))
        guard.check()
        need(result.get('complete') is True and result.get('linksExtracted') is False, 'RESTORE_OUT')
        _, graph_raw = held(guard, 'full-sdk-checkpoint-import/graph.json', 16 * 1024**2, identity['graphPin'])
        graph = strict_json(graph_raw, 16 * 1024**2)
        verify_graph(guard, graph, 'source-checkout/src/out/checkpoint-restored')
        held(guard, TOOL_FILE, 16 * 1024**2, identity['toolProofPin'], retain=False)
    with stage('restore-install'):
        original = guard.root / OUT
        if original.exists():
            inputs._directory(original.lstat())
            original.rename(original.with_name('Release_GN_arm64.fresh-gn'))
        restored.rename(original)
        guard.check()
    with stage('sidecar-apply'):
        _copy(guard, 'full-sdk-checkpoint-import/inputs.jsonl', inputs.SIDECAR, record['inputSidecar'], inputs.MAX_SIDECAR)
        inputs.apply_inputs(root, basic, record['inputSidecar'], clock, fence)
    return dict(dataOnly=True, restored=True, graphPin=identity['graphPin'], priorGraph=graph, sourceQualified=False,
                checkpointAdmission=False, executionAdmitted=False)


class _TransportClock:
    def __init__(self):
        # The original FIRST workflow carrier, never now+6h or a new lease.
        raw = os.environ.get('SORNG_FULLSDK_FIRST_CLOCK', '').encode()
        value = strict_json(raw, 4096)
        fields = {'schemaVersion', 'kind', 'clock', 'dotnetMajor', 'wallStartMs', 'tickStartMs', 'wallEndMs', 'tickEndMs',
                  'repository', 'repositoryId', 'ref', 'event', 'runId', 'attempt', 'head', 'workflowSha', 'workflowRef', 'job', 'image'}
        need(os.name == 'nt' and set(value) == fields and type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
             value['kind'] == 'windows-arm-first-workflow-clock' and value['clock'] == 'windows-gettickcount64' and
             type(value['dotnetMajor']) is int and value['dotnetMajor'] in (8, 9, 10), 'TRANSPORT_FIRST_CLOCK')
        keys = dict(repository='GITHUB_REPOSITORY', repositoryId='GITHUB_REPOSITORY_ID', ref='GITHUB_REF',
                    event='GITHUB_EVENT_NAME', runId='GITHUB_RUN_ID', attempt='GITHUB_RUN_ATTEMPT', head='GITHUB_SHA',
                    workflowSha='GITHUB_WORKFLOW_SHA', workflowRef='GITHUB_WORKFLOW_REF', job='GITHUB_JOB', image='ImageVersion')
        need(all(value[key] == os.environ.get(env) for key, env in keys.items()) and
             value['repository'] == REPOSITORY and value['repositoryId'] == str(REPOSITORY_ID) and
             value['ref'] == 'refs/heads/main' and value['event'] == 'workflow_dispatch' and value['job'] == 'sdk' and
             value['workflowRef'] == REPOSITORY + '/' + WORKFLOW + '@refs/heads/main' and
             value['head'] == value['workflowSha'] and re.fullmatch('[a-f0-9]{40}', value['head']) and
             value['image'] in inputs.SOURCES and os.environ.get('GITHUB_ACTIONS') == 'true' and
             os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public' and
             os.environ.get('CEF_DEFAULT_BRANCH') == 'main', 'TRANSPORT_CLOCK_SCOPE')
        for key in ('wallStartMs', 'tickStartMs', 'wallEndMs', 'tickEndMs'):
            need(type(value[key]) is int and value[key] >= 0, 'TRANSPORT_CLOCK_INTEGER')
        need(value['wallEndMs'] - value['wallStartMs'] == 21600000 and value['tickEndMs'] - value['tickStartMs'] == 21600000,
             'TRANSPORT_CLOCK_DURATION')
        import ctypes as c
        self.tick = c.WinDLL('kernel32', use_last_error=True).GetTickCount64
        self.tick.argtypes, self.tick.restype = (), c.c_ulonglong
        self.value, self.failed, self.primary = value, False, None
        self.last_wall, self.last_tick = value['wallStartMs'], value['tickStartMs']
        self.remaining()
    def remaining(self):
        if self.failed:
            raise self.primary
        try:
            wall, tick = time.time() * 1000, self.tick()
            need(wall >= self.last_wall and tick >= self.last_tick, 'TRANSPORT_CLOCK_ROLLBACK')
            self.last_wall, self.last_tick = wall, tick
            left = min(self.value['wallEndMs'] - wall, self.value['tickEndMs'] - tick) / 1000 - 150
            need(0 < left <= 21600, 'TRANSPORT_DEADLINE')
            return left
        except BaseException as error:
            self.failed, self.primary = True, error
            raise


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    need(type(argv) is list and argv, 'ARGV')
    if argv[0] in ('--restore', '--seal'):
        need(len(argv) == 3 and re.fullmatch('[a-f0-9]{64}', argv[2]), 'ARGV')
        root = Path(argv[1])
        need(root.is_absolute() and root.parent == REPO / '.artifacts' and
             re.fullmatch('windows-arm-full-sdk-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', root.name), 'ROOT_ARGUMENT')
        # Codec original clock is anchored to original context absolute ends.
        raw = bootstrap_read(root / 'context.json', 131072)
        need(len(raw) <= 131072 and sha(raw) == argv[2], 'SOURCE_CONTEXT_PIN')
        source = strict_json(raw, 131072)
        class Original:
            def remaining(self):
                left = min(source['wallWholeEnd'] - time.time() - 150,
                           source['monotonicWholeEnd'] - time.monotonic() - 150)
                if argv[0] == '--restore':
                    left = min(left, source['wallWorkEnd'] - time.time(), source['monotonicWorkEnd'] - time.monotonic())
                need(left > 0, 'ORIGINAL_SOURCE_DEADLINE')
                return left
        if argv[0] == '--seal':
            tools = bootstrap_read(root / TOOL_FILE, 16 * 1024**2)
            graph = bootstrap_read(root / GRAPH_FILE, 16 * 1024**2)
            identity = dict(image=source['image'], sourceId=source['sourceId'], producerSha256=producer_digest(source['sources']),
                            sourceDateEpoch=dict(present=False, value=None), canonicalRoot=root.name,
                            toolProofPin=dict(bytes=len(tools), sha256=sha(tools)), graphPin=dict(bytes=len(graph), sha256=sha(graph)))
            result = seal_checkpoint(root, identity, Original(), lambda: None)
            report = dict(schemaVersion=1, kind='windows-arm-full-sdk-checkpoint-seal-result', sourceContextSha256=argv[2],
                          dataOnly=True, sealed=True, checkpoint=result['checkpoint'], outcome=result['record']['rawChain']['outcome'],
                          bundle=OUTPUT, sdkBuilt=False, nativeAcceptance=False, executionAdmitted=False)
            guard = guard_for(root, identity, Original(), lambda: None)[0]
            result_pin = write(guard, 'full-sdk-checkpoint-seal-result.json', report)
            return dict(**report, result=result_pin)
        restore = source.get('checkpointRestore')
        need(type(restore) is dict and set(restore) == {'runId', 'attempt', 'readyPin'} and
             re.fullmatch('[1-9][0-9]{0,19}', restore['runId']) and re.fullmatch('[1-9][0-9]{0,8}', restore['attempt']) and
             re.fullmatch('[1-9][0-9]{0,19}', source['runId']) and re.fullmatch('[1-9][0-9]{0,8}', source['attempt']), 'RESTORE_PACKET')
        ready_file = REPO.parent.parent / '_temp' / ('sorng-windows-arm-checkpoint-' + source['runId'] + '-' + source['attempt']) / 'ready.json'
        ready = strict_json(bootstrap_read(ready_file, MAX_RECORD, pin(restore['readyPin'])))
        need(ready.get('priorRunId') == restore['runId'] and ready.get('priorAttempt') == restore['attempt'], 'RESTORE_PRIOR_RUN')
        # The source Node's genuine bootstrap authority owns process creation;
        # this token-free codec performs only bounded file/data work.
        result = restore_checkpoint(argv[1], ready['identity'], argv[2], restore['readyPin'], Original(), lambda: None)
        result.pop('priorGraph')
        result['priorGraphFile'] = 'full-sdk-checkpoint-import/graph.json'
        return result
    need(argv[0] in ('--download', '--upload') and (len(argv) == 2 if argv[0] == '--download' else len(argv) == 3), 'ARGV')
    clock = _TransportClock()
    client = Github(os.environ.pop('GH_TOKEN', ''), clock)
    if argv[0] == '--download':
        need(re.fullmatch('[1-9][0-9]{0,19}', argv[1]), 'ARGV')
        latest = client.get('/repos/' + REPOSITORY + '/actions/runs/' + argv[1])
        need(type(latest.get('run_attempt')) is int and latest['run_attempt'] > 0, 'PRIOR_ATTEMPT')
        return transport_download(client, argv[1], str(latest['run_attempt']), os.environ.get('ImageVersion', ''))
    need(re.fullmatch('[a-f0-9]{64}', argv[2]), 'ARGV')
    need(Path(argv[1]).is_absolute() and Path(argv[1]).parent == REPO / '.artifacts', 'UPLOAD_ROOT')
    source = strict_json(bootstrap_read(Path(argv[1]) / 'context.json', 131072))
    raw = bootstrap_read(Path(argv[1]) / 'context.json', 131072)
    need(sha(raw) == argv[2] and Path(argv[1]) == REPO / '.artifacts' / inputs.root_name(source['image'], source['sourceId']), 'UPLOAD_ROOT')
    return transport_upload(client, source['image'], clock, lambda: None)


if __name__ == '__main__':
    try:
        print(json.dumps(main(), separators=(',', ':')))
    except BaseException as error:
        print(json.dumps(dict(complete=False, **failure_context(error)), separators=(',', ':')))
        raise SystemExit(1) from None
