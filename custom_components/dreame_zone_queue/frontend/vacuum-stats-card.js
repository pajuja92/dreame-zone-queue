/* Vacuum Stats Card — statystyki sprzątania per pokój dla Dreame Zone Queue.
 *
 * Widok ogólny: lista pokoi + agregaty (ostatnie sprzątanie, czas, % strefy,
 * najczęstsze tryby). Klik w pokój → historia wszystkich przebiegów.
 * Dane z GET /api/dreame_zone_queue/history (Store integracji, 100/pokój).
 *
 * Konfiguracja karty:
 *   type: custom:vacuum-stats-card
 *   title: Statystyki sprzątania        (opcjonalnie)
 *   columns: [last, dur, pct, ...]      (opcjonalnie — kolumny widoku ogólnego)
 *   detail_columns: [date, time, ...]   (opcjonalnie — kolumny szczegółów)
 * Kolumny można też wybrać w ⚙ na karcie (zapis w przeglądarce; YAML jest
 * używany, gdy nie ma wyboru z ⚙).
 */

const SUCTION_PL = { off: "—", quiet: "Cichy", silent: "Cichy",
  standard: "Standard", strong: "Mocny", turbo: "Turbo" };
const WATER_PL = { off: "—", slightly_dry: "Lekko wilg.", moist: "Wilgotny",
  wet: "Mokry" };
const MODE_PL = { sweeping: "Zamiatanie", mopping: "Mopowanie",
  sweeping_and_mopping: "Zamiat.+mop." };
const OUTCOME_PL = { done: "✓ sukces", cancelled: "✗ anulowane",
  skipped: "⏭ pominięte", error: "⚠ błąd" };

/* dostępne kolumny: klucz -> {label, val(fn)} */
const OVERVIEW_COLS = {
  last:    { label: "Ostatnio",       val: (s) => s.last ? fmtDate(s.last.ts) : "—" },
  dur:     { label: "Czas",           val: (s) => s.last ? fmtMin(s.last.dur) : "—" },
  avg_dur: { label: "Śr. czas",       val: (s) => s.n ? fmtMin(s.avgDur) : "—" },
  pct:     { label: "% strefy",       val: (s) => s.last && s.last.pct != null ? s.last.pct + "%" : "—" },
  suction: { label: "Odkurzanie (najcz.)", val: (s) => s.topSuction ? (SUCTION_PL[s.topSuction] || s.topSuction) : "—" },
  water:   { label: "Mopowanie (najcz.)",  val: (s) => s.topWater ? (WATER_PL[s.topWater] || s.topWater) : "—" },
  runs:    { label: "Sprzątań",       val: (s) => s.n || "—" },
  success: { label: "Sukces",         val: (s) => s.n ? Math.round(100 * s.ok / s.n) + "%" : "—" },
  returns: { label: "Powroty (śr.)",  val: (s) => s.n ? (s.retSum / s.n).toFixed(1) : "—" },
};
const DEFAULT_OVERVIEW = ["last", "dur", "pct", "suction", "water"];

const DETAIL_COLS = {
  date:    { label: "Data",     val: (r) => fmtD(r.ts) },
  time:    { label: "Godzina",  val: (r) => fmtT(r.ts) },
  pct:     { label: "%",        val: (r) => (r.pct != null ? r.pct + "%" : "—") },
  dur:     { label: "Czas",     val: (r) => fmtMin(r.dur) },
  suction: { label: "Odkurzanie", val: (r) => SUCTION_PL[r.suction] || r.suction || "—" },
  water:   { label: "Mopowanie",  val: (r) => WATER_PL[r.water] || r.water || "—" },
  mode:    { label: "Tryb",     val: (r) => MODE_PL[r.mode] || r.mode },
  outcome: { label: "Wynik",    val: (r) => OUTCOME_PL[r.outcome] || r.outcome },
  returns: { label: "Powroty do bazy", val: (r) => r.returns ?? 0 },
  repeats: { label: "Przejazdy", val: (r) => r.repeats || 1 },
};
const DEFAULT_DETAIL = ["date", "time", "pct", "dur", "suction", "water",
  "outcome", "returns"];

const MODE_FILTERS = [
  ["all", "Wszystkie"],
  ["sweeping", "Zamiatanie"],
  ["mopping", "Mopowanie"],
  ["sweeping_and_mopping", "Zamiat.+mop."],
];

