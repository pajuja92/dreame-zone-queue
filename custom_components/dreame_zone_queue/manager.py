"""Queue manager & orchestrator for Dreame Zone Queue."""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    CANCEL_REVERT_WINDOW_S,
    CONF_DELAY_BETWEEN_S,
    CONF_FINISHED_STATES,
    CONF_GRACE_S,
    CONF_ROOMS,
    CONF_MODE_SELECT,
    CONF_SUCTION_SELECT,
    CONF_TASK_SENSOR,
    CONF_VACUUM_ENTITY,
    CONF_WAIT_WASH,
    CONF_WATER_SELECT,
    DEFAULT_DELAY_BETWEEN_S,
    DEFAULT_FINISHED_STATES,
    DEFAULT_GRACE_S,
    FEEDBACK_LOG,
    FEEDBACK_LOGGER,
    SIGNAL_QUEUE_UPDATED,
    ABANDON_S,
    STALL_WARN_S,
    STATUS_ACTIVE,
    STATUS_DONE,
    STATUS_ERROR,
    STATUS_PENDING,
    STATUS_SKIPPED,
    STORAGE_KEY,
    STORAGE_VERSION,
    SUCTION_TO_INT,
    WASH_WAIT_TIMEOUT_S,
    WATCHDOG_S,
    WATER_TO_INT,
)

_LOGGER = logging.getLogger(__name__)


