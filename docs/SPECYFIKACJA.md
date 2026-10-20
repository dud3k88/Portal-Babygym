PROMPT DO CODEXA — EVOLUTION ACADEMY
Jesteś głównym architektem i programistą full-stack rozwijającym istniejący system Evolution Academy. Pracuj bezpośrednio w aktualnie otwartym repozytorium. Twoim zadaniem jest rozbudować istniejący produkt, nie tworzyć drugiej aplikacji ani przepisywać go od zera. Poniżej znajduje się zatwierdzona specyfikacja. Realizuj ją etapami, z naciskiem na integralność danych, bezpieczeństwo dzieci i rozliczeń oraz spójny interfejs.
0. TRYB PRACY — NAJPIERW AUDYT, POTEM IMPLEMENTACJA
1. Przeanalizuj repozytorium: framework, język, routingi, komponenty, design system, autoryzację, role, schemat bazy, migracje, modele, API, storage, testy, deployment i zmienne środowiskowe. Sprawdź też README i dostępne dokumenty. Nie zakładaj, że projekt korzysta z Next.js, Supabase czy konkretnego dostawcy.
2. Opracuj tabelę ISTNIEJE / DZIAŁA CZĘŚCIOWO / BRAKUJE / WYMAGA REFAKTORU dla wszystkich modułów 1–10. Wskaż konflikty, ryzyka migracji i zależności między modułami. Nie usuwaj istniejących danych ani funkcji bez uzasadnienia.
3. Na podstawie audytu zaproponuj etapowy plan wdrożenia, priorytety i kolejność migracji. Najpierw fundamenty: dostęp, model danych, placówki, grupy, uczestnicy; później kalendarz, rozliczenia, komunikacja, kadry, raporty i metodyka. Nie zatrzymuj się na samej analizie: rozpocznij implementację pierwszego bezpiecznego etapu, jeżeli repozytorium jest dostępne. Po każdym etapie podaj wykonane zmiany, testy, niezaimplementowany zakres i kolejny etap. Nie twierdź, że całość jest gotowa, jeśli zrobiono tylko część.
4. Zachowaj działające moduły, adresy URL, dane i komponenty, o ile nie ma technicznej konieczności zmiany. Przed migracjami destrukcyjnymi przygotuj plan backupu, migracji i wycofania zmian; nie niszcz danych produkcyjnych. Sekrety i klucze integracji pobieraj ze zmiennych środowiskowych, nigdy nie wpisuj ich w kodzie.
5. Wszystkie moduły muszą korzystać z jednej bazy prawdy. Nie duplikuj kartotek dzieci, terminów, sald, obecności ani kosztów. Stosuj transakcje i idempotencję przy krytycznych operacjach. Przygotuj testy jednostkowe, integracyjne i E2E najważniejszych procesów.
6. W miejscach, gdzie wymagane są nieudostępnione klucze API/operatorzy lub wybory wdrożeniowe, implementuj poprawny interfejs integracji, konfigurację, tryb testowy/mock i dokumentację konfiguracji; nie udawaj realnych płatności czy wysyłek.
7. Interfejs po polsku, responsywny (telefon/tablet/komputer), czytelny, zgodny z istniejącą stylistyką Evolution Academy. Domyślny język PL, waluta PLN, strefa Europe/Warsaw i poprawna obsługa czasu letniego, kwot w groszach/typie decimal i dat lokalnych.
1. ROLE, UWIERZYTELNIANIE I UPRAWNIENIA
W całym produkcie istnieją dokładnie trzy role:
- Administrator — główne konto z pełnym dostępem do systemu, użytkowników, przedszkoli, grup, uczestników, harmonogramów, komunikacji, cenników, finansów, wynagrodzeń, raportów, metodyki i konfiguracji.
- Trener — ma wyłącznie własny grafik i zastępstwa, listę dzieci przypisanych grup, sprawdzanie i korekty obecności, dane kontaktowe rodziców tych dzieci, notatki o swoich uczestnikach, zgłaszanie dyspozycyjności, niedostępności i gotowości do zastępstw, podgląd własnego wynagrodzenia, materiały szkoleniowe, ocenę postępów dzieci z własnych grup i statystyki tych grup. Może komunikować się wewnętrznie z Administratorem, ale nie może wysyłać wiadomości do rodziców.
- Rodzic — dostęp wyłącznie do powiązanych dzieci: profil, drugi opiekun, zapisy, harmonogram, historia obecności, zgłaszanie nieobecności, rezygnacja, należności/saldo, płatności online, powiadomienia, kontakt z Administratorem, opublikowane postępy, dyplomy, materiały, zgody i SOM.
Nie dodawaj ról Team Leader, Koordynator, Księgowość, Marketing itp. Konta indywidualne, odzyskiwanie hasła; MFA obowiązkowe dla Administratora. Wszystkie uprawnienia egzekwuj po stronie API/bazy, nie tylko przez ukrywanie przycisków. Powiązanie dzieci z wieloma zweryfikowanymi opiekunami i możliwość osobnych kont. Historia zmian dostępu i działań administracyjnych.

