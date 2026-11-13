"""Constants for Dreame Zone Queue."""

DOMAIN = "dreame_zone_queue"
VERSION = "2.0.0-beta.27"

URL_BASE = "/dreame_zone_queue_files"
CARD_FILENAME = "vacuum-queue-card.js"
STATS_CARD_FILENAME = "vacuum-stats-card.js"
SESSION_CARD_FILENAME = "vacuum-session-card.js"
INSIGHTS_CARD_FILENAME = "vacuum-insights-card.js"

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
# koniec pokoju w drodze do bazy -> od razu nastepny pokoj (bez dojazdu/mycia)
CONF_DIRECT_NEXT = "direct_next_room"
CONF_DIRECT_MIN_BATTERY = "direct_min_battery"
DEFAULT_DIRECT_MIN_BATTERY = 30   # powroty na ladowanie L10 Prime: ~15-16%
DIRECT_MIN_AREA_RATIO = 0.5       # realne konce pokoju 57-82%, przerwania 1-39%
CONF_TASK_SENSOR = "task_status_sensor"
CONF_NOTIFY_SERVICE = "notify_service"  # np. notify.mobile_app_telefon — push przy problemach

DEFAULT_GRACE_S = 45
DEFAULT_DELAY_BETWEEN_S = 3
DEFAULT_FINISHED_STATES = ["returning", "docked", "idle", "charging"]

# orchestrator timings
WATCHDOG_S = 60            # reconciliation interval while the queue is alive
# firmware abandons a MANUALLY paused task after ~30 min: warn the user
# before that happens, and treat a "completed" arriving after it as abandonment
STALL_WARN_S = 25 * 60
ABANDON_S = 28 * 60
CANCEL_REVERT_WINDOW_S = 15  # how long after "done" a cancel event may revert it
WASH_WAIT_TIMEOUT_S = 180  # give up waiting for a between-rooms mop wash
# "completed" with the zone barely touched = physical home/stop press
# (L10 Prime never fires the cancel bus event); real finishes clean 57-82%
CANCEL_AREA_RATIO = 0.4
# <5% = robot did not really enter the zone (closed / ajar door):
# skip the room and keep the queue going instead of pausing
UNREACHABLE_AREA_RATIO = 0.05
HISTORY_MAX_RUNS = 100  # per room, dla karty statystyk
INCIDENTS_MAX = 500        # bledy / utkniecia / anulowania z pozycja robota
# utkniecie: robot "sprzata", a przez tyle sekund nie odjechal o STUCK_MOVE_MM
STUCK_WINDOW_S = 180
STUCK_MOVE_MM = 300
ERROR_ESCALATE_S = 10 * 60  # blad trwa tyle -> drugie powiadomienie (push)
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

# domyslna ikona presetu (emoji), gdy nie wybrano innej
DEFAULT_PRESET_ICON = "\u2B50"

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.queue"

# feedback / diagnostics
FEEDBACK_LOG = "dreame_zone_queue_feedback.log"  # in the HA config dir
FEEDBACK_LOGGER = f"{DOMAIN}.feedback"
FEEDBACK_MAX_BYTES = 2_000_000
FEEDBACK_BACKUPS = 5
# DZQ_DIAG: pełny zrzut atrybutów co tyle wpisów, pomiędzy tylko zmiany
# (pełne zrzuty ~2,7 KB/wpis = 5 MB/dobę; same zmiany — tygodnie historii)
FEEDBACK_KEYFRAME_EVERY = 100
SERVICE_NOTE = "note"

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

# niezawodnosc / samodzielnosc (przeglad 2026-11-09)
DISPATCH_RETRIES = 3            # ponowienia wysylki strefy przed pauza
DISPATCH_RETRY_S = 60
RESUME_AFTER_RESTART_S = 60     # po restarcie HA: sprawdz robota i wznow kolejke
RESUME_TRIES = 5                # ...gdy encja robota jeszcze niedostepna
INTERRUPT_WARN_S = 2 * 3600     # przerwa (ladowanie, DND...) dluzsza = push
CUSTOM_HISTORY_DAYS = 30        # historia wlasnych stref bez nowych przebiegow
FEEDBACK_ARCHIVES_KEEP = 5      # zarchiwizowane dzienniki feedbacku
