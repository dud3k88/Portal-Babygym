# Zbiorcza aktualizacja bez integracji zewnętrznych

Zakres: lokalna aplikacja Node.js/SQLite. Nie uruchomiono operatora płatności,
wysyłki email ani SMS. Zaksięgowanie wpłaty, oznaczenie zwrotu i oznaczenie wypłaty
są ewidencją operacji wykonanej poza aplikacją. Nie wykonują przelewów.

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
| 2 Grupy/sprzęt | Podstawowe operacje i sprzęt działają; pozostały dodatkowe parametry wieku/typu/opisu grup, zdjęcia sprzętu, przyszłe masowe kontynuacje, pełne łączenie/dzielenie grup i jawny wyjątek limitu. |
| 3 Kartoteki | Import/eksport, kontrolowane połączenie i zgody działają; pozostały własne pola formularza, walidacja wieku grup, łączenie konfliktujących historii i kont rodziców, konfiguracja osadzania WordPress. |
| 4 Kalendarz | Dziennik i realizacja działają; pozostały statystyki frekwencji, pełny zestaw filtrów UI, przesunięcia między miesiącami i zmiana cyklu od dowolnej przyszłej daty. |
| 5 Rodzic | Dostęp do własnych danych, rozmów, zgód i postępów działa; automatyczne przypomnienia i pulpit zbiorczy wymagają rozwinięcia. |
| 6 Rozliczenia | Księga, import, cenniki i naliczanie działają; pozostały historyczny VAT, terminy płatności per pozycja, automatyczne wpisowe/przypomnienia, propozycje dopasowań bankowych. Operator online wyłączony zgodnie z poleceniem. |
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
