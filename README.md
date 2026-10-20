# Evolution Academy — środowisko deweloperskie

System zapisów na zajęcia, kartotek zawodników i miesięcznych należności. Wymaga Node.js 24+; baza SQLite i moduły uwierzytelniania są dostępne w Node. Brak zewnętrznych zależności aplikacji. Python 3 służy do testów integracyjnych i narzędzia kopii zapasowych. Playwright jest zależnością deweloperską do E2E; serwer nie ma zależności runtime.

## Specyfikacja i postęp wdrożenia

- [Zatwierdzona specyfikacja](docs/SPECYFIKACJA.md)
- [Audyt 10 modułów, model danych, ryzyka i plan etapów](docs/AUDYT-I-PLAN.md)
- [Wdrożony etap 1 i checklista odbioru](docs/ETAP-1.md)
- [Etap 2A: konta i panel trenera, migracja trzech ról](docs/ETAP-2A.md)
- [Etap 2B: MFA, odzyskiwanie hasła i dodatkowi opiekunowie](docs/ETAP-2B.md)
- [Etap 3A: sezony, statusy grup i rezygnacje z końcem miesiąca](docs/ETAP-3A.md)
- [Kopia, testowe odtworzenie i procedura aktualizacji](docs/OPERACJE.md)

Przed pierwszym uruchomieniem tej aktualizacji zatrzymaj aplikację i wykonaj kopię
bazy oraz logo według instrukcji. Migracja 1 dodaje dane/status placówki, kontrolę dostępu rodzica i dziennik zmian.
Migracja 2 dodaje rolę i konta trenerów. Przed przebudową ograniczenia ról tworzy
automatyczny snapshot bazy `*.before-v2-*.sqlite` (bez logo); zachowuje wszystkie
konta i ich identyfikatory, hashe haseł i sesje. Istniejące identyfikatory i naliczenia pozostają.
Migracja 3 dodaje MFA, reset i dodatkowych opiekunów oraz utrwala płatnika naliczeń.
Wymaga ponownego zalogowania administratora i konfiguracji MFA; kończy jego stare sesje.
Migracje 4–5 dodają sezony i okresy uczestnictwa. Stare grupy pozostają bez sezonu;
zachowują otwarte zapisy, identyfikatory i naliczenia.
Nie uruchamiaj wcześniejszego kodu na bazie z nowymi triggerami audytu; wycofanie
wymaga odtworzenia kopii do osobnego katalogu.

## Uruchomienie

W katalogu projektu:

```sh
npm ci
npm run dev
```

Otwórz `http://localhost:3000` na tym samym komputerze. `npm start` uruchamia serwer bez obserwowania plików. Domyślnie serwer nasłuchuje wyłącznie na interfejsie lokalnym. Zmienne: `HOST`, `PORT`, `DB_PATH` (domyślnie `data/evolution.sqlite`), `LOGO_PATH` (domyślnie `data/logo`), `COOKIE_SECURE` (ustawienie `1` wymaga połączenia HTTPS).

W chmurze katalog projektu to `/workspace/Portal-Babygym`. Używaj istniejącego repozytorium; nie twórz dodatkowego worktree bez wyraźnej potrzeby zgłoszonej przez użytkownika. Procesy trzeba uruchomić ponownie w nowym zadaniu. Nie zakładaj, że działający serwer przetrwa przywrócenie środowiska.

## Pierwsze konto i przeniesienie starszych danych

1. Po pierwszym uruchomieniu otwórz stronę i utwórz konto **administratora**. Ustaw własny adres email i hasło (10–200 znaków), dodaj podany klucz w aplikacji uwierzytelniającej i potwierdź kod TOTP. Zapisz kody zapasowe. Nie ma domyślnego hasła ani dostępu administratora bez MFA. Jednorazowy formularz konfiguracji zamyka się po utworzeniu administratora.
2. Dane ze starszych wersji są przenoszone automatycznie: powstają kartoteki dzieci, rodziców i przypisania do grup. Dawne wpisy tego samego dziecka u tego samego rodzica są łączone w jedną kartotekę. Istniejące rozliczenia i korekty pozostają zachowane.
3. Rodzice ze starszych zapisów mają profil bez ustawionego hasła. W kartotece dziecka administrator wybiera **Link aktywacyjny rodzica** i przekazuje go właściwemu rodzicowi. Link jest jednorazowy, ważny 24 godziny; wygenerowanie nowego unieważnia poprzedni. Rodzic ustawia własne hasło. Rejestracja tego samego emaila nie przejmuje starego konta.
4. Nowy rodzic może sam zarejestrować nowe konto przez ekran logowania. Przed testowaniem panelu rodzica wyloguj administratora lub użyj osobnego profilu przeglądarki / okna prywatnego.

