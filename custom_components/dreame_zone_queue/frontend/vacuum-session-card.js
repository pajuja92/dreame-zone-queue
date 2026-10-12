/* Vacuum Session Card — historia CAŁYCH kolejek sprzątania (Dreame Zone
 * Queue). Jedna kolejka (start → koniec/stop/wyczyszczenie) = jeden raport:
 * lista pokoi z wynikami + mapka z zaznaczonymi strefami. Strzałki / lista
 * rozwijana przełączają między poprzednimi kolejkami.
 *
 * Konfiguracja (wszystko ustawialne w wizualnym edytorze Lovelace):
 *   type: custom:vacuum-session-card
 *   title: Historia kolejek       (opcjonalnie)
 *   map_camera: camera.xxx_map    (opcjonalnie — domyślnie camera.<robot>_map)
 *   width: 600px                  (opcjonalnie — maks. szerokość karty)
 *   compact: true                 (opcjonalnie — mniejsza czcionka/odstępy)
 *   layout: right | below         (opcjonalnie — mapa po prawej / pod listą)
 *
 * Dane: GET /api/dreame_zone_queue/history (sessions + current)
 *       GET /api/dreame_zone_queue/map_calib (przelicznik mm→px do mapki).
 */

import { TIME_CSS, breakdownHtml } from "./dzq-time.js";

const OUT = {
  done:      { label: "✓ posprzątany", color: "#2ecc71" },
  cancelled: { label: "✗ anulowany",   color: "#e74c3c" },
  skipped:   { label: "⏭ pominięty",   color: "#95a5a6" },
  error:     { label: "⚠ błąd",        color: "#e67e22" },
  active:    { label: "▶ w trakcie",   color: "#3498db" },
};

const fmtD = (ts) => new Date(ts * 1000).toLocaleDateString("pl-PL",
  { day: "2-digit", month: "2-digit" });
const fmtT = (ts) => new Date(ts * 1000).toLocaleTimeString("pl-PL",
  { hour: "2-digit", minute: "2-digit" });
