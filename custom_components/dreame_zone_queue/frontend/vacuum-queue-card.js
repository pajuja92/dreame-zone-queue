/* Vacuum Queue Card — bundled with the Dreame Zone Queue integration.
 * v1.3.1: visual editor (ha-form) + card options, grid options for
 * sections layout; off levels, repeats, drag&drop, live active-row edit.
 */

const STATUS_ICON = {
  pending: "\u23F3", active: "\u25B6\uFE0F", done: "\u2705",
  skipped: "\u23ED\uFE0F", error: "\u26A0\uFE0F",
};
const SUCTION = ["off", "quiet", "standard", "strong", "turbo"];
const WATER = ["off", "slightly_dry", "moist", "wet"];
const REPEATS = [1, 2, 3];

const DEFAULTS = {
  entity: "sensor.vacuum_zone_queue",
  title: "Kolejka sprzątania",
  show_header: true,
  show_robot_state: true,
  show_add_row: true,
  show_actions: true,
  compact: false,
};

class VacuumQueueCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._fp = null; // wymus ponowny render po zmianie configu
    if (this._hass) this._render(this._hass.states[this._config.entity]);
  }
  static getStubConfig() { return { entity: "sensor.vacuum_zone_queue" }; }
  static getConfigElement() {
    return document.createElement("vacuum-queue-card-editor");
  }
  getCardSize() { return this._config && this._config.compact ? 4 : 6; }
  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback() {
    if (!this._ro) {
      this._ro = new ResizeObserver((entries) => {
        const w = entries[0].contentRect.width;
        if (w > 0) this.classList.toggle("narrow", w < 520);
      });
      this._ro.observe(this);
    }
  }
  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    const fp = st ? st.last_updated + JSON.stringify(st.attributes.items) + st.state : "missing";
    if (fp === this._fp) return;
    this._fp = fp;
    this._render(st);
  }

  _call(service, data = {}) {
    this._hass.callService("dreame_zone_queue", service, data);
  }

  _render(st) {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    if (!st) {
      this.shadowRoot.innerHTML =
        "<ha-card><div style='padding:16px'>Entity not found: " +
        c.entity + "</div></ha-card>";
      return;
    }
    const items = st.attributes.items || [];
    const rooms = st.attributes.rooms || [];
    const roomIcons = st.attributes.room_icons || {};
    const ric = (name, own) => {
      const i = own || roomIcons[name] || "";
      return i ? i + " " : "";
    };
    const running = st.state === "running";
    const vac = st.attributes.vacuum_entity;
    const vacState = vac && this._hass.states[vac] ? this._hass.states[vac].state : "?";

    const sel = (opts, cur, cls, id, suffix = "") =>
      `<select class="${cls}" data-id="${id}">` +
      opts.map((o) => `<option value="${o}" ${String(o) === String(cur) ? "selected" : ""}>${o}${suffix}</option>`).join("") +
      `</select>`;

    const rows = items.map((it, idx) => {
      const pending = it.status === "pending";
      const active = it.status === "active";
      const del = `<button class="ib del ${active ? "danger" : ""}" data-id="${it.id}"
                    title="${active ? "Zakończ i usuń" : "Usuń"}">\u2715</button>`;
      const ctl = pending
        ? `<span class="grip" title="Przeciągnij">\u2630</span>` +
          `<button class="ib up" data-id="${it.id}" title="Wyżej">\u25B2</button>` +
          `<button class="ib down" data-id="${it.id}" title="Niżej">\u25BC</button>` + del
        : del;
      const editable = pending || active;
      const suctionOpts = active ? SUCTION.filter((o) => o !== "off") : SUCTION;
      const waterOpts = active ? WATER.filter((o) => o !== "off") : WATER;
      return `<tr class="${it.status}" data-id="${it.id}" ${pending ? 'draggable="true"' : ""}>
        <td class="num">${idx + 1}</td>
        <td class="st">${STATUS_ICON[it.status] || ""}</td>
        <td class="room">${ric(it.room, it.icon)}${it.room}</td>
        <td class="sx">${editable ? sel(suctionOpts, it.suction, "suction", it.id) : it.suction}</td>
        <td class="wx">${editable ? sel(waterOpts, it.water, "water", it.id) : it.water}</td>
        <td class="rep">${pending ? sel(REPEATS, it.repeats, "repeats", it.id, "\u00D7") : it.repeats + "\u00D7"}</td>
        <td class="ctl">${ctl}</td>
      </tr>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: ${c.compact ? "8px 10px 10px" : "12px 16px 16px"}; }
        h2 { margin: 0 0 4px; font-size: 1.1em; display:flex; justify-content:space-between; align-items:center; }
        .badge { font-size: .75em; padding: 2px 8px; border-radius: 10px;
                 background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .badge.running { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .sub { color: var(--secondary-text-color); font-size: .85em; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: ${c.compact ? ".82em" : ".9em"}; }
        th { text-align: left; color: var(--secondary-text-color); font-weight: 500;
             border-bottom: 1px solid var(--divider-color); padding: 4px 6px; }
        td { padding: ${c.compact ? "3px 4px" : "5px 6px"}; border-bottom: 1px solid var(--divider-color); }
        tr.active { background: color-mix(in srgb, var(--primary-color) 14%, transparent); font-weight: 600; }
        tr.done, tr.skipped { opacity: .55; }
        tr.error { background: color-mix(in srgb, var(--error-color, red) 14%, transparent); }
        tr.dragover td { border-top: 2px solid var(--primary-color); }
        tr[draggable="true"] { cursor: grab; }
        tr.dragging { opacity: .4; }
        .num { text-align: center; width: 2em; }
        .st { width: 1.6em; text-align:center; }
        .rep { width: 4.5em; }
        .ctl { white-space: nowrap; text-align: right; width: 8em; }
        .grip { cursor: grab; color: var(--secondary-text-color); padding: 0 6px; user-select: none; }
        select { background: var(--card-background-color); color: var(--primary-text-color);
                 border: 1px solid var(--divider-color); border-radius: 4px; padding: 2px 4px; }
        .ib { background: none; border: 1px solid var(--divider-color); border-radius: 4px;
              color: var(--primary-text-color); cursor: pointer; padding: 2px 6px; margin-left: 3px; }
        .ib:hover { background: var(--secondary-background-color); }
        .ib.danger { border-color: var(--error-color, #d32f2f); color: var(--error-color, #d32f2f); }
        .empty { padding: 16px 4px; color: var(--secondary-text-color); font-style: italic; }
        .addrow, .actions { display: flex; gap: 8px; margin-top: ${c.compact ? "8px" : "12px"}; flex-wrap: wrap; align-items: center; }
        .btn { border: none; border-radius: 6px; padding: ${c.compact ? "5px 10px" : "7px 14px"}; cursor: pointer; font-weight: 600;
               background: var(--secondary-background-color); color: var(--primary-text-color); }
        .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .btn:disabled { opacity: .4; cursor: default; }
        .addrow select { padding: 6px; flex: 1; min-width: 110px; }

        /* ---------- tryb waski (karta < 520px, np. telefon) ---------- */
        :host(.narrow) thead { display: none; }
        :host(.narrow) table, :host(.narrow) tbody { display: block; width: 100%; }
        :host(.narrow) tr { display: flex; flex-wrap: wrap; align-items: center;
                            gap: 2px 6px; padding: 8px 0;
                            border-bottom: 1px solid var(--divider-color); }
        :host(.narrow) td { display: block; border: none; padding: 2px; }
        :host(.narrow) td.num { display: none; }
        :host(.narrow) td.st { order: 1; width: auto; }
        :host(.narrow) td.room { order: 2; flex: 1 1 auto; font-weight: 600; }
        :host(.narrow) td.ctl { order: 3; width: auto; margin-left: auto; }
        :host(.narrow) td.sx { order: 4; flex: 1 1 32%; }
        :host(.narrow) td.wx { order: 5; flex: 1 1 38%; }
        :host(.narrow) td.rep { order: 6; flex: 1 1 18%; width: auto; }
        :host(.narrow) td.sx select, :host(.narrow) td.wx select,
        :host(.narrow) td.rep select { width: 100%; }
        :host(.narrow) .grip { display: none; }   /* dnd i tak nie dziala na dotyku */
        :host(.narrow) tr.dragover td { border-top: none; }
        :host(.narrow) .actions .btn { flex: 1 1 45%; }
      </style>
      <ha-card>
        ${c.show_header ? `<h2>${c.title}
          <span class="badge ${running ? "running" : ""}">${running ? "RUNNING" : "IDLE"}</span>
        </h2>` : ""}
        ${c.show_robot_state ? `<div class="sub">robot: ${vacState}</div>` : ""}
        ${items.length
          ? `<table><thead><tr>
               <th>#</th><th></th><th>Pokój</th><th>Ssanie</th><th>Mop</th><th>Powt.</th><th></th>
             </tr></thead><tbody>${rows}</tbody></table>`
          : `<div class="empty">Kolejka pusta — dodaj pokoje poniżej.</div>`}
        ${c.show_add_row ? `<div class="addrow">
          <select id="addRoom">${rooms.map((r) => `<option value="${r}">${ric(r)}${r}</option>`).join("")}</select>
          <button class="btn" id="add" ${rooms.length ? "" : "disabled"}>+ Dodaj</button>
        </div>` : ""}
        ${c.show_actions ? `<div class="actions">
          <button class="btn primary" id="start">\u25B6 Start</button>
          <button class="btn" id="pause">\u23F8 Pauza</button>
          <button class="btn" id="skip">\u23ED Pomiń</button>
          <button class="btn" id="clear">\u2715 Wyczyść</button>
        </div>` : ""}
      </ha-card>`;

    const root = this.shadowRoot;
    const byId = (id) => items.find((i) => i.id === Number(id));
    const posOf = (id) => items.findIndex((i) => i.id === Number(id)) + 1;
    const on = (id, fn) => { const el = root.getElementById(id); if (el) el.onclick = fn; };

    on("start", () => this._call("start"));
    on("pause", () => this._call("pause"));
    on("skip", () => this._call("skip"));
    on("clear", () => confirm("Wyczyścić całą kolejkę?") && this._call("clear"));
    on("add", () => this._call("add", { room: root.getElementById("addRoom").value }));

    root.querySelectorAll(".up").forEach((b) => {
      b.onclick = () => {
        const p = posOf(b.dataset.id);
        if (p > 1) this._call("move", { item_id: Number(b.dataset.id), new_position: p - 1 });
      };
    });
    root.querySelectorAll(".down").forEach((b) => {
      b.onclick = () => {
        const p = posOf(b.dataset.id);
        if (p < items.length)
          this._call("move", { item_id: Number(b.dataset.id), new_position: p + 1 });
      };
    });
    root.querySelectorAll(".del").forEach((b) => {
      b.onclick = () => {
        const it = byId(b.dataset.id);
        if (it && it.status === "active" &&
            !confirm(`Zakończyć sprzątanie pokoju "${it.room}" i usunąć go z kolejki?`)) return;
        this._call("remove", { item_id: Number(b.dataset.id) });
      };
    });
    root.querySelectorAll("select.suction").forEach((s) => {
      s.onchange = () => {
        const it = byId(s.dataset.id);
        if (s.value === "off" && it && it.water === "off") {
          alert("Ssanie i mop nie mogą być jednocześnie wyłączone.");
          s.value = it.suction; return;
        }
        this._call("set_params", { item_id: Number(s.dataset.id), suction: s.value });
      };
    });
    root.querySelectorAll("select.water").forEach((s) => {
      s.onchange = () => {
        const it = byId(s.dataset.id);
        if (s.value === "off" && it && it.suction === "off") {
          alert("Ssanie i mop nie mogą być jednocześnie wyłączone.");
          s.value = it.water; return;
        }
        this._call("set_params", { item_id: Number(s.dataset.id), water: s.value });
      };
    });
    root.querySelectorAll("select.repeats").forEach((s) => {
      s.onchange = () =>
        this._call("set_params", { item_id: Number(s.dataset.id), repeats: Number(s.value) });
    });

    // ---- drag & drop (tylko wiersze pending) ----
    let dragId = null;
    root.querySelectorAll('tr[draggable="true"]').forEach((tr) => {
      tr.addEventListener("dragstart", (e) => {
        dragId = tr.dataset.id;
        tr.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId);
      });
      tr.addEventListener("dragend", () => {
        tr.classList.remove("dragging");
        root.querySelectorAll("tr.dragover").forEach((t) => t.classList.remove("dragover"));
      });
      tr.addEventListener("dragover", (e) => {
        if (dragId && dragId !== tr.dataset.id) {
          e.preventDefault();
          tr.classList.add("dragover");
        }
      });
      tr.addEventListener("dragleave", () => tr.classList.remove("dragover"));
      tr.addEventListener("drop", (e) => {
        e.preventDefault();
        tr.classList.remove("dragover");
        const src = Number(e.dataTransfer.getData("text/plain") || dragId);
        if (src && src !== Number(tr.dataset.id))
          this._call("move", { item_id: src, new_position: posOf(tr.dataset.id) });
        dragId = null;
      });
    });
  }
}

/* ---------------- visual editor (zakladka Konfiguracja) ---------------- */

const EDITOR_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
  { name: "title", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_header", selector: { boolean: {} } },
      { name: "show_robot_state", selector: { boolean: {} } },
      { name: "show_add_row", selector: { boolean: {} } },
      { name: "show_actions", selector: { boolean: {} } },
      { name: "compact", selector: { boolean: {} } },
    ],
  },
];

const EDITOR_LABELS = {
  entity: "Encja kolejki (sensor)",
  title: "Tytuł karty",
  show_header: "Pokaż nagłówek",
  show_robot_state: "Pokaż stan robota",
  show_add_row: "Pokaż dodawanie pokoi",
  show_actions: "Pokaż przyciski sterujące",
  compact: "Tryb kompaktowy",
};

class VacuumQueueCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }
  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { type: "custom:vacuum-queue-card", ...ev.detail.value };
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    if (this._hass) this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}

customElements.define("vacuum-queue-card", VacuumQueueCard);
customElements.define("vacuum-queue-card-editor", VacuumQueueCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacuum-queue-card",
  name: "Vacuum Queue Card",
  description: "Room-by-room cleaning queue for Dreame Zone Queue",
  preview: true,
});
