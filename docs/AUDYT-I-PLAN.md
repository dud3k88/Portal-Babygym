> Aktualny zakres po zbiorczej rozbudowie: [AKTUALIZACJA-ZBIORCZA.md](AKTUALIZACJA-ZBIORCZA.md). Poniższy audyt zachowuje historyczny stan początkowy.

# Evolution Academy — audyt i plan rozbudowy

Data: 20.10.2026. Punkt wyjścia: commit `da0170b`. Źródło wymagań:
[SPECYFIKACJA.md](SPECYFIKACJA.md). Dokument opisuje stan zastany i oddzielnie etap 1.
Nie jest deklaracją wdrożenia całej specyfikacji ani gotowości produkcyjnej.
Aktualizacja: wdrożono [etap 2A](ETAP-2A.md) — trzy role i podstawowy panel
trenera — oraz [etap 2B](ETAP-2B.md): MFA, reset hasła i dodatkowych opiekunów
z lokalnym dostarczaniem testowym linków. Poniższe tabele stanu zastanego oraz stanu
po etapie 1 pozostają historycznym punktem odniesienia; bieżące ograniczenia etapu 2
opisują raporty. Produkcyjna poczta i datowane zakresy trenera nadal wymagają wdrożenia.
Wdrożono też [etap 3A](ETAP-3A.md): sezony, statusy/otwieranie zapisów,
kopię ustawień grup, okresy uczestnictwa, rezygnację z końcem miesiąca bez korekty
bieżącej opłaty (decyzja użytkownika) oraz powrót z historią. Pozostałe elementy
etapu 3 opisują kolejne raporty.
Wdrożono [etap 3B](ETAP-3B.md): potwierdzenie kontynuacji próby, osobne naliczenie,
FIFO i rezerwowane oferty z terminem decyzji. Zgody oraz dalsze procesy nadal
pozostają do wykonania.

Dodano [zarządzanie użytkownikami](UZYTKOWNICY.md): listę kont, filtry, tworzenie
kolejnych administratorów z aktywacją i MFA, edycję kontaktu oraz blokady dostępu.

## 1. Stos i działające podstawy

- Node.js 24+, JavaScript ESM, wbudowane `http` i `node:sqlite`; bez frameworka i zależności runtime.
- Jedna SQLite, klucze obce włączone, lokalne pliki `data/logo`. Brak prywatnego storage materiałów.
- `server.js`: bootstrap schematu, stare migracje addytywne, API, DTO i serwowanie plików z listy dozwolonej.
- `auth.js`: scrypt, hashowane tokeny sesji, HttpOnly/SameSite=Strict, Secure konfigurowalne, aktywacje rodziców. Role w bazie: obecnie admin/parent; trener to tylko kartoteka.
- `billing.js`: kwoty całkowite w groszach, wycena bieżącego miesiąca; `schedule.js`: cykle i wykluczenia, lokalny czas Europe/Warsaw. Brak interpretowania dat finansowych jako UTC.
- `public/index.html` + `app.js`: widoki hash, dialogi, administracja i panel rodzica. `/zapisy` + osobny JS: publiczny formularz. `brand.css`: wspólne fonty i kolory, fonty lokalne. Listy z filtrami i paginacją w przeglądarce.
- Dane: users → athletes (jeden parent_id); groups ↔ athletes przez memberships; enrollments to faktycznie miesięczne należności, NIE członkostwa; enrollment_sessions zachowuje uzgodnione ceny terminów; adjustments to korekty, NIE wpłaty.
- Brak hostingu produkcyjnego, reverse proxy, CI, schedulerów i integracji zewnętrznych w repo. `npm ci`, `npm run dev`/`npm start`. GitHub przechowuje kod; nie bazę i logo.
- Testy bazowe: 14 jednostkowych, 3 scenariusze integracyjne Python (smoke, accounts, public_signup); wszystkie przeszły przed zmianami. Brak utrwalonego w repo zestawu przeglądarkowego E2E na starcie audytu.

