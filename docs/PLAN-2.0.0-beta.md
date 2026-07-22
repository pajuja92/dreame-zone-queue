# Dreame Zone Queue — plan wydania 2.0.0-beta

Code-review orchestracji (kolejkowanie, dispatch, synchronizacja z eventami)
+ wnioski z analizy Tasshack/dreame-vacuum (branch `dev`, v2.0.0b25).

## TL;DR

Rdzeń (jedna strefa naraz, sygnał nadrzędny `zone_cleaning`/`started` z v1.9.0)
jest poprawny dla szczęśliwej ścieżki, ale orchestracja była w 100%
edge-triggered bez rekoncyliacji — jeden zgubiony event stanu = kolejka wisi.
Zgubione eventy to na L10 Prime udokumentowana rzeczywistość
(Tasshack#1719: serie nieudanych update'ów encji podczas przejść mycia mopa).
Do tego integracja dreame wystawia `sensor.<robot>_task_status` oraz event
`dreame_vacuum_task_status` (`job.completed: bool`) — autorytatywne sygnały,
których dotąd nie używaliśmy.

## Błędy (B)

| # | Problem | Miejsce |
|---|---------|---------|
| B1 | Deadlock: pauza → robot kończy pokój → „Kontynuuj" → kolejka wisi (eventy ignorowane przy `running=False`, brak rekoncyliacji przy wznowieniu) | `manager.py` `_on_vacuum_state`, `async_start` |
| B2 | Anulowanie na robocie/w aplikacji = fałszywe „done" + dispatch następnego pokoju | brak rozróżnienia completed/cancelled |
| B3 | Brak obsługi stanu `error` (utknięcie, szczotka, kosz) — kolejka „running", zero informacji | `_on_vacuum_state` |
| B4 | Statystyki ETA zawyżone po przerwaniach (flaga `interrupted` czyszczona przy resume, czas mycia/ładowania wpada do średniej) | `_finish` / stats |
| B5 | Grace period (45 s) połyka szybkie pokoje — przejście done przepada na zawsze | `_on_vacuum_state` |
| B6 | Ścieżka `use_selects=False` wysyła stringi (`suction_level="standard"`, `mop_pad_humidity=...`) — serwis przyjmuje inty `suction_level`/`water_volume`; walidacja odrzuca call | `_dispatch_next` |

## Eventy poboczne do obsłużenia (L10 Prime)

1. Powrót na mycie mopa mid-room (co 5–15 m²) — auto-resume, `zone_cleaning` zostaje True
2. Ładowanie mid-room z `resume_cleaning` wł. (`cleaning_paused=1`) — auto-resume po ~80%
3. `resume_cleaning` wył. → task porzucony (`completed`) — pokój pół-posprzątany
4. Pauza przyciskiem/aplikacją — brak auto-resume; po ~30 min firmware porzuca task
5. Stop/anulowanie przyciskiem — task „completed", ale to NIE sukces (→ B2)
6. Błąd/utknięcie (`has_error`, enum ErrorCode: stuck 80/81, blocked 47/63/64, cliff/drop…)
7. Podniesienie robota → relokacja; `relocation_status=failed` → task porzucony, `located=False`
8. Pauza mycia / błędy zbiorników stacji (`washing_paused`)
9. Suszenie mopa (godziny, tylko po zakończonym tasku)
10. Dolewanie wody mid-wash (`clean_add_water`)
11. DND — opóźnia auto-resume po ładowaniu
12. Fast mapping — `clean_zone` rzuca wyjątek
13. Auto-empty — nie dotyczy L10 Prime (dodane dla przenośności)
14. `vacuum_goto` = emulowana mikro-strefa na tym modelu (sygnały kłamią)
15. Zgubione eventy encji (#1719) → potrzebny watchdog

## Ograniczenia architektury urządzenia

- Jeden task naraz; nowa strefa anuluje powrót na mycie → mop brudny między pokojami
- Min. rozmiar strefy ~2 kratki mapy (>100 mm na bok)
- Repeats 1–3; strefy = prostokąty (nakładki sprzątane podwójnie)
- `resume_cleaning` musi być włączone w aplikacji Dreame
- Pauza >30 min = firmware porzuca zadanie
- Cykl mycia wg licznika m² stacji (`self_clean_area` 5–15 m²)
- Brak auto-empty i `task_type`; jest `mop_pad_lifting`
- Stary enum stanów (`DreameVacuumStateOld`) — nazwy `vacuum_state` inne niż na nowych modelach

## Modyfikacje (P) — wszystkie wdrażane w 2.0.0-beta.1

1. **P1 Watchdog rekoncyliacyjny** (60 s): level-based porównanie kolejki ze stanem robota; naprawia B1/B5, zgubione eventy, stall >35 min → pauza + powiadomienie; retry zgubionego dispatchu (1×)
2. **P2 `task_status` + event `dreame_vacuum_task_status`** jako sygnał pierwszorzędny; `job.completed=False` = anulowanie → pauza kolejki (z oknem cofnięcia świeżego „done" i tłumieniem własnych stopów)
3. **P3 Fix wznowienia**: przetwarzanie eventów także przy spauzowanej kolejce (done zapisywane w tle); `async_start` godzi stan (nudge / re-dispatch)
4. **P4 Opcja „myj mopa między pokojami"** (czekaj na cykl mycia przed następną strefą, timeout 180 s)
5. **P5 Dispatch przez inty**: `suction_level` 0–3, `water_volume` 1–3 wprost w `vacuum_clean_zone`; usunięta ścieżka selectów przy dispatchu (selecty zostają dla zmian „na żywo")
6. **P6 Obsługa `error` + `located`**: interrupted z powodem (na karcie), notyfikacja HA, porażka relokacji → pauza zamiast done
7. **P7 Drobne**: flaga `was_interrupted` dla statystyk, walidacja min. rozmiaru strefy (120 mm), realne wartości `vacuum_state`, `auto_emptying`, `cleaning_paused`, stan `paused` w snapshot przy aktywnym itemie

## Wydanie

- Wersja `2.0.0-beta.1` (`const.py` + `manifest.json` + CHANGELOG, tag `v2.0.0-beta.1` jako pre-release na GitHubie)
- Test: standalone symulacja przejść stanów (`tests/test_orchestrator_sim.py`, stuby `homeassistant.*`)
- Stabilne 2.0.0 dopiero po przetestowaniu bety na żywym robocie (wtedy też demotujemy logi DZQ_* z poziomu warning)
