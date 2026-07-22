<p align="center"><img src="images/logo.png" alt="Dreame Zone Queue" width="560"/></p>

# Dreame Zone Queue

<p align="center">
<img src="https://raw.githubusercontent.com/pajuja92/dreame-zone-queue/main/images/screenshots/card_empty.png" width="40%">&nbsp;&nbsp;&nbsp;&nbsp;<img src="https://raw.githubusercontent.com/pajuja92/dreame-zone-queue/main/images/screenshots/card_queue.png" width="40%">
</p>

<p align="center"><i>Karta Lovelace — pusta kolejka i kolejka z pokojami</i></p>

<p align="center">
<img src="https://raw.githubusercontent.com/pajuja92/dreame-zone-queue/main/images/screenshots/integration.png" width="80%">
</p>

<p align="center"><i>Strona integracji z ikoną</i></p>

<p align="center">
<img src="https://raw.githubusercontent.com/pajuja92/dreame-zone-queue/main/images/screenshots/options.png" width="40%">&nbsp;&nbsp;&nbsp;&nbsp;<img src="https://raw.githubusercontent.com/pajuja92/dreame-zone-queue/main/images/screenshots/yaml_editor.png" width="40%">
</p>

<p align="center"><i>Panel opcji · Masowa edycja pokoi (YAML)</i></p>

## 🟢 Instalacja krok po kroku (dla początkujących)

Ten dodatek pozwala ustawiać robotowi Dreame **kolejkę pokoi do sprzątania** —
z osobną mocą ssania i mopowania dla każdego pokoju — prosto z ekranu
Home Assistanta. Instalacja zajmuje ok. 10 minut i nie wymaga pisania kodu.

**Czego potrzebujesz na start:** działającego Home Assistanta, robota Dreame
dodanego przez integrację [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum)
oraz sklepu z dodatkami **HACS**. Jeśli nie masz HACS, zainstaluj go najpierw
według oficjalnej instrukcji: https://hacs.xyz/docs/use/ (sekcja *Download*),
a potem wróć tutaj.

**Krok 1 — dodaj to repozytorium do HACS.**
W Home Assistancie kliknij w menu bocznym **HACS** → w prawym górnym rogu
trzy kropki **⋮** → **Custom repositories** (Niestandardowe repozytoria).
W pole *Repository* wklej adres tej strony (skopiuj go z paska przeglądarki),
jako *Type* wybierz **Integration** i kliknij **Add**.

**Krok 2 — zainstaluj dodatek.**
Wciąż w HACS wpisz w wyszukiwarkę „Dreame Zone Queue", kliknij wynik,
a potem niebieski przycisk **Download** (Pobierz) i potwierdź.

**Krok 3 — zrestartuj Home Assistanta.**
*Ustawienia → System* → przycisk **Uruchom ponownie** w prawym górnym rogu.
Poczekaj, aż interfejs wróci (1–2 minuty).

**Krok 4 — dodaj integrację.**
*Ustawienia → Urządzenia i usługi* → niebieski przycisk **Dodaj integrację**
(prawy dolny róg) → wpisz „Dreame Zone Queue" → wybierz z listy →
wskaż swojego odkurzacza i kliknij **Wyślij**.

**Krok 5 — wczytaj pokoje automatycznie.**
Na liście integracji znajdź **Dreame Zone Queue** i kliknij **Konfiguruj** →
**Wykryj pokoje z Dreame** → zostaw ustawienia jak są → **Wyślij**.
Dodatek sam odczyta pokoje z mapy Twojego robota. (Możesz je potem
dopieszczać: *Konfiguruj → Edytuj pokój* — np. zmienić domyślną moc
ssania w sypialni na cichą.)

**Krok 6 — dodaj kartę na pulpit.**
Wejdź na swój pulpit (dashboard) → ołówek w prawym górnym rogu →
**Dodaj kartę** → wyszukaj „Vacuum Queue" → kliknij → **Zapisz**.
Jeśli karty nie ma na liście, odśwież stronę z pominięciem pamięci
podręcznej (Ctrl+Shift+R na komputerze).

Gotowe! Dodajesz pokoje do kolejki przyciskiem **+ Dodaj**, ustawiasz
kolejność przeciągając wiersze, klikasz **Start** — a robot sprząta pokój
po pokoju. W trakcie pracy możesz dowolnie przestawiać pokoje, które
jeszcze czekają.

