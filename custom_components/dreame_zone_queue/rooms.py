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


def rooms_from_dreame_attrs(attrs: dict) -> dict[str, dict]:
    """Build room definitions from dreame-vacuum entity attributes.

    Handles both shapes seen in the wild:
    - dict: {"1": {"name": ..., "x0": .., "y0": .., "x1": .., "y1": ..}, ...}
    - list: [{"id": 1, "name": ..., "outline": [[x, y], ...]}, ...]
    """
    raw = attrs.get("rooms")
    if isinstance(raw, dict):
        pairs = list(raw.items())
    elif isinstance(raw, list):
        pairs = [(r.get("id", i + 1), r) for i, r in enumerate(raw)
                 if isinstance(r, dict)]
    else:
        return {}
    out: dict[str, dict] = {}
    for rid, r in pairs:
        if not isinstance(r, dict):
            continue
        zone = None
        if all(k in r for k in ("x0", "y0", "x1", "y1")):
            zone = [r["x0"], r["y0"], r["x1"], r["y1"]]
        elif isinstance(r.get("outline"), (list, tuple)) and r["outline"]:
            try:
                xs = [p[0] for p in r["outline"]]
                ys = [p[1] for p in r["outline"]]
                zone = [min(xs), min(ys), max(xs), max(ys)]
            except (TypeError, IndexError):
                zone = None
        if zone is None:
            continue
        try:
            x0, y0, x1, y1 = (int(v) for v in zone)
        except (TypeError, ValueError):
            continue
        name = str(r.get("name") or f"Room {rid}").strip() or f"Room {rid}"
        out[name] = {
            "icon": "",
            "zone": [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)],
            "suction": DEFAULTS["suction"],
            "water": DEFAULTS["water"],
            "repeats": DEFAULTS["repeats"],
        }
    return out


def rooms_from_attribute(value: Any) -> dict[str, dict]:
    """Convert the dreame camera/vacuum 'rooms' attribute into our room defs.

    Handles the known shapes: dict-of-dicts keyed by segment id, or a list;
    coordinates as x0/y0/x1/y1, x1/y1/x2/y2, an 'outline' point list,
    or x/y/width/height.
    """
    if isinstance(value, dict):
        entries = list(value.items())
    elif isinstance(value, list):
        entries = list(enumerate(value, start=1))
    else:
        return {}
    out: dict[str, dict] = {}
    for key, room in entries:
        if not isinstance(room, dict):
            continue
        xs: list[float] = []
        ys: list[float] = []
        if all(k in room for k in ("x0", "y0", "x1", "y1")):
            xs = [room["x0"], room["x1"]]
            ys = [room["y0"], room["y1"]]
        elif all(k in room for k in ("x1", "y1", "x2", "y2")):
            xs = [room["x1"], room["x2"]]
            ys = [room["y1"], room["y2"]]
        elif isinstance(room.get("outline"), (list, tuple)) and room["outline"]:
            try:
                xs = [p[0] for p in room["outline"]]
                ys = [p[1] for p in room["outline"]]
            except (TypeError, IndexError):
                continue
        elif all(k in room for k in ("x", "y", "width", "height")):
            xs = [room["x"], room["x"] + room["width"]]
            ys = [room["y"], room["y"] + room["height"]]
        else:
            continue
        try:
            zone = [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]
        except (TypeError, ValueError):
            continue
        name = str(room.get("name") or f"Room {key}").strip()
        out[name] = {"icon": "", "zone": zone, **DEFAULTS}
        out[name].pop("icon", None)
        out[name] = {"icon": str(room.get("icon", "") or ""), "zone": zone,
                     "suction": DEFAULTS["suction"], "water": DEFAULTS["water"],
                     "repeats": DEFAULTS["repeats"]}
    return out
