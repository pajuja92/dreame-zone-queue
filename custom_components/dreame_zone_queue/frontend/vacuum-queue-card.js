/* Vacuum Queue Card — bundled with the Dreame Zone Queue integration.
 * v1.3.3: redesigned styling — card-style rows with status accents on
 * mobile, labeled fields, touch-sized controls, polished desktop table.
 */

const STATUS_ICON = {
  pending: "\u23F3", active: "\u25B6\uFE0F", done: "\u2705",
  skipped: "\u23ED\uFE0F", error: "\u26A0\uFE0F",
};
const SUCTION = ["off", "quiet", "standard", "strong", "turbo"];
const WATER = ["off", "slightly_dry", "moist", "wet"];
const REPEATS = [1, 2, 3];

const T_SUCTION = { off: "wy\u0142.", quiet: "cichy", standard: "standard",
                    strong: "mocny", turbo: "turbo" };
const T_WATER = { off: "wy\u0142.", slightly_dry: "lekko suchy",
                  moist: "wilgotny", wet: "mokry" };
const estTxt = (it) =>
  it && it.est_s != null ? `~${Math.max(1, Math.round(it.est_s / 60))} min` : "";

const T_STATE = { docked: "w doku", charging: "\u0142adowanie", cleaning: "sprz\u0105ta",
                  returning: "wraca do bazy", paused: "pauza", idle: "bezczynny",
                  error: "b\u0142\u0105d", unavailable: "niedost\u0119pny", sleeping: "u\u015Bpiony" };

const DEFAULTS = {
  entity: "sensor.vacuum_zone_queue",
  title: "Kolejka sprzątania",
  show_header: true,
  show_robot_state: true,
  show_add_row: true,
  show_actions: true,
  show_arrows: true,
  grip_position: "buttons",
  show_progress: true,
  show_presets: true,
  show_bulk_edit: true,
  bulk_mode: "all",
  read_only: false,
  compact: false,
};

class VacuumQueueCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._fp = null;
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
    const struct = st
      ? (st.attributes.items || []).map((i) => `${i.id}:${i.status}:${i.interrupted ? 1 : 0}:${i.reason || ""}`).join("|")
        + "#" + st.state
        + "#" + (st.attributes.rooms || []).join(",")
        + "#" + (st.attributes.presets || []).join(",")
        + "#" + (st.attributes.feedback ? "fb" : "")
      : "missing";
    if (struct === this._structKey && this.shadowRoot) {
      this._patch(st);
      return;
    }
    this._structKey = struct;
    this._render(st);
  }

  _patch(st) {
    // aktualizacja przyrostowa: bez przebudowy DOM => bez utraty fokusu
    // i skoku scrolla po zmianie selecta
    const root = this.shadowRoot;
    const items = st.attributes.items || [];
    const upd = (cls, key) => {
      root.querySelectorAll("select." + cls).forEach((s) => {
        const it = items.find((i) => i.id === Number(s.dataset.id));
        if (it && String(s.value) !== String(it[key])) s.value = it[key];
      });
    };
    upd("suction", "suction");
    upd("water", "water");
    upd("repeats", "repeats");
    const prog = st.attributes.progress || { done: 0, total: 0 };
    const etaS = st.attributes.eta_s;
    const pf = root.querySelector(".pfill");
    if (pf && prog.total > 0)
      pf.style.width = Math.round(100 * prog.done / prog.total) + "%";
    const pt = root.querySelector(".ptxt");
    if (pt)
      pt.textContent = `${prog.done}/${prog.total} pokoi` +
        (etaS ? ` \u00B7 ~${Math.max(1, Math.round(etaS / 60))} min` : "");
    root.querySelectorAll(".est").forEach((e) => {
      const it = items.find((i) => i.id === Number(e.dataset.id));
      e.textContent = estTxt(it);
    });
    const vac = st.attributes.vacuum_entity;
    const vs = vac && this._hass.states[vac] ? this._hass.states[vac].state : "?";
    const sub = root.querySelector(".sub");
    if (sub) sub.textContent = "robot: " + (T_STATE[vs] || vs);
  }

  _call(service, data = {}) {
    this._hass.callService("dreame_zone_queue", service, data);
  }

  // Pelny _render podmienia caly DOM karty — przegladarka traci kotwice
  // scrolla i strona skacze na gore (widoczne przy dlugiej kolejce).
  // Zbieramy pozycje wszystkich przewijalnych przodkow (takze przez granice
  // shadow DOM) i odtwarzamy je po przebudowie.
  _saveScroll() {
    const saved = [];
    let n = this;
    while (n) {
      if (n.scrollTop > 0) saved.push([n, n.scrollTop]);
      n = n.parentElement || (n.parentNode && (n.parentNode.host || n.parentNode));
      if (n === document) break;
    }
    const se = document.scrollingElement;
    if (se && se.scrollTop > 0) saved.push([se, se.scrollTop]);
    return saved;
  }
  _restoreScroll(saved) {
    const apply = () => saved.forEach(([el, top]) => { el.scrollTop = top; });
    apply();
    requestAnimationFrame(apply);
  }

  _render(st) {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const scrolls = this._saveScroll();
    const c = this._config;
    if (!st) {
      this.shadowRoot.innerHTML =
        "<ha-card><div style='padding:16px'>Entity not found: " +
        c.entity + "</div></ha-card>";
      this._restoreScroll(scrolls);
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
    const ro = !!c.read_only;
    if (!this._sel) this._sel = new Set();
    this._sel = new Set([...this._sel].filter((id) =>
      items.some((i) => i.id === id && i.status === "pending")));
    if (!this._bulkMode) this._bulkMode = c.bulk_mode || "all";
    const selMode = c.show_bulk_edit && !ro && this._bulkMode === "selected";
    const presets = st.attributes.presets || [];
    const prog = st.attributes.progress || { done: 0, total: 0 };
    const etaS = st.attributes.eta_s;
    const vac = st.attributes.vacuum_entity;
    const vacState = vac && this._hass.states[vac] ? this._hass.states[vac].state : "?";

    const sel = (opts, cur, cls, id, labels, suffix = "") =>
      `<select class="${cls}" data-id="${id}">` +
      opts.map((o) => `<option value="${o}" ${String(o) === String(cur) ? "selected" : ""}>${(labels && labels[o]) || o}${suffix}</option>`).join("") +
      `</select>`;

    const rows = items.map((it, idx) => {
      const pending = it.status === "pending";
      const active = it.status === "active";
      const del = `<button class="ib del" data-id="${it.id}"
                    title="${active ? "Zakończ i usuń (kliknij 2×)" : "Usuń (kliknij 2×)"}">\u2715</button>`;
      const arrows = c.show_arrows
        ? `<button class="ib up" data-id="${it.id}" title="Wyżej">\u25B2</button>` +
          `<button class="ib down" data-id="${it.id}" title="Niżej">\u25BC</button>`
        : "";
      const gripBtn = `<span class="grip" title="Przeciągnij">\u2630</span>`;
      const ctl = ro ? "" : pending
        ? (c.grip_position === "buttons" ? gripBtn : "") + arrows + del
        : del;
      const gripCell = `<td class="gripc">${pending && !ro && c.grip_position !== "buttons" ? gripBtn : ""}</td>`;
      const editable = !ro && (pending || active);
      const suctionOpts = SUCTION;
      const waterOpts = WATER;
      const slim = ro || !c.show_arrows;
      return `<tr class="${it.status}${slim ? " slim" : ""}" data-id="${it.id}" ${pending && !ro ? 'draggable="true"' : ""}>
        ${gripCell}
        <td class="num">${idx + 1}</td>
        <td class="st">${STATUS_ICON[it.status] || ""}</td>
        <td class="room">${selMode && pending
            ? `<input type="checkbox" class="pick" data-id="${it.id}" ${this._sel.has(it.id) ? "checked" : ""}>`
            : ""}<span class="rst">${STATUS_ICON[it.status] || ""} </span>${ric(it.room, it.icon)}${it.room}<span class="est" data-id="${it.id}">${estTxt(it)}</span>
          ${active ? (it.interrupted
              ? `<span class="now intr">⏸ ${it.reason || "przerwane"}</span>`
              : '<span class="now">sprząta teraz</span>') : ""}</td>
        <td class="sx"><span class="fl">Ssanie</span>${editable ? sel(suctionOpts, it.suction, "suction", it.id, T_SUCTION) : `<span class="val">${T_SUCTION[it.suction] || it.suction}</span>`}</td>
        <td class="wx"><span class="fl">Mop</span>${editable ? sel(waterOpts, it.water, "water", it.id, T_WATER) : `<span class="val">${T_WATER[it.water] || it.water}</span>`}</td>
        <td class="rep"><span class="fl">Powt.</span>${pending ? sel(REPEATS, it.repeats, "repeats", it.id, null, "\u00D7") : `<span class="val">${it.repeats}\u00D7</span>`}</td>
        <td class="ctl">${ctl}</td>
      </tr>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: ${c.compact ? "10px 12px 12px" : "14px 16px 16px"}; }

        h2 { margin: 0 0 2px; font-size: 1.12em; font-weight: 650;
             display: flex; justify-content: space-between; align-items: center; }
        .hdr { display: inline-flex; align-items: center; gap: 8px; }
        .notebtn { margin-left: 0; font-size: .8em; padding: 3px 9px; }
        .badge { font-size: .7em; font-weight: 700; letter-spacing: .06em;
                 padding: 3px 10px; border-radius: 999px;
                 background: var(--secondary-background-color);
                 color: var(--secondary-text-color); }
        .badge.running { background: var(--primary-color);
                         color: var(--text-primary-color, #fff); }
        .badge.paused { background: var(--warning-color, #ff9800); color: #fff; }
        .sub { color: var(--secondary-text-color); font-size: .84em; margin-bottom: 10px; }

        table { width: 100%; border-collapse: collapse; font-size: ${c.compact ? ".84em" : ".92em"}; }
        th { text-align: left; font-size: .72em; font-weight: 600;
             text-transform: uppercase; letter-spacing: .06em;
             color: var(--secondary-text-color);
             border-bottom: 1px solid var(--divider-color); padding: 4px 6px 6px; }
        td { padding: ${c.compact ? "4px" : "6px"};
             border-bottom: 1px solid var(--divider-color); vertical-align: middle; }
        tbody tr:hover { background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
        tr.active { background: color-mix(in srgb, var(--primary-color) 12%, transparent); font-weight: 600; }
        tr.done, tr.skipped { opacity: .55; }
        tr.error { background: color-mix(in srgb, var(--error-color, red) 12%, transparent); }
        tr.active .st { animation: vqpulse 1.4s ease-in-out infinite; }
        @keyframes vqpulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
        tr.dragover td { border-top: 2px solid var(--primary-color); }
        tr[draggable="true"] { cursor: grab; }
        tr.dragging { opacity: .4; }

        .num { text-align: center; width: 2em; color: var(--secondary-text-color); }
        .st { width: 1.6em; text-align: center; }
        .room { font-weight: 500; }
        .now { display: none; }
        .now.intr { display: inline-block; margin-left: 8px; font-size: .75em;
                    font-weight: 600; color: var(--warning-color, #ff9800);
                    white-space: nowrap; }
        .rep { width: 4.8em; }
        .rst { display: none; }
        .tblwrap { position: relative; }
        td.gripc { display: none; }
        .ctl { white-space: nowrap; text-align: right; width: 8.5em; }
        .fl { display: none; }
        .val { color: var(--secondary-text-color); }
        .grip { cursor: grab; color: var(--secondary-text-color);
                padding: 0 6px; user-select: none; touch-action: none; }

        select { background: var(--card-background-color); color: var(--primary-text-color);
                 border: 1px solid var(--divider-color); border-radius: 8px;
                 padding: 4px 8px; font: inherit; }
        select:focus { outline: none; border-color: var(--primary-color); }
        .ib { background: none; border: 1px solid var(--divider-color); border-radius: 8px;
              color: var(--primary-text-color); cursor: pointer;
              padding: 3px 8px; margin-left: 4px; }
        .ib:hover { background: var(--secondary-background-color); }
        .ib.del { border-color: var(--error-color, #d32f2f); color: var(--error-color, #d32f2f); }
        .ib.del.armed { background: var(--error-color, #d32f2f);
                        border-color: var(--error-color, #d32f2f); color: #fff; }

        .prog { display: flex; align-items: center; gap: 10px; margin: 2px 0 12px; }
        .pbar { flex: 1; height: 6px; border-radius: 999px;
                background: var(--secondary-background-color); overflow: hidden; }
        .pfill { height: 100%; border-radius: 999px;
                 background: var(--primary-color); transition: width .4s ease; }
        .ptxt { font-size: .8em; color: var(--secondary-text-color); white-space: nowrap; }
        .bulk { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
        .bulk .bl { font-size: .8em; color: var(--secondary-text-color); }
        .seg { display: inline-flex; border: 1px solid var(--divider-color);
               border-radius: 999px; overflow: hidden; }
        .seg button { border: none; background: transparent; cursor: pointer;
                      padding: 6px 12px; font: inherit; font-size: .82em;
                      color: var(--secondary-text-color); }
        .seg button.on { background: var(--primary-color);
                         color: var(--text-primary-color, #fff); }
        .pick { width: 18px; height: 18px; margin-right: 8px; vertical-align: -3px;
                accent-color: var(--primary-color); cursor: pointer; }
        .est { margin-left: 8px; font-size: .78em; font-weight: 400;
               color: var(--secondary-text-color); white-space: nowrap; }
        .est:empty { display: none; }
        .bulk select { flex: 1; min-width: 90px; padding: 6px 8px; border-radius: 8px;
                       background: var(--card-background-color); color: var(--primary-text-color);
                       border: 1px solid var(--divider-color); }
        .btn.warn.armed { background: var(--error-color, #d32f2f); color: #fff; }
        .presets { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
        .presets select { padding: 8px 10px; flex: 1; min-width: 130px; border-radius: 10px;
                          background: var(--card-background-color); color: var(--primary-text-color);
                          border: 1px solid var(--divider-color); }
        .empty { padding: 22px 4px; text-align: center;
                 color: var(--secondary-text-color); }
        .empty .e-ic { font-size: 1.9em; display: block; margin-bottom: 6px; opacity: .7; }

        .sec { margin-top: ${c.compact ? "10px" : "14px"}; padding-top: ${c.compact ? "8px" : "10px"};
               border-top: 1px solid var(--divider-color); }
        .sechd { font-size: .68em; font-weight: 700; text-transform: uppercase;
                 letter-spacing: .08em; color: var(--secondary-text-color);
                 margin-bottom: 8px; }
        .sec .addrow, .sec .actions, .sec .bulk, .sec .presets { margin-top: 0; }
        .addrow, .actions { display: flex; gap: 8px; margin-top: ${c.compact ? "10px" : "14px"};
                            flex-wrap: wrap; align-items: center; }
        .addrow select { padding: 8px 10px; flex: 1; min-width: 130px; border-radius: 10px; }
        .btn { border: none; border-radius: 10px; padding: ${c.compact ? "7px 12px" : "9px 16px"};
               cursor: pointer; font: inherit; font-weight: 600;
               background: var(--secondary-background-color); color: var(--primary-text-color); }
        .btn:hover { filter: brightness(1.1); }
        .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .btn.warn { background: none; border: 1px solid var(--error-color, #d32f2f);
                    color: var(--error-color, #d32f2f); }
        .btn:disabled { opacity: .4; cursor: default; }

        /* ================= tryb wąski (< 520 px) ================= */
        :host(.narrow) thead { display: none; }
        :host(.narrow) table, :host(.narrow) tbody { display: block; width: 100%; }
        :host(.narrow) tr {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) 74px;
          grid-template-areas: "room ctl ctl" "sx wx rep";
          gap: 8px 8px; align-items: center;
          background: color-mix(in srgb, var(--secondary-background-color) 55%, transparent);
          border: none; border-left: 4px solid var(--divider-color);
          border-radius: 14px; padding: 12px; margin: 0 0 10px;
        }
        :host(.narrow) tbody tr:hover { background:
          color-mix(in srgb, var(--secondary-background-color) 55%, transparent); }
        :host(.narrow) tr.active { border-left-color: var(--primary-color);
          background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
        :host(.narrow) tr.done, :host(.narrow) tr.skipped {
          border-left-color: var(--success-color, #4caf50); opacity: .6; }
        :host(.narrow) tr.error { border-left-color: var(--error-color, #d32f2f);
          background: color-mix(in srgb, var(--error-color, red) 10%, transparent); }
        :host(.narrow) td { display: block; border: none; padding: 0; }
        :host(.narrow) td.num { display: none; }
        :host(.narrow) td.st { display: none; }
        :host(.narrow) .rst { display: inline; }
        :host(.narrow) table { font-size: 16px; }
        :host(.narrow) td.room { grid-area: room; font-weight: 650; font-size: 17px;
                                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        :host(.narrow) .now { display: block; font-size: .7em; font-weight: 600;
          text-transform: uppercase; letter-spacing: .07em;
          color: var(--primary-color); margin-top: 1px; }
        :host(.narrow) .now.intr { color: var(--warning-color, #ff9800);
          margin-left: 0; text-transform: none; letter-spacing: normal; }
        :host(.narrow) td.ctl { grid-area: ctl; justify-self: end; width: auto; }
        :host(.narrow) td.sx { grid-area: sx; }
        :host(.narrow) td.wx { grid-area: wx; }
        :host(.narrow) td.rep { grid-area: rep; width: auto; }
        :host(.narrow) .fl { display: block; font-size: 12px; font-weight: 600;
          text-transform: uppercase; letter-spacing: .07em;
          color: var(--secondary-text-color); margin: 0 0 3px 2px; }
        :host(.narrow) .val { display: block; padding: 10px 2px; font-size: 16px; }
        :host(.narrow) select { width: 100%; height: 44px; border-radius: 10px;
          padding: 8px 10px; font-size: 16px; }
        :host(.narrow) .ib { min-width: 42px; height: 40px; margin-left: 6px;
          border-radius: 10px; font-size: 16px; }
        :host(.narrow) .now { font-size: 11px; }
        :host(.narrow) .rst { font-size: 16px; }
        :host(.narrow) .grip { display: inline-flex; align-items: center; justify-content: center;
          min-width: 36px; height: 36px; border: 1px solid var(--divider-color);
          border-radius: 10px; touch-action: none; }
        :host(.narrow) .presets select, :host(.narrow) .presets .btn { height: 44px; border-radius: 12px; }
        :host(.narrow) .bulk select { height: 44px; border-radius: 10px; font-size: 16px; }
        :host(.narrow) .bulk .bl { font-size: 12px; flex-basis: 100%; }
        :host(.narrow) .pick { width: 22px; height: 22px; }
        :host(.narrow) .seg { flex-basis: 100%; }
        :host(.narrow) .seg button { flex: 1; padding: 10px 12px; font-size: 14px; }
        :host(.narrow) .est { font-size: 12px; }
        :host(.narrow) tr.dragover td { border-top: none; }
        :host(.narrow) .addrow select, :host(.narrow) .addrow .btn { height: 44px; border-radius: 12px; }
        :host(.narrow) .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        :host(.narrow) .actions .btn { height: 44px; border-radius: 12px; }
        :host(.narrow) .v-left tr {
          grid-template-columns: 34px minmax(0, 1.35fr) minmax(0, 1fr) 74px;
          grid-template-areas: "grip room ctl ctl" "grip sx wx rep"; }
        :host(.narrow) .v-right tr {
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) 74px 34px;
          grid-template-areas: "room ctl ctl grip" "sx wx rep grip"; }
        :host(.narrow) .v-top tr {
          grid-template-areas: "grip grip grip" "room ctl ctl" "sx wx rep"; }
        :host(.narrow) .v-left td.gripc, :host(.narrow) .v-right td.gripc,
        :host(.narrow) .v-top td.gripc { display: block; grid-area: grip; }
        :host(.narrow) td.gripc .grip { display: flex; width: 100%; height: 100%;
          align-items: center; justify-content: center; border: none;
          border-radius: 0; min-width: 0; margin: 0; padding: 0; }
        :host(.narrow) tr.slim { grid-template-areas: "room room ctl" "sx wx rep"; }
        :host(.narrow) .v-left tr.slim {
          grid-template-areas: "grip room room ctl" "grip sx wx rep"; }
        :host(.narrow) .v-right tr.slim {
          grid-template-areas: "room room ctl grip" "sx wx rep grip"; }
        :host(.narrow) .v-top tr.slim {
          grid-template-areas: "grip grip grip" "room room ctl" "sx wx rep"; }
        :host(.narrow) td.gripc .grip { font-size: 1.2em;
          color: var(--secondary-text-color); }
        :host(.narrow) .v-left td.gripc { margin: -12px 2px -12px -12px;
          border-right: 1px solid var(--divider-color); }
        :host(.narrow) .v-right td.gripc { margin: -12px -12px -12px 2px;
          border-left: 1px solid var(--divider-color); }
        :host(.narrow) .v-top td.gripc { margin: -12px -12px 2px; height: 24px;
          border-bottom: 1px solid var(--divider-color); }
        :host(.narrow) tr.placeholder { background: transparent;
          border: 2px dashed var(--primary-color); border-left-width: 2px; }
        :host(.narrow) tr.placeholder > td { visibility: hidden; }
        :host(.narrow) tr.ghost { position: absolute; z-index: 5; margin: 0;
          pointer-events: none; opacity: .96;
          transform: rotate(1.2deg) scale(1.02);
          background: var(--card-background-color);
          border: 1px solid var(--primary-color);
          border-left: 4px solid var(--primary-color); }
      </style>
      <ha-card>
        ${c.show_header ? `<h2>${c.title}
          <span class="hdr">${st.attributes.feedback
              ? `<button class="ib notebtn" id="noteBtn" title="Zapisz notatkę do dziennika feedbacku">\u{1F4DD}</button>`
              : ""}<span class="badge ${st.state}">${{ running: "PRACUJE", paused: "WSTRZYMANA", idle: "BEZCZYNNA" }[st.state] || st.state}</span></span>
        </h2>` : ""}
        ${c.show_robot_state ? `<div class="sub">robot: ${T_STATE[vacState] || vacState}</div>` : ""}
        ${c.show_progress && prog.total > 0 ? `<div class="prog">
          <div class="pbar"><div class="pfill" style="width:${Math.round(100 * prog.done / prog.total)}%"></div></div>
          <span class="ptxt">${prog.done}/${prog.total} pokoi${etaS ? ` \u00B7 ~${Math.max(1, Math.round(etaS / 60))} min` : ""}</span>
        </div>` : ""}
        ${items.length
          ? `<div class="tblwrap v-${c.grip_position}"><table><thead><tr>
               <th>#</th><th></th><th>Pokój</th><th>Ssanie</th><th>Mop</th><th>Powt.</th><th></th>
             </tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><span class="e-ic">\u{1F9F9}</span>Kolejka pusta — dodaj pokoje poniżej.</div>`}
        ${c.show_actions && !ro ? `<div class="sec">
          <div class="sechd">Sterowanie</div>
          <div class="actions">
          ${st.state === "running"
            ? `<button class="btn primary" id="pause" title="Robot dokończy bieżący pokój">\u23F8 Pauza</button>
               <button class="btn" id="skip">\u23ED Pomiń</button>
               <button class="btn warn twoclick" id="stop">\u23F9 Stop</button>`
            : st.state === "paused"
            ? `<button class="btn primary" id="start">\u25B6 Kontynuuj</button>
               <button class="btn" id="skip">\u23ED Pomiń</button>
               <button class="btn warn twoclick" id="stop">\u23F9 Stop</button>`
            : `<button class="btn primary" id="start">\u25B6 Start</button>
               <button class="btn warn twoclick" id="clear">\u2715 Wyczyść</button>`}
          </div>
        </div>` : ""}
        ${c.show_add_row && !ro ? `<div class="sec">
          <div class="sechd">Dodaj pok\u00F3j</div>
          <div class="addrow">
          <select id="addRoom">${rooms.map((r) => `<option value="${r}">${ric(r)}${r}</option>`).join("")}</select>
          <button class="btn" id="add" ${rooms.length ? "" : "disabled"}>+ Dodaj</button>
          </div>
        </div>` : ""}
        ${c.show_bulk_edit && !ro && items.some((i) => i.status === "pending") ? `<div class="sec">
          <div class="sechd">Edytuj oczekuj\u0105ce</div>
          <div class="bulk">
          <span class="seg">
            <button id="bmAll" class="${selMode ? "" : "on"}">Wszystkie</button>
            <button id="bmSel" class="${selMode ? "on" : ""}">${selMode ? `Wybrane (${this._sel.size})` : "Wybrane"}</button>
          </span>
          <select id="bulkS" ${selMode && this._sel.size === 0 ? "disabled" : ""}><option value="">ssanie\u2026</option>${SUCTION.map((o) => `<option value="${o}">${T_SUCTION[o] || o}</option>`).join("")}</select>
          <select id="bulkW" ${selMode && this._sel.size === 0 ? "disabled" : ""}><option value="">mop\u2026</option>${WATER.map((o) => `<option value="${o}">${T_WATER[o] || o}</option>`).join("")}</select>
          <select id="bulkR" ${selMode && this._sel.size === 0 ? "disabled" : ""}><option value="">powt.\u2026</option>${REPEATS.map((o) => `<option value="${o}">${o}\u00D7</option>`).join("")}</select>
          </div>
        </div>` : ""}
        ${c.show_presets && !ro ? `<div class="sec">
          <div class="sechd">Presety</div>
          <div class="presets">
          <select id="presetSel" ${presets.length ? "" : "disabled"}>
            ${presets.length
              ? presets.map((p) => `<option value="${p}">\u2B50 ${p}</option>`).join("")
              : `<option>\u2014 brak preset\u00F3w \u2014</option>`}
          </select>
          <button class="btn" id="pLoad" ${presets.length ? "" : "disabled"} title="Wczytaj preset (zast\u0119puje kolejk\u0119)">\u25B8 Wczytaj</button>
          <button class="btn" id="pSave" title="Zapisz bie\u017C\u0105c\u0105 kolejk\u0119 jako preset">\uD83D\uDCBE</button>
          <button class="btn warn" id="pDel" ${presets.length ? "" : "disabled"} title="Usu\u0144 preset">\uD83D\uDDD1</button>
          </div>
        </div>` : ""}
      </ha-card>`;

    const w = this.getBoundingClientRect().width;
    if (w > 0) this.classList.toggle("narrow", w < 520);

    const root = this.shadowRoot;
    const byId = (id) => items.find((i) => i.id === Number(id));
    const posOf = (id) => items.findIndex((i) => i.id === Number(id)) + 1;
    const on = (id, fn) => { const el = root.getElementById(id); if (el) el.onclick = fn; };

    const arm = (id, fn) => {
      const el = root.getElementById(id);
      if (!el) return;
      el.onclick = () => {
        if (!el.classList.contains("armed")) {
          el.classList.add("armed");
          setTimeout(() => el.classList.remove("armed"), 3000);
          return;
        }
        fn();
      };
    };
    on("noteBtn", () => {
      const t = prompt("Notatka do dziennika feedbacku — co się właśnie stało?");
      if (t && t.trim()) this._call("note", { text: t.trim() });
    });
    on("start", () => this._call("start"));
    on("pause", () => this._call("pause"));
    on("skip", () => this._call("skip"));
    arm("stop", () => this._call("stop"));
    arm("clear", () => this._call("clear"));
    on("add", () => this._call("add", { room: root.getElementById("addRoom").value }));
    const setBulkMode = (m) => {
      this._bulkMode = m;
      if (m === "all") this._sel.clear();
      this._fp = null;
      this._structKey = null;
      this.hass = this._hass;
    };
    on("bmAll", () => setBulkMode("all"));
    on("bmSel", () => setBulkMode("selected"));
    root.querySelectorAll(".pick").forEach((cb) => {
      cb.onchange = () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) this._sel.add(id); else this._sel.delete(id);
        const lbl = root.getElementById("bmSel");
        if (lbl) lbl.textContent = `Wybrane (${this._sel.size})`;
        ["bulkS", "bulkW", "bulkR"].forEach((bid) => {
          const el = root.getElementById(bid);
          if (el) el.disabled = this._sel.size === 0;
        });
      };
    });
    [["bulkS", "suction"], ["bulkW", "water"], ["bulkR", "repeats"]].forEach(([id, key]) => {
      const el = root.getElementById(id);
      if (!el) return;
      el.onchange = () => {
        if (!el.value) return;
        const data = {};
        data[key] = key === "repeats" ? Number(el.value) : el.value;
        if (selMode) {
          if (this._sel.size === 0) { el.value = ""; return; }
          data.item_ids = [...this._sel];
        }
        this._call("set_all_params", data);
        el.value = "";
      };
    });

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
        if (!b.classList.contains("armed")) {
          b.classList.add("armed");
          setTimeout(() => b.classList.remove("armed"), 3000);
          return;
        }
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

    const psel = root.getElementById("presetSel");
    on("pLoad", () => psel && this._call("load_preset", { name: psel.value, mode: "replace" }));
    on("pSave", () => {
      const n = prompt("Nazwa presetu:", psel && !psel.disabled ? psel.value : "");
      if (n && n.trim()) this._call("save_preset", { name: n.trim() });
    });
    on("pDel", () => {
      if (psel && confirm(`Usun\u0105\u0107 preset "${psel.value}"?`))
        this._call("delete_preset", { name: psel.value });
    });

    // ---- przeciaganie za uchwyt: ghost + przerywana ramka ----
    root.querySelectorAll(".grip").forEach((g) => {
      g.addEventListener("pointerdown", (e) => {
        if (!this.classList.contains("narrow")) return;
        e.preventDefault();
        const row = g.closest("tr");
        const wrap = root.querySelector(".tblwrap");
        const tbody = row.parentElement;
        const wr = wrap.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const offY = e.clientY - rr.top;
        const ghost = row.cloneNode(true);
        ghost.classList.add("ghost");
        ghost.style.width = rr.width + "px";
        ghost.style.left = (rr.left - wr.left) + "px";
        ghost.style.top = (rr.top - wr.top) + "px";
        wrap.appendChild(ghost);
        row.classList.add("placeholder");
        const move = (ev) => {
          ev.preventDefault();
          const w2 = wrap.getBoundingClientRect();
          ghost.style.top = (ev.clientY - w2.top - offY) + "px";
          const others = Array.from(tbody.querySelectorAll('tr[draggable="true"]'))
            .filter((r) => r !== row);
          for (const r of others) {
            const b = r.getBoundingClientRect();
            if (ev.clientY > b.top && ev.clientY < b.bottom) {
              if (ev.clientY < b.top + b.height / 2) tbody.insertBefore(row, r);
              else tbody.insertBefore(row, r.nextSibling);
              break;
            }
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          ghost.remove();
          row.classList.remove("placeholder");
          const newPos = Array.from(tbody.children).indexOf(row) + 1;
          if (newPos !== posOf(row.dataset.id))
            this._call("move", { item_id: Number(row.dataset.id), new_position: newPos });
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      });
    });

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

    this._restoreScroll(scrolls);
  }
}

/* ---------------- visual editor ---------------- */

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
      { name: "show_arrows", selector: { boolean: {} } },
      { name: "grip_position", selector: { select: { mode: "dropdown", options: [
        { value: "buttons", label: "Przy przyciskach (domyślnie)" },
        { value: "left", label: "Lewa krawędź karty" },
        { value: "right", label: "Prawa krawędź karty" },
        { value: "top", label: "Pasek na górze karty" },
      ] } } },
      { name: "show_progress", selector: { boolean: {} } },
      { name: "show_presets", selector: { boolean: {} } },
      { name: "show_bulk_edit", selector: { boolean: {} } },
      { name: "read_only", selector: { boolean: {} } },
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
  show_arrows: "Pokaż strzałki zmiany kolejności",
  grip_position: "Położenie uchwytu przeciągania (tryb wąski)",
  show_progress: "Pokaż pasek postępu i ETA",
  show_presets: "Pokaż presety",
  show_bulk_edit: "Pokaż masową zmianę parametrów",
  read_only: "Tylko podgląd (bez kontrolek)",
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
