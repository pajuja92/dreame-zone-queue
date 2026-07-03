"""Dreame Zone Queue — queue-based zone cleaning for dreame-vacuum."""
from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_ITEM_ID,
    ATTR_NEW_POSITION,
    ATTR_POSITION,
    ATTR_REPEATS,
    ATTR_ROOM,
    ATTR_SUCTION,
    ATTR_WATER,
    CARD_FILENAME,
    DOMAIN,
    SERVICE_ADD,
    SERVICE_CLEAR,
    SERVICE_MOVE,
    SERVICE_PAUSE,
    SERVICE_REMOVE,
    SERVICE_SET_PARAMS,
    SERVICE_SKIP,
    SERVICE_START,
    SUCTION_LEVELS,
    URL_BASE,
    VERSION,
    WATER_LEVELS,
)
from .manager import QueueManager

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor", "button"]

SCHEMA_ADD = vol.Schema(
    {
        vol.Required(ATTR_ROOM): cv.string,
        vol.Optional(ATTR_SUCTION): vol.In(SUCTION_LEVELS),
        vol.Optional(ATTR_WATER): vol.In(WATER_LEVELS),
        vol.Optional(ATTR_REPEATS): vol.Coerce(int),
    }
)
SCHEMA_ITEM = vol.Schema(
    {
        vol.Optional(ATTR_ITEM_ID): vol.Coerce(int),
        vol.Optional(ATTR_POSITION): vol.Coerce(int),
    }
)
SCHEMA_MOVE = SCHEMA_ITEM.extend({vol.Required(ATTR_NEW_POSITION): vol.Coerce(int)})
SCHEMA_SET = SCHEMA_ITEM.extend(
    {
        vol.Optional(ATTR_SUCTION): vol.In(SUCTION_LEVELS),
        vol.Optional(ATTR_WATER): vol.In(WATER_LEVELS),
        vol.Optional(ATTR_REPEATS): vol.Coerce(int),
    }
)


def _get_manager(hass: HomeAssistant) -> QueueManager | None:
    for data in hass.data.get(DOMAIN, {}).values():
        if isinstance(data, QueueManager):
            return data
    return None


async def _register_frontend(hass: HomeAssistant) -> None:
    """Serve the bundled Lovelace card and try to auto-add it as a resource."""
    if hass.data.setdefault(DOMAIN, {}).get("_frontend_registered"):
        return
    card_dir = Path(__file__).parent / "frontend"
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(card_dir), cache_headers=False)]
        )
    except ImportError:
        hass.http.register_static_path(URL_BASE, str(card_dir), cache_headers=False)
    hass.data[DOMAIN]["_frontend_registered"] = True

    url = f"{URL_BASE}/{CARD_FILENAME}?v={VERSION}"
    try:
        lovelace = hass.data.get("lovelace")
        resources = getattr(lovelace, "resources", None)
        if resources is None and isinstance(lovelace, dict):
            resources = lovelace.get("resources")
        if resources is None:
            raise RuntimeError("lovelace resources unavailable")
        if not resources.loaded:
            await resources.async_load()
        for item in resources.async_items():
            if item.get("url", "").startswith(f"{URL_BASE}/{CARD_FILENAME}"):
                if item["url"] != url and hasattr(resources, "async_update_item"):
                    await resources.async_update_item(item["id"], {"url": url})
                return
        if hasattr(resources, "async_create_item"):
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.info("Registered Lovelace resource %s", url)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning(
            "Could not auto-register the Lovelace card resource (%s). "
            "Add it manually: Settings > Dashboards > Resources > %s (module)",
            err, url,
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    manager = QueueManager(hass, entry)
    await manager.async_setup()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager

    await _register_frontend(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_update_listener))

    if not hass.data[DOMAIN].get("_services_registered"):
        _register_services(hass)
        hass.data[DOMAIN]["_services_registered"] = True
    return True


async def _update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        manager: QueueManager = hass.data[DOMAIN].pop(entry.entry_id)
        await manager.async_unload()
    return unload_ok


def _register_services(hass: HomeAssistant) -> None:
    def wrap(coro_name):
        async def handler(call: ServiceCall) -> None:
            manager = _get_manager(hass)
            if manager is None:
                _LOGGER.error("No configured Dreame Zone Queue instance")
                return
            await getattr(manager, coro_name)(**call.data)

        return handler

    hass.services.async_register(DOMAIN, SERVICE_ADD, wrap("async_add"), SCHEMA_ADD)
    hass.services.async_register(DOMAIN, SERVICE_REMOVE, wrap("async_remove"), SCHEMA_ITEM)
    hass.services.async_register(DOMAIN, SERVICE_MOVE, wrap("async_move"), SCHEMA_MOVE)
    hass.services.async_register(DOMAIN, SERVICE_SET_PARAMS, wrap("async_set_params"), SCHEMA_SET)
    hass.services.async_register(DOMAIN, SERVICE_START, wrap("async_start"))
    hass.services.async_register(DOMAIN, SERVICE_PAUSE, wrap("async_pause"))
    hass.services.async_register(DOMAIN, SERVICE_SKIP, wrap("async_skip"))
    hass.services.async_register(DOMAIN, SERVICE_CLEAR, wrap("async_clear"))