Rodzic NIE ma: upoważnień do odbioru, odrabiania zajęć, pobierania faktur ani potwierdzeń księgowych. Nie dodawaj fakturowania również Administratorowi. Rodzic nie widzi innych dzieci, notatek wewnętrznych czy finansów firmy.
2. PRZEDSZKOLA, GRUPY I SPRZĘT
2.1. Przedszkola i lokalizacje
- Kartoteka: nazwa, adres, miejscowość, stabilny ID; telefon, e-mail, osoba kontaktowa.
- Status: aktywne / wstrzymane / archiwalne; archiwizacja zachowuje historię uczestników, grup, płatności i kosztów.
- Koszty najmu sali: stawki, okresy obowiązywania i historia zmian; dodatkowe zasady kosztów szczegółowo w module 9.
- Lista przypisanych trenerów, notatki administracyjne oraz statystyki placówki: grupy, uczestnicy, obłożenie, przychody/koszty/wynik.
- Nie buduj podziału na oddziały/regiony, systemu wielu sal w jednym przedszkolu ani repozytorium dokumentów placówki.
Rejestr sprzętu — zbiorczy dla Administratora i widok dla każdej placówki:
- Nazwa, kategoria, ilość, zdjęcie, opis; przypisanie do przedszkola.
- Przenoszenie między przedszkolami z historią kto/kiedy/skąd/dokąd/ile.
- Stan: sprawny / uszkodzony / do wymiany / wycofany; inwentaryzacja rzeczywistych ilości i różnic.
- Zgłaszanie braków, uszkodzeń i napraw; Trener widzi sprzęt swoich przypisanych placówek i może zgłaszać braki; Rodzic bez dostępu.
- Nie buduj modułu zakupu/cen/wartości sprzętu ani etykiet QR.
2.2. Definicja grup zajęciowych — wszystkie funkcje obowiązkowe
- Nazwa, rodzaj zajęć, własny opis dla rodzica, wiek od/do, limit miejsc, obłożenie, jedna placówka, trener prowadzący i opcjonalny zastępca.
- Status: planowana / aktywna / wstrzymana / zakończona.
- Harmonogram cykliczny (dzień tygodnia, od/do, jednostka 30/45/60 min lub własna), generowanie terminów; ferie, święta, zamknięcia, wyjątki; zmiana jednego terminu lub całego cyklu od wybranej daty.
- Sezony szkoleniowe (np. 2026/2027) i kontynuacja na kolejny sezon.
- Administrator otwiera/zamyka zapisy. Automatyczny zapis rodzica przy wolnym miejscu bez ręcznej akceptacji; kontrola limitu atomowa, bez nadrezerwacji. Automatyczna lista rezerwowa. Bezpłatne uczestnictwo próbne i przejście na regularne.
- Lista dzieci: aktywni/próbni/wypisani z historią przypisań. Cennik za jednostkę z datami obowiązywania. Statystyki: obłożenie, frekwencja, rezygnacje, zmiany liczebności.
2.3. Operacje na grupach i zapisach
- Duplikowanie grupy np. na nowy sezon, łączenie i dzielenie grup (z pełną historią), zmiana trenera od daty, wstrzymanie/wznowienie, zamknięcie/archiwizacja.
- Ręczne dopisanie uczestnika przez Administratora, przenoszenie pojedynczych dzieci i masowe przenoszenie np. na kolejny sezon, konwersja próbny→regularny, obsługa listy rezerwowej.
- Administrator może wyjątkowo przekroczyć limit z wyraźnym potwierdzeniem i audytem; zwykły zapis rodzica nie może przekroczyć limitu.
- Zawieszenie udziału, rezygnacja z datą skuteczną i powodem, przywracanie bez nowej kartoteki.
- Powiadomienia o zmianach, nieusuwalny dziennik kto/co/kiedy, eksport uczestników Excel/CSV.
- Nie buduj przenoszenia całej grupy do innego przedszkola ani ręcznego zmieniania kolejności listy rezerwowej (automatycznie według czasu zapisu, z bezpieczną obsługą ofert miejsca).
- Wszystkie operacje zachowują historię zajęć, obecności, opłat i powiązań.
3. ZAPISY I KARTOTEKI UCZESTNIKÓW
- Publiczny, mobilny formularz bez logowania, wybór placówki i dostępnej grupy, bezpośrednie linki do placówki/grupy, osadzenie na WordPressie.
- Rodzaj zapisu: bezpłatny próbny albo regularny, walidacja wieku, własne pola definiowane przez Administratora, e-mail z potwierdzeniem, zapis rodzeństwa bez ponownego wpisywania danych opiekuna.
- Jedna kartoteka dziecka w całym systemie: imię, nazwisko, data urodzenia, przedszkole i grupa przedszkolna, grupy Evolution Academy; powiązanie z wieloma opiekunami o własnych kontach; imiona, telefony i e-maile opiekunów.
- Historia zapisów/prób/zawieszeń/przenosin/rezygnacji, obecności i osiągnięć; notatki wewnętrzne Administratora, a osobno uprawnione notatki Trenera do własnych uczestników.
- Wykrywanie i kontrolowane łączenie duplikatów kartotek dzieci/opiekunów bez utraty historii, ręczna edycja, wyszukiwarka, filtry (wiek, status, przedszkole, grupa, sezon, typ zapisu), import i eksport Excel/CSV z walidacją, mapowaniem oraz raportem błędów.
- Regulamin — zapis wersji i potwierdzenia; informacja RODO; niezależne, dobrowolne zgody na zdjęcia/nagrania oraz marketing; możliwość wycofania, historia tekstu, wersji, dat i sposobu wyrażenia zgody.
- SOM — Standardy Ochrony Małoletnich: wersjonowany dokument dostępny podczas zapisu i w Panelu Rodzica, wyraźne potwierdzenie zapoznania się, data i wersja; nie mieszaj z dobrowolnymi zgodami marketingowymi. Dokładny tekst i konstrukcja prawna dokumentu muszą pochodzić od organizatora, nie generuj pozornej zgodności z prawem.
- Zabezpieczenie przed dostępem do cudzych dzieci i zbędnym udostępnianiem danych.
- Nie dodawaj osobnego pola/modułu „Uwagi organizacyjne” ani plików/załączników w kartotece dziecka. Pliki metodyczne i konspekty należą do innego modułu.
4. HARMONOGRAM, KALENDARZ I OBECNOŚCI
- Administrator: kalendarz całej akademii, dzień/tydzień/miesiąc, filtry: lokalizacja, grupa, trener, data, status.
- Trener: tylko własny grafik i zastępstwa. Rodzic: kalendarz tylko własnych dzieci. Ostrzeganie o konfliktach terminów trenera.
- Elektroniczna lista obecności również dla dzieci na próbach; stan obecny / nieobecny / niezgłoszony oraz oznaczenie zgłoszenia nieobecności przez rodzica. Korekty przez Trenera/Administratora z audytem. Rodzic zgłasza nieobecność na konkretny termin. Trener potwierdza zrealizowanie zajęć.
- Statystyki frekwencji dziecka, grupy, placówki i trenera.
- Administrator odwołuje pojedynczy termin z powodem, przesuwa jeden termin lub zmienia harmonogram od daty; dni wolne są pomijane. Zastępcy przypisywani przez Administratora; Trener zgłasza chęć zastępstwa i niedostępność, bez samodzielnego przydziału.
- Odwołanie powiązane z korektą opłat; automatyczne powiadomienia o odwołaniu, zmianie dnia/godziny/trenera. Rodzicielskie zgłoszenie nieobecności widoczne w dzienniku Trenera. Lista brakujących obecności/potwierdzeń dla Administratora. Zrealizowane i zatwierdzone zajęcia zasilają ewidencję godzin i wynagrodzenia.
- Nie buduj eksportu/drukowania kalendarza, notatek do pojedynczych terminów, alertów częstych nieobecności, tworzenia dodatkowych jednorazowych zajęć ani przypomnień przed każdymi zajęciami.
5. PANEL RODZICA
- Responsywny pulpit: najbliższe terminy, należności, saldo, powiadomienia. Przełączanie między dziećmi, zaproszenie drugiego opiekuna po weryfikacji, samodzielna edycja danych kontaktowych, reset hasła.
- Zapisy z panelu, potwierdzenie przejścia z bezpłatnej próby na regularne uczestnictwo, status próbny/aktywny/oczekujący/zawieszony/zakończony, lista rezerwowa i komunikat o zwolnieniu miejsca.
- Formularz rezygnacji z powodem i informacją o skutecznej dacie; kalendarz, zgłoszenia nieobecności, frekwencja, opublikowana karta postępów, dyplomy i podsumowania.
- Aktualne saldo, rozbicie miesięcznej opłaty, płatność online, historia płatności, nadpłaty, korekty, przypomnienia o należnościach.
- Centrum powiadomień, formularz do Administratora, historia korespondencji, materiały dla rodziców, dobrowolne zgody z możliwością wycofania, aktualne SOM i historia potwierdzeń.
- Nie dodawaj preferencji powiadomień kontrolowanych przez rodzica, powiadomień o nowych ocenach/postępach ani FAQ. Rodzic nie ma odrabiania zajęć, upoważnień do odbioru, faktur ani potwierdzeń księgowych.
6. PŁATNOŚCI I ROZLICZENIA
Naliczanie
- Co miesiąc automatycznie naliczaj za planowane, płatne terminy przypadające w okresie aktywnego zapisu, zgodnie z ceną grupy i obowiązującymi zasadami. Obsługuj datę rozpoczęcia w środku miesiąca, bezpłatne próby, cenniki różne dla grup i historię zmian cen.
- Roczne wpisowe na uczestnika według konfigurowalnej kwoty, sezonu, dat i zwolnień. Roboczo 35 zł za 30 min, 99 zł rocznego wpisowego, ale NIC z tego nie może być wpisane na stałe. Miesięczny cykl rozliczeniowy. Konfigurowalne stawki VAT/zwolnienia na pozycjach, bez zakładania, jaka stawka prawnie obowiązuje.
- Indywidualne rabaty procentowe/kwotowe. Automatyczne korekty za odwołane zajęcia, możliwość przeniesienia na kolejny miesiąc, ręczna korekta Administratora z powodem; rozliczanie rezygnacji, zawieszeń i przeniesień między grupami; nadpłaty i zatwierdzane zwroty środków.
- Brak umarzania należności oraz brak automatycznych rabatów dla rodzeństwa. Brak wspólnego salda rodziny — saldo i należności przypisane do właściwego dziecka/uczestnictwa i płatnika, choć jeden opiekun może mieć kilkoro dzieci.
Wpłaty i integracje
- Płatności online przez konfigurowalnego operatora, z obsługą BLIK, szybkich przelewów, kart oraz Apple Pay i Google Pay, jeśli umożliwia to aktywna konfiguracja operatora i urządzenie. Wybór operatora (np. Przelewy24, PayU, Stripe) podejmij dopiero po audycie i ocenie opłat/SDK; nie implementuj trzech produkcyjnych integracji bez potrzeby. Portfele realizuj przez operatora, bez przechowywania danych kart.
- Bezpieczne webhooki/callbacki, weryfikacja podpisu, idempotencja, ochrona przed podwójną wpłatą. Płatność oznaczaj jako potwierdzoną wyłącznie po autorytatywnym sygnale z operatora, a nie po wejściu na stronę powrotu.
- Tradycyjny przelew z czytelnym tytułem i numerem rachunku, ręczne księgowanie, import wyciągów i proponowane dopasowania do należności z ręcznym rozstrzyganiem niejednoznaczności. Obsługa płatności częściowych, historii i terminów płatności, wyliczanie zaległości, nadpłat.
- Nie wdrażaj subskrypcyjnego automatycznego obciążania zapisanej karty.
Administracja i komunikacja
- Panel finansowy Administratora: należności/wplaty/zaległości/korekty/nadpłaty/zwroty; masowe generowanie rozliczeń dla firmy, przedszkola, grupy; historia autora/dat/powodów operacji i eksport Excel/CSV.
- Powiadomienia o nowych naliczeniach, przypomnienia automatyczne o zaległościach; masowe wysyłanie zalegającym po filtrowaniu placówki/miesiąca/kwoty/dni opóźnienia, wyborze adresatów, podglądzie, ponownej weryfikacji aktualnego długu i zabezpieczeniu przed duplikatami. Obsługa SMS/e-mail według konfiguracji Administratora.
- Panel Rodzica pokazuje rozliczenia, saldo, historię, korekty i możliwość zapłaty, ale NIE wystawia i nie udostępnia faktur/potwierdzeń. Nie dodawaj fakturowania przez Administratora.
Niezmienniki finansowe: kwoty przechowuj jako decimal/grosze, nigdy float; operacje księguj transakcyjnie; korekty jako śledzalne wpisy, nie ciche nadpisania. Ponowne naliczenie, webhook lub import nie może naliczyć tej samej pozycji dwa razy. Rozróżniaj należności, przychód należny i otrzymaną gotówkę.
7. PRACOWNICY, TRENERZY I WYNAGRODZENIA
- Kartoteka Trenera (imię, nazwisko, telefon, e-mail, ID), powiązana z kontem; status aktywny/nieaktywny/archiwalny z blokadą dostępu, rodzaj współpracy (zlecenie/B2B/etat/inny), daty rozpoczęcia/zakończenia, przypisanie do wielu przedszkoli.
- Własny grafik i zastępstwa. Jednorazowa i cykliczna dyspozycyjność, niedostępność, zatwierdzanie wpływających na grafik nieobecności przez Administratora, propozycje zastępstw, konflikty. Ewidencja faktycznie zrealizowanych zajęć.
- Stawki Trenera na jednostkę 30 min lub godzinę, możliwe różne stawki na placówkę/rodzaj zajęć, historia datowanych stawek. Wynagrodzenie naliczane z potwierdzonych faktycznie przeprowadzonych zajęć, zastępstw i konfigurowalnych wyjątków dla odwołanych zajęć — nie wyłącznie z planowanego harmonogramu.
- Automatyczne premie według konfigurowalnego modelu obłożenia/rezygnacji (nie wymyślaj niezatwierdzonego wzoru; przygotuj edytowalne reguły i parametry), ręczne premie oraz uzasadnione korekty/potrącenia, netto/brutto zgodnie z rodzajem współpracy i ustaloną metodą prezentacji. Nie udawaj pełnego systemu kadrowo-płacowego lub automatycznego wyliczania zobowiązań publicznoprawnych bez odpowiednich danych i zweryfikowanych reguł.
- Miesięczne zestawienie jednostek, godzin, stawek, premii/korekt; zatwierdzanie i zamykanie okresu przez Administratora, status/data/kwota wypłaty; Trener widzi jedynie własne rozliczenia.
- Raport miesięczny trenera, koszt przypisany do przedszkoli, zbiorcze rozliczenie wszystkich, eksport Excel/CSV, audyt zmian.
- Nie buduj dokumentów pracowniczych, ewidencji kwalifikacji/szkoleń, ewidencji godzin niezwiązanych z zajęciami ani powiadomień o opublikowaniu nowych rozliczeń Trenera.
8. KOMUNIKACJA I AUTOMATYZACJE
- Administrator: pojedyncze i masowe SMS/e-mail z formatowaniem e-maila i identyfikacją Evolution Academy; odbiorcy wybierani ręcznie lub filtrami (grupa, przedszkole, status, sezon); szablony i zmienne personalizacji; podgląd, licznik znaków/liczby części/kosztu SMS, załączniki e-mail, harmonogram wysyłek na konkretną datę i godzinę.
- Automatyzacje: potwierdzenie zapisu, wiadomość po próbie z zachętą do kontynuacji, wolne miejsce na liście rezerwowej, zmiana grupy/trenera/terminu, odwołanie zajęć, nowe naliczenie, automatyczne oraz masowe przypomnienia o zaległościach, potwierdzenie rezygnacji i zgłoszenia nieobecności.
- Rodzic może kontaktować się z Administratorem przez formularz/wątki. Centralna skrzynka, statusy nowe/w toku/oczekuje/zamknięte, kategorie, historia, odpowiedzi Administratora i powiadomienie o odpowiedzi. Wewnętrzne wiadomości Trener↔Administrator dozwolone; Trener→Rodzic zabronione.
- Centrum powiadomień w panelach, konfigurowalne przez Administratora kanały (SMS, e-mail, w aplikacji) i włączniki poszczególnych automatyzacji; historia wiadomości, statusy dostarczenia według operatora, kontrolowane ponawianie z idempotencją, blokada duplikatów, dziennik automatyzacji, statystyki i koszty komunikacji. Marketing wyłącznie z właściwą aktualną zgodą; komunikaty organizacyjne oddzielone od marketingu.
- Nie wdrażaj życzeń urodzinowych, automatycznych przypomnień przed każdymi zajęciami, czatu na żywo ani powiadomień o nowych rozliczeniach Trenerów.
- W trybie deweloperskim nie wysyłaj faktycznych SMS/e-maili do rodziców; korzystaj z sandbox/test provider i jawnych oznaczeń.
9. FINANSE FIRMY, RENTOWNOŚĆ I RAPORTY
Źródła danych i koszty
- Raportuj oddzielnie naliczone przychody (z korektami, rabatami, wpisowym), rzeczywiste wpływy, kwoty brutto/netto/VAT. Nie traktuj samej wpłaty jako nowego przychodu po wcześniejszym naliczeniu.
- Koszty trenerów z zatwierdzonych rozliczeń, premie; koszt sal według stawek i faktycznie płatnych bloków czasu, z obsługą minimum najmu, sprzątania, opłat stałych, wyjątków i wspólnych bloków bez podwójnego naliczania wspólnego kosztu.
- Ręcznie wprowadzane koszty (np. leasing, księgowość, materiały, usługi), edytowalne kategorie, koszty cykliczne. Wydzielona ewidencja VAT, podatku dochodowego i ZUS jako obciążeń/zobowiązań; nie mieszaj podatków z kosztami operacyjnymi w sposób powodujący podwójne odjęcia.
- Koszt przypisany do konkretnej placówki albo całej firmy. Nie buduj automatycznego dzielenia kosztów ogólnych między przedszkola.
Analityka
- Rentowność i marża przedszkola oraz pojedynczej grupy, wynik całej Evolution Academy, ranking lokalizacji, miesiąc do miesiąca i sezon do sezonu, próg rentowności (minimalna liczba płacących uczestników).
- Prognozy wyniku i przepływów pieniężnych wyprowadzane z zapisów, harmonogramu, należności oraz przewidywanych kosztów. Nie twórz osobnego modułu budżetów i planowanych kosztów.
- Raport obłożenia grup i placówek, historia obłożenia, nowe zapisy, rezygnacje z powodami, rotacja i retencja, konwersja próbnych do regularnych, frekwencja, kolejka oczekujących, automatyczne alerty spadku obłożenia, wykresy trendów.
- Pulpit KPI dla Administratora: przychód, wpływy, koszty, wynik, uczestnicy, obłożenie, zaległości. Filtry: miesiąc, zakres dat, przedszkole, grupa, trener, sezon. Wykresy interaktywne, możliwość zejścia do źródła obliczeń (drill-down), kreator własnych raportów (kolumny, filtry, miary, grupowania).
- Eksport Excel/CSV/PDF, historia raportów, zamknięcie miesiąca z niezmiennym snapshotem danych i możliwością jawnej korekty po zamknięciu, import finansowych Excel/CSV z mapowaniem oraz wykrywaniem duplikatów i historią importu.
- Nie buduj dzielenia kosztów ogólnych między placówki, modułu budżetu ani automatycznej cyklicznej wysyłki raportów e-mailem.
- Zdefiniuj i udokumentuj dokładne formuły: obłożenie, rezygnacje, retencja, konwersja, przychód, marża, próg rentowności; żadnego podwójnego liczenia dzieci w obrębie miar dotyczących unikalnych uczestników, terminów, wspólnego najmu czy importów.
10. METODYKA, PROGRAMY, KONSPEKTY, POSTĘPY I KARTY PRZYGODY
- Biblioteka programów (np. Akrobatyka, Gimnastyka, Motoryka), osobne warianty wiekowe, etapy szkolenia, umiejętności z kryteriami, przypisanie programu do grupy i sezonu, plan tematów na kolejne tygodnie.
- Biblioteka konspektów ze strukturą: rozgrzewka, część główna, zabawy, zakończenie; czas ćwiczeń i wymagany sprzęt. Obsługa PDF, obrazów i wideo oraz filtrów po wieku, typie zajęć, umiejętności i kategorii. Trener może tworzyć prywatne konspekty. Możliwość generowania/drukowania konspektów PDF.
- ISTOTNE: istniejące konspekty już są w formacie PDF. Zaimplementuj import pojedynczy i masowy tych plików, bez obowiązku przepisywania ich treści: bezpieczny podgląd w Panelu Trenera, nazwa, tagi, wiek, program, grupa, tydzień/etap, opcjonalny opis i lista potrzebnego sprzętu. Nie zakładaj OCR ani automatycznego parsowania PDF jako wymogu.
- Trener ocenia poziom umiejętności dzieci własnych grup (np. nie rozpoczęto / w trakcie / opanowano), historia z autorem i datą, komentarze, automatyczne podsumowanie, zbiorcze postępy grupy. Rodzic widzi tylko wyraźnie udostępnione mu oceny i komentarze. Generowanie dyplomów/certyfikatów i podsumowań PDF.
- Cyfrowe Karty Przygody według wieku (istniejące projekty przewidują 35 pól) i Karty Bohaterów: lis, żyrafa, zając, żółw, foka, małpka. Pieczątki tylko za potwierdzoną obecność; idempotentne przyznanie po zmianie statusu i prawidłowe rozliczenie korekty obecności. Karty widoczne w Panelu Rodzica i możliwe do wydrukowania.
- Biblioteka materiałów dla Rodziców: publikacja przez Administratora, przypisanie do grup, pobieranie udostępnionych plików; dostęp zgodny z rolami.
- Nie buduj wersjonowania programów, ulubionych materiałów, zatwierdzania konspektów, rankingów/porównywania dzieci, dodatkowych pieczątek za osiągnięcia, nagród za etapy, statystyk wyświetleń materiałów ani funkcji zgłaszania propozycji metodycznych.
11. ARCHITEKTURA, BEZPIECZEŃSTWO I JAKOŚĆ
- Stos technologiczny ustal po audycie. Jeśli obecny jest odpowiedni, rozwijaj go. Jeśli repo wymaga dopiero fundamentu, zaproponuj np. TypeScript + Next.js + PostgreSQL; Supabase (Auth/DB/Storage) wyłącznie jako opcja po ocenie projektu. Nie migruj technologii tylko dla mody.
- Zaprojektuj spójne encje/powiązania (dopasuj do zastanego modelu): users, roles, parent_child_access, parents, children, preschools, trainers, trainer_assignments, seasons, groups, group_schedules, lesson_occurrences, enrollments, trial_attendance, waitlist, attendance, price_versions, charges, charge_adjustments, payments, payment_allocations, refunds, annual_fees, wage_rates, wage_settlements, wage_items, bonuses, availability, substitutions, rent_rules, costs, equipment, equipment_transfers, inventories, programs, skills, lesson_plans, skill_assessments, adventure_cards, stamps, templates, messages, notifications, conversations, consents, policy_documents, audit_logs, imports, report_snapshots. To są pojęcia domenowe, nie narzucone nazwy tabel. Nie twórz zbędnych duplikatów.
- Polityki dostępu per rekord, bezpośrednio egzekwowane na backendzie/DB. Ochrona plików w prywatnym storage i krótkotrwałe autoryzowane linki. Zabezpieczenia XSS/CSRF/SQLi, rate limiting formularza zapisów i logowania, ochrona przed spamem i masowym pobieraniem danych osobowych, sensowne logowanie bez ujawniania danych dzieci.
- Procedury backupu i testowego odtworzenia, retencja danych, eksport danych zgodnie z uprawnieniami, RODO; minimalizacja danych, udokumentowane ślady zgód i SOM. Konta nieaktywne nie mają dostępu.
- Wszystkie zmiany finansowe, zgody, oceny, obecności, przenosiny i uprawnienia mają audyt (kto, co, kiedy, poprzednia/nowa wartość tam, gdzie adekwatne). Nie pozwalaj na destrukcyjne operacje bez kontroli uprawnień.
- Integracje przez modułowe adaptery: operator płatności (BLIK/karty/przelewy/Apple Pay/Google Pay), SMS, e-mail, WordPress, import Excel/CSV, prywatne pliki PDF/wideo; osobne konfiguracje sandbox/produkcja. Przechowuj konfiguracje i sekrety bezpiecznie.
- Unikaj wysyłania realnych wiadomości, faktycznych obciążeń, wypłat i zmian w usługach produkcyjnych przy testach. Wszystkie destrukcyjne migracje i operacje produkcyjne wymagają jawnego planu i zatwierdzenia.
12. PRZYPADKI TESTOWE I KRYTERIA ODBIORU
Minimum testów automatycznych:
1. Rodzic A nie widzi danych dziecka Rodzica B; drugi opiekun po prawidłowym zaproszeniu ma dostęp do właściwego dziecka.
2. Trener widzi tylko przypisane placówki/grupy, ma kontakt do ich opiekunów, lecz NIE może wysłać wiadomości rodzicom ani otworzyć cudzych grup i wynagrodzeń.
3. Równoczesne zapisy na ostatnie wolne miejsce nie powodują przekroczenia limitu; zapis ponad limit tylko przez Administratora z audytem; lista rezerwowa działa bez ręcznego przestawiania.
4. Zmiana grupy, połączenie/podział grup, rezygnacja i powrót zachowują kartotekę i historię, poprawnie rozliczają daty i saldo.
5. Generowanie terminarza uwzględnia przerwy i czas Europe/Warsaw; edycja pojedynczego terminu nie psuje serii; konflikt trenerów jest sygnalizowany.
6. Rodzic zgłasza nieobecność, Trener potwierdza obecność/realizację; korekta ma historię; pieczątka Karty Przygody nie nalicza się dwukrotnie.
7. Naliczanie miesięczne przy 3/4/5 terminach, zapis od połowy miesiąca, próba gratis, odwołanie z korektą przeniesioną na następny miesiąc, rabat indywidualny, wpisowe raz na sezon.
8. Webhook płatności wysłany wielokrotnie tworzy jedną wpłatę; import bankowy zdublowanego pliku nie zwiększa wpływów; wpłata częściowa i nadpłata poprawnie rozliczone.
9. Wynagrodzenie bazuje na przeprowadzonych zajęciach, stawce historycznej, zastępstwie i ewentualnej premii; odwołany termin nie generuje automatycznie wynagrodzenia bez spełnienia reguł.
10. Dwa zajęcia korzystające ze wspólnego bloku najmu nie dublują kosztu; raport przychodu nie sumuje ponownie wpłat; raport ogólny nie dubluje VAT/podatków ani kosztów ogólnych.
11. Masowe upomnienie o zaległościach pomija osoby, które zdążyły zapłacić, respektuje kanały, nie duplikuje wiadomości.
12. Rodzic widzi jedynie opublikowane postępy swojego dziecka; prywatny PDF konspektu jest widoczny właściwemu Trenerowi, nie publicznie.
13. Zamknięty raport miesięczny zachowuje historyczny snapshot; późniejsza korekta jest jawna i audytowalna.
13. OCZEKIWANY REZULTAT PRACY CODEXA
Po inspekcji kodu podaj:
1. Audyt istniejącego projektu (stack, struktura, baza, stan modułów, luki, ryzyka).
2. Docelowy model danych i przepływy informacji pomiędzy 10 modułami oraz plan migracji zachowujący dane.
3. Plan wdrożenia w etapach z zależnościami, priorytetami i kryteriami ukończenia.
4. Rzeczywiście wdrożone zmiany w pierwszym bezpiecznym etapie, listę plików/migracji i wyniki testów; następnie kolejne etapy w ramach dostępnego kontekstu. Nie ograniczaj się do ogólników i makiet, jeśli można implementować.
5. Listę wymaganych kluczy i konfiguracji integracji oraz instrukcję uruchomienia środowiska testowego i wdrożenia, bez ujawniania sekretów.
6. Checklistę odbioru dla wszystkich modułów z podziałem GOTOWE / CZĘŚCIOWO / BRAKUJE / ZABLOKOWANE z konkretnym uzasadnieniem.
NADRZĘDNE OGRANICZENIA: Zachowaj dokładnie trzy role. Respektuj każdą funkcję wyłączoną w specyfikacji; nie dodawaj „przy okazji” rozbudowanych modułów, których nie zamówiłem. Nie dopisuj drugiego systemu obok istniejącego. Nie kasuj danych. Nie naruszaj prywatności dzieci. Nie traktuj symulacji jako prawdziwej płatności lub wysyłki. Projektuj spójnie i wdrażaj etapami.