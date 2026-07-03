"""Control buttons for Dreame Zone Queue."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .manager import QueueManager

BUTTONS = (
    ("start", "Start queue", "mdi:play", "async_start"),
    ("pause", "Pause queue", "mdi:pause", "async_pause"),
    ("skip", "Skip current room", "mdi:skip-next", "async_skip"),
    ("clear", "Clear queue", "mdi:playlist-remove", "async_clear"),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    manager: QueueManager = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        QueueButton(manager, entry, key, name, icon, method)
        for key, name, icon, method in BUTTONS
    )


class QueueButton(ButtonEntity):
    _attr_has_entity_name = True

    def __init__(self, manager, entry, key, name, icon, method) -> None:
        self._manager = manager
        self._method = method
        self._attr_name = name
        self._attr_icon = icon
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "Dreame Zone Queue",
            "manufacturer": "dreame-zone-queue",
        }

    async def async_press(self) -> None:
        await getattr(self._manager, self._method)()
