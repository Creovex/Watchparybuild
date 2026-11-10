#!/usr/bin/env python3
"""Deploy function sources through the management API without exposing authentication values."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]

def deploy(project, slug, dry_run=False):
    if not re.fullmatch(r'[a-z]{20}', project) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', slug):
        raise ValueError('Invalid project reference or function name')
    folder = ROOT / 'supabase' / 'functions' / slug
    if not (folder / 'index.ts').is_file() or not (folder / 'deno.json').is_file():
        raise ValueError('Function entrypoint or import map is missing')
    files = sorted(folder.glob('*.ts')) + [folder / 'deno.json']
    files += sorted((ROOT / 'supabase' / 'functions' / '_shared').glob('*.ts'))
    if dry_run:
        print(f'{slug}: {len(files)} source files; JWT verification enabled')
        return
    token = os.environ.get('Synvello_SUPABASE_ACCESS_TOKEN') or os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token:
        raise ValueError('Configure the Supabase access token securely in the environment')
    boundary = 'synvello' + uuid.uuid4().hex
    def part(name, value, filename=None):
        disposition = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{filename}"'
        kind = 'application/octet-stream' if filename else 'application/json'
        return (f'--{boundary}\r\n{disposition}\r\nContent-Type: {kind}\r\n\r\n').encode() + value + b'\r\n'
    base = f'supabase/functions/{slug}'
    metadata = {'name': slug, 'entrypoint_path': base + '/index.ts', 'import_map_path': base + '/deno.json', 'verify_jwt': True}
    body = part('metadata', json.dumps(metadata).encode())
    for file in files:
        body += part('file', file.read_bytes(), file.relative_to(ROOT).as_posix())
    body += f'--{boundary}--\r\n'.encode()
    request = urllib.request.Request(f'https://api.supabase.com/v1/projects/{project}/functions/deploy?slug={slug}', method='POST', data=body, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{slug}: deployment refused with HTTP {error.code}') from None
    except urllib.error.URLError:
        raise RuntimeError(f'{slug}: deployment service could not be reached') from None
    if data.get('status') != 'ACTIVE':
        raise RuntimeError(f'{slug}: deployment did not become active')
    print(f'{slug}: active; JWT verification enabled')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('functions', nargs='+')
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        for name in args.functions:
            deploy(args.project_ref, name, args.dry_run)
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
