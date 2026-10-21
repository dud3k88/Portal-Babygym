# Zbiorcza aktualizacja bez integracji zewnętrznych

Zakres: lokalna aplikacja Node.js/SQLite. Nie uruchomiono operatora płatności,
wysyłki email ani SMS. Zaksięgowanie wpłaty, oznaczenie zwrotu i oznaczenie wypłaty
są ewidencją operacji wykonanej poza aplikacją. Nie wykonują przelewów.

## Uzupełnienie: grupy i formularz zapisu (migracja 13)

W ustawieniach grupy dostępne są rodzaj zajęć, opis dla rodzica, minimalny i maksymalny
wiek oraz maksymalnie 10 własnych pytań tekstowych. Jedno pytanie w wierszu;
wszystkie pytania są opcjonalne dla rodzica. Odpowiedź ma limit 500 znaków.
Rodzic widzi pola zarówno w publicznym formularzu, jak i przy zapisie z panelu.
Odpowiedzi są w kartotece dziecka, dostępne administratorowi i jego opiekunom;
trener nie otrzymuje tych danych automatycznie. Zmiany odpowiedzi mają audyt.

Wiek jest sprawdzany po stronie serwera przy nowym zapisie (także próbnym),
przeniesieniu do innej grupy i dołączeniu do listy rezerwowej. Liczymy ukończone
lata w dniu zapisu, obie granice są włączne. Dla urodzonych 29 lutego ukończenie
kolejnego roku w roku nieprzestępnym następuje tu 1 marca. Jeśli określono choć jedną
granicę, data urodzenia jest wymagana. Stare grupy mają brak ograniczeń, więc
migracja nie usuwa ani nie zmienia istniejących zapisów. Zmiana zakresu wieku
nie wypisuje obecnych uczestników. API również pozwala pominąć dodatkowe pytania;
wcześniejsze odpowiedzi z kolejki zachowują swoją wersję przy przyjęciu oferty.

Walidacja: 32 testy Node, testy integracyjne zapisów/operacji/migracji i 6 scenariuszy
Playwright; publiczny zapis z wymaganym wiekiem i dodatkowym pytaniem sprawdzony w przeglądarce.

## Działające przepływy

- Kalendarz administratora, własne terminy trenera i terminy dzieci rodzica;
  dzień/tydzień/miesiąc, zakres i grupa. Dziennik obecności, zgłoszenie nieobecności
  rodzica, korekty z powodem, potwierdzenie realizacji i rzeczywisty czas zajęć.
  Przypisanie trenerów do jednostek zachowuje historię; administrator może
  odwołać, przesunąć termin w obrębie miesiąca lub przypisać zastępstwo.
- Przeniesienie zaznaczonych uczestników do innej dostępnej grupy od teraz,
  zawieszenie i wznowienie. Pozostałe jednostki korygują należność. Cała operacja
  jest transakcyjna; konflikt choć jednej osoby wycofuje całość. Wznowienie
  w tym samym miesiącu wykorzystuje istniejące naliczenie i kartotekę.
  Rezygnacja rodzica nadal kończy udział z końcem miesiąca bez obniżenia opłaty.
- Ewidencja wpłat częściowych, dopasowanie do najstarszych należności tego samego
  dziecka **i płatnika**, nadpłaty, rezerwacja zwrotu i oznaczenie jego wykonania.
  Zmniejszenie opłaty uwalnia nadmiernie przydzieloną wpłatę przez wpis korygujący.
  Identyfikatory wpłat i zwrotów blokują powtórzenie operacji.
- Datowane stawki grup, indywidualne rabaty kwotowe/procentowe na jednostkę,
  ręczne miesięczne naliczenie i opcjonalne automatyczne naliczanie. Wpisowe
  sezonu i indywidualne zwolnienie naliczane jawnie, tylko dla zapisu stałego.
  Numer rachunku ma kontrolę sumy kontrolnej; widoczny jest w kartotece dziecka.
