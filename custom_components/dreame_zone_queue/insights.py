"""Diagnostyka robota: miejsca problemow, efektywnosc pokoi, podzial czasu
sesji i rekomendacje. Czyste funkcje (bez Home Assistanta) — testy:
tests/test_insights.py."""
from __future__ import annotations

import math
import statistics
from collections import Counter

# ponytail: zmierzone na L10 Prime (historia baterii z HA, 10 dni) — uzywane
# tylko dopoki przebiegi nie maja wlasnego pomiaru bat_used (od beta.23)
CHARGE_PCT_PER_MIN = 0.7  # ladowanie w pasmie 20-80 %
DEFAULT_BAT_PER_MIN = {("sweeping", "turbo"): 2.4, ("mopping", "off"): 0.65}
# szacunek pracy recznej [min/m²]; karta moze nadpisac (manual_sweep/manual_mop)
MANUAL_MIN_PER_M2 = {"sweeping": 0.5, "mopping": 0.8, "sweeping_and_mopping": 1.2}
IDLE_GAP_S = 30 * 60  # dluzsza przerwa miedzy pokojami = kolejka stala (nie dok)

MODE_PL = {"sweeping": "odkurzanie", "mopping": "mopowanie",
           "sweeping_and_mopping": "odkurzanie + mop"}
CONSUMABLES = {"main_brush_left": "szczotka główna", "side_brush_left": "boczna szczotka",
               "filter_left": "filtr", "sensor_dirty_left": "czujniki (wyczyść)",
               "mop_pad_left": "pad mopa"}
# wskazowka do miejsca problemu wg najczestszego powodu
HINTS = (
    ("Side brush", "boczna szczotka się blokuje — kable, frędzle, zużyta szczotka"),
    ("Brush", "szczotka główna się blokuje — kable, frędzle dywanu, włosy"),
    ("Drop", "czujniki krawędzi — brudne czujniki, ciemny dywan albo próg"),
    ("wheel", "zablokowane koło — próg, kabel, nóżka mebla"),
    ("Restricted", "robot w ciasnym miejscu / przy strefie zakazanej"),
    ("Route", "robot nie znalazł drogi — zamknięte drzwi albo przeszkoda"),
    ("brak ruchu", "robot kręci się w miejscu — ciasno pod meblem?"),
    ("zatrzymano", "tu najczęściej zatrzymujesz robota ręcznie"),
)


def is_stuck(track: list, window_s: int, move_mm: int) -> bool:
    """track: [[t, x, y], ...] probki co ~60 s. True, gdy probki obejmuja
    co najmniej window_s, a robot przez ten czas nie wyszedl poza move_mm."""
    if len(track) < 3:
        return False
    t_last = track[-1][0]
    span = [p for p in track if p[0] >= t_last - window_s - 30]
    if len(span) < 3 or t_last - span[0][0] < window_s - 30:
        return False
    xs = [p[1] for p in span]
    ys = [p[2] for p in span]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys)) < move_mm


# ponytail: heurystyka na probkach pozycji co ~3 s (kamera mapy dreame), bez
# planu trasy robota — progi do dostrojenia na prawdziwych torach z feedback logu
DETOUR_TOL_DEG = 20     # odchylenie od siatki pasow, ponizej = jazda po torze
DETOUR_MIN_SEG_MM = 150  # krotsze ruchy (postoj, obrot w miejscu) pomijamy
DETOUR_GAP_MM = 1500     # dluzszy skok = przerwa w zapisie toru
DETOUR_MAX_MM = 2500     # dluzszy objazd to juz przejazd (np. powrot z doku)


