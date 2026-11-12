"""Test-only exact image-refresh prefix; original whole historical pins remain."""
import hashlib
import json
from pathlib import Path
RUNTIME_BUDGET_SPECS = json.loads(Path(__file__).with_name('windows_runtime_budget_inverse.json').read_text())
SPECS = json.loads(Path(__file__).with_suffix('.json').read_text())
NAMES = {'driver':'native/windows-arm-full-sdk/full-sdk-source-driver.mjs','controller':'native/windows-arm-full-sdk/full_sdk_control.mjs','python':'native/windows-arm-full-sdk/full_sdk_source.py','producer':'native/windows-arm-full-sdk/producer.py','profile':'native/windows-arm-full-sdk/full-sdk-source-profile.json'}
def runtime_budget_text(raw, file):
    # Only this ordinary Git text witness may expand to CRLF on Windows.
    return raw.replace(b'\r\n',b'\n') if file=='tests/tooling/windowsArmFullSdk.node-test.mjs' else raw

def runtime_budget_inverse(raw, file):
    spec=RUNTIME_BUDGET_SPECS[file];raw=runtime_budget_text(raw,file)
    assert len(raw)==spec['bytes'] and hashlib.sha256(raw).hexdigest()==spec['sha256'], 'RUNTIME_BUDGET_WHOLE'
    for row in spec['pairs']:
        current,previous=row['current'].encode(),row['previous'].encode()
        assert raw.count(current)==1, 'RUNTIME_BUDGET_COUNT'
        raw=raw.replace(current,previous,1)
    assert len(raw)==spec['beforeBytes'] and hashlib.sha256(raw).hexdigest()==spec['beforeSha256'], 'RUNTIME_BUDGET_OLD_WHOLE'
    return raw

def runtime_budget_prefix(raw, name):
    file=NAMES.get(name,name);spec=RUNTIME_BUDGET_SPECS.get(file);canonical=runtime_budget_text(raw,file)
    return runtime_budget_inverse(canonical,file) if spec and hashlib.sha256(canonical).hexdigest()==spec['sha256'] else raw

def inverse(raw, file):
    raw=runtime_budget_prefix(raw,file)
    spec = SPECS[file]; raw = raw.replace(b'\r\n',b'\n')
    assert len(raw)==spec['bytes'] and hashlib.sha256(raw).hexdigest()==spec['sha256'], 'ASSEMBLY_INVERSE_IMAGE_WHOLE'
    for row in spec['pairs']:
        current,previous=row['current'].encode(),row['previous'].encode()
        assert raw.count(current)==1, 'ASSEMBLY_INVERSE_IMAGE_COUNT'
        raw=raw.replace(current,previous,1)
    assert len(raw)==spec['beforeBytes'] and hashlib.sha256(raw).hexdigest()==spec['beforeSha256'], 'ASSEMBLY_INVERSE_IMAGE_OLD_WHOLE'
    return raw
def prefix(raw, name):
    raw=runtime_budget_prefix(raw,name)
    file=NAMES.get(name,name);spec=SPECS.get(file);canonical=raw.replace(b'\r\n',b'\n')
    return inverse(canonical,file) if spec and hashlib.sha256(canonical).hexdigest()==spec['sha256'] else raw