Link z adresem localhost działa tylko na komputerze z serwerem. Wersja lokalna nie daje jeszcze rodzicom dostępu przez Internet. Docelowe wdrożenie wymaga własnego adresu HTTPS. Reset hasła i zaproszenia opiekunów działają z lokalną skrzynką testową; produkcyjna wysyłka i weryfikacja emaila nie są podłączone. Używaj wyłącznie fikcyjnych danych do czasu przygotowania wdrożenia produkcyjnego.

## Panel administratora

- **Sezony:** nazwa, daty i archiwizacja. W ustawieniach grupy wybierasz sezon.
  Filtry sezonu są też w grupach, zawodnikach i rozliczeniach.
- **Grupy:** najpierw wybierz lokalizację, potem grupę. Grupy są wyświetlane jedna pod drugą. Wiersz pokazuje termin, prowadzącego i liczbę zapisanych osób względem limitu. Przycisk **Wejdź** otwiera osobny widok grupy z zawodnikami, harmonogramem, miesięczną opłatą i przyciskiem edycji ustawień. Wybrany miesiąc dotyczy szczegółów harmonogramu, nie liczebności grupy. Liczebność wynika ze stałych przypisań, a nie z liczby miesięcznych naliczeń.
- **Zawodnicy:** jedna lista kartotek, po jednym wierszu na zawodnika niezależnie od liczby grup i lokalizacji. Wyszukiwanie po dziecku i wszystkich jego opiekunach. Po wejściu dostępne są zakładki „Dane”, „Grupy”, „Opiekunowie” i „Rozliczenia”; przypisania nie są powielane na liście głównej. Każdy zawodnik ma głównego rodzica i może mieć dodatkowych opiekunów po przyjęciu zaproszenia. Administrator może dodać profil rodzica przed dodaniem dziecka. Zmiana głównego rodzica przenosi jego dostęp, ale zachowuje historycznych płatników i salda.
- **Lokalizacje:** rejestr przedszkoli wybieranych z listy. Nazwy różniące się tylko wielkością liter lub dodatkowymi spacjami nie tworzą duplikatów. Kartoteka zawiera też adres, kontakt i notatki administratora oraz status aktywna/wstrzymana/archiwalna. Dwa ostatnie zamykają nowe zapisy i tworzenie grup, zachowując istniejący grafik i saldo. Poprawienie nazwy aktualizuje etykiety w całym systemie, zachowując identyfikatory i wykluczenia. Nie zgadujemy, czy różne literówki oznaczają jedno miejsce.
- **Dni wolne:** dzień lub zakres dla całego systemu, wybranych lokalizacji albo grup. Lokalizacje mogą mieć dni wolne jeszcze przed utworzeniem grup. Święta dodaje administrator — nie są automatycznie importowane.
- **Trenerzy:** profile prowadzących i przypisania wielu trenerów do jednej grupy. Dodanie profilu nie tworzy jeszcze konta. Przycisk **Utwórz konto** generuje link aktywacyjny do ręcznego przekazania trenerowi. Edycja profilu pozwala zmienić kontakt i status. Nieaktywny lub archiwalny trener traci dostęp i sesje. Obecności, zastępstwa i wynagrodzenia pozostają kolejnymi etapami.
- **Rozliczenia:** należności za wybrany miesiąc, ręczne korekty z powodem i historia korekt automatycznych.
- **Dziennik zmian:** historia zmian danych oraz udanych operacji dostępu, z autorem i starymi/nowymi wartościami. Wyłącznie Administrator, od momentu wdrożenia dziennika.
- **Wygląd:** wgranie oryginalnego logo PNG/JPG/WebP do 5 MB. Obraz jest zachowywany bez przetwarzania w lokalnym `data/logo`. Kolory panelu pochodzą z przekazanego znaku marki. Do czasu wgrania pliku widoczna jest tekstowa nazwa.

