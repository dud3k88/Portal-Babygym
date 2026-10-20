# Etap 3A — sezony, statusy grup i rezygnacja na koniec miesiąca

Zakres tego etapu: sezony, kontrola zapisów, kopiowanie ustawień grup,
okresy udziału, rezygnacja i powrót. Obowiązuje decyzja użytkownika:
**rezygnacja z końcem bieżącego miesiąca; opłata za ten miesiąc pozostaje**.
Nie jest to ukończenie całego modułu uczestnictwa ze specyfikacji.

## Użycie

- **Sezony → Dodaj sezon**: nazwa, data od/do, status aktywny/archiwalny.
  Sezony mogą mieć zachodzące na siebie daty; nie zakładamy jednego sezonu
  wspólnego dla wszystkich rodzajów zajęć.
- **Grupy → lokalizacja → grupa → Status i zapisy**: sezon, status
  planowana/aktywna/wstrzymana/zakończona oraz przełącznik otwarcia zapisów.
  Ten formularz nie przesyła grafiku ani cen i nie powoduje ich przebudowania.
  Te same pola są dostępne przy tworzeniu/pełnej edycji grupy.
- Zapisy wymagają aktywnej lokalizacji, aktywnej grupy, otwartego przełącznika
  oraz aktywnego sezonu obejmującego dzisiejszą datę w Polsce. Grupy bez sezonu
  zachowują dotychczasowe działanie. Sam status „aktywny” sezonu nie pozwala
  zapisać się przed jego rozpoczęciem. Nadal można zapisać się wyłącznie teraz,
  na pozostałe zajęcia bieżącego miesiąca.
- Archiwizacja sezonu lub zmiana statusu grupy zamyka **nowe zapisy**.
  Nie odwołuje terminów, nie zmienia opłat i nie kończy samodzielnie udziału
  dzieci. Przerwy w grafiku ustawia się w Dniach wolnych. Opis na formularzu
  wyraźnie rozróżnia te operacje.
- **Skopiuj grupę** otwiera formularz z lokalizacją, prowadzącymi i ustawieniami
  źródłowej grupy. Nowa grupa jest planowana, z zamkniętymi zapisami, bez sezonu
  i dat. Wybór sezonu uzupełnia puste daty; należy sprawdzić nowy grafik przed
  zapisaniem. Nie kopiujemy dzieci, okresów udziału ani należności.
- Filtry sezonu są dostępne w Grupach, Zawodnikach i Rozliczeniach. Grupy mają
  też filtr statusu. „Bez sezonu” pozwala odnaleźć starsze, nieprzypisane grupy.
- Rodzic: **Moje dzieci → Zrezygnuj z końcem miesiąca** albo **Kartoteka → Grupy**.
  Podaje powód i potwierdza datę zwolnienia miejsca. Administrator ma tę samą
  operację w kartotece dziecka, według tej samej reguły.
- Do końca miesiąca można użyć **Cofnij rezygnację**. Po tej dacie trzeba ponownie
  zapisać istniejące dziecko do otwartej grupy z wolnym miejscem. Nie tworzy się
  drugiej kartoteki ani drugiego wpisu w bieżącej liście przypisań.

## Model okresów i granice dat

Migracja 4 tworzy `seasons`, dodaje do `groups` `season_id`, `status`
i `registration_open`. Istniejące grupy otrzymują `season_id=NULL`,
status aktywny i otwarte zapisy. Nie zgadujemy sezonów na podstawie roku.
Nazwa sezonu jest unikalna po normalizacji wielkości liter i odstępów.

Daty sezonu muszą obejmować grafik oraz wszystkie historyczne terminy jego grup,
również odwołane. Nie można przepisać już przypisanej grupy do innego sezonu;
do kontynuacji służy kopia grupy. Istniejącą grupę bez sezonu można przypisać
do sezonu pasującego do całej jej historii. Te kontrole działają w API.

Migracja 5 rozszerza `memberships` o `ends_at` i `withdrawal_reason`,
a w `membership_periods` zapisuje okresy z datą początku, końca, typem udziału
i powodem zakończenia. Istniejący zapis daje jeden początkowy okres zgodny
z `joined_at` i statusem. Nie rekonstruujemy nieznanej wcześniejszej historii.

`memberships` nadal ma jeden rekord dziecko/grupa, wskazujący ostatni okres.
`membership_periods` jest historią tych okresów, nie drugą listą zawodników.
Unikalny indeks nie pozwala utworzyć dwóch okresów bez wyznaczonego końca.
Zmiany okresów i bieżącego przypisania są transakcyjne oraz audytowane.

Rezygnacja wyznacza `ends_at` na pierwszy dzień następnego miesiąca o 00:00
w lokalnym czasie Europe/Warsaw. Koniec jest wyłączny:
30 września o 23:59:59 udział nadal trwa, 1 października o 00:00 już nie.
Luty, rok przestępny, grudzień i zmiana czasu nie wymagają dodawania stałej
liczby godzin/dni. Formularz przesyła miesiąc podglądu; przekroczenie granicy
miesiąca przed zatwierdzeniem wymaga odświeżenia i ponownego potwierdzenia.