- Import wyciągu CSV/XLSX: podgląd, mapowanie kolumn, wybór wierszy i ręczne
  przypisanie dziecka; walidacja oraz transakcyjne zatwierdzenie. Kwoty importu
  są w złotych, daty RRRR-MM-DD. Unikalny identyfikator pochodzi z banku.
- Import zawodników CSV/XLSX: mapowanie, raport błędów, kontrola istniejącego
  rodzica i kartoteki. Nowy rodzic wymaga późniejszej aktywacji konta.
  Cała partia wycofywana przy błędzie. Istniejące dane kontaktowe nie są nadpisywane.
- Wykrywanie zgodnych duplikatów u tego samego rodzica i jawne połączenie.
  Nazwa, data urodzenia, główny rodzic i uprawnienia opiekunów muszą być zgodne.
  Zapis/obecność/rozliczenia przechodzą na docelową kartotekę. Konfliktujące
  historie (np. obie kartoteki w tej samej grupie) blokują operację.
  Oryginał pozostaje w chronionym rejestrze połączeń; usunięte ID nie jest używane ponownie.
- Rozmowy rodzic–administrator i trener–administrator, statusy wątków,
  odpowiedzi i centrum powiadomień. Trener nie wysyła do rodziców.
  Powiadomienia w aplikacji obejmują zapisy, ofertę miejsca, nowe miesięczne
  naliczenia, zmianę uczestnictwa i odpowiedzi na wiadomości.
- Wersje dokumentów regulamin/RODO/SOM oraz osobne dobrowolne zgody. Organizator
  wpisuje własne teksty. Potwierdzenia w formularzu publicznym i panelu, historia
  oraz wycofanie zgód dobrowolnych. Brak przykładowych dokumentów udających zgodność prawną.
- Katalog sprzętu, stan w placówkach, przeniesienia, inwentaryzacja i zgłoszenia.
  Trener widzi placówki swoich grup. Rodzic nie ma dostępu.
- Programy, umiejętności i kryteria, przypisanie programu grupie, konspekty,
  biblioteka PDF/PNG/JPG/MP4 z tagami i uprawnieniami, oceny wewnętrzne/publikowane.
  Wydruki PDF konspektu, dyplomu i Karty Przygody z 35 polami. Pieczątki wynikają
  z potwierdzonych obecności; korekta obecności zmienia wynik, bez duplikatów.
- Warunki współpracy trenerów, dyspozycyjność do zatwierdzenia, datowane stawki
  za 30/60 minut (także na placówkę), ręczne premie/korekty, podgląd miesięczny,
  zatwierdzenie niezmiennego zestawienia, oznaczenie wypłaty. Trener widzi swoje dane.
- Kategorie i koszty jednorazowe/cykliczne, najem, raport przychodów i wpływów,
  zatwierdzone wynagrodzenia, źródła kosztów, niezmienne wersje raportu miesiąca.
  Eksporty CSV/XLSX: zawodnicy, należności, wpłaty, wynagrodzenia i podsumowanie firmy.

## Reguły obliczeń i ograniczenia

Kwoty przechowywane są w groszach. Rabat procentowy używa punktów bazowych,
wynik jednostki zaokrąglany jest do grosza. Rabat kwotowy dotyczy **każdej jednostki**.
Zmiana cennika nie przepisuje historycznych pozycji. Cennik przechowuje deklarację
VAT, ale pełnego rozbicia brutto/netto/VAT na historycznych pozycjach jeszcze nie ma.

Automat nalicza po pierwszym żądaniu API w nowym miesiącu, po włączeniu w ustawieniach.
Nie jest to niezależny harmonogram pracy w tle. Nie nadpisuje już istniejącego
naliczenia dziecka/grupy/miesiąca. Wpisowe wymaga jawnego naliczenia lub zwolnienia.
Dzień płatności jest ustawieniem prezentacji; automatyczne przypomnienia i odsetki
nie działają. Importy zatwierdzają maksymalnie 100 wierszy na partię; plik maks. 5 MB.
Eksportowane kwoty są opisane jako grosze. Treść CSV jest zabezpieczona przed formułami.