## Grafik i edycja grup

Tworząc grupę wybierz lokalizację i podaj nazwę, limit, stawkę, opcjonalnych trenerów, daty początku i końca, dzień tygodnia i godziny rozpoczęcia/zakończenia. Pasujące terminy powstaną automatycznie, włącznie z datami granicznymi, maksymalnie na trzy lata. Godziny są interpretowane według czasu polskiego.

**Edytuj grupę** pozwala zmienić ustawienia i przyszły grafik. Limit nie może być mniejszy od liczby przypisanych dzieci. Odbyte zajęcia, zapisy i historyczne naliczenia nie są kasowane. Zmiana samej godziny zachowuje tożsamość terminu. Usunięte przyszłe terminy są oznaczane jako odwołane; nowe daty otrzymują osobne rekordy. Zmiany liczby terminów w opłacanym miesiącu tworzą automatyczne korekty. Nowa stawka dotyczy nowych zapisów, a istniejące rozliczenia zachowują uzgodnione ceny jednostek. Nie realizuje to zwrotu pieniędzy — płatności nie są podłączone.

Zapis próbny dotyczy konkretnego terminu. Jeżeli termin zostanie odwołany, jest korygowany; próba nie jest samoczynnie przenoszona na inną datę. Historia odwołanych terminów pozostaje w bazie. Lokalizacja zajęć jest zapisywana przy terminie i zachowuje dawne powiązania. Nowe przeniesienie całej grupy do innej placówki jest zablokowane zgodnie ze specyfikacją.

## Panel rodzica

Rodzic zakłada konto, dodaje dziecko i wybiera lokalizację oraz grupę. Nie wpisuje przy każdym zapisie ponownie danych rodzica i dziecka — wybiera własną kartotekę. Serwer sprawdza własność kartoteki niezależnie od interfejsu.

Strona **Zapisy na zajęcia** zawiera wyłącznie wybór lokalizacji i listę jej grup. Każdy wiersz pokazuje wolne miejsca, dzień i godziny zajęć, trenera, najbliższą datę i stawkę. Przycisk **Zapisz dziecko** otwiera formularz z wyborem własnego dziecka, ewentualnej próby w bieżącym miesiącu i dynamiczną kwotą. Pełna grupa blokuje zapis nowej osoby. Zapisy są możliwe wyłącznie na zajęcia pozostałe w bieżącym miesiącu według czasu Europe/Warsaw. Grupa bez takich terminów jest widoczna bez możliwości zapisu. Nie można wybrać przyszłego miesiąca, także przez bezpośrednie wywołanie API.

W osobnej zakładce **Moje dzieci** rodzic widzi tylko swoje dzieci, ich lokalizacje, grupy, najbliższe terminy, należności i historię korekt. Nie widzi innych rodzin ani notatek administracyjnych. Może poprawić dane swojego dziecka. Należność jest liczona z góry za pozostałe zajęcia bieżącego miesiąca; minione, odwołane i wykluczone terminy nie są naliczane. Cena próby jest ustawiana w grupie, także na 0 zł.

Stałe przypisanie dziecka do grupy jest oddzielone od miesięcznych rozliczeń, więc kolejne miesiące nie zwiększają liczebności grupy. W tej wersji nowy zapis i jego naliczenie dotyczą wyłącznie bieżącego miesiąca — automatyczne tworzenie należności na kolejne miesiące pozostaje kolejnym etapem. Rezygnacja działa z końcem bieżącego miesiąca bez zmiany jego opłaty. Nie ma jeszcze płatności online, wpłat ani zwrotów. Odrabianie zajęć pozostaje wyłączone zgodnie ze specyfikacją. Przypisania próbne pozostają widoczne do późniejszej obsługi ich statusów. W tym samym miesiącu nie można jeszcze zmienić zapisu próbnego na stały bez obsługi administracyjnej.

## Logowanie i dostęp

Hasła są haszowane przez scrypt z losową solą. Sesje są przechowywane po stronie serwera (w bazie wyłącznie skrót tokenu) i wygasają po 7 dniach. Cookie ma HttpOnly i SameSite=Strict; przy wdrożeniu HTTPS należy włączyć `COOKIE_SECURE=1`. Wylogowanie unieważnia sesję. Operacje administracyjne wymagają roli administratora, a odczyt i zmiana dziecka roli rodzica są ograniczone do jego kartotek. Zapytania zapisujące kontrolują źródło Origin. Operacje logowania i rejestracji mają limit prób. To wersja deweloperska, wymagająca dalszego przygotowania do działania publicznego.

