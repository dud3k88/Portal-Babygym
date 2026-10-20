# Etap 2B — MFA administratora, odzyskiwanie hasła i dodatkowi opiekunowie

Kontynuacja etapu 2A. Działające procesy lokalne z testami API i przeglądarki.
Linki resetu/zaproszeń mają wyłącznie dostarczanie testowe do prywatnego katalogu.
Nie podłączono produkcyjnej poczty, SMS ani płatności.

## Jak używać

1. Po aktualizacji administrator loguje się ponownie hasłem i dodaje konto do
   aplikacji uwierzytelniającej, np. 2FAS lub Google Authenticator. Wybierz ręczne
   wpisanie klucza: typ czasowy TOTP, SHA1, 6 cyfr, co 30 sekund. Wpisz kod na stronie.
   Zapisz 10 jednorazowych kodów zapasowych w bezpiecznym miejscu poza tym urządzeniem.
   Późniejsze logowanie: hasło, następnie kod z aplikacji.
2. Utracony telefon: po wpisaniu hasła użyj niewykorzystanego kodu zapasowego.
   Można zalogować się nim jednorazowo albo zaznaczyć **Mam nowy telefon**.
   Druga opcja unieważnia poprzedni klucz, wszystkie stare kody i sesje administratora;
   dostęp do panelu wraca dopiero po potwierdzeniu kodu z nowej aplikacji. Pojawia się
   nowy komplet kodów zapasowych. Bez telefonu i bez kodów nie ma obejścia przez email.
3. Lokalne testy odzyskiwania hasła i zaproszeń uruchamiaj z:

   ```sh
   SECURITY_OUTBOX_DIR="$PWD/data/security-outbox" npm run dev
   ```

   Katalog powstaje z prawami 0700, pliki JSON z 0600. Bez tej zmiennej operacja
   przygotowania linku zwraca informację o braku konfiguracji i nie zmienia danych.
   Na macOS otwórz katalog `data/security-outbox` w Finderze. Plik wskazuje odbiorcę
   w `to` i ścieżkę w `path`; do testu dodaj przed ścieżką `http://localhost:3000`.
   Tylko operator lokalnego środowiska ma dostęp do tych plików. Nie ma publicznej
   skrzynki HTTP, linki nie trafiają do logów serwera ani do odpowiedzi zapraszającego.
   Nie udostępniaj katalogu przez serwer WWW ani Git. Usuwaj zużyte pliki testowe.
4. Na ekranie logowania: **Nie pamiętam hasła** → email → otwarcie linku z testowej
   skrzynki → nowe hasło → ponowne logowanie. Link działa 30 minut i jeden raz.
   Kolejny link unieważnia poprzedni. MFA administratora pozostaje wymagane.
5. **Moje dzieci / Zawodnicy → Kartoteka → Opiekunowie → Zaproś kolejnego opiekuna**.
   Zaproszenie dotyczy jednego dziecka i adresu email, działa 24 godziny.
   Odbiorca otwiera testowy link w osobnym profilu przeglądarki, loguje się lub
   zakłada konto na dokładnie ten email, a następnie potwierdza zaproszenie.
   Konto oczekujące na wcześniejszą aktywację wymaga najpierw linku aktywacyjnego
   od administratora; zaproszenie opiekuna nie przejmuje takiego konta.
6. Opiekunowie mają wspólną kartotekę, grupy i należności tego dziecka. Pozostałe
   dzieci rodzica nie są udostępniane. Każdy opiekun może zaprosić następnego.
   Główny rodzic i administrator mogą cofnąć dostęp dodatkowego opiekuna; dodatkowy
   opiekun może zrezygnować z własnego dostępu. Nie może usunąć głównego rodzica.
   Zaproszenie może cofnąć jego autor, główny rodzic lub administrator.

W testach posiadanie jednorazowego linku zastępuje odbiór wiadomości. Nie jest to
potwierdzenie rzeczywistej skrzynki email. Produkcyjne uruchomienie zaproszeń i
resetu wymaga adaptera wysyłki do wskazanego odbiorcy, konfiguracji domeny i testów
dostarczania. Dotychczasowe ręczne linki aktywacji rodzica/trenera pozostają dostępne.

## Model i zabezpieczenia

- `auth_sessions` pozostaje tabelą sesji. Hasło administratora daje tylko sesję
  ograniczoną do konfiguracji/weryfikacji MFA, ważną 10 minut. `/api/state` i operacje
  administratora zwracają 401 bez powiązania `mfa_verified`. Udane MFA obraca token
  sesji; sesja potwierdzona jest ważna 7 dni. Rodzice i trenerzy zachowują swoje logowanie.
