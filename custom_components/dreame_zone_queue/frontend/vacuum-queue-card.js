/* Vacuum Queue Card — bundled with the Dreame Zone Queue integration.
 * v1.2.0: off levels, editable repeats, drag&drop reorder,
 * removing the active row stops cleaning that room.
 */

const STATUS_ICON = {
  pending: "\u23F3", active: "\u25B6\uFE0F", done: "\u2705",
  skipped: "\u23ED\uFE0F", error: "\u26A0\uFE0F",
};
const SUCTION = ["off", "quiet", "standard", "strong", "turbo"];
const WATER = ["off", "slightly_dry", "moist", "wet"];
const REPEATS = [1, 2, 3];

class VacuumQueueCard extends HTMLElement {
  setConfig(config) {
    this._config = { entity: "sensor.vacuum_zone_queue", ...config };
  }
  static getStubConfig() { return { entity: "sensor.vacuum_zone_queue" }; }
  getCardSize() { return 6; }

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
    if (!st) {
      this.shadowRoot.innerHTML =
        "<ha-card><div style='padding:16px'>Entity not found: " +
        this._config.entity + "</div></ha-card>";
      return;
    }
    const items = st.attributes.items || [];
    const rooms = st.attributes.rooms || [];
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
      return `<tr class="${it.status}" data-id="${it.id}" ${pending ? 'draggable="true"' : ""}>
        <td class="num">${idx + 1}</td>
        <td class="st">${STATUS_ICON[it.status] || ""}</td>
        <td class="room">${it.room}</td>
        <td>${pending ? sel(SUCTION, it.suction, "suction", it.id) : it.suction}</td>
        <td>${pending ? sel(WATER, it.water, "water", it.id) : it.water}</td>
        <td class="rep">${pending ? sel(REPEATS, it.repeats, "repeats", it.id, "\u00D7") : it.repeats + "\u00D7"}</td>
        <td class="ctl">${ctl}</td>
      </tr>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 16px; }
        h2 { margin: 0 0 4px; font-size: 1.1em; display:flex; justify-content:space-between; align-items:center; }
        .badge { font-size: .75em; padding: 2px 8px; border-radius: 10px;
                 background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .badge.running { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .sub { color: var(--secondary-text-color); font-size: .85em; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: .9em; }
        th { text-align: left; color: var(--secondary-text-color); font-weight: 500;
             border-bottom: 1px solid var(--divider-color); padding: 4px 6px; }
        td { padding: 5px 6px; border-bottom: 1px solid var(--divider-color); }
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
        .addrow, .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
        .btn { border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-weight: 600;
               background: var(--secondary-background-color); color: var(--primary-text-color); }
        .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .btn:disabled { opacity: .4; cursor: default; }
        .addrow select { padding: 6px; flex: 1; min-width: 110px; }
      </style>
      <ha-card>
        <h2>Kolejka sprzątania
          <span class="badge ${running ? "running" : ""}">${running ? "RUNNING" : "IDLE"}</span>
        </h2>
        <div class="sub">robot: ${vacState}</div>
        ${items.length
          ? `<table><thead><tr>
               <th>#</th><th></th><th>Pokój</th><th>Ssanie</th><th>Mop</th><th>Powt.</th><th></th>
             </tr></thead><tbody>${rows}</tbody></table>`
          : `<div class="empty">Kolejka pusta — dodaj pokoje poniżej.</div>`}
        <div class="addrow">
          <select id="addRoom">${rooms.map((r) => `<option>${r}</option>`).join("")}</select>
          <button class="btn" id="add" ${rooms.length ? "" : "disabled"}>+ Dodaj</button>
        </div>
        <div class="actions">
          <button class="btn primary" id="start">\u25B6 Start</button>
          <button class="btn" id="pause">\u23F8 Pauza</button>
          <button class="btn" id="skip">\u23ED Pomiń</button>
          <button class="btn" id="clear">\u2715 Wyczyść</button>
        </div>
      </ha-card>`;

    const root = this.shadowRoot;
    const byId = (id) => items.find((i) => i.id === Number(id));
    const posOf = (id) => items.findIndex((i) => i.id === Number(id)) + 1;

    root.getElementById("start").onclick = () => this._call("start");
    root.getElementById("pause").onclick = () => this._call("pause");
    root.getElementById("skip").onclick = () => this._call("skip");
    root.getElementById("clear").onclick = () =>
      confirm("Wyczyścić całą kolejkę?") && this._call("clear");
    root.getElementById("add").onclick = () =>
      this._call("add", { room: root.getElementById("addRoom").value });

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

customElements.define("vacuum-queue-card", VacuumQueueCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacuum-queue-card",
  name: "Vacuum Queue Card",
  description: "Room-by-room cleaning queue for Dreame Zone Queue",
});