Wynagrodzenie = suma zaokrąglonych (stawka × rzeczywiste minuty / jednostka stawki)
plus korekty. Brak stawki blokuje zatwierdzenie. Kwoty po zatwierdzeniu nie zmieniają
się od późniejszej edycji grafiku; korektę zapisuje się w otwartym miesiącu.
Forma współpracy i etykieta netto/brutto nie oznaczają automatycznej kalkulacji podatków.

Najem godzinowy obejmuje potwierdzone, nieodwołane zajęcia. Nachodzące i stykające
się bloki w jednej placówce są łączone. Koszt bloku = stawka godzinowa × max(czas,
minimum) / 60 + sprzątanie; osobno stała opłata miesięczna. Wyjątki płatnego najmu
za niezrealizowane zajęcia wymagają ręcznego kosztu.

Przychód raportu = naliczenia + korekty. Wpłaty prezentowane oddzielnie. Wynik
operacyjny = przychód − koszty operacyjne − zatwierdzone wynagrodzenia − najem.
VAT/PIT/ZUS są osobną ewidencją obciążeń. Koszty ogólne nie są dzielone na placówki.
Raport placówki nie przypisuje automatycznie niealokowanych wpłat ani zwrotów firmy.

## Stan pełnej specyfikacji

To działająca zbiorcza rozbudowa, **nie pełny odbiór wszystkich punktów specyfikacji**.

| Moduł | Stan i pozostający zakres |
|---|---|
| 1 Dostęp | Trzy role, MFA, reset, użytkownicy, opiekunowie i audyt działają; realny email wyłączony. |
| 2 Grupy/sprzęt | Podstawowe operacje i sprzęt działają; pozostały zdjęcia sprzętu, przyszłe masowe kontynuacje, pełne łączenie/dzielenie grup i jawny wyjątek limitu. |
| 3 Kartoteki | Import/eksport, kontrolowane połączenie i zgody działają; pozostały łączenie konfliktujących historii i kont rodziców, konfiguracja osadzania WordPress. |
| 4 Kalendarz | Dziennik i realizacja działają; pozostały statystyki frekwencji, pełny zestaw filtrów UI, przesunięcia między miesiącami i zmiana cyklu od dowolnej przyszłej daty. |
| 5 Rodzic | Dostęp do własnych danych, rozmów, zgód i postępów działa; automatyczne przypomnienia i pulpit zbiorczy wymagają rozwinięcia. |
| 6 Rozliczenia | Księga, import, cenniki i naliczanie działają; pozostały historyczny VAT, automatyczne wpisowe/przypomnienia, propozycje dopasowań bankowych. Operator online wyłączony zgodnie z poleceniem. |
| 7 Trenerzy | Godziny, stawki, zestawienia i korekty działają; pozostały konfigurowalne automatyczne premie oraz pełne powiązanie cyklicznej dyspozycyjności z konfliktami grafiku. Nie przyjęto niezatwierdzonego wzoru premii. |
| 8 Komunikacja | Wątki i powiadomienia w aplikacji działają; pozostały masowe kampanie, szablony, harmonogram i wszystkie automatyzacje. SMS/email nie są podłączone. |
| 9 Raporty | Podstawowy raport firmy/placówki i zapis wersji działa; pozostały rentowność grupy, prognozy/scenariusze, kreator i pełne porównania sezonów oraz VAT. |
| 10 Metodyka | Programy, postępy, pliki i bazowe PDF działają; pozostały tygodniowe tematy, zaawansowane statystyki i docelowe graficzne szablony kart. |

Nie dodano faktur, odrabiania, wspólnego salda rodziny, dodatkowych ról ani pozostałych
funkcji wykluczonych w specyfikacji. Treści prawne, grafiki kart i reguły biznesowe
organizatora nie zostały zastąpione fikcyjnymi danymi.

