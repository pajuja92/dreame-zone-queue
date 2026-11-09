// ?v= z adresu karty przechodzi na moduly pomocnicze — inaczej Cloudflare i przegladarka
// trzymaja stary plik do 4 h (max-age=14400) i karta laduje sie z nieaktualnym helperem.
// dzq-draw.js ladowany leniwie w _zoneDialog — jego blad nie wywraca calej karty.
const { esc, errMsg, mapCamera } =
  await import(`./dzq-common.js${new URL(import.meta.url).search}`);
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

// linia "robot: ..." — stan + bateria + powód postoju kolejki
const robotLine = (st, vacObj) => {
  const vs = vacObj ? vacObj.state : "?";
  let line = "robot: " + (T_STATE[vs] || vs);
  const batt = vacObj && (vacObj.attributes.battery ?? vacObj.attributes.battery_level);
  if (batt != null && batt !== "") line += ` · \u{1F50B} ${batt}%`;
  if (st.state === "paused") {
    line += ` · ⏸ ${st.attributes.paused_reason || "kolejka wstrzymana — naciśnij Kontynuuj"}`;
    const hasActive = (st.attributes.items || []).some((i) => i.status === "active");
    if (hasActive && vacObj && vacObj.attributes.running)
      line += " (robot dokończy bieżący pokój)";
  }
  return line;
};