- `admin_mfa` przechowuje klucz zaszyfrowany AES-256-GCM i ostatni użyty krok TOTP.
  Akceptowane jest bieżące okno ±30 sekund, ale nie wcześniej użyty krok.
  `mfa_pending` jest związane z konkretną sesją. Wylogowanie/usunięcie sesji usuwa je
  przez FK CASCADE, tak samo jak znacznik potwierdzonej sesji.
- `mfa_recovery` przechowuje wyłącznie SHA-256 losowych kodów 64-bitowych.
  Użycie jest jednorazowe i transakcyjne, wraz z audytem i wydaniem sesji.
  `mfa_attempts` ogranicza próby do 5 na konto w 15 minut, także po restarcie procesu.
  Istniejący limit 30 żądań autoryzacyjnych/IP/15 minut pozostaje w pamięci procesu.
  Kod zapasowy nie omija blokady prób.
- `password_resets` zawiera hash tokenu, konto, email i termin. Reset ponownie
  sprawdza token po asynchronicznym hashowaniu hasła; zużywa token, kończy sesje,
  unieważnia aktywacje oraz powiązane oczekujące zaproszenia. Nie loguje automatycznie.
  Odpowiedź na zgłoszenie odzyskania hasła jest identyczna dla nieznanego i aktywnego
  adresu. Zablokowane konta nie dostają linków.
- Jedna tabela `athletes` nadal zawiera jedno dziecko. `parent_id` pozostaje głównym,
  dotychczasowym opiekunem. `athlete_guardians` zawiera tylko dodatkowe zaakceptowane
  powiązania; nie oznaczamy starych głównych opiekunów jako nowo zweryfikowanych.
  DTO `guardian_links` łączy oba źródła bez duplikatów. Samo utworzenie zaproszenia
  nie tworzy konta, dziecka ani prawa dostępu.
- `guardian_invitations` wiąże token z dzieckiem, emailem i zapraszającym. Przyjęcie
  wymaga konta rodzica o zgodnym emailu, aktualnego prawa zapraszającego do dziecka
  oraz ważnego tokenu. Nowy link zastępuje poprzedni do tego dziecka/adresu.
  Blokada konta, cofnięcie dostępu i zmiana głównego opiekuna unieważniają odpowiednie
  zaproszenia. Odebrany dostęp jest sprawdzany od następnego żądania.
- Dodatkowy opiekun może edytować dziecko, ale API zachowuje `parent_id` i notatkę
  administratora. Nie może przez formularz przejąć głównej relacji. Trener widzi
  kontakty wszystkich opiekunów dzieci wyłącznie swoich grup; nie ma operacji
  zapraszania ani dostępu do finansów.
- `enrollments.payer_id` zapisuje płatnika w chwili naliczenia. Przy nowym zapisie
  rodzica jest nim zapisujący opiekun; przy zapisie administratora — główny rodzic.
  Istniejące pola `parent/email` są historycznym snapshotem, nie są już zastępowane
  bieżącymi danymi głównego opiekuna podczas odczytu. Zmiana opiekuna nie przepisuje
  należności. Saldo nadal jest przypisane dziecku, bez wspólnego salda rodziny.
- Audyt obejmuje powiązania i zaproszenia bez tokenów oraz zdarzenia MFA/resetu.
  Hasła, klucze TOTP i kody zapasowe nie są zapisywane w audycie. Plikowa skrzynka
  testowa zawiera linki jawnie — nie jest dziennikiem ani przeznaczonym do udostępniania
  raportem. Błąd audytu wycofuje transakcję; ewentualny plik po nieudanej transakcji
  nie pozwala wykorzystać tokenu, którego nie ma w bazie.

## Migracja 3, kopia i wycofanie

Przed uruchomieniem nowej wersji zatrzymaj serwer i wykonaj pełną kopię zgodnie z
[OPERACJE.md](OPERACJE.md). Migracja 3 jest transakcyjna i dodaje powyższe tabele
oraz `payer_id`; nie przebudowuje kont, nie usuwa dzieci/naliczeń, sprawdza FK.
Płatnik starych naliczeń jest dopasowany tylko do jednego rodzica o zgodnym emailu.
Brak jednoznacznego dopasowania pozostawia `payer_id=NULL` i niezmieniony snapshot.
Sesje administratorów sprzed aktualizacji wygasają celowo, aby wymagane było
ponowne podanie hasła i konfiguracja MFA. Sesje rodziców/trenerów są zachowane.
Ponowny start nie powtarza migracji.

