/* Wspólny widget rysowania po mapie — używany przez modal „Własna strefa"
 * (karta kolejki, także jego faza ręcznej kalibracji mapy).
 *
 *  · prostokąt: przeciągnięcie jednym palcem / myszą,
 *  · wielokąt: dodawanie punktów tapnięciami (min. 3), finish() kończy,
 *  · zoom: Cmd/Ctrl + scroll ORAZ pinch dwoma palcami; sam scroll i dwa
 *    palce przesuwają mapę — dzięki temu na telefonie da się rysować precyzyjnie,
 *  · współrzędne oddawane w px WYŚWIETLANEGO obrazu (przestrzeń bez
 *    zoomu) — przeliczenie na naturalne px/mm należy do wywołującego.
 *
 * attachDraw(zwrap, img, svg, cb) -> {setMode, getMode, clear, undo,
 *   finish, pointCount}
 *  zwrap: kontener position:relative, overflow:hidden, touch-action:none
 *  svg:   <svg> position:absolute inset:0 nad obrazem
 *  cb.shape({kind:"rect"|"poly", pts})  — zamknięty kształt
 *  cb.progress(n)                       — liczba punktów wielokąta
 *  cb.hover([x,y]|null)                 — pozycja kursora (weryfikacja)
 *  cb.underlay(scale) -> svg markup     — tło pod szkicem (np. poprzednia kalibracja)
 */

