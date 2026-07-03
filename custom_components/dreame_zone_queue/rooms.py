"""Bulk room definition helpers (YAML import/export & validation)."""
from __future__ import annotations

from typing import Any

import yaml

from .const import SUCTION_LEVELS, WATER_LEVELS

EXAMPLE_YAML = """\
# Przyklad / example:
# Salon:
#   zone: [-1200, -3000, 3600, 1500]   # [x1, y1, x2, y2] w mm
#   suction: standard                  # quiet|standard|strong|turbo
#   water: moist                       # slightly_dry|moist|wet
#   repeats: 1
#   icon: "\U0001F6CB"                       # opcjonalne emoji
"""

DEFAULTS = {"suction": "standard", "water": "moist", "repeats": 1, "icon": ""}


def rooms_to_yaml(rooms: dict[str, dict]) -> str:
    if not rooms:
        return EXAMPLE_YAML
    return yaml.safe_dump(
        rooms, allow_unicode=True, sort_keys=True, default_flow_style=None
    )


def validate_rooms(data: Any) -> tuple[dict[str, dict], str | None]:
    """Return (normalized_rooms, error_message). Error message is None if OK."""
    if data is None:
        return {}, None
    if not isinstance(data, dict):
        return {}, "Root must be a mapping: room name -> definition"
    out: dict[str, dict] = {}
    for name, room in data.items():
        name = str(name).strip()
        if not name:
            return {}, "Empty room name"
        if not isinstance(room, dict):
            return {}, f"'{name}': definition must be a mapping"
        zone = room.get("zone")
        if (
            not isinstance(zone, (list, tuple))
            or len(zone) != 4
            or not all(isinstance(v, (int, float)) for v in zone)
        ):
            return {}, f"'{name}': zone must be a list of 4 numbers [x1, y1, x2, y2]"
        suction = room.get("suction", DEFAULTS["suction"])
        if suction not in SUCTION_LEVELS:
            return {}, f"'{name}': suction must be one of {SUCTION_LEVELS}"
        water = room.get("water", DEFAULTS["water"])
        if water not in WATER_LEVELS:
            return {}, f"'{name}': water must be one of {WATER_LEVELS}"
        try:
            repeats = int(room.get("repeats", DEFAULTS["repeats"]))
        except (TypeError, ValueError):
            return {}, f"'{name}': repeats must be an integer"
        if not 1 <= repeats <= 3:
            return {}, f"'{name}': repeats must be between 1 and 3"
        icon = str(room.get("icon", "")).strip()
        out[name] = {
            "icon": icon,
            "zone": [int(v) for v in zone],
            "suction": suction,
            "water": water,
            "repeats": repeats,
        }
    return out, None


def parse_rooms_yaml(text: str) -> tuple[dict[str, dict], str | None]:
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as err:
        return {}, f"Invalid YAML: {err}"
    return validate_rooms(data)