## Aktualizacja i dane

Przed uruchomieniem na własnej bazie wykonaj kopię zgodnie z [OPERACJE.md](OPERACJE.md).
Zatrzymaj aplikację, pobierz kod, uruchom `npm ci`, a następnie `npm start`.
Migracje 7–12 są automatyczne i transakcyjne. Nowe pliki biblioteki są prywatnymi
BLOB-ami w SQLite (limit 20 MB na plik), więc kopia bazy zawiera także materiały.
Nie umieszczaj bazy, klucza MFA ani kopii w repozytorium. Wycofanie wersji wymaga
kopii sprzed migracji i poprzedniego kodu; nie ma automatycznego downgrade.

PDFKit używa lokalnego fontu z polskimi znakami. ExcelJS ma przypiętą poprawioną
zależność UUID 11.1.1; audyt produkcyjnych zależności: 0 zgłoszonych podatności.

## Walidacja

- 30 testów Node.js: naliczanie, daty, harmonogram, migracje, audyt i MFA.
- Dotychczasowe scenariusze Python: smoke, accounts, public_signup, foundations,
  trainers, security, participation, users, admissions.
- `test/operations.py`: izolacja rodzin i trenerów, obecności/pieczątki,
  wpłaty/zwroty, prywatne rozmowy/postępy, zgody, sprzęt, wynagrodzenia,
  rozróżnienie przychodu/wpłat, rollback importów, PDF/XLSX, zawieszenie/wznowienie,
  połączenie kartotek z historią i brak ponownego użycia ID.
- 6 scenariuszy Playwright; rozszerzone o dostępność nowych ekranów na telefonie,
  formularz kosztu i zakres nawigacji trenera.

Testy korzystają z baz tymczasowych i fikcyjnych danych. Nie wykonują prawdziwych
przelewów ani wysyłek.

## Terminy płatności i opcjonalne pytania (migracja 14)

Nowe należności otrzymują własny termin płatności: ustawiony dzień miesiąca,
jednak nie wcześniej niż dzień naliczenia. Zmiana ustawień nie przesuwa wcześniej
zapisanych terminów. Administrator może ustalić lub zmienić termin pojedynczej
należności z podaniem powodu; historia pozostaje dostępna w kartotece.

Stare należności bez terminu mają status „Termin nieustalony”. Nie zgadujemy
historycznych dat i nie zaliczamy takich pozycji do zaległości przeterminowanych.
Dodatnie saldo staje się zaległością dopiero następnego dnia po terminie, według
czasu polskiego. Dni opóźnienia są dniami kalendarzowymi. Wpłata rozlicza konkretną
należność po przypisaniu; nieprzypisany kredyt nie zmniejsza jej zaległości.
Rozliczenia można filtrować po statusie, minimalnej kwocie i dniach opóźnienia.
Rodzic widzi terminy i zaległości własnych dzieci. Eksport należności zawiera te dane.

Migracja zmienia dotychczasowe pytania dodatkowe na opcjonalne, zachowując
historyczne odpowiedzi. Nie uruchamia wysyłki przypomnień ani płatności online.

Walidacja tego etapu: 36 testów Node (35 w pełnym przebiegu oraz dodany test
migracji), integracje operations/foundations/public_signup/admissions i 6 scenariuszy
Playwright na Chromium. Sprawdzono zapis bez odpowiedzi, zmianę terminu i filtrowanie
w przeglądarce, uprawnienia, historyczne dane, rollback i ponowne uruchomienie migracji.

## Uporządkowany panel administracyjny

Menu dzieli się na organizację, rozliczenia, współpracę, ustawienia i panel rodzica.
Panel ma ciemne menu, białą przestrzeń roboczą, jednolitą typografię i akcenty Evolution
Academy. Publiczny formularz zapisu zachowuje osobny wygląd.

