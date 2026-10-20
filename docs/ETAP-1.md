# Etap 1 — fundamenty i placówki

## Wdrożone

- **GOTOWE:** migracja `1` w `migrations.js`, rejestr `schema_migrations`,
  transakcja i addytywne pola. Dotychczasowe backfille kartotek/członkostw są
  jednorazowe, więc przyszła rezygnacja nie zostanie odtworzona z należności po restarcie.
- **GOTOWE:** placówka: ID, nazwa, adres, miejscowość, telefon, email, kontakt,
  notatki administratora, aktywna/wstrzymana/archiwalna. Formularz edycji, filtr
  statusu, grupy, unikalni zawodnicy i przypisani trenerzy na liście.
  Wstrzymanie/archiwizacja blokuje nowe grupy i zapisy, również API publiczne.
  Wznowienie otwiera zapisy. Nie odwołuje automatycznie istniejących terminów i
  nie zmienia ich opłat; to osobna operacja na kalendarzu.
- **GOTOWE:** zakaz nowych przenosin całej grupy do innej placówki. Pole lokalizacji
  w edycji jest zablokowane; API sprawdza ten sam warunek. Dawne dane zachowane.
- **GOTOWE:** blokowanie/odblokowanie konta rodzica z kartoteki dziecka, zakładka
  Rodzic. Blokada kończy wszystkie sesje i unieważnia zaproszenia, zamyka login
  i aktywację. Odblokowanie wymaga nowego logowania; nie przywraca starych tokenów.
  Ten endpoint nie zmienia administratorów ani ról.
- **GOTOWE:** dziennik insert/update/delete danych domenowych: users (bez sekretów),
  athletes, locations, groups, sessions, memberships, enrollments,
  enrollment_sessions, adjustments, exclusions, trainers, group_trainers.
  Triggery zapisują autora, ID żądania, stare/nowe wartości i czas UTC;
  interfejs pokazuje czas Europe/Warsaw. W tej samej transakcji co zmiana.
  Nieudana transakcja nie pozostawia pozornego wpisu. Audyt nie notuje UPDATE
  niezmieniającego wartości. Rejestruje także rozpoczęcie/koniec sesji, tworzenie
  zaproszenia i aktywację konta. Dziennik nie obejmuje nieudanych prób logowania,
  odczytów ani zmian samego pliku logo — nie twierdzimy, że jest pełnym SIEM.
- **GOTOWE:** widok „Dziennik zmian” tylko dla Administratora, API stronicowane
  kursorem po 50. SQL blokuje UPDATE/DELETE dziennika; brak endpointów usuwania.
  Właściciel pliku DB nadal może ingerować — zewnętrzne archiwum audytu to kolejny etap.
  Historycznym zmianom sprzed wdrożenia nie przypisujemy wymyślonych autorów.
- **GOTOWE:** rodzic nie dostaje notatek/kontaktów wewnętrznych placówki ani
  powodów wykluczeń. Dostaje własne historyczne grupy i ofertę aktywnych placówek;
  historyczne terminy cudzych grup są odfiltrowane. Dostęp dziecka nadal przez
  obecne parent_id; wieloopiekuńczość nie jest jeszcze zaimplementowana.
- **GOTOWE:** `scripts/backup.py`: snapshot SQLite, opcjonalne logo, manifest,
  sprawdzenie hashy/integralności/FK/liczebności, restore tylko do nowego katalogu.
  Istniejącego katalogu nie można nadpisać. Instrukcja wycofania w OPERACJE.md.

## Pliki

Backend: `server.js`, `auth.js`, nowe `migrations.js`, `audit.js`.
Interfejs: `public/index.html`, `public/app.js`, `public/brand.css`.
Operacje: `scripts/backup.py`, `.gitignore`.
Testy: `test/audit.test.js`, `test/foundations.py`, rozszerzony `test/smoke.py`,
`e2e/foundations.spec.js`, `playwright.config.js`, package.json/lock.
Dokumenty: SPECYFIKACJA, AUDYT-I-PLAN, OPERACJE i ten raport; README z linkami.

