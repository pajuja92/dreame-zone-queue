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
            {"queue": self.queue, "next_id": self._next_id}
        )

    @callback
    def _notify(self) -> None:
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
    # public queue operations (services / buttons / card)
    # ------------------------------------------------------------------
    async def async_add(self, room: str, suction=None, water=None, repeats=None) -> None:
        base = self.rooms.get(room)
        if base is None:
            _LOGGER.error("Unknown room '%s' — define it in the integration options", room)
            return
        self.queue.append(
            {
                "id": self._next_id,
                "room": room,
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
        item = self._find(item_id, position)
        if item and item["status"] in (STATUS_PENDING, STATUS_DONE, STATUS_SKIPPED, STATUS_ERROR):
            self.queue.remove(item)
            self._notify()

    async def async_move(self, item_id=None, position=None, new_position=None) -> None:
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
        item = self._find(item_id, position)
        if item is None or item["status"] != STATUS_PENDING:
            return
        if suction:
            item["suction"] = suction
        if water:
            item["water"] = water
        if repeats:
            item["repeats"] = int(repeats)
        self._notify()

    async def async_start(self) -> None:
        if self.running:
            return
        if not any(i["status"] == STATUS_PENDING for i in self.queue):
            _LOGGER.info("Queue start requested but no pending items")
            return
        self.running = True
        await self._dispatch_next()

    async def async_pause(self) -> None:
        self.running = False
        self._notify()

    async def async_skip(self) -> None:
        item = self._active()
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
        if nxt is None:
            self.running = False
            self._notify()
            _LOGGER.info("Queue finished")
            return

        nxt["status"] = STATUS_ACTIVE
        self._dispatched_at = time.monotonic()
        self._notify()

        opts = self._opts
        use_selects = opts.get(CONF_USE_SELECTS, False)
        data: dict[str, Any] = {
            "entity_id": self.vacuum_entity,
            "zone": [nxt["zone"]],
            "repeats": nxt["repeats"],
        }

        try:
            if use_selects:
                # Set suction / mop humidity through select entities first
                for select_key, value in (
                    (CONF_SUCTION_SELECT, nxt["suction"]),
                    (CONF_WATER_SELECT, nxt["water"]),
                ):
                    ent = opts.get(select_key)
                    if ent:
                        await self.hass.services.async_call(
                            "select", "select_option",
                            {"entity_id": ent, "option": value}, blocking=True,
                        )
            else:
                data["suction_level"] = nxt["suction"]
                water_param = opts.get(CONF_WATER_PARAM, DEFAULT_WATER_PARAM)
                if water_param:
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

    @callback
    def _on_vacuum_state(self, event: Event) -> None:
        if not self.running:
            return
        item = self._active()
        if item is None:
            return
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if old is None or new is None:
            return
        if time.monotonic() - self._dispatched_at < self.grace_s:
            return
        if old.state == "cleaning" and new.state in self.finished_states:
            item["status"] = STATUS_DONE
            _LOGGER.info("Room '%s' finished (state: %s)", item["room"], new.state)
            self._notify()
            self._schedule_dispatch(self.delay_between_s)

    # ------------------------------------------------------------------
    # state exposed to the sensor / card
    # ------------------------------------------------------------------
    @property
    def snapshot(self) -> dict[str, Any]:
        return {
            "state": "running" if self.running else "idle",
            "items": list(self.queue),
            "rooms": sorted(self.rooms.keys()),
            "count_pending": sum(1 for i in self.queue if i["status"] == STATUS_PENDING),
            "vacuum_entity": self.vacuum_entity,
        }