---


## 🟢 Instalacja krok po kroku (dla początkujących)

Ta instrukcja zakłada, że masz działający Home Assistant i zainstalowany HACS
(sklep z dodatkami). Nie masz HACS? Zainstaluj go najpierw według oficjalnego
poradnika: **https://hacs.xyz/docs/use/download/download/** — a potem wróć tutaj.

**Krok 1 — dodaj to repozytorium do HACS.**
W Home Assistant kliknij w bocznym menu **HACS** → w prawym górnym rogu
kliknij **trzy kropki (⋮)** → **Niestandardowe repozytoria** (Custom
repositories). W polu adresu wklej link do tej strony (skopiuj go z paska
przeglądarki), jako typ wybierz **Integration** i kliknij **Dodaj**.

**Krok 2 — zainstaluj.**
W HACS w polu wyszukiwania wpisz **Dreame Zone Queue**, kliknij wynik,
a potem niebieski przycisk **Pobierz** (Download) i potwierdź.

**Krok 3 — zrestartuj Home Assistanta.**
Wejdź w **Ustawienia → System** i kliknij ikonę zasilania w prawym górnym
rogu → **Uruchom ponownie**. Poczekaj 1–2 minuty, aż wszystko wstanie.

**Krok 4 — dodaj integrację.**
**Ustawienia → Urządzenia i usługi → + Dodaj integrację** (niebieski
przycisk na dole po prawej) → wyszukaj **Dreame Zone Queue** → wybierz
z listy swojego odkurzacza (encja zaczynająca się od `vacuum.`) → **Zatwierdź**.

**Krok 5 — wczytaj swoje pokoje jednym kliknięciem.**
Na liście integracji znajdź **Dreame Zone Queue** i kliknij **Konfiguruj**.
Z menu wybierz **Importuj pokoje z Dreame** i kliknij **Zatwierdź**
(nic nie musisz wypełniać). Nazwy i obrysy pokoi zostaną skopiowane
z mapy Twojego robota. Gotowe — pokoje możesz potem podejrzeć i poprawić
w tym samym menu (np. domyślną siłę ssania dla każdego pokoju).

**Krok 6 — dodaj widget na pulpit.**
Otwórz swój pulpit (dashboard) → kliknij **ołówek** w prawym górnym rogu →
**+ Dodaj kartę** → na liście znajdź **Vacuum Queue Card** → **Zapisz**.
Jeśli karty nie ma na liście, odśwież przeglądarkę z pominięciem pamięci
podręcznej (Ctrl+Shift+R) i spróbuj ponownie.

**Jak tego używać?** Na karcie wybierz pokój z listy i kliknij **+ Dodaj** —
tak układasz kolejkę sprzątania. Dla każdego pokoju możesz ustawić siłę
ssania i wilgotność mopa. Kliknij **▶ Start** i robot posprząta pokoje
po kolei, w zadanej kolejności. Dopóki robot nie skończy danego pokoju,
kolejność następnych możesz dowolnie zmieniać (przeciągnij wiersz za
uchwyt ☰). Ulubione zestawy zapisuj jako **presety** (ikona 💾) —
wczytasz je potem jednym kliknięciem.