// % ukończenia aktywnego pokoju: cleaned_area robota vs powierzchnia strefy
const activePct = (items, vacObj) => {
  const it = (items || []).find((i) => i.status === "active");
  if (!it || !vacObj) return "";
  const a = vacObj.attributes;
  const cleaned = Number(a.cleaned_area);
  if (!cleaned || !(a.zone_cleaning === true || a.running === true)) return "";
  const z = it.zone || [0, 0, 0, 0];
  const areaM2 =
    (Math.abs((z[2] - z[0]) * (z[3] - z[1])) / 1e6) * Math.max(1, it.repeats || 1);
  if (!areaM2) return "";
  const pct = Math.min(99, Math.round((100 * cleaned) / areaM2));
  return pct >= 1 ? `${pct}%` : "";
};

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
    (this._modals || new Set()).forEach((close) => close());
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    // fingerprint obejmuje tez encje odkurzacza — bateria, % pokoju i stan
    // robota maja sie odswiezac na biezaco (przez _patch, bez przebudowy)
    const vacEnt = st && st.attributes.vacuum_entity;
    const vacObj = vacEnt ? hass.states[vacEnt] : null;
    const fp = st
      ? st.last_updated + JSON.stringify(st.attributes.items) + st.state
        + (vacObj ? vacObj.last_updated : "")
      : "missing";
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
      // bez _unbusy: tyk baterii (last_updated odkurzacza) nie oznacza, ze akcja doszla
      this._patch(st);
      return;
    }
    this._unbusy();
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
    const vacObj = vac ? this._hass.states[vac] : null;
    const sub = root.querySelector(".sub");
    if (sub) sub.textContent = robotLine(st, vacObj);
    const pctEl = root.querySelector(".pct");
    if (pctEl) pctEl.textContent = activePct(items, vacObj);
  }

  // true = backend przyjal wywolanie; blad -> toast i false
  async _call(service, data = {}) {
    // guard: identyczne wywolanie w <400 ms = duplikat (log 24.07: bursty
    // remove 3-7x w kilka ms) - wysylamy raz
    const dedupKey = service + JSON.stringify(data);
    const now = Date.now();
    if (this._lastCall && this._lastCall.k === dedupKey && now - this._lastCall.t < 400) return false;
    this._lastCall = { k: dedupKey, t: now };
    // akcje kolejki: natychmiastowy feedback — przyciski gasna do czasu
    // aktualizacji stanu (albo timeoutu awaryjnego), zero podwojnych klikniec
    const busy = ["start", "pause", "skip", "stop", "clear", "dock", "finish_room"].includes(service);
    if (busy) this._markBusy();
    try {
      await this._hass.callService("dreame_zone_queue", service, data);
      return true;
    } catch (e) {
      if (busy) this._unbusy();
      this._toast("⚠ " + errMsg(e));
      return false;
    }
  }
  _markBusy() {
    const root = this.shadowRoot;
    if (!root) return;
    root.querySelectorAll(".actions .btn").forEach((b) => {
      b.disabled = true;
      b.classList.add("busy");
    });
    clearTimeout(this._busyT);
    this._busyT = setTimeout(() => this._unbusy(), 5000);
  }
  _unbusy() {
    clearTimeout(this._busyT);
    const root = this.shadowRoot;
    if (!root) return;
    root.querySelectorAll(".actions .btn.busy").forEach((b) => {
      b.disabled = false;
      b.classList.remove("busy");
    });
  }

  // Modale zyja w document.body (poza shadow DOM) — re-render karty w trakcie
  // pisania nie moze ich zniszczyc. Zamykane: tlo, Escape, odpiecie karty.
  _openModal(cls, boxCss) {
    if (document.querySelector("." + cls)) return null;
    const wrap = document.createElement("div");
    wrap.className = cls;
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:16px;";
    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--card-background-color,#1c1c1e);color:var(--primary-text-color,#fff);" +
      "border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);" + boxCss;
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    if (!this._modals) this._modals = new Set();
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const close = () => {
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      this._modals.delete(close);
    };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    this._modals.add(close);
    return { wrap, box, close };
  }

  /* Podglad wlasnej strefy: mapa z kamery + prostokat wycinka (tylko odczyt). */
  async _zonePreview(id) {
    const st = this._hass.states[this._config.entity];
    const attrs = (st && st.attributes) || {};
    const it = (attrs.items || []).find((i) => i.id === id);
    if (!it || !it.zone) return;
    let draw_;
    try {
      draw_ = await import(`./dzq-draw.js${new URL(import.meta.url).search}`);
    } catch (e) {
      this._toast("⚠ Nie udało się wczytać mapy: " + errMsg(e));
      return;
    }
    const m = this._openModal("dzq-zprev-modal",
      "padding:18px;width:min(760px,100%);max-height:92vh;" +
      "display:flex;flex-direction:column;gap:10px;overflow:auto;");
    if (!m) return;
    const { box, close } = m;
    const camEnt = mapCamera(this._config, attrs.vacuum_entity);
    const cam = this._hass.states[camEnt];
    const [x1, y1, x2, y2] = it.zone;
    const size = `${(Math.abs(x2 - x1) / 1000).toFixed(1)} × ${(Math.abs(y2 - y1) / 1000).toFixed(1)} m`;
    const mode = it.water === "off" ? "samo odkurzanie"
      : it.suction === "off" ? "samo mycie" : "odkurzanie + mycie";
    box.innerHTML = `
      <h3 style="margin:0;font-size:1.05em">▭ ${esc(it.room)}</h3>
      <div style="font-size:.9em;color:var(--secondary-text-color)">${esc(size)} · ${esc(mode)}
        · ssanie: ${esc(T_SUCTION[it.suction] || it.suction)} · mop: ${esc(T_WATER[it.water] || it.water)}
        · ${esc(it.repeats)}× · [${it.zone.map((v) => esc(v)).join(", ")}]</div>
      ${cam ? `<div style="position:relative;line-height:0;border-radius:10px;overflow:hidden">
        <img class="pimg" src="${esc(cam.attributes.entity_picture || "")}" style="width:100%;display:block">
        <svg class="psvg" style="position:absolute;inset:0;width:100%;height:100%" preserveAspectRatio="none"></svg>
      </div>` : `<div>Brak kamery mapy (<code>${esc(camEnt)}</code>).</div>`}
      <div class="pnote" style="font-size:.85em;color:var(--secondary-text-color)"></div>
      <div style="display:flex;justify-content:flex-end">
        <button data-x="close" style="font:inherit;padding:8px 14px;border-radius:10px;border:none;cursor:pointer;background:var(--secondary-background-color,#333);color:inherit">Zamknij</button>
      </div>`;
    box.querySelector('[data-x="close"]').onclick = close;
    if (!cam) return;
    const img = box.querySelector(".pimg");
    const draw = () => {
      if (!img.naturalWidth) return;
      // kamera po zaladowaniu obrazka ma aktualne calibration_points
      const c = this._hass.states[camEnt];
      const calib = draw_.calibFromCamera(c && c.attributes.calibration_points) || attrs.map_calib;
      const note = box.querySelector(".pnote");
      if (!calib) { note.textContent = "Brak kalibracji mapy — nie mogę narysować strefy."; return; }
      const toPx = draw_.mmToPx(calib);
      const [ax, ay] = toPx(x1, y1), [bx, by] = toPx(x2, y2);
      const svg = box.querySelector(".psvg");
      svg.setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
      svg.innerHTML = `<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}"
        width="${Math.abs(bx - ax)}" height="${Math.abs(by - ay)}" fill="rgba(255,152,0,.25)"
        stroke="#ff9800" stroke-width="3"/>`;
      note.textContent = calib.src === "camera" ? "" : "Pozycja wg ręcznej kalibracji mapy.";
    };
    img.onload = () => { draw(); setTimeout(draw, 1500); };
    if (img.complete) draw();
  }

  _noteDialog() {
    const m = this._openModal("dzq-note-modal", "padding:20px;width:min(480px,100%);");
    if (!m) return;
    const { box, close } = m;
    box.innerHTML =
      `<h3 style="margin:0 0 10px;font-size:1.05em">\u{1F4DD} Notatka do dziennika feedbacku</h3>
       <textarea rows="5" placeholder="Co się właśnie stało? (zapiszę to razem z pełnym stanem robota i kolejki)"
         style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;padding:10px;
         border-radius:10px;border:1px solid var(--divider-color,#444);
         background:var(--primary-background-color,#111);color:inherit"></textarea>
       <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
         <button data-x="cancel" style="font:inherit;padding:9px 16px;border-radius:10px;border:none;cursor:pointer;
           background:var(--secondary-background-color,#333);color:inherit">Anuluj</button>
         <button data-x="save" style="font:inherit;font-weight:600;padding:9px 16px;border-radius:10px;border:none;cursor:pointer;
           background:var(--primary-color,#03a9f4);color:#fff">Zapisz</button>
       </div>`;
    const ta = box.querySelector("textarea");
    ta.focus();
    box.querySelector('[data-x="cancel"]').onclick = close;
    box.querySelector('[data-x="save"]').onclick = async () => {
      const t = ta.value.trim();
      if (!t) { ta.focus(); return; }
      // zamkniecie dopiero po odpowiedzi backendu — przy bledzie tekst zostaje
      if (!(await this._call("note", { text: t }))) return;
      close();
      this._toast("✓ Notatka zapisana w dzienniku feedbacku");
    };
  }
  async _historyModal(room) {
    const m = this._openModal("dzq-hist-modal",
      "padding:20px;width:min(680px,100%);max-height:85vh;display:flex;flex-direction:column;");
    if (!m) return;
    const { box, close } = m;
    box.innerHTML =
      `<h3 style="margin:0 0 10px;font-size:1.05em">\u{1F552} Historia sprz\u0105tania: ${esc(room)}</h3>
       <div class="hbody" style="overflow:auto;min-height:60px">\u0141adowanie\u2026</div>
       <div style="display:flex;justify-content:flex-end;margin-top:14px">
         <button data-x="close" style="font:inherit;padding:9px 16px;border-radius:10px;border:none;cursor:pointer;
           background:var(--secondary-background-color,#333);color:inherit">Zamknij</button>
       </div>`;
    box.querySelector('[data-x="close"]').onclick = close;
    const body = box.querySelector(".hbody");
    try {
      const data = await this._hass.callApi("get", "dreame_zone_queue/history");
      const all = (((data || {}).history || {})[room] || []).slice();
      const cur = (data || {}).current;
      if (cur && cur.room === room) all.push(cur); // trwajace sprzatanie na zywo
      const runs = all.reverse();
      if (!runs.length) {
        body.innerHTML = "Brak zapisanej historii dla tego pokoju \u2014 " +
          "zbiera si\u0119 od wersji 2.0.0-beta.9 przy ka\u017cdym sprz\u0105taniu.";
        return;
      }
      const OUT = { done: "\u2713 sukces", cancelled: "\u2715 anulowane",
        skipped: "\u23ED pomini\u0119te", error: "\u26A0 b\u0142\u0105d",
        active: "\u25B6 w trakcie" };
      const OUTC = { done: "var(--success-color,#0a2)", cancelled: "var(--error-color,#d33)",
        skipped: "var(--secondary-text-color)", error: "var(--error-color,#d33)",
        active: "var(--primary-color,#03a9f4)" };
      const fmtMin = (sec) => {
        const min = Math.round((sec || 0) / 60);
        return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
      };
      const rows = runs.map((r) => {
        const d = new Date(r.ts * 1000);
        return `<tr>
          <td>${d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}</td>
          <td>${d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</td>
          <td>${r.pct != null ? r.pct + "%" : "\u2014"}</td>
          <td>${fmtMin(r.dur)}</td>
          <td>${esc(T_SUCTION[r.suction] || r.suction || "\u2014")}</td>
          <td>${esc(T_WATER[r.water] || r.water || "\u2014")}</td>
          <td style="color:${OUTC[r.outcome] || "inherit"}">${esc(OUT[r.outcome] || r.outcome)}</td>
          <td>${esc(r.returns || 0)}</td>
          <td>${((r.events || []).map((e) =>
            `${esc(e.reason)} (${e.dur < 60 ? esc(e.dur) + " s" : fmtMin(e.dur)})`)
            .join(", ")) || "\u2014"}</td>
        </tr>`;
      }).join("");
      body.innerHTML =
        `<table style="width:100%;border-collapse:collapse;font-size:.9em">
          <tr>${["Data", "Godz.", "%", "Czas", "Ssanie", "Mop", "Wynik", "Powroty", "Uwagi"]
            .map((h) => `<th style="text-align:left;font-size:.78em;text-transform:uppercase;color:var(--secondary-text-color);padding:4px 8px;border-bottom:1px solid var(--divider-color,#444)">${h}</th>`).join("")}</tr>
          ${rows}
        </table>
        <div style="margin-top:8px;font-size:.8em;color:var(--secondary-text-color)">${runs.length} przebieg\u00f3w (max 100)</div>`;
      body.querySelectorAll("td").forEach((td) => {
        td.style.padding = "5px 8px";
        td.style.borderBottom = "1px solid var(--divider-color,#333)";
      });
    } catch (e) {
      body.textContent = "B\u0142\u0105d pobierania historii: " + errMsg(e);
    }
  }
  /* Modal "Wlasna strefa": rysowanie jednorazowej powierzchni na mapie.
   * Przelicznik px->mm bierzemy z `calibration_points` kamery (aktualny dla
   * kazdego renderu mapy). Tylko gdy kamera ich nie ma: reczna kalibracja
   * (obrysowanie znanego pokoju, potwierdzana przyciskiem), zapisywana
   * w Store integracji i ponawiana po zmianie rozmiaru mapy. */
  async _zoneDialog() {
    let draw_;
    try {
      draw_ = await import(`./dzq-draw.js${new URL(import.meta.url).search}`);
    } catch (e) {
      this._toast("⚠ Nie udało się wczytać edytora mapy: " + errMsg(e));
      return;
    }
    const { attachDraw, defaultMode, calibFromCamera, mmToPx, roomOf } = draw_;
    const m = this._openModal("dzq-zone-modal",
      "padding:18px;width:min(760px,100%);max-height:92vh;" +
      "display:flex;flex-direction:column;gap:10px;overflow:auto;");
    if (!m) return;
    const { wrap, box, close } = m;
    const hass = this._hass;
    const st = hass.states[this._config.entity];
    const attrs = (st && st.attributes) || {};
    const camEnt = mapCamera(this._config, attrs.vacuum_entity);
    const cam = hass.states[camEnt];
    let camCalib = cam ? calibFromCamera(cam.attributes.calibration_points) : null;
    let calib = camCalib || attrs.map_calib || null;
    // faza okna (kalibracja / rysowanie) — spozniony tik z poprzedniej fazy
    // nie moze przerysowac okna (skasowalby narysowana strefe)
    let phase = 0;
    // Po restarcie HA calibration_points = None, dopoki ktos nie pobierze
    // obrazka mapy — po zaladowaniu mapy w oknie czekamy na atrybut do ~5 s.
    const waitCamCalib = (done) => {
      const my = phase;
      let n = 0;
      const tick = () => {
        if (my !== phase || !wrap.isConnected) return;
        const c = this._hass.states[camEnt];
        camCalib = c ? calibFromCamera(c.attributes.calibration_points) : null;
        if (camCalib) { calib = camCalib; done(true); }
        else if (++n < 5) setTimeout(tick, 1000);
        else done(false);
      };
      tick();
    };
    const zones = attrs.room_zones || {};
    const roomNames = Object.keys(zones).sort();

    const selCss = "font:inherit;padding:6px 8px;border-radius:8px;" +
      "border:1px solid var(--divider-color,#444);" +
      "background:var(--primary-background-color,#111);color:inherit";
    const btnCss = "font:inherit;padding:8px 14px;border-radius:10px;border:none;cursor:pointer;";
    const btnOn = `${btnCss}background:var(--primary-color,#03a9f4);color:#fff`;
    const btnOff = `${btnCss}background:var(--secondary-background-color,#333);color:inherit`;
    const pic = esc(cam ? (cam.attributes.entity_picture || "") : "");
    const mapBlock = `
      <div class="zwrap" style="position:relative;user-select:none;touch-action:none;line-height:0;overflow:hidden;border-radius:10px">
        <img class="zimg" src="${pic}" draggable="false" style="width:100%;display:block">
        <svg class="zsvg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg>
      </div>`;
    const wireClose = () => {
      const b = box.querySelector('[data-x="close"]');
      if (b) b.onclick = close;
    };
    const staleFor = (img) =>
      !camCalib && calib && img.naturalWidth && calib.iw &&
      Math.abs(calib.iw - img.naturalWidth) > 1;

    if (!cam) {
      box.innerHTML = `<h3 style="margin:0">▭ Własna strefa</h3>
        <div style="line-height:1.5">Nie znalazłem kamery mapy
        (<code>${esc(camEnt)}</code>). Ustaw <code>map_camera</code>
        w konfiguracji karty.</div>
        <div style="display:flex;justify-content:flex-end">
        <button data-x="close" style="${btnOff}">Zamknij</button></div>`;
      wireClose();
      return;
    }

    /* ---------- FAZA 1: kalibracja (pierwsze uzycie / zmiana mapy) ------ */
    // Wyglada inaczej niz rysowanie strefy (pomaranczowa rama + baner), zeby
    // nie dalo sie jej pomylic. Gdy jest poprzednia kalibracja, jej pokoje
    // sa obrysowane na mapie — wystarczy potwierdzic albo obrysowac od nowa.
    const CAL = "var(--warning-color,#ff9800)";
    const renderCalib = (note) => {
      phase++;
      box.style.border = `3px solid ${CAL}`;
      // reczna kalibracja niemozliwa (brak pokoi / backend da 403 nie-adminowi):
      // pokaz mape — jej pobranie wyzwala calibration_points kamery
      const blocked = !roomNames.length
        ? `Brak zdefiniowanych pokoi ze strefami — ręczna kalibracja potrzebuje
           jednego znanego pokoju (opcje integracji).`
        : !(hass.user && hass.user.is_admin)
          ? `Ręczną kalibrację mapy może wykonać tylko <b>administrator</b>
             (to okno na jego koncie albo opcje integracji → Kalibracja mapy).`
          : "";
      if (blocked) {
        box.innerHTML = `<h3 style="margin:0">🎯 Kalibracja mapy</h3>
          <div style="line-height:1.5">${blocked} Czekam jeszcze na przelicznik
          z kamery robota…</div>
          ${mapBlock}
          <div style="display:flex;justify-content:flex-end">
          <button data-x="close" style="${btnOff}">Zamknij</button></div>`;
        wireClose();
        box.querySelector(".zimg").onload = () => waitCamCalib((ok) => {
          if (!ok) return;
          this._toast("✓ Mapa skalibrowana automatycznie (kamera robota)");
          renderDraw();
        });
        return;
      }
      const prev = calib;   // poprzednia kalibracja (reczna) albo null
      box.innerHTML = `
        <div style="margin:-18px -18px 0;padding:10px 18px;background:${CAL};color:#000;
          font-weight:700;border-radius:13px 13px 0 0;letter-spacing:.02em">
          🎯 TRYB KALIBRACJI MAPY — to nie jest dodawanie strefy</div>
        ${note ? `<div style="font-size:.9em;color:${CAL}">${note}</div>` : ""}
        <div style="font-size:.9em;line-height:1.5;color:var(--secondary-text-color)">
          ${prev
            ? `Pomarańczowe obrysy = pokoje wg <b>ostatniej kalibracji</b>.
               Pasują do mapy? Zatwierdź. Nie pasują? Wybierz pokój i obrysuj go od nowa.`
            : `Wybierz pokój, którego położenie znasz, i obrysuj go na mapie,
               potem zatwierdź. Przelicznik zapisze się w integracji.`}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.9em">
          <select class="croom" style="${selCss}">${roomNames.map((r) =>
            `<option>${esc(r)}</option>`).join("")}</select>
          <button data-x="crect" style="${btnOn}">▭ Prostokąt</button>
          <button data-x="cpoly" style="${btnOff}">△ Punkty</button>
          <button data-x="cundo" style="${btnOff};display:none">↩ Cofnij</button>
          <button data-x="cdone" style="${btnOn};display:none">✓ Zakończ</button>
        </div>
        <div style="outline:3px dashed ${CAL};outline-offset:2px;border-radius:10px">${mapBlock}</div>
        <div class="chint" style="font-size:.88em;color:var(--secondary-text-color)">
          Obrysuj: <b></b> · dwa palce / kółko = zoom i przesuwanie</div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button data-x="close" style="${btnOff}">Anuluj</button>
          <button data-x="csave" style="${btnCss}font-weight:600;background:${CAL};color:#000"></button>
        </div>`;
      wireClose();
      const img = box.querySelector(".zimg");
      const zwrap = box.querySelector(".zwrap");
      const roomSel = box.querySelector(".croom");
      const hintRoom = box.querySelector(".chint b");
      const saveBtn = box.querySelector('[data-x="csave"]');
      const toNat = (x, y) => {
        const f = img.naturalWidth / img.clientWidth;
        return [x * f, y * f];
      };
      // obszar czeka na „Zatwierdź" — przeciagniecie niczego nie zapisuje
      let picked = null;   // [nL, nT, nR, nB] w naturalnych px
      const setPicked = (b) => {
        picked = b;
        const ok = !!(b || prev);
        saveBtn.disabled = !ok;
        saveBtn.style.opacity = ok ? "1" : ".5";
        saveBtn.textContent = b ? "✓ Zatwierdź nowy obszar"
          : prev ? "✓ Ostatnia kalibracja pasuje" : "✓ Zatwierdź obszar";
      };
      // pokoje rzutowane przez poprzednia kalibracje (mm -> px wyswietlane)
      const underlay = (scale) => {
        if (!prev || !img.naturalWidth || !img.clientWidth) return "";
        const f = img.clientWidth / img.naturalWidth;
        const toPx = mmToPx(prev);
        const px = (x, y) => toPx(x, y).map((v) => v * f);
        return roomNames.map((n) => {
          const z = zones[n];
          const [x1, y1] = px(z[0], z[1]), [x2, y2] = px(z[2], z[3]);
          const L = Math.min(x1, x2), T = Math.min(y1, y2);
          const sel = n === roomSel.value;
          return `<rect x="${L}" y="${T}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"
              fill="${sel ? "rgba(255,152,0,.15)" : "none"}" stroke="#ff9800"
              stroke-width="${(sel ? 2.5 : 1.2) / scale}" stroke-dasharray="${6 / scale} ${4 / scale}"/>
            <text x="${L + 4 / scale}" y="${T + 13 / scale}" font-size="${11 / scale}"
              fill="#ff9800" font-weight="${sel ? 700 : 400}">${esc(n)}</text>`;
        }).join("");
      };
      const draw = attachDraw(zwrap, img, box.querySelector(".zsvg"), {
        underlay,
        shape: (sh) => {
          const nat = sh.pts.map((p) => toNat(p[0], p[1]));
          const nL = Math.min(...nat.map((p) => p[0]));
          const nR = Math.max(...nat.map((p) => p[0]));
          const nT = Math.min(...nat.map((p) => p[1]));
          const nB = Math.max(...nat.map((p) => p[1]));
          setPicked(nR - nL < 8 || nB - nT < 8 ? null : [nL, nT, nR, nB]);
        },
        progress: () => setPicked(null),
      });
      img.onload = () => {
        draw.redraw();
        waitCamCalib((ok) => {
          if (!ok) return;
          this._toast("✓ Mapa skalibrowana automatycznie (kamera robota)");
          renderDraw();
        });
      };
      hintRoom.textContent = roomSel.value;
      roomSel.onchange = () => { hintRoom.textContent = roomSel.value; draw.redraw(); };
      saveBtn.onclick = async () => {
        let nc;
        if (picked) {
          const z = zones[roomSel.value];
          if (!z) return;
          const [nL, nT, nR, nB] = picked;
          const vxmin = Math.min(z[0], z[2]), vxmax = Math.max(z[0], z[2]);
          const vymin = Math.min(z[1], z[3]), vymax = Math.max(z[1], z[3]);
          // os Y odkurzacza rosnie do gory ekranu (Dreame) -> flip
          const ax = (vxmax - vxmin) / (nR - nL);
          const ay = (vymin - vymax) / (nB - nT);
          nc = { ax, bx: vxmin - ax * nL, ay, by: vymax - ay * nT };
        } else if (prev) {
          nc = { ax: prev.ax, bx: prev.bx, ay: prev.ay, by: prev.by };
        } else return;
        nc.iw = img.naturalWidth;
        nc.ih = img.naturalHeight;
        try {
          await hass.callApi("post", "dreame_zone_queue/map_calib", { calib: nc });
          calib = nc;
          this._toast("✓ Kalibracja zapisana");
          renderDraw();
        } catch (err) {
          this._toast("Błąd zapisu kalibracji: " + errMsg(err));
        }
      };
      const mr = box.querySelector('[data-x="crect"]');
      const mp = box.querySelector('[data-x="cpoly"]');
      const mu = box.querySelector('[data-x="cundo"]');
      const md = box.querySelector('[data-x="cdone"]');
      const setMode = (m) => {
        draw.setMode(m);
        mr.style.cssText = m === "rect" ? btnOn : btnOff;
        mp.style.cssText = m === "poly" ? btnOn : btnOff;
        mu.style.display = m === "poly" ? "" : "none";
        md.style.display = m === "poly" ? "" : "none";
      };
      mr.onclick = () => setMode("rect");
      mp.onclick = () => setMode("poly");
      mu.onclick = () => draw.undo();
      md.onclick = () => {
        if (!draw.finish()) this._toast("Wielokąt wymaga min. 3 punktów");
      };
      zwrap.addEventListener("dblclick", () => {
        if (draw.getMode() === "poly") md.onclick();
      });
      setMode(defaultMode());
    };

    /* ---------- FAZA 2: rysowanie strefy ------------------------------- */
    const renderDraw = () => {
      phase++;
      box.style.border = "";
      box.innerHTML = `
        <h3 style="margin:0;font-size:1.05em;display:flex;align-items:center;gap:8px">
          ▭ Własna strefa — narysuj na mapie
          <button data-x="help" title="Co zrobić, gdy mapa się rozkalibruje?"
            style="font:inherit;width:24px;height:24px;border-radius:50%;border:1px solid var(--divider-color,#444);
            background:none;color:var(--secondary-text-color);cursor:pointer;line-height:1">?</button>
        </h3>
        <div class="zhelp" style="display:none;font-size:.88em;line-height:1.55;padding:10px 12px;
          border-radius:10px;background:var(--secondary-background-color,rgba(127,127,127,.15))">
          ${camCalib ? `Przelicznik mapy pochodzi z kamery robota
          (<code>calibration_points</code>) i aktualizuje się sam — ręczna
          kalibracja nie jest potrzebna.` : `<b>Mapa się rozkalibrowała?</b>
          (strefy trafiają obok narysowanego miejsca) → Ustawienia → Urządzenia
          i usługi → <b>Dreame Zone Queue</b> → ⚙ Konfiguruj → <b>Kalibracja
          mapy</b> → zaznacz „Wyczyść kalibrację". Gdy robot zmieni rozmiar
          mapy, to okno samo pokaże ostatnią kalibrację do potwierdzenia.`}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.9em">
          <button data-x="mrect" style="${btnOn}">▭ Prostokąt</button>
          <button data-x="mpoly" style="${btnOff}">△ Wielokąt</button>
          <button data-x="mundo" style="${btnOff};display:none">↩ Cofnij punkt</button>
          <button data-x="mclear" style="${btnOff}">Wyczyść</button>
          <span class="zhint" style="color:var(--secondary-text-color)"></span>
        </div>
        ${mapBlock}
        <div class="zinfo" style="font-size:.9em;color:var(--secondary-text-color)"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="zname" placeholder="Nazwa (np. Pod stołem)" style="${selCss};flex:1;min-width:120px">
          <select class="zsuction" style="${selCss}">${SUCTION.map((o) =>
            `<option value="${o}" ${o === "standard" ? "selected" : ""}>Ssanie: ${T_SUCTION[o] || o}</option>`).join("")}</select>
          <select class="zwater" style="${selCss}">${WATER.map((o) =>
            `<option value="${o}">Mop: ${T_WATER[o] || o}</option>`).join("")}</select>
          <select class="zrepeats" style="${selCss}">${REPEATS.map((o) =>
            `<option value="${o}">${o}×</option>`).join("")}</select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button data-x="close" style="${btnOff}">Anuluj</button>
          <button data-x="done" style="${btnOff};display:none">✓ Zakończ kształt</button>
          <button data-x="ok" disabled style="${btnCss}font-weight:600;background:var(--primary-color,#03a9f4);color:#fff;opacity:.5">+ Dodaj do kolejki</button>
        </div>`;
      wireClose();
      box.querySelector('[data-x="help"]').onclick = () => {
        const h = box.querySelector(".zhelp");
        h.style.display = h.style.display === "none" ? "" : "none";
      };

      const img = box.querySelector(".zimg");
      const zwrap = box.querySelector(".zwrap");
      const info = box.querySelector(".zinfo");
      const hint = box.querySelector(".zhint");
      const okBtn = box.querySelector('[data-x="ok"]');
      const doneBtn = box.querySelector('[data-x="done"]');
      const mrect = box.querySelector('[data-x="mrect"]');
      const mpoly = box.querySelector('[data-x="mpoly"]');
      const undoBtn = box.querySelector('[data-x="mundo"]');
      let zoneMm = null;

      img.onload = () => waitCamCalib(() => {
        if (staleFor(img)) {
          renderCalib("Mapa zmieniła rozmiar od ostatniej kalibracji — " +
            "sprawdź, czy obrysy pokoi nadal pasują.");
        }
      });
      const toNat = (x, y) => {
        const f = img.naturalWidth / img.clientWidth;
        return [x * f, y * f];
      };
      const toMm = (nx, ny) => {
        const r = (v) => Math.round(v / 10) * 10;
        // axy/ayx tylko w kalibracji z kamery (obrot mapy); reczna ich nie ma
        return [r(calib.ax * nx + (calib.axy || 0) * ny + calib.bx),
                r((calib.ayx || 0) * nx + calib.ay * ny + calib.by)];
      };
      const bboxToMm = (dispPts) => {
        const mm = dispPts.map((p) => toMm(...toNat(p[0], p[1])));
        const xs = mm.map((p) => p[0]), ys = mm.map((p) => p[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      };
      const acceptZone = (z, note) => {
        const wMm = z[2] - z[0], hMm = z[3] - z[1];
        if (wMm < 120 || hMm < 120) {
          info.textContent = "⚠ Strefa za mała (min 120 mm na bok) — narysuj większą.";
          zoneMm = null;
          okBtn.disabled = true;
          okBtn.style.opacity = ".5";
          return;
        }
        zoneMm = z;
        const inRoom = roomOf(z, zones);
        info.textContent = (inRoom ? `${inRoom} · ` : "") + `strefa [${z.join(", ")}] · ` +
          `${(wMm / 1000).toFixed(1)} × ${(hMm / 1000).toFixed(1)} m${note || ""}`;
        okBtn.disabled = false;
        okBtn.style.opacity = "1";
      };
      const draw = attachDraw(zwrap, img, box.querySelector(".zsvg"), {
        shape: (sh) => acceptZone(bboxToMm(sh.pts),
          sh.kind === "poly" ? " · (prostokąt obejmujący wielokąt)" : ""),
        progress: (n) => {
          if (draw && draw.getMode() === "poly" && n > 0 && n < 3) {
            info.textContent = `Punkty: ${n}/3 (minimum)`;
          }
        },
      });
      const setMode = (m) => {
        draw.setMode(m);
        zoneMm = null;
        info.textContent = "";
        okBtn.disabled = true;
        okBtn.style.opacity = ".5";
        mrect.style.cssText = m === "rect" ? btnOn : btnOff;
        mpoly.style.cssText = m === "poly" ? btnOn : btnOff;
        doneBtn.style.display = m === "poly" ? "" : "none";
        undoBtn.style.display = m === "poly" ? "" : "none";
        hint.textContent = (m === "rect"
          ? "Przeciągnij prostokąt po mapie."
          : "Tapnij narożniki (min. 3), potem „Zakończ kształt”.") +
          " Dwa palce / kółko = zoom.";
      };
      mrect.onclick = () => setMode("rect");
      mpoly.onclick = () => setMode("poly");
      undoBtn.onclick = () => draw.undo();
      box.querySelector('[data-x="mclear"]').onclick = () => {
        draw.clear();
        zoneMm = null;
        info.textContent = "";
        okBtn.disabled = true;
        okBtn.style.opacity = ".5";
      };
      doneBtn.onclick = () => {
        if (!draw.finish()) info.textContent = "⚠ Wielokąt wymaga min. 3 punktów.";
      };
      zwrap.addEventListener("dblclick", () => {
        if (draw.getMode() === "poly") doneBtn.onclick();
      });
      setMode(defaultMode());

      okBtn.onclick = async () => {
        if (!zoneMm || okBtn.disabled) return;
        okBtn.disabled = true;
        const ok = await this._call("add", {
          room: ((r, n) => r ? `${r} · ${n || "strefa"}` : (n || "Strefa"))(
            roomOf(zoneMm, zones), box.querySelector(".zname").value.trim()),
          zone: zoneMm,
          suction: box.querySelector(".zsuction").value,
          water: box.querySelector(".zwater").value,
          repeats: Number(box.querySelector(".zrepeats").value),
        });
        // blad: _call pokazal toast, okno zostaje z narysowana strefa
        if (!ok) { okBtn.disabled = !zoneMm; return; }
        close();
        this._toast("✓ Strefa dodana do kolejki");
      };
    };

    if (!calib) renderCalib();
    else renderDraw();
  }
  _toast(msg) {
    document.querySelectorAll(".dzq-toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "dzq-toast";
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:9999;" +
      "background:var(--primary-color,#03a9f4);color:#fff;padding:12px 20px;" +
      "border-radius:999px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.4);";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
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
        esc(c.entity) + "</div></ha-card>";
      this._restoreScroll(scrolls);
      return;
    }
    // integracja wylaczona / w trakcie przeladowania — nie udawaj pustej kolejki
    if (st.state === "unavailable" || st.state === "unknown") {
      this.shadowRoot.innerHTML =
        `<ha-card><div style="padding:16px">${c.show_header ? `<b>${esc(c.title)}</b><br>` : ""}
        <span style="color:var(--secondary-text-color)">\u26A0 Integracja niedost\u0119pna
        (${esc(st.state)}) — sprawd\u017A Dreame Zone Queue w Ustawienia \u2192 Urz\u0105dzenia i us\u0142ugi.</span></div></ha-card>`;
      this._restoreScroll(scrolls);
      return;
    }
    const items = st.attributes.items || [];
    const rooms = st.attributes.rooms || [];
    const roomIcons = st.attributes.room_icons || {};
    const ric = (name, own) => {
      const i = own || roomIcons[name] || "";
      // ikony pokoi to emoji; mdi:* (np. własna strefa) renderuje ha-icon
      if (i.startsWith("mdi:")) return `<ha-icon icon="${esc(i)}" style="--mdc-icon-size:1.1em;opacity:.8"></ha-icon> `;
      return i ? esc(i) + " " : "";
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
    const vacObj = vac ? this._hass.states[vac] : null;

    const sel = (opts, cur, cls, id, labels, suffix = "") =>
      `<select class="${cls}" data-id="${id}">` +
      opts.map((o) => `<option value="${o}" ${String(o) === String(cur) ? "selected" : ""}>${esc((labels && labels[o]) || o)}${suffix}</option>`).join("") +
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
      const hist = `<button class="ib hist" data-room="${esc(it.room)}"
                    title="Historia sprz\u0105tania">\u{1F552}</button>`;
      const ctl = ro ? hist : pending
        ? (c.grip_position === "buttons" ? gripBtn : "") + arrows + hist + del
        : hist + del;
      const gripCell = `<td class="gripc">${pending && !ro && c.grip_position !== "buttons" ? gripBtn : ""}</td>`;
      const editable = !ro && (pending || active);
      const suctionOpts = SUCTION;
      const waterOpts = WATER;
      const slim = ro || !c.show_arrows;
      return `<tr class="${esc(it.status)}${slim ? " slim" : ""}" data-id="${it.id}" ${pending && !ro ? 'draggable="true"' : ""}>
        ${gripCell}
        <td class="num">${idx + 1}</td>
        <td class="st">${STATUS_ICON[it.status] || ""}</td>
        <td class="room">${selMode && pending
            ? `<input type="checkbox" class="pick" data-id="${it.id}" ${this._sel.has(it.id) ? "checked" : ""}>`
            : ""}<span class="rst">${STATUS_ICON[it.status] || ""} </span>${it.custom
              ? `<span class="zprev" data-id="${it.id}" role="button" tabindex="0" title="Pokaż wycinek na mapie">${ric(it.room, it.icon)}${esc(it.room)}</span>`
              : `${ric(it.room, it.icon)}${esc(it.room)}`}${active ? "" : `<span class="est" data-id="${it.id}">${estTxt(it)}</span>`}
          ${active ? `<span class="stline"><span class="badge${it.interrupted ? " intr" : ""}">${it.interrupted ? `⏸ ${esc(it.reason || "przerwane")}` : "▶ sprząta teraz"}</span><span class="pct">${activePct(items, vacObj)}</span><span class="est" data-id="${it.id}">${estTxt(it)}</span></span>` : ""}</td>
        <td class="sx"><span class="fl">Ssanie</span>${editable ? sel(suctionOpts, it.suction, "suction", it.id, T_SUCTION) : `<span class="val">${esc(T_SUCTION[it.suction] || it.suction)}</span>`}</td>
        <td class="wx"><span class="fl">Mop</span>${editable ? sel(waterOpts, it.water, "water", it.id, T_WATER) : `<span class="val">${esc(T_WATER[it.water] || it.water)}</span>`}</td>
        <td class="rep"><span class="fl">Powt.</span>${pending ? sel(REPEATS, it.repeats, "repeats", it.id, null, "\u00D7") : `<span class="val">${esc(it.repeats)}\u00D7</span>`}</td>
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

        table { width: 100%; border-collapse: collapse; font-size: ${c.compact ? ".92em" : "1em"}; }
        th { text-align: left; font-size: .74em; font-weight: 600;
             text-transform: uppercase; letter-spacing: .06em;
             color: var(--secondary-text-color);
             border-bottom: 1px solid var(--divider-color); padding: 4px 6px 6px; }
        td { padding: ${c.compact ? "5px 6px" : "7px 8px"};
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
        .stline { display: flex; align-items: center; gap: 8px;
                  flex-wrap: wrap; margin-top: 4px; white-space: normal; }
        .stline .est, .stline .pct { margin-left: 0; }
        .badge { display: inline-block; padding: 2px 9px; border-radius: 11px;
                 font-size: .74em; font-weight: 600; letter-spacing: .03em;
                 white-space: nowrap; color: var(--primary-color);
                 border: 1px solid var(--primary-color);
                 background: color-mix(in srgb, var(--primary-color) 15%, transparent); }
        .badge.intr { color: var(--warning-color, #ff9800);
                 border-color: var(--warning-color, #ff9800);
                 background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent); }
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
        .zprev { cursor: pointer; }
        .zprev:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
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
        .pct { margin-left: 8px; font-size: .78em; font-weight: 700;
               color: var(--primary-color); white-space: nowrap; }
        .pct:empty { display: none; }
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
        .btn.busy { opacity: .55; pointer-events: none; }
        .btn.busy::after { content: " ⏳"; }

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
        :host(.narrow) .stline { gap: 7px; margin-top: 5px; }
        :host(.narrow) .badge { font-size: 12px; padding: 2px 10px; }
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
        :host(.narrow) .pct { font-size: 12px; }
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
        ${c.show_header ? `<h2>${esc(c.title)}
          <span class="hdr">${st.attributes.feedback
              ? `<button class="ib notebtn" id="noteBtn" title="Zapisz notatkę do dziennika feedbacku">\u{1F4DD}</button>`
              : ""}<span class="badge ${esc(st.state)}">${esc({ running: "PRACUJE", paused: "WSTRZYMANA", idle: "BEZCZYNNA" }[st.state] || st.state)}</span></span>
        </h2>` : ""}
        ${c.show_robot_state ? `<div class="sub">${esc(robotLine(st, vacObj))}</div>` : ""}
        ${c.show_progress && prog.total > 0 ? `<div class="prog">
          <div class="pbar"><div class="pfill" style="width:${Math.round(100 * prog.done / prog.total)}%"></div></div>
          <span class="ptxt">${prog.done}/${prog.total} pokoi${etaS ? ` \u00B7 ~${Math.max(1, Math.round(etaS / 60))} min` : ""}</span>
        </div>` : ""}
        ${items.length
          ? `<div class="tblwrap v-${esc(c.grip_position)}"><table><thead><tr>
               <th>#</th><th></th><th>Pokój</th><th>Ssanie</th><th>Mop</th><th>Powt.</th><th></th>
             </tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><span class="e-ic">\u{1F9F9}</span>Kolejka pusta — dodaj pokoje poniżej.</div>`}
        ${c.show_actions && !ro ? `<div class="sec">
          <div class="sechd">Sterowanie</div>
          <div class="actions">
          ${(() => {
            const hasActive = items.some((it2) => it2.status === "active");
            if (st.state === "running") return `
               <button class="btn primary" id="pause" title="Robot zatrzymuje si\u0119 natychmiast w miejscu">\u23F8 Pauza</button>
               ${hasActive ? `<button class="btn" id="finish" title="Robot doko\u0144czy bie\u017C\u0105cy pok\u00F3j, kolejka si\u0119 wstrzyma">\u{1F3C1} Doko\u0144cz pok\u00F3j</button>
               <button class="btn" id="skip">\u23ED Pomi\u0144</button>` : ""}
               <button class="btn warn twoclick" id="stop">\u23F9 Stop</button>`;
            if (st.state === "paused") return `
               <button class="btn primary" id="start">\u25B6 Kontynuuj</button>
               ${hasActive ? `<button class="btn" id="skip">\u23ED Pomi\u0144</button>
               <button class="btn" id="dock" title="Robot wraca do stacji; pok\u00F3j wr\u00F3ci do oczekuj\u0105cych">\u{1F3E0} Do bazy</button>` : ""}
               <button class="btn warn twoclick" id="clear">\u2715 Wyczy\u015B\u0107</button>`;
            return `
               <button class="btn primary" id="start">\u25B6 Start</button>
               <button class="btn warn twoclick" id="clear">\u2715 Wyczy\u015B\u0107</button>`;
          })()}
          </div>
        </div>` : ""}
        ${c.show_add_row && !ro ? `<div class="sec">
          <div class="sechd">Dodaj pok\u00F3j</div>
          <div class="addrow">
          <select id="addRoom">${rooms.map((r) => `<option value="${esc(r)}">${ric(r)}${esc(r)}</option>`).join("")}</select>
          <button class="btn" id="add" ${rooms.length ? "" : "disabled"}>+ Dodaj</button>
          <button class="btn" id="zoneAdd" title="Narysuj jednorazow\u0105 stref\u0119 na mapie">\u25AD W\u0142asna strefa</button>
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
              ? presets.map((p) => `<option value="${esc(p)}">\u2B50 ${esc(p)}</option>`).join("")
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
    on("noteBtn", () => this._noteDialog());
    on("start", () => this._call("start"));
    on("pause", () => this._call("pause"));
    on("skip", () => this._call("skip"));
    on("dock", () => this._call("dock"));
    on("finish", () => this._call("finish_room"));
    arm("stop", () => this._call("stop"));
    arm("clear", () => this._call("clear"));
    on("add", () => this._call("add", { room: root.getElementById("addRoom").value }));
    on("zoneAdd", () => this._zoneDialog());
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
    root.querySelectorAll(".zprev").forEach((b) => {
      b.onclick = () => this._zonePreview(Number(b.dataset.id));
      b.onkeydown = (e) => { if (e.key === "Enter") b.onclick(); };
    });
    root.querySelectorAll(".hist").forEach((b) => {
      b.onclick = () => this._historyModal(b.dataset.room);
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
  { name: "map_camera", selector: { entity: { domain: "camera" } } },
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
  map_camera: "Kamera mapy (puste = camera.<robot>_map)",
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
    this._config = config;   // surowa konfiguracja — DEFAULTS tylko do wyswietlenia
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
        // do YAML tylko klucze ustawione przez uzytkownika albo rozne od domyslnych
        const config = { type: "custom:vacuum-queue-card" };
        for (const [k, v] of Object.entries(ev.detail.value)) {
          if (v === undefined || v === "") continue;
          if (k in this._config || v !== DEFAULTS[k]) config[k] = v;
        }
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    if (this._hass) this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = { ...DEFAULTS, ...this._config };
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