## Testy

```sh
npm test
python3 test/smoke.py
python3 test/accounts.py
python3 test/public_signup.py
python3 test/foundations.py
python3 test/trainers.py
```

Testy jednostkowe sprawdzają naliczanie opłat, daty i wykluczenia. Test integracyjny na porcie 3107 używa starego schematu bazy i potwierdza migrację, zapisy, wykluczenia, poprawianie nazw, korekty, trenerów, logo i zachowanie danych po restarcie. Test na porcie 3118 sprawdza konta, izolację rodzin, wymuszenie rodzica przy dziecku, liczebność grupy, edycję zapisanej grupy, zachowanie cen i korekt, aktywację i wylogowanie. Oba używają tymczasowych baz i fikcyjnych danych; nie modyfikują bazy deweloperskiej.

## Aktualizacje i synchronizacja na macOS

Zainstaluj GitHub Desktop z https://desktop.github.com/, zaloguj się i wybierz File → Clone Repository → `dud3k88/Portal-Babygym`. Zapisz repozytorium np. w `~/Documents/GitHub/Portal-Babygym`, w nowym folderze. Nie klonuj na istniejący katalog z pobranego ZIP-a.

Jeśli masz wcześniejsze dane, zatrzymaj starą aplikację (Control+C), zrób kopię całego `data/` i skopiuj ten katalog do nowego projektu. Zachowaj oryginalną kopię aż do sprawdzenia danych. W Terminalu:

```sh
cd ~/Documents/GitHub/Portal-Babygym
npm ci
npm run dev
```

Późniejsze aktualizacje: zatrzymaj serwer, zrób kopię `data/`, wybierz Fetch origin → Pull origin w GitHub Desktop, uruchom ponownie `npm ci` i `npm run dev`, a następnie odśwież stronę. Jeśli sam edytowałeś kod, zachowaj te zmiany przed aktualizacją; nie używaj force/reset. Dla wersji z ZIP-a zachowaj `data/` i po wykonaniu kopii przenieś ten katalog do nowej wersji.

GitHub synchronizuje kod. Baza, konta, sesje i logo pozostają lokalnie w ignorowanym `data/`; nie są przesyłane przez GitHub Desktop. Migracje schematu uruchamiają się automatycznie. Konto administratora tworzy się tylko wtedy, gdy instalacja nie ma jeszcze administratora. Aktualizacja zachowuje istniejące konta i hasła.

## Publiczna strona zapisów bez logowania

Otwórz `http://localhost:3000/zapisy` na komputerze, na którym uruchomiono aplikację. Link jest też na ekranie logowania i w administracyjnym podglądzie zapisów. Adres `/zapisy` jest osobną stroną z logo i formularzem, bez bocznego menu i bez wymogu wcześniejszego logowania. Korzysta z tego samego logo wgranego przez administratora; jeśli nie dodano pliku, pokazuje tekstową nazwę marki.

Formularz ma trzy kroki:

1. Wybór lokalizacji i grupy (ewentualnie terminu próbnego w bieżącym miesiącu), podgląd wolnych miejsc, dnia/godziny, trenera i dynamicznej kwoty.
2. Imię i nazwisko dziecka oraz opcjonalna data urodzenia.
3. Imię i nazwisko rodzica, wymagany email i telefon oraz hasło do nowego konta (minimum 10 znaków).

Ostateczne potwierdzenie tworzy konto rodzica, kartotekę dziecka, przypisanie do grupy i naliczenie w jednej transakcji. Serwer ponownie wylicza kwotę i sprawdza miejsca; podana przez klienta kwota lub rola nie wpływają na rozliczenie i uprawnienia. Brak miejsc lub błąd danych wycofuje całą operację, bez pozostawiania pustego konta lub dziecka. Po sukcesie rodzic zostaje zalogowany i przechodzi do „Moje dzieci”.

Istniejący rodzic korzysta z odnośnika „Panel rodzica” i loguje się na dotychczasowe konto. Publiczny formularz nie zakłada drugiego konta na ten sam adres i nie przejmuje kartoteki utworzonej wcześniej przez administrację. Nie wysyła wiadomości email ani SMS. Na razie nie pobiera pieniędzy.

