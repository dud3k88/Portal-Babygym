"""SQLite snapshot + logo, verification and restore to a NEW directory only.
Stop the application before backup to keep database and logo at the same point.
No production paths are assumed; all arguments are explicit.
"""
import argparse, hashlib, json, os, pathlib, shutil, sqlite3
from datetime import datetime, timezone


def database(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)


def check(path):
    with database(path) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Błąd integralności bazy.')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Błąd powiązań bazy.')
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {table: db.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0] for table in tables}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(source):
    manifest = json.loads((source / 'manifest.json').read_text())
    names=set(manifest['files'])
    if manifest.get('format') not in (1,2) or 'evolution.sqlite' not in names or names-{'evolution.sqlite','logo','evolution.sqlite.mfa-key'}:
        raise ValueError('Nieobsługiwany format kopii.')
    for name, checksum in manifest['files'].items():
        if digest(source / name) != checksum:
            raise ValueError('Niezgodna suma kontrolna: ' + name)
    if check(source / 'evolution.sqlite') != manifest['row_counts']:
        raise ValueError('Niezgodna liczba rekordów.')
    return manifest


def create(args):
    source, target = pathlib.Path(args.db), pathlib.Path(args.output)
    if not source.is_file():
        raise ValueError('Nie znaleziono bazy źródłowej.')
    target.mkdir(mode=0o700)  # Never overwrite an existing directory.
    try:
        with database(source) as original, sqlite3.connect(target / 'evolution.sqlite') as copy:
            original.backup(copy)
        names = ['evolution.sqlite']
        if os.environ.get('MFA_ENCRYPTION_KEY') and not args.external_mfa_key:
            raise ValueError('Klucz MFA z ENV wymaga osobnej kopii i flagi --external-mfa-key.')
        key = pathlib.Path(args.mfa_key or os.environ.get('MFA_KEY_PATH') or str(source)+'.mfa-key')
        if key.is_file() and not args.external_mfa_key:
            if len(key.read_bytes()) != 32:
                raise ValueError('Nieprawidłowy klucz MFA.')
            shutil.copyfile(key, target / 'evolution.sqlite.mfa-key'); names.append('evolution.sqlite.mfa-key')
        else:
            with database(source) as original:
                has_mfa = original.execute("SELECT 1 FROM sqlite_master WHERE name='admin_mfa'").fetchone()
                if has_mfa and original.execute('SELECT 1 FROM admin_mfa UNION ALL SELECT 1 FROM mfa_pending LIMIT 1').fetchone() and not args.external_mfa_key:
                    raise ValueError('Brak klucza MFA. Podaj --mfa-key lub --external-mfa-key, jeśli klucz ENV zabezpieczono osobno.')
        if args.logo:
            logo = pathlib.Path(args.logo)
            if not logo.is_file():
                raise ValueError('Nie znaleziono wskazanego logo.')
            shutil.copyfile(logo, target / 'logo'); names.append('logo')
        for name in names:
            os.chmod(target / name, 0o600)
        manifest = {'format': 2, 'external_mfa_key_required': args.external_mfa_key, 'created_at': datetime.now(timezone.utc).isoformat(),
                    'files': {name: digest(target / name) for name in names},
                    'row_counts': check(target / 'evolution.sqlite')}
        (target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        os.chmod(target / 'manifest.json', 0o600)
        verify(target)
    except Exception:
        shutil.rmtree(target)  # Only this newly created output is removed.
        raise


def restore(args):
    source, target = pathlib.Path(args.source), pathlib.Path(args.target)
    manifest = verify(source)
    target.mkdir(mode=0o700)  # Deliberately no --force option.
    try:
        for name in manifest['files']:
            shutil.copyfile(source / name, target / name)
            os.chmod(target / name, 0o600)
        if check(target / 'evolution.sqlite') != manifest['row_counts']:
            raise ValueError('Błąd odtworzenia.')
    except Exception:
        shutil.rmtree(target)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    backup = sub.add_parser('create'); backup.add_argument('--db', required=True); backup.add_argument('--logo'); backup.add_argument('--output', required=True)
    backup.add_argument('--mfa-key'); backup.add_argument('--external-mfa-key', action='store_true')
    validation = sub.add_parser('verify'); validation.add_argument('--source', required=True)
    recovery = sub.add_parser('restore'); recovery.add_argument('--source', required=True); recovery.add_argument('--target', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'create': create(args)
        elif args.command == 'restore': restore(args)
        else: verify(pathlib.Path(args.source))
        print('OK: ' + args.command)
    except (OSError, ValueError, sqlite3.Error, KeyError) as error:
        parser.exit(1, 'Błąd: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
