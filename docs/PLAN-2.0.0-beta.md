# Code-review: kolejkowanie, dispatch i synchronizacja z eventami

> Plan wydania **2.0.0-beta** na bazie code-review orchestracji + analizy
> Tasshack/dreame-vacuum (branch `dev`, v2.0.0b25).
> **Status: wdrożone w `v2.0.0-beta.1`** (patrz [CHANGELOG](../CHANGELOG.md)).

## TL;DR

Rdzeń (jedna strefa naraz, detekcja przerwań po booleanach, primary signal
`zone_cleaning`/`started` z v1.9.0) jest logicznie poprawny dla szczęśliwej
ścieżki. Ale cała orchestracja jest **edge-triggered bez żadnej rekoncyliacji**
— jeden zgubiony event stanu i kolejka wisi na zawsze. A zgubione eventy to na
L10 Prime udokumentowana rzeczywistość: issue
[Tasshack#1719](https://github.com/Tasshack/dreame-vacuum/issues/1719)
(otwarte, v2.0.0b25) opisuje serie nieudanych update'ów encji **dokładnie
podczas przejść mycia mopa** na modelach z myjącą stacją. Do tego 4 konkretne
bugi (w tym deadlock po pauzie i fałszywe „done" po anulowaniu na robocie)
i jeden prawdopodobnie martwy tryb konfiguracji (`use_selects=False`).

---

## 1. Znalezione błędy (od najpoważniejszych)

### B1. Deadlock: pauza → robot kończy pokój → „Kontynuuj" → kolejka wisi

`manager.py:739-741` + `manager.py:300-320`. Gdy `running=False`,
`_on_vacuum_state` wychodzi natychmiast — przejście „pokój skończony" nigdy
nie zostaje zapisane. Po wznowieniu `async_start` widzi aktywny item i tylko
czeka na event; „kuksańca" (`vacuum.start`) daje wyłącznie gdy
`vac.state == "paused"`. Robot jest `docked` → żaden event już nie przyjdzie
→ kolejka na zawsze w „running" ze stale aktywnym pokojem.

**Fix:** przy wznowieniu z aktywnym itemem porównać stan robota: jeśli robot
nie sprząta i task_status = `completed` → oznacz done / ponownie wyślij strefę.

### B2. Anulowanie na robocie/w aplikacji = fałszywe „done" + start następnego pokoju

Użytkownik zatrzymuje robota fizycznym przyciskiem (stop) lub w aplikacji
Dreame → firmware ustawia `task_status → COMPLETED`, `zone_cleaning=False` →
nadrzędny sygnał mówi „pokój skończony" → item dostaje `done`, a po 3 s
kolejka **wysyła robotowi kolejny pokój, którego użytkownik właśnie nie
chciał**. To problem użytkowy i potencjalnie „bezpieczeństwa domowego"
(robot rusza po celowym zatrzymaniu).

**Rozwiązanie u źródła:** integracja dreame emituje event HA
`dreame_vacuum_task_status` z payloadem
`job: {completed: bool, cleaned_area, cleaning_time, ...}` (device.py:10089
w dev). `completed=false` = zadanie anulowane, nie ukończone → wtedy pauzuj
kolejkę zamiast iść dalej. (Uwaga na issue
[#419](https://github.com/Tasshack/dreame-vacuum/issues/419) — fałszywe
`completed` tuż po starcie zadania; `grace_s` już to filtruje.)

### B3. Brak jakiejkolwiek obsługi stanu `error`

Robot utknął / szczotka zablokowana / kosz wyjęty → `has_error=True`, stan HA
`error`. `error` nie jest w `finished_states`, `entered_service` nie zajdzie →
aktywny item wisi bez żadnej informacji, karta pokazuje „running". Użytkownik
nie wie, że robot stoi.

**Fix:** stan `error` → oznacz item `interrupted` z powodem (atrybuty
`error`/`faults` są na encji), pokaż na karcie, opcjonalnie notyfikacja HA;
po zniknięciu `has_error` + `running` → istniejący resume-watcher przejmie.
Dodatkowo można słuchać eventu `dreame_vacuum_error`.

### B4. Statystyki ETA zawyżone po przerwaniach — wbrew dokumentacji

Dokumentacja mówi „interrupted runs are excluded from stats", ale kod tego
nie robi: `manager.py:747` czyści `item["interrupted"] = False` przy
wznowieniu, więc warunek `not item.get("interrupted")` w `manager.py:798`
przechodzi i do średniej wpada czas **łącznie z ładowaniem/myciem mopa**
(nawet +45 min na jednym ładowaniu).

**Fix:** osobna flaga `was_interrupted`, czyszczona tylko przy dispatchu.

### B5. Grace period połyka szybkie pokoje

`manager.py:743` — przez pierwsze 45 s wszystkie eventy są ignorowane, w tym
przejście „done". Mała strefa (1 powtórzenie, sweeping) może skończyć się
przed upływem grace; kolejny event ma już `old.state = docked` →
`was_cleaning=False` → nigdy done → kolejka wisi. Bez watchdoga (P1 niżej)
nie ma z tego wyjścia.

### B6. Ścieżka `use_selects=False` prawie na pewno nie działa (na dev/beta)

`manager.py:624-628` wkłada do `vacuum_clean_zone` parametry
`suction_level="standard"` (string) i `mop_pad_humidity="moist"`. Realna
sygnatura serwisu w dev: `suction_level: int 0..3`, `water_volume: int 1..3`
— **inty, i nie ma żadnego parametru `mop_pad_humidity`**. Walidacja schematu
odrzuci taki call → wyjątek → item `error`, kolejka staje. Skoro w praktyce
działa, znaczy że używane są selecty — martwa ścieżka do naprawy albo
usunięcia (patrz P5).

### Drobne

- `_task_interrupted` (`manager.py:667-671`) sprawdza `vacuum_state`
  o wartościach, które nie istnieją w enumie (`returning_to_charge`,
  `charging_paused`). Realne nazwy (L10 Prime, po remapie `StateOld`):
  `returning`, `returning_to_wash`, `washing`, `washing_paused`, `drying`,
  `charging`, `paused`, `error`, `smart_charging`, `clean_add_water`.
  Martwe gałęzie — wyrównać do enuma.
- `snapshot` (`manager.py:833-838`): pauza z aktywnym pokojem, ale bez
  pending → stan „idle" zamiast „paused" (kosmetyka na karcie).
- Brak walidacji minimalnego rozmiaru strefy: `clean_zone` w dev odrzuca
  strefy o boku ≲100 mm (`InvalidActionException`). Lepiej złapać to przy
  definiowaniu pokoju niż wywałką dispatchu.

---

## 2. Pełna lista eventów „pobocznych" podczas pracy (L10 Prime, dev b25)

Wszystkie przypadki, które orchestrator musi znać. Sygnały podane tak, jak
widzi je HA.

| # | Zdarzenie | Sygnały | Auto-wznowienie strefy? | Obsługa przed 2.0.0 |
|---|---|---|---|---|
| 1 | **Powrót na mycie mopa mid-room** (co 5–15 m², domyślnie 10) | `returning_to_wash=T`, potem `washing=T`; stan HA: `returning`→**`cleaning`** (celowo!); `zone_cleaning` zostaje T | **Tak, bezwarunkowo** (to nie pauza) | ✅ działa (v1.8.4–1.9.0) |
| 2 | **Niski akumulator → ładowanie mid-room** (resume_cleaning wł.) | `cleaning_paused=1` (dedykowany atrybut!), `paused=T`, `returning`→`charging`; task_status `zone_cleaning_paused`/`docking_paused` | Tak, firmware, po ~80% — **chyba że trwa DND, wtedy czeka** | ✅ przez `resume_cleaning AND charging`; atrybut `cleaning_paused` nieczytany, a jest precyzyjniejszy |
| 3 | **resume_cleaning WYŁ. + ładowanie** | task porzucony: `task_status→completed`, `zone_cleaning=F` | **Nie** — zadanie znika | ⚠️ pokój fałszywie `done` (pół-posprzątany); wykryj `cleaning_paused` + resume_cleaning=off i ostrzeż |
| 4 | **Pauza przyciskiem na robocie / w aplikacji** | `paused=T`, task_status `zone_cleaning_paused` / `zone_mopping_paused` | **Nie** — czeka na `vacuum.start`; **po ~30 min firmware porzuca task** (→ jak #3) | ✅ interrupted; brak timeoutu — po 30 min pokój zrobi się „done" |
| 5 | **Stop/anulowanie przyciskiem lub z aplikacji** | `task_status→completed`, `zone_cleaning=F`, robot → idle/dock | Nie | ❌ **B2**: fałszywe done + dispatch następnego |
| 6 | **Błąd/utknięcie** (stuck 80/81, blocked 47/63/64, cliff, drop, zawieszone koło, kosz, splątana szczotka…) — pełny enum `DreameVacuumErrorCode` | `has_error=T`, stan HA `error`, atrybuty `error`+`faults`, event `dreame_vacuum_error` | Tylko po ratunku człowieka + `start`; reszta strefy zachowana póki task_status `*_paused` | ❌ **B3**: nic |
| 7 | **Podniesienie robota / przeniesienie** | relokacja przy odstawieniu: `located=F`, sensor `relocation_status: locating→success/failed`; przy `failed` firmware **porzuca task** | Nie przy porażce relokacji | ❌ pokój `done` + dispatch, choć robot zgubiony; sprawdzaj `located` |
| 8 | **Pauza w trakcie mycia / błąd stacji** (zbiorniki 106/116/118, brak wody) | `washing_paused=T`, stan HA `paused` | Nie — `vacuum.start` wznawia mycie | ✅ interrupted (washing_paused) |
| 9 | **Suszenie mopa** | `drying=T`, stan HA `docked`, `drying_left` — trwa godzinami; tylko PO zakończonym tasku | n/d (task już skończony) | ✅ post-clean serwis od v1.9.0 |
| 10 | **Dolewanie wody do mopa mid-wash** | `self_wash_base_status: clean_add_water/adding_water`, stan `clean_add_water` | Tak | ✅ boolean `washing` obejmuje `CLEAN_ADD_WATER` |
| 11 | **DND** | atrybut `dnd`; na L10 Prime tylko **opóźnia** auto-wznowienie po ładowaniu | Tak, po końcu okna | ⚠️ interrupted trwa godzinami bez informacji czemu — warto pokazać powód |
| 12 | **Fast mapping** | task strefy nie może wystartować: `clean_zone` rzuca wyjątek | — | ✅ ścieżka wyjątku → `error` (ok) |
| 13 | **Opróżnianie kurzu (auto-empty)** | **nie dotyczy L10 Prime** (brak stacji z odsysaniem); na innych modelach `auto_emptying=T` po dokowaniu | Tak | ⚠️ dodać do interrupted dla przenośności na inne modele |
| 14 | **`vacuum_goto` z innych automatyzacji** | na L10 Prime goto jest **emulowane mikro-strefą** — `zone_cleaning` raportuje wtedy False, stan `monitoring` | — | ⚠️ jeśli cokolwiek w domu używa goto podczas kolejki, sygnały kłamią; udokumentuj |
| 15 | **Zgubione eventy encji** (issue [#1719](https://github.com/Tasshack/dreame-vacuum/issues/1719): RecursionError `docked`↔`returning` przy przejściach mycia) | brak update'ów encji seriami | — | ❌ brak watchdoga = wiszenie |

---

## 3. Ograniczenia wynikające z architektury urządzenia (nie do obejścia w kodzie dodatku)

1. **Jeden task naraz, nowy kasuje stary** — to fundament kolejki, ale też
   oznacza: wysłanie następnej strefy w trakcie powrotu na mycie **anuluje
   mycie** — robot zawraca z brudnym mopem. Efekt przy
   `delay_between_zones=3s`: mop praktycznie **nigdy nie jest myty między
   pokojami**, tylko wg licznika m² w trakcie pokoju (patrz P4).
2. **Minimalny rozmiar strefy** ~2 kratki mapy (>100 mm na bok) — mniejsze
   odrzuca sam `clean_zone`.
3. **Repeats 1–3** (UI serwisu); strefy to prostokąty — nakładki między
   pokojami sprzątane podwójnie (znane).
4. **`resume_cleaning` musi być włączone** w aplikacji, inaczej ładowanie =
   porzucenie taska (#3 w tabeli).
5. **Pauza >30 min = firmware porzuca task** — twardy limit na scenariusz
   „przerwał, wrócę za godzinę".
6. **Cykl mycia mopa sterowany licznikiem m² stacji**
   (`number.l10_prime_self_clean_area`, 5–15 m²) — duży pokój ZAWSZE będzie
   przerywany na mycie; jedyna kontrola to ta liczba.
7. **L10 Prime nie ma**: auto-empty, `task_type`, kamery/cruising,
   `auto_switch_settings`; **ma** `mop_pad_lifting` (podnosi pady w trybie
   sweeping — trik z `cleaning_mode` przy „wył." jest bezpieczny dla paneli).
8. Model używa **starego enuma stanów** (`new_state=False` → remap
   `DreameVacuumStateOld`) — wartości `vacuum_state` powyżej 18 znaczą co
   innego niż na nowych modelach; nie kopiuj nazw stanów z cudzych configów.

---

## 4. Proponowane modyfikacje (priorytetyzowane)

- **P1. Watchdog rekoncyliacyjny** *(najważniejsza pojedyncza zmiana)* —
  timer co ~30–60 s podczas `running`: porównaj oczekiwania kolejki ze
  stanem faktycznym (encja + `sensor.l10_prime_task_status`). Naprawia
  jednym mechanizmem: B1, B5, zgubione eventy z #1719, „interrupted na
  zawsze" i pauzę >30 min (timeout → pauza kolejki + powód). Edge-triggered
  + poll-reconcile to standardowy wzorzec na zawodne źródła eventów.
- **P2. `task_status` jako sygnał pierwszorzędny** — subskrybuj
  `sensor.<vacuum>_task_status` obok encji vacuum. Heurystyka przerwań
  redukuje się do: `zone_cleaning*_paused`/`docking_paused` → interrupted;
  `completed` → koniec taska. Booleany zostają jako fallback. Do tego event
  `dreame_vacuum_task_status` z `job.completed` → rozróżnienie **ukończony
  vs anulowany** (fix B2: anulowany → pauzuj kolejkę, nie advance'uj).
- **P3. Fix deadlocka wznowienia (B1)** — rekoncyliacja w `async_start`;
  przy okazji rozszerz „kuksańca" o przypadek `cleaning_paused=1`.
- **P4. Opcja „myj mopa między pokojami"** (checkbox w ustawieniach): po
  `done`, jeśli pokój był mopowany, nie dispatchuj dopóki `washing` nie
  przejdzie pełnego cyklu (`returning_to_wash`/`washing` → false); suszenie
  pomijaj (godziny). Rozwiązuje problem z ograniczenia nr 1 — robot mopuje
  kolejne pokoje coraz brudniejszym mopem.
- **P5. Uprość dispatch parametrów** — dev przyjmuje `suction_level: 0..3`
  i `water_volume: 1..3` wprost w `vacuum_clean_zone`: mapuj nazwy na inty
  (`quiet/silent=0, standard=1, strong=2, turbo=3`; `slightly_dry=1,
  moist=2, wet=3`) i wyrzuć rundę po selectach (zostaje tylko select
  `cleaning_mode` dla „wył."). Mniej race'ów, szybszy start strefy,
  naprawia martwą ścieżkę B6.
- **P6. Obsługa `error` + `located`** (B3, #6/#7 z tabeli) — stan `error` →
  interrupted z powodem na karcie (+ opcjonalna notyfikacja); w ścieżce
  „done" sprawdź `located`/`relocation_status` — porażka relokacji → pauza
  kolejki zamiast fałszywego done.
- **P7. Drobne** — flaga `was_interrupted` dla statystyk (B4), walidacja
  min. rozmiaru strefy przy dodawaniu pokoju, wyrównanie listy
  `vacuum_state` do realnego enuma, `auto_emptying` w interrupted
  (przenośność), stan `paused` w snapshot przy aktywnym itemie bez pending.

---

Kolejność ma znaczenie: **P1+P2 zmieniają fundament** z „heurystyka na
booleanach + nadzieja, że event dojdzie" na „autorytatywny sygnał + siatka
bezpieczeństwa" — większość pozostałych fixów robi się wtedy prosta.
