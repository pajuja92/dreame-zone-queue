/* Vacuum Insights Card — diagnostyka robota (Dreame Zone Queue):
 *  · mapa miejsc, w których robot najczęściej ma problemy (błędy, utknięcia,
 *    ręczne zatrzymania) — z pozycji robota zapisanej przy każdym incydencie,
 *  · gdzie poszedł czas kolejek (sprzątanie / ładowanie / mycie / błędy),
 *  · efektywność pokoi (m²/min, % baterii, odsetek nieudanych przebiegów),
 *  · rekomendacje: co robić ręcznie, gdzie posprzątać podłogę, Turbo, bateria.
 *
 * Konfiguracja:
 *   type: custom:vacuum-insights-card
 *   title: Diagnostyka robota     (opcjonalnie)
 *   days: 30                      (okno analizy, dni)
 *   map_camera: camera.xxx_map    (opcjonalnie — domyślnie camera.<robot>_map)
 *   manual_sweep: 0.5             (min/m² ręcznego odkurzania — do rekomendacji)
 *   manual_mop: 0.8               (min/m² ręcznego mycia podłogi)
 *
 * Dane: GET /api/dreame_zone_queue/insights
 */
import { TIME_CSS, breakdownHtml, fmtDur } from "./dzq-time.js";

const KIND = {
  error: { label: "błąd", color: "#e74c3c" },
  stuck: { label: "utknięcie", color: "#e67e22" },
  cancel: { label: "zatrzymanie", color: "#95a5a6" },
};
const REC_ICON = {
  manual: "🧹", problem_room: "⚠️", hotspot: "📍", suction: "🌀",
  battery: "🔋", time: "⏱️", consumables: "🔧",
};
const MODE = { sweeping: "odkurzanie", mopping: "mopowanie",
               sweeping_and_mopping: "odk. + mop" };
const SUCTION = { off: "—", quiet: "cichy", silent: "cichy", standard: "standard",
                  strong: "mocny", turbo: "turbo" };

class VacuumInsightsCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._days = Number(this._config.days) || 30;
    if (this._built) this._fetch();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._built = true;
      this.attachShadow({ mode: "open" });
      this._render();
    }
    if (!this._lastFetch || Date.now() - this._lastFetch > 120000) this._fetch();
  }

  getCardSize() {
    return 10;
  }

  static getStubConfig() {
    return { title: "Diagnostyka robota", days: 30 };
  }

  async _fetch() {
    if (!this._hass) return;
    this._lastFetch = Date.now();
    const q = new URLSearchParams({ days: this._days });
    if (this._config.manual_sweep) q.set("manual_sweep", this._config.manual_sweep);
    if (this._config.manual_mop) q.set("manual_mop", this._config.manual_mop);
    try {
      this._data = await this._hass.callApi("get", `dreame_zone_queue/insights?${q}`);
      this._error = null;
    } catch (e) {
      this._error = String(e);
    }
    this._render();
  }

  _esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  _render() {
    if (!this.shadowRoot) return;
    const d = this._data;
    const title = this._esc(this._config.title || "Diagnostyka robota");
    let body;
    if (this._error) body = `<div class="empty">Błąd pobierania: ${this._esc(this._error)}</div>`;
    else if (!d) body = `<div class="empty">Ładowanie…</div>`;
    else body = this._summary(d) + this._mapHtml(d) + this._recsHtml(d)
      + this._timeHtml(d) + this._effHtml(d);
    const days = [7, 30, 90].map((n) =>
      `<option value="${n}" ${n === this._days ? "selected" : ""}>${n} dni</option>`).join("");
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 14px 16px 16px; }
        .hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .hdr h2 { flex: 1; margin: 0; font-size: 1.15em; font-weight: 500; }
        select { font: inherit; padding: 5px 8px; border-radius: 8px;
                 border: 1px solid var(--divider-color);
                 background: var(--card-background-color); color: var(--primary-text-color); }
        h3 { font-size: .95em; font-weight: 600; margin: 16px 0 6px; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip { border: 1px solid var(--divider-color); border-radius: 14px;
                padding: 3px 10px; font-size: .82em; color: var(--secondary-text-color); }
        .chip b { color: var(--primary-text-color); font-weight: 600; }
        .map { position: relative; line-height: 0; max-width: 560px; }
        .map img { width: 100%; border-radius: 10px; display: block; }
        .map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        .hs { list-style: none; padding: 0; margin: 8px 0 0; font-size: .88em; }
        .hs li { padding: 6px 0; border-bottom: 1px solid var(--divider-color);
                 display: flex; gap: 8px; align-items: baseline; }
        .dot { flex: none; width: 20px; height: 20px; border-radius: 50%; color: #fff;
               font-size: 11px; font-weight: 700; display: inline-flex;
               align-items: center; justify-content: center; }
        .sub { color: var(--secondary-text-color); font-size: .88em; }
        .rec { display: flex; gap: 10px; padding: 9px 10px; margin-bottom: 6px;
               border-radius: 10px; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .rec .ic { font-size: 1.2em; line-height: 1.3; }
        .rec b { display: block; font-size: .92em; margin-bottom: 2px; }
        .rec span { font-size: .85em; color: var(--secondary-text-color); line-height: 1.4; }
        .tw { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: .84em; }
        th { text-align: left; font-weight: 500; color: var(--secondary-text-color);
             padding: 4px 6px; white-space: nowrap; }
        td { padding: 5px 6px; border-top: 1px solid var(--divider-color); white-space: nowrap; }
        td.bad { color: #e74c3c; font-weight: 600; }
        .empty, .nomap { padding: 12px; color: var(--secondary-text-color); font-size: .88em;
                 border: 1px dashed var(--divider-color); border-radius: 10px; line-height: 1.5; }
        ${TIME_CSS}
      </style>
      <ha-card>
        <div class="hdr"><h2>${title}</h2><select id="days">${days}</select></div>
        ${body}
      </ha-card>`;
    const sel = this.shadowRoot.getElementById("days");
    sel.onchange = () => { this._days = Number(sel.value); this._fetch(); };
    const img = this.shadowRoot.querySelector(".map img");
    if (img) img.onload = () => this._drawHotspots();
    this._drawHotspots();
  }

  _summary(d) {
    const b = d.breakdown || {};
    const chip = (label, val) => (val == null ? "" : `<span class="chip">${label}: <b>${val}</b></span>`);
    return `<div class="chips">
      ${chip("Kolejek", d.sessions)}
      ${chip("Posprzątane", `${d.area_m2} m²`)}
      ${chip("Sprzątanie netto", d.m2_per_hour_net != null ? `${d.m2_per_hour_net} m²/h` : null)}
      ${chip("Z ładowaniem i przerwami", d.m2_per_hour != null ? `${d.m2_per_hour} m²/h` : null)}
      ${chip("Czas pracy", b.total ? fmtDur(b.total - (b.idle || 0)) : null)}
      ${chip("Incydenty", d.incidents)}
    </div>`;
  }

  _mapHtml(d) {
    const camEnt = this._config.map_camera
      || ("camera." + ((d.vacuum_entity || "").split(".")[1] || "") + "_map");
    const cam = this._hass && this._hass.states[camEnt];
    let map;
    if (!d.hotspots.length) {
      map = `<div class="nomap">Brak zapisanych problemów z pozycją robota w tym
        okresie. Pozycja jest zapisywana przy każdym błędzie, utknięciu i ręcznym
        zatrzymaniu (od wersji 2.0.0-beta.23).</div>`;
    } else if (!cam || !d.calib) {
      map = `<div class="nomap">${!cam ? `Brak kamery mapy <b>${this._esc(camEnt)}</b> — ustaw
        <b>map_camera</b>.` : "Brak kalibracji mapy — zrób ją w panelu <b>Zone Queue</b>."}
        Miejsca problemów są niżej jako lista.</div>`;
    } else {
      map = `<div class="map"><img src="${cam.attributes.entity_picture || ""}"
        draggable="false"><svg></svg></div>`;
    }
    const list = d.hotspots.slice(0, 8).map((h, i) => {
      const k = KIND[Object.entries(h.kinds).sort((a, b) => b[1] - a[1])[0][0]] || KIND.error;
      const why = h.reasons.map(([r, n]) => `${this._esc(r)} ×${n}`).join(", ");
      return `<li><span class="dot" style="background:${k.color}">${i + 1}</span>
        <span><b>${this._esc(h.room || "?")}</b> — ${h.n}× · ${why}<br>
        <span class="sub">${this._esc(h.hint)} · ostatnio
        ${new Date(h.last * 1000).toLocaleDateString("pl-PL")}</span></span></li>`;
    }).join("");
    return `<h3>📍 Gdzie robot ma problemy</h3>${map}${list ? `<ul class="hs">${list}</ul>` : ""}`;
  }

  /* kółka problemów: mm -> px obrazu mapy (jak strefy w karcie historii) */
  _drawHotspots() {
    const r = this.shadowRoot;
    const img = r && r.querySelector(".map img");
    const svg = r && r.querySelector(".map svg");
    const c = this._data && this._data.calib;
    if (!img || !svg || !c || !img.naturalWidth) return;
    svg.setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    const toPx = (mx, my) => [(mx - c.bx) / c.ax, (my - c.by) / c.ay];
    const unit = img.naturalWidth / 60;
    const spots = this._data.hotspots.slice(0, 8);
    const maxN = Math.max(...spots.map((h) => h.n));
    svg.innerHTML = spots.map((h, i) => {
      const [x, y] = toPx(h.pos[0], h.pos[1]);
      const k = KIND[Object.entries(h.kinds).sort((a, b) => b[1] - a[1])[0][0]] || KIND.error;
      const rad = unit * (0.8 + 1.2 * Math.sqrt(h.n / maxN));
      return `<circle cx="${x}" cy="${y}" r="${rad * 1.8}" fill="${k.color}" fill-opacity=".18"/>
        <circle cx="${x}" cy="${y}" r="${rad}" fill="${k.color}" stroke="#fff"
          stroke-width="${unit / 6}"/>
        <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
          font-size="${rad * 1.1}" font-weight="700" fill="#fff">${i + 1}</text>`;
    }).join("");
  }

  _recsHtml(d) {
    if (!d.recommendations.length) return "";
    const items = d.recommendations.map((rec) => `<div class="rec">
      <div class="ic">${REC_ICON[rec.kind] || "💡"}</div>
      <div><b>${this._esc(rec.title)}</b><span>${this._esc(rec.text)}</span></div></div>`).join("");
    return `<h3>💡 Rekomendacje</h3>${items}`;
  }

  _timeHtml(d) {
    if (!d.breakdown) return "";
    return `<h3>⏱️ Gdzie poszedł czas kolejek</h3>${breakdownHtml(d.breakdown)}`;
  }

  _effHtml(d) {
    const rows = d.efficiency.filter((e) => e.runs >= 2).map((e) => {
      const bat = e.bat_pct == null ? "—" : `${e.bat_src === "estimated" ? "~" : ""}${e.bat_pct}%`;
      return `<tr>
        <td><b>${this._esc(e.room)}</b></td>
        <td>${MODE[e.mode] || e.mode}${e.mode !== "mopping" ? ` · ${SUCTION[e.suction] || e.suction}` : ""}</td>
        <td>${e.done}/${e.runs}</td>
        <td class="${e.problem_rate >= 0.3 ? "bad" : ""}">${Math.round(e.problem_rate * 100)}%</td>
        <td>${e.active_min ?? "—"}</td>
        <td>${e.area_m2 ?? "—"}</td>
        <td>${e.m2_per_min ?? "—"}</td>
        <td>${bat}</td>
        <td>${e.dock_min || "—"}</td>
      </tr>`;
    }).join("");
    if (!rows) return "";
    return `<h3>📊 Efektywność pokoi</h3><div class="tw"><table>
      <tr><th>Pokój</th><th>Tryb</th><th>Udane</th><th>Problemy</th><th>Min</th>
        <th>m²</th><th>m²/min</th><th>Bateria</th><th>Dok min</th></tr>${rows}</table></div>
      <div class="sub" style="margin-top:6px">Min — mediana czasu pracy w pokoju (bez
      ładowania i mycia). Bateria z „~" — szacunek z czasu, do czasu zebrania
      pomiarów (od 2.0.0-beta.23). Dok min — mycie mopa / postój po pokoju.</div>`;
  }
}

customElements.define("vacuum-insights-card", VacuumInsightsCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacuum-insights-card",
  name: "Vacuum Insights",
  description: "Diagnostyka robota: miejsca problemów, efektywność, rekomendacje (Dreame Zone Queue).",
});
