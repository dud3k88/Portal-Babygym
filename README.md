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

W Administracji utwórz lokalizację i grupę z przyszłymi terminami (jeden termin w wierszu, format `2026-11-04T13:00`, czas Europe/Warsaw). W zakładce zapisów wybierz lokalizację, grupę i miesiąc, podaj fikcyjne dane rodzica i dziecka. Wróć do Administracji, sprawdź należność i dodaj korektę z powodem. Kwoty są przechowywane w groszach. Wycenę serwer przelicza ponownie przy zapisie; minione terminy są pomijane. Ujemna korekta obniża należność.

## Walidacja

```sh
npm test
python test/smoke.py
```

Testy jednostkowe obejmują rozliczenia. Smoke test uruchamia własny serwer na porcie 3107 i bazę tymczasową, sprawdza pełny zapis, limit miejsc, korektę i zachowanie danych po restarcie. Nie modyfikuje bazy deweloperskiej.

## Zakres i ograniczenia

To pierwszy fragment aplikacji, wyłącznie do fikcyjnych danych. Brak logowania i rozdzielenia uprawnień — oba widoki są dostępne w tej samej sesji. Nie udostępniaj publicznie i nie wpisuj danych prawdziwych dzieci. Brak integracji płatniczej, wpłat i zwrotów: wyświetlane saldo oznacza należność plus korekty, a nie potwierdzenie płatności. Historia korekt korzysta z administratora testowego, nie uwierzytelnionej tożsamości.

Dostępne: tworzenie grup i terminów, stawki i limit miejsc, ustawienie prób dla grupy z ceną także 0 zł, zapis i miesięczna wycena, korekty z historią oraz trwała baza.

Kolejne etapy: konta i uprawnienia, edycja grafiku, próby z osobnymi ustawieniami dla konkretnych terminów, przejście z próby na zapis stały bez podwójnego naliczenia, cykliczne rozliczenia kolejnych miesięcy, nieobecności, odwołania zajęć, płatności i pełny rejestr salda klienta. Limit miejsc w prototypie liczony jest na grupę i miesiąc (w tym zapisy próbne); docelowo wymaga rozliczania dostępności na poszczególne terminy. Zapis stały w prototypie dotyczy wybranego miesiąca, bez automatycznego przedłużenia.