Kartoteka pokazuje tabelę z jednym wierszem na zawodnika, datą urodzenia, kontaktem
rodzica, statusem należności i przyciskiem otwarcia szczegółów. Istniejące wyszukiwanie,
filtry i paginacja nadal działają. Na telefonie tabela przewija się wewnątrz sekcji.
Lista trenerów ma zwarte wiersze oraz rozwijane przypisania do grup.

Kalendarz ma kolumny dni dla tygodnia, osobny widok dnia oraz miesięczną listę
pogrupowaną według dat. To widok kafelków, bez osi godzinowej i przeciągania zajęć.
Kliknięcie zajęć otwiera dziennik. Dostępne są filtry lokalizacji/grupy/trenera,
przejście do poprzedniego/następnego okresu oraz przycisk „Dzisiaj”. Zakresy dłuższe
niż 32 dni są prezentowane jako lista według dat, bez pomijania zajęć.

Walidacja: 6 scenariuszy Playwright, w tym tabela z jednym wpisem, tygodniowy kalendarz,
otwieranie dziennika, nawigacja dat, dostęp trenera i brak przewijania całej strony
w poziomie na telefonie. Zmiana nie wymaga migracji bazy.

## Pulpit, oś godzinowa i pełne kartoteki

Po zalogowaniu administrator trafia na pulpit: zajęcia dzisiaj, zaległe należności,
lista rezerwowa, ostatnio dodani zawodnicy i dostępności trenerów do zatwierdzenia.
Skróty prowadzą do dziennika, kartoteki lub odpowiednio przefiltrowanych rozliczeń.
Przycisk „Odśwież” ponownie pobiera dane; pulpit nie wysyła powiadomień.

Widok tygodnia i dnia ma teraz oś godzinową. Nakładające się terminy dzielą kolumnę,
a zakres godzin rozszerza się do najwcześniejszych i najpóźniejszych zajęć. Wpis bez
ustalonego końca ma znak „?” oraz umowną wysokość 30 minut. Miesiąc pozostaje listą
według dat. Kafelki otwierają dziennik; zmiana terminu nadal wymaga jawnej operacji
z uzasadnieniem. Domyślnie otwiera się bieżący tydzień od poniedziałku.

Karta trenera ma zakładki: dane, grupy, dyspozycyjność, nieobecności, wynagrodzenia.
Pozwala edytować dane, ustawić warunki współpracy i stawki, zgłaszać i zatwierdzać
nieobecności oraz rozliczać wynagrodzenie wybranego miesiąca. Formularze uruchomione
z karty dotyczą jej trenera. Pod nieobecnościami pokazujemy przyszłe, nieodwołane
zajęcia pokrywające się z wpisami oczekującymi lub zatwierdzonymi. Zatwierdzenie
nieobecności samo nie odwołuje zajęć ani nie przypisuje zastępcy — dziennik zawiera
odpowiednie operacje. Wynagrodzenie nadal wynika z potwierdzonych zajęć i stawek.
Poprawiono obsługę dat z formularza datetime-local (bez sekund).

Kartoteka zawodnika ma wspólne podsumowanie i zakładki: dane, opiekunowie, grupy,
obecności, rozliczenia. Historia obecności respektuje okresy uczestnictwa, zajęcia
próbne i uprawnienia opiekunów; wyświetla zgłoszenia nieobecności, odwołania oraz
nieuzupełnione statusy. Podsumowanie obejmuje dotychczasowe nieodwołane zajęcia,
a lista jest filtrowana według miesiąca. Rodzic nie otrzymuje historii innych dzieci.

Zmiana nie wymaga migracji bazy. Testy obejmują rozkład nakładających się terminów,
prywatność historii obecności, normalizację czasu formularza, pulpit, nawigację
kartotek, zgłoszenie/zatwierdzenie nieobecności, stawkę z karty i widok mobilny.

## Poprawki z „Panel Evolution 2.0.pdf” i logowanie telefonem