class QueueManager:
    """Holds the queue, persists it and orchestrates zone-by-zone cleaning."""

    def __init__(self, hass: HomeAssistant, entry) -> None:
        self.hass = hass
        self.entry = entry
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.queue: list[dict[str, Any]] = []
        self.running: bool = False
        self._next_id: int = 1
        self._dispatched_at: float = 0.0
        self._revision: int = 0
        self.presets: dict[str, list] = {}
        self.stats: dict[str, dict] = {}
        self._unsub_state: Callable | None = None
        self._unsub_timer: Callable | None = None
        self._unsub_task_sensor: Callable | None = None
        self._unsub_bus: Callable | None = None
        self._unsub_watchdog: Callable | None = None
        # between-rooms mop-wash wait: {"since": monotonic, "seen": bool}
        self._wait_wash: dict | None = None
        # suppress cancel-detection for stops WE initiated
        self._expect_stop_until: float = 0.0
        # (item_id, monotonic) of the most recent "done" — cancel events
        # arriving right after may revert it (robot stopped by the user)
        self._last_done: tuple[int | None, float] = (None, 0.0)
        # dlaczego kolejka stoi — pokazywane na karcie przy stanie "paused"
        self.paused_reason: str | None = None
        # feedback mode: full state dumps + user notes into a dedicated log
        self.feedback: bool = False
        self._fb_logger = logging.getLogger(FEEDBACK_LOGGER)
        self._fb_handler: logging.Handler | None = None
        self._fb_mirror: logging.Handler | None = None

    # ------------------------------------------------------------------
    # options helpers
    # ------------------------------------------------------------------
    @property
    def _opts(self) -> dict:
        return {**self.entry.data, **self.entry.options}

    @property
    def vacuum_entity(self) -> str:
        return self._opts.get(CONF_VACUUM_ENTITY, "")

    @property
    def rooms(self) -> dict[str, dict]:
        return self._opts.get(CONF_ROOMS, {})

    @property
    def grace_s(self) -> int:
        return int(self._opts.get(CONF_GRACE_S, DEFAULT_GRACE_S))

    @property
    def delay_between_s(self) -> int:
        return int(self._opts.get(CONF_DELAY_BETWEEN_S, DEFAULT_DELAY_BETWEEN_S))

    @property
    def finished_states(self) -> list[str]:
        return self._opts.get(CONF_FINISHED_STATES, DEFAULT_FINISHED_STATES)

    @property
    def wait_wash(self) -> bool:
        return bool(self._opts.get(CONF_WAIT_WASH, False))

    @property
    def task_sensor_entity(self) -> str:
        ent = self._opts.get(CONF_TASK_SENSOR)
        if ent:
            return ent
        if "." not in self.vacuum_entity:
            return ""
        return f"sensor.{self.vacuum_entity.split('.', 1)[1]}_task_status"

    def _task_status_value(self) -> str | None:
        """Current value of the dreame task_status sensor, or None."""
        ent = self.task_sensor_entity
        st = self.hass.states.get(ent) if ent else None
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        return st.state.lower()

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    async def async_setup(self) -> None:
        data = await self._store.async_load() or {}
        self.queue = data.get("queue", [])
        self._next_id = data.get("next_id", 1)
        self.presets = data.get("presets", {})
        self.stats = data.get("stats", {})
        self.feedback = bool(data.get("feedback", False))
        if self.feedback:
            # RotatingFileHandler otwiera plik przy tworzeniu — poza petla
            await self.hass.async_add_executor_job(self._fb_attach)
        # After a restart the robot state is unknown -> never resume blindly.
        self.running = False
        if any(i["status"] in (STATUS_ACTIVE, STATUS_DONE, STATUS_SKIPPED)
               for i in self.queue):
            self.paused_reason = "restart Home Assistant"
        for item in self.queue:
            if item.get("status") == STATUS_ACTIVE:
                item["status"] = STATUS_PENDING
        if self.vacuum_entity:
            self._unsub_state = async_track_state_change_event(
                self.hass, [self.vacuum_entity], self._on_vacuum_state
            )
        if self.task_sensor_entity:
            self._unsub_task_sensor = async_track_state_change_event(
                self.hass, [self.task_sensor_entity], self._on_task_sensor
            )
        # cancel-vs-complete detection: dreame fires this with job.completed
        self._unsub_bus = self.hass.bus.async_listen(
            "dreame_vacuum_task_status", self._on_task_event
        )
        self._notify()

    async def async_unload(self) -> None:
        for attr in ("_unsub_state", "_unsub_timer", "_unsub_task_sensor",
                     "_unsub_bus", "_unsub_watchdog"):
            unsub = getattr(self, attr)
            if unsub:
                unsub()
                setattr(self, attr, None)
        self._fb_detach()
        await self._save()

    async def _save(self) -> None:
        await self._store.async_save(
            {
                "queue": self.queue,
                "next_id": self._next_id,
                "presets": self.presets,
                "stats": self.stats,
                "feedback": self.feedback,
            }
        )

    # ------------------------------------------------------------------
    # feedback / diagnostics log
    # ------------------------------------------------------------------
    def _fb_attach(self) -> None:
        """Route feedback entries to a dedicated rotating file in /config
        and mirror every DZQ_* warning from this module there too."""
        if self._fb_handler:
            return
        from logging.handlers import RotatingFileHandler
        path = self.hass.config.path(FEEDBACK_LOG)
        h = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=2,
                                encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        self._fb_logger.addHandler(h)
        self._fb_handler = h

        mgr = self

        class _Mirror(logging.Handler):
            def emit(self, record):
                if mgr.feedback and mgr._fb_handler:
                    mgr._fb_handler.emit(record)

        self._fb_mirror = _Mirror()
        _LOGGER.addHandler(self._fb_mirror)

    def _fb_detach(self) -> None:
        if self._fb_mirror:
            _LOGGER.removeHandler(self._fb_mirror)
            self._fb_mirror = None
        if self._fb_handler:
            self._fb_logger.removeHandler(self._fb_handler)
            self._fb_handler.close()
            self._fb_handler = None

    def _fb(self, msg: str) -> None:
        """Feedback entry: dedicated file + HA log (own logger name)."""
        if self.feedback:
            self._fb_logger.warning(msg)

    @staticmethod
    def _attrs_json(attrs: dict) -> str:
        skip = ("rooms", "maps", "schedule", "ap", "capabilities",
                "cleaning_sequence")
        return json.dumps({k: v for k, v in attrs.items() if k not in skip},
                          default=str, ensure_ascii=False)

    async def async_set_feedback(self, enabled: bool) -> None:
        enabled = bool(enabled)
        if enabled == self.feedback:
            return
        self.feedback = enabled
        if enabled:
            await self.hass.async_add_executor_job(self._fb_attach)
            self._fb("FEEDBACK ENABLED | version-aware full state logging on; "
                     f"file: {self.hass.config.path(FEEDBACK_LOG)}")
            st = self.hass.states.get(self.vacuum_entity)
            if st is not None:
                self._fb(f"SNAPSHOT | state={st.state} | "
                         f"attrs={self._attrs_json(dict(st.attributes))}")
        else:
            self._fb_logger.warning("FEEDBACK DISABLED")
            self._fb_detach()
        self._notify()

    async def async_note(self, text: str) -> None:
        """User note: what ACTUALLY happened — anchored in the feedback log."""
        st = self.hass.states.get(self.vacuum_entity)
        snap = self.snapshot
        queue_brief = [
            {"room": i["room"], "status": i["status"],
             "interrupted": i.get("interrupted", False)}
            for i in snap["items"]
        ]
        self._fb_logger.warning(
            "NOTE | %s | queue_state=%s running=%s | queue=%s | "
            "vacuum_state=%s | attrs=%s",
            text, snap["state"], self.running,
            json.dumps(queue_brief, ensure_ascii=False),
            st.state if st else None,
            self._attrs_json(dict(st.attributes)) if st else "{}",
        )

    @callback
    def _notify(self) -> None:
        self._revision += 1
        async_dispatcher_send(self.hass, SIGNAL_QUEUE_UPDATED)
        self.hass.async_create_task(self._save())

    def _find(self, item_id: int | None, position: int | None):
        if item_id is not None:
            return next((i for i in self.queue if i["id"] == int(item_id)), None)
        if position is not None:
            idx = int(position) - 1
            if 0 <= idx < len(self.queue):
                return self.queue[idx]
        return None

    def _active(self):
        return next((i for i in self.queue if i["status"] == STATUS_ACTIVE), None)


    # ------------------------------------------------------------------
    # select-entity helpers
    # ------------------------------------------------------------------
    _ALIASES = {
        "quiet": ("quiet", "silent"),
        "silent": ("silent", "quiet"),
    }

    def _resolve_option(self, entity_id: str, value: str) -> str:
        """Match our level name against the select's real options
        (case-insensitive, with known aliases like quiet<->silent)."""
        st = self.hass.states.get(entity_id)
        options = (st.attributes.get("options") if st else None) or []
        for cand in self._ALIASES.get(value, (value,)):
            for opt in options:
                if str(opt).lower() == cand.lower():
                    return opt
        return value

    def _derived_select(self, opt_key: str, suffix: str) -> str:
        ent = self._opts.get(opt_key)
        if ent:
            return ent
        return f"select.{self.vacuum_entity.split('.', 1)[1]}{suffix}"

    async def _push_level(self, opt_key: str, suffix: str, value: str) -> None:
        """Set a level on the robot right now (used for the active room)."""
        ent = self._derived_select(opt_key, suffix)
        try:
            await self.hass.services.async_call(
                "select", "select_option",
                {"entity_id": ent, "option": self._resolve_option(ent, value)},
                blocking=True,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Live level change via %s failed: %s", ent, err)

    # ------------------------------------------------------------------
    # public queue operations (services / buttons / card)
    # ------------------------------------------------------------------
    async def async_add(self, room: str, suction=None, water=None, repeats=None) -> None:
        _LOGGER.warning("DZQ_ACTION | ADD | room=%s suction=%s water=%s repeats=%s", room, suction, water, repeats)
        base = self.rooms.get(room)
        if base is None:
            _LOGGER.error("Unknown room '%s' — define it in the integration options", room)
            return
        self.queue.append(
            {
                "id": self._next_id,
                "room": room,
                "icon": base.get("icon", ""),
                "zone": base["zone"],
                "suction": suction or base.get("suction", "standard"),
                "water": water or base.get("water", "moist"),
                "repeats": int(repeats or base.get("repeats", 1)),
                "status": STATUS_PENDING,
            }
        )
        self._next_id += 1
        self._notify()

    async def async_remove(self, item_id=None, position=None) -> None:
        _LOGGER.warning("DZQ_ACTION | REMOVE | item_id=%s position=%s", item_id, position)
        item = self._find(item_id, position)
        if item is None:
            return
        if item["status"] == STATUS_ACTIVE:
            # removing the item being cleaned = stop that room, move on
            self.queue.remove(item)
            self._expect_stop_until = time.monotonic() + 15
            self._notify()
            _LOGGER.info("Active room '%s' removed — stopping it", item["room"])
            try:
                await self.hass.services.async_call(
                    "vacuum", "stop", {"entity_id": self.vacuum_entity}, blocking=True
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("vacuum.stop failed on active remove: %s", err)
            if self.running:
                self._schedule_dispatch(4)
            return
        self.queue.remove(item)
        self._notify()

    async def async_move(self, item_id=None, position=None, new_position=None) -> None:
        _LOGGER.warning("DZQ_ACTION | MOVE | item_id=%s position=%s new_position=%s", item_id, position, new_position)
        item = self._find(item_id, position)
        if item is None or item["status"] != STATUS_PENDING or new_position is None:
            return
        j = max(0, min(len(self.queue) - 1, int(new_position) - 1))
        if self.queue[j]["status"] != STATUS_PENDING:
            _LOGGER.warning("Target position is not a pending item — move rejected")
            return
        self.queue.remove(item)
        self.queue.insert(j, item)
        self._notify()

    async def async_set_params(self, item_id=None, position=None,
                               suction=None, water=None, repeats=None) -> None:
        _LOGGER.warning("DZQ_ACTION | SET_PARAMS | item_id=%s position=%s suction=%s water=%s repeats=%s", item_id, position, suction, water, repeats)
        item = self._find(item_id, position)
        if item is None:
            return
        if item["status"] == STATUS_ACTIVE:
            # live change while the room is being cleaned
            new_s = suction or item["suction"]
            new_w = water or item["water"]
            if new_s == "off" and new_w == "off":
                _LOGGER.warning("Suction and mop cannot both be off — change rejected")
                self._notify()
                return
            if suction:
                item["suction"] = suction
            if water:
                item["water"] = water
            # switch cleaning mode FIRST — robot ignores level changes
            # for components not active in the current mode (e.g. setting
            # suction while in mopping mode does nothing)
            if suction or water:
                mode = (
                    "sweeping" if item["water"] == "off"
                    else "mopping" if item["suction"] == "off"
                    else "sweeping_and_mopping"
                )
                opts = self._opts
                mode_select = opts.get(CONF_MODE_SELECT) or (
                    f"select.{self.vacuum_entity.split('.', 1)[1]}_cleaning_mode"
                )
                try:
                    await self.hass.services.async_call(
                        "select", "select_option",
                        {"entity_id": mode_select, "option": mode}, blocking=True,
                    )
                except Exception as err:  # noqa: BLE001
                    _LOGGER.warning("Live cleaning mode switch failed: %s", err)
            # THEN push levels for components that are not off
            if suction and suction != "off":
                await self._push_level(CONF_SUCTION_SELECT, "_suction_level", suction)
            if water and water != "off":
                await self._push_level(CONF_WATER_SELECT, "_mop_pad_humidity", water)
            self._notify()
            return
        if item["status"] != STATUS_PENDING:
            return
        new_s = suction or item["suction"]
        new_w = water or item["water"]
        if new_s == "off" and new_w == "off":
            _LOGGER.warning("Suction and mop cannot both be off — change rejected")
            self._notify()
            return
        if suction:
            item["suction"] = suction
        if water:
            item["water"] = water
        if repeats:
            item["repeats"] = int(repeats)
        self._notify()

    async def async_start(self) -> None:
        """Start a fresh queue OR resume a paused one."""
        _LOGGER.warning("DZQ_ACTION | START | running=%s queue_len=%s pending=%s", self.running, len(self.queue), sum(1 for i in self.queue if i['status'] == STATUS_PENDING))
        if self.running:
            return
        active = self._active()
        if active is not None:
            # kontynuacja: aktywny pokoj wciaz "w grze" — pogodz stan kolejki
            # z FAKTYCZNYM stanem robota zamiast slepo czekac na event
            self.running = True
            self.paused_reason = None
            self._wait_wash = None
            self._notify()
            self._schedule_watchdog()
            vac = self.hass.states.get(self.vacuum_entity)
            if vac is None:
                return
            a = vac.attributes
            b = self._to_bool
            if vac.state == "paused" or b(a.get("paused")) or b(a.get("cleaning_paused")):
                # robot stoi zapauzowany -> kuksaniec do wznowienia
                try:
                    await self.hass.services.async_call(
                        "vacuum", "start",
                        {"entity_id": self.vacuum_entity}, blocking=False,
                    )
                except Exception as err:  # noqa: BLE001
                    _LOGGER.warning("Resume nudge failed: %s", err)
            elif (not b(a.get("zone_cleaning")) and not b(a.get("started"))
                  and not self._task_running(vac)):
                # robot nie ma juz ZADNEGO zadania (anulowane / zgubione)
                # -> wyslij aktywny pokoj od nowa
                _LOGGER.warning(
                    "DZQ_DECISION | REDISPATCH_ON_RESUME | room=%s — robot has "
                    "no task, restarting the active room", active["room"],
                )
                active["status"] = STATUS_PENDING
                await self._dispatch_next()
            return
        if not any(i["status"] == STATUS_PENDING for i in self.queue):
            _LOGGER.info("Queue start requested but no pending items")
            return
        self.running = True
        self.paused_reason = None
        await self._dispatch_next()

    async def async_stop(self) -> None:
        """End the session: stop the robot, send it home, keep the list."""
        _LOGGER.warning("DZQ_ACTION | STOP")
        self.running = False
        self.paused_reason = "zakończona przyciskiem Stop"
        self._wait_wash = None
        self._expect_stop_until = time.monotonic() + 15
        active = self._active()
        if active is not None:
            active["status"] = STATUS_SKIPPED
        self._notify()
        try:
            await self.hass.services.async_call(
                "vacuum", "stop", {"entity_id": self.vacuum_entity}, blocking=True
            )
            await self.hass.services.async_call(
                "vacuum", "return_to_base",
                {"entity_id": self.vacuum_entity}, blocking=False,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Stop failed: %s", err)

    async def async_dock(self) -> None:
        """Send the robot home WITHOUT ending the session: the active room
        goes back to pending, the queue pauses and can be continued later."""
        _LOGGER.warning("DZQ_ACTION | DOCK")
        self.running = False
        self.paused_reason = "robot odesłany do bazy"
        self._wait_wash = None
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self._expect_stop_until = time.monotonic() + 15
        item = self._active()
        if item is not None:
            item["status"] = STATUS_PENDING
            for key in ("interrupted", "reason", "started_at", "seen_running",
                        "interrupted_since", "stall_warned", "redispatched"):
                item.pop(key, None)
        self._notify()
        try:
            await self.hass.services.async_call(
                "vacuum", "return_to_base",
                {"entity_id": self.vacuum_entity}, blocking=False,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("return_to_base failed: %s", err)

    async def async_pause(self) -> None:
        """Natychmiastowa pauza: robot staje w miejscu i czeka na decyzję
        (Kontynuuj / Do bazy). Zadanie strefy zostaje w pamięci robota."""
        _LOGGER.warning("DZQ_ACTION | PAUSE")
        self.running = False
        self.paused_reason = "wstrzymana — robot stoi w miejscu"
        self._wait_wash = None
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self._notify()
        try:
            await self.hass.services.async_call(
                "vacuum", "pause", {"entity_id": self.vacuum_entity},
                blocking=True,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("vacuum.pause failed: %s", err)

    async def async_finish_room(self) -> None:
        """Robot dokończy bieżący pokój; kolejka nie wyśle następnego."""
        _LOGGER.warning("DZQ_ACTION | FINISH_ROOM")
        self.running = False
        self.paused_reason = "dokończy bieżący pokój i się zatrzyma"
        self._wait_wash = None
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self._notify()

    async def async_skip(self) -> None:
        item = self._active()
        _LOGGER.warning("DZQ_ACTION | SKIP | active_room=%s", item.get('room') if item else None)
        if item is None:
            return
        item["status"] = STATUS_SKIPPED
        self._expect_stop_until = time.monotonic() + 15
        self._notify()
        try:
            await self.hass.services.async_call(
                "vacuum", "stop", {"entity_id": self.vacuum_entity}, blocking=True
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("vacuum.stop failed during skip: %s", err)
        if self.running:
            self._schedule_dispatch(4)

    async def async_clear(self) -> None:
        _LOGGER.warning("DZQ_ACTION | CLEAR | running=%s queue_len=%s", self.running, len(self.queue))
        # robot moze fizycznie sprzatac takze przy SPAUZOWANEJ kolejce
        # (konczy biezacy pokoj) — czyszczenie z aktywnym pokojem musi
        # go zatrzymac i odeslac, nie tylko przy running=True
        had_active = self._active() is not None
        was_running = self.running
        self.running = False
        self.paused_reason = None
        self._wait_wash = None
        self._expect_stop_until = time.monotonic() + 15
        self.queue.clear()
        self._notify()
        if was_running or had_active:
            try:
                await self.hass.services.async_call(
                    "vacuum", "stop", {"entity_id": self.vacuum_entity},
                    blocking=True,
                )
                await self.hass.services.async_call(
                    "vacuum", "return_to_base",
                    {"entity_id": self.vacuum_entity}, blocking=False,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("stop/return_to_base failed: %s", err)


    async def async_import_rooms(self, rooms: dict, mode: str = "merge") -> None:
        """Bulk-set room definitions (triggers a config entry reload)."""
        from .const import CONF_ROOMS
        current = dict(self.rooms) if mode == "merge" else {}
        current.update(rooms)
        self.hass.config_entries.async_update_entry(
            self.entry,
            options={**self.entry.options, CONF_ROOMS: current},
        )


    async def async_import_from_dreame(self, camera_entity: str | None = None,
                                        mode: str = "merge") -> int:
        """Copy room definitions from dreame-vacuum entity attributes."""
        from .rooms import rooms_from_dreame_attrs
        base = self.vacuum_entity.split(".", 1)[1] if self.vacuum_entity else ""
        candidates = [c for c in (
            camera_entity, f"camera.{base}_map" if base else None,
            self.vacuum_entity or None,
        ) if c]
        for ent in candidates:
            st = self.hass.states.get(ent)
            if st is None:
                continue
            rooms = rooms_from_dreame_attrs(st.attributes)
            if rooms:
                _LOGGER.info("Imported %d rooms from %s", len(rooms), ent)
                await self.async_import_rooms(rooms, mode)
                return len(rooms)
        _LOGGER.warning(
            "No rooms found in dreame entities (checked: %s)", candidates
        )
        return 0


    async def async_detect_rooms(self, mode: str = "merge",
                                 camera_entity: str | None = None) -> int:
        """Import rooms from the dreame integration's 'rooms' attribute."""
        from .rooms import rooms_from_attribute
        name = self.vacuum_entity.split(".", 1)[1] if "." in self.vacuum_entity else ""
        candidates = [camera_entity, f"camera.{name}_map", self.vacuum_entity]
        found: dict = {}
        for ent in candidates:
            if not ent:
                continue
            st = self.hass.states.get(ent)
            if st is None:
                continue
            found = rooms_from_attribute(st.attributes.get("rooms"))
            if found:
                _LOGGER.info("Detected %d rooms from %s", len(found), ent)
                break
        if not found:
            _LOGGER.warning("Room detection found nothing (checked: %s)",
                            [c for c in candidates if c])
            return 0
        await self.async_import_rooms(found, mode)
        return len(found)

    async def async_set_all(self, suction=None, water=None, repeats=None,
                            item_ids=None) -> None:
        """Bulk-apply parameters to pending items (all, or only item_ids)."""
        ids = {int(i) for i in item_ids} if item_ids else None
        for item in self.queue:
            if item["status"] != STATUS_PENDING:
                continue
            if ids is not None and item["id"] not in ids:
                continue
            new_s = suction or item["suction"]
            new_w = water or item["water"]
            if new_s == "off" and new_w == "off":
                _LOGGER.warning(
                    "set_all: '%s' skipped — suction and mop cannot both be off",
                    item["room"],
                )
                continue
            if suction:
                item["suction"] = suction
            if water:
                item["water"] = water
            if repeats:
                item["repeats"] = int(repeats)
        self._notify()

    # ------------------------------------------------------------------
    # presets
    # ------------------------------------------------------------------
    async def async_save_preset(self, name: str) -> None:
        name = (name or "").strip()
        if not name:
            _LOGGER.error("Preset name is required")
            return
        if not self.queue:
            _LOGGER.warning("Queue is empty — nothing to save as preset '%s'", name)
            return
        self.presets[name] = [
            {"room": i["room"], "suction": i["suction"],
             "water": i["water"], "repeats": i["repeats"]}
            for i in self.queue
        ]
        _LOGGER.info("Preset '%s' saved (%d rooms)", name, len(self.queue))
        self._notify()

    async def async_load_preset(self, name: str, mode: str = "replace") -> None:
        preset = self.presets.get(name)
        if preset is None:
            _LOGGER.error("Unknown preset '%s'", name)
            return
        if mode == "replace":
            self.queue = [i for i in self.queue if i["status"] == STATUS_ACTIVE]
        for it in preset:
            base = self.rooms.get(it["room"])
            if base is None:
                _LOGGER.warning(
                    "Preset '%s': room '%s' no longer defined — skipped",
                    name, it["room"],
                )
                continue
            self.queue.append(
                {
                    "id": self._next_id,
                    "room": it["room"],
                    "icon": base.get("icon", ""),
                    "zone": base["zone"],
                    "suction": it.get("suction", base.get("suction", "standard")),
                    "water": it.get("water", base.get("water", "moist")),
                    "repeats": int(it.get("repeats", base.get("repeats", 1))),
                    "status": STATUS_PENDING,
                }
            )
            self._next_id += 1
        self._notify()

    async def async_delete_preset(self, name: str) -> None:
        if self.presets.pop(name, None) is not None:
            self._notify()


    async def async_run(self, preset: str | None = None, rooms=None,
                        mode: str = "replace", start: bool = True) -> None:
        """One-shot for automations: fill the queue and (optionally) start it."""
        if mode == "replace" and (preset or rooms):
            self.queue = [i for i in self.queue if i["status"] == STATUS_ACTIVE]
            self._notify()
        if preset:
            await self.async_load_preset(preset, mode="append")
        for r in rooms or []:
            if isinstance(r, str):
                await self.async_add(r)
            elif isinstance(r, dict) and r.get("room"):
                await self.async_add(
                    r["room"], r.get("suction"), r.get("water"), r.get("repeats")
                )
            else:
                _LOGGER.warning("run: ignoring invalid rooms entry: %s", r)
        if start:
            await self.async_start()

    # ------------------------------------------------------------------
    # orchestration
    # ------------------------------------------------------------------
    def _schedule_dispatch(self, delay: int) -> None:
        if self._unsub_timer:
            self._unsub_timer()

        async def _fire(_now):
            self._unsub_timer = None
            await self._dispatch_next()

        self._unsub_timer = async_call_later(self.hass, delay, _fire)

    async def _dispatch_next(self) -> None:
        nxt = next((i for i in self.queue if i["status"] == STATUS_PENDING), None)
        _LOGGER.warning("DZQ_ACTION | DISPATCH_NEXT | next_room=%s pending=%s", nxt.get("room") if nxt else None, sum(1 for i in self.queue if i["status"] == STATUS_PENDING))
        if nxt is None:
            self.running = False
            self.paused_reason = None
            self._notify()
            _LOGGER.info("Queue finished — sending the robot back to the dock")
            try:
                await self.hass.services.async_call(
                    "vacuum", "return_to_base",
                    {"entity_id": self.vacuum_entity}, blocking=False,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("return_to_base after queue finish failed: %s", err)
            return

        nxt["status"] = STATUS_ACTIVE
        nxt["started_at"] = time.time()
        # reset per-run flags from any previous attempt
        # (NOT "redispatched" — it caps the watchdog's lost-command retry
        # and must survive the retry dispatch itself)
        for key in ("interrupted", "was_interrupted", "interrupted_since",
                    "reason", "seen_running", "stall_warned"):
            nxt.pop(key, None)
        self._dispatched_at = time.monotonic()
        self._wait_wash = None
        self._notify()
        self._schedule_watchdog()

        opts = self._opts
        suction_off = nxt["suction"] == "off"
        water_off = nxt["water"] == "off"
        if suction_off and water_off:
            _LOGGER.error("Room '%s': suction and mop both off — skipping", nxt["room"])
            nxt["status"] = STATUS_ERROR
            self.running = False
            self.paused_reason = "błąd: ssanie i mop wyłączone"
            self._notify()
            return
        data: dict[str, Any] = {
            "entity_id": self.vacuum_entity,
            "zone": [nxt["zone"]],
            "repeats": nxt["repeats"],
        }

        try:
            # cleaning mode: off na ssaniu -> mopping, off na mopie -> sweeping
            mode = (
                "sweeping" if water_off
                else "mopping" if suction_off
                else "sweeping_and_mopping"
            )
            mode_select = opts.get(CONF_MODE_SELECT) or (
                f"select.{self.vacuum_entity.split('.', 1)[1]}_cleaning_mode"
            )
            try:
                await self.hass.services.async_call(
                    "select", "select_option",
                    {"entity_id": mode_select, "option": mode}, blocking=True,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Could not set cleaning mode via %s: %s", mode_select, err)

            # levels go as integer service params (supported by dreame
            # master & dev) — no select round-trips at dispatch time
            if not suction_off:
                data["suction_level"] = SUCTION_TO_INT.get(nxt["suction"], 1)
            if not water_off:
                data["water_volume"] = WATER_TO_INT.get(nxt["water"], 2)

            _LOGGER.info("Dispatching zone for room '%s': %s", nxt["room"], data)
            await self.hass.services.async_call(
                "dreame_vacuum", "vacuum_clean_zone", data, blocking=True
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("Failed to start zone for '%s': %s", nxt["room"], err)
            nxt["status"] = STATUS_ERROR
            self.running = False
            self.paused_reason = "błąd wysyłki strefy do robota"
            self._notify()
            self._user_notify(
                f"Nie udało się wysłać strefy „{nxt['room']}”: {err}. "
                "Kolejka wstrzymana."
            )

    @staticmethod
    def _to_bool(v) -> bool:
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in ("true", "on", "1", "yes")

    def _task_interrupted(self, new_state) -> bool:
        """True, gdy robot przerwal pokoj i pojechal do bazy, ale zadanie
        NIE jest ukonczone (ladowanie z wznowieniem, mycie/suszenie mopa,
        recznie wstrzymane zadanie). Oparte na polach boolean integracji
        dreame — patrz atrybuty encji vacuum.

        Kluczowe: 'washing_available' / 'drying_available' to tylko
        informacja o mozliwosciach stacji, a NIE 'robi to teraz' —
        czytamy wylacznie flagi biezacego stanu.
        """
        a = new_state.attributes
        b = self._to_bool

        # Nadrzedny sygnal: jesli robot nie ma juz zadania strefowego,
        # pokoj jest SKONCZONY.  Mycie/ladowanie po skonczonym pokoju
        # to serwis post-clean, nie przerwanie mid-room.
        if not b(a.get("zone_cleaning")) and not b(a.get("started")):
            return False

        # 0) sensor task_status integracji dreame — autorytatywna faza
        #    zadania (zone_cleaning_paused / docking_paused / ...)
        ts = self._task_status_value()
        if ts and "paused" in ts:
            return True

        # 1) vacuum_state — wartosci wg realnego enuma dreame (StateOld
        #    dla L10 Prime); *_available to zdolnosci doku, nie stan
        vs = str(a.get("vacuum_state", "")).lower()
        if vs in (
            "returning_to_wash", "washing", "washing_paused", "drying",
            "charging", "smart_charging", "clean_add_water", "paused",
        ):
            return True

        # 2) faktycznie trwajace / wstrzymane czynnosci serwisowe
        if b(a.get("washing")) or b(a.get("washing_paused")):
            return True
        if b(a.get("drying")) or b(a.get("auto_emptying")):
            return True

        # 3) zadanie wstrzymane (recznie, w drodze do bazy, albo przez
        #    niski akumulator — cleaning_paused to dedykowana flaga)
        if b(a.get("paused")) or b(a.get("returning_paused")):
            return True
        if b(a.get("cleaning_paused")):
            return True

        # 4) powrot do bazy / ladowanie, ale z wlaczonym wznawianiem —
        #    robot sam dokonczy pokoj, wiec czekamy
        resume = b(a.get("resume_cleaning"))
        if resume and b(a.get("charging")):
            return True
        # L10 Prime reports returning=true AND running=true simultaneously
        # when going back to wash — don't require not-running
        if resume and b(a.get("returning")):
            return True

        return False

    def _task_running(self, state) -> bool:
        """Czy robot faktycznie sprzata (nie stoi, nie wstrzymany)."""
        a = state.attributes
        return self._to_bool(a.get("running")) and not self._to_bool(a.get("paused"))

    # ------------------------------------------------------------------
    # shared decision helpers
    # ------------------------------------------------------------------
    def _user_notify(self, message: str) -> None:
        """Persistent notification in HA (best effort)."""
        try:
            from homeassistant.components.persistent_notification import (
                async_create,
            )
            async_create(self.hass, message, title="Dreame Zone Queue",
                         notification_id="dreame_zone_queue")
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("persistent_notification failed: %s", err)

    @staticmethod
    def _interrupt_reason(attrs: dict) -> str:
        """Human-readable (PL) reason for an interruption, for the card."""
        b = QueueManager._to_bool
        if b(attrs.get("has_error")):
            return f"błąd: {attrs.get('error') or '?'}"
        if b(attrs.get("washing")) or b(attrs.get("washing_paused")):
            return "mycie mopa"
        if str(attrs.get("vacuum_state", "")).lower() == "returning_to_wash":
            return "jedzie myć mopa"
        if b(attrs.get("drying")):
            return "suszenie mopa"
        if b(attrs.get("cleaning_paused")) or b(attrs.get("charging")):
            return "ładowanie"
        if b(attrs.get("auto_emptying")):
            return "opróżnianie kurzu"
        if b(attrs.get("paused")) or b(attrs.get("returning_paused")):
            return "wstrzymany"
        return "przerwane"

    def _abandoned(self, item: dict) -> bool:
        """'Ukonczone' przychodzace, gdy pokoj wisi jako przerwany dluzej
        niz okno firmware (~30 min) = porzucenie zadania, nie sukces."""
        if not item.get("interrupted"):
            return False
        since = item.get("interrupted_since")
        return bool(since) and time.time() - since > ABANDON_S

    def _mark_interrupted(self, item: dict, reason: str,
                          notify_user: bool = False) -> None:
        item["interrupted"] = True
        item["was_interrupted"] = True
        item["interrupted_since"] = time.time()
        item["reason"] = reason
        _LOGGER.warning("DZQ_DECISION | INTERRUPTED | room=%s reason=%s",
                        item["room"], reason)
        if notify_user:
            self._user_notify(
                f"Pokój „{item['room']}”: {reason}. Kolejka czeka."
            )
        self._notify()

    def _finish_item(self, item: dict, why: str, state_str: str) -> None:
        """Mark the active item done and (if running) line up the next one."""
        started = item.get("started_at") or 0
        duration = time.time() - started if started else 0
        item["interrupted"] = False
        item.pop("reason", None)
        item["status"] = STATUS_DONE
        # przerwane przebiegi (ladowanie/mycie w srodku) psuja srednia — pomijamy
        if 30 < duration < 4 * 3600 and not item.get("was_interrupted"):
            per_pass = duration / max(1, item.get("repeats", 1))
            s = self.stats.setdefault(item["room"], {"avg_s": per_pass, "n": 0})
            n = min(s.get("n", 0), 9)
            s["avg_s"] = (s["avg_s"] * n + per_pass) / (n + 1)
            s["n"] = n + 1
        self._last_done = (item["id"], time.monotonic())
        _LOGGER.warning("DZQ_DECISION | %s | room=%s state=%s duration=%.0fs",
                        why, item["room"], state_str, duration)
        if not self.running and self.paused_reason and "dokończy" in self.paused_reason:
            self.paused_reason = "pokój dokończony — kolejka wstrzymana"
        self._notify()
        if not self.running:
            return
        if self.wait_wash and item.get("water") != "off":
            # nie wysylaj kolejnego pokoju, dopoki stacja nie umyje mopa
            self._wait_wash = {"since": time.monotonic(), "seen": False}
            _LOGGER.warning("DZQ_DECISION | WAIT_WASH | room=%s", item["room"])
            self._schedule_watchdog()
        else:
            self._schedule_dispatch(self.delay_between_s)

    async def _cancel_active(self, item: dict, reason: str) -> None:
        """User cancelled the task on the robot/app — pause, don't advance."""
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self.running = False
        self.paused_reason = reason
        self._wait_wash = None
        item["status"] = STATUS_PENDING
        for key in ("interrupted", "reason", "started_at", "seen_running",
                    "interrupted_since", "stall_warned", "redispatched"):
            item.pop(key, None)
        _LOGGER.warning("DZQ_DECISION | CANCELLED | room=%s reason=%s",
                        item["room"], reason)
        self._user_notify(
            f"Sprzątanie anulowane ({reason}) — kolejka wstrzymana na pokoju "
            f"„{item['room']}”. Naciśnij Kontynuuj, aby wznowić."
        )
        self._notify()

    # ------------------------------------------------------------------
    # wash-wait (between rooms)
    # ------------------------------------------------------------------
    def _advance_wash_wait(self, attrs: dict) -> None:
        """Progress the between-rooms mop-wash wait; dispatch when done."""
        if self._wait_wash is None:
            return
        b = self._to_bool
        vs = str(attrs.get("vacuum_state", "")).lower()
        busy = (b(attrs.get("washing")) or b(attrs.get("washing_paused"))
                or b(attrs.get("returning_to_wash"))
                or vs in ("returning_to_wash", "washing", "washing_paused",
                          "clean_add_water"))
        if busy:
            self._wait_wash["seen"] = True
            return
        timed_out = (time.monotonic() - self._wait_wash["since"]
                     > WASH_WAIT_TIMEOUT_S)
        if self._wait_wash["seen"] or timed_out:
            if timed_out and not self._wait_wash["seen"]:
                _LOGGER.warning(
                    "DZQ_DECISION | WASH_WAIT_TIMEOUT — dispatching anyway")
            self._wait_wash = None
            if self.running:
                self._schedule_dispatch(self.delay_between_s)

    # ------------------------------------------------------------------
    # watchdog / reconciliation (event-loss safety net)
    # ------------------------------------------------------------------
    def _schedule_watchdog(self) -> None:
        if self._unsub_watchdog:
            return

        async def _fire(_now):
            self._unsub_watchdog = None
            try:
                await self._async_reconcile()
            finally:
                if self.running or self._active() or self._wait_wash:
                    self._schedule_watchdog()

        self._unsub_watchdog = async_call_later(self.hass, WATCHDOG_S, _fire)

    async def _async_reconcile(self) -> None:
        """Level-based check of queue vs robot — recovers from lost events."""
        st = self.hass.states.get(self.vacuum_entity)
        if st is None:
            return
        a = st.attributes
        b = self._to_bool
        item = self._active()

        if item is None:
            self._advance_wash_wait(a)
            if (self.running and self._wait_wash is None
                    and self._unsub_timer is None
                    and any(i["status"] == STATUS_PENDING for i in self.queue)):
                _LOGGER.warning("DZQ_DECISION | WATCHDOG_DISPATCH — queue "
                                "running but nothing scheduled")
                await self._dispatch_next()
            return

        if time.monotonic() - self._dispatched_at < self.grace_s:
            return

        if self._task_running(st):
            item["seen_running"] = True
            if item.get("interrupted"):
                item["interrupted"] = False
                for key in ("reason", "interrupted_since", "stall_warned"):
                    item.pop(key, None)
                _LOGGER.warning("DZQ_DECISION | RESUMED (watchdog) | room=%s",
                                item["room"])
                self._notify()
            return

        if st.state == "error" or b(a.get("has_error")):
            if not item.get("interrupted"):
                self._mark_interrupted(item, self._interrupt_reason(a),
                                       notify_user=True)
            return

        if self._task_interrupted(st):
            if not item.get("interrupted"):
                self._mark_interrupted(item, self._interrupt_reason(a))
            else:
                # Ostrzezenie PRZED porzuceniem zadania przez firmware
                # (~30 min RECZNEJ pauzy). Ladowanie / mycie / suszenie to
                # legalne dlugie przerwy — firmware sam je wznowi, nie
                # odliczamy dla nich timeoutu.
                manual_pause = (
                    b(a.get("paused"))
                    and not b(a.get("charging"))
                    and not b(a.get("cleaning_paused"))
                    and not b(a.get("washing"))
                    and not b(a.get("washing_paused"))
                    and not b(a.get("drying"))
                )
                waited = time.time() - item.get("interrupted_since",
                                                time.time())
                if (manual_pause and waited > STALL_WARN_S
                        and not item.get("stall_warned")):
                    item["stall_warned"] = True
                    self._user_notify(
                        f"Robot stoi wstrzymany na pokoju „{item['room']}” "
                        f"od {int(waited // 60)} min. Wznów go w ciągu ok. "
                        "5 min — inaczej firmware porzuci zadanie i pokój "
                        "zacznie się od nowa."
                    )
                    self._notify()
            return

        # zadanie znikniete + robot odstawiony -> przegapiony koniec
        task_gone = not b(a.get("zone_cleaning")) and not b(a.get("started"))
        if task_gone and st.state in ("docked", "idle", "charging"):
            if not b(a.get("located", True)):
                await self._cancel_active(item, "robot zgubił pozycję")
                return
            if self._abandoned(item):
                await self._cancel_active(
                    item, "robot porzucił wstrzymane zadanie")
                return
            if item.get("seen_running"):
                self._finish_item(item, "DONE_WATCHDOG", st.state)
            elif item.get("redispatched"):
                item["status"] = STATUS_ERROR
                self.running = False
                self.paused_reason = "robot dwukrotnie nie podjął strefy"
                self._notify()
                self._user_notify(
                    f"Pokój „{item['room']}”: robot dwukrotnie nie podjął "
                    "strefy — kolejka wstrzymana."
                )
            else:
                # komenda przepadla zanim robot ruszyl — jedna ponowka
                _LOGGER.warning("DZQ_DECISION | REDISPATCH (watchdog) | "
                                "room=%s — robot never started", item["room"])
                item["status"] = STATUS_PENDING
                item["redispatched"] = True
                await self._dispatch_next()

    # ------------------------------------------------------------------
    # dreame event & task-sensor hooks
    # ------------------------------------------------------------------
    @callback
    def _on_task_sensor(self, event: Event) -> None:
        if self.feedback:
            o, n = event.data.get("old_state"), event.data.get("new_state")
            self._fb("TASK_SENSOR | %s→%s" % (
                o.state if o else None, n.state if n else None))
        if self.running or self._active() or self._wait_wash:
            self.hass.async_create_task(self._async_reconcile())

    @callback
    def _on_task_event(self, event: Event) -> None:
        """dreame_vacuum_task_status: job.completed=False == user cancel."""
        data = event.data or {}
        ent = data.get("entity_id")
        if ent and ent != self.vacuum_entity:
            return
        job = data.get("job") if isinstance(data.get("job"), dict) else data
        completed = job.get("completed")
        _LOGGER.warning("DZQ_EVENT | task_status | completed=%s", completed)
        if completed is not False:
            return
        now = time.monotonic()
        if now < self._expect_stop_until:
            return  # stop, ktory sami zlecilismy (skip/stop/clear/remove)
        if now - self._dispatched_at < self.grace_s:
            return  # spurious completed at task start (dreame #419)
        item = self._active()
        if item is not None:
            self.hass.async_create_task(
                self._cancel_active(item, "zatrzymano na robocie"))
            return
        # pokoj przed chwila oznaczony done, a to byl cancel -> cofnij
        last_id, last_ts = self._last_done
        if last_id is not None and now - last_ts < CANCEL_REVERT_WINDOW_S:
            it = next((i for i in self.queue
                       if i["id"] == last_id and i["status"] == STATUS_DONE),
                      None)
            if it is not None:
                self.hass.async_create_task(
                    self._cancel_active(it, "zatrzymano na robocie"))

    @callback
    def _on_vacuum_state(self, event: Event) -> None:
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if old is None or new is None:
            return

        # ── diagnostic dump — fires on EVERY state change ────────────
        # zwykly log: debug (bez spamu); tryb feedback: pelny zrzut atrybutow
        na = new.attributes
        item = self._active()
        diag = (
            "DZQ_DIAG | room=%s | %s→%s | vacuum_state=%s task_status=%s | "
            "zone_cleaning=%s started=%s running=%s paused=%s "
            "returning=%s returning_paused=%s charging=%s "
            "washing=%s washing_paused=%s drying=%s "
            "resume_cleaning=%s located=%s has_error=%s | "
            "queue_running=%s interrupted=%s wait_wash=%s active_item=%s"
        ) % (
            item.get("room") if item else "—",
            old.state, new.state,
            na.get("vacuum_state"), self._task_status_value(),
            na.get("zone_cleaning"), na.get("started"),
            na.get("running"), na.get("paused"),
            na.get("returning"), na.get("returning_paused"),
            na.get("charging"),
            na.get("washing"), na.get("washing_paused"),
            na.get("drying"),
            na.get("resume_cleaning"), na.get("located"), na.get("has_error"),
            self.running,
            item.get("interrupted") if item else "—",
            self._wait_wash is not None,
            item.get("room") if item else None,
        )
        _LOGGER.debug("%s", diag)
        if self.feedback:
            self._fb(f"{diag} | attrs={self._attrs_json(dict(na))}")
        # ── /diagnostic dump ─────────────────────────────────────────

        # UWAGA: przetwarzamy takze przy spauzowanej kolejce (running=False)
        # — pokoj konczony "w tle" musi zostac zapisany jako done, inaczej
        # wznowienie nie ma od czego ruszyc. Dispatch jest odpalany tylko
        # gdy self.running (guard w _finish_item / _advance_wash_wait).
        if item is None:
            self._advance_wash_wait(na)
            return
        if time.monotonic() - self._dispatched_at < self.grace_s:
            return

        if self._task_running(new):
            item["seen_running"] = True

        # Robot w bledzie (utkniecie, szczotka, kosz...) -> czekamy na
        # ratunek, pokazujemy powod, nie ruszamy kolejki.
        if new.state == "error" or self._to_bool(na.get("has_error")):
            if not item.get("interrupted"):
                self._mark_interrupted(item, self._interrupt_reason(na),
                                       notify_user=True)
            return

        # Robot znow sprzata po serwisowej przerwie -> zdejmij flage.
        if item.get("interrupted") and self._task_running(new):
            item["interrupted"] = False
            for key in ("reason", "interrupted_since", "stall_warned"):
                item.pop(key, None)
            _LOGGER.warning("DZQ_DECISION | RESUMED | room=%s — robot resumed cleaning, clearing interrupted", item["room"])
            self._notify()
            return

        # Robot zakonczyl serwis (mycie/ladowanie) i jest idle/docked
        # BEZ powrotu do cleaning — pokoj byl skonczony przed przerwa.
        # Bez tego pokoje z self_clean=true tkwia w interrupted na zawsze,
        # bo robot ZAWSZE jedzie myc mopa po kazdym pokoju.
        if item.get("interrupted") and not self._task_interrupted(new) and not self._task_running(new):
            if new.state in ("docked", "idle", "charging"):
                if self._abandoned(item):
                    self.hass.async_create_task(self._cancel_active(
                        item, "robot porzucił wstrzymane zadanie"))
                    return
                self._finish_item(item, "DONE_AFTER_SERVICE", new.state)
                return

        # Przejscie z aktywnego sprzatania w stan "przy bazie" LUB "paused".
        # Normalnie robot przechodzi cleaning → returning (w finished_states),
        # ale HA moze przeskoczyc event i dac cleaning → paused bezposrednio.
        was_cleaning = old.state == "cleaning" or self._to_bool(
            old.attributes.get("running")
        )
        entered_service = new.state in self.finished_states or new.state == "paused"
        if was_cleaning and entered_service:
            if self._task_interrupted(new):
                if not item.get("interrupted"):
                    self._mark_interrupted(item, self._interrupt_reason(na))
                return
            if not self._to_bool(na.get("located", True)):
                # relokacja nieudana — task porzucony przez firmware
                self.hass.async_create_task(
                    self._cancel_active(item, "robot zgubił pozycję"))
                return
            self._finish_item(item, "DONE", new.state)

    # ------------------------------------------------------------------
    # state exposed to the sensor / card
    # ------------------------------------------------------------------
    def _eta_seconds(self) -> int | None:
        avgs = [s["avg_s"] for s in self.stats.values() if s.get("avg_s")]
        global_avg = sum(avgs) / len(avgs) if avgs else None
        total = 0.0
        for item in self.queue:
            avg = self.stats.get(item["room"], {}).get("avg_s") or global_avg
            if avg is None:
                return None
            if item["status"] == STATUS_PENDING:
                total += avg * item.get("repeats", 1)
            elif item["status"] == STATUS_ACTIVE:
                elapsed = time.time() - (item.get("started_at") or time.time())
                total += max(avg * item.get("repeats", 1) - elapsed, 0)
        return int(total) if total > 0 else None

    @property
    def snapshot(self) -> dict[str, Any]:
        finished = sum(1 for i in self.queue
                       if i["status"] in ("done", "skipped"))
        has_pending = any(i["status"] == STATUS_PENDING for i in self.queue)
        started = any(i["status"] in (STATUS_ACTIVE, STATUS_DONE, STATUS_SKIPPED,
                                      STATUS_ERROR) for i in self.queue)
        if self.running:
            state = "running"
        elif self._active() is not None or (has_pending and started):
            state = "paused"
        else:
            state = "idle"
        avgs = [s["avg_s"] for s in self.stats.values() if s.get("avg_s")]
        global_avg = sum(avgs) / len(avgs) if avgs else None

        def _est(i: dict) -> int | None:
            avg = self.stats.get(i["room"], {}).get("avg_s") or global_avg
            if avg is None:
                return None
            planned = avg * i.get("repeats", 1)
            if i["status"] == STATUS_PENDING:
                return int(planned)
            if i["status"] == STATUS_ACTIVE:
                elapsed = time.time() - (i.get("started_at") or time.time())
                return int(max(planned - elapsed, 0))
            return None

        return {
            "state": state,
            "revision": self._revision,
            "progress": {"done": finished, "total": len(self.queue)},
            "eta_s": self._eta_seconds(),
            "presets": sorted(self.presets.keys()),
            "items": [{**i, "zone": list(i["zone"]), "est_s": _est(i)}
                      for i in self.queue],
            "rooms": sorted(self.rooms.keys()),
            "room_icons": {n: r.get("icon", "") for n, r in self.rooms.items()},
            "count_pending": sum(1 for i in self.queue if i["status"] == STATUS_PENDING),
            "vacuum_entity": self.vacuum_entity,
            "feedback": self.feedback,
            "paused_reason": self.paused_reason if state == "paused" else None,
        }
