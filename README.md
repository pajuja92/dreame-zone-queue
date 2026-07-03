<p align="center"><img src="images/logo.png" alt="Dreame Zone Queue" width="560"/></p>

# Dreame Zone Queue

Kolejka sprzątania „pokój po pokoju" dla robotów Dreame zintegrowanych przez
[Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum).
Pokoje definiujesz **ręcznie koordynatami** (strefy, nie segmenty z aplikacji
Dreame), ustawiasz kolejkę z poziomem ssania i mopowania per pokój, a w trakcie
pracy robota możesz **dowolnie przestawiać pokoje oczekujące** — aktywny pokój
zawsze się dokończy.

Integracja wysyła robotowi **jedną strefę naraz** (`dreame_vacuum.vacuum_clean_zone`)
i dopiero po jej ukończeniu wysyła następną według aktualnego stanu kolejki.

## Co dostajesz

- **Panel konfiguracyjny (UI)** — pokoje (nazwa, koordynaty, domyślne ssanie /
  mop / powtórzenia) i wszystkie ustawienia zarządzasz z
  *Ustawienia → Urządzenia i usługi → Dreame Zone Queue → Konfiguruj*. Zero YAML.
- **Encje**: `sensor.vacuum_zone_queue` (stan + kolejka w atrybutach) oraz
  przyciski `button.*` (start / pauza / pomiń / wyczyść) — do użycia w
  automatyzacjach i na dowolnym dashboardzie.
- **Serwisy**: `dreame_zone_queue.add / remove / move / set_params / start /
  pause / skip / clear` — pełna kontrola z automatyzacji i skryptów.
- **Własna karta Lovelace** (`custom:vacuum-queue-card`) dołączona do
  integracji: tabelka z kolejką, strzałki ▲▼ do zmiany kolejności, dropdowny
  ssania/mopa per wiersz, dodawanie pokoi, przyciski sterujące.
- **Persystencja** — kolejka przeżywa restart HA (po restarcie zawsze w stanie
  spauzowanym, aktywny pokój wraca do `pending`).

## Instalacja (HACS)

1. HACS → menu (⋮) → **Custom repositories** → wklej URL tego repozytorium,
   kategoria **Integration** → Add.
2. Zainstaluj **Dreame Zone Queue** i zrestartuj Home Assistant.
3. *Ustawienia → Urządzenia i usługi → Dodaj integrację → Dreame Zone Queue* —
   wybierz encję odkurzacza (np. `vacuum.dreame_l10_prime`).
4. Kliknij **Konfiguruj** i dodaj pokoje. Koordynaty stref `[x1,y1,x2,y2]`
   (w mm) najłatwiej odczytać z Xiaomi Vacuum Map Card w trybie *zone cleanup*.

## Karta na dashboard

Integracja serwuje kartę pod `/dreame_zone_queue_files/vacuum-queue-card.js`
i próbuje automatycznie dodać ją do zasobów Lovelace. Jeśli karta nie jest
widoczna, dodaj zasób ręcznie:
*Ustawienia → Dashboardy → Zasoby → Dodaj* →
`/dreame_zone_queue_files/vacuum-queue-card.js?v=1.0.0`, typ **Moduł JavaScript**
(zasoby widać dopiero po włączeniu trybu zaawansowanego w profilu).

Konfiguracja karty:

```yaml
type: custom:vacuum-queue-card
entity: sensor.vacuum_zone_queue
```


## Masowa definicja pokoi (YAML)

Zamiast wklikiwać pokoje pojedynczo, masz dwie drogi:

**1. Panel opcji → „Edytuj wszystkie pokoje (YAML)"** — jedno pole tekstowe
z całym zestawem pokoi. Otwiera się wypełnione aktualną konfiguracją, więc
działa też jako eksport/backup (skopiuj treść) i szybka edycja hurtem.
Zapis podmienia cały zestaw.

**2. Serwisy** — np. z Developer Tools → Actions:

```yaml
action: dreame_zone_queue.import_rooms
data:
  mode: merge          # merge = dopisz/aktualizuj, replace = zastąp wszystko
  rooms:
    Salon:
      zone: [-1200, -3000, 3600, 1500]   # [x1, y1, x2, y2] w mm
      suction: standard                  # quiet|standard|strong|turbo
      water: moist                       # slightly_dry|moist|wet
      repeats: 1
    Kuchnia:
      zone: [-400, -3500, 2300, -600]
      suction: strong
      water: wet
      repeats: 2
```

`suction`, `water` i `repeats` są opcjonalne (domyślnie: standard / moist / 1).
Odczyt wszystkich pokoi: `dreame_zone_queue.export_rooms` (zwraca obiekt
oraz gotowy do wklejenia YAML — zaznacz „odpowiedź" w Developer Tools).

Uwaga: import przeładowuje integrację, więc **działająca kolejka zostanie
wstrzymana** (pozycje zostają, aktywny pokój wraca do `pending`) — rób
importy, gdy robot nie sprząta.

## Ważne dla Dreame L10 Prime (i innych modeli z mopami obrotowymi)

Przetestuj ręcznie w *Developer Tools → Services*:

```yaml
service: dreame_vacuum.vacuum_clean_zone
data:
  entity_id: vacuum.dreame_l10_prime
  zone: [[-1200, -3000, 3600, 1500]]
  suction_level: "strong"
  water_volume: "high"
  repeats: 1
```

Jeżeli Twoja wersja (beta) integracji dreame-vacuum **nie przyjmuje**
parametru `water_volume` per strefa:

- otwórz *Konfiguruj → Ustawienia* i wpisz właściwą nazwę parametru w polu
  „Nazwa parametru wody" (np. `mop_pad_humidity`), **albo**
- włącz opcję „Ustawiaj poziomy przez encje select" i wskaż encje
  `select.dreame_l10_prime_suction_level` oraz
  `select.dreame_l10_prime_mop_pad_humidity` — wtedy poziomy są ustawiane
  przed startem każdej strefy, a `vacuum_clean_zone` dostaje same koordynaty.

Pozostałe ustawienia:

- **Okres ochronny** — po wysłaniu strefy zmiany stanu robota są ignorowane
  przez N sekund (robot potrzebuje chwili, by wejść w `cleaning`).
- **Odstęp między strefami** — kolejna strefa jest wysyłana N sekund po
  wykryciu końca poprzedniej; robot dostaje komendę w stanie `returning`,
  więc zwykle nie wraca do doku między pokojami.

## Jak wykrywany jest koniec pokoju

Przejście stanu encji odkurzacza `cleaning → returning/docked/idle/charging`
(po upływie okresu ochronnego). Ręczna pauza w aplikacji (`paused`) nie
przesuwa kolejki; błąd startu strefy oznacza pozycję jako `error` i pauzuje
całą kolejkę.

## Ograniczenia / plany

- Reorder w karcie przez strzałki ▲▼ (drag&drop w planach).
- Brak obsługi wielu map/pięter — koordynaty dotyczą aktywnej mapy.
- Brak watchdoga czasu maksymalnego strefy (w planach).
