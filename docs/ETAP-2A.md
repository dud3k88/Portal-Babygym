# Etap 2A — dostęp i panel trenera

Kontynuacja etapu 1. Zakres: trzy role w bazie, konto i status trenera, aktywacja,
grafik i zawodnicy tylko przypisanych grup, kontakt do rodziców, osobne notatki
trenera, audyt i testy uprawnień. MFA, reset hasła i drugi opiekun pozostają etapem
2B; nie oznaczać całego etapu 2 jako ukończonego.

## Plan migracji 2 i odtworzenia

SQLite wymaga przebudowy tabeli users, aby rozszerzyć CHECK do dokładnie
admin/trainer/parent. Nie zmieniamy identyfikatorów ani nie kasujemy kont:
1. Sprawdzenie znanego schematu i integralności FK. Nietypowy schemat zatrzymuje migrację.
2. Automatyczny spójny snapshot SQLite obok pliku DB, z nazwą `.before-v2-…sqlite`
   i prawami 0600. Brak możliwości utworzenia kopii przerywa migrację.
3. Poza transakcją wyłączamy FK wyłącznie na czas przebudowy; transakcja kopiuje
   wszystkie pola kont, zastępuje definicję tabeli i odtwarza jej indeksy/triggery.
4. Porównanie wszystkich rekordów kont przed/po i PRAGMA foreign_key_check przed
   COMMIT. Błąd wycofuje całość, FK zostaje ponownie włączone w finally.
5. Nowe kolumny trainers.user_id (unikalne powiązanie) i status; osobna tabela
   trainer_notes. Audyt tych powiązań i statusów. Rejestr wersji 2 zapobiega powtórzeniu.

Przed aktualizacją na komputerze z danymi zatrzymaj serwer i wykonaj również pełną
kopię z logo wg OPERACJE.md. Automatyczna kopia migracji obejmuje bazę, nie logo.
Nie uruchamiamy migracji na zewnętrznej produkcji z tego zadania; testy wyłącznie
na bazach tymczasowych. Powrót: zatrzymać serwer, zachować stan po aktualizacji,
odtworzyć kopię do NOWEGO katalogu, uruchomić kod etapu 1 z tamtą bazą. Nie cofać
ról trenerów do rodziców i nie uruchamiać starego kodu na zaktualizowanej bazie.

## Zasady dostępu

- Tylko administrator tworzy konto powiązane z istniejącym profilem trenera.
  Email musi być unikalny w users; nie przejmujemy istniejącego konta rodzica.
- Administrator przekazuje jednorazowy link aktywacyjny ważny 24h. To nie jest
  automatyczna wysyłka email i nie jest weryfikacją domeny/skrzynek.
- Status nieaktywny/archiwalny blokuje logowanie, usuwa sesje i zaproszenia.
  Ponowna aktywacja nie wskrzesza starych sesji. Historia pozostaje.
- /api/state dla trenera ma osobne DTO: własne grupy, terminy, lokalizacje, dzieci,
  kontakt do ich rodziców i własne notatki. Bez sald, korekt, notatek administratora,
  cudzych grup/dzieci/profili trenerów, audytu i powodów dni wolnych.
- Trener nie może tworzyć/zmieniać grup, zapisywać dzieci, zmieniać cen/rodziców,
  czytać audytu ani wywoływać komunikacji z rodzicami. Backend odmawia takich operacji.
- Odebranie przypisania do grupy natychmiast odbiera odczyt jej danych i zapis notatek.
  Statusy uczestnictwa aktywny/próbny wyznaczają listę dzieci; brak rozszerzania
  dostępu przez inne grupy tego samego dziecka.
- Notatki trenera: autor + dziecko, zapis wyłącznie w swoim aktualnym zakresie;
  administrator ma podgląd, rodzic nigdy. Brak plików w kartotece.

To działający pierwszy zakres panelu trenera. Obecności, zatwierdzanie realizacji,
datowane przypisania, zastępstwa, dyspozycyjność, płace i metodyka są dalszymi etapami.

