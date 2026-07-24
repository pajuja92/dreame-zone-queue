# Standalone orchestration simulation for QueueManager (no Home Assistant
# needed): stubs homeassistant.* modules, feeds fake vacuum states/events and
# asserts the interrupted / done / cancel / watchdog decisions.
#
# Run:  python3 tests/test_orchestrator_sim.py
import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

CC = Path(__file__).resolve().parent.parent / "custom_components" / "dreame_zone_queue"

# ---------------------------------------------------------------- HA stubs
NOTIFICATIONS: list[str] = []


class FakeEvent:
    def __init__(self, data):
        self.data = data


def _stub_module(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


def _async_call_later(hass, delay, action):
    entry = [delay, action]
    hass.timers.append(entry)
    return lambda: entry in hass.timers and hass.timers.remove(entry)


class FakeStore:
    last = None  # wspoldzielone "na dysku" — resetowane w mk()

    def __init__(self, *a, **k):
        pass

    async def async_load(self):
        import copy
        return copy.deepcopy(FakeStore.last) if FakeStore.last else {}

    async def async_save(self, data):
        import copy
        FakeStore.last = copy.deepcopy(data)


_stub_module("homeassistant")
_stub_module("homeassistant.core", Event=FakeEvent, HomeAssistant=object,
             callback=lambda f: f)
_stub_module("homeassistant.helpers")
_stub_module("homeassistant.helpers.dispatcher",
             async_dispatcher_send=lambda *a, **k: None)
_stub_module("homeassistant.helpers.event",
             async_call_later=_async_call_later,
             async_track_state_change_event=lambda hass, ents, cb: (lambda: None))
_stub_module("homeassistant.helpers.storage", Store=FakeStore)
_stub_module("homeassistant.components")
_stub_module(
    "homeassistant.components.persistent_notification",
    async_create=lambda hass, msg, title=None, notification_id=None:
        NOTIFICATIONS.append(msg),
)

# import the integration as a lightweight package so relative imports work
pkg = types.ModuleType("dzq")
pkg.__path__ = [str(CC)]
sys.modules["dzq"] = pkg
for mod in ("const", "manager"):
    spec = importlib.util.spec_from_file_location(f"dzq.{mod}", CC / f"{mod}.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules[f"dzq.{mod}"] = m
    spec.loader.exec_module(m)

const = sys.modules["dzq.const"]
QueueManager = sys.modules["dzq.manager"].QueueManager

# ---------------------------------------------------------------- fake hass


class FakeBus:
    def __init__(self):
        self.listeners = {}

    def async_listen(self, event_type, cb):
        self.listeners[event_type] = cb
        return lambda: None


class FakeServices:
    def __init__(self):
        self.calls = []
        self.available = True  # dreame_vacuum service present?

    def has_service(self, domain, service):
        return self.available

    async def async_call(self, domain, service, data, blocking=False):
        self.calls.append((domain, service, data))


class FakeStates(dict):
    def get(self, k):  # noqa: A003
        return dict.get(self, k)


class FakeHass:
    def __init__(self):
        self.states = FakeStates()
        self.services = FakeServices()
        self.bus = FakeBus()
        self.timers = []

    def async_create_task(self, coro):
        return asyncio.get_event_loop().create_task(coro)


VAC = "vacuum.l10"
ROOMS = {
    "Salon": {"icon": "", "zone": [0, 0, 2000, 2000],
              "suction": "standard", "water": "moist", "repeats": 1},
    "Kuchnia": {"icon": "", "zone": [3000, 0, 5000, 2000],
                "suction": "turbo", "water": "wet", "repeats": 1},
}


def st(state, **attrs):
    attrs.setdefault("located", True)
    return SimpleNamespace(state=state, attributes=attrs)


CLEANING = dict(running=True, zone_cleaning=True, started=True)
TASK_DONE = dict(running=False, zone_cleaning=False, started=False)
WASH_MID = dict(running=True, zone_cleaning=True, started=True,
                returning=True, resume_cleaning=True,
                vacuum_state="returning_to_wash")


def mk(extra_opts=None):
    FakeStore.last = None
    hass = FakeHass()
    entry = SimpleNamespace(
        data={const.CONF_VACUUM_ENTITY: VAC},
        options={const.CONF_ROOMS: ROOMS, const.CONF_GRACE_S: 0,
                 const.CONF_DELAY_BETWEEN_S: 0, **(extra_opts or {})},
    )
    return hass, QueueManager(hass, entry)


def send(m, old, new):
    m.hass.states[VAC] = new
    m._on_vacuum_state(FakeEvent({"old_state": old, "new_state": new}))


async def drain(n=4):
    for _ in range(n):
        await asyncio.sleep(0)


async def fire_timers(hass):
    """Fire the callbacks scheduled so far (watchdog reschedules itself, so
    snapshot-and-clear instead of looping until empty)."""
    pending = list(hass.timers)
    hass.timers.clear()
    for _, action in pending:
        await action(None)
        await drain()


def zone_calls(hass):
    return [c for c in hass.services.calls if c[1] == "vacuum_clean_zone"]


# ---------------------------------------------------------------- scenarios


async def test_happy_path_and_int_params():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    calls = zone_calls(hass)
    assert len(calls) == 1 and calls[0][2]["zone"] == [[0, 0, 2000, 2000]]
    assert calls[0][2]["suction_level"] == 1 and calls[0][2]["water_volume"] == 2
    send(m, st("cleaning", **CLEANING), st("returning", **TASK_DONE))
    await drain()
    assert m.queue[0]["status"] == "done"
    await fire_timers(hass)  # delay-between-zones -> dispatch Kuchnia
    calls = zone_calls(hass)
    assert len(calls) == 2 and calls[1][2]["suction_level"] == 3
    assert calls[1][2]["water_volume"] == 3


async def test_wash_interrupt_resume_and_stats_excluded():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    item["started_at"] -= 100  # pretend it ran 100 s
    send(m, st("cleaning", **CLEANING), st("returning", **WASH_MID))
    assert item["interrupted"] and item["reason"] == "jedzie myć mopa"
    send(m, st("returning", **WASH_MID), st("cleaning", **CLEANING))
    assert not item["interrupted"] and item["was_interrupted"]
    send(m, st("cleaning", **CLEANING), st("returning", **TASK_DONE))
    assert item["status"] == "done"
    assert "Salon" not in m.stats  # interrupted run excluded from ETA stats


async def test_pause_then_finish_then_resume():  # B1 case A
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_pause()
    # robot finishes the room WHILE the queue is paused
    send(m, st("cleaning", **CLEANING), st("docked", **TASK_DONE))
    await drain()
    assert m.queue[0]["status"] == "done" and not m.running
    assert not zone_calls(hass)[1:]  # paused -> no dispatch
    await m.async_start()
    assert len(zone_calls(hass)) == 2  # Kuchnia dispatched on resume


async def test_resume_with_no_task_redispatches():  # B1 case B
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_pause()
    hass.states[VAC] = st("docked", **TASK_DONE)  # robot has no task at all
    await m.async_start()
    assert len(zone_calls(hass)) == 2  # Salon re-dispatched
    assert m.queue[0]["status"] == "active"


async def test_cancel_event_pauses_queue():  # B2
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    handler = hass.bus.listeners["dreame_vacuum_task_status"]
    handler(FakeEvent({"entity_id": VAC, "job": {"completed": False}}))
    await drain()
    assert not m.running and m.queue[0]["status"] == "pending"
    assert any("anulowane" in n for n in NOTIFICATIONS)


async def test_own_skip_does_not_trigger_cancel():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_skip()  # our own vacuum.stop fires completed=False too
    handler = hass.bus.listeners["dreame_vacuum_task_status"]
    handler(FakeEvent({"entity_id": VAC, "job": {"completed": False}}))
    await drain()
    assert m.running  # NOT treated as user cancel
    assert m.queue[0]["status"] == "skipped"


async def test_cancel_reverts_fresh_done():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING), st("docked", **TASK_DONE))
    assert m.queue[0]["status"] == "done"
    handler = hass.bus.listeners["dreame_vacuum_task_status"]
    handler(FakeEvent({"entity_id": VAC, "job": {"completed": False}}))
    await drain()
    assert m.queue[0]["status"] == "pending" and not m.running