Domyślny klucz szyfrowania powstaje przy pierwszej konfiguracji MFA w pliku
`<DB_PATH>.mfa-key`, czyli zwykle `data/evolution.sqlite.mfa-key`, z prawami 0600.
Można ustawić `MFA_KEY_PATH` albo `MFA_ENCRYPTION_KEY` (64 znaki hex = 32 bajty)
poza repozytorium. Priorytet ma zmienna `MFA_ENCRYPTION_KEY`. Nie zmieniaj klucza
po konfiguracji MFA — rotacja wymaga osobnej kontrolowanej procedury.
Przy istniejących danych MFA brak/zły klucz zatrzymuje start; nie tworzymy zastępczego.
Szyfrowanie chroni samą bazę bez klucza, nie chroni przed przejęciem całego serwera.

Narzędzie backupu kopiuje domyślny klucz razem z SQLite, uwzględnia go w sumach
manifestu i odtwarza z 0600 obok `evolution.sqlite`. Dla niestandardowego pliku
podaj `--mfa-key /pełna/ścieżka` lub `MFA_KEY_PATH`. Dla klucza ENV wykonaj osobną
kopię sekretu i użyj `--external-mfa-key`; manifest oznacza wymóg odtworzenia ENV.
Narzędzie odmawia cichego pominięcia brakującego klucza. Kopię całego zestawu
przechowuj zaszyfrowaną poza maszyną. Nie publikuj bazy ani klucza.

Wycofanie: zachowaj stan po aktualizacji, odtwórz kopię sprzed migracji do nowego
katalogu i uruchom poprzedni commit z tą bazą. Nie uruchamiaj starej wersji na
nowej bazie i nie usuwaj ręcznie tabel MFA. Kopia sprzed migracji nie zawiera
późniejszych zaproszeń i zmian danych; trzeba je osobno uzgodnić.

## Pliki i testy

- `security.js`, `auth.js`: TOTP, szyfrowanie, recovery, ograniczone sesje, reset.
- `guardians.js`, `server.js`, `trainers.js`: relacje, autoryzacja rekordów, DTO,
  historyczny płatnik i kontakty w panelu trenera.
- `migrations.js`, `scripts/backup.py`: migracja 3 i pełne odtworzenie MFA.
- `public/index.html`, `app.js`, `brand.css`: ekrany dostępu i zakładka Opiekunowie.
- `test/security.test.js`, `test/security.py`, `e2e/security.spec.js` oraz wspólne
  helpery MFA: brak wyłączenia MFA w środowisku testowym; testy wpisują rzeczywiste kody.

```sh
npm test
python3 test/smoke.py
python3 test/accounts.py
python3 test/public_signup.py
python3 test/foundations.py
python3 test/trainers.py
python3 test/security.py
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Na macOS po `npx playwright install chromium` wystarczy `npm run test:e2e`.
Zakres: 21 testów jednostkowych, 6 skryptów integracyjnych, 3 scenariusze E2E.
Weryfikacja obejmuje RFC 6238, migrację i rollback, MFA/replay/recovery i nowy telefon,
limity po restarcie, reset/wygaśnięcie/blokady, nowego opiekuna, niezgodny adres,
izolację rodzeństwa, cofanie dostępu, kontakty trenera, historię płatnika, audyt bez
sekretów, kopię/odtworzenie klucza oraz odmowę startu z błędnym/brakującym kluczem.
Przeglądarka obejmuje rejestrację zaproszonego rodzica, akceptację, reset i ekran 390 px.
Wszystkie dane testowe i skrzynki powstają w katalogach tymczasowych.

## Odbiór i kolejne etapy

Gotowe lokalnie: obowiązkowe MFA admina, jednorazowe recovery i zmiana telefonu,
reset hasła z dostarczaniem testowym, zaakceptowani dodatkowi opiekunowie,
natychmiastowe cofanie dostępu i utrwalenie płatnika. Moduły dostępu i rodzica nadal
częściowe wobec całej specyfikacji: brak produkcyjnej weryfikacji/wysyłki email,
datowanych uprawnień trenera oraz dalszych funkcji panelu rodzica.
Brak zmian w realnych płatnościach, wysyłkach i danych zewnętrznej produkcji.

Następny zakres: sezony i okresy uczestnictwa, statusy zapisów, obsługa zakończenia
uczestnictwa i prób, potem dziennik obecności. Osobno wdrożenie dostawcy wiadomości,
zgód/regulaminów/SOM i płatności, zgodnie z głównym planem.