export function attachDraw(zwrap, img, svg, cb) {
  const st = {
    mode: "rect",
    pts: [],          // punkty wielokąta (img px)
    drag: null,       // [L,T,W,H] szkic prostokąta
    start: null,      // początek przeciągania
    scale: 1, tx: 0, ty: 0,
    ptrs: new Map(),  // aktywne wskaźniki (pinch)
    pinched: false,   // czy trwający gest użył dwóch palców
  };

  img.style.transformOrigin = "0 0";
  svg.style.transformOrigin = "0 0";
  const apply = () => {
    const t = `translate(${st.tx}px,${st.ty}px) scale(${st.scale})`;
    img.style.transform = t;
    svg.style.transform = t;
    redraw();
  };

  const imgPos = (e) => {
    const r = zwrap.getBoundingClientRect();
    const x = (e.clientX - r.left - st.tx) / st.scale;
    const y = (e.clientY - r.top - st.ty) / st.scale;
    return [Math.max(0, Math.min(x, img.clientWidth)),
            Math.max(0, Math.min(y, img.clientHeight))];
  };

  const clampView = () => {
    st.scale = Math.max(1, Math.min(8, st.scale));
    const w = img.clientWidth, h = img.clientHeight;
    st.tx = Math.min(0, Math.max(st.tx, w - w * st.scale));
    st.ty = Math.min(0, Math.max(st.ty, h - h * st.scale));
  };
  const zoomAt = (cx, cy, f) => {
    const ns = Math.max(1, Math.min(8, st.scale * f));
    st.tx = cx - (cx - st.tx) * (ns / st.scale);
    st.ty = cy - (cy - st.ty) * (ns / st.scale);
    st.scale = ns;
    clampView();
    apply();
  };

  function redraw() {
    const sw = 2 / st.scale, r = 7 / st.scale;
    let html = cb.underlay ? cb.underlay(st.scale) : "";
    if (st.drag) {
      html += `<rect x="${st.drag[0]}" y="${st.drag[1]}" width="${st.drag[2]}"
        height="${st.drag[3]}" fill="rgba(255,184,77,.18)" stroke="#ffb84d"
        stroke-width="${sw}" rx="${3 / st.scale}"/>`;
    }
    if (st.pts.length) {
      const ptStr = st.pts.map((p) => p.join(",")).join(" ");
      html += st.pts.length > 2
        ? `<polygon points="${ptStr}" fill="rgba(255,184,77,.18)" stroke="#ffb84d" stroke-width="${sw}"/>`
        : `<polyline points="${ptStr}" fill="none" stroke="#ffb84d" stroke-width="${sw}"/>`;
      html += st.pts.map((p) =>
        `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="#ffb84d"
           stroke="#1a1206" stroke-width="${1.5 / st.scale}"/>`).join("");
    }
    svg.innerHTML = html;
  }

  // Cmd/Ctrl + scroll (Ctrl = gest pinch na gladziku) = zoom; sam scroll =
  // przesuwanie powiekszonej mapy (bez zoomu przewija okno jak zwykle).
  zwrap.addEventListener("wheel", (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const b = zwrap.getBoundingClientRect();
      zoomAt(e.clientX - b.left, e.clientY - b.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    } else if (st.scale > 1) {
      e.preventDefault();
      st.tx -= e.deltaX;
      st.ty -= e.deltaY;
      clampView();
      apply();
    }
  }, { passive: false });

  zwrap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    zwrap.setPointerCapture(e.pointerId);
    st.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (st.ptrs.size === 2) {
      st.pinched = true;      // gest dwoma palcami = zoom/pan, nie rysowanie
      st.start = null;
      st.drag = null;
      redraw();
    } else if (st.ptrs.size === 1 && st.mode === "rect") {
      st.start = imgPos(e);
    }
  });

  zwrap.addEventListener("pointermove", (e) => {
    if (st.ptrs.has(e.pointerId)) {
      const prev = [...st.ptrs.values()];
      st.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (st.ptrs.size === 2) {
        const cur = [...st.ptrs.values()];
        const dist = (a) => Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
        const mid = (a) => [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
        const b = zwrap.getBoundingClientRect();
        const m0 = mid(prev), m1 = mid(cur);
        st.tx += m1[0] - m0[0];
        st.ty += m1[1] - m0[1];
        const d0 = dist(prev), d1 = dist(cur);
        if (d0 > 12) zoomAt(m1[0] - b.left, m1[1] - b.top, d1 / d0);
        else { clampView(); apply(); }
        return;
      }
    }
    if (st.start && st.mode === "rect") {
      const [x, y] = imgPos(e);
      st.drag = [Math.min(st.start[0], x), Math.min(st.start[1], y),
                 Math.abs(x - st.start[0]), Math.abs(y - st.start[1])];
      redraw();
    }
    if (cb.hover && st.ptrs.size === 0) cb.hover(imgPos(e));
  });

  const endPtr = (e) => {
    const had = st.ptrs.delete(e.pointerId);
    const wasPinch = st.pinched;
    if (st.ptrs.size === 0) st.pinched = false;
    if (!had || wasPinch) { st.start = null; return; }
    if (e.type === "pointercancel") { st.start = null; return; }
    const [x, y] = imgPos(e);
    if (st.mode === "rect" && st.start) {
      const L = Math.min(st.start[0], x), T = Math.min(st.start[1], y);
      const W = Math.abs(x - st.start[0]), H = Math.abs(y - st.start[1]);
      st.start = null;
      if (W < 8 || H < 8) { st.drag = null; redraw(); return; }
      st.drag = [L, T, W, H];
      redraw();
      cb.shape({ kind: "rect", pts: [[L, T], [L + W, T + H]] });
    } else if (st.mode === "poly") {
      st.pts.push([x, y]);
      redraw();
      if (cb.progress) cb.progress(st.pts.length);
    }
  };
  zwrap.addEventListener("pointerup", endPtr);
  zwrap.addEventListener("pointercancel", endPtr);
  zwrap.addEventListener("pointerleave", () => { if (cb.hover) cb.hover(null); });

  return {
    setMode(m) {
      st.mode = m;
      this.clear();
    },
    getMode: () => st.mode,
    clear() {
      st.pts = [];
      st.drag = null;
      st.start = null;
      redraw();
      if (cb.progress) cb.progress(0);
    },
    undo() {
      if (st.mode === "poly" && st.pts.length) {
        st.pts.pop();
        redraw();
        if (cb.progress) cb.progress(st.pts.length);
      } else if (st.mode === "rect") {
        st.drag = null;
        redraw();
      }
    },
    finish() {
      if (st.mode !== "poly" || st.pts.length < 3) return false;
      redraw();
      cb.shape({ kind: "poly", pts: st.pts.slice() });
      return true;
    },
    pointCount: () => st.pts.length,
    redraw,
  };
}