async def test_error_state_marks_interrupted():  # B3
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING),
         st("error", has_error=True, error="Robot stuck",
            zone_cleaning=True, started=True, running=False))
    item = m.queue[0]
    assert item["interrupted"] and "Robot stuck" in item["reason"]
    assert any("Robot stuck" in n for n in NOTIFICATIONS)
    # rescue: robot cleans again, then finishes
    send(m, st("error", **CLEANING), st("cleaning", **CLEANING))
    assert not item["interrupted"]
    send(m, st("cleaning", **CLEANING), st("docked", **TASK_DONE))
    assert item["status"] == "done"


async def test_watchdog_recovers_missed_done():  # P1
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    m.queue[0]["seen_running"] = True  # robot was seen cleaning
    hass.states[VAC] = st("docked", **TASK_DONE)  # ...but HA lost the event
    await m._async_reconcile()
    await drain()
    assert m.queue[0]["status"] == "done"
    await fire_timers(hass)
    assert len(zone_calls(hass)) == 2  # Kuchnia dispatched


async def test_watchdog_redispatches_lost_command():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    # robot never started (no seen_running), task gone -> one retry
    hass.timers.clear()
    await m._async_reconcile()
    assert len(zone_calls(hass)) == 2 and m.queue[0].get("redispatched")


