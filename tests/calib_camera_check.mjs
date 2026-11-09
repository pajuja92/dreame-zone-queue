// node tests/calib_camera_check.mjs — przelicznik px->mm z calibration_points kamery
import assert from "node:assert/strict";
import { calibFromCamera, mmToPx, roomOf } from "../custom_components/dreame_zone_queue/frontend/dzq-draw.js";

const mm = (c, nx, ny) => [c.ax * nx + c.axy * ny + c.bx, c.ayx * nx + c.ay * ny + c.by];
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));

// bez rotacji: 1 px = 50 mm, os Y odwrocona (format integracji dreame)
const cp = [
  { vacuum: { x: 0, y: 0 }, map: { x: 400, y: 600 } },
  { vacuum: { x: 1000, y: 0 }, map: { x: 420, y: 600 } },
  { vacuum: { x: 0, y: 1000 }, map: { x: 400, y: 580 } },
];
const c = calibFromCamera(cp);
near(mm(c, 400, 600), [0, 0]);
near(mm(c, 500, 500), [5000, 5000]);

// mapa obrocona o 90°: x_px rosnie z y_mm
const r = calibFromCamera([
  { vacuum: { x: 0, y: 0 }, map: { x: 100, y: 100 } },
  { vacuum: { x: 1000, y: 0 }, map: { x: 100, y: 120 } },
  { vacuum: { x: 0, y: 1000 }, map: { x: 120, y: 100 } },
]);
near(mm(r, 150, 110), [500, 2500]);

// mm -> px: odwrotnosc calibFromCamera (takze z obrotem) i recznej kalibracji
near(mmToPx(c)(0, 0), [400, 600]);
near(mmToPx(c)(5000, 5000), [500, 500]);
near(mmToPx(r)(500, 2500), [150, 110]);
near(mmToPx(r)(...mm(r, 37, 81)), [37, 81]);
near(mmToPx({ ax: 50, bx: -20000, ay: -50, by: 30000 })(5000, 5000), [500, 500]);

assert.equal(calibFromCamera(undefined), null);
assert.equal(calibFromCamera(cp.slice(0, 2)), null);
assert.equal(calibFromCamera([cp[0], cp[0], cp[1]]), null);   // punkty wspolliniowe
// pokoj strefy = najwieksza czesc wspolna; poza pokojami -> ""
const rooms = { Salon: [0, 0, 5000, 4000], Kuchnia: [5000, 0, 8000, 4000] };
assert.equal(roomOf([4000, 1000, 5500, 2000], rooms), "Salon");
assert.equal(roomOf([4800, 1000, 6000, 2000], rooms), "Kuchnia");
assert.equal(roomOf([9000, 9000, 9500, 9500], rooms), "");
console.log("calib_camera_check OK");
