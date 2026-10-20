# Kopia, migracja, odtworzenie i środowisko testowe

## Aktualizacja lokalna (macOS)

1. Zatrzymaj serwer (Ctrl+C). Zanotuj commit `git rev-parse HEAD`.
2. Z bieżącym kodem narzędzia, ale PRZED pierwszym uruchomieniem nowego serwera,
   wykonaj kopię (katalog wyjściowy musi być nowy; nie zapisuj kopii w Git):

```sh
python3 scripts/backup.py create --db data/evolution.sqlite --logo data/logo --output /tmp/ea-backup-20261020
python3 scripts/backup.py verify --source /tmp/ea-backup-20261020
python3 scripts/backup.py restore --source /tmp/ea-backup-20261020 --target /tmp/ea-restore-20261020
```

Jeśli nie wgrywano logo, pomiń `--logo`. Jeśli używasz DB_PATH/LOGO_PATH, podaj
rzeczywiste ścieżki. `/tmp` to przykład do testów; trwałe kopie przechowuj w
chronionym miejscu poza komputerem z aplikacją, z ograniczonym dostępem i szyfrowaniem.
Kopia zawiera dane dzieci i rodziców, hashe haseł i sesji. Nie wgrywaj jej do repo.

3. Przetestuj nowy kod na odtworzonej kopii przy zatrzymanej aplikacji głównej:

```sh
DB_PATH=/tmp/ea-restore-20261020/evolution.sqlite LOGO_PATH=/tmp/ea-restore-20261020/logo PORT=3010 npm start
```

Sprawdź logowanie, liczbę dzieci/grup/naliczeń, sumy sald i historię. Zatrzymaj test.
Dopiero wtedy uruchom nowy kod na właściwej bazie. Migracja 1 jest addytywna,
transakcyjna i rejestrowana w `schema_migrations`; nie kasuje danych.

## Wycofanie

Przy błędzie zatrzymaj aplikację. Zachowaj osobną kopię stanu po błędzie, zwłaszcza
jeśli po aktualizacji dopisano nowe dane. Odtwórz kopię do NOWEGO katalogu. Uruchom
zanotowaną wcześniejszą wersję kodu z DB_PATH/LOGO_PATH wskazującymi tę kopię.
Nie uruchamiaj starego kodu na nowej bazie z triggerami audytu. Nie nadpisuj działającej
bazy ani nie próbuj automatycznie cofać kolumn. Dane powstałe po kopii wymagają
uzgodnionego przeniesienia — rollback nie może ich po cichu zgubić.

Narzędzie nie przyjmuje istniejącego katalogu wyjściowego. SQLite backup API daje
spójny snapshot bazy, a zatrzymanie aplikacji zapewnia spójność tego snapshotu z logo.
Manifest: SHA-256 plików i liczby rekordów; dodatkowo PRAGMA integrity_check oraz
foreign_key_check. Nie jest to szyfrowanie ani ochrona przed osobą mającą zapis do
kopii i manifestu. Test odtworzenia należy wykonywać okresowo i przed migracjami.

## Testy i dostęp publiczny

```sh
npm ci
npm test
python3 test/smoke.py
python3 test/accounts.py
python3 test/public_signup.py
python3 test/foundations.py
```

Każdy test integracyjny używa osobnej tymczasowej bazy, portu i fikcyjnych danych.
Testy nie wysyłają wiadomości i nie obciążają kont. Brak dostawców produkcyjnych.
Przeglądarkowy scenariusz etapu 1: `npx playwright install chromium`, następnie `npm run test:e2e`. Szczegóły w `ETAP-1.md`.

Zmienne obsługiwane: HOST (domyślnie 127.0.0.1), PORT (3000), DB_PATH,
LOGO_PATH, COOKIE_SECURE=1 dla HTTPS. `npm start` uruchamia proces, nie publikuje
strony. Publiczne wdrożenie wymaga prywatnego trwałego dysku, HTTPS/reverse proxy,
odseparowanych sekretów i kopii, monitorowania oraz ukończenia MFA/resetu/zgód/SOM.
Etap 1 nie jest deklaracją gotowości do zbierania rzeczywistych danych dzieci.
Nie wystawiaj formularza tworzenia pierwszego admina publicznie przed konfiguracją.
Limity IP są obecnie w pamięci pojedynczego procesu; przed proxy/wieloma workerami
należy wdrożyć zaufaną obsługę IP, trwały limiter i paginowane odczyty API.

## Retencja

Nie ma automatycznego kasowania kartotek ani dziennika. Produkcyjny okres retencji
musi zatwierdzić organizator dla poszczególnych kategorii danych. Dziennik zawiera
historię danych osobowych; dostęp wyłącznie Administrator. Przyszłe usunięcia lub
anonimizacja wymagają procedury obejmującej audyt, eksporty i rotację kopii. Wdrożenie
samego dziennika nie oznacza spełnienia wszystkich obowiązków RODO.