async def test_wait_wash_between_rooms():  # P4
    hass, m = mk({const.CONF_WAIT_WASH: True})
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING), st("returning", **TASK_DONE))
    assert m.queue[0]["status"] == "done"
    assert len(zone_calls(hass)) == 1  # waiting for the wash, not dispatching
    send(m, st("returning", **TASK_DONE), st("docked", washing=True, **TASK_DONE))
    assert len(zone_calls(hass)) == 1
    send(m, st("docked", washing=True, **TASK_DONE),
         st("docked", washing=False, drying=True, **TASK_DONE))
    await fire_timers(hass)
    assert len(zone_calls(hass)) == 2  # wash finished -> Kuchnia goes out


async def test_task_sensor_paused_wins():  # P2
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    hass.states["sensor.l10_task_status"] = st("zone_cleaning_paused")
    send(m, st("cleaning", **CLEANING),
         st("docked", zone_cleaning=True, started=True, running=False))
    assert m.queue[0]["interrupted"]


async def test_abandoned_pause_reverts_to_pending():
    # >28 min recznej pauzy, potem firmware porzuca task ("completed")
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    send(m, st("cleaning", **CLEANING),
         st("paused", zone_cleaning=True, started=True, running=False,
            paused=True))
    assert item["interrupted"]
    item["interrupted_since"] = __import__("time").time() - 29 * 60
    send(m, st("paused", zone_cleaning=True, started=True, paused=True),
         st("docked", **TASK_DONE))  # firmware gave up -> looks "completed"
    await drain()
    assert item["status"] == "pending" and not m.running
    assert any("porzucił" in n for n in NOTIFICATIONS)


async def test_long_charging_no_false_alarm():
    # ladowanie z resume trwa 45 min — zadnego timeoutu ani ostrzezenia
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    charging = st("docked", zone_cleaning=True, started=True, running=False,
                  charging=True, resume_cleaning=True)
    send(m, st("cleaning", **CLEANING), charging)
    assert item["interrupted"]
    item["interrupted_since"] = __import__("time").time() - 45 * 60
    hass.states[VAC] = charging
    await m._async_reconcile()
    assert m.running and not NOTIFICATIONS  # queue keeps waiting quietly
    # robot resumes and finishes normally
    send(m, charging, st("cleaning", **CLEANING))
    assert not item["interrupted"]
    send(m, st("cleaning", **CLEANING), st("docked", **TASK_DONE))
    assert item["status"] == "done"


async def test_stall_warning_on_manual_pause():
    # 26 min recznej pauzy -> jednorazowe ostrzezenie, kolejka dalej czeka
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    paused = st("paused", zone_cleaning=True, started=True, running=False,
                paused=True)
    send(m, st("cleaning", **CLEANING), paused)
    item["interrupted_since"] = __import__("time").time() - 26 * 60
    hass.states[VAC] = paused
    await m._async_reconcile()
    assert m.running and item["stall_warned"]
    assert any("Wznów" in n for n in NOTIFICATIONS)
    await m._async_reconcile()
    assert sum("Wznów" in n for n in NOTIFICATIONS) == 1  # warned once


