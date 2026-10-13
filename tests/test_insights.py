# Testy diagnostyki (insights.py) — czyste funkcje, bez Home Assistanta.
# Run:  python3 tests/test_insights.py
import importlib.util
from pathlib import Path

CC = Path(__file__).resolve().parent.parent / "custom_components" / "dreame_zone_queue"
spec = importlib.util.spec_from_file_location("insights", CC / "insights.py")
ins = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ins)


def run(room, mode, ts, dur, outcome="done", events=(), suction="standard",
        area=None, pct=None, zone=(0, 0, 3000, 2000), bat_used=None):
    return {"room": room, "mode": mode, "ts": ts, "dur": dur, "outcome": outcome,
            "events": list(events), "suction": suction, "area": area, "pct": pct,
            "zone": list(zone), "bat_used": bat_used}


def test_is_stuck():
    still = [[0, 1000, 1000], [60, 1050, 1000], [120, 1020, 980], [180, 1040, 1010]]
    assert ins.is_stuck(still, 180, 300)
    assert not ins.is_stuck(still[:3], 180, 300)  # za krotko
    moving = [[0, 0, 0], [60, 400, 0], [120, 800, 0], [180, 1200, 0]]
    assert not ins.is_stuck(moving, 180, 300)


def test_cluster_incidents():
    incs = [
        {"ts": 1, "kind": "error", "reason": "błąd: Brush", "room": "Salon", "pos": [5000, -2000]},
        {"ts": 2, "kind": "error", "reason": "błąd: Brush", "room": "Salon", "pos": [5200, -2100]},
        {"ts": 3, "kind": "stuck", "reason": "brak ruchu 3 min", "room": "Salon", "pos": [5100, -1900]},
        {"ts": 4, "kind": "error", "reason": "błąd: Drop", "room": "Kuchnia", "pos": [0, -3000]},
        {"ts": 5, "kind": "cancel", "reason": "x", "room": "Biuro", "pos": None},  # bez pozycji
    ]
    hs = ins.cluster_incidents(incs)
    assert len(hs) == 2 and hs[0]["n"] == 3 and hs[0]["room"] == "Salon"
    assert hs[0]["reasons"][0] == ["błąd: Brush", 2] and "szczotka główna" in hs[0]["hint"]
    assert hs[0]["kinds"] == {"error": 2, "stuck": 1}
    # heatmapa: tylko utkniecia i bledy z pozycja, w oknie czasowym
    incs.append({"ts": 6, "kind": "cancel", "reason": "x", "room": "Biuro", "pos": [1, 1]})
    out = ins.build_insights([], incs, {}, now=4 + 86400, days=1)
    assert out["stuck_points"] == [[0, -3000]] and out["incidents"] == 3


def test_session_breakdown():
    s = {"started": 0, "ended": 4000, "runs": [
        run("A", "sweeping", 60, 1200, events=[{"reason": "ładowanie", "dur": 600}]),
        run("B", "mopping", 1400, 900, events=[{"reason": "mycie mopa", "dur": 150},
                                                {"reason": "błąd: Brush", "dur": 100}]),
    ]}
    b = ins.session_breakdown(s)
    assert b["cleaning"] == 600 + 650 and b["charging"] == 600
    assert b["washing"] == 150 and b["error"] == 100
    assert b["dock"] == 60 + 140 + 1700 and b["idle"] == 0  # przerwy <= 30 min
    assert b["total"] == 4000
    s["ended"] = 2300 + 3 * 3600  # kolejka stala 3 h po ostatnim pokoju
    assert ins.session_breakdown(s)["idle"] == 3 * 3600


def test_room_efficiency_and_manual_recommendation():
    runs = []
    t = 0
    for _ in range(4):  # maly korytarz: 9 min robota + 3 min mycia, 4 m²
        runs.append(run("Korytarz", "sweeping", t, 540, area=4.0, bat_used=12, suction="turbo"))
        t += 540 + 180
    runs.append(run("Salon", "sweeping", t, 600, outcome="cancelled",
                    events=[{"reason": "błąd: Brush", "dur": 300}]))
    eff = ins.room_efficiency([{"started": 0, "ended": t + 600, "runs": runs}], 0)
    kor = next(e for e in eff if e["room"] == "Korytarz")
    assert kor["done"] == 4 and kor["active_min"] == 9 and kor["bat_pct"] == 12
    assert kor["bat_src"] == "measured" and kor["dock_min"] == 3.0
    assert kor["m2_per_min"] == round(4 / 9, 2)
    salon = next(e for e in eff if e["room"] == "Salon")
    assert salon["problem_rate"] == 1.0 and salon["lost_min"] == 15
    recs = ins.recommendations(eff, None, {}, manual={"sweeping": 0.5})
    man = [r for r in recs if r["kind"] == "manual"]
    # robot 12 min + 12% (~17 min ladowania) vs recznie 2 min -> polecamy
    assert man and man[0]["save_min"] == 29 and "Korytarz" in man[0]["title"]
    assert any(r["kind"] == "suction" for r in recs)  # wszystko na Turbo


def test_estimated_battery_and_old_runs_area():
    # stare przebiegi: bez bat_used i area -> szacunek z pct strefy i zmierzonej stawki Turbo
    runs = [run("A", "sweeping", i * 1000, 600, suction="turbo", pct=50) for i in range(3)]
    e = ins.room_efficiency([{"started": 0, "ended": 4000, "runs": runs}], 0)[0]
    assert e["area_m2"] == 3.0 and e["bat_src"] == "estimated" and e["bat_pct"] == 24


def test_consumables_and_battery_plan():
    eff = [{"room": "A", "mode": "sweeping", "bat_pct": 90, "runs": 1, "done": 1,
            "problem_rate": 0, "suction": "standard", "area_m2": None, "active_min": None},
           {"room": "B", "mode": "mopping", "bat_pct": 60, "runs": 1, "done": 1,
            "problem_rate": 0, "suction": "off", "area_m2": None, "active_min": None}]
    recs = ins.recommendations(eff, None, {"side_brush_left": 0, "filter_left": 40})
    kinds = {r["kind"]: r for r in recs}
    assert "boczna szczotka 0%" in kinds["consumables"]["text"]
    assert "filtr" not in kinds["consumables"]["text"]
    assert "150%" in kinds["battery"]["title"] and "60%" in kinds["battery"]["text"]
    # bilans tylko dla typowej kolejki
    recs = ins.recommendations(eff, None, {}, typical={("A", "sweeping")})
    assert not any(r["kind"] == "battery" for r in recs)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"OK  {name}")
    print("insights: wszystkie testy przeszły")
