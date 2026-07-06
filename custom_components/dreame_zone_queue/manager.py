"""Queue manager & orchestrator for Dreame Zone Queue."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    CONF_DELAY_BETWEEN_S,
    CONF_FINISHED_STATES,
    CONF_GRACE_S,
    CONF_ROOMS,
    CONF_MODE_SELECT,
    CONF_SUCTION_SELECT,
    CONF_USE_SELECTS,
    CONF_VACUUM_ENTITY,
    CONF_WATER_PARAM,
    CONF_WATER_SELECT,
    DEFAULT_DELAY_BETWEEN_S,
    DEFAULT_FINISHED_STATES,
    DEFAULT_GRACE_S,
    DEFAULT_WATER_PARAM,
    SIGNAL_QUEUE_UPDATED,
    STATUS_ACTIVE,
    STATUS_DONE,
    STATUS_ERROR,
    STATUS_PENDING,
    STATUS_SKIPPED,
    STORAGE_KEY,
    STORAGE_VERSION,
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

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    async def async_setup(self) -> None:
        data = await self._store.async_load() or {}
        self.queue = data.get("queue", [])
        self._next_id = data.get("next_id", 1)
        self.presets = data.get("presets", {})
        self.stats = data.get("stats", {})
        # After a restart the robot state is unknown -> never resume blindly.
        self.running = False
        for item in self.queue:
            if item.get("status") == STATUS_ACTIVE:
                item["status"] = STATUS_PENDING
        if self.vacuum_entity:
            self._unsub_state = async_track_state_change_event(
                self.hass, [self.vacuum_entity], self._on_vacuum_state
            )
        self._notify()

    async def async_unload(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        await self._save()

    async def _save(self) -> None:
        await self._store.async_save(
            {
                "queue": self.queue,
                "next_id": self._next_id,
                "presets": self.presets,
                "stats": self.stats,
            }
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
            # kontynuacja: aktywny pokoj wciaz "w grze" — czekamy na robota,
            # a jesli robot stoi zapauzowany, dajemy mu kuksanca do wznowienia
            self.running = True
            self._notify()
            vac = self.hass.states.get(self.vacuum_entity)
            if vac is not None and vac.state == "paused":
                try:
                    await self.hass.services.async_call(
                        "vacuum", "start",
                        {"entity_id": self.vacuum_entity}, blocking=False,
                    )
                except Exception as err:  # noqa: BLE001
                    _LOGGER.warning("Resume nudge failed: %s", err)
            return
        if not any(i["status"] == STATUS_PENDING for i in self.queue):
            _LOGGER.info("Queue start requested but no pending items")
            return
        self.running = True
        await self._dispatch_next()

    async def async_stop(self) -> None:
        """End the session: stop the robot, send it home, keep the list."""
        _LOGGER.warning("DZQ_ACTION | STOP")
        self.running = False
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

    async def async_pause(self) -> None:
        _LOGGER.warning("DZQ_ACTION | PAUSE")
        self.running = False
        self._notify()

    async def async_skip(self) -> None:
        item = self._active()
        _LOGGER.warning("DZQ_ACTION | SKIP | active_room=%s", item.get('room') if item else None)
        if item is None:
            return
        item["status"] = STATUS_SKIPPED
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
        was_running = self.running
        self.running = False
        self.queue.clear()
        self._notify()
        if was_running:
            try:
                await self.hass.services.async_call(
                    "vacuum", "return_to_base",
                    {"entity_id": self.vacuum_entity}, blocking=False,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("return_to_base failed: %s", err)


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
        self._dispatched_at = time.monotonic()
        self._notify()

        opts = self._opts
        use_selects = opts.get(CONF_USE_SELECTS, False)
        suction_off = nxt["suction"] == "off"
        water_off = nxt["water"] == "off"
        if suction_off and water_off:
            _LOGGER.error("Room '%s': suction and mop both off — skipping", nxt["room"])
            nxt["status"] = STATUS_ERROR
            self.running = False
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

            if use_selects:
                for select_key, suffix, value in (
                    (CONF_SUCTION_SELECT, "_suction_level", nxt["suction"]),
                    (CONF_WATER_SELECT, "_mop_pad_humidity", nxt["water"]),
                ):
                    if value == "off":
                        continue
                    ent = self._derived_select(select_key, suffix)
                    await self.hass.services.async_call(
                        "select", "select_option",
                        {"entity_id": ent,
                         "option": self._resolve_option(ent, value)},
                        blocking=True,
                    )
            else:
                if not suction_off:
                    data["suction_level"] = nxt["suction"]
                water_param = opts.get(CONF_WATER_PARAM, DEFAULT_WATER_PARAM)
                if water_param and not water_off:
                    data[water_param] = nxt["water"]

            _LOGGER.info("Dispatching zone for room '%s': %s", nxt["room"], data)
            await self.hass.services.async_call(
                "dreame_vacuum", "vacuum_clean_zone", data, blocking=True
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("Failed to start zone for '%s': %s", nxt["room"], err)
            nxt["status"] = STATUS_ERROR
            self.running = False
            self._notify()

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

        # 0) vacuum_state mowi wprost co robot robi — najsilniejszy sygnal
        vs = str(a.get("vacuum_state", "")).lower()
        if vs in (
            "returning_to_wash", "returning_to_charge",
            "washing", "washing_paused", "drying",
            "charging", "charging_paused",
        ):
            return True
        if "returning" in vs and ("wash" in vs or "charge" in vs):
            return True

        # 1) faktycznie trwajace / wstrzymane czynnosci serwisowe
        if b(a.get("washing")) or b(a.get("washing_paused")):
            return True
        if b(a.get("drying")):
            return True

        # 2) zadanie wstrzymane (recznie lub w drodze do bazy)
        if b(a.get("paused")) or b(a.get("returning_paused")):
            return True

        # 3) powrot do bazy / ladowanie, ale z wlaczonym wznawianiem —
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

    @callback
    def _on_vacuum_state(self, event: Event) -> None:
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if old is None or new is None:
            return

        # ── diagnostic dump — fires on EVERY state change ────────────
        na = new.attributes
        item = self._active()
        _LOGGER.warning(
            "DZQ_DIAG | room=%s | %s→%s | vacuum_state=%s | "
            "zone_cleaning=%s started=%s running=%s paused=%s "
            "returning=%s returning_paused=%s charging=%s "
            "washing=%s washing_paused=%s drying=%s "
            "resume_cleaning=%s | "
            "cleaned_area=%s cleaning_time=%s current_segment=%s | "
            "queue_running=%s interrupted=%s active_item=%s",
            item.get("room") if item else "—",
            old.state, new.state,
            na.get("vacuum_state"),
            na.get("zone_cleaning"), na.get("started"),
            na.get("running"), na.get("paused"),
            na.get("returning"), na.get("returning_paused"),
            na.get("charging"),
            na.get("washing"), na.get("washing_paused"),
            na.get("drying"),
            na.get("resume_cleaning"),
            na.get("cleaned_area"), na.get("cleaning_time"),
            na.get("current_segment"),
            self.running,
            item.get("interrupted") if item else "—",
            item.get("room") if item else None,
        )
        # ── /diagnostic dump ─────────────────────────────────────────

        if not self.running:
            return
        if item is None:
            return
        if time.monotonic() - self._dispatched_at < self.grace_s:
            return
        # Robot znow sprzata po serwisowej przerwie -> zdejmij flage.
        if item.get("interrupted") and self._task_running(new):
            item["interrupted"] = False
            _LOGGER.warning("DZQ_DECISION | RESUMED | room=%s — robot resumed cleaning, clearing interrupted", item["room"])
            self._notify()
            return

        # Robot zakonczyl serwis (mycie/ladowanie) i jest idle/docked
        # BEZ powrotu do cleaning — pokoj byl skonczony przed przerwa.
        # Bez tego pokoje z self_clean=true tkwia w interrupted na zawsze,
        # bo robot ZAWSZE jedzie myc mopa po kazdym pokoju.
        if item.get("interrupted") and not self._task_interrupted(new) and not self._task_running(new):
            if new.state in ("docked", "idle", "charging"):
                item["interrupted"] = False
                item["status"] = STATUS_DONE
                started = item.get("started_at") or 0
                duration = time.time() - started if started else 0
                _LOGGER.warning(
                    "DZQ_DECISION | DONE_AFTER_SERVICE | room=%s state=%s duration=%.0fs",
                    item["room"], new.state, duration,
                )
                self._notify()
                self._schedule_dispatch(self.delay_between_s)
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
                    item["interrupted"] = True
                    _LOGGER.warning(
                        "DZQ_DECISION | INTERRUPTED | room=%s | vacuum_state=%s "
                        "charging=%s washing=%s paused=%s returning_paused=%s "
                        "resume_cleaning=%s",
                        item["room"],
                        new.attributes.get("vacuum_state"),
                        new.attributes.get("charging"),
                        new.attributes.get("washing"),
                        new.attributes.get("paused"),
                        new.attributes.get("returning_paused"),
                        new.attributes.get("resume_cleaning"),
                    )
                    self._notify()
                return
            item["status"] = STATUS_DONE
            started = item.get("started_at") or 0
            duration = time.time() - started if started else 0
            if 30 < duration < 4 * 3600 and not item.get("interrupted"):
                per_pass = duration / max(1, item.get("repeats", 1))
                s = self.stats.setdefault(item["room"], {"avg_s": per_pass, "n": 0})
                n = min(s.get("n", 0), 9)
                s["avg_s"] = (s["avg_s"] * n + per_pass) / (n + 1)
                s["n"] = n + 1
            _LOGGER.warning("DZQ_DECISION | DONE | room=%s state=%s duration=%.0fs", item["room"], new.state, duration)
            self._notify()
            self._schedule_dispatch(self.delay_between_s)

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
        elif has_pending and started:
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
        }