async def test_dock_keeps_room_pending():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_dock()
    assert not m.running and m.queue[0]["status"] == "pending"
    assert ("vacuum", "return_to_base") in [(c[0], c[1])
                                            for c in hass.services.calls]
    # completed=False po naszym docku NIE jest anulowaniem uzytkownika
    handler = hass.bus.listeners["dreame_vacuum_task_status"]
    handler(FakeEvent({"entity_id": VAC, "job": {"completed": False}}))
    await drain()
    assert not any("anulowane" in n for n in NOTIFICATIONS)


async def test_clear_with_active_while_paused_stops_robot():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_pause()  # kolejka spauzowana, robot wciaz sprzata pokoj
    await m.async_clear()
    calls = [(c[0], c[1]) for c in hass.services.calls]
    assert ("vacuum", "stop") in calls and ("vacuum", "return_to_base") in calls
    assert not m.queue


async def test_pause_is_immediate():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    await m.async_pause()
    assert ("vacuum", "pause") in [(c[0], c[1]) for c in hass.services.calls]
    assert not m.running and "stoi w miejscu" in m.paused_reason


async def test_finish_room_defers_and_updates_reason():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    before = len(hass.services.calls)
    await m.async_finish_room()
    assert not any(c[1] == "pause" for c in hass.services.calls[before:])
    assert not m.running
    send(m, st("cleaning", **CLEANING), st("docked", **TASK_DONE))
    await drain()
    assert m.queue[0]["status"] == "done"
    assert m.paused_reason == "pokój dokończony — kolejka wstrzymana"


async def test_area_cancel_on_home_press():
    """Domek na robocie: task 'completed' przy ulamku strefy = anulowano."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")  # 4 m² bbox
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING),
         st("returning", cleaned_area=1, **TASK_DONE))  # 25% strefy
    await drain()
    assert m.queue[0]["status"] == "pending" and not m.running
    assert "zatrzymano na robocie" in m.paused_reason
    assert len(zone_calls(hass)) == 1  # nie wysyla nastepnego


async def test_unreachable_room_skipped_queue_continues():
    """<5% strefy = zamkniete drzwi: pokoj pominiety, kolejka jedzie dalej."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING),
         st("returning", cleaned_area=0, **TASK_DONE))
    await drain()
    assert m.queue[0]["status"] == "skipped" and m.running
    assert m.history["Salon"][-1]["outcome"] == "skipped"
    assert any("zamknięte drzwi" in n for n in NOTIFICATIONS)
    await fire_timers(hass)  # delay-between-zones
    assert len(zone_calls(hass)) == 2  # Kuchnia poszla


async def test_foreign_task_pauses_queue():
    """Power na robocie = pelne sprzatanie domu, nie nasza strefa."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    hass.states[VAC] = st("cleaning", running=True, started=True,
                          zone_cleaning=False)
    hass.states["sensor.l10_task_status"] = st("cleaning")
    await m._async_reconcile()
    await drain()
    assert not m.running and m.queue[0]["status"] == "pending"
    assert "inne zadanie" in m.paused_reason


async def test_stall_warning_paused_in_dock_while_charging():
    """Pauza w doku + ladowanie tez musi ostrzegac (zombie z logu 24.07)."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    paused = st("paused", zone_cleaning=True, started=True, running=False,
                paused=True, charging=True)
    send(m, st("cleaning", **CLEANING), paused)
    item["interrupted_since"] = __import__("time").time() - 26 * 60
    hass.states[VAC] = paused
    await m._async_reconcile()
    assert item["stall_warned"]
    assert any("Wznów" in n for n in NOTIFICATIONS)