## 2. Macierz modułów — stan przed etapem 1

| Moduł | ISTNIEJE / DZIAŁA CZĘŚCIOWO | BRAKUJE | WYMAGA REFAKTORU |
|---|---|---|---|
| 1. Dostęp | Konta admin/parent, hasła, sesje, izolacja dzieci, limit prób, aktywacja | Trener, obowiązkowe MFA admina, reset/weryfikacja email, wielu zweryfikowanych opiekunów, blokady kont, historia dostępu | Dwie role w CHECK users, jeden parent_id; DTO /state zawiera nadmiernie szeroki grafik/wykluczenia |
| 2. Placówki, grupy, sprzęt | ID i unikalne nazwy placówek; grupy, limit, trenerzy, grafik; atomowe zapisy i próby | Adres/kontakt/status placówki, najem, sprzęt; statusy/sezony/wiek/opis/cenniki grup; lista rezerwowa; transfery, łączenie/dzielenie, rezygnacje, datowani trenerzy, eksport | Aktualne edycje bez pełnego audytu; group_trainers bez okresów; brak historii członkostwa |
| 3. Uczestnicy i zapisy | Jedna kartoteka, rodzic, notatki admina, wyszukiwanie i filtry, publiczny formularz, rodzeństwo z panelu | Dodatkowi opiekunowie, walidacja wieku, pola własne, linki grup, WordPress embed, import/eksport, scalanie, wersjonowane zgody/regulamin/SOM | Dowolne zmiany parent_id przenoszą dostęp bez audytu; legacy scalanie po nazwie; brak oddzielenia historycznego płatnika |
| 4. Kalendarz/obecność | Cykliczne terminy, lokalne daty, wykluczenia globalne/lokalne/grupowe, korekty opłat | Kalendarz dzień/tydzień/miesiąc, obecność, realizacja, korekty z audytem, zastępstwa, konflikty, brakujące listy | Edycja serii tylko wszystkich przyszłych dat, brak zakresu „od daty”; brak rozdziału planu i realizacji |
| 5. Rodzic | Własne dzieci, grupy, przyszłe daty, naliczenia i korekty, zapisy | Drugi opiekun, dane kontaktowe, reset, pulpit, rezygnacje, nieobecności, wpłaty, powiadomienia, postępy, zgody/SOM | Informacja „nadpłata” obecnie wynika wyłącznie z ujemnych korekt; nie dowodzi wpłaconej gotówki |
| 6. Rozliczenia | Wycena pozostałych terminów, cena próby, naliczenia, ręczne/automatyczne korekty, filtry | Miesięczny job, wpisowe, rabaty, VAT, cenniki, terminy płatności, wpłaty i alokacje, operator, import banku, zwroty i wezwania | Brak unikalności naliczenia w bazie; legacy nazwa enrollments myląca; sumowanie korekt to nie pełna księga płatności |
| 7. Kadry | Kartoteki trenerów, przypisanie do grup | Logowanie trenera, dostęp per grupa, statusy/współpraca, dyspozycyjność, zastępstwa, stawki, rozliczenia i zamknięcia | Trenerzy oddzieleni od users; przypisania bez okresów |
| 8. Komunikacja | Brak dostawcy, ręczne przekazanie linku aktywacyjnego | Outbox, szablony, SMS/email, terminy, powiadomienia, wątki, koszt/status/retry/idempotencja, zgody marketingowe | Nie podłączać wysyłki bez modelu odbiorców, aktualnych zgód i deduplikacji |
| 9. Finanse/raporty | Liczba grup, lokalizacji, uczestników; suma naliczeń | Wpływy, koszty/najem/płace/podatki, rentowność, prognozy, KPI, kreator, eksport/import, snapshoty | Nie używać salda jako przychodu lub gotówki; paginacja /state nadal tylko frontend |
| 10. Metodyka | Brak | Programy, PDF/konspekty, prywatny storage, oceny, publikacja, materiały, dyplomy, karty/pieczątki | Wymaga dostępu trenera i potwierdzonych obecności; nie tworzyć drugiej kartoteki dziecka |