def find_detours(path: list, zone) -> list:
    """Miejsca, w ktorych robot zjechal z toru, zeby ominac przeszkode.

    path: [[x, y], ...] pozycje robota w trakcie sprzatania pokoju (mm).
    W strefie robot jezdzi zygzakiem: dlugie pasy wzdluz jednej osi i krotkie
    przesuniecia na kolejny pas. Objazd = odcinki pod skosem do siatki pasow,
    po ktorych robot wraca na pas w TYM SAMYM kierunku. Skos zakonczony
    zawroceniem to zwykly koniec pasa (probka wypadla w trakcie nawrotu)."""
    xa, xb = sorted((zone[0], zone[2]))
    ya, yb = sorted((zone[1], zone[3]))
    segs = []  # (kat, dlugosc, a, b); None = przerwa w torze
    for a, b in zip(path, path[1:]):
        n = math.dist(a, b)
        if n < DETOUR_MIN_SEG_MM:
            continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if n > DETOUR_GAP_MM or not (xa <= mx <= xb and ya <= my <= yb):
            segs.append(None)
            continue
        segs.append((math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])), n, a, b))
    real = [s for s in segs if s]
    if len(real) < 6:
        return []
    # orientacja siatki: najczestszy kat mod 90 (wazony dlugoscia), kosze 5°
    bins: Counter = Counter()
    for ang, n, *_ in real:
        bins[round((ang % 90) / 5) % 18] += n
    grid = bins.most_common(1)[0][0] * 5

    def off(ang):  # 0..45° od najblizszej osi siatki
        d = (ang - grid) % 90
        return min(d, 90 - d)

    # os pasow = ta z dwoch osi siatki, wzdluz ktorej robot przejechal wiecej
    axes: Counter = Counter()
    for ang, n, *_ in real:
        if off(ang) < DETOUR_TOL_DEG:
            axes[round(((ang - grid) % 180) / 90) % 2] += n
    lane = grid + 90 * axes.most_common(1)[0][0]

    def lane_dir(ang):  # 1 / -1 = jazda pasem w jedna / druga strone
        d = (ang - lane) % 360
        if min(d, 360 - d) < DETOUR_TOL_DEG:
            return 1
        return -1 if abs(d - 180) < DETOUR_TOL_DEG else 0

    out: list = []
    last = 0      # kierunek ostatniego pasa
    run: list = []  # biezacy ciag odcinkow pod skosem
    for sg in segs:
        if sg is None:
            last, run = 0, []
            continue
        ang, n, a, b = sg
        if off(ang) >= DETOUR_TOL_DEG:
            run.append(sg)
            continue
        d = lane_dir(ang)
        if not d:
            continue  # przesuniecie na kolejny pas
        if run and d == last and sum(r[1] for r in run) <= DETOUR_MAX_MM:
            pts = [p for r in run for p in (r[2], r[3])]
            c = [round(statistics.fmean(p[0] for p in pts)),
                 round(statistics.fmean(p[1] for p in pts))]
            if out and math.dist(out[-1], c) <= 1200:
                # zjazd z pasa i powrot na niego = jeden objazd
                out[-1] = [round((out[-1][0] + c[0]) / 2), round((out[-1][1] + c[1]) / 2)]
            else:
                out.append(c)
        last, run = d, []
    return out


def cluster_incidents(incidents: list, radius_mm: int = 600) -> list:
    """Incydenty z pozycja -> miejsca (zachlannie, srodek = srednia).
    Najczestsze pierwsze."""
    clusters: list[dict] = []
    for inc in incidents:
        pos = inc.get("pos")
        if not pos:
            continue
        for c in clusters:
            if math.dist(c["pos"], pos) <= radius_mm:
                c["items"].append(inc)
                n = len(c["items"])
                c["pos"] = [c["pos"][0] + (pos[0] - c["pos"][0]) / n,
                            c["pos"][1] + (pos[1] - c["pos"][1]) / n]
                break
        else:
            clusters.append({"pos": list(pos), "items": [inc]})
    out = []
    for c in clusters:
        its = c["items"]
        reasons = Counter(i["reason"] for i in its).most_common(3)
        out.append({
            "pos": [round(c["pos"][0]), round(c["pos"][1])],
            "n": len(its),
            "kinds": dict(Counter(i["kind"] for i in its)),
            "reasons": [[r, n] for r, n in reasons],
            "room": Counter(i.get("room") for i in its).most_common(1)[0][0],
            "last": max(i["ts"] for i in its),
            "hint": _hint(reasons[0][0]),
        })
    return sorted(out, key=lambda c: (-c["n"], -c["last"]))


def _hint(reason: str) -> str:
    for key, text in HINTS:
        if key.lower() in reason.lower():
            return text
    return "sprawdź podłogę w tym miejscu"


def _category(reason: str) -> str:
    if reason == "ładowanie":
        return "charging"
    if reason in ("mycie mopa", "jedzie myć mopa", "suszenie mopa",
                  "opróżnianie kurzu"):
        return "washing"
    if reason.startswith("błąd"):
        return "error"
    return "paused"


