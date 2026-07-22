"""Constants for Dreame Zone Queue."""

DOMAIN = "dreame_zone_queue"
VERSION = "2.0.0-beta.2"

URL_BASE = "/dreame_zone_queue_files"
CARD_FILENAME = "vacuum-queue-card.js"

# --- config / options keys ---
CONF_VACUUM_ENTITY = "vacuum_entity"
CONF_ROOMS = "rooms"
CONF_GRACE_S = "grace_seconds"
CONF_FINISHED_STATES = "finished_states"
CONF_SUCTION_SELECT = "suction_select_entity"
CONF_WATER_SELECT = "water_select_entity"
CONF_MODE_SELECT = "cleaning_mode_select_entity"
CONF_DELAY_BETWEEN_S = "delay_between_zones"
CONF_WAIT_WASH = "wait_wash_between_rooms"
CONF_TASK_SENSOR = "task_status_sensor"

DEFAULT_GRACE_S = 45
DEFAULT_DELAY_BETWEEN_S = 3
DEFAULT_FINISHED_STATES = ["returning", "docked", "idle", "charging"]

# orchestrator timings
WATCHDOG_S = 60            # reconciliation interval while the queue is alive
STALL_S = 35 * 60          # firmware abandons a paused task after ~30 min
CANCEL_REVERT_WINDOW_S = 15  # how long after "done" a cancel event may revert it
WASH_WAIT_TIMEOUT_S = 180  # give up waiting for a between-rooms mop wash
MIN_ZONE_MM = 120          # dreame rejects zones smaller than ~2 map grid cells

SUCTION_LEVELS = ["off", "quiet", "standard", "strong", "turbo"]
WATER_LEVELS = ["off", "slightly_dry", "moist", "wet"]

# dreame_vacuum.vacuum_clean_zone accepts integer levels (dev & master)
SUCTION_TO_INT = {"quiet": 0, "silent": 0, "standard": 1, "strong": 2, "turbo": 3}
WATER_TO_INT = {"slightly_dry": 1, "moist": 2, "wet": 3}

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
