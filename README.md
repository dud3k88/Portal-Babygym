# Evolution Academy — wersja deweloperska

Aplikacja internetowa do zapisów na zajęcia. Wymagany Node.js 24+; SQLite jest wbudowane w Node. Brak zależności zewnętrznych.

## Uruchomienie

```sh
cd /workspace/Portal-Babygym
npm ci
npm run dev
```

Serwer domyślnie nasłuchuje na interfejsie lokalnym, port 3000. `npm start` uruchamia bez obserwowania zmian. Zmienne: `HOST`, `PORT`, `DB_PATH`. Proces trzeba uruchomić ponownie w nowej sesji. Dane SQLite znajdują się w ignorowanym katalogu `data/`. Nie twórz dodatkowego worktree: korzystaj z istniejącego repozytorium w izolowanym środowisku zadania.

## Pierwsza próba

W Administracji utwórz lokalizację i grupę: podaj osobno datę początku i końca cyklu, dzień tygodnia oraz godziny rozpoczęcia i zakończenia. System tworzy wszystkie pasujące terminy włącznie z datami granicznymi (czas Europe/Warsaw, maksymalnie trzy lata). W podglądzie miesięcznym zobaczysz liczbę zajęć, kwotę i wykluczone daty. Starsze grupy i ich terminy pozostają zachowane. W zakładce zapisów wybierz lokalizację, grupę i miesiąc, podaj fikcyjne dane rodzica i dziecka. Wróć do Administracji, sprawdź należność i dodaj korektę z powodem. Kwoty są przechowywane w groszach. Wycenę serwer przelicza ponownie przy zapisie; minione terminy są pomijane. Ujemna korekta obniża należność.

## Walidacja

```sh
npm test
python test/smoke.py
```

Testy jednostkowe obejmują rozliczenia. Smoke test uruchamia własny serwer na porcie 3107 i bazę tymczasową, sprawdza pełny zapis, limit miejsc, korektę i zachowanie danych po restarcie. Nie modyfikuje bazy deweloperskiej.

## Zakres i ograniczenia

To pierwszy fragment aplikacji, wyłącznie do fikcyjnych danych. Brak logowania i rozdzielenia uprawnień — oba widoki są dostępne w tej samej sesji. Nie udostępniaj publicznie i nie wpisuj danych prawdziwych dzieci. Brak integracji płatniczej, wpłat i zwrotów: wyświetlane saldo oznacza należność plus korekty, a nie potwierdzenie płatności. Historia korekt korzysta z administratora testowego, nie uwierzytelnionej tożsamości.

Dostępne: tworzenie grup i automatycznych grafików tygodniowych, wykluczenia dni dla całego systemu, wybranych lokalizacji i grup, stawki i limit miejsc, ustawienie prób dla grupy z ceną także 0 zł, zapis i miesięczna wycena, korekty z historią oraz trwała baza.

Kolejne etapy: konta i uprawnienia, edycja grafiku, próby z osobnymi ustawieniami dla konkretnych terminów, przejście z próby na zapis stały bez podwójnego naliczenia, cykliczne rozliczenia kolejnych miesięcy, nieobecności, płatności i pełny rejestr salda klienta. Limit miejsc w prototypie liczony jest na grupę i miesiąc (w tym zapisy próbne); docelowo wymaga rozliczania dostępności na poszczególne terminy. Zapis stały w prototypie dotyczy wybranego miesiąca, bez automatycznego przedłużenia.

## Wykluczenia dni

W Administracji w sekcji „Dni bez zajęć” podaj zakres dat (dla jednego dnia obie daty są takie same), zakres działania i powód. Możesz wybrać wszystkie lokalizacje, kilka lokalizacji lub kilka grup. Święta nie są importowane automatycznie: administrator wybiera wykluczenia.

Wykluczenia nie kasują terminów; pozostają one widoczne jako przekreślone. Nie są dostępne na próby ani uwzględniane w nowych wycenach. Obowiązują też dla grup utworzonych później. Nakładające się wykluczenia nie liczą się podwójnie.

Dla istniejących zapisów system dodaje do historii automatyczną korektę za wykluczone, pierwotnie naliczone zajęcia (dla próby według jej ceny). Ręczne korekty pozostają zachowane. Usunięcie wykluczenia przywraca zajęcia i odpowiednią należność, o ile nie działa inne wykluczenie; dotyczy też przywróconych terminów w okresie zapisu, wykluczonych już w chwili zapisywania dziecka. Nie stanowi to zwrotu pieniędzy — operator płatności nie jest jeszcze podłączony.

Pierwsze uruchomienie nowej wersji uzupełnia schemat istniejącej bazy i przypisuje terminy do wcześniejszych zapisów. Przed aktualizacją zatrzymaj serwer i wykonaj kopię katalogu `data/`; nie zastępuj go bazą z innej instalacji.

## Aktualizacja na macOS

Zatrzymaj serwer klawiszami Control+C. Jeśli pobierasz ZIP z GitHuba, zachowaj dotychczasowy katalog `data/` i przenieś go do nowej kopii projektu po wykonaniu kopii zapasowej. W folderze nowej wersji uruchom `npm ci` i `npm run dev`. Jeśli używasz klona Git, po kopii bazy możesz użyć `git pull --ff-only` i uruchomić serwer ponownie.