async def test_remove_active_while_robot_idle_pauses_queue():
    """Usuwanie pokoi przy stojacym robocie nie moze go budzic."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item_id = m.queue[0]["id"]
    hass.states[VAC] = st("paused", zone_cleaning=True, started=True,
                          running=False, paused=True, charging=True)
    await m.async_remove(item_id=item_id)
    assert not m.running and "usunięty" in m.paused_reason
    await fire_timers(hass)
    assert len(zone_calls(hass)) == 1  # zaden nowy pokoj nie poszedl


async def test_remove_active_while_cleaning_moves_on():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item_id = m.queue[0]["id"]
    hass.states[VAC] = st("cleaning", **CLEANING)
    await m.async_remove(item_id=item_id)
    assert m.running
    await fire_timers(hass)  # dispatch za 4 s
    assert len(zone_calls(hass)) == 2  # Kuchnia poszla


async def test_area_done_when_zone_mostly_cleaned():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    send(m, st("cleaning", **CLEANING),
         st("returning", cleaned_area=3, **TASK_DONE))  # 3 z 4 m²
    await drain()
    assert m.queue[0]["status"] == "done"


async def test_dispatch_blocked_while_room_active():
    """Wyscig skip/watchdog nie moze wyslac drugiego pokoju naraz."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    assert m.queue[0]["status"] == "active"
    await m._dispatch_next()  # zabladzony drugi dispatch (timer/watchdog)
    assert len(zone_calls(hass)) == 1
    assert m.queue[1]["status"] == "pending"


async def test_returning_does_not_clear_interrupted():
    """Powrot do bazy (running=True) nie jest 'wznowil sprzatanie'."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    item = m.queue[0]
    paused = dict(running=False, paused=True, zone_cleaning=True, started=True)
    send(m, st("cleaning", **CLEANING), st("paused", **paused))
    assert item["interrupted"]
    going_home = dict(running=True, returning=True, zone_cleaning=True,
                      started=True)
    send(m, st("paused", **paused), st("returning", **going_home))
    assert item["interrupted"]  # flaga zostaje az do rozstrzygniecia


async def test_pause_retry_when_command_lost():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("cleaning", **CLEANING)
    await m.async_start()
    await m.async_pause()
    # robot zignorowal pauze — wciaz sprzata przy weryfikacji po 10 s
    hass.states[VAC] = st("cleaning", **CLEANING)
    await fire_timers(hass)
    pauses = [c for c in hass.services.calls if c[1] == "pause"]
    assert len(pauses) == 2  # oryginal + ponowka


async def test_wash_wait_drying_dispatches_immediately():
    hass, m = mk({const.CONF_WAIT_WASH: True})
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    # pokoj z mopem konczy sie, gdy stacja juz suszy (mycie skonczone)
    send(m, st("cleaning", **CLEANING),
         st("docked", drying=True, **TASK_DONE))
    await drain()
    assert m.queue[0]["status"] == "done" and m._wait_wash is not None
    send(m, st("docked", drying=True, **TASK_DONE),
         st("docked", drying=True, charging=True, **TASK_DONE))
    await drain()
    await fire_timers(hass)  # delay-between-zones
    assert len(zone_calls(hass)) == 2  # Kuchnia bez 3-min timeoutu


async def test_history_records_done_run():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")  # zone 2000x2000 mm = 4 m²
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    m.queue[0]["started_at"] -= 300
    send(m, st("cleaning", **CLEANING),
         st("returning", cleaned_area=3, **TASK_DONE))
    await drain()
    runs = m.history["Salon"]
    assert len(runs) == 1
    r = runs[0]
    assert r["outcome"] == "done" and r["pct"] == 75
    assert 295 <= r["dur"] <= 310
    assert r["mode"] == "sweeping_and_mopping"  # standard + moist
    assert r["suction"] == "standard" and r["water"] == "moist"


async def test_history_records_cancel_skip_and_dock_returns():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    # przerwa serwisowa (mycie mopa) -> licznik powrotow do bazy
    send(m, st("cleaning", **CLEANING), st("returning", **WASH_MID))
    assert m.queue[0]["dock_returns"] == 1
    send(m, st("returning", **WASH_MID), st("cleaning", **CLEANING))
    # anulowanie na robocie (1 z 4 m² = 25%)
    send(m, st("cleaning", **CLEANING),
         st("returning", cleaned_area=1, **TASK_DONE))
    await drain()
    runs = m.history["Salon"]
    assert runs[-1]["outcome"] == "cancelled" and runs[-1]["returns"] == 1
    assert runs[-1]["pct"] == 25
    # skip aktywnego pokoju -> wpis "skipped"
    await m.async_start()
    await drain()
    active = m._active()
    assert active is not None
    await m.async_skip()
    room = active["room"]
    assert m.history[room][-1]["outcome"] == "skipped"


async def test_dispatch_service_missing_keeps_room_pending():
    """dreame_vacuum niezaladowane po restarcie: pauza, pokoj nietkniety."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    hass.services.available = False
    await m.async_start()
    assert not m.running
    assert "dreame_vacuum" in m.paused_reason
    assert [i["status"] for i in m.queue] == ["pending", "pending"]
    assert not zone_calls(hass)
    # integracja wrocila -> Kontynuuj rusza od TEGO SAMEGO pokoju
    hass.services.available = True
    await m.async_start()
    assert m.running and m.queue[0]["status"] == "active"
    assert len(zone_calls(hass)) == 1


