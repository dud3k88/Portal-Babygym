# Zarządzanie użytkownikami

Uzupełnienie modułu kont po etapie 3A. Funkcje dostępne tylko dla zalogowanego
administratora po MFA. Bez nowej migracji bazy i bez zmiany istniejących ról.

## Obsługa

1. Otwórz **Użytkownicy → Dodaj użytkownika**.
2. Podaj imię, nazwisko, email, opcjonalnie telefon i rolę: rodzic, trener lub administrator.
3. Przekaż wyświetlony link aktywacyjny właściwej osobie. Link jest jednorazowy,
   ważny 24 godziny. System nie wysyła wiadomości.
4. Odbiorca ustawia własne hasło. Administrator dodatkowo konfiguruje MFA i zapisuje
   kody zapasowe. Dopiero po potwierdzeniu MFA ma dostęp do panelu.

Kolejny link można wygenerować tylko dla konta bez hasła; unieważnia poprzedni.
Po aktywacji działa istniejący proces „Nie pamiętam hasła”, wymagający skonfigurowanego
dostarczania linków. Lista pokazuje osobno dostęp, ustawienie hasła i status MFA.
Filtry obejmują rolę, dostęp, ustawienie hasła oraz nazwę/email/telefon. Strony mają
po 50 kont; filtrowanie i stronicowanie są wykonywane na serwerze.

**Edytuj** zmienia imię/nazwisko i telefon. Dla trenera aktualizuje też jego profil.
Rola i adres logowania istniejącego konta nie są zmieniane w tym formularzu.
Nie zmieniamy rodzica w administratora, bo jego konto może być powiązane z dziećmi,
uprawnieniami opiekuna oraz historycznym płatnikiem. Administrator korzysta z
odrębnego konta i unikalnego adresu. Profile trenerów utworzone wcześniej bez konta
aktywuje się z działu Trenerzy; nie powstaje drugi profil o tym samym emailu.

**Zablokuj dostęp** kończy sesje i unieważnia linki aktywacji, resetowania hasła
oraz zaproszenia opiekunów powiązane z kontem. Dane, dzieci, przypisania, MFA i historia
pozostają. Odblokowanie wymaga ponownego zalogowania, nie przywraca sesji/linków.
Blokada konta trenera nie odwołuje jego zajęć. Profil nieaktywny/archiwalny trzeba
najpierw aktywować w Trenerach, aby odblokować jego konto.

Nie można zablokować własnego konta administratora. Przy blokowaniu innego admina
musi pozostać aktywny administrator z ustawionym hasłem i skonfigurowanym MFA.
API ponownie sprawdza uprawnienia po odczycie treści żądania. Zmiany są transakcyjne;
istniejący dziennik zapisuje autora i dane objęte audytem, bez haseł, kluczy MFA
czy tokenów. Nie ma usuwania kont ani wyłączania MFA przez innego administratora.

Link z localhost działa na komputerze z aplikacją. Dostęp z innych urządzeń wymaga
wdrożenia pod właściwym adresem HTTPS. To nie jest wdrożenie publicznego hostingu.

## Weryfikacja i aktualizacja

- `python3 test/users.py`: role, MFA, izolacja, aktywacja, duplikaty, unieważnianie
  linków/sesji, blokady, spójność profilu trenera, filtry, strony i prywatność DTO.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/users.spec.js`:
  rzeczywisty formularz, aktywacja drugiego administratora, MFA, edycja, blokada,
  filtry i widok 390 px.
- Regresja: `npm test`, wcześniejsze skrypty integracyjne i scenariusze E2E.

Przed aktualizacją wykonaj kopię zgodnie z [OPERACJE.md](OPERACJE.md), pobierz kod
oraz uruchom ponownie serwer. Zmiana nie wymaga nowego schematu ani czyszczenia bazy.
Próby/konwersja i lista rezerwowa z kolejnego etapu nadal pozostają do wdrożenia.