## 3. Konflikty i ryzyka

1. Nowa specyfikacja zabrania przenoszenia całej grupy do innego przedszkola, a obecny edytor to umożliwia. Etap 1 blokuje nowe takie zmiany po stronie API; stare terminy i lokalizacje pozostają zachowane.
2. Dotychczas konfigurowalne płatne próby, teraz specyfikacja wymaga darmowych. Nie zmieniać historycznych kwot. Docelowo nowe próby 0, z osobnym wdrożeniem procesu konwersji; etap 1 nie przelicza starych opłat.
3. Brak umarzania kontra dowolna ujemna korekta: zachować dopuszczone rabaty/korekty, później rozdzielić typy i uprawnienia. Nie usuwać historii.
4. Dokładnie trzy role docelowe: admin/trainer/parent. Nie dodawać innych. Obecny CHECK dwóch ról wymaga kontrolowanej migracji users, FK i sesji, nie edycji sqlite_master. Do czasu pełnej autoryzacji trenera nie otwierać dla niego API rodzica.
5. Legacy startup odtwarza członkostwa z należności przy każdym uruchomieniu. Należy zakończyć to jednorazowym znacznikiem, zanim wdrożymy rezygnacje.
6. Obecny płatnik wynika z bieżącego parent_id dziecka. Migracja musi utrwalić historycznego płatnika; drugi opiekun nie może automatycznie przepisać rozliczeń.
7. /api/state pobiera całość danych do pamięci; filtry/paginacja frontend nie rozwiązują wzrostu bazy. Etap 1 ogranicza DTO rodzica; kolejne etapy wydzielają paginowane endpointy, indeksy i limity odczytu.
8. Audit DB zapewni append-only dla aplikacji, ale właściciel pliku SQLite może go zmienić. Produkcja potrzebuje odseparowanego użytkownika DB i kopii dziennika poza hostem. Nie nazywać tego kryptograficzną niezmiennością.
9. Dokładne reguły VAT, premii, rezygnacji i prawne dokumenty muszą pochodzić od organizatora. Brak tych danych nie uprawnia do wymyślania stawek/regulaminu/SOM.
10. SQLite wystarcza do bieżącego pojedynczego procesu. PostgreSQL rozważyć przed wieloma workerami/hostami i masową komunikacją, po pomiarach; nie wymaga przepisywania frontendu.

## 4. Docelowy model i przepływy

Nazwy istniejących tabel zachowujemy. Nie tworzymy osobnej bazy ani drugiej aplikacji.

| Obszar | Encje i relacje / niezmienniki |
|---|---|
| Tożsamość | users (3 role, status, MFA), auth_sessions, jednorazowe reset/invite; parent_child_access(user_id, athlete_id, verified_at, revoked_at), bez równoległej kartoteki rodzica; athletes pozostaje dzieckiem |
| Placówki | locations ze statusem i kontaktem; trainers.user_id; datowane trainer_assignments, seasons; groups.location_id stałe, group_schedules i sessions (termin) |
| Uczestnictwo | memberships jako bieżący stan, membership_events/okresy dla historii; waitlist z kolejnością created_at,id, oferty z expiry i atomowym zajęciem miejsca |
| Dziennik | attendance(session_id, athlete_id) UNIQUE; historia korekt i rodzicielskie absence_reports; realizacja sesji i zatwierdzenie; substitutions i availability |
| Naliczenia | enrollments jako miesięczne charges (API zgodne wstecz); pozycje per termin + wpisowe, price_versions, rabaty i VAT; UNIQUE klucza naliczenia. adjustments append-only z typem i autorem |
| Gotówka | payments(provider,event_id UNIQUE), payment_allocations(payment_id,charge_id), refunds; płatnik utrwalony na należności; zweryfikowany callback, nigdy return URL |
| Wynagrodzenie/koszty | wage_rates z datami, wage_settlements/items, bonus_rules; zatwierdzone realizacje → koszt. rent_rules i shared_rent_blocks UNIQUE(location_id,interval,rule); costs i osobne zobowiązania podatkowe |
| Sprzęt | equipment, equipment_transfers, inventories/items z ilościami; bez wartości/zakupów/QR |
| Komunikacja | conversations/messages, templates, outbox/jobs (dedupe_key UNIQUE), notifications, delivery_attempts; zgody sprawdzane również przy wysłaniu; zakaz trainer→parent |
| Dokumenty | policy_documents z wersją i treścią od organizatora; consent_events i SOM acknowledgements; odwołanie zgody append-only |
| Metodyka | programs/skills, lesson_plans + private_assets z ACL, assessments + publication; adventure_cards/stamps UNIQUE(attendance_id,card_id); korekta obecności odwołuje pieczątkę |
| Raporty | imports z fingerprint pliku i wiersza, report_snapshots, audit_logs; raporty wyprowadzone z powyższych źródeł, bez drugich sald |

Przepływ: uprawnienia → placówka/grupa/termin → zapis → naliczenia → wpłaty/alokacje.
Termin → obecność/realizacja → płace i karty przygody. Płace + najem + koszty oraz
naliczenia/wpłaty → raporty. Zdarzenia domenowe → outbox → powiadomienia.
Metodyka korzysta z tych samych dzieci, grup, sezonów i obecności.

### Formuły planowanych raportów

- Obłożenie na datę: aktywne/próbne członkostwa zajmujące miejsce ÷ limit ×100%; administracyjne przekroczenia mogą dać >100%. Unikalni uczestnicy placówki/firmy: COUNT DISTINCT athlete_id, nie suma grup.
- Frekwencja: obecności ÷ (obecności + nieobecności) w zrealizowanych terminach; nieuzupełnione listy raportować osobno, próby wliczane i możliwe do filtrowania.
- Rezygnacje: skuteczne zakończenia uczestnictwa w okresie (osobno unikalne dzieci i uczestnictwa). Retencja: dzieci z kohorty aktywnej na początku, nadal aktywne na końcu ÷ dzieci w tej kohorcie; wyłączyć nowych z mianownika.
- Konwersja prób: unikalne dzieci po odbytej próbie, które uzyskały regularny zapis w skonfigurowanym oknie obserwacji ÷ dzieci z odbytymi próbami o zakończonym oknie; długość okna wymaga ustawienia.
- Przychód należny: pozycje zajęć + wpisowe − rabaty + korekty przychodu. Wpływy: potwierdzone wpłaty − wykonane zwroty, osobno; alokacja wpłaty nie tworzy przychodu.
- Saldo należności: naliczenie + korekty − alokowane wpłaty + odwrócone alokacje. Zaległość: dodatnia pozostałość po terminie płatności; bez terminu nie oznaczać jako przeterminowane.
- Wynik operacyjny: przychód netto − koszty operacyjne netto (z właściwym uwzględnieniem VAT nieodliczalnego); marża: wynik/przychód, przy 0 przychodu „nie dotyczy”. ZUS/podatki w osobnej ewidencji obciążeń, bez drugiego odjęcia kosztów.
- Próg rentowności: ceil(koszty stałe przypisane / (przychód jednostkowy uczestnika − koszt zmienny uczestnika)); przy niedodatnim mianowniku brak skończonego progu. Parametry jawne, wspólny najem liczony raz; brak automatycznego rozdziału kosztów ogólnych.
- Prognozy jawnie oznaczone; wynikają z aktywnych zapisów, cen, przyszłych terminów i znanych kosztów. Nie są wpływami ani zamkniętym raportem.

## 5. Kolejność i odbiór etapów

