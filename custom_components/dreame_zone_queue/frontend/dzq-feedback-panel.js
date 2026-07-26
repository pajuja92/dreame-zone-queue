import { attachDraw, defaultMode } from "./dzq-draw.js";

/* Panel boczny "Zone Queue" — dwie zakładki:
 *  · Logi — dziennik feedbacku (/config/dreame_zone_queue_feedback.log);
 *    plik na dysku ZAWSZE pełny, widok/pobranie "diff" liczy różnice w locie.
 *  · Kalibracja mapy — przelicznik px→mm dla rysowania własnych stref
 *    (zapis po stronie integracji: POST /api/dreame_zone_queue/map_calib). */

class DzqFeedbackPanel extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
  }
  set narrow(_v) {}
  set panel(_v) {}

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  _build() {
    this._built = true;
    this._tagSel = {}; // tag -> bool (nowe tagi domyślnie włączone)
    this._view = "logs";
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; background: var(--primary-background-color); }
        .top { display: flex; align-items: center; gap: 8px; padding: 10px 16px;
               background: var(--app-header-background-color, var(--primary-color));
               color: var(--app-header-text-color, #fff); flex-wrap: wrap; }
        .top h1 { font-size: 1.1em; margin: 0; font-weight: 500; }
        .top .sp { flex: 1; }
        .top input, .top select { padding: 6px 10px; border-radius: 8px; border: none; font: inherit; }
        .top input[type="datetime-local"] { min-width: 150px; }
        #filter { min-width: 130px; }
        .top button, .top label.chk { background: rgba(255,255,255,.15); color: inherit;
               border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
               font: inherit; display: inline-flex; align-items: center; gap: 6px; }
        .top button:hover { background: rgba(255,255,255,.25); }
        .top button.warn { background: rgba(255,120,0,.55); }
        .top button.tab { border: 1px solid rgba(255,255,255,.4); }
        .top button.tab.on { background: rgba(255,255,255,.9);
               color: var(--app-header-background-color, var(--primary-color)); font-weight: 600; }
        .tags { display: flex; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap; }
        .tags label { display: inline-flex; align-items: center; gap: 4px;
               background: var(--card-background-color); color: var(--primary-text-color);
               border: 1px solid var(--divider-color); border-radius: 14px;
               padding: 3px 10px; font-size: .82em; cursor: pointer; user-select: none; }
        .tags label.offtag { opacity: .45; }
        .off { margin: 14px 16px; padding: 12px 14px; border-radius: 10px;
               background: var(--warning-color, #ff9800); color: #fff; }
        .meta { padding: 6px 16px; color: var(--secondary-text-color); font-size: .85em; }
        #log { margin: 0 16px 16px; padding: 14px; border-radius: 10px;
              background: var(--card-background-color); color: var(--primary-text-color);
              font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
              white-space: pre-wrap; word-break: break-word;
              overflow-y: auto; height: calc(100vh - 250px); }
        .note-line { color: var(--warning-color, #ff9800); font-weight: 700; }
        .dec-line { color: var(--primary-color); }
        .act-line { color: var(--success-color, #0a2); }
        details { display: inline-block; vertical-align: top; max-width: 100%; }
        details > summary { cursor: pointer; color: var(--secondary-text-color);
              display: inline; }
        details > summary:hover { color: var(--primary-text-color); }
        details .json { margin: 2px 0 6px 18px; padding: 8px 10px; border-radius: 8px;
              background: var(--secondary-background-color, rgba(127,127,127,.12));
              white-space: pre; overflow-x: auto; }
        .jk { color: var(--primary-color); }
        .js { color: var(--success-color, #080); }
        .jn { color: var(--warning-color, #b60); }
        .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
              background: var(--primary-color); color: #fff; padding: 10px 18px;
              border-radius: 10px; z-index: 9; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
        /* — kalibracja — */
        #vCalib { padding: 14px 16px; max-width: 980px; }
        .cbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
              margin-bottom: 10px; color: var(--primary-text-color); }
        .cbar select, .cbar button { font: inherit; padding: 7px 12px; border-radius: 8px;
              border: 1px solid var(--divider-color); cursor: pointer;
              background: var(--card-background-color); color: var(--primary-text-color); }
        .cbar button.primary { background: var(--primary-color); color: #fff; border: none; }
        .cbar button.danger { color: var(--error-color, #d33); }
        .cst-ok { color: var(--success-color, #0a2); font-weight: 600; }
        .cst-bad { color: var(--warning-color, #ff9800); font-weight: 600; }
        .cwrap { position: relative; user-select: none; touch-action: none; line-height: 0; }
        .cwrap img { width: 100%; border-radius: 10px; display: block; }
        .crect { position: absolute; display: none; border: 2px solid #ffb84d;
              background: rgba(255,184,77,.18); border-radius: 3px; pointer-events: none; }
        .cbadge { position: absolute; display: none; transform: translate(12px, 12px);
              background: rgba(13,16,21,.92); border: 1px solid #ffb84d; color: #ffb84d;
              font: 12px ui-monospace, Menlo, monospace; padding: 3px 8px;
              border-radius: 6px; pointer-events: none; white-space: nowrap; z-index: 3; }
        .chint { margin-top: 10px; font-size: .85em; color: var(--secondary-text-color);
              line-height: 1.5; }
      </style>
      <div class="top">
        <h1>🧹 Zone Queue</h1>
        <button class="tab on" id="tabLogs">Logi</button>
        <button class="tab" id="tabCalib">🎯 Kalibracja mapy</button>
        <span class="sp"></span>
        <span id="logCtl" style="display:contents">
          <input id="filter" placeholder="filtr tekstu">
          <input id="tfrom" type="datetime-local" title="od kiedy">
          <input id="tto" type="datetime-local" title="do kiedy">
          <select id="mode" title="tryb widoku">
            <option value="full">Pełny</option>
            <option value="diff">Diff</option>
          </select>
          <button id="expand" title="rozwiń wszystkie attrs">▾ Rozwiń</button>
          <button id="collapse" title="zwiń wszystkie attrs">▸ Zwiń</button>
          <label class="chk"><input type="checkbox" id="auto" checked> auto 5 s</label>
          <button id="refresh">⟳ Odśwież</button>
          <button id="download">⬇ Pobierz</button>
          <button id="downdiff">⬇ Pobierz diff</button>
          <button id="archive" class="warn">🗄 Archiwizuj</button>
        </span>
      </div>
      <div id="vLogs">
        <div class="tags" id="tags"></div>
        <div id="off" class="off" style="display:none">
          Tryb feedbacku jest wyłączony — włącz
          <b>switch.dreame_zone_queue_feedback_log</b>, aby zbierać pełne stany.
          Poniżej wpisy zebrane wcześniej.
        </div>
        <div class="meta" id="meta"></div>
        <div id="log">Ładowanie…</div>
      </div>
      <div id="vCalib" style="display:none"></div>`;
    const r = this.shadowRoot;
    r.getElementById("tabLogs").onclick = () => this._switch("logs");
    r.getElementById("tabCalib").onclick = () => this._switch("calib");
    r.getElementById("refresh").onclick = () => this._load();
    r.getElementById("filter").oninput = () => this._renderLog();
    r.getElementById("tfrom").onchange = () => this._renderLog();
    r.getElementById("tto").onchange = () => this._renderLog();
    r.getElementById("mode").onchange = () => this._renderLog();
    r.getElementById("expand").onclick = () =>
      r.querySelectorAll("details").forEach((d) => (d.open = true));
    r.getElementById("collapse").onclick = () =>
      r.querySelectorAll("details").forEach((d) => (d.open = false));
    r.getElementById("download").onclick = () => this._downloadFull();
    r.getElementById("downdiff").onclick = () => this._downloadDiff();
    r.getElementById("archive").onclick = () => this._archive();
    const auto = r.getElementById("auto");
    const setTimer = () => {
      clearInterval(this._timer);
      if (auto.checked) this._timer = setInterval(() => this._load(), 5000);
    };
    auto.onchange = setTimer;
    setTimer();
    this._load();
  }

  _switch(view) {
    this._view = view;
    const r = this.shadowRoot;
    r.getElementById("tabLogs").classList.toggle("on", view === "logs");
    r.getElementById("tabCalib").classList.toggle("on", view === "calib");
    r.getElementById("logCtl").style.display = view === "logs" ? "contents" : "none";
    r.getElementById("vLogs").style.display = view === "logs" ? "" : "none";
    r.getElementById("vCalib").style.display = view === "calib" ? "" : "none";
    if (view === "calib") this._calibInit();
  }

  // ---------------------------------------------------------- kalibracja

  async _calibInit() {
    const box = this.shadowRoot.getElementById("vCalib");
    box.innerHTML = "Ładowanie…";
    let data;
    try {
      data = await this._hass.callApi("get", "dreame_zone_queue/map_calib");
    } catch (e) {
      box.textContent = "Błąd: " + e;
      return;
    }
    this._mc = data;
    const camEnt = "camera." + ((data.vacuum_entity || "").split(".")[1] || "") + "_map";
    const cam = this._hass.states[camEnt];
    const roomNames = Object.keys(data.room_zones || {}).sort();
    if (!cam) {
      box.innerHTML = `<div class="chint">Nie znalazłem kamery mapy
        (<b>${camEnt}</b>) — kalibracja wymaga encji kamery z mapą robota.</div>`;
      return;
    }
    if (!roomNames.length) {
      box.innerHTML = `<div class="chint">Brak zdefiniowanych pokoi ze strefami —
        kalibracja potrzebuje przynajmniej jednego znanego pokoju.</div>`;
      return;
    }
    box.innerHTML = `
      <div class="cbar">
        <span id="cst"></span>
        <span class="sp" style="flex:1"></span>
        <select id="croom">${roomNames.map((r) =>
          `<option>${this._escT(r)}</option>`).join("")}</select>
        <button class="primary" id="cdraw">Zaznacz ten pokój na mapie</button>
        <button class="danger" id="cclear">Wyczyść kalibrację</button>
      </div>
      <div class="cbar" id="cmodes" style="display:none">
        <button id="cmrect">▭ Prostokąt</button>
        <button id="cmpoly">△ Punkty</button>
        <button id="cmundo">↩ Cofnij punkt</button>
        <button id="cmdone" class="primary">✓ Zakończ kształt</button>
        <span id="cprog" style="color:var(--secondary-text-color)"></span>
      </div>
      <div class="cwrap" id="cwrap">
        <img id="cimg" src="${cam.attributes.entity_picture || ""}" draggable="false">
        <svg id="csvg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg>
        <div class="cbadge" id="cbadge"></div>
      </div>
      <div class="chint">Wybierz pokój, którego położenie znasz, kliknij
        „Zaznacz ten pokój na mapie" i obrysuj go prostokątem. Przelicznik
        px→mm zapisze się w integracji (wspólny dla wszystkich urządzeń).
        <b>Weryfikacja:</b> po kalibracji najedź kursorem na znany narożnik
        innego pokoju — dymek pokazuje współrzędne odkurzacza.</div>`;
    const r = this.shadowRoot;
    const img = r.getElementById("cimg");
    const wrap = r.getElementById("cwrap");
    const badge = r.getElementById("cbadge");
    let armed = false; // czy trwa zaznaczanie pokoju

    const status = () => {
      const el = r.getElementById("cst");
      const c = this._mc.calib;
      if (!c) {
        el.textContent = "⚠ Brak kalibracji";
        el.className = "cst-bad";
      } else if (img.naturalWidth && Math.abs(c.iw - img.naturalWidth) > 1) {
        el.textContent = "⚠ Mapa zmieniła rozmiar — skalibruj ponownie";
        el.className = "cst-bad";
      } else {
        el.textContent = "Kalibracja aktywna ✓";
        el.className = "cst-ok";
      }
    };
    img.onload = status;
    status();

    wrap.style.overflow = "hidden";
    const toNat = (x, y) => {
      const f = img.naturalWidth / img.clientWidth;
      return [x * f, y * f];
    };
    const saveCalib = async (dispPts) => {
      const room = r.getElementById("croom").value;
      const z = this._mc.room_zones[room];
      if (!z) return;
      const nat = dispPts.map((p) => toNat(p[0], p[1]));
      const nL = Math.min(...nat.map((p) => p[0]));
      const nR = Math.max(...nat.map((p) => p[0]));
      const nT = Math.min(...nat.map((p) => p[1]));
      const nB = Math.max(...nat.map((p) => p[1]));
      if (nR - nL < 8 || nB - nT < 8) return;
      const vxmin = Math.min(z[0], z[2]), vxmax = Math.max(z[0], z[2]);
      const vymin = Math.min(z[1], z[3]), vymax = Math.max(z[1], z[3]);
      // os Y odkurzacza rosnie do gory ekranu (Dreame) -> flip
      const ax = (vxmax - vxmin) / (nR - nL);
      const ay = (vymin - vymax) / (nB - nT);
      const calib = {
        ax, bx: vxmin - ax * nL,
        ay, by: vymax - ay * nT,
        iw: img.naturalWidth, ih: img.naturalHeight,
      };
      try {
        await this._hass.callApi("post", "dreame_zone_queue/map_calib", { calib });
        this._mc.calib = calib;
        armed = false;
        draw.clear();
        r.getElementById("cmodes").style.display = "none";
        wrap.style.cursor = "";
        status();
        this._toast("✓ Kalibracja zapisana — zweryfikuj kursorem na innym pokoju");
      } catch (err) {
        this._toast("Błąd zapisu: " + err);
      }
    };

    const draw = attachDraw(wrap, img, r.getElementById("csvg"), {
      shape: (sh) => { if (armed) saveCalib(sh.pts); },
      progress: (n) => {
        r.getElementById("cprog").textContent =
          draw && draw.getMode() === "poly" && n ? `punkty: ${n}` : "";
      },
      hover: (pt) => {
        const c = this._mc.calib;
        if (!c || armed || !pt) { badge.style.display = "none"; return; }
        const [nx, ny] = toNat(pt[0], pt[1]);
        badge.textContent = "X " + Math.round(c.ax * nx + c.bx) +
          " · Y " + Math.round(c.ay * ny + c.by);
        badge.style.left = pt[0] + "px";
        badge.style.top = pt[1] + "px";
        badge.style.display = "block";
      },
    });

    const setMode = (m) => {
      draw.setMode(m);
      const on = "var(--primary-color)";
      const off = "var(--card-background-color)";
      const mr = r.getElementById("cmrect"), mp = r.getElementById("cmpoly");
      mr.style.background = m === "rect" ? on : off;
      mr.style.color = m === "rect" ? "#fff" : "";
      mp.style.background = m === "poly" ? on : off;
      mp.style.color = m === "poly" ? "#fff" : "";
      r.getElementById("cmundo").style.display = m === "poly" ? "" : "none";
      r.getElementById("cmdone").style.display = m === "poly" ? "" : "none";
    };
    r.getElementById("cmrect").onclick = () => setMode("rect");
    r.getElementById("cmpoly").onclick = () => setMode("poly");
    r.getElementById("cmundo").onclick = () => draw.undo();
    r.getElementById("cmdone").onclick = () => {
      if (!draw.finish()) this._toast("Wielokąt wymaga min. 3 punktów");
    };
    wrap.addEventListener("dblclick", () => {
      if (armed && draw.getMode() === "poly") r.getElementById("cmdone").onclick();
    });

    r.getElementById("cdraw").onclick = () => {
      armed = true;
      draw.clear();
      r.getElementById("cmodes").style.display = "";
      setMode(defaultMode());
      wrap.style.cursor = "crosshair";
      this._toast("Zaznacz na mapie: " + r.getElementById("croom").value +
        " (prostokątem lub punktami; dwa palce = zoom)");
    };
    r.getElementById("cclear").onclick = async () => {
      await this._hass.callApi("post", "dreame_zone_queue/map_calib", { calib: null });
      this._mc.calib = null;
      status();
      this._toast("Kalibracja wyczyszczona");
    };
  }

  _escT(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  // ------------------------------------------------------------- dane

  async _load() {
    if (!this._hass || this._view !== "logs") return;
    try {
      const data = await this._hass.callApi("get", "dreame_zone_queue/feedback_log");
      this._raw = data.log || "";
      this._path = data.path;
      this.shadowRoot.getElementById("off").style.display = data.enabled ? "none" : "";
      this._entries = this._parse(this._raw);
      this._renderTags();
      this._renderLog();
    } catch (e) {
      this.shadowRoot.getElementById("log").textContent = "Błąd odczytu: " + e;
    }
  }

  /* linia -> {raw, when("YYYY-MM-DDTHH:MM:SS"), tag, head, attrs|null} */
  _parse(raw) {
    const out = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const m = line.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)[,.]\d+\s(.*)$/);
      if (!m) {
        // kontynuacja wielolinijkowej notatki — dziedziczy czas i tag
        const p = out[out.length - 1];
        out.push({ raw: line, when: p ? p.when : "", tag: p ? p.tag : "INNE",
                   head: line, attrs: null });
        continue;
      }
      const when = `${m[1]}T${m[2]}`;
      const rest = m[3];
      const seg = rest.split(" | ")[0];
      const tag = rest.includes(" | ") && seg.length <= 24 && !seg.includes("=")
        ? seg : "INNE";
      let head = line, attrs = null;
      const am = rest.match(/^(.*?\| attrs=)(\{.*\})\s*$/);
      if (am) {
        try {
          attrs = JSON.parse(am[2]);
          head = `${m[1]} ${m[2]} ${am[1]}`;
        } catch (_e) { /* zostaje pełna linia */ }
      }
      out.push({ raw: line, when, tag, head, attrs });
    }
    return out;
  }

  /* pełne zrzuty -> tylko zmiany między kolejnymi (jak plik _diff.log) */
  _diff(entries) {
    let prev = null;
    return entries.map((e) => {
      if (!e.attrs) return e;
      let payload;
      if (prev === null) {
        payload = e.attrs; // pierwszy zrzut = pełna baza
      } else {
        payload = {};
        for (const [k, v] of Object.entries(e.attrs)) {
          if (JSON.stringify(prev[k]) !== JSON.stringify(v)) payload[k] = v;
        }
        const gone = Object.keys(prev).filter((k) => !(k in e.attrs));
        if (gone.length) payload._removed = gone;
      }
      prev = e.attrs;
      return { ...e, attrs: payload };
    });
  }

  // ------------------------------------------------------------- widok

  _renderTags() {
    const box = this.shadowRoot.getElementById("tags");
    const tags = [...new Set(this._entries.map((e) => e.tag))].sort();
    for (const t of tags) if (!(t in this._tagSel)) this._tagSel[t] = true;
    box.innerHTML = "";
    for (const t of tags) {
      const n = this._entries.filter((e) => e.tag === t).length;
      const lab = document.createElement("label");
      lab.className = this._tagSel[t] ? "" : "offtag";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this._tagSel[t];
      cb.onchange = () => {
        this._tagSel[t] = cb.checked;
        lab.className = cb.checked ? "" : "offtag";
        this._renderLog();
      };
      lab.append(cb, `${t} (${n})`);
      box.append(lab);
    }
  }

  _esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  _jsonHtml(obj) {
    const json = this._esc(JSON.stringify(obj, null, 2));
    return json
      .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
      .replace(/: (".*?")(,?)$/gm, ': <span class="js">$1</span>$2')
      .replace(/: (-?[\d.]+|true|false|null)(,?)$/gm, ': <span class="jn">$1</span>$2');
  }

  _renderLog() {
    const r = this.shadowRoot;
    const q = r.getElementById("filter").value.trim().toLowerCase();
    const tfrom = r.getElementById("tfrom").value;
    const tto = r.getElementById("tto").value;
    const diffMode = r.getElementById("mode").value === "diff";

    // diff liczony na CAŁYM ciągu (zanim filtry ukryją linie),
    // inaczej "zmiany" liczyłyby się względem odfiltrowanych wpisów
    let entries = diffMode ? this._diff(this._entries || []) : (this._entries || []);
    entries = entries.filter((e) => {
      if (!this._tagSel[e.tag]) return false;
      if (tfrom && e.when && e.when < tfrom) return false;
      if (tto && e.when && e.when > tto + ":59") return false;
      if (q) {
        const hay = (e.attrs ? e.head + JSON.stringify(e.attrs) : e.raw).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const parts = entries.map((e) => {
      let cls = "";
      if (e.tag === "NOTE") cls = "note-line";
      else if (e.tag === "DZQ_DECISION" || e.tag === "DZQ_EVENT") cls = "dec-line";
      else if (e.tag === "DZQ_ACTION") cls = "act-line";
      if (e.attrs === null) {
        const line = this._esc(e.raw);
        return cls ? `<span class="${cls}">${line}</span>` : line;
      }
      const keys = Object.keys(e.attrs).length;
      const preview = this._esc(JSON.stringify(e.attrs).slice(0, 100));
      const head = this._esc(e.head);
      const body = keys
        ? `<details><summary>{…} ${keys} ${keys === 1 ? "klucz" : "kluczy"} · ${preview}${preview.length >= 100 ? "…" : ""}</summary><div class="json">${this._jsonHtml(e.attrs)}</div></details>`
        : "{}";
      const line = `${head}${body}`;
      return cls ? `<span class="${cls}">${line}</span>` : line;
    });

    const log = r.getElementById("log");
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    log.innerHTML = parts.join("\n") || "(brak wpisów po filtrach)";
    if (atBottom) log.scrollTop = log.scrollHeight;
    r.getElementById("meta").textContent =
      `${parts.length}/${(this._entries || []).length} wpisów · tryb: ` +
      `${diffMode ? "diff" : "pełny"} · ${this._path || ""} · ` +
      "plik na dysku zawsze pełny, rotacja 2 MB × 3";
  }

  // ------------------------------------------------------------- akcje

  _save(text, name) {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async _fetchAll() {
    const data = await this._hass.callApi(
      "get", "dreame_zone_queue/feedback_log?all=1");
    return data.log || "";
  }

  async _downloadFull() {
    try {
      this._save(await this._fetchAll(), "dreame_zone_queue_feedback.log");
    } catch (e) { alert("Błąd pobierania: " + e); }
  }

  async _downloadDiff() {
    try {
      const entries = this._diff(this._parse(await this._fetchAll()));
      const text = entries
        .map((e) => (e.attrs !== null ? e.head + JSON.stringify(e.attrs) : e.raw))
        .join("\n");
      this._save(text, "dreame_zone_queue_feedback_diff.log");
    } catch (e) { alert("Błąd pobierania: " + e); }
  }

  async _archive() {
    if (!confirm("Zarchiwizować dziennik? Bieżące wpisy trafią do osobnego " +
                 "pliku *_archived_* w /config, a główny plik zacznie się " +
                 "od nowa (pierwszy wpis pełny).")) return;
    try {
      const res = await this._hass.callApi("post", "dreame_zone_queue/feedback_archive");
      this._toast(`✓ Zarchiwizowano: ${res.archived}`);
      this._load();
    } catch (e) { alert("Błąd archiwizacji: " + e); }
  }

  _toast(msg) {
    const t = document.createElement("div");
    // toast w shadowRoot, żeby dziedziczyć zmienne motywu
    t.className = "toast";
    t.textContent = msg;
    this.shadowRoot.append(t);
    setTimeout(() => t.remove(), 4000);
  }
}

customElements.define("dzq-feedback-panel", DzqFeedbackPanel);
