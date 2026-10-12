/* „Gdzie poszedł czas" — pasek podziału czasu kolejki (dane: breakdown
 * z backendu, sekundy). Wspólny dla karty historii kolejek i karty
 * diagnostyki. Postój kolejki (idle) jest pokazywany osobno i nie wchodzi
 * do paska — to czas, gdy nikt nie kazał robotowi sprzątać. */

export const TIME_PARTS = [
  ["cleaning", "sprzątanie", "#2ecc71"],
  ["charging", "ładowanie", "#f1c40f"],
  ["washing", "mycie mopa", "#3498db"],
  ["dock", "dok / dojazdy", "#9b59b6"],
  ["error", "błędy", "#e74c3c"],
  ["paused", "pauzy", "#95a5a6"],
];

export const fmtDur = (sec) => {
  const min = Math.round((sec || 0) / 60);
  if (min < 1) return `${Math.round(sec || 0)} s`;
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

export const TIME_CSS = `
  .tbar { display: flex; height: 14px; border-radius: 7px; overflow: hidden;
          background: var(--divider-color); margin: 6px 0; }
  .tbar span { display: block; height: 100%; }
  .tleg { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .8em;
          color: var(--secondary-text-color); }
  .tleg i { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
            margin-right: 4px; vertical-align: middle; }
`;

export function breakdownHtml(b) {
  if (!b) return "";
  const work = (b.total || 0) - (b.idle || 0);
  if (work <= 0) return "";
  const parts = TIME_PARTS.filter(([k]) => b[k] > 0);
  const bar = parts.map(([k, label, color]) =>
    `<span style="width:${(100 * b[k]) / work}%;background:${color}"
       title="${label}: ${fmtDur(b[k])}"></span>`).join("");
  const leg = parts.map(([k, label, color]) =>
    `<span><i style="background:${color}"></i>${label} ${fmtDur(b[k])}
       (${Math.round((100 * b[k]) / work)}%)</span>`).join("");
  const idle = b.idle > 0
    ? `<span>postój kolejki ${fmtDur(b.idle)} (nie wliczony)</span>` : "";
  return `<div class="tbar">${bar}</div><div class="tleg">${leg}${idle}</div>`;
}