- Logowanie jest osobną kartą z małym logo, bez menu i górnego paska.
- Pulpit ma ikony, delikatnie różniące się tła i przychód naliczony za wybrany miesiąc
  (nie jest to kwota otrzymanych wpłat). „Wymaga uwagi” i zajęcia są na dole, w osobnych
  sekcjach z ograniczoną wysokością list. Ostatnich zawodników jest najwyżej pięciu,
  ze skrótem do pełnej listy.
- Obecności wpisują wyłącznie przypisani trenerzy; administrator ma podgląd, a API
  odrzuca jego próby wpisania obecności. Organizacja terminów pozostaje dostępna adminowi.
- Dodawanie dziecka ma krok danych dziecka i krok rodzica: wybór istniejącego albo
  utworzenie nowego z imieniem, nazwiskiem, emailem i telefonem. Nowy rodzic i dziecko
  są zapisywani atomowo. Istniejący email wymaga wyboru rodzica z listy, bez dublowania
  kont. Nowe konto rodzica nadal wymaga aktywacji linkiem.
- Nowa grupa ma stawkę 35 zł, bieżący aktywny sezon (przy kilku: najpóźniej rozpoczęty)
  i rozwijaną listę trenerów z możliwością wyboru kilku osób. Edycja zachowuje ustawienia.
- Rabat indywidualny ma wyszukiwanie zawodnika; trzeba wskazać osobę z wyników.
- Formularz publiczny nie ustawia fokusu na nagłówku przy otwarciu. Przy przechodzeniu
  między krokami nagłówek otrzymuje fokus bez niebieskiej ramki. Pola i przyciski
  zachowują widoczny fokus klawiatury.

### Klucze dostępu jako drugi składnik (migracja 15)

Administrator nadal wpisuje email i hasło. Jeśli dodał passkey, może potwierdzić
logowanie telefonem albo zgodnym kluczem sprzętowym. Authenticator i kody zapasowe
pozostają dostępne. Pierwsze dodanie klucza wymaga pełnego zalogowania obecną metodą.

Na Macu używaj stale tego samego adresu, np. `http://localhost:3000`. Po zalogowaniu
otwórz **Wygląd i logowanie → Dodaj telefon / klucz dostępu**, nazwij urządzenie,
naciśnij Zapisz i w oknie przeglądarki wybierz telefon/inne urządzenie. Przeglądarka
może wyświetlić QR; telefon potwierdza operację biometrią lub PIN-em. Dostępność
zależy od przeglądarki i urządzenia, a połączenie między urządzeniami może wymagać
Bluetooth. Nie jest to integracja wysyłająca powiadomienia push.

Dla publicznego wdrożenia ustaw `WEBAUTHN_ORIGIN=https://adres-panelu.example` na
rzeczywisty adres aplikacji i używaj HTTPS. Klucze są przypisane do domeny; zmiana
localhost na domenę produkcyjną wymaga ponownego dodania klucza. Nie wpisuj domeny
strony marketingowej, jeśli panel działa pod inną domeną.

Weryfikacja używa biblioteki SimpleWebAuthn, wymaga weryfikacji użytkownika,
sprawdza domenę/origin, podpis, licznik oraz jednorazowe wyzwanie związane z sesją
po haśle. Wyzwania wygasają po pięciu minutach i są usuwane przy wylogowaniu.
Klucz prywatny pozostaje na urządzeniu. Lista, dodawanie i usuwanie kluczy dotyczą
wyłącznie własnego konta administratora. Metoda nie osłabia blokady konta ani MFA.

Walidacja: 39 testów Node (38 w pełnym przebiegu i dodany test migracji), integracje
operations/foundations/security i 7 scenariuszy Playwright. Passkey sprawdzono
w Chromium na wirtualnym uwierzytelniaczu: rejestracja, drugi składnik, odrzucenie
obcego origin i starego potwierdzenia, brak dostępu przed drugim składnikiem,
usunięcie i powrót do Authenticatora. Parowanie z fizycznym telefonem pozostaje
do wykonania na urządzeniu użytkownika.
