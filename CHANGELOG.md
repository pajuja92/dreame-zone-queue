# Changelog

Wszystkie istotne zmiany w projekcie. Format oparty o
[Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

## [2.0.0-beta.13] - 2026-07-24

### Dodane
- **Trwające sprzątanie widoczne od razu w historii** — w obu widokach
  (modal 🕒 z karty kolejki oraz karta statystyk): wpis „▶ w trakcie"
  z aktualnym czasem, % strefy na żywo, trybami i licznikiem powrotów.
  W widoku ogólnym karty statystyk kolumna „Ostatnio" pokazuje wtedy
  bieżący przebieg. Endpoint `/history` zwraca pole `current`.

## [2.0.0-beta.12] - 2026-07-24

### Naprawione (log 24.07, sesja 11:15–12:28)
- **Restart HA nie „osieroca" już trwającego sprzątania**: aktywny pokój
  zostaje „w trakcie" po restarcie. Gdy robot nadal wykonuje zadanie
  strefowe, kolejka przejmuje je z powrotem (RECLAIM): śledzi przerwy,
  zapisze ukończenie z poprawnym czasem i pojedzie dalej. Gdy robot nie
  ma już zadania — pokój wraca do oczekujących bez ponownego wysyłania
  strefy „w ciemno". Dotąd: robot mopował Salon 45 min „bezpańsko",
  a karta pokazywała pokój jako nietknięty.
- **Guard na zduplikowane wywołania z karty**: identyczna akcja
  w <400 ms jest ignorowana (w logu usunięcia pokoi wysyłały usługę
  3–7× w kilka milisekund).

### Dodane
- **🕒 Historia sprzątania pokoju z karty kolejki**: nowy przycisk przy
  każdym wierszu otwiera modal (nie modyfikuje karty) z pełną historią
  pomieszczenia — data, godzina, % strefy, czas, ssanie, mop, wynik,
  powroty do bazy. Dane z tej samej historii co karta statystyk.

### Testy
- 2 nowe scenariusze (36 łącznie): przejęcie zadania po restarcie,
  restart bez zadania robota (powrót do oczekujących).

## [2.0.0-beta.11] - 2026-07-24

### Dodane — ustawienia wizualne karty statystyk
- **Wizualny edytor konfiguracji** `vacuum-stats-card` (GUI w edytorze
  Lovelace, bez YAML): tytuł, maks. szerokość karty (auto / 400–1000 px,
  wyśrodkowana), tryb kompaktowy (mniejsza czcionka i odstępy) oraz
  wybór widocznych kolumn osobno dla widoku ogólnego i szczegółów
  pokoju.
- Priorytet kolumn: konfiguracja karty (edytor/YAML) → wybór z ⚙ na
  karcie (per przeglądarka) → domyślne. Gdy kolumny ustawia edytor
  karty, ⚙ pokazuje je jako tylko do odczytu z podpowiedzią.

## [2.0.0-beta.10] - 2026-07-24

### Naprawione
- **„Kontynuuj" nie pali już pokoi, gdy integracja Dreame nie działa**
  (log 24.07 10:44: po restarcie HA dreame_vacuum się nie załadowało
  i każde kliknięcie oznaczało kolejny pokój jako „błąd"):
  - przed wysyłką sprawdzana jest dostępność usługi
    `dreame_vacuum.vacuum_clean_zone` — gdy jej nie ma, kolejka pauzuje
    z powodem „integracja dreame_vacuum niedostępna (po restarcie HA?)",
    a pokój zostaje nietknięty w oczekujących;
  - błąd wysyłki strefy nie oznacza już pokoju jako „błąd" — pokój
    wraca do oczekujących i „Kontynuuj" ponawia TEN SAM pokój
    (status „błąd" zostaje tylko dla „robot dwukrotnie nie podjął
    strefy"); nieudana wysyłka nie trafia też do historii statystyk.

### Testy
- 2 nowe scenariusze (34 łącznie): brak usługi dreame_vacuum,
  wyjątek przy wysyłce strefy.

## [2.0.0-beta.9] - 2026-07-24

Poprawki z analizy drugiego dziennika feedbacku (sesja 24.07) +
rozbudowa panelu logów i nowa karta statystyk.

### Naprawione (log 24.07)
- **Zamknięte drzwi ≠ anulowanie**: gdy robot wraca z „completed" przy
  <5% sprzątniętej strefy (nie wjechał do pokoju — drzwi zamknięte lub
  uchylone), pokój jest oznaczany jako **pominięty** z powiadomieniem,
  a kolejka **jedzie dalej**. Zakres 5–39% pozostaje anulowaniem
  („zatrzymano na robocie", pauza kolejki; komunikat podaje teraz %
  strefy zamiast m²).
- **Wykrywanie obcego zadania**: przycisk power na podniesionym robocie
  startuje pełne sprzątanie domu (task_status `cleaning`, licznik
  powierzchni od zera) — kolejka śledziła je jako swój pokój przez
  10 minut. Watchdog wykrywa teraz zadanie spoza kolejki
  (`segment/spot/cruising/cleaning` bez `zone_cleaning`) → pauza
  z powodem „robot wykonuje inne zadanie".
- **Ostrzeżenie o zastoju działa też w doku**: pauza podczas ładowania
  nie wznowi się sama, a wyłączała alarm — 38-minutowa „zombie sesja"
  z logu przeszła bez ostrzeżenia. Ładowanie nie wyłącza już alarmu
  (nadal wyłączają: mycie, suszenie, auto-pauza niskiej baterii).
- **Usuwanie pokoi nie budzi robota**: usunięcie aktywnego pokoju
  wysyła następny tylko, gdy robot faktycznie sprząta; gdy stoi
  (pauza/dok), kolejka przechodzi w pauzę z powodem „aktywny pokój
  usunięty" — koniec z „robot się nagle obudził przy usuwaniu".

### Dodane
- **Widok Diff** (przełącznik Pełny/Diff): między kolejnymi zrzutami
  `attrs` pokazywane są tylko zmienione klucze; pierwszy zrzut to pełna
  baza. Klucze, które zniknęły, są odnotowane jako `"_removed": [...]`.
  Na logu testowym: 1,6 MB → 182 KB (11% oryginału).
- **„⬇ Pobierz diff"** — przetwarza CAŁY plik (nie tylko widoczny ogon)
  i pobiera jako `dreame_zone_queue_feedback_diff.log`. Zwykłe
  „⬇ Pobierz" również pobiera teraz cały plik.
- **„🗄 Archiwizuj"** — bieżący dziennik (wraz z plikami rotacji)
  przenosi się do `dreame_zone_queue_feedback_archived_<data>.log`
  w /config, a główny plik zaczyna się od nowa; pierwszy nowy wpis jest
  pełnym zrzutem (diff nie liczy się względem archiwum). Wymaga
  uprawnień administratora, z potwierdzeniem.
- **Filtr czasu** (od/do) i **filtr tagów** — klikane „chipy" z licznikami
  dla TASK_SENSOR, DZQ_DIAG, DZQ_ACTION, DZQ_DECISION, NOTE, SNAPSHOT,
  RESTART, INNE… (tagi wykrywane dynamicznie z pliku).
- **Formatowanie JSON ze zwijaniem**: blok `attrs` jest domyślnie zwinięty
  do podglądu (liczba kluczy + skrót), rozwija się w sformatowany,
  pokolorowany JSON; przyciski „Rozwiń / Zwiń" dla wszystkich naraz.

### Dodane — karta statystyk „Vacuum Stats Card"
- **Historia sprzątań per pokój**: integracja zapisuje każdy przebieg
  (data/godzina, czas trwania, % sprzątniętej strefy, tryb odkurzania
  i mopowania, przejazdy, wynik: sukces / anulowane / pominięte / błąd,
  liczba powrotów do bazy w trakcie — mycie mopa, ładowanie,
  opróżnianie). Do 100 wpisów na pokój, trwałe w Store (przeżywa
  restarty).
- **Nowa osobna karta `custom:vacuum-stats-card`** (rejestruje się
  automatycznie jako zasób Lovelace):
  - widok ogólny — lista pokoi + kolumny: ostatnie sprzątanie, czas,
    % strefy, najczęstszy tryb odkurzania/mopowania (opcjonalnie:
    liczba sprzątań, % sukcesu, śr. czas, śr. powroty);
  - klik w pokój → szczegóły wszystkich przebiegów (data, godzina, %,
    czas, tryby, wynik, powroty do bazy, przejazdy);
  - filtr trybu na obu widokach: Wszystkie / Zamiatanie / Mopowanie /
    Zamiatanie+mopowanie;
  - **wybór kolumn w ⚙ na karcie** (osobno dla widoku ogólnego
    i szczegółów; zapis w przeglądarce) lub w YAML
    (`columns` / `detail_columns`).

### Techniczne
- `GET /api/dreame_zone_queue/feedback_log?all=1` zwraca cały plik
  (domyślnie ogon 2000 linii), nowe `POST …/feedback_archive`
  i `GET …/history`.
- 7 nowych scenariuszy symulacyjnych (32 łącznie): zapis historii,
  zamknięte drzwi, obce zadanie, zastój w doku, usuwanie aktywnego
  pokoju (robot stoi / sprząta).

## [2.0.0-beta.8] - 2026-07-23

Poprawki 4 błędów wykrytych w analizie dziennika feedbacku z testów na
robocie (22–23.07).

### Naprawione
- **Domek/Stop na robocie nie kończy już pokoju jako „done"**: firmware
  L10 Prime nie emituje eventu anulowania, więc przerwane zadanie
  wyglądało jak ukończone — kolejka wysyłała następny pokój, a robot
  zawracał w pół drogi do bazy. Teraz „completed" przy sprzątniętym
  <40% powierzchni strefy jest traktowane jako anulowanie: pokój wraca
  do oczekujących, kolejka się wstrzymuje (realne zakończenia to 57–82%
  powierzchni, anulowania 0–4% — progi z danych z robota).
- **„Pomiń" nie wysyła już dwóch pokoi naraz**: wyścig timera ze skipa
  z watchdogiem potrafił wysłać dwa kolejne pokoje (dwa zadania
  „w trakcie" na liście, złe przypisanie pokoju, fałszywe „done" po
  155 s). Dispatch jest teraz blokowany, gdy jakiś pokój wciąż jest
  aktywny, a zawisły timer kasowany.
- **Pauza ponawiana, gdy robot ją zignoruje**: komenda `vacuum.pause`
  potrafi zginąć bez błędu (robot sprzątał dalej 3 min). Po 10 s stan
  jest weryfikowany i pauza wysyłana ponownie (jedna ponowka).
- **Powrót do bazy nie kasuje flagi przerwania**: robot raportuje
  `running=True` w drodze do doku, co było odczytywane jako „wznowił
  sprzątanie" — przez to 2h pauzy wliczyło się do czasu pokoju, a guard
  porzucenia zadania nie zadziałał. Guardy porzucenia i anulowania są
  teraz centralne dla wszystkich ścieżek „done".
- **Czekanie na mycie mopa nie kończy się już zawsze 3-min timeoutem**:
  suszenie mopa (trwa godzinami, można je bezpiecznie przerwać) było
  traktowane jako trwające mycie — następny pokój rusza od razu po
  zakończeniu mycia.

### Zmienione
- Powód przerwania podczas dojazdu do doku to teraz „wraca do bazy"
  (zamiast mylącego „przerwane"); taki dojazd nie wyklucza już pokoju
  ze statystyk czasu (ETA wreszcie ma z czego się uczyć — dotąd każde
  normalne zakończenie przechodziło przez dojazd i statystyki nie
  zapisywały się nigdy).
- Restart/przeładowanie integracji zostawia wpis `RESTART` w dzienniku
  feedbacku (z listą pokoi cofniętych do oczekujących) — dotąd restart
  był niewidoczny i „znikający" aktywny pokój wyglądał jak błąd.

### Testy
- 6 nowych scenariuszy symulacyjnych (25 łącznie): anulowanie po
  powierzchni, done przy sprzątniętej strefie, blokada podwójnego
  dispatchu, powrót do bazy a flaga przerwania, ponowka pauzy,
  dispatch przy suszeniu.

## [2.0.0-beta.7] - 2026-07-23

### Zmienione
- **„⏸ Pauza" zatrzymuje robota natychmiast** (w miejscu, `vacuum.pause`) —
  robot czeka na decyzję: Kontynuuj / Do bazy. Uwaga: firmware porzuca tak
  wstrzymane zadanie po ~30 min (kolejka ostrzeże po 25 min).
- **Nowy przycisk „🏁 Dokończ pokój"** przejął dawne zachowanie Pauzy:
  robot dokańcza bieżący pokój, kolejka nie wysyła następnego. Dostępny
  też jako serwis `dreame_zone_queue.finish_room` i encja przycisku.

### Dodane
- **Panel „Zone Queue Logi" w menu bocznym HA** (jak File editor / Terminal):
  podgląd dziennika feedbacku bez logów HA Core — filtr, auto-odświeżanie
  co 5 s, kolorowanie wpisów NOTE/DECISION, przycisk pobrania pliku.
  Endpoint: `/api/dreame_zone_queue/feedback_log` (wymaga logowania,
  tylko admin).
- **Nowe okno notatki**: wieloliniowe pole tekstowe zamiast okienka
  przeglądarki, przyciski Zapisz/Anuluj, a po zapisie potwierdzenie
  („✓ Notatka zapisana"). Okno przeżywa odświeżenia karty w trakcie
  pisania.
- Linia stanu przy pauzie z aktywnym pokojem dopowiada
  „(robot dokończy bieżący pokój)" — odpowiedź na zgłoszenie z feedbacku,
  że „pauza nic nie robi".

## [2.0.0-beta.6] - 2026-07-23

### Dodane
- **Bateria robota** (🔋 %) w linii stanu robota na karcie.
- **% ukończenia aktywnego pokoju** przy jego wierszu — liczony z
  `cleaned_area` robota względem powierzchni strefy (× powtórzenia);
  szacunkowy (nakładki tras mogą go lekko zawyżać), ograniczony do 99%.
- **Powód postoju kolejki** w linii stanu, gdy kolejka jest wstrzymana:
  „wstrzymana ręcznie", „zakończona przyciskiem Stop", „zatrzymano na
  robocie", „robot odesłany do bazy", „restart Home Assistant", błędy
  wysyłki strefy itd. (nowy atrybut sensora `paused_reason`).
- Linia stanu robota, bateria i % pokoju odświeżają się na żywo przy
  każdej zmianie encji odkurzacza (nie tylko przy zmianach kolejki).

### Zmienione
- **Większa czcionka tabeli na szerokich ekranach**: 1em (tryb kompaktowy
  0.92em) zamiast 0.92/0.84em + luźniejsze odstępy wierszy. Widok mobilny
  (wąski) bez zmian.

## [2.0.0-beta.5] - 2026-07-22

### Naprawione
- **Przycisk 📝 (notatka) nie pojawiał się na karcie** mimo włączonego
  trybu feedbacku: sensor kolejki ma białą listę atrybutów i nie
  publikował pola `feedback` — karta nie wiedziała, że tryb jest aktywny.
- **Ostrzeżenie „Detected blocking call to open... inside the event loop"**
  przy włączaniu trybu feedbacku: plik logu jest teraz otwierany poza
  pętlą zdarzeń (executor).

## [2.0.0-beta.4] - 2026-07-22

### Naprawione / UX przycisków
- **Natychmiastowy feedback po kliknięciu**: przyciski sterujące gasną
  (⏳) od razu po kliknięciu aż do aktualizacji stanu (z awaryjnym
  timeoutem 5 s) — koniec wielokrotnego klikania „bo nie wiadomo, czy
  weszło".
- **Zestawy przycisków dopasowane do faktycznego stanu**:
  - po ręcznym **Stopie** karta nie pokazuje już Stopu i Pomiń, jakby
    sesja trwała — zostaje „▶ Kontynuuj" i „✕ Wyczyść";
  - „⏭ Pomiń" widoczny tylko, gdy faktycznie jest aktywny pokój;
  - przy pauzie z aktywnym pokojem: „✕ Wyczyść" zamiast drugiego Stopu.
- **Nowy przycisk „🏠 Do bazy"** (pauza z aktywnym pokojem) + serwis
  `dreame_zone_queue.dock`: robot wraca do stacji **bez kończenia sesji**
  — aktywny pokój wraca do oczekujących, „Kontynuuj" podejmie go później.
- **„Wyczyść" przy sprzątającym robocie** teraz zatrzymuje go i odsyła do
  stacji także wtedy, gdy kolejka była już spauzowana (wcześniej robot
  kończył pokój mimo wyczyszczonej kolejki).

## [2.0.0-beta.3] - 2026-07-22

### Dodane
- **Tryb feedbacku** (`switch.vacuum_zone_queue_feedback_log`): po włączeniu
  każda zmiana stanu robota i sensora task_status jest logowana z pełnym
  zrzutem atrybutów do **osobnego pliku** `/config/dreame_zone_queue_feedback.log`
  (rotacja 2 MB × 3) oraz do logów HA pod osobnym źródłem
  `dreame_zone_queue.feedback`. Wszystkie decyzje kolejki (`DZQ_*`) trafiają
  tam automatycznie. Stan przełącznika przeżywa restart.
- **Przycisk notatki 📝 na karcie** (widoczny przy włączonym feedbacku):
  otwiera okienko, wpisana notatka („co naprawdę się stało") ląduje w
  dzienniku feedbacku razem z pełnym stanem kolejki i robota. Dostępny też
  jako serwis `dreame_zone_queue.note`.

### Zmienione
- **`DZQ_DIAG` przeniesiony na poziom debug** w głównym logu HA — koniec
  spamu ostrzeżeń przy każdej zmianie stanu robota. Pełna diagnostyka
  dostępna w trybie feedbacku; `DZQ_DECISION`/`DZQ_ACTION`/`DZQ_EVENT`
  zostają na poziomie warning (są rzadkie).
- **Przebudowana obsługa długiej pauzy** (firmware porzuca ręcznie
  wstrzymane zadanie po ~30 min):
  - po **25 min ręcznej pauzy** przychodzi powiadomienie „wznów w ciągu
    ~5 min, inaczej robot porzuci zadanie";
  - timeout liczy się **tylko dla ręcznej pauzy** — ładowanie z
    auto-wznowieniem (45–60 min) i mycie mopa nie generują już fałszywych
    alarmów;
  - „ukończenie" przychodzące, gdy pokój wisiał przerwany **ponad 28 min**,
    jest traktowane jako porzucenie zadania: pokój wraca do oczekujących,
    kolejka się wstrzymuje (wcześniej: na wpół posprzątany pokój dostawał
    status „done" i kolejka jechała dalej).

## [2.0.0-beta.2] - 2026-07-22

### Naprawione
- **Karta przewijała stronę na samą górę** przy każdej akcji przebudowującej
  widok (przeniesienie pokoju, przełącznik Wszystkie/Wybrane, przyciski
  sterujące) — dotkliwe przy długiej kolejce. Pełny re-render zapamiętuje
  teraz i odtwarza pozycję scrolla wszystkich przewijalnych kontenerów
  (także przez granice shadow DOM).

## [2.0.0-beta.1] - 2026-07-22

Duża przebudowa orchestracji — **wersja beta**: nowa detekcja stanów robota,
watchdog i obsługa zdarzeń pobocznych. Testowana symulacyjnie (12 scenariuszy,
`tests/test_orchestrator_sim.py`); stabilne 2.0.0 po weryfikacji na robocie.

### Dodane
- **Watchdog rekoncyliacyjny** (co 60 s podczas pracy): kolejka nie zawiesza
  się już po zgubionym evencie HA (np. znane serie błędów integracji dreame
  przy przejściach mycia mopa — Tasshack#1719). Wykrywa przegapione
  zakończenie pokoju, przegapione przerwanie, zgubioną komendę strefy
  (jedna automatyczna ponowka) i zbyt długie przerwanie (>35 min — firmware
  porzuca wstrzymane zadanie po ~30 min) z automatyczną pauzą kolejki.
- **Sensor `task_status` integracji dreame** jako pierwszorzędny sygnał fazy
  zadania (`zone_cleaning_paused`, `docking_paused`, ...); booleany encji
  vacuum pozostają jako fallback. Encję można wskazać w ustawieniach
  (domyślnie wyprowadzana z nazwy odkurzacza).
- **Wykrywanie anulowania na robocie/w aplikacji** (event
  `dreame_vacuum_task_status`, `job.completed=false`): zatrzymanie robota
  przez użytkownika **wstrzymuje kolejkę** (pokój wraca do oczekujących),
  zamiast fałszywego „ukończono" i wysłania kolejnego pokoju. Stopy zlecone
  przez samą kolejkę (Pomiń/Stop/Wyczyść) są odfiltrowane.
- **Obsługa błędów robota** (utknięcie, szczotka, kosz, brak wody...):
  pokój oznaczany jako przerwany z powodem, powiadomienie w HA; po ratunku
  i wznowieniu kolejka podejmuje pracę.
- **Powód przerwania na karcie** (mycie mopa / ładowanie / błąd / wstrzymany)
  przy aktywnym pokoju — zamiast „sprząta teraz".
- **Opcja „Czekaj na mycie mopa między pokojami"**: kolejny pokój rusza
  dopiero po umyciu mopa w stacji (bez tej opcji wysłanie następnej strefy
  przerywa mycie i robot zawraca z brudnym mopem). Suszenie nie blokuje.
- **Kontrola relokacji**: gdy robot zgubi pozycję (podniesiony/przeniesiony,
  atrybut `located`), kolejka się wstrzymuje zamiast oznaczać pokój jako
  ukończony.
- **Walidacja rozmiaru strefy** (min. 120 mm na bok) przy dodawaniu/edycji
  pokoju — robot odrzuca mniejsze strefy dopiero przy starcie.
- Symulacyjny zestaw testów orchestratora (`tests/test_orchestrator_sim.py`,
  bez Home Assistanta): `python3 tests/test_orchestrator_sim.py`.

### Zmienione
- **Poziomy ssania/mopa idą teraz jako parametry liczbowe
  `suction_level`/`water_volume` w `vacuum_clean_zone`** (wspierane przez
  dreame master i dev) — bez rundy po encjach select przy starcie strefy.
  Ustawienia „parametr wody" i „ustawiaj przez selecty" usunięte (encje
  select są nadal używane do zmian „na żywo" aktywnego pokoju i trybu
  sprzątania przy poziomie „wył.").
- **Pokój kończony przy spauzowanej kolejce jest zapisywany jako ukończony**
  (wcześniej: sekwencja Pauza → robot kończy → Kontynuuj zawieszała kolejkę
  na zawsze). „Kontynuuj" dodatkowo godzi stan kolejki ze stanem robota:
  wznawia zapauzowanego, a przy braku zadania wysyła aktywny pokój od nowa.
- Statystyki ETA nie liczą już przebiegów przerwanych ładowaniem/myciem
  (wcześniej czas przerwy zawyżał średnią pokoju).
- Lista wartości `vacuum_state` w detekcji przerwań wyrównana do realnego
  enuma dreame (usunięte nieistniejące `returning_to_charge`,
  `charging_paused`; dodane `smart_charging`, `clean_add_water`); dodane
  flagi `cleaning_paused` (niski akumulator) i `auto_emptying` (inne modele).
- Stan sensora kolejki pokazuje „paused" także gdy jest aktywny pokój bez
  oczekujących.

### Znane ograniczenia (architektura urządzenia)
- „Wznawiaj sprzątanie po ładowaniu" (`resume_cleaning`) musi być włączone
  w aplikacji Dreame — bez tego robot porzuca zadanie przy ładowaniu,
  a pokój zostanie uznany za anulowany/ukończony.
- Zadanie wstrzymane ręcznie dłużej niż ~30 min firmware porzuca sam —
  kolejka wykryje to i się wstrzyma.
- Mycie mopa w trakcie pokoju następuje wg licznika m² stacji
  (`number.*_self_clean_area`, 5–15 m²) — to ustawienie robota, nie kolejki.

## [1.9.0] - 2026-07-06

### Naprawione
- **Kolejka nie przechodziła do następnego pokoju**: po skończeniu pokoju
  robot wracał myć mopa (`self_clean`), ale `_task_interrupted` widział
  `charging`/`washing` i uznawał to za przerwanie mid-room. Teraz
  `zone_cleaning=False` + `started=False` to nadrzędny sygnał: **pokój
  skończony** — mycie/ładowanie traktowane jako serwis post-clean, kolejka
  przechodzi do następnego elementu.

### Dodane
- **Pełna diagnostyka** (`DZQ_DIAG`, `DZQ_ACTION`, `DZQ_DECISION`):
  logowanie stanów, akcji użytkownika i decyzji managera na poziomie
  `warning` — widoczne w UI logów HA.

## [1.8.6] - 2026-07-06

### Naprawione
- **Kolejka nie kontynuowała po zakończeniu pokoju** (z `self_clean` = wł.):
  robot po skończonym pokoju wracał myć mopa (`returning_to_wash`),
  `_task_interrupted` widział to jako przerwanie mid-room i czekał na
  wznowienie — ale robot nigdy nie wracał do tego pokoju, bo skończył go
  prawidłowo. Teraz: gdy `interrupted` item widzi robota w `docked`/`idle`
  bez flag serwisowych i bez sprzątania → pokój oznaczany jako DONE
  i kolejka rusza dalej.

## [1.8.5] - 2026-07-05

### Naprawione
- **Przełączanie ssania z „wył." nie działało**: robot ignorował zmianę
  poziomu ssania, bo kod ustawiał `suction_level` PRZED przełączeniem
  `cleaning_mode`. Robot w trybie „mopping" ignoruje ssanie. Teraz
  kolejność: najpierw `cleaning_mode`, potem poziomy.
- **Zabezpieczenie `paused`**: detekcja przerwania pokoju działa teraz
  także gdy HA przeskoczy event `returning` i da bezpośrednio
  `cleaning → paused`.

## [1.8.4] - 2026-07-05

### Naprawione
- **Powrót na mycie mopa nadal przerywał pokój**: `vacuum_state` L10 Prime
  ustawia się na `returning_to_wash` ZANIM flaga `washing` stanie się `true`
  — a `running` i `returning` są jednocześnie `true`, co omijało dotychczasowy
  warunek. Teraz `_task_interrupted` sprawdza `vacuum_state` jako pierwszy
  sygnał (szuka `returning_to_wash`, `returning_to_charge`, `washing`,
  `drying`, `charging` itp.). Usunięto też wymóg `not running` przy
  `returning + resume_cleaning`.

## [1.8.3] - 2026-07-05

### Naprawione
- **Zmiana trybu sprzątania na żywo**: opcja „wył." na ssaniu i mopie
  jest teraz dostępna także dla aktywnego (sprzątanego) pokoju. Zmiana
  przełącza tryb robota mid-zone (`sweeping` / `mopping` /
  `sweeping_and_mopping`) przez `select.select_option` — tak samo jak
  robi to karta xiaomi-vacuum-map-card. Obie opcje „wył." jednocześnie
  są nadal blokowane.

## [1.8.2] - 2026-07-04

### Naprawione
- **Przerywanie pokoju przy powrocie na ładowanie / mycie mopa — naprawione
  właściwie.** Detekcja z 1.7.0 opierała się na atrybucie `task_status`,
  którego L10 Prime nie udostępnia, więc nie działała. Teraz orkiestrator
  czyta konkretne flagi boolean encji dreame (`washing`, `washing_paused`,
  `drying`, `paused`, `returning_paused`, `charging` + `resume_cleaning`)
  i odróżnia realny koniec pokoju od serwisowego powrotu do bazy. Dodano
  nadzór wznowienia: po doładowaniu/umyciu mopa robot dokańcza pokój,
  a kolejka rusza dalej dopiero po jego faktycznym ukończeniu. Flagi
  „*_available" (możliwości stacji) nie są już mylone ze stanem bieżącym.

## [1.8.1] - 2026-07-04

### Dodane
- **Masowa edycja wybranych pozycji**: segmentowany przełącznik
  „Wszystkie / Wybrane" bezpośrednio na karcie, w wierszu masowej edycji
  nad sekcją przycisków. W trybie „Wybrane" pozycje oczekujące dostają
  checkbox przy nazwie, przycisk trybu pokazuje licznik „Wybrane (n)",
  a selecty są nieaktywne, dopóki nic nie zaznaczysz. Serwis
  `set_all_params` przyjmuje opcjonalne `item_ids`.
- **Estymacja czasu per pokój**: przy nazwie każdej pozycji dyskretne
  „~X min" wyliczane z historii sprzątań (średnia × powtórzenia);
  dla pokoju aktywnego pokazywany jest szacowany czas do końca,
  odświeżany na bieżąco. Widoczne, gdy integracja ma już dane
  z co najmniej jednego przebiegu.

## [1.7.0] - 2026-07-04

### Naprawione
- **Kolejka nie psuje się przy powrotach serwisowych robota** (niska bateria,
  mycie/suszenie mopa): orkiestrator czyta `task_status`/`status` z dreame
  i odróżnia zadanie ukończone od wstrzymanego — przy przerwaniu czeka na
  automatyczne wznowienie zamiast wysyłać następną strefę. Przerwane
  przebiegi nie zaburzają statystyk czasu (ETA).
- **Zmiana selecta nie przewija już karty do góry**: zmiany wartości są
  nanoszone przyrostowo na istniejący DOM (pełna przebudowa tylko przy
  zmianie struktury kolejki), więc fokus i pozycja scrolla zostają.

### Dodane
- **Stanowe przyciski sterujące**: PRACUJE → „Pauza / Pomiń / Stop",
  WSTRZYMANA → „Kontynuuj / Pomiń / Stop", BEZCZYNNA → „Start / Wyczyść".
  „Kontynuuj" wznawia też zapauzowanego robota (gdy stoi w stanie paused).
  Nowy pomarańczowy badge WSTRZYMANA i stan `paused` sensora.
- **Przycisk Stop z potwierdzeniem** (uzbrojenie dwuklikiem, jak ✕):
  kończy sesję — zatrzymuje robota, odsyła do doku, listę zostawia.
  Dostępny też jako serwis `stop` i encja przycisku.
- **Masowa zmiana parametrów**: wiersz „Wszystkie:" z trzema selectami
  ustawia ssanie / mop / powtórzenia dla wszystkich pozycji oczekujących
  naraz (przełączalny w edytorze); serwis `set_all_params`.

## [1.6.0] - 2026-07-04

### Dodane
- Rozdział README „Przepis: sprzątanie, gdy nikogo nie ma w domu" —
  kompletny scenariusz obecnościowy: preset + automatyzacja startu po
  wyjściu ostatniego domownika + pauza po powrocie.
- **Serwis `run` dla automatyzacji** — jednym wywołaniem wczytuje preset
  i/lub listę pokoi (nazwy albo obiekty z parametrami) i startuje kolejkę;
  tryby replace/append, opcja `start: false`.
- **Blueprint „Sprzątanie wg harmonogramu"** (`blueprints/automation/...`) —
  automatyzacja do wyklikania: godzina, dni tygodnia, nazwa presetu,
  opcjonalny warunek startu tylko z doku.
- Rozdział „Automatyzacje" w README z importem blueprintu i przykładami
  (harmonogram z presetu, sprzątanie po wyjściu z domu).

## [1.5.3] - 2026-07-04

### Naprawione
- **Ucięte nazwy pokoi w trybie wąskim**: gdy strzałki ▲▼ są ukryte (lub
  karta jest w trybie podglądu), nazwa pokoju zajmuje teraz dwie kolumny
  zamiast zostawiać pustą przestrzeń zarezerwowaną pod przyciski.
- **Czytelność na telefonie**: typografia trybu wąskiego podniesiona do
  rozmiarów mobilnych — pola 16 px (co przy okazji eliminuje auto-zoom
  Safari/iOS przy tapnięciu w select), nazwa pokoju 17 px, etykiety 12 px,
  przyciski 40–42 px; wyraźniejszy uchwyt na krawędzi karty.
- Placeholder `YOUR_GITHUB_USER` w manifest.json zastąpiony właściwym
  adresem repozytorium (naprawia link pomocy „?" na stronie integracji).

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
