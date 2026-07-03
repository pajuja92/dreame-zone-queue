"""Constants for Dreame Zone Queue."""

DOMAIN = "dreame_zone_queue"
VERSION = "1.2.1"

URL_BASE = "/dreame_zone_queue_files"
CARD_FILENAME = "vacuum-queue-card.js"

# --- config / options keys ---
CONF_VACUUM_ENTITY = "vacuum_entity"
CONF_ROOMS = "rooms"
CONF_GRACE_S = "grace_seconds"
CONF_FINISHED_STATES = "finished_states"
CONF_USE_SELECTS = "use_selects"
CONF_WATER_PARAM = "water_param"
CONF_SUCTION_SELECT = "suction_select_entity"
CONF_WATER_SELECT = "water_select_entity"
CONF_MODE_SELECT = "cleaning_mode_select_entity"
CONF_DELAY_BETWEEN_S = "delay_between_zones"

DEFAULT_GRACE_S = 45
DEFAULT_DELAY_BETWEEN_S = 3
DEFAULT_WATER_PARAM = "mop_pad_humidity"
DEFAULT_FINISHED_STATES = ["returning", "docked", "idle", "charging"]

SUCTION_LEVELS = ["off", "quiet", "standard", "strong", "turbo"]
WATER_LEVELS = ["off", "slightly_dry", "moist", "wet"]

# --- queue item statuses ---
STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_DONE = "done"
STATUS_SKIPPED = "skipped"
STATUS_ERROR = "error"

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.queue"

SIGNAL_QUEUE_UPDATED = f"{DOMAIN}_queue_updated"

SERVICE_ADD = "add"
SERVICE_REMOVE = "remove"
SERVICE_MOVE = "move"
SERVICE_SET_PARAMS = "set_params"
SERVICE_START = "start"
SERVICE_PAUSE = "pause"
SERVICE_SKIP = "skip"
SERVICE_CLEAR = "clear"

ATTR_ROOM = "room"
ATTR_POSITION = "position"
ATTR_NEW_POSITION = "new_position"
ATTR_ITEM_ID = "item_id"
ATTR_SUCTION = "suction"
ATTR_WATER = "water"
ATTR_REPEATS = "repeats"