function fmtD(ts) {
  return new Date(ts * 1000).toLocaleDateString("pl-PL",
    { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtT(ts) {
  return new Date(ts * 1000).toLocaleTimeString("pl-PL",
    { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts) {
  return `${fmtD(ts)} ${fmtT(ts)}`;
}
function fmtMin(sec) {
  if (sec == null) return "—";
  const min = Math.round(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

class VacuumStatsCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._room = null; // null = widok ogólny
    this._mode = "all";
    if (this._built) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._built = true;
      this.attachShadow({ mode: "open" });
      this._render();
    }
    // odświeżenie danych najwyżej co 30 s (hass aktualizuje się ciągle)
    const now = Date.now();
    if (!this._lastFetch || now - this._lastFetch > 30000) this._fetch();
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return { title: "Statystyki sprzątania" };
  }

  async _fetch() {
    if (!this._hass) return;
    this._lastFetch = Date.now();
    try {
      const data = await this._hass.callApi("get", "dreame_zone_queue/history");
      this._history = data.history || {};
      this._rooms = data.rooms || [];
      this._error = null;
    } catch (e) {
      this._error = String(e);
    }
    this._render();
  }

  /* kolumny: localStorage (⚙) > YAML > domyślne */
  _cols(view) {
    const lsKey = `dzq-stats-cols-${view}`;
    try {
      const ls = JSON.parse(localStorage.getItem(lsKey));
      if (Array.isArray(ls) && ls.length) return ls;
    } catch (_e) { /* brak/uszkodzony zapis */ }
    const yaml = view === "overview" ? this._config.columns
                                     : this._config.detail_columns;
    if (Array.isArray(yaml) && yaml.length) return yaml;
    return view === "overview" ? DEFAULT_OVERVIEW : DEFAULT_DETAIL;
  }

  _runs(room) {
    let runs = (this._history && this._history[room]) || [];
    if (this._mode !== "all") runs = runs.filter((r) => r.mode === this._mode);
    return runs;
  }

  _roomStats(room) {
    const runs = this._runs(room);
    const s = { n: runs.length, ok: 0, retSum: 0, last: null,
                topSuction: null, topWater: null, avgDur: null };
    if (!runs.length) return s;
    const cnt = (arr) => {
      const c = {};
      for (const v of arr) if (v && v !== "off") c[v] = (c[v] || 0) + 1;
      const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      return top ? top[0] : null;
    };
    s.last = runs[runs.length - 1];
    s.ok = runs.filter((r) => r.outcome === "done").length;
    s.retSum = runs.reduce((a, r) => a + (r.returns || 0), 0);
    s.avgDur = runs.reduce((a, r) => a + (r.dur || 0), 0) / runs.length;
    s.topSuction = cnt(runs.map((r) => r.suction));
    s.topWater = cnt(runs.map((r) => r.water));
    return s;
  }

  _esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._esc(this._config.title || "Statystyki sprzątania");
    const chips = MODE_FILTERS.map(([k, lab]) =>
      `<button class="chip ${this._mode === k ? "on" : ""}" data-mode="${k}">${lab}</button>`
    ).join("");

    let body;
    if (this._error) {
      body = `<div class="empty">Błąd pobierania historii: ${this._esc(this._error)}</div>`;
    } else if (this._room) {
      body = this._detailHtml(this._room);
    } else {
      body = this._overviewHtml();
    }

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 14px 16px 16px; }
        .hdr { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
               margin-bottom: 10px; }
        .hdr h2 { flex: 1; margin: 0; font-size: 1.15em; font-weight: 500;
               min-width: 140px; }
        .hdr button { background: none; border: none; cursor: pointer;
               font: inherit; color: var(--primary-text-color); }
        .chip { border: 1px solid var(--divider-color) !important;
               border-radius: 14px; padding: 3px 10px !important;
               font-size: .82em !important; color: var(--secondary-text-color) !important; }
        .chip.on { background: var(--primary-color) !important;
               color: var(--text-primary-color, #fff) !important;
               border-color: var(--primary-color) !important; }
        .gear { font-size: 1.1em; opacity: .7; }
        .gear:hover { opacity: 1; }
        .back { color: var(--primary-color) !important; font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: .92em; }
        th { text-align: left; font-size: .74em; text-transform: uppercase;
             letter-spacing: .04em; color: var(--secondary-text-color);
             padding: 5px 8px; border-bottom: 1px solid var(--divider-color); }
        td { padding: 7px 8px; border-bottom: 1px solid var(--divider-color); }
        tr.room { cursor: pointer; }
        tr.room:hover td { background: var(--secondary-background-color); }
        td.name { font-weight: 500; }
        .empty { padding: 18px 6px; color: var(--secondary-text-color); }
        .muted { color: var(--secondary-text-color); font-size: .85em;
                 margin-top: 8px; }
        .setbox { border: 1px solid var(--divider-color); border-radius: 10px;
                 padding: 10px 12px; margin-bottom: 10px; }
        .setbox label { display: inline-flex; align-items: center; gap: 5px;
                 margin: 3px 12px 3px 0; font-size: .9em; cursor: pointer; }
        .setbox .note { font-size: .8em; color: var(--secondary-text-color);
                 margin-top: 6px; }
        .tblwrap { overflow-x: auto; }
        .out-done { color: var(--success-color, #0a2); }
        .out-cancelled, .out-error { color: var(--error-color, #d33); }
        .out-skipped { color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="hdr">
          ${this._room
            ? `<button class="back" id="back">‹ Pokoje</button><h2>${this._esc(this._room)}</h2>`
            : `<h2>${title}</h2>`}
          ${chips}
          <button class="gear" id="gear" title="wybór kolumn">⚙</button>
        </div>
        <div id="settings" style="display:none"></div>
        ${body}
      </ha-card>`;

    const r = this.shadowRoot;
    r.querySelectorAll(".chip").forEach((b) => {
      b.onclick = () => { this._mode = b.dataset.mode; this._render(); };
    });
    const back = r.getElementById("back");
    if (back) back.onclick = () => { this._room = null; this._render(); };
    r.querySelectorAll("tr.room").forEach((tr) => {
      tr.onclick = () => { this._room = tr.dataset.room; this._render(); };
    });
    r.getElementById("gear").onclick = () => this._toggleSettings();
  }

  _overviewHtml() {
    const cols = this._cols("overview").filter((c) => OVERVIEW_COLS[c]);
    const rooms = [...new Set([...(this._rooms || []),
                               ...Object.keys(this._history || {})])].sort();
    if (!rooms.length) {
      return `<div class="empty">Brak danych — historia zbiera się od
              momentu instalacji tej wersji przy każdym sprzątaniu.</div>`;
    }
    const head = `<tr><th>Pokój</th>${cols.map((c) =>
      `<th>${OVERVIEW_COLS[c].label}</th>`).join("")}</tr>`;
    const rows = rooms.map((room) => {
      const s = this._roomStats(room);
      return `<tr class="room" data-room="${this._esc(room)}">
        <td class="name">${this._esc(room)} ›</td>
        ${cols.map((c) => `<td>${OVERVIEW_COLS[c].val(s)}</td>`).join("")}</tr>`;
    }).join("");
    return `<div class="tblwrap"><table>${head}${rows}</table></div>
      <div class="muted">Kliknij pokój, aby zobaczyć wszystkie sprzątania.</div>`;
  }

  _detailHtml(room) {
    const cols = this._cols("detail").filter((c) => DETAIL_COLS[c]);
    const runs = [...this._runs(room)].reverse(); // najnowsze na górze
    if (!runs.length) {
      return `<div class="empty">Brak przebiegów dla tego pokoju
              (przy tym filtrze trybu).</div>`;
    }
    const head = `<tr>${cols.map((c) =>
      `<th>${DETAIL_COLS[c].label}</th>`).join("")}</tr>`;
    const rows = runs.map((r) => `<tr>${cols.map((c) => {
      const cls = c === "outcome" ? ` class="out-${r.outcome}"` : "";
      return `<td${cls}>${DETAIL_COLS[c].val(r)}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="tblwrap"><table>${head}${rows}</table></div>
      <div class="muted">${runs.length} przebiegów (max 100 na pokój).</div>`;
  }

  _toggleSettings() {
    const box = this.shadowRoot.getElementById("settings");
    if (box.style.display !== "none") {
      box.style.display = "none";
      return;
    }
    const view = this._room ? "detail" : "overview";
    const all = view === "overview" ? OVERVIEW_COLS : DETAIL_COLS;
    const current = this._cols(view);
    box.innerHTML = `<div class="setbox">
      <b>Kolumny (${view === "overview" ? "widok ogólny" : "szczegóły pokoju"}):</b><br>
      ${Object.entries(all).map(([k, c]) =>
        `<label><input type="checkbox" data-col="${k}"
          ${current.includes(k) ? "checked" : ""}> ${c.label}</label>`).join("")}
      <div class="note">Zapis w tej przeglądarce. Można też ustawić w YAML
        karty (columns / detail_columns).</div>
    </div>`;
    box.style.display = "";
    box.querySelectorAll("input[data-col]").forEach((cb) => {
      cb.onchange = () => {
        const sel = [...box.querySelectorAll("input[data-col]:checked")]
          .map((x) => x.dataset.col);
        localStorage.setItem(`dzq-stats-cols-${view}`, JSON.stringify(sel));
        this._render();
        this._toggleSettings(); // ponowne otwarcie po przerysowaniu
      };
    });
  }
}

customElements.define("vacuum-stats-card", VacuumStatsCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacuum-stats-card",
  name: "Vacuum Stats Card",
  description: "Statystyki sprzątania per pokój (Dreame Zone Queue)",
});
