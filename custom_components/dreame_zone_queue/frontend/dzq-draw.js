/* Wspólny widget rysowania po mapie — używany przez modal „Własna strefa"
 * (karta kolejki) i zakładkę „Kalibracja mapy" (panel Zone Queue).
 *
 *  · prostokąt: przeciągnięcie jednym palcem / myszą,
 *  · wielokąt: dodawanie punktów tapnięciami (min. 3), finish() kończy,
 *  · zoom: kółko myszy ORAZ pinch dwoma palcami; dwa palce też przesuwają
 *    mapę — dzięki temu na telefonie da się rysować precyzyjnie,
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
    let html = "";
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

  zwrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const b = zwrap.getBoundingClientRect();
    zoomAt(e.clientX - b.left, e.clientY - b.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
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
  };
}

/* Domyślny tryb: na ekranach dotykowych punkty (tapnięcia są łatwiejsze
 * niż precyzyjne przeciąganie), na desktopie prostokąt. */
export function defaultMode() {
  return matchMedia("(pointer: coarse)").matches ? "poly" : "rect";
}
