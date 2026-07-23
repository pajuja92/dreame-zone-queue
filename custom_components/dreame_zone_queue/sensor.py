"""Queue sensor for Dreame Zone Queue."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_QUEUE_UPDATED
from .manager import QueueManager


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    manager: QueueManager = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([QueueSensor(manager, entry)])


class QueueSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = "mdi:playlist-play"
    _attr_should_poll = False

    def __init__(self, manager: QueueManager, entry: ConfigEntry) -> None:
        self._manager = manager
        self._attr_unique_id = f"{entry.entry_id}_queue"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "Dreame Zone Queue",
            "manufacturer": "dreame-zone-queue",
        }
        # Stable entity_id regardless of device naming
        self.entity_id = "sensor.vacuum_zone_queue"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_QUEUE_UPDATED, self._handle_update
            )
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> str:
        return self._manager.snapshot["state"]

    @property
    def extra_state_attributes(self) -> dict:
        snap = self._manager.snapshot
        return {
            "revision": snap["revision"],
            "items": snap["items"],
            "rooms": snap["rooms"],
            "room_icons": snap["room_icons"],
            "progress": snap["progress"],
            "eta_s": snap["eta_s"],
            "presets": snap["presets"],
            "count_pending": snap["count_pending"],
            "vacuum_entity": snap["vacuum_entity"],
            "feedback": snap["feedback"],
            "paused_reason": snap["paused_reason"],
        }
