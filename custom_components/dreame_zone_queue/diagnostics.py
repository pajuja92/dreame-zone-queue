"""Diagnostyka (Ustawienia → Urządzenia i usługi → ⋮ → Pobierz diagnostykę)."""
from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from .const import CONF_NOTIFY_SERVICE, VERSION

TO_REDACT = {CONF_NOTIFY_SERVICE}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry) -> dict[str, Any]:
    m = entry.runtime_data
    vac = hass.states.get(m.vacuum_entity)
    return {
        "version": VERSION,
        "data": dict(entry.data),
        "options": async_redact_data(dict(entry.options), TO_REDACT),
        "state": m.snapshot["state"],
        "running": m.running,
        "paused_reason": m.paused_reason,
        "queue": m.queue,
        "map_calib": m.map_calib,
        "stats": m.stats,
        "incidents": m.incidents[-50:],
        "sessions": m.sessions[-5:],
        "vacuum": {"state": vac.state, "attributes": dict(vac.attributes)} if vac else None,
    }