| Etap | Zakres i zależności | Kryterium ukończenia |
|---|---|---|
| 1 — realizowany teraz | Wersjonowanie migracji, kopia/odtworzenie, audyt domeny, blokada kont rodziców, DTO, adresy/status placówek; bez zmiany historycznych opłat | Stara baza i restart bez utraty danych; blokada kończy sesje; audyt z autorem i rollbackiem; rodzic bez prywatnych notatek placówki; zamknięcie zapisów placówki egzekwowane przez API |
| 2 — dostęp | 3 role, MFA admina z recovery, zweryfikowane zaproszenia opiekunów/reset, konto trenera i datowane zakresy; zależne od 1 | Testy macierzy rekordów, unieważniania sesji i MFA; brak trener→rodzic. Brak publicznego wdrożenia bez ukończenia |
| 3 — uczestnictwo | Sezony, statusy grup, ceny datowane, darmowe próby/konwersja, waitlist, okresy, rezygnacje, przenoszenie dzieci, split/merge, import/eksport; zgody/SOM | Ostatnie miejsce atomowe; ponowienie nie powiela zapisu; powrót zachowuje kartotekę i historię |
| 4 — kalendarz | Dziennik i realizacja, korekty, nieobecności, zastępstwa, konflikty; zależne od 2–3 | Jedna obecność dziecko/termin, audyt zmian, prawa trenera, korekty opłat przy odwołaniu |
| 5 — finanse dziecka | Księga naliczeń, automat miesięczny, wpisowe, rabaty, VAT, wpłaty/alokacje/import, jeden operator w sandbox, zwroty | Testy 3/4/5 terminów, środka miesiąca, idempotencji naliczeń/webhooków/importu i częściowej wpłaty |
| 6 — komunikacja/rodzic | Outbox, SMS/email adapter testowy, centrum wątków, automatyzacje, dashboard; zależne od 2–5 | Podgląd, ponowna kontrola długu/zgód, dedupe, jawny sandbox, zero realnych wysyłek w testach |
| 7 — kadry/sprzęt | Stawki, dostępność, wynagrodzenia z realizacji, zatwierdzenia, sprzęt i transfery | Koszt tylko z potwierdzonego wykonania i reguł; własna wypłata trenera; historia ilości |
| 8 — raporty | Najem, koszty/podatki, KPI i trendy, eksport/import, snapshoty i korekty | Wspólny blok nie nalicza się dwukrotnie; wpływy≠przychód; niezmienny zamknięty snapshot |
| 9 — metodyka | Import PDF bez przepisywania, programy, prywatne pliki, publikacja ocen i materiały, karty/PDF | Uprawnienia plików, rodzic tylko opublikowane dane, pieczątka z obecności raz i odwołanie przy korekcie |
| 10 — wdrożenie | Pełne E2E, obciążenie, retencja, odtworzenie, monitoring, konfiguracja produkcyjna | Wszystkie 13 scenariuszy specyfikacji, udokumentowane limity i decyzja o operatorach/hostingu |

## 6. Migracje bez utraty danych

Nowe migracje w rejestrze schema_migrations, transakcyjne i ponawialne. Etap 1:
addytywne pola locations/users, tabela audit_logs, indeksy i triggery. Stare
backfille zachowują działanie przy pierwszej migracji, potem nie odtwarzają zapisów.
Każdy następny etap: kopia → odtworzenie na izolowanej bazie → kontrola FK,
liczebności, identyfikatorów, sum groszy → testy → kontrolowana aktualizacja.

Późniejsza zmiana CHECK users na trzy role wymaga osobnej migracji z planem
odtworzenia FK i sprawdzeniem sesji. Wielu opiekunów: backfill każdego parent_id
jako istniejącego opiekuna, zachowanie starego pola jako kompatybilności, stopniowe
przeniesienie kontroli dostępu; bez automatycznego uznawania nowego emaila za opiekuna.
Unikalne naliczenia: najpierw raport duplikatów; nie usuwać/scalać ich automatycznie.
Nie usuwać starych tabel/kolumn przed końcem okresu zgodności i akceptacją migracji.

Procedura kopii/wycofania: [OPERACJE.md](OPERACJE.md). Nie ma automatycznego downgrade
ani destrukcyjnego odtwarzania do istniejącej bazy.

## 7. Konfiguracje wymagane później

