/* Panel boczny "Zone Queue Logi" — podgląd dziennika feedbacku
 * (/config/dreame_zone_queue_feedback.log) bez grzebania w logach HA Core. */

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
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; background: var(--primary-background-color); }
        .top { display: flex; align-items: center; gap: 10px; padding: 10px 16px;
               background: var(--app-header-background-color, var(--primary-color));
               color: var(--app-header-text-color, #fff); flex-wrap: wrap; }
        .top h1 { font-size: 1.1em; margin: 0; font-weight: 500; flex: 1; min-width: 160px; }
        .top input { padding: 6px 10px; border-radius: 8px; border: none; min-width: 140px; }
        .top button, .top label { background: rgba(255,255,255,.15); color: inherit;
               border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
               font: inherit; display: inline-flex; align-items: center; gap: 6px; }
        .top button:hover { background: rgba(255,255,255,.25); }
        .off { margin: 14px 16px; padding: 12px 14px; border-radius: 10px;
               background: var(--warning-color, #ff9800); color: #fff; }
        .meta { padding: 6px 16px; color: var(--secondary-text-color); font-size: .85em; }
        pre { margin: 0 16px 16px; padding: 14px; border-radius: 10px;
              background: var(--card-background-color); color: var(--primary-text-color);
              font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
              white-space: pre-wrap; word-break: break-word;
              overflow-y: auto; height: calc(100vh - 170px); }
        .note-line { color: var(--warning-color, #ff9800); font-weight: 700; }
        .dec-line { color: var(--primary-color); }
      </style>
      <div class="top">
        <h1>🧹 Zone Queue — dziennik feedbacku</h1>
        <input id="filter" placeholder="filtr (np. NOTE, DECISION)">
        <label><input type="checkbox" id="auto" checked style="min-width:auto"> auto 5 s</label>
        <button id="refresh">⟳ Odśwież</button>
        <button id="download">⬇ Pobierz</button>
      </div>
      <div id="off" class="off" style="display:none">
        Tryb feedbacku jest wyłączony — włącz
        <b>switch.dreame_zone_queue_feedback_log</b>, aby zbierać pełne stany.
        Poniżej wpisy zebrane wcześniej.
      </div>
      <div class="meta" id="meta"></div>
      <pre id="log">Ładowanie…</pre>`;
    const r = this.shadowRoot;
    r.getElementById("refresh").onclick = () => this._load();
    r.getElementById("filter").oninput = () => this._renderLog();
    r.getElementById("download").onclick = () => {
      const blob = new Blob([this._raw || ""], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dreame_zone_queue_feedback.log";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const auto = r.getElementById("auto");
    const setTimer = () => {
      clearInterval(this._timer);
      if (auto.checked) this._timer = setInterval(() => this._load(), 5000);
    };
    auto.onchange = setTimer;
    setTimer();
    this._load();
  }

  async _load() {
    if (!this._hass) return;
    try {
      const data = await this._hass.callApi("get", "dreame_zone_queue/feedback_log");
      this._raw = data.log || "";
      this._path = data.path;
      this.shadowRoot.getElementById("off").style.display = data.enabled ? "none" : "";
      this._renderLog();
    } catch (e) {
      this.shadowRoot.getElementById("log").textContent = "Błąd odczytu: " + e;
    }
  }

  _renderLog() {
    const r = this.shadowRoot;
    const q = r.getElementById("filter").value.trim().toLowerCase();
    let lines = (this._raw || "").split("\n");
    if (q) lines = lines.filter((l) => l.toLowerCase().includes(q));
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const html = lines
      .map((l) => {
        const e = esc(l);
        if (l.includes("NOTE |")) return `<span class="note-line">${e}</span>`;
        if (l.includes("DZQ_DECISION") || l.includes("DZQ_EVENT")) return `<span class="dec-line">${e}</span>`;
        return e;
      })
      .join("\n");
    const pre = r.getElementById("log");
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40;
    pre.innerHTML = html || "(dziennik pusty)";
    if (atBottom) pre.scrollTop = pre.scrollHeight;
    r.getElementById("meta").textContent =
      `${lines.length} linii · ${this._path || ""} · plik przeżywa restarty HA (rotacja 2 MB × 3)`;
  }
}

customElements.define("dzq-feedback-panel", DzqFeedbackPanel);