async def test_dispatch_failure_reverts_room_to_pending():
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    orig = hass.services.async_call

    async def failing(domain, service, data, blocking=False):
        if service == "vacuum_clean_zone":
            raise RuntimeError("Action dreame_vacuum.vacuum_clean_zone not found")
        return await orig(domain, service, data, blocking)

    hass.services.async_call = failing
    await m.async_start()
    assert not m.running and "błąd wysyłki" in m.paused_reason
    assert [i["status"] for i in m.queue] == ["pending", "pending"]
    assert "Salon" not in m.history  # nieudana wysylka nie zapisuje przebiegu
    # usluga wraca -> ponawiamy ten sam pokoj
    hass.services.async_call = orig
    await m.async_start()
    assert m.queue[0]["status"] == "active" and m.queue[0]["room"] == "Salon"


async def _restart(m):
    """Symulacja restartu HA: zapis Store -> nowy manager na nowym hass."""
    await m._save()
    hass2 = FakeHass()
    m2 = QueueManager(m.hass, m.entry).__class__(hass2, m.entry)
    return hass2, m2


async def test_restart_reclaims_running_room():
    """Restart HA w trakcie: robot dalej mopuje -> kolejka przejmuje zadanie."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    await m.async_add("Kuchnia")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    hass2, m2 = await _restart(m)
    hass2.states[VAC] = st("cleaning", **CLEANING)
    await m2.async_setup()
    # aktywny pokoj ZOSTAJE aktywny, kolejka wstrzymana do potwierdzenia
    assert m2.queue[0]["status"] == "active" and not m2.running
    # robot raportuje trwajace zadanie strefowe -> RECLAIM
    send(m2, st("cleaning", **CLEANING), st("cleaning", **CLEANING))
    assert m2.running and m2.paused_reason is None
    # pokoj konczy sie normalnie -> done + nastepny z kolejki
    send(m2, st("cleaning", **CLEANING),
         st("returning", cleaned_area=3, **TASK_DONE))
    await drain()
    assert m2.queue[0]["status"] == "done"
    await fire_timers(hass2)
    assert len(zone_calls(hass2)) == 1  # Kuchnia wyslana po przejeciu


async def test_restart_with_no_robot_task_reverts_to_pending():
    """Restart HA, robot bez zadania -> pokoj do oczekujacych, bez redispatchu."""
    hass, m = mk()
    await m.async_setup()
    await m.async_add("Salon")
    hass.states[VAC] = st("docked", **TASK_DONE)
    await m.async_start()
    hass2, m2 = await _restart(m)
    hass2.states[VAC] = st("docked", **TASK_DONE)
    await m2.async_setup()
    assert m2.queue[0]["status"] == "active"  # do rozstrzygniecia
    await m2._async_reconcile()
    assert m2.queue[0]["status"] == "pending" and not m2.running
    assert not zone_calls(hass2)  # zero sprzatania w ciemno


SCENARIOS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]


async def main():
    for fn in SCENARIOS:
        NOTIFICATIONS.clear()
        await fn()
        print(f"OK  {fn.__name__}")
    print(f"\n{len(SCENARIOS)} scenarios passed")


if __name__ == "__main__":
    asyncio.run(main())