Publiczne API udostępnia wyłącznie lokalizacje, ofertę grup, liczby miejsc, nazwiska trenerów i przyszłe terminy. Nie udostępnia danych zawodników, rodziców, danych kontaktowych trenerów, notatek, sald ani haseł. Konta i panel administracyjny pozostają chronione logowaniem.

`python3 test/public_signup.py` uruchamia izolowaną bazę i serwer na porcie 3126. Sprawdza publiczny katalog, brak prywatnych danych, walidację, atomowy zapis, blokadę duplikatów, miejsca, bezpłatną próbę oraz konkurencję dwóch zapisów o ostatnie miejsce. Test nie zmienia danych aplikacji.

„Bez logowania” nie oznacza jeszcze wdrożenia w Internecie: udostępnienie tego adresu rodzicom spoza komputera wymaga oddzielnego hostingu i HTTPS.

Formularz zapisów ma jedną rodzinę pisma i dwie grubości (400 i 600), wyśrodkowane logo oraz odnośnik „Panel rodzica” w prawym górnym rogu. Pole wyboru miesiąca zostało usunięte z obu formularzy zapisów. Miesiąc wyznacza serwer według czasu polskiego; wysłanie przeszłego lub przyszłego miesiąca jest odrzucane, a brak miesiąca w żądaniu oznacza bieżący okres. Próbę również można wybrać wyłącznie z pozostałych terminów tego miesiąca. Podgląd przyszłych miesięcy w kalendarzu administratora pozostaje dostępny do planowania zajęć, ale nie umożliwia wcześniejszego zapisu.

Testy integracyjne uruchamiają serwer z osobnym loaderem `scripts/fixed-clock.mjs` i kontrolowanym czasem (`EA_TEST_NOW`), dzięki czemu przykładowe daty nie przestają działać z upływem czasu. Zwykłe `npm start` i `npm run dev` nie ładują tego modułu i korzystają z rzeczywistego czasu. Testy jednostkowe obejmują zmianę miesiąca oraz przejście roku.

### Zakładki kartoteki zawodnika

- **Dane:** imię i nazwisko, data urodzenia i — tylko dla administratora — notatka wewnętrzna oraz edycja danych.
- **Grupy:** wszystkie przypisania tego zawodnika z lokalizacją, terminem, trenerami i rodzajem zapisu.
- **Rodzic:** imię i nazwisko, email, telefon, stan aktywacji konta; administrator może utworzyć link aktywacyjny.
- **Rozliczenia:** kwota do zapłaty, nadpłata, część należności z poprzednich miesięcy oraz historia naliczeń i korekt ze wszystkich grup tego zawodnika. Saldo naliczeń dodatnie oznacza należność, ujemne nadpłatę. Należność z poprzednich miesięcy jest ograniczona do bieżącej kwoty do zapłaty, aby nie pokazywać zadłużenia pokrytego korektami/nadpłatą. Brak terminów płatności i integracji wpłat nie pozwala oznaczać automatycznie całej kwoty jako przeterminowanego długu.

Zawodnik z dwiema grupami nadal ma jeden wiersz na liście. Dwie odrębne kartoteki o podobnym imieniu nie są automatycznie łączone, bo mogłyby należeć do różnych dzieci. Zakładki działają także klawiaturą (strzałki lewo/prawo, Home, End).

### Stylistyka Evolution Academy

Panel i publiczny formularz korzystają ze wspólnego `public/brand.css`, opartego na
kolorach strony evolutionacademy.pl: róż `#cc6bbb`, pomarańcz `#f3993c`, ciemny tekst
`#030712` oraz jasne różowo-brzoskwiniowe akcenty. Tło aplikacji pozostaje białe.
Nagłówki używają Baloo Bhai 2, a formularze i treść Open Sans. Fonty są dostarczane
lokalnie z `public/fonts`, wraz z licencjami OFL; aplikacja nie pobiera ich od Google.