def active_s(run: dict) -> int:
    """Czas faktycznej pracy w pokoju (bez ladowania, mycia, bledow, pauz)."""
    return max(0, run["dur"] - sum(e["dur"] for e in run.get("events", [])))


def session_breakdown(session: dict) -> dict | None:
    """Gdzie poszedl czas sesji [s]: sprzatanie, ladowanie, mycie mopa,
    bledy, pauzy, dok/dojazdy (przerwy miedzy pokojami <= 30 min) i postoj
    kolejki (dluzsze przerwy — nie wliczany do efektywnosci)."""
    runs = sorted(session.get("runs") or [], key=lambda r: r["ts"])
    if not runs:
        return None
    out = dict.fromkeys(("cleaning", "charging", "washing", "error", "paused",
                         "dock", "idle"), 0)
    prev_end = session["started"]
    for r in runs:
        gap = max(0, r["ts"] - prev_end)
        out["dock" if gap <= IDLE_GAP_S else "idle"] += gap
        out["cleaning"] += active_s(r)
        for e in r.get("events", []):
            out[_category(e["reason"])] += e["dur"]
        prev_end = max(prev_end, r["ts"] + r["dur"])
    if session.get("ended"):
        gap = max(0, session["ended"] - prev_end)
        out["dock" if gap <= IDLE_GAP_S else "idle"] += gap
    out["total"] = sum(out.values())
    return out


def fmt_min(minutes: float) -> str:
    return f"{minutes / 60:.0f} h" if minutes >= 120 else f"{minutes:.0f} min"


def _zone_m2(zone) -> float | None:
    try:
        return abs(zone[2] - zone[0]) * abs(zone[3] - zone[1]) / 1_000_000
    except (TypeError, IndexError):
        return None


def _area(run: dict) -> float | None:
    """m² sprzatniete w przebiegu: pomiar robota, a dla starszych wpisow
    pct * pole strefy."""
    if run.get("area") is not None:
        return float(run["area"])
    z = _zone_m2(run.get("zone"))
    return z * run["pct"] / 100 if z and run.get("pct") is not None else None


def room_efficiency(sessions: list, since_ts: int) -> list:
    """Per pokoj i tryb: ile trwa, ile m², ile baterii, ile problemow."""
    groups: dict[tuple, list] = {}
    for s in sessions:
        runs = sorted(s.get("runs") or [], key=lambda r: r["ts"])
        for i, r in enumerate(runs):
            if r["ts"] < since_ts:
                continue
            nxt = runs[i + 1] if i + 1 < len(runs) else None
            gap = nxt["ts"] - (r["ts"] + r["dur"]) if nxt else None
            r = {**r, "_after": gap if gap is not None and 0 <= gap <= IDLE_GAP_S else None}
            groups.setdefault((r["room"], r["mode"]), []).append(r)
    med = lambda xs: statistics.median(xs) if xs else None  # noqa: E731
    out = []
    for (room, mode), runs in groups.items():
        done = [r for r in runs if r["outcome"] == "done"]
        problems = [r for r in runs if r["outcome"] in ("cancelled", "error", "skipped")]
        suction = Counter(r.get("suction") for r in done or runs).most_common(1)[0][0]
        act = med([active_s(r) / 60 for r in done])
        area = med([a for a in (_area(r) for r in done) if a])
        measured = [r["bat_used"] for r in done if r.get("bat_used") is not None]
        if len(measured) >= 2:
            bat, bat_src = med(measured), "measured"
        elif act and (mode, suction) in DEFAULT_BAT_PER_MIN:
            bat, bat_src = act * DEFAULT_BAT_PER_MIN[(mode, suction)], "estimated"
        else:
            bat, bat_src = None, None
        lost = sum(e["dur"] for r in runs for e in r.get("events", [])
                   if _category(e["reason"]) in ("error", "paused"))
        lost += sum(r["dur"] for r in runs if r["outcome"] == "cancelled")
        out.append({
            "room": room, "mode": mode, "suction": suction,
            "runs": len(runs), "done": len(done), "problems": len(problems),
            "problem_rate": round(len(problems) / len(runs), 2),
            "active_min": round(act, 1) if act else None,
            "area_m2": round(area, 1) if area else None,
            "m2_per_min": round(area / act, 2) if area and act else None,
            "bat_pct": round(bat) if bat is not None else None,
            "bat_src": bat_src,
            "dock_min": round(med([r["_after"] / 60 for r in done
                                   if r["_after"] is not None]) or 0, 1),
            "lost_min": round(lost / 60),
        })
    return sorted(out, key=lambda e: (e["room"], e["mode"]))