## Testy

- `npm test`: 15 testów, w tym separacja autorów audytu między równoległymi
  żądaniami z `await`, daty, wycena, wykluczenia i polska strefa czasu.
- `python3 test/smoke.py`: migracja starej bazy, zachowane ID/hashe/sesja istniejącego
  rodzica, saldo starego zapisu, wykluczenia, nazwy, trenerzy, logo i restart.
- `python3 test/accounts.py`: izolacja rodzin, notatki administratora, aktualizacja
  grup, ceny/korekty i aktywacja.
- `python3 test/public_signup.py`: publiczny zapis, prywatność DTO, ostatnie miejsce,
  brak kont/dzieci po rollbacku, bieżący miesiąc i próba.
- `python3 test/foundations.py`: pełny cykl statusów, odmowa zapisów po archiwizacji,
  blokada/unieważnienie sesji i zaproszeń, zakaz dostępu rodzica do audytu, audyt
  z właściwym autorem bez sekretów, wymuszony błąd w środku transakcji z rollbackiem
  danych/dziennika, 50-wpisowa paginacja, restart bez duplikacji, snapshot/restore,
  zachowane saldo/sesja, zakaz nadpisania i wykrywanie uszkodzonej kopii.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: przeglądarka tworzy placówkę,
  rodzic przechodzi faktyczny formularz zapisów, admin blokuje i odblokowuje konto,
  archiwizuje placówkę, przegląda dziennik; szerokość 390 px i brak błędów JS.

Playwright jest zależnością wyłącznie deweloperską. Na macOS:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

Test tworzy i usuwa wyłącznie własny tymczasowy katalog, baza testowa na porcie 3142.
Nie wymaga podłączenia operatorów ani dostępu do rzeczywistych danych.

## 13 scenariuszy odbioru całego produktu

| # specyfikacji | Status po etapie 1 | Dowód / brak |
|---|---|---|
| 1 | CZĘŚCIOWO | Izolacja rodziców przetestowana; brak drugiego opiekuna |
| 2 | BRAKUJE | Nie ma konta/zakresu dostępu trenera |
| 3 | CZĘŚCIOWO | Atomowy limit w dotychczasowych testach; brak override i waitlist |
| 4 | BRAKUJE | Brak procesów przenosin/łączenia/rezygnacji/powrotu |
| 5 | CZĘŚCIOWO | Cykl, DST i wykluczenia testowane; brak edycji pojedynczego terminu/konfliktów |
| 6 | BRAKUJE | Brak obecności, realizacji i pieczątek |
| 7 | CZĘŚCIOWO | Bieżący miesiąc/środek/próba/korekta; brak wpisowego, automatu i przenoszenia korekt |
| 8 | BRAKUJE | Brak wpłat/webhooków/importu bankowego |
| 9 | BRAKUJE | Brak wynagrodzeń i realizacji zajęć |
| 10 | BRAKUJE | Brak kosztów najmu i raportów finansowych |
| 11 | BRAKUJE | Brak masowych upomnień i kolejek |
| 12 | BRAKUJE | Brak postępów i prywatnego storage PDF |
| 13 | BRAKUJE | Audyt zmian istnieje, ale brak snapshotów raportów i zamykania miesiąca |

## Dalej

Najbliższy etap: bezpieczna migracja do dokładnie admin/trainer/parent, obowiązkowe
MFA admina, odzyskiwanie hasła, zweryfikowane zaproszenia drugiego opiekuna, zakresy
trenera i testy dostępu. Obecny schemat nadal ma tylko admin/parent; nie dodano roli
trenera „na papierze” bez jej backendowego zakresu. Brak MFA jest blokadą gotowości
produkcyjnej, a nie opcjonalną funkcją. Pełny plan i zależności: AUDYT-I-PLAN.md.

Nie wdrożono jeszcze rzeczywistych wpłat, automatycznej komunikacji, obecności,
wynagrodzeń, raportów i metodyki. Etap 1 nie zmienia historycznych cen prób,
nie dodaje fakturowania ani żadnych innych funkcji wyłączonych przez specyfikację.