/* Przelicznik px->mm z atrybutu `calibration_points` kamery mapy Dreame
 * (3 pary {vacuum:{x,y}, map:{x,y}}). Integracja dreame liczy je dla KAŻDEGO
 * renderu mapy, więc zmiana rozmiaru/przycięcia obrazka nie psuje stref —
 * ręczna kalibracja zostaje tylko jako zapas, gdy atrybutu brak.
 * Zwraca afiniczne {ax, axy, bx, ayx, ay, by} (Cramer na 3 punktach) albo null.
 *   x_mm = ax*nx + axy*ny + bx ;  y_mm = ayx*nx + ay*ny + by */
export function calibFromCamera(cp) {
  if (!Array.isArray(cp) || cp.length < 3) return null;
  const P = cp.slice(0, 3).map((p) =>
    [p.map.x, p.map.y, p.vacuum.x, p.vacuum.y].map(Number));
  if (P.some((p) => p.some((v) => !Number.isFinite(v)))) return null;
  const [[x1, y1], [x2, y2], [x3, y3]] = P;
  const D = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  if (!D) return null;
  const solve = (k) => {
    const [v1, v2, v3] = P.map((p) => p[k]);
    return [
      (v1 * (y2 - y3) - y1 * (v2 - v3) + (v2 * y3 - v3 * y2)) / D,
      (x1 * (v2 - v3) - v1 * (x2 - x3) + (x2 * v3 - x3 * v2)) / D,
      (x1 * (y2 * v3 - y3 * v2) - y1 * (x2 * v3 - x3 * v2) + v1 * (x2 * y3 - x3 * y2)) / D,
    ];
  };
  const [ax, axy, bx] = solve(2);
  const [ayx, ay, by] = solve(3);
  return { ax, axy, bx, ayx, ay, by, src: "camera" };
}

/* Odwrotność przelicznika (kamera albo ręczny map_calib): mm -> naturalne px
 * obrazu mapy. Ręczna kalibracja nie ma axy/ayx (brak obrotu) -> 0. */
export function mmToPx(c) {
  const axy = c.axy || 0, ayx = c.ayx || 0;
  const det = c.ax * c.ay - axy * ayx;
  return (x, y) => {
    const dx = x - c.bx, dy = y - c.by;
    return [(c.ay * dx - axy * dy) / det, (c.ax * dy - ayx * dx) / det];
  };
}

/* Pokój, w którym leży strefa [x1,y1,x2,y2] (mm): największa część wspólna
 * ze strefami pokoi {nazwa: [x1,y1,x2,y2]}. Brak pokrycia -> "". */
export function roomOf(zone, roomZones) {
  let best = "", bestA = 0;
  for (const [name, r] of Object.entries(roomZones || {})) {
    const w = Math.min(zone[2], Math.max(r[0], r[2])) - Math.max(zone[0], Math.min(r[0], r[2]));
    const h = Math.min(zone[3], Math.max(r[1], r[3])) - Math.max(zone[1], Math.min(r[1], r[3]));
    if (w > 0 && h > 0 && w * h > bestA) { best = name; bestA = w * h; }
  }
  return best;
}

/* Domyślny tryb: na ekranach dotykowych punkty (tapnięcia są łatwiejsze
 * niż precyzyjne przeciąganie), na desktopie prostokąt. */
export function defaultMode() {
  return matchMedia("(pointer: coarse)").matches ? "poly" : "rect";
}