Stan „udział zakończony” i obłożenie wynikają z tej granicy przy każdym odczycie
oraz zapisie. Nie wymagają zadania cron i działają po restarcie. Do końca miesiąca
miejsce pozostaje zajęte. Powrót po zakończeniu ponownie sprawdza limit w transakcji
i dopisuje okres; nie omija limitu przez istnienie starego rekordu `memberships`.
Ponowienie tej samej rezygnacji nie dopisuje okresu ani audytu niezmienionych danych.

## Rozliczenia i dostęp

- Rezygnacja i jej cofnięcie nie zmieniają kwot naliczeń i nie dopisują korekt.
  Niezależne odwołanie zajęć nadal może tworzyć dotychczasową korektę.
- Nie wprowadzono miesięcznego automatu naliczeń. Nowy zapis/naliczenie nadal
  dotyczy bieżącego miesiąca; duplikat dziecko/grupa/miesiąc jest odrzucany.
  Powrót w późniejszym miesiącu zachowuje wcześniejsze kwoty i historycznego płatnika.
- Jeżeli w starszych danych istnieje dodatnia należność za przyszły miesiąc,
  rezygnacja wymaga wcześniejszego rozliczenia jej przez administratora.
  System nie umarza jej ani nie zgaduje zasad zwrotu.
- Automatyczne korekty zmian grafiku i dni wolnych uwzględniają okresy udziału.
  Dodanie przyszłego terminu nie nalicza ponownie opłaty za zakończony okres.
- Rodzic widzi własne i udostępnione mu dzieci oraz ich historię. Inna rodzina
  nie może złożyć/cofnąć rezygnacji ani przeczytać jej powodu.
- Trener widzi dziecko i kontakt do opiekunów wyłącznie podczas bieżącego
  uczestnictwa w jego grupie. Po zakończeniu traci ten dostęp od kolejnego żądania,
  chyba że dziecko nadal uczestniczy w innej jego grupie. Powód rezygnacji i
  historia okresów nie trafiają do DTO trenera. Zakończenie nie usuwa notatek.
- Kopia grupy, status i sezon nie przenoszą ani nie zwracają pieniędzy.
  Brak prawdziwych płatności oraz wysyłek w tym etapie.

## Migracja, kopia i wycofanie

Obie migracje są addytywne, transakcyjne, rejestrowane w `schema_migrations`
i sprawdzają klucze obce. Nie zmieniają haseł, MFA, sald, identyfikatorów dzieci
ani terminów. Audyt otrzymuje nowe pola/tabele. Powtórny start nie tworzy
dodatkowych początkowych okresów. Nietypowe statusy w ręcznie zmienionej bazie
zatrzymają migrację zamiast ich cichej konwersji.

Przed aktualizacją: zatrzymaj serwer i wykonaj pełną kopię SQLite, logo i klucza
MFA według [OPERACJE.md](OPERACJE.md). Sprawdź nową wersję na odtworzonej kopii.
Wycofanie: zachowaj stan po aktualizacji, odtwórz wcześniejszą kopię do nowego
katalogu i uruchom wcześniejszy commit z tamtą bazą/kluczem. Nie uruchamiaj starego
kodu na nowej bazie — mógłby policzyć zakończone przypisania jako nadal aktywne.
Nowe dane powstałe po kopii wymagają osobnego uzgodnienia przy wycofaniu.

## Weryfikacja i status

Pliki: `seasons.js`, `participation.js`, `migrations.js`, `server.js`,
`trainers.js`, istniejące pliki panelu, `test/participation.test.js`,
`test/participation.py`, `e2e/participation.spec.js`.

```sh
npm test
python3 test/smoke.py
python3 test/accounts.py
python3 test/public_signup.py
python3 test/foundations.py
python3 test/trainers.py
python3 test/security.py
python3 test/participation.py
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Na macOS po `npx playwright install chromium`: `npm run test:e2e`.
Zestaw obejmuje 25 testów jednostkowych, 7 skryptów integracyjnych oraz 4 scenariusze
E2E. Nowe testy sprawdzają migrację i rollback, blokady zapisów/statusy/datę sezonu,
zachowanie historii, rezygnację i cofnięcie bez korekt, ponowienie żądania,
rollback przy błędzie audytu/danych, granicę miesiąca w Warszawie po restarcie,
odcięcie trenera, kontrolę miejsca przy powrocie, ochronę przyszłych starych
naliczeń, kopiowanie grupy i widok 390 px.

Gotowe: opisany zakres 3A. Moduły 2, 3, 5 i 6 nadal częściowe.
Do kolejnych etapów: automatyczne zakończenie/konwersja darmowej próby w tym samym
miesiącu, lista rezerwowa, zawieszenia, przenosiny pojedyncze/masowe, łączenie
i dzielenie grup, datowane cenniki, import/eksport, zgody/regulamin/SOM.
Potem dziennik obecności i dalsze rozliczenia. Nie oznaczamy ich jako wdrożonych.
