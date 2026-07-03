# Changelog

Wszystkie istotne zmiany w projekcie. Format oparty o
[Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

## [1.3.3] - 2026-07-03

### Zmienione
- **Przeprojektowany wygląd karty.** Tryb wąski: pozycje jako zaokrąglone
  kafelki z kolorowym akcentem statusu (aktywny = kolor motywu + etykieta
  „sprząta teraz", błąd = czerwony, ukończony = zielony), opisane pola
  (Ssanie / Mop / Powt.) w siatce, kontrolki o dotykowych rozmiarach
  (40–44 px), przyciski sterujące w równej siatce 2×2, „Wyczyść" jako
  przycisk ostrzegawczy. Desktop: nagłówki kolumn kapitalikami, hover
  wierszy, pulsująca ikona aktywnego pokoju, zaokrąglone selecty,
  stan pusty z ikoną.

## [1.3.2] - 2026-07-03

### Naprawione
- **Tryb wąski karty nie aktywował się**: element karty miał domyślne
  `display: inline`, dla którego ResizeObserver raportuje szerokość 0,
  więc próg 520 px nigdy nie był osiągany. Dodano `:host { display: block }`
  oraz natychmiastowy pomiar szerokości przy renderze.
- Podbicie wersji unieważnia cache zasobu karty (`?v=1.3.2`) — poprzednia
  poprawka responsywności nie zmieniała URL-a i mogła nie docierać do
  klientów z zapisanym cache (zwłaszcza aplikacji mobilnej).

## [1.3.1] - 2026-07-03

### Dodane
- **Edytor wizualny karty** (`ha-form`) — konfiguracja bez YAML: wybór encji,
  tytuł karty, przełączniki sekcji (nagłówek, stan robota, dodawanie pokoi,
  przyciski sterujące) oraz tryb kompaktowy. Dzięki edytorowi okno edycji
  karty zyskuje też zakładki *Widoczność* i *Układ* (Układ na dashboardach
  typu „sekcje").
- `getGridOptions()` — domyślny rozmiar karty w widoku sekcyjnym.
- Podgląd karty w oknie „Dodaj kartę" (`preview: true`).
- **Responsywny tryb wąski** (karta < 520 px, m.in. aplikacja mobilna):
  dwuliniowe wiersze zamiast tabeli, dropdowny na pełną szerokość,
  przyciski sterujące w siatce 2×2, ukryty uchwyt drag&drop
  (na dotyku kolejność zmienia się strzałkami).

## [1.3.0] - 2026-07-03

### Dodane
- **Powrót do bazy po zakończeniu kolejki** — jawne `vacuum.return_to_base`
  po ostatnim pokoju.
- **Ikony pokoi** (emoji): opcjonalne pole `icon` w definicji pokoju,
  widoczne w dropdownie dodawania i w tabeli kolejki; dostępne w formularzu
  pokoju, edytorze YAML i serwisie importu.

## [1.2.1] - 2026-07-03

### Dodane
- **Edycja poziomów aktywnego pokoju** — zmiana ssania/mopa w trakcie
  sprzątania, wysyłana natychmiast do robota przez encje `select`
  (bez `off` i bez zmiany powtórzeń).
- **Resolver nazw opcji selectów** — dopasowanie wartości do faktycznych
  opcji encji bez rozróżniania wielkości liter, z aliasem `quiet` ↔ `silent`
  (naprawia błędy startu strefy na modelach raportujących `silent`).

### Naprawione
- **Odświeżanie widgetu**: sensor publikował referencje do mutowanych
  w miejscu słowników pozycji, przez co HA nie wykrywał zmiany stanu
  i karta się nie aktualizowała. Snapshot robi teraz głęboką kopię pozycji,
  a atrybut `revision` gwarantuje wykrycie każdej zmiany.

## [1.2.0] - 2026-07-03

### Dodane
- **Poziom `off`** dla ssania i mopa — realizowany przez automatyczne
  przełączanie trybu sprzątania (`sweeping` / `mopping` /
  `sweeping_and_mopping`) przed startem strefy; nowe pole ustawień
  „Encja select trybu sprzątania" (domyślnie wyprowadzana z encji
  odkurzacza). Blokada obu `off` naraz (karta, serwis, dispatch).
- **Edytowalna liczba powtórzeń** (1×/2×/3×) w tabeli kolejki.
- **Drag & drop** wierszy oczekujących (ze strzałkami ▲▼ jako fallbackiem
  dotykowym).
- **Usunięcie aktywnego pokoju** kończy jego sprzątanie (stop) i przechodzi
  do następnego, z potwierdzeniem w karcie.

## [1.1.0] - 2026-07-03

### Dodane
- **Masowa definicja pokoi**: krok „Edytuj wszystkie pokoje (YAML)"
  w panelu opcji (działa też jako eksport/backup) oraz serwisy
  `import_rooms` (tryby `merge`/`replace`) i `export_rooms`
  (zwraca obiekt + gotowy YAML).
- Walidacja definicji pokoi z czytelnymi komunikatami błędów
  i uzupełnianiem wartości domyślnych.

## [1.0.1] - 2026-07-03

### Zmienione
- Poziomy mopa dopasowane do Dreame L10 Prime:
  `slightly_dry` / `moist` / `wet` (zamiast `low` / `medium` / `high`);
  domyślny parametr wody to `mop_pad_humidity`.

### Dodane
- Branding: logo i ikony (`images/`, `brands/` pod PR do
  `home-assistant/brands`), logo w nagłówku README.

## [1.0.0] - 2026-07-02

### Dodane
- Pierwsze wydanie: kolejka sprzątania „pokój po pokoju" dla robotów Dreame
  (integracja Tasshack/dreame-vacuum) — jedna strefa naraz, reorder pozycji
  oczekujących w trakcie pracy.
- Panel konfiguracyjny (config flow + opcje): pokoje definiowane
  koordynatami, ustawienia orkiestratora, tryb parametrów serwisu lub
  encji `select`.
- Encje: `sensor.vacuum_zone_queue` (stan + pozycje w atrybutach)
  i przyciski start/pauza/pomiń/wyczyść.
- Serwisy: `add`, `remove`, `move`, `set_params`, `start`, `pause`,
  `skip`, `clear`.
- Własna karta Lovelace `custom:vacuum-queue-card` serwowana przez
  integrację, z automatyczną rejestracją zasobu.
- Persystencja kolejki w HA Storage (po restarcie kolejka spauzowana,
  aktywny pokój wraca do oczekujących).