/* ===========================================================================
 * Edytor wielu stref (okno „Własna strefa").
 *
 * Model: tablica `shapes` równoległa do wierszy tabeli w oknie; element to
 * null (wiersz jeszcze bez kształtu) albo {kind:"rect"|"poly", pts}. Prostokąt
 * trzyma pts = [[L,T],[R,B]], wielokąt listę wierzchołków; wszystko w px
 * WYŚWIETLANEGO obrazu (przestrzeń bez zoomu).
 *
 *  · rysować można tylko dla zaznaczonego wiersza bez kształtu,
 *  · kliknięcie obszaru innej strefy zaznacza ją (cb.select),
 *  · zaznaczoną strefę edytujesz: prostokąt — 8 uchwytów (rogi i boki, zmiana
 *    prostokątna), wielokąt — uchwyt w każdym punkcie; przeciągnięcie wnętrza
 *    przesuwa całość,
 *  · zoom/pan jak w attachDraw (Cmd/Ctrl + scroll = zoom, scroll = przesuwanie,
 *    pinch dwoma palcami).
 *
 * attachZoneEditor(zwrap, img, svg, cb) -> {setMode, getMode, addRow,
 *   removeRow, select, getSelected, clearSelected, undoPoint, finishPoly,
 *   pendingCount, shapes}
 *  cb.change(idx)      — kształt wiersza idx powstał lub został zmieniony
 *  cb.select(idx)      — użytkownik zaznaczył strefę na mapie
 *  cb.progress(n)      — liczba punktów rysowanego wielokąta
 * ========================================================================= */
export const ZONE_COLORS = ["#ffb84d", "#4dc3ff", "#8be08b", "#ff7ab6", "#c39bff", "#ffd84d"];