## Wdrożone pliki i użycie

- `migrations.js`: migracja 2 z kopią przed przebudową, kontrolą danych/FK i rollbackiem;
  `.gitignore` wyklucza automatyczne kopie z repozytorium.
- `trainers.js`: odrębne DTO i sprawdzanie zakresu trenera, edycja profilu,
  tworzenie konta i własne notatki.
- `auth.js`, `server.js`: dokładnie trzy role, aktywacja trenera, blokowanie kont,
  endpointy administratora i ograniczony zestaw operacji trenera.
- `public/app.js`, `public/index.html`: edycja profilu, Utwórz konto / Nowy link
  aktywacyjny, panel Mój grafik i grupy, wybór grupy/miesiąca, kontakt do rodziców
  i notatki. Administrator widzi notatki trenera w danych zawodnika.
- `public/brand.css`: wspólna strzałka select z odstępem 16 px od prawej krawędzi
  i paddingiem 44 px na tekst; obejmuje panel i /zapisy. Natywne sterowanie
  klawiaturą pozostaje, tryb wymuszonego kontrastu używa natywnej strzałki.
- `test/trainer-migration.test.js`, `test/trainers.py`, `e2e/trainers.spec.js`:
  testy migracji, bezpieczeństwa i rzeczywistego procesu w przeglądarce.

Administrator: **Trenerzy → Dodaj trenera → podaj email → Utwórz konto**.
Przekaż link właściwemu trenerowi, który ustawi hasło. Przypisz go do grup przez
istniejącą funkcję zmiany prowadzących. Po zalogowaniu zobaczy Mój grafik i grupy.
Zmiana emaila powiązanego konta kończy jego sesje i unieważnia zaproszenia;
zmiana na adres istniejącego konta jest odrzucana bez zmiany profilu.
Nieaktywny/archiwalny status zachowuje historyczne przypisania — nie ustawia
zastępstwa ani nie odwołuje automatycznie zajęć.

## Weryfikacja

```sh
npm test
python3 test/smoke.py
python3 test/accounts.py
python3 test/public_signup.py
python3 test/foundations.py
python3 test/trainers.py
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Na macOS po `npx playwright install chromium` użyj zwykłego `npm run test:e2e`.
Oczekiwany zestaw: 18 testów jednostkowych (w tym udana i nieudana migracja oraz
nieznany schemat), 5 skryptów integracyjnych, 2 scenariusze przeglądarkowe.
Test uprawnień obejmuje także dziecko w dwóch grupach różnych trenerów — dostęp
do tego dziecka nie ujawnia trenerowi jego innej grupy, innych trenerów ani
ich notatek. Ponowienie utworzenia konta nie duplikuje users, nowy link unieważnia
poprzedni; nie można przejąć rodzica przez ten sam email. Odebranie grupy lub
statusu odbiera dostęp od następnego żądania. Restart zachowuje konta i notatki.
Kopia sprzed migracji zachowuje poprzedni schemat i nie jest tworzona ponownie.
E2E obejmuje aktywację, notatkę, blokadę, panel administratora i telefon 390 px.

## Status odbioru

GOTOWE w tym etapie: trzy role w bazie; konto, aktywacja, status i zakres trenera;
własny grafik i listy dzieci; kontakt do rodziców; osobne notatki; audyt; poprawione
strzałki. CZĘŚCIOWO: moduły 1 i 7, ponieważ brak MFA/resetu/wieloopiekuńczości,
datowanych przypisań, zastępstw, obecności, dyspozycyjności i wynagrodzeń.
Komunikacja trener→rodzic pozostaje zabroniona. Nie dodano ról koordynatorów.

Następny etap 2B: MFA Administratora z recovery, odzyskiwanie hasła i zweryfikowane
zaproszenia drugiego opiekuna. Następnie sezony/statusy/okresy uczestnictwa i dziennik
obecności. Realne wysyłki i płatności nie są skonfigurowane. Zmiany tego etapu
nie oznaczają gotowości całej aplikacji do produkcji.