Listę zawodników można filtrować po lokalizacji, grupie i rodzaju zapisu (stały,
próbny lub bez grupy), a także wyszukiwać po danych dziecka lub rodzica. Jedno
dziecko pozostaje jednym wynikiem niezależnie od liczby przypisań. Rozliczenia
mają wyszukiwanie oraz filtry lokalizacji, grupy, miesiąca należności i salda
(do zapłaty, zero, nadpłata). Historia korekt dotyczy należności pasujących do
filtrów; miesiąc odnosi się do należności, nie daty wykonania korekty. Saldo zerowe
nie potwierdza wpłaty. Listy zawodników, należności i korekt mają strony po 20
pozycji; liczniki i suma salda obejmują wszystkie wyniki wybranych filtrów.

Administrator może zablokować konto rodzica w kartotece dziecka → Opiekunowie. Kończy to sesje i unieważnia zaproszenia oraz reset hasła; odblokowanie wymaga ponownego logowania. Operacja jest zapisywana w dzienniku.

## Panel trenera (etap 2A)

Konto trenera aktywuje się jednorazowym linkiem od Administratora. Po zalogowaniu
trener widzi **Mój grafik i grupy**: terminy według miesiąca, listę dzieci własnych
grup oraz kontakt do ich rodziców. Może zapisać własną notatkę o dziecku. Notatki
widzą autor i Administrator, nigdy Rodzic. Dane finansowe i cudze grupy są
niedostępne w API. Odebranie przypisania usuwa dostęp do grupy i jej dzieci.
Trener nie może wysyłać wiadomości rodzicom ani sam zmieniać przypisań.

W bazie są dokładnie trzy role: Administrator, Trener, Rodzic.

## Bezpieczeństwo i dodatkowi opiekunowie (etap 2B)

Administrator loguje się hasłem i kodem z aplikacji uwierzytelniającej. Kod zapasowy
pozwala na jednorazowe logowanie lub konfigurację nowego telefonu. Klucz szyfrowania
MFA znajduje się domyślnie w `data/evolution.sqlite.mfa-key` i musi być zachowany
razem z bazą. Narzędzie kopii zapasowych uwzględnia go automatycznie.

Aby testować **Nie pamiętam hasła** oraz **Kartoteka → Opiekunowie → Zaproś kolejnego opiekuna**:

```sh
SECURITY_OUTBOX_DIR="$PWD/data/security-outbox" npm run dev
```

Linki są zapisywane w prywatnych plikach JSON we wskazanym katalogu. Nie wysyłamy
emaili. Nowy opiekun zakłada własne konto na zaproszony email, otwiera link i
potwierdza zaproszenie. Widzi tylko udostępnione dziecko, jego grupy i naliczenia.
Główny rodzic/administrator może cofnąć ten dostęp bez kasowania historii.
Reset hasła unieważnia stare sesje i nie wyłącza MFA administratora.

Konfiguracja klucza, kopia, przyjmowanie zaproszeń i ograniczenia wersji testowej:
[ETAP-2B.md](docs/ETAP-2B.md). Testy nowego zakresu: `python3 test/security.py`,
`npm test` oraz `npm run test:e2e`. Produkcyjna poczta, zgody/SOM i płatności pozostają
do osobnego wdrożenia.

## Sezony i rezygnacje (etap 3A)

**Grupy → lokalizacja → grupa → Status i zapisy** pozwala zamknąć zapisy lub
ustawić grupę jako planowaną, aktywną, wstrzymaną lub zakończoną. Nie zmienia
grafiku ani sald. Przerwy w zajęciach dodaj w Dniach wolnych. **Skopiuj grupę**
przenosi ustawienia do formularza nowej grupy, bez zawodników i należności.

**Moje dzieci → Zrezygnuj z końcem miesiąca** albo **Kartoteka → Grupy**:
podaj powód i potwierdź. Miejsce pozostaje zajęte do końca miesiąca, opłata się
nie zmienia. Do tego czasu możesz cofnąć rezygnację. Późniejszy powrót wymaga
wolnego miejsca; zachowuje jedną kartotekę, wcześniejsze należności i historię
okresów uczestnictwa. Trener po zakończeniu traci dostęp do danych tego uczestnika,
jeśli nie uczestniczy on nadal w innej jego grupie.

Dokładne zasady, migracje i ograniczenia: [ETAP-3A.md](docs/ETAP-3A.md).
Nowe testy: `python3 test/participation.py`. Kolejny zakres: próby i konwersja
na zapis stały, lista rezerwowa oraz dalsze operacje uczestnictwa, potem obecności.