export function attachZoneEditor(zwrap, img, svg, cb) {
  const st = {
    mode: "rect",
    shapes: [null],   // jeden pusty wiersz na start
    sel: 0,
    pend: [],         // punkty rysowanego (jeszcze niezamkniętego) wielokąta
    draft: null,      // [L,T,W,H] szkic rysowanego prostokąta
    start: null,      // początek rysowania prostokąta
    drag: null,       // {type:"handle"|"move", idx, h, from, orig}
    scale: 1, tx: 0, ty: 0,
    ptrs: new Map(),
    pinched: false,
  };
  const colOf = (i) => ZONE_COLORS[i % ZONE_COLORS.length];

  img.style.transformOrigin = "0 0";
  svg.style.transformOrigin = "0 0";
  const apply = () => {
    const t = `translate(${st.tx}px,${st.ty}px) scale(${st.scale})`;
    img.style.transform = t;
    svg.style.transform = t;
    redraw();
  };
  const W = () => img.clientWidth, H = () => img.clientHeight;
  const imgPos = (e) => {
    const r = zwrap.getBoundingClientRect();
    const x = (e.clientX - r.left - st.tx) / st.scale;
    const y = (e.clientY - r.top - st.ty) / st.scale;
    return [Math.max(0, Math.min(x, W())), Math.max(0, Math.min(y, H()))];
  };
  const clampView = () => {
    st.scale = Math.max(1, Math.min(8, st.scale));
    st.tx = Math.min(0, Math.max(st.tx, W() - W() * st.scale));
    st.ty = Math.min(0, Math.max(st.ty, H() - H() * st.scale));
  };
  const zoomAt = (cx, cy, f) => {
    const ns = Math.max(1, Math.min(8, st.scale * f));
    st.tx = cx - (cx - st.tx) * (ns / st.scale);
    st.ty = cy - (cy - st.ty) * (ns / st.scale);
    st.scale = ns;
    clampView();
    apply();
  };

  // ---- geometria
  const corners = (s) => {
    if (s.kind !== "rect") return s.pts;
    const [[L, T], [R, B]] = s.pts;
    return [[L, T], [R, T], [R, B], [L, B]];
  };
  const rectHandles = (s) => {
    const [[L, T], [R, B]] = s.pts;
    const mx = (L + R) / 2, my = (T + B) / 2;
    return { nw: [L, T], n: [mx, T], ne: [R, T], e: [R, my],
             se: [R, B], s: [mx, B], sw: [L, B], w: [L, my] };
  };
  const inPoly = (p, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) &&
          p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const area = (s) => {
    const c = corners(s);
    let a = 0;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++)
      a += (c[j][0] + c[i][0]) * (c[j][1] - c[i][1]);
    return Math.abs(a / 2);
  };
  const bodyAt = (p) => {
    let best = -1, bestA = Infinity;
    st.shapes.forEach((s, i) => {
      if (!s || !inPoly(p, corners(s))) return;
      const a = area(s);
      if (a < bestA) { best = i; bestA = a; }
    });
    return best;
  };
  const hitR = () => (matchMedia("(pointer: coarse)").matches ? 20 : 12) / st.scale;
  const handleAt = (p) => {
    const s = st.shapes[st.sel];
    if (!s) return null;
    const r = hitR();
    const hs = s.kind === "rect" ? rectHandles(s)
      : Object.fromEntries(s.pts.map((q, i) => [String(i), q]));
    let best = null, bd = r;
    for (const [k, q] of Object.entries(hs)) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bd) { best = k; bd = d; }
    }
    return best;
  };
  const clampPt = (x, y) => [Math.max(0, Math.min(x, W())), Math.max(0, Math.min(y, H()))];

  function redraw() {
    const sw = 2 / st.scale, r = 7 / st.scale;
    let html = "";
    st.shapes.forEach((s, i) => {
      if (!s) return;
      const on = i === st.sel, c = colOf(i);
      const pts = corners(s).map((q) => q.join(",")).join(" ");
      html += `<polygon points="${pts}" fill="${c}" fill-opacity="${on ? 0.28 : 0.14}"
        stroke="${c}" stroke-width="${on ? sw * 1.6 : sw}" stroke-opacity="${on ? 1 : 0.7}"
        stroke-linejoin="round"${on ? "" : ` stroke-dasharray="${5 / st.scale} ${4 / st.scale}"`}/>`;
      const cs = corners(s);
      const cx = cs.reduce((a, q) => a + q[0], 0) / cs.length;
      const cy = cs.reduce((a, q) => a + q[1], 0) / cs.length;
      html += `<circle cx="${cx}" cy="${cy}" r="${11 / st.scale}" fill="${c}" fill-opacity=".95"/>
        <text x="${cx}" y="${cy}" fill="#1a1206" font-size="${13 / st.scale}" font-weight="700"
        text-anchor="middle" dominant-baseline="central">${i + 1}</text>`;
    });
    const s = st.shapes[st.sel];
    if (s) {
      const hs = s.kind === "rect" ? Object.values(rectHandles(s)) : s.pts;
      html += hs.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="${r}" fill="#fff"
        stroke="${colOf(st.sel)}" stroke-width="${2 / st.scale}"/>`).join("");
    }
    if (st.draft) {
      const d = st.draft;
      html += `<rect x="${d[0]}" y="${d[1]}" width="${d[2]}" height="${d[3]}"
        fill="${colOf(st.sel)}" fill-opacity=".2" stroke="${colOf(st.sel)}" stroke-width="${sw}"
        stroke-dasharray="${5 / st.scale} ${4 / st.scale}" rx="${3 / st.scale}"/>`;
    }
    if (st.pend.length && st.pend.length < 3) {
      const ptStr = st.pend.map((q) => q.join(",")).join(" ");
      html += st.pend.length > 2
        ? `<polygon points="${ptStr}" fill="${colOf(st.sel)}" fill-opacity=".2" stroke="${colOf(st.sel)}" stroke-width="${sw}"/>`
        : `<polyline points="${ptStr}" fill="none" stroke="${colOf(st.sel)}" stroke-width="${sw}"/>`;
      html += st.pend.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="${r}"
        fill="${colOf(st.sel)}" stroke="#1a1206" stroke-width="${1.5 / st.scale}"/>`).join("");
    }
    svg.innerHTML = html;
  }

  const setRect = (idx, a, b) => {
    const L = Math.min(a[0], b[0]), R = Math.max(a[0], b[0]);
    const T = Math.min(a[1], b[1]), B = Math.max(a[1], b[1]);
    st.shapes[idx] = { kind: "rect", pts: [[L, T], [R, B]] };
  };
  const applyHandle = (idx, h, p) => {
    const s = st.shapes[idx];
    const [x, y] = clampPt(p[0], p[1]);
    if (s.kind === "poly") { s.pts[Number(h)] = [x, y]; return; }
    let [[L, T], [R, B]] = s.pts;
    if (h.includes("w")) L = x;
    if (h.includes("e")) R = x;
    if (h.includes("n")) T = y;
    if (h.includes("s")) B = y;
    setRect(idx, [L, T], [R, B]);
  };
  const moveShape = (idx, orig, dx, dy) => {
    const xs = orig.pts.map((q) => q[0]), ys = orig.pts.map((q) => q[1]);
    const ddx = Math.max(-Math.min(...xs), Math.min(dx, W() - Math.max(...xs)));
    const ddy = Math.max(-Math.min(...ys), Math.min(dy, H() - Math.max(...ys)));
    st.shapes[idx] = { kind: orig.kind, pts: orig.pts.map((q) => [q[0] + ddx, q[1] + ddy]) };
  };
  const emptySel = () => st.sel >= 0 && !st.shapes[st.sel];

  // Cmd/Ctrl + scroll (Ctrl = gest pinch na gladziku) = zoom; sam scroll =
  // przesuwanie powiekszonej mapy (bez zoomu przewija okno jak zwykle).
  zwrap.addEventListener("wheel", (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const b = zwrap.getBoundingClientRect();
      zoomAt(e.clientX - b.left, e.clientY - b.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    } else if (st.scale > 1) {
      e.preventDefault();
      st.tx -= e.deltaX;
      st.ty -= e.deltaY;
      clampView();
      apply();
    }
  }, { passive: false });

  zwrap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    zwrap.setPointerCapture(e.pointerId);
    st.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (st.ptrs.size === 2) {         // dwa palce = zoom/pan, nie edycja
      st.pinched = true; st.start = null; st.draft = null; st.drag = null;
      redraw();
      return;
    }
    if (st.ptrs.size !== 1) return;
    const p = imgPos(e);
    st.down = p;
    if (st.pend.length) {             // trwa rysowanie wielokąta: tap = punkt,
      if (handleAt(p) === null) return;  // chyba że trafiono w uchwyt (koniec rysowania)
      st.pend = [];
      if (cb.progress) cb.progress(0);
    }
    const h = handleAt(p);
    if (h !== null) {
      st.drag = { type: "handle", idx: st.sel, h };
      return;
    }
    const b = bodyAt(p);
    if (b >= 0) {
      if (b !== st.sel) { st.sel = b; if (cb.select) cb.select(b); redraw(); }
      st.drag = { type: "move", idx: b, from: p,
                  orig: JSON.parse(JSON.stringify(st.shapes[b])), moved: false };
      return;
    }
    if (emptySel() && st.mode === "rect") st.start = p;
  });

  zwrap.addEventListener("pointermove", (e) => {
    if (st.ptrs.has(e.pointerId)) {
      const prev = [...st.ptrs.values()];
      st.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (st.ptrs.size === 2) {
        const cur = [...st.ptrs.values()];
        const dist = (a) => Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
        const mid = (a) => [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
        const b = zwrap.getBoundingClientRect();
        const m0 = mid(prev), m1 = mid(cur);
        st.tx += m1[0] - m0[0];
        st.ty += m1[1] - m0[1];
        const d0 = dist(prev), d1 = dist(cur);
        if (d0 > 12) zoomAt(m1[0] - b.left, m1[1] - b.top, d1 / d0);
        else { clampView(); apply(); }
        return;
      }
    }
    if (!st.ptrs.size) return;
    const p = imgPos(e);
    if (st.drag) {
      if (st.drag.type === "handle") applyHandle(st.drag.idx, st.drag.h, p);
      else {
        const dx = p[0] - st.drag.from[0], dy = p[1] - st.drag.from[1];
        if (Math.hypot(dx, dy) * st.scale > 3) st.drag.moved = true;
        if (st.drag.moved) moveShape(st.drag.idx, st.drag.orig, dx, dy);
      }
      redraw();
    } else if (st.start) {
      st.draft = [Math.min(st.start[0], p[0]), Math.min(st.start[1], p[1]),
                  Math.abs(p[0] - st.start[0]), Math.abs(p[1] - st.start[1])];
      redraw();
    }
  });

  const endPtr = (e) => {
    const had = st.ptrs.delete(e.pointerId);
    const wasPinch = st.pinched;
    if (st.ptrs.size === 0) st.pinched = false;
    if (!had || wasPinch || e.type === "pointercancel") {
      st.start = null; st.draft = null; st.drag = null; redraw();
      return;
    }
    const p = imgPos(e);
    if (st.drag) {
      const d = st.drag;
      st.drag = null;
      if (d.type === "handle" || d.moved) { if (cb.change) cb.change(d.idx); }
      redraw();
      return;
    }
    if (st.start && st.mode === "rect") {
      const a = st.start;
      st.start = null; st.draft = null;
      if (Math.abs(p[0] - a[0]) >= 8 && Math.abs(p[1] - a[1]) >= 8) {
        setRect(st.sel, a, p);
        redraw();
        if (cb.change) cb.change(st.sel);
      } else redraw();
      return;
    }
    if (st.mode === "poly" && (emptySel() || st.pend.length) && !st.drag) {
      st.pend.push(p);
      // od trzeciego punktu kształt istnieje od razu (bez „zakończ"); kolejne
      // tapnięcia dodają punkty, aż użytkownik chwyci uchwyt / zmieni strefę
      if (st.pend.length >= 3) st.shapes[st.sel] = { kind: "poly", pts: st.pend.slice() };
      redraw();
      if (st.pend.length >= 3 && cb.change) cb.change(st.sel);
      if (cb.progress) cb.progress(st.pend.length);
    }
  };
  zwrap.addEventListener("pointerup", endPtr);
  zwrap.addEventListener("pointercancel", endPtr);

  const resetPend = () => {
    st.pend = []; st.draft = null; st.start = null;
    if (cb.progress) cb.progress(0);
  };
  return {
    setMode(m) { st.mode = m; resetPend(); redraw(); },
    getMode: () => st.mode,
    addRow() { st.shapes.push(null); st.sel = st.shapes.length - 1; resetPend(); redraw(); return st.sel; },
    removeRow(i) {
      st.shapes.splice(i, 1);
      if (!st.shapes.length) st.shapes.push(null);
      st.sel = Math.min(st.sel > i ? st.sel - 1 : st.sel, st.shapes.length - 1);
      resetPend(); redraw();
      return st.sel;
    },
    select(i) { st.sel = i; resetPend(); redraw(); },
    getSelected: () => st.sel,
    clearSelected() { if (st.sel >= 0) st.shapes[st.sel] = null; resetPend(); redraw(); },
    undoPoint() {
      if (!st.pend.length) return;
      st.pend.pop();
      st.shapes[st.sel] = st.pend.length >= 3 ? { kind: "poly", pts: st.pend.slice() } : null;
      redraw();
      if (cb.change) cb.change(st.sel);
      if (cb.progress) cb.progress(st.pend.length);
    },
    finishPoly() { resetPend(); redraw(); return true; },
    pendingCount: () => st.pend.length,
    shapes: () => st.shapes,
    redraw,
  };
}
