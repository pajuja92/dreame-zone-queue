"""Config & options flow for Dreame Zone Queue."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
)

from .rooms import parse_rooms_yaml, rooms_from_dreame_attrs, rooms_to_yaml
from .const import (
    CONF_DELAY_BETWEEN_S,
    CONF_MODE_SELECT,
    CONF_GRACE_S,
    CONF_ROOMS,
    CONF_SUCTION_SELECT,
    CONF_TASK_SENSOR,
    CONF_VACUUM_ENTITY,
    CONF_WAIT_WASH,
    CONF_WATER_SELECT,
    DEFAULT_DELAY_BETWEEN_S,
    DEFAULT_GRACE_S,
    DOMAIN,
    MIN_ZONE_MM,
    SUCTION_LEVELS,
    WATER_LEVELS,
)

COORD = NumberSelector(
    NumberSelectorConfig(min=-30000, max=30000, step=1, mode=NumberSelectorMode.BOX)
)


def _room_schema(defaults: dict | None = None) -> vol.Schema:
    d = defaults or {}
    zone = d.get("zone", [0, 0, 0, 0])
    return vol.Schema(
        {
            vol.Required("name", default=d.get("name", "")): TextSelector(),
            vol.Optional("icon", default=d.get("icon", "")): TextSelector(),
            vol.Required("x1", default=zone[0]): COORD,
            vol.Required("y1", default=zone[1]): COORD,
            vol.Required("x2", default=zone[2]): COORD,
            vol.Required("y2", default=zone[3]): COORD,
            vol.Required("suction", default=d.get("suction", "standard")): SelectSelector(
                SelectSelectorConfig(options=SUCTION_LEVELS)
            ),
            vol.Required("water", default=d.get("water", "moist")): SelectSelector(
                SelectSelectorConfig(options=WATER_LEVELS)
            ),
            vol.Required("repeats", default=d.get("repeats", 1)): NumberSelector(
                NumberSelectorConfig(min=1, max=3, step=1, mode=NumberSelectorMode.BOX)
            ),
        }
    )


def _zone_too_small(room: dict) -> bool:
    z = room["zone"]
    return (abs(z[2] - z[0]) < MIN_ZONE_MM
            or abs(z[3] - z[1]) < MIN_ZONE_MM)


def _room_from_input(user_input: dict) -> tuple[str, dict]:
    name = user_input["name"].strip()
    return name, {
        "icon": (user_input.get("icon") or "").strip(),
        "zone": [
            int(user_input["x1"]), int(user_input["y1"]),
            int(user_input["x2"]), int(user_input["y2"]),
        ],
        "suction": user_input["suction"],
        "water": user_input["water"],
        "repeats": int(user_input["repeats"]),
    }


class DreameZoneQueueConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Initial setup: pick the vacuum entity."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(
                title="Dreame Zone Queue",
                data={CONF_VACUUM_ENTITY: user_input[CONF_VACUUM_ENTITY]},
                options={CONF_ROOMS: {}},
            )
        schema = vol.Schema(
            {
                vol.Required(CONF_VACUUM_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="vacuum")
                )
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    def async_get_options_flow(config_entry):
        return DreameZoneQueueOptionsFlow()


class DreameZoneQueueOptionsFlow(config_entries.OptionsFlow):
    """Options panel: manage rooms & advanced settings from the UI."""

    def __init__(self) -> None:
        self._edit_room: str | None = None

    @property
    def _opts(self) -> dict:
        return {**self.config_entry.data, **self.config_entry.options}

    @property
    def _rooms(self) -> dict:
        return dict(self._opts.get(CONF_ROOMS, {}))

    def _save(self, **changes) -> config_entries.ConfigFlowResult:
        new_options = {**self.config_entry.options, **changes}
        return self.async_create_entry(title="", data=new_options)

    # ---------------- menu ----------------
    async def async_step_init(self, user_input=None):
        return self.async_show_menu(
            step_id="init",
            menu_options=["add_room", "edit_room", "remove_room", "import_dreame", "bulk_edit", "settings"],
        )

    # ---------------- rooms ----------------
    async def async_step_add_room(self, user_input=None):
        errors = {}
        if user_input is not None:
            name, room = _room_from_input(user_input)
            if not name:
                errors["name"] = "name_required"
            elif name in self._rooms:
                errors["name"] = "name_exists"
            elif _zone_too_small(room):
                errors["x1"] = "zone_too_small"
            else:
                rooms = self._rooms
                rooms[name] = room
                return self._save(**{CONF_ROOMS: rooms})
        return self.async_show_form(
            step_id="add_room", data_schema=_room_schema(), errors=errors
        )

    async def async_step_edit_room(self, user_input=None):
        rooms = self._rooms
        if not rooms:
            return self.async_abort(reason="no_rooms")
        if user_input is not None:
            self._edit_room = user_input["room"]
            return await self.async_step_edit_room_form()
        schema = vol.Schema(
            {
                vol.Required("room"): SelectSelector(
                    SelectSelectorConfig(options=sorted(rooms.keys()))
                )
            }
        )
        return self.async_show_form(step_id="edit_room", data_schema=schema)

    async def async_step_edit_room_form(self, user_input=None):
        rooms = self._rooms
        old_name = self._edit_room
        errors = {}
        if user_input is not None:
            name, room = _room_from_input(user_input)
            if _zone_too_small(room):
                errors["x1"] = "zone_too_small"
            else:
                if name != old_name:
                    rooms.pop(old_name, None)
                rooms[name] = room
                return self._save(**{CONF_ROOMS: rooms})
        defaults = {"name": old_name, **rooms.get(old_name, {})}
        return self.async_show_form(
            step_id="edit_room_form", data_schema=_room_schema(defaults),
            errors=errors,
        )

    async def async_step_remove_room(self, user_input=None):
        rooms = self._rooms
        if not rooms:
            return self.async_abort(reason="no_rooms")
        if user_input is not None:
            rooms.pop(user_input["room"], None)
            return self._save(**{CONF_ROOMS: rooms})
        schema = vol.Schema(
            {
                vol.Required("room"): SelectSelector(
                    SelectSelectorConfig(options=sorted(rooms.keys()))
                )
            }
        )
        return self.async_show_form(step_id="remove_room", data_schema=schema)



    # ---------------- import z dreame ----------------
    async def async_step_import_dreame(self, user_input=None):
        errors = {}
        if user_input is not None:
            camera = user_input.get("camera_entity")
            vac = self._opts.get(CONF_VACUUM_ENTITY, "")
            base = vac.split(".", 1)[1] if "." in vac else ""
            candidates = [c for c in (
                camera, f"camera.{base}_map" if base else None, vac or None,
            ) if c]
            found = {}
            for ent in candidates:
                st = self.hass.states.get(ent)
                if st:
                    found = rooms_from_dreame_attrs(st.attributes)
                    if found:
                        break
            if not found:
                errors["base"] = "no_dreame_rooms"
            else:
                rooms = self._rooms if user_input.get("mode") == "merge" else {}
                rooms.update(found)
                return self._save(**{CONF_ROOMS: rooms})
        schema = vol.Schema(
            {
                vol.Optional("camera_entity"): EntitySelector(
                    EntitySelectorConfig(domain="camera")
                ),
                vol.Required("mode", default="merge"): SelectSelector(
                    SelectSelectorConfig(options=["merge", "replace"])
                ),
            }
        )
        return self.async_show_form(
            step_id="import_dreame", data_schema=schema, errors=errors
        )


    # ---------------- auto-detect from dreame ----------------
    async def async_step_detect_rooms(self, user_input=None):
        errors = {}
        vac = self._opts.get(CONF_VACUUM_ENTITY, "")
        derived = f"camera.{vac.split('.', 1)[1]}_map" if "." in vac else None
        if user_input is not None:
            from .rooms import rooms_from_attribute
            found = {}
            for ent in (user_input.get("camera_entity"), derived, vac):
                if not ent:
                    continue
                st = self.hass.states.get(ent)
                if st is None:
                    continue
                found = rooms_from_attribute(st.attributes.get("rooms"))
                if found:
                    break
            if not found:
                errors["base"] = "no_rooms_found"
            else:
                rooms = self._rooms if user_input["mode"] == "merge" else {}
                rooms.update(found)
                return self._save(**{CONF_ROOMS: rooms})
        schema = vol.Schema(
            {
                vol.Optional(
                    "camera_entity",
                    description={"suggested_value": derived},
                ): EntitySelector(EntitySelectorConfig(domain="camera")),
                vol.Required("mode", default="merge"): SelectSelector(
                    SelectSelectorConfig(options=["merge", "replace"])
                ),
            }
        )
        return self.async_show_form(
            step_id="detect_rooms", data_schema=schema, errors=errors
        )

    # ---------------- bulk YAML editor ----------------
    async def async_step_bulk_edit(self, user_input=None):
        errors = {}
        placeholders = {"error_detail": ""}
        if user_input is not None:
            rooms, err = parse_rooms_yaml(user_input.get("rooms_yaml", ""))
            if err:
                errors["rooms_yaml"] = "invalid_rooms_yaml"
                placeholders["error_detail"] = err
            else:
                return self._save(**{CONF_ROOMS: rooms})
        default_text = (
            user_input.get("rooms_yaml") if user_input else rooms_to_yaml(self._rooms)
        )
        schema = vol.Schema(
            {
                vol.Required("rooms_yaml", default=default_text): TextSelector(
                    TextSelectorConfig(multiline=True)
                )
            }
        )
        return self.async_show_form(
            step_id="bulk_edit",
            data_schema=schema,
            errors=errors,
            description_placeholders=placeholders,
        )

    # ---------------- settings ----------------
    async def async_step_settings(self, user_input=None):
        if user_input is not None:
            return self._save(**user_input)
        o = self._opts
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_VACUUM_ENTITY, default=o.get(CONF_VACUUM_ENTITY)
                ): EntitySelector(EntitySelectorConfig(domain="vacuum")),
                vol.Required(
                    CONF_GRACE_S, default=o.get(CONF_GRACE_S, DEFAULT_GRACE_S)
                ): NumberSelector(
                    NumberSelectorConfig(min=10, max=300, step=5, mode=NumberSelectorMode.BOX)
                ),
                vol.Required(
                    CONF_DELAY_BETWEEN_S,
                    default=o.get(CONF_DELAY_BETWEEN_S, DEFAULT_DELAY_BETWEEN_S),
                ): NumberSelector(
                    NumberSelectorConfig(min=0, max=60, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Required(
                    CONF_WAIT_WASH, default=o.get(CONF_WAIT_WASH, False)
                ): BooleanSelector(),
                vol.Optional(
                    CONF_TASK_SENSOR,
                    description={"suggested_value": o.get(CONF_TASK_SENSOR)},
                ): EntitySelector(EntitySelectorConfig(domain="sensor")),
                vol.Optional(
                    CONF_SUCTION_SELECT,
                    description={"suggested_value": o.get(CONF_SUCTION_SELECT)},
                ): EntitySelector(EntitySelectorConfig(domain="select")),
                vol.Optional(
                    CONF_WATER_SELECT,
                    description={"suggested_value": o.get(CONF_WATER_SELECT)},
                ): EntitySelector(EntitySelectorConfig(domain="select")),
                vol.Optional(
                    CONF_MODE_SELECT,
                    description={"suggested_value": o.get(CONF_MODE_SELECT)},
                ): EntitySelector(EntitySelectorConfig(domain="select")),
            }
        )
        return self.async_show_form(step_id="settings", data_schema=schema)