---


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
- **Presety kolejek** (np. „piątkowe sprzątanie") — zapis/wczytanie z karty lub serwisami.
- **Pasek postępu i ETA** — szacowany czas na bazie historii sprzątań per pokój.
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



## Automatyzacje (harmonogramy sprzątania)

Do automatyzacji służy serwis **`dreame_zone_queue.run`** — jednym wywołaniem
uzupełnia kolejkę (z presetu i/lub podanej listy pokoi) i od razu ją startuje.
Tryb `replace` czyści kolejkę przed wczytaniem (zachowując pokój aktualnie
sprzątany), `append` dokłada na koniec; `start: false` tylko przygotowuje
kolejkę bez startu.

**Najprościej: gotowy blueprint (bez pisania YAML).**
*Ustawienia → Automatyzacje i sceny → Blueprinty → Importuj blueprint* i wklej:

```
https://github.com/pajuja92/dreame-zone-queue/blob/main/blueprints/automation/dreame_zone_queue/scheduled_cleaning.yaml
```

Po imporcie kliknij *Utwórz automatyzację* i wyklikaj: godzinę, dni tygodnia,
nazwę presetu (zapisz go wcześniej przyciskiem 💾 na karcie) oraz opcjonalny
warunek „startuj tylko, gdy robot w doku".

**Przykład 1 — piątkowe sprzątanie z presetu (czysty YAML):**

```yaml
alias: Piątkowe sprzątanie
triggers:
  - trigger: time
    at: "10:00:00"
conditions:
  - condition: time
    weekday: [fri]
actions:
  - action: dreame_zone_queue.run
    data:
      preset: Piątkowe sprzątanie
mode: single
```

**Przykład 2 — ręczna lista pokoi z parametrami, gdy wszyscy wyjdą z domu:**

```yaml
alias: Sprzątanie po wyjściu
triggers:
  - trigger: numeric_state
    entity_id: zone.home
    below: 1
actions:
  - action: dreame_zone_queue.run
    data:
      mode: replace
      rooms:
        - Corridor
        - {room: Kitchen, suction: strong, water: wet, repeats: 2}
        - {room: Łazienka, suction: strong, water: wet}
mode: single
```

Elementy listy `rooms` to nazwa pokoju (użyje domyślnych parametrów pokoju)
albo obiekt `{room, suction, water, repeats}`. Przydatne dopełnienia:
`dreame_zone_queue.pause` (dokończ bieżący pokój i stój — np. gdy ktoś wróci
do domu) oraz `dreame_zone_queue.clear` (przerwij i odeślij robota do doku).
Encja `sensor.vacuum_zone_queue` nadaje się na wyzwalacze — np. powiadomienie,
gdy stan zmieni się z `running` na `idle` (kolejka skończona).


## Przepis: sprzątanie, gdy nikogo nie ma w domu

Kompletny, sprawdzony scenariusz „wychodzimy — robot sprząta, wracamy — robot
przestaje". Składa się z presetu i dwóch automatyzacji.

**Krok 0 — zapisz preset.** Ułóż na karcie kolejkę pokoi do sprzątania pod
Waszą nieobecność, kliknij 💾 i nazwij ją np. `Poza domem`.

**Automatyzacja 1 — start po wyjściu ostatniego domownika.** Wyzwalacze to
opuszczenie strefy domowej przez trackery domowników; warunki pilnują, że
faktycznie nikogo nie ma (druga osoba poza domem *lub* jej telefon
niedostępny). Podmień `device_id`/`entity_id` na swoje (najprościej: wyklikaj
wyzwalacze i warunki w edytorze wizualnym, a akcję wklej w trybie YAML):

```yaml
alias: Sprzątanie, gdy nikogo nie ma
triggers:
  - trigger: device
    domain: device_tracker
    device_id: TWOJ_TELEFON_1
    entity_id: TRACKER_1
    type: leaves
    zone: zone.home
  - trigger: device
    domain: device_tracker
    device_id: TWOJ_TELEFON_2
    entity_id: TRACKER_2
    type: leaves
    zone: zone.home
conditions:
  - condition: device
    domain: device_tracker
    device_id: TWOJ_TELEFON_1
    entity_id: TRACKER_1
    type: is_not_home
  - condition: device
    domain: device_tracker
    device_id: TWOJ_TELEFON_2
    entity_id: TRACKER_2
    type: is_not_home
  - condition: state          # nie mieszaj w kolejce, która już biegnie
    entity_id: sensor.vacuum_zone_queue
    state: idle
actions:
  - action: dreame_zone_queue.run
    data:
      preset: Poza domem
      mode: replace
      start: true
mode: single
```

Zamiast dwóch warunków per osoba możesz użyć jednego zbiorczego:
`numeric_state` na `zone.home` z `below: 1` (licznik osób w strefie).
Warunek na `sensor.vacuum_zone_queue = idle` zapobiega podmianie kolejki,
gdyby automatyzacja odpaliła się ponownie w trakcie sprzątania (np. przy
wyjściach w odstępie czasu).

**Automatyzacja 2 — pauza po powrocie.** Robot dokończy pokój, w którym
właśnie jest, i nie ruszy następnego:

```yaml
alias: Pauza sprzątania po powrocie
triggers:
  - trigger: zone
    entity_id: person.ty
    zone: zone.home
    event: enter
  - trigger: zone
    entity_id: person.domownik_2
    zone: zone.home
    event: enter
conditions:
  - condition: state
    entity_id: sensor.vacuum_zone_queue
    state: running
actions:
  - action: dreame_zone_queue.pause
mode: single
```

Wariant ostrzejszy: zamiast `pause` użyj `dreame_zone_queue.clear` — przerwie
także bieżący pokój i odeśle robota do doku. Wariant łagodniejszy: po pauzie
kolejka pamięta pozostałe pokoje, więc przy kolejnym wyjściu automatyzacja 1
(z trybem `replace`) zacznie od świeżego zestawu — a jeśli wolisz dokańczać
zaległości, zmień w niej `mode: replace` na warunkowe ręczne wznowienie
przyciskiem Start na karcie.

Kolejka pozostaje w pełni edytowalna w trakcie działania automatyzacji —
możesz z telefonu przestawiać, dokładać i usuwać pokoje oczekujące, robot
uwzględni zmiany po ukończeniu bieżącego pomieszczenia.

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

Od wersji 2.0.0 poziomy są wysyłane jako **parametry liczbowe**
`suction_level` (0–3) i `water_volume` (1–3) w `vacuum_clean_zone` — obsługuje
je zarówno stabilna, jak i beta wersja dreame-vacuum. Encje select są używane
tylko do zmian „na żywo" aktywnego pokoju oraz przełączania trybu sprzątania
przy poziomie „wył.".

Pozostałe ustawienia:

- **Okres ochronny** — po wysłaniu strefy zmiany stanu robota są ignorowane
  przez N sekund (robot potrzebuje chwili, by wejść w `cleaning`).
- **Odstęp między strefami** — kolejna strefa jest wysyłana N sekund po
  wykryciu końca poprzedniej; robot dostaje komendę w stanie `returning`,
  więc zwykle nie wraca do doku między pokojami.
- **Czekaj na mycie mopa między pokojami** — kolejny pokój rusza dopiero,
  gdy stacja skończy mycie mopa (bez tej opcji następna strefa przerywa
  mycie i robot jedzie z brudnym mopem). Suszenie nie blokuje kolejki.
- **Sensor task_status dreame** — opcjonalnie wskaż
  `sensor.<robot>_task_status`, jeśli nazwa Twojego robota różni się od
  encji vacuum (domyślnie wyprowadzany automatycznie).

## Jak wykrywany jest koniec pokoju

Sygnał pierwszorzędny to sensor `task_status` integracji dreame oraz flagi
`zone_cleaning`/`started` encji odkurzacza; przejście
`cleaning → returning/docked/idle/charging` (po okresie ochronnym) kończy
pokój. Do tego:

- **Watchdog** co 60 s porównuje stan kolejki ze stanem robota — zgubiony
  event HA nie zawiesza już kolejki; zgubiona komenda strefy jest ponawiana
  jeden raz.
- **Przerwania serwisowe** (mycie/suszenie mopa, ładowanie, dolewanie wody)
  w trakcie pokoju nie kończą go — kolejka czeka na automatyczne wznowienie
  (wymaga włączonego „wznawiaj po ładowaniu" w aplikacji Dreame).
- **Zatrzymanie robota przyciskiem lub w aplikacji** wstrzymuje kolejkę
  (pokój wraca do oczekujących) — nic nie startuje samo po Twoim stopie.
- **Błąd robota** (utknięcie, szczotka, kosz...) oznacza pokój jako
  przerwany z powodem widocznym na karcie i wysyła powiadomienie HA.
- **Zgubiona pozycja** (przeniesienie robota) wstrzymuje kolejkę.
- Przerwanie trwające ponad 35 min pauzuje kolejkę (firmware i tak porzuca
  wstrzymane zadanie po ~30 min).

## Historia zmian

Zobacz [CHANGELOG.md](CHANGELOG.md).

## Ograniczenia / plany

- Brak obsługi wielu map/pięter — koordynaty dotyczą aktywnej mapy.
- „Wznawiaj sprzątanie po ładowaniu" musi być włączone w aplikacji Dreame —
  bez tego robot porzuca zadanie przy ładowaniu w trakcie pokoju.
- Częstotliwość mycia mopa W TRAKCIE pokoju kontroluje stacja
  (`number.<robot>_self_clean_area`, 5–15 m²) — to ustawienie robota.
