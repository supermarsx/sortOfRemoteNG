"""Test-only exact image-refresh prefix; original whole historical pins remain."""
import hashlib
import json
from pathlib import Path
SPECS = json.loads(Path(__file__).with_suffix('.json').read_text())
NAMES = {'driver':'native/windows-arm-full-sdk/full-sdk-source-driver.mjs','controller':'native/windows-arm-full-sdk/full_sdk_control.mjs','python':'native/windows-arm-full-sdk/full_sdk_source.py','producer':'native/windows-arm-full-sdk/producer.py','profile':'native/windows-arm-full-sdk/full-sdk-source-profile.json'}
def inverse(raw, file):
    spec = SPECS[file]; raw = raw.replace(b'\r\n',b'\n')
    assert len(raw)==spec['bytes'] and hashlib.sha256(raw).hexdigest()==spec['sha256'], 'ASSEMBLY_INVERSE_IMAGE_WHOLE'
    for row in spec['pairs']:
        current,previous=row['current'].encode(),row['previous'].encode()
        assert raw.count(current)==1, 'ASSEMBLY_INVERSE_IMAGE_COUNT'
        raw=raw.replace(current,previous,1)
    assert len(raw)==spec['beforeBytes'] and hashlib.sha256(raw).hexdigest()==spec['beforeSha256'], 'ASSEMBLY_INVERSE_IMAGE_OLD_WHOLE'
    return raw
def prefix(raw, name):
    file=NAMES.get(name,name);spec=SPECS.get(file);canonical=raw.replace(b'\r\n',b'\n')
    return inverse(canonical,file) if spec and hashlib.sha256(canonical).hexdigest()==spec['sha256'] else raw