const fmtMin = (sec) => {
  const min = Math.round((sec || 0) / 60);
  if (min < 1) return `${sec || 0} s`;
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

class VacuumSessionCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._idx = 0; // 0 = najnowsza kolejka
    if (this._built) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._built = true;
      this.attachShadow({ mode: "open" });
      this._render();
    }
    const now = Date.now();
    if (!this._lastFetch || now - this._lastFetch > 30000) this._fetch();
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return { title: "Historia kolejek" };
  }

  async _fetch() {
    if (!this._hass) return;
    this._lastFetch = Date.now();
    try {
      const [h, mc] = await Promise.all([
        this._hass.callApi("get", "dreame_zone_queue/history"),
        this._hass.callApi("get", "dreame_zone_queue/map_calib"),
      ]);
      this._sessions = (h.sessions || []).slice().reverse(); // najnowsza pierwsza
      this._current = h.current || null;
      this._calib = mc.calib || null;
      this._vac = mc.vacuum_entity || "";
      this._error = null;
    } catch (e) {
      this._error = String(e);
    }
    if (this._idx >= (this._sessions || []).length) this._idx = 0;
    this._render();
  }

  _esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  /* przebiegi wybranej sesji + żywy wpis aktywnego pokoju (otwarta sesja) */
  _runs(sess, isNewest) {
    const runs = (sess.runs || []).slice();
    if (isNewest && sess.ended == null && this._current) {
      runs.push({ ...this._current, outcome: "active" });
    }
    return runs;
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._esc(this._config.title || "Historia kolejek");
    const sessions = this._sessions || [];
    const sess = sessions[this._idx];

    let body;
    if (this._error) {
      body = `<div class="empty">Błąd pobierania: ${this._esc(this._error)}</div>`;
    } else if (!sessions.length) {
      body = `<div class="empty">Brak zapisanych kolejek — raport powstaje
        przy każdym starcie kolejki od tej wersji.</div>`;
    } else {
      body = this._sessionHtml(sess, this._idx === 0);
    }

    const opts = sessions.map((s, i) => {
      const when = `${fmtD(s.started)} ${fmtT(s.started)}`;
      const state = s.ended == null ? " · w trakcie" : "";
      return `<option value="${i}" ${i === this._idx ? "selected" : ""}>
        ${when} · ${(s.runs || []).length} pokoi${state}</option>`;
    }).join("");

    const compact = !!this._config.compact;
    const below = this._config.layout === "below";
    const widthCss = this._config.width
      ? `max-width: ${this._esc(this._config.width)}; margin: 0 auto;` : "";
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: ${compact ? "10px 12px 12px" : "14px 16px 16px"};
                  ${widthCss} }
        .hdr { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
               margin-bottom: 10px; }
        .hdr h2 { flex: 1; margin: 0; font-size: 1.15em; font-weight: 500;
               min-width: 130px; }
        .hdr button { background: var(--secondary-background-color, #333);
               color: var(--primary-text-color); border: none; cursor: pointer;
               font: inherit; border-radius: 8px; padding: 6px 12px; }
        .hdr button:disabled { opacity: .4; cursor: default; }
        .hdr select { font: inherit; padding: 6px 8px; border-radius: 8px;
               border: 1px solid var(--divider-color);
               background: var(--card-background-color);
               color: var(--primary-text-color); max-width: 300px; }
        .cols { display: flex; gap: ${compact ? "10px" : "14px"};
               ${below ? "flex-direction: column;" : "flex-wrap: wrap;"}
               align-items: ${below ? "stretch" : "flex-start"}; }
        .list { flex: 1; min-width: ${below ? "0" : "230px"}; }
        .maps { flex: 1.3; min-width: ${below ? "0" : "260px"};
               position: relative; line-height: 0; }
        .maps img { width: 100%; border-radius: 10px; display: block; }
        .maps svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        table { width: 100%; border-collapse: collapse;
                font-size: ${compact ? ".82em" : ".92em"}; }
        td { padding: ${compact ? "4px 6px" : "6px 8px"};
             border-bottom: 1px solid var(--divider-color); }
        td.num { width: 26px; color: var(--secondary-text-color); }
        td.st { white-space: nowrap; }
        .sub { color: var(--secondary-text-color); font-size: .85em; }
        .sum { margin-top: 8px; font-size: .88em; color: var(--secondary-text-color); }
        .empty { padding: 18px 6px; color: var(--secondary-text-color); }
        .gstats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .gstats .chip { border: 1px solid var(--divider-color); border-radius: 14px;
               padding: ${compact ? "2px 8px" : "3px 10px"};
               font-size: ${compact ? ".76em" : ".82em"};
               color: var(--secondary-text-color); }
        .live { margin-bottom: 10px; padding: 8px 12px; border-radius: 10px;
               font-size: .9em; background: rgba(52,152,219,.14);
               border: 1px solid #3498db; color: var(--primary-text-color); }
        .live a { color: #3498db; }
        ${TIME_CSS}
        .time { margin-top: 10px; }
        .time b { font-size: .85em; font-weight: 600; }
        .nomap { padding: 12px; color: var(--secondary-text-color); font-size: .88em;
               border: 1px dashed var(--divider-color); border-radius: 10px;
               line-height: 1.5; }
      </style>
      <ha-card>
        <div class="hdr">
          <h2>${title}</h2>
          <button id="prev" ${this._idx >= sessions.length - 1 ? "disabled" : ""}
            title="starsza kolejka">‹</button>
          <select id="pick" ${sessions.length ? "" : "disabled"}>${opts}</select>
          <button id="next" ${this._idx <= 0 ? "disabled" : ""}
            title="nowsza kolejka">›</button>
        </div>
        ${this._globalHtml()}
        ${body}
      </ha-card>`;

    const r = this.shadowRoot;
    const clamp = (i) => Math.max(0, Math.min(i, sessions.length - 1));
    r.getElementById("prev").onclick = () => { this._idx = clamp(this._idx + 1); this._render(); };
    r.getElementById("next").onclick = () => { this._idx = clamp(this._idx - 1); this._render(); };
    r.getElementById("pick").onchange = (e) => { this._idx = clamp(Number(e.target.value)); this._render(); };
    const go = r.getElementById("golive");
    if (go) go.onclick = (e) => {
      e.preventDefault();
      const open = (this._sessions || []).findIndex((s) => s.ended == null);
      if (open >= 0) { this._idx = open; this._render(); }
    };
    const img = r.querySelector(".maps img");
    if (img) img.onload = () => this._drawZones();
    this._drawZones();
  }

  /* podsumowanie WSZYSTKICH zadan ze wszystkich kolejek + info
   * o trwajacej kolejce (widoczne takze przy przegladaniu starszych) */
  _globalHtml() {
    const sessions = this._sessions || [];
    if (!sessions.length) return "";
    const all = sessions.flatMap((s) => s.runs || []);
    const cnt = (o) => all.filter((r) => r.outcome === o).length;
    const done = cnt("done");
    const totalDur = all.reduce((a, r) => a + (r.dur || 0), 0);
    const open = sessions.find((s) => s.ended == null);
    const chip = (txt, color) =>
      `<span class="chip" ${color ? `style="color:${color}"` : ""}>${txt}</span>`;
    const chips = [
      chip(`Kolejek: ${sessions.length}`),
      chip(`Zadań: ${all.length}`),
      chip(`✓ ${done}`, OUT.done.color),
      cnt("cancelled") ? chip(`✗ ${cnt("cancelled")}`, OUT.cancelled.color) : "",
      cnt("skipped") ? chip(`⏭ ${cnt("skipped")}`, OUT.skipped.color) : "",
      cnt("error") ? chip(`⚠ ${cnt("error")}`, OUT.error.color) : "",
      all.length ? chip(`Sukces: ${Math.round(100 * done / all.length)}%`) : "",
      chip(`Łączny czas: ${fmtMin(totalDur)}`),
    ].filter(Boolean).join("");
    const live = open
      ? `<div class="live">▶ Kolejka w trakcie (od ${fmtT(open.started)})` +
        (this._current ? ` — sprząta: <b>${this._esc(this._current.room)}</b>` : "") +
        `${this._idx !== sessions.indexOf(open) && sessions.indexOf(open) >= 0
          ? ` · <a href="#" id="golive">pokaż</a>` : ""}</div>`
      : "";
    return `<div class="gstats">${chips}</div>${live}`;
  }

  _sessionHtml(sess, isNewest) {
    const runs = this._runs(sess, isNewest);
    const when = `${fmtD(sess.started)} ${fmtT(sess.started)}` +
      (sess.ended != null ? ` – ${fmtT(sess.ended)}` : " · w trakcie");
    const rows = runs.map((run, i) => {
      const o = OUT[run.outcome] || { label: run.outcome, color: "inherit" };
      const details = [
        run.pct != null ? `${run.pct}%` : null,
        fmtMin(run.dur),
        fmtT(run.ts),
        run.returns ? `powroty: ${run.returns}` : null,
      ].filter(Boolean).join(" · ");
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><b>${this._esc(run.room)}</b><br><span class="sub">${details}</span></td>
        <td class="st" style="color:${o.color}">${o.label}</td>
      </tr>`;
    }).join("");
    const done = runs.filter((r) => r.outcome === "done").length;
    const sum = `${done}/${runs.length} pokoi posprzątanych` +
      (sess.ended != null && runs.length
        ? ` · łącznie ${fmtMin(sess.ended - sess.started)}` : "");

    const camEnt = this._config.map_camera
      || ("camera." + ((this._vac || "").split(".")[1] || "") + "_map");
    const cam = this._hass && this._hass.states[camEnt];
    let map;
    if (!cam) {
      map = `<div class="nomap">Brak kamery mapy (<b>${this._esc(camEnt)}</b>) —
        ustaw <b>map_camera</b> w konfiguracji karty, aby zobaczyć strefy
        na mapie.</div>`;
    } else if (!this._calib) {
      map = `<div class="nomap">Brak kalibracji mapy — zrób ją raz w panelu
        <b>Zone Queue → 🎯 Kalibracja mapy</b>, a strefy pojawią się na mapie.</div>`;
    } else {
      map = `<img src="${cam.attributes.entity_picture || ""}" draggable="false">
        <svg></svg>`;
    }
    return `
      <div class="cols">
        <div class="list">
          <div class="sub" style="margin-bottom:6px">${when}</div>
          <table>${rows || `<tr><td class="sub">Ta kolejka nie ma jeszcze
            zakończonych pokoi.</td></tr>`}</table>
          <div class="sum">${sum}</div>
          ${sess.breakdown ? `<div class="time"><b>Gdzie poszedł czas</b>
            ${breakdownHtml(sess.breakdown)}</div>` : ""}
        </div>
        <div class="maps">${map}</div>
      </div>`;
  }

  /* strefy sesji na mapie: SVG w naturalnych px obrazu (viewBox skaluje) */
  _drawZones() {
    const r = this.shadowRoot;
    const img = r.querySelector(".maps img");
    const svg = r.querySelector(".maps svg");
    const c = this._calib;
    const sessions = this._sessions || [];
    const sess = sessions[this._idx];
    if (!img || !svg || !c || !sess || !img.naturalWidth) return;
    svg.setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    const stale = c.iw && Math.abs(c.iw - img.naturalWidth) > 1;
    const runs = this._runs(sess, this._idx === 0);
    const toPx = (mx, my) => [(mx - c.bx) / c.ax, (my - c.by) / c.ay];
    const sw = Math.max(2, img.naturalWidth / 400);
    const fs = Math.max(12, img.naturalWidth / 45);
    let html = "";
    runs.forEach((run, i) => {
      if (!run.zone) return;
      const o = OUT[run.outcome] || { color: "#888" };
      const [ax, ay] = toPx(run.zone[0], run.zone[1]);
      const [bx, by] = toPx(run.zone[2], run.zone[3]);
      const x = Math.min(ax, bx), y = Math.min(ay, by);
      const w = Math.abs(bx - ax), h = Math.abs(by - ay);
      html += `<rect x="${x}" y="${y}" width="${w}" height="${h}"
          fill="${o.color}" fill-opacity="0.22" stroke="${o.color}"
          stroke-width="${sw}" rx="${sw * 2}"/>
        <circle cx="${x + fs}" cy="${y + fs}" r="${fs * 0.85}"
          fill="${o.color}"/>
        <text x="${x + fs}" y="${y + fs}" text-anchor="middle"
          dominant-baseline="central" font-size="${fs}" font-weight="700"
          fill="#fff">${i + 1}</text>`;
    });
    if (stale) {
      html += `<text x="${img.naturalWidth / 2}" y="${fs * 1.5}"
        text-anchor="middle" font-size="${fs}" fill="#e67e22"
        font-weight="700">⚠ mapa zmieniła rozmiar od kalibracji</text>`;
    }
    svg.innerHTML = html;
  }
}

