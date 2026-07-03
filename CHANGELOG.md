# Changelog

Wszystkie istotne zmiany w projekcie. Format oparty o
[Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

## [1.5.0] - 2026-07-04

### Dodane
- **Automatyczne wykrywanie pokoi z Dreame**: nowy krok panelu opcji
  „Wykryj pokoje z Dreame" oraz serwis `detect_rooms` — odczytuje atrybut
  `rooms` z kamery mapy (domyślnie `camera.<nazwa>_map`, z fallbackiem na
  encję odkurzacza), obsługuje formaty x0/y0/x1/y1, x1/y1/x2/y2, listę
  `outline` oraz x/y/width/height i tworzy strefy jako prostokąty
  obejmujące. Tryb merge zachowuje istniejące pokoje, replace zastępuje.
- **Instrukcja instalacji dla początkujących** na początku README —
  krok po kroku, od instalacji HACS po dodanie karty na pulpit.

## [1.4.3] - 2026-07-03

### Dodane
- **Import pokoi z Dreame jednym kliknięciem** — nowy krok „Importuj pokoje
  z Dreame" w panelu opcji oraz serwis `import_rooms_from_dreame`: nazwy
  i obrysy pokoi są kopiowane z atrybutów kamery mapy (`camera.<robot>_map`)
  lub encji odkurzacza, z automatycznym wykrywaniem źródła i normalizacją
  współrzędnych.
- **Instrukcja instalacji dla początkujących** na początku README —
  krok po kroku, od HACS po dodanie widgetu na pulpit.
- **Konfigurowalne położenie uchwytu przeciągania** (tryb wąski) —
  wybór w edytorze karty: przy przyciskach (dotychczasowe), lewa krawędź
  karty (pasek na całą wysokość), prawa krawędź karty, albo poziomy pasek
  na górze karty. Warianty krawędziowe/górny dają duży cel dotykowy
  oddzielony hairline'em od treści.

## [1.4.2] - 2026-07-03

### Dodane
- Przełącznik „Pokaż strzałki zmiany kolejności" w edytorze karty —
  strzałki ▲▼ można ukryć i wrócić do nich jednym kliknięciem.
- **Usuwanie dwuklikiem**: przycisk ✕ ma zawsze czerwoną ramkę; pierwsze
  kliknięcie „uzbraja" go (wypełnia na czerwono), drugie usuwa pozycję.
  Brak drugiego kliknięcia w ciągu 3 s rozbraja przycisk. Zastępuje
  systemowe okno potwierdzenia przy usuwaniu aktywnego pokoju.

## [1.4.1] - 2026-07-03

### Zmienione
- **Proporcje pól w trybie wąskim**: Ssanie i Mop dostają większość
  szerokości, Powtórzenia mają stałe 74 px; ikona statusu przeniesiona
  do linii z nazwą pokoju (koniec ze ściętymi „standa…" i „m").
- **Nowa animacja zmiany kolejności**: złapany za uchwyt ☰ wiersz „idzie
  za palcem" jako uniesiona karta, a w liście zostaje pusty kontener
  z przerywaną ramką, który na bieżąco przeskakuje w miejsce docelowe.
- **Polskie tłumaczenia wyświetlanych wartości**: poziomy ssania
  (cichy/standard/mocny/turbo/wył.), mopa (lekko suchy/wilgotny/mokry/wył.),
  stany robota (w doku, sprząta, wraca do bazy…) i badge PRACUJE/BEZCZYNNA.
  Do backendu nadal trafiają wartości kanoniczne.

## [1.4.0] - 2026-07-03

### Dodane
- **Presety kolejek**: zapis bieżącej kolejki pod nazwą, wczytywanie jednym
  tapnięciem (tryb `replace` zachowuje aktywny pokój, `append` dokłada na
  koniec) i usuwanie — z karty oraz serwisami `save_preset` / `load_preset` /
  `delete_preset`. Presety przeżywają restart HA; pokoje usunięte
  z konfiguracji są przy wczytywaniu pomijane z ostrzeżeniem.
- **Pasek postępu i ETA** w nagłówku karty („2/5 pokoi · ~24 min").
  Integracja uczy się czasów sprzątania per pokój (średnia krocząca
  z ostatnich przebiegów, normalizowana liczbą powtórzeń) i szacuje
  pozostały czas kolejki.
- **Zmiana kolejności dotykiem**: przeciąganie wierszy za uchwyt ☰
  (pointer events) — działa na telefonie i myszą; strzałki ▲▼ pozostają.
- **Tryb „tylko podgląd"** (`read_only`) — karta bez żadnych kontrolek,
  np. na tablet ścienny; przełącznik w edytorze wizualnym, obok nowych
  przełączników paska postępu i presetów.

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
