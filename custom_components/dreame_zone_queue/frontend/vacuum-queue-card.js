/* Vacuum Queue Card — bundled with the Dreame Zone Queue integration.
 * Table widget: reorder pending rooms, per-row suction/mop selects,
 * add rooms, start/pause/skip/clear. No external dependencies.
 */

const STATUS_ICON = {
  pending: "\u23F3",
  active: "\u25B6\uFE0F",
  done: "\u2705",
  skipped: "\u23ED\uFE0F",
  error: "\u26A0\uFE0F",
};
const SUCTION = ["quiet", "standard", "strong", "turbo"];
const WATER = ["slightly_dry", "moist", "wet"];

class VacuumQueueCard extends HTMLElement {
  setConfig(config) {
    this._config = { entity: "sensor.vacuum_zone_queue", ...config };
  }

  static getStubConfig() {
    return { entity: "sensor.vacuum_zone_queue" };
  }

  getCardSize() {
    return 6;
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    const fingerprint = st ? st.last_updated + JSON.stringify(st.attributes.items) + st.state : "missing";
    if (fingerprint === this._fingerprint) return;
    this._fingerprint = fingerprint;
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

    const sel = (opts, cur, cls, id) =>
      `<select class="${cls}" data-id="${id}">` +
      opts.map((o) => `<option ${o === cur ? "selected" : ""}>${o}</option>`).join("") +
      `</select>`;

    const rows = items
      .map((it, idx) => {
        const pending = it.status === "pending";
        const ctl = pending
          ? `<button class="ib up" data-id="${it.id}" title="Up">\u25B2</button>` +
            `<button class="ib down" data-id="${it.id}" title="Down">\u25BC</button>` +
            `<button class="ib del" data-id="${it.id}" title="Remove">\u2715</button>`
          : it.status === "active"
          ? ""
          : `<button class="ib del" data-id="${it.id}" title="Remove">\u2715</button>`;
        return `<tr class="${it.status}">
          <td class="num">${idx + 1}</td>
          <td class="st">${STATUS_ICON[it.status] || ""}</td>
          <td class="room">${it.room}</td>
          <td>${pending ? sel(SUCTION, it.suction, "suction", it.id) : it.suction}</td>
          <td>${pending ? sel(WATER, it.water, "water", it.id) : it.water}</td>
          <td class="num">${it.repeats}\u00D7</td>
          <td class="ctl">${ctl}</td>
        </tr>`;
      })
      .join("");

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
        .num { text-align: center; width: 2em; }
        .st { width: 1.6em; text-align:center; }
        .ctl { white-space: nowrap; text-align: right; width: 6em; }
        select { background: var(--card-background-color); color: var(--primary-text-color);
                 border: 1px solid var(--divider-color); border-radius: 4px; padding: 2px 4px; }
        .ib { background: none; border: 1px solid var(--divider-color); border-radius: 4px;
              color: var(--primary-text-color); cursor: pointer; padding: 2px 6px; margin-left: 3px; }
        .ib:hover { background: var(--secondary-background-color); }
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
        ${
          items.length
            ? `<table><thead><tr>
                 <th>#</th><th></th><th>Pokój</th><th>Ssanie</th><th>Mop</th><th></th><th></th>
               </tr></thead><tbody>${rows}</tbody></table>`
            : `<div class="empty">Kolejka pusta — dodaj pokoje poniżej.</div>`
        }
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
    root.getElementById("start").onclick = () => this._call("start");
    root.getElementById("pause").onclick = () => this._call("pause");
    root.getElementById("skip").onclick = () => this._call("skip");
    root.getElementById("clear").onclick = () =>
      confirm("Wyczyścić całą kolejkę?") && this._call("clear");
    root.getElementById("add").onclick = () =>
      this._call("add", { room: root.getElementById("addRoom").value });

    const posOf = (id) => items.findIndex((i) => i.id === Number(id)) + 1;
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
      b.onclick = () => this._call("remove", { item_id: Number(b.dataset.id) });
    });
    root.querySelectorAll("select.suction").forEach((s) => {
      s.onchange = () =>
        this._call("set_params", { item_id: Number(s.dataset.id), suction: s.value });
    });
    root.querySelectorAll("select.water").forEach((s) => {
      s.onchange = () =>
        this._call("set_params", { item_id: Number(s.dataset.id), water: s.value });
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