VacuumSessionCard.getConfigElement = function () {
  return document.createElement("vacuum-session-card-editor");
};

/* Wizualny edytor konfiguracji (GUI w edytorze Lovelace) */
class VacuumSessionCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    this._render();
  }
  set hass(_h) {}

  _emit() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .row > div { flex: 1; min-width: 160px; }
        label.f { display: block; font-size: .8em;
                  color: var(--secondary-text-color); margin-bottom: 3px; }
        input, select { width: 100%; box-sizing: border-box;
                  padding: 8px 10px; border-radius: 6px;
                  border: 1px solid var(--divider-color);
                  background: var(--card-background-color);
                  color: var(--primary-text-color); font: inherit; }
        .chk { display: inline-flex; align-items: center; gap: 6px;
               margin-top: 20px; cursor: pointer; }
        .hint { font-size: .78em; color: var(--secondary-text-color);
                margin-top: -6px; margin-bottom: 8px; }
      </style>
      <div class="row">
        <div>
          <label class="f">Tytuł karty</label>
          <input type="text" id="title" value="${(c.title || "").replace(/"/g, "&quot;")}">
        </div>
        <div>
          <label class="f">Maks. szerokość karty</label>
          <select id="width">
            <option value="">auto (cała dostępna)</option>
            <option value="400px">400 px</option>
            <option value="500px">500 px</option>
            <option value="600px">600 px</option>
            <option value="800px">800 px</option>
            <option value="1000px">1000 px</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label class="f">Położenie mapy</label>
          <select id="layout">
            <option value="right">po prawej (obok listy)</option>
            <option value="below">pod spodem (pod listą)</option>
          </select>
        </div>
        <div>
          <label class="f">Kamera mapy (puste = automatycznie)</label>
          <input type="text" id="cam" placeholder="camera.robot_map"
            value="${(c.map_camera || "").replace(/"/g, "&quot;")}">
        </div>
        <label class="chk"><input type="checkbox" id="compact"
          ${c.compact ? "checked" : ""}> Tryb kompaktowy</label>
      </div>
      <div class="hint">Szerokość to górny limit — na węższych ekranach karta
        i tak się dopasuje. „Po prawej" na wąskich ekranach automatycznie
        łamie się pod listę.</div>`;
    const r = this.shadowRoot;
    const width = r.getElementById("width");
    width.value = c.width || "";
    const layout = r.getElementById("layout");
    layout.value = c.layout === "below" ? "below" : "right";
    r.getElementById("title").onchange = (e) => {
      this._config.title = e.target.value || undefined;
      this._emit();
    };
    width.onchange = (e) => {
      this._config.width = e.target.value || undefined;
      this._emit();
    };
    layout.onchange = (e) => {
      this._config.layout = e.target.value === "below" ? "below" : undefined;
      this._emit();
    };
    r.getElementById("cam").onchange = (e) => {
      this._config.map_camera = e.target.value.trim() || undefined;
      this._emit();
    };
    r.getElementById("compact").onchange = (e) => {
      this._config.compact = e.target.checked || undefined;
      this._emit();
    };
  }
}

customElements.define("vacuum-session-card", VacuumSessionCard);
customElements.define("vacuum-session-card-editor", VacuumSessionCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacuum-session-card",
  name: "Vacuum Session Card",
  description: "Historia całych kolejek sprzątania z mapą (Dreame Zone Queue)",
});