def recommendations(eff: list, breakdown: dict | None,
                    vacuum_attrs: dict, manual: dict | None = None,
                    typical: set | None = None) -> list:
    """Lista {kind, title, text, save_min?, save_bat?} — najwazniejsze
    pierwsze. manual: min/m² pracy recznej wg trybu (nadpisuje domyslne);
    typical: pary (pokoj, tryb) typowej pelnej kolejki — do bilansu baterii."""
    manual = {**MANUAL_MIN_PER_M2, **(manual or {})}
    recs: list[dict] = []

    # 1) pokoje, ktore szybciej zrobic recznie
    cands = []
    for e in eff:
        if e["done"] < 3 or not e["area_m2"] or not e["active_min"]:
            continue
        robot = e["active_min"] + e["dock_min"]
        charge = (e["bat_pct"] or 0) / CHARGE_PCT_PER_MIN
        hand = e["area_m2"] * manual.get(e["mode"], 1.0)
        if robot + charge >= 4 * hand and hand <= 10:
            bat = f" i ~{e['bat_pct']}% baterii (≈{charge:.0f} min ładowania)" if e["bat_pct"] else ""
            cands.append({
                "kind": "manual",
                "title": f"{e['room']} — {MODE_PL.get(e['mode'], e['mode'])}: szybciej ręcznie",
                "text": f"Robot: {robot:.0f} min{bat} na {e['area_m2']:.0f} m². "
                        f"Ręcznie ok. {hand:.0f} min. Zrób to ręcznie i usuń z "
                        f"kolejki — robot skończy ~{robot + charge:.0f} min wcześniej "
                        "(praca + ładowanie).",
                "save_min": round(robot + charge), "save_bat": e["bat_pct"],
            })
    recs += sorted(cands, key=lambda r: -r["save_min"])[:3]

    # 2) pokoje z czestymi problemami (3 najgorsze)
    bad = [e for e in eff if e["runs"] >= 4 and e["problem_rate"] >= 0.3]
    for e in sorted(bad, key=lambda e: -e["lost_min"])[:3]:
        recs.append({
            "kind": "problem_room",
            "title": f"{e['room']} — {MODE_PL.get(e['mode'], e['mode'])}: "
                     f"{e['problem_rate']:.0%} przebiegów nieudanych",
            "text": f"{e['problems']} z {e['runs']} przebiegów przerwanych, "
                    f"pominiętych albo z błędem (stracone ~{fmt_min(e['lost_min'])}). "
                    "Miejsca problemów tego pokoju są na mapie powyżej.",
        })

    # 3) Turbo przy odkurzaniu
    sweep = [e for e in eff if e["mode"] == "sweeping"]
    turbo = sum(e["runs"] for e in sweep if e["suction"] == "turbo")
    if sweep and turbo >= 0.5 * sum(e["runs"] for e in sweep):
        recs.append({
            "kind": "suction",
            "title": "Odkurzanie na Turbo zjada baterię",
            "text": "Turbo zużywa ok. 2,4 %/min (bateria na ~40 min). Standard "
                    "zwykle o połowę mniej, a dywany i tak dostają więcej mocy "
                    "(podbijanie na dywanach). Ustaw Standard w presetach.",
        })

    # 4) ile baterii potrzebuje typowa pelna kolejka
    plan = [e for e in eff if e["bat_pct"]
            and (typical is None or (e["room"], e["mode"]) in typical)]
    need = sum(e["bat_pct"] for e in plan)
    if need > 100:
        mop = sum(e["bat_pct"] for e in plan if e["mode"] == "mopping")
        extra = need - 100
        recs.append({
            "kind": "battery",
            "title": f"Pełna kolejka to ~{need:.0f}% baterii",
            "text": f"Potrzeba ~{math.ceil(extra / 100)} doładowań "
                    f"(≈{extra / CHARGE_PCT_PER_MIN:.0f} min ładowania). "
                    + (f"Samo mopowanie to ~{mop:.0f}% — zaczynaj je od pełnej "
                       "baterii, osobno od odkurzania." if mop else ""),
            "save_bat": round(extra),
        })

    # 5) podzial czasu
    if breakdown:
        work = breakdown["total"] - breakdown["idle"]
        if work > 0 and breakdown["error"] / work >= 0.2:
            recs.append({
                "kind": "time",
                "title": f"{fmt_min(breakdown['error'] / 60)} robot stał z błędem",
                "text": "To najwięcej straconego czasu. Ustaw powiadomienia push "
                        "(opcje integracji → Ustawienia → usługa notify) — "
                        "dostaniesz alarm od razu i drugi po 10 min.",
            })
        if work > 0 and breakdown["charging"] / work >= 0.3:
            recs.append({
                "kind": "time",
                "title": f"{breakdown['charging'] / work:.0%} czasu kolejek to ładowanie",
                "text": "Robot dłużej się ładuje niż sprząta. Mniej Turbo i "
                        "mopowanie od pełnej baterii skracają ładowanie najbardziej.",
            })

    # 6) materialy eksploatacyjne
    worn = []
    for key, name in CONSUMABLES.items():
        try:
            left = float(vacuum_attrs.get(key))
        except (TypeError, ValueError):
            continue
        if left <= 10:
            worn.append(f"{name} {left:.0f}%")
    if worn:
        recs.append({
            "kind": "consumables",
            "title": "Serwis robota",
            "text": "Do wymiany/czyszczenia: " + ", ".join(worn) + ". Zużyte "
                    "szczotki i brudne czujniki to częsta przyczyna błędów.",
        })
    # najwiekszy zysk pierwszy; miejsca problemow sa w osobnej liscie karty
    order = ("time", "consumables", "problem_room", "manual", "battery", "suction")
    return sorted(recs, key=lambda r: order.index(r["kind"]))


