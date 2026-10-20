# Etap 3B — kontynuacja próby i lista rezerwowa

## Działanie dla rodzica

- Zapisy publiczne nadal zaczynają się od lokalizacji i grupy. Przy braku miejsc
  zamiast zapisu można wybrać **Listę rezerwową**. Powstaje konto, kartoteka dziecka
  i zgłoszenie, bez naliczenia opłaty oraz bez udziału w grupie.
- Zalogowany rodzic może dołączyć do kolejki z formularza zapisów. Zgłoszenie jest
  powiązane z istniejącym dzieckiem; nie tworzy drugiej kartoteki.
- W **Moich dzieciach** i **Kartotece → Grupy** widzi pozycję albo ofertę z terminem
  potwierdzenia. Oferta rezerwuje miejsce. **Przyjmij miejsce** pokazuje aktualną
  należność za pozostałe zajęcia bieżącego miesiąca. Potwierdzenie tworzy zapis stały.
  Zmiana kwoty lub miesiąca wymaga ponownego sprawdzenia podsumowania.
- Z kolejki można zrezygnować. Nieprzyjęta oferta wygasa; kolejną otrzymuje następne
  zgłoszenie. Powrót do kolejki oznacza nowe miejsce na jej końcu.
- Po zajęciach próbnych przycisk **Przejdź na zapis stały** pokazuje wycenę.
  Bez potwierdzenia nie powstaje stały zapis ani nowe naliczenie. Ustawiona wcześniej
  cena próby, również zero, pozostaje w jej osobnym rozliczeniu.
- Próba zajmuje miejsce do terminu potwierdzenia. Po wygaśnięciu kontynuacja wymaga
  wolnego miejsca; oferty już wystawione innym osobom mają pierwszeństwo. Gdy brak
  miejsca, rodzic może dołączyć do kolejki.

## Administrator i terminy

**Lista rezerwowa** pokazuje bieżące zgłoszenia oraz opcjonalnie historię.
Kolejkę widać też wewnątrz grupy. Administrator może przyjąć ofertę lub anulować
zgłoszenie w imieniu dziecka; nie może przestawiać kolejności.

Na tej samej stronie ustawisz czas potwierdzenia po próbie i ważność oferty miejsca:
**domyślnie po 24 godziny**, zakres 1–168 godzin. Ustawienia dotyczą nowych prób/ofert;
nie skracają już przyznanych terminów. Czas liczony jest w rzeczywistych godzinach,
wyświetlany według Europe/Warsaw, również przy zmianie czasu letniego.

Próba liczy czas potwierdzenia od końca zajęć. Dla starszych terminów bez godziny
zakończenia przyjmowana jest godzina po rozpoczęciu. Zmiana godziny istniejącego
terminu próbnego aktualizuje niewygasłą rezerwację, zachowując przyznaną długość
okna potwierdzenia. Odwołanie terminu podlega dotychczasowym korektom opłat; samo
odwołanie nie zmienia terminu decyzji po próbie.

Zamknięcie grupy/placówki/sezonu lub brak pozostałych zajęć w bieżącym miesiącu
wstrzymuje oferty: aktywne wracają do oczekiwania z zachowaniem kolejności.
Po ponownym otwarciu otrzymują nowe okno potwierdzenia. Uczestników próbnych nie
obsługuje rezygnacja miesięczna — mają własny termin decyzji. Zapis stały nadal
podlega zaakceptowanej zasadzie rezygnacji z końcem miesiąca bez zmiany jego opłaty.

## Rozliczenia i bezpieczeństwo

- Konwersja tworzy osobne regularne naliczenie za przyszłe terminy tego miesiąca.
  Zachowuje oryginalny zapis próbny, kwotę, korekty, płatnika oraz okres uczestnictwa.
  Próba i zapis stały mogą więc mieć dwie pozycje w historii rozliczeń tego samego
  miesiąca; dziecko nadal ma jedną kartotekę i jedno bieżące przypisanie do grupy.
- Cena próby nie jest naliczana ponownie. Konwersja nie obejmuje odbytych zajęć
  ani samego terminu próby. Przy ponowieniu potwierdzenia zwracany jest poprzedni
  wynik, bez drugiej należności i bez kolejnego okresu.
- Oferty są przydzielane według kolejności utworzenia zgłoszeń (ID), bez opłat
  i bez automatycznego zapisywania dziecka. Blokada konta płatnika pomija jego
  oczekujące zgłoszenie; przyjęcie oferty wymaga aktywnego konta płatnika.
- Liczba miejsc uwzględnia aktywny udział, niewygasłe próby oraz zarezerwowane oferty.
  Ograniczenie działa w API, także podczas równoczesnych potwierdzeń i zmniejszania
  limitu grupy. Zapisy publiczne po hashowaniu hasła ponownie sprawdzają kolejkę.
- Rodzina widzi własne zgłoszenia i ich pozycje, bez danych innych rodzin. Trener
  nie otrzymuje listy rezerwowej, rozliczeń ani ustawień ofert. Administrator ma
  pełny podgląd; zmiany podlegają istniejącemu audytowi.
- Stan czasowy jest uzgadniany przy żądaniach API oraz zmianach grafiku/otwarcia
  zapisów. Po restarcie działa na zapisanych terminach. Nie ma procesu wysyłającego
  powiadomienie o godzinie wygaśnięcia; rodzic sprawdza panel. Brak emaili, SMS
  i rzeczywistych płatności w tym etapie.

## Migracja i aktualizacja

Migracja 6 dodaje `admission_settings`, `trial_decisions`, `waiting_list`, indeksy
unikalności otwartego zgłoszenia i audyt. Jest transakcyjna, sprawdza klucze obce,
nie zmienia wcześniejszych należności. Start przypisuje dotychczasowym aktywnym
próbom termin decyzji: koniec zajęć + ustawione godziny, a jeśli zajęcia już minęły —
czas pierwszego uruchomienia nowej wersji + ustawione godziny. To jednorazowy okres
przejściowy; restart nie przedłuża go. Historia próby pozostaje zachowana.

Przed aktualizacją zatrzymaj aplikację i zrób pełną kopię zgodnie z
[OPERACJE.md](OPERACJE.md). Sprawdź migrację na kopii danych. Wycofanie wymaga
poprzedniej wersji kodu oraz kopii bazy sprzed migracji: starszy kod nie uwzględnia
rezerwowanych ofert. Nie usuwać ręcznie tabel ani pozycji rozliczeń.

## Weryfikacja i dalszy zakres

`test/admissions.test.js` sprawdza czas letni/zimowy i migrację z rollbackiem.
`python3 test/admissions.py` sprawdza konwersję, powtórzenia, błędną kwotę i rollback,
historię, FIFO, restart na granicy terminu, rezerwację miejsca, równoczesne przyjęcie,
zamknięcie zapisów, ustawienia i publiczne dołączenie bez należności.
`e2e/admissions.spec.js` sprawdza rzeczywisty formularz publiczny, ofertę, potwierdzenie,
konwersję po próbie, ustawienia i widok mobilny. Pozostałe testy stanowią regresję.

Dalsze elementy specyfikacji: zawieszenia/przenosiny, datowane cenniki, zgody,
import/eksport, dziennik obecności, automatyczne naliczenia miesięczne i komunikacja.
Nie są oznaczone jako gotowe przez ten etap.
