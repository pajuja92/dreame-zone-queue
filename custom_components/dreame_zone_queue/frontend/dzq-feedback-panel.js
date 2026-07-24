/* Panel boczny "Zone Queue Logi" — podgląd dziennika feedbacku
 * (/config/dreame_zone_queue_feedback.log) bez grzebania w logach HA Core.
 *
 * Plik na dysku jest ZAWSZE pełny; widok/pobranie "diff" liczy różnice
 * między kolejnymi zrzutami attrs w locie (klucze usunięte → "_removed"). */

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
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; background: var(--primary-background-color); }
        .top { display: flex; align-items: center; gap: 8px; padding: 10px 16px;
               background: var(--app-header-background-color, var(--primary-color));
               color: var(--app-header-text-color, #fff); flex-wrap: wrap; }
        .top h1 { font-size: 1.1em; margin: 0; font-weight: 500; flex: 1; min-width: 160px; }
        .top input, .top select { padding: 6px 10px; border-radius: 8px; border: none; font: inherit; }
        .top input[type="datetime-local"] { min-width: 150px; }
        #filter { min-width: 130px; }
        .top button, .top label.chk { background: rgba(255,255,255,.15); color: inherit;
               border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
               font: inherit; display: inline-flex; align-items: center; gap: 6px; }
        .top button:hover { background: rgba(255,255,255,.25); }
        .top button.warn { background: rgba(255,120,0,.55); }
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
              overflow-y: auto; height: calc(100vh - 230px); }
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
      </style>
      <div class="top">
        <h1>🧹 Zone Queue — dziennik feedbacku</h1>
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
      </div>
      <div class="tags" id="tags"></div>
      <div id="off" class="off" style="display:none">
        Tryb feedbacku jest wyłączony — włącz
        <b>switch.dreame_zone_queue_feedback_log</b>, aby zbierać pełne stany.
        Poniżej wpisy zebrane wcześniej.
      </div>
      <div class="meta" id="meta"></div>
      <div id="log">Ładowanie…</div>`;
    const r = this.shadowRoot;
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

  // ------------------------------------------------------------- dane

  async _load() {
    if (!this._hass) return;
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