def build_insights(sessions: list, incidents: list, vacuum_attrs: dict,
                   now: int, days: int = 30, manual: dict | None = None) -> dict:
    """Komplet danych dla karty diagnostyki (GET /api/.../insights)."""
    since = now - days * 86400
    recent = [s for s in sessions
              if (s.get("ended") or now) >= since and s.get("runs")]
    eff = room_efficiency(recent, since)
    total: dict = {}
    for s in recent:
        b = session_breakdown(s) or {}
        for k, v in b.items():
            total[k] = total.get(k, 0) + v
    incidents = [i for i in incidents if i["ts"] >= since]
    hotspots = cluster_incidents(incidents)
    area = sum(a for s in recent for r in s["runs"]
               if r["ts"] >= since and r["outcome"] == "done"
               for a in [_area(r)] if a)
    work_h = (total.get("total", 0) - total.get("idle", 0)) / 3600
    # typowa pelna kolejka = ostatnia sesja z co najmniej 5 posprzatanymi pokojami
    big = [s for s in recent
           if sum(r["outcome"] == "done" for r in s["runs"]) >= 5]
    typical = {(r["room"], r["mode"]) for r in big[-1]["runs"]} if big else None
    return {
        "days": days,
        "sessions": len(recent),
        "breakdown": total or None,
        "area_m2": round(area),
        "m2_per_hour": round(area / work_h, 1) if work_h else None,
        # m² na godzine samego sprzatania (bez ladowania, mycia, bledow)
        "m2_per_hour_net": (round(area / (total["cleaning"] / 3600), 1)
                            if total.get("cleaning") else None),
        "efficiency": eff,
        "hotspots": hotspots,
        # surowe pozycje zawieszen (utkniecie / blad) pod heatmape;
        # reczne zatrzymania pomijamy — to decyzja usera, nie problem robota
        "stuck_points": [i["pos"][:2] for i in incidents
                         if i.get("pos") and i["kind"] in ("stuck", "error")],
        # objazdy przeszkod zapisane przy przebiegach (od 2.0.0-beta.25)
        "detour_points": [p for s in recent for r in s["runs"]
                          if r["ts"] >= since for p in r.get("detours") or []],
        "incidents": len(incidents),
        "recommendations": recommendations(eff, total or None,
                                           vacuum_attrs, manual, typical),
    }
