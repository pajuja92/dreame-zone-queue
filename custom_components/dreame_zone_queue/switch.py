"""Feedback-mode switch for Dreame Zone Queue."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
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
    async_add_entities([FeedbackSwitch(manager, entry)])


class FeedbackSwitch(SwitchEntity):
    """Enables full-state feedback logging + the note button on the card."""

    _attr_has_entity_name = True
    _attr_name = "Feedback log"
    _attr_icon = "mdi:bug-check"

    def __init__(self, manager: QueueManager, entry: ConfigEntry) -> None:
        self._manager = manager
        self._attr_unique_id = f"{entry.entry_id}_feedback"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "Dreame Zone Queue",
            "manufacturer": "dreame-zone-queue",
        }

    async def async_added_to_hass(self) -> None:
        @callback
        def _updated() -> None:
            self.async_write_ha_state()

        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_QUEUE_UPDATED, _updated)
        )

    @property
    def is_on(self) -> bool:
        return self._manager.feedback

    async def async_turn_on(self, **kwargs) -> None:
        await self._manager.async_set_feedback(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._manager.async_set_feedback(False)