Dziś używane: HOST, PORT, DB_PATH, LOGO_PATH, COOKIE_SECURE. W testach wyłącznie
EA_TEST_NOW przez jawny loader fixed-clock, nie konfiguracja produkcji.
Planowane nazwy (jeszcze nie odczytywane przez aplikację): APP_BASE_URL,
MFA_ENCRYPTION_KEY, PAYMENT_PROVIDER, PAYMENT_MODE, PAYMENT_MERCHANT_ID,
PAYMENT_API_KEY, PAYMENT_WEBHOOK_SECRET, SMTP_HOST/PORT/USER/PASSWORD/FROM,
SMS_PROVIDER/API_KEY/SENDER, STORAGE_BUCKET/ENDPOINT/ACCESS_KEY/SECRET_KEY,
WORKER_MODE. Sekrety wyłącznie env/menedżer sekretów, nigdy repo/UI publiczne.

Operator płatności nie został wybrany: potrzebne aktualne oferty opłat,
umowa firmy, metody dostępne w Polsce, warunki zwrotów i sandbox. Ocenić P24/PayU/
Tpay/Stripe; wdrożyć jeden adapter i jawny test provider. Apple/Google Pay przez
operatora, brak przechowywania kart i automatycznych subskrypcji. Brak kluczy nie
blokuje budowy księgi i testów kontraktu, blokuje rzeczywiste transakcje.
Wysyłka: domena nadawcy/DNS i dostawca SMS; domyślnie sandbox, żadnych prawdziwych
wiadomości rodzicom. WordPress: publiczny link najpierw, embed i allowlist domen
po ustaleniu konfiguracji. Private assets nigdy pod publicznym katalogiem statycznym.

## 8. Checklista odbioru

Status modułów po etapie 1 (zakres odbioru nadal szeroki):

| Moduł | Status | Uzasadnienie / brak do pełnego odbioru |
|---|---|---|
| 1 | CZĘŚCIOWO | Konta i blokada rodzica, audyt; BRAKUJE MFA, trenerów, resetu i wieloopiekuńczości |
| 2 | CZĘŚCIOWO | Kartoteka i status placówki, istniejące grupy; BRAKUJE najmu, sprzętu, statusów/sezonów i operacji grup |
| 3 | CZĘŚCIOWO | Kartoteka, filtry i zapisy; zgody/SOM ZABLOKOWANE w zakresie treści organizatora, mechanizmu jeszcze BRAKUJE |
| 4 | CZĘŚCIOWO | Terminy i wykluczenia; BRAKUJE dziennika, realizacji, zastępstw |
| 5 | CZĘŚCIOWO | Dzieci i saldo naliczeń; BRAKUJE większości procesów rodzica |
| 6 | CZĘŚCIOWO | Naliczenia/korekty; BRAKUJE księgi wpłat i automatu; realny operator ZABLOKOWANY wyborem/kluczami |
| 7 | CZĘŚCIOWO | Same profile/przypisania; BRAKUJE kadrowych procesów i rozliczeń |
| 8 | BRAKUJE | Brak adapterów/outbox/wątków; realne kanały ZABLOKOWANE konfiguracją |
| 9 | BRAKUJE | Proste liczniki nie spełniają raportów finansowych; reguły podatkowe/premii wymagają danych |
| 10 | BRAKUJE | Brak biblioteki/ocen/kart/storage; projekty kart i istniejące PDF do późniejszego importu |

GOTOWE można przypisać wyłącznie konkretnym elementom etapu 1 po testach
opisanych w [ETAP-1.md](ETAP-1.md). Żaden z 10 modułów nie jest w całości GOTOWY.

Wszystkie wyłączenia ze specyfikacji pozostają wiążące: brak faktur, odrabiania,
odbioru dzieci, dodatkowych ról, rodzinnego salda, automatycznych subskrypcji,
rankingu dzieci, przenoszenia całej grupy do innej placówki i pozostałych wyłączonych
funkcji. Nie są backlogiem do dorobienia „przy okazji”.
