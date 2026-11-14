/**
 * Equal Earth projection (Šavrič, Patterson & Jenny, 2018).
 *
 * Raw projected coordinates, in the same units as d3-geo's geoEqualEarth.
 * The map wraps these in a Leaflet CRS; keeping the formulas here makes them
 * independently testable in Node without a DOM or Leaflet.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const DEG = Math.PI / 180;

export interface EqualEarthPoint {
  x: number;
  y: number;
}

export interface EqualEarthLngLat {
  lng: number;
  lat: number;
}

export function projectEqualEarth(
  lng: number,
  lat: number,
): EqualEarthPoint {
  const lambda = lng * DEG;
  const phi = Math.max(-90, Math.min(90, lat)) * DEG;
  const theta = Math.asin(M * Math.sin(phi));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  return {
    x:
      (lambda * Math.cos(theta)) /
      (M * (A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2))),
    y: theta * (A1 + A2 * theta2 + theta6 * (A3 + A4 * theta2)),
  };
}

export function unprojectEqualEarth(
  x: number,
  y: number,
): EqualEarthLngLat {
  let theta = y;
  let theta2 = theta * theta;
  let theta6 = theta2 * theta2 * theta2;

  for (let index = 0; index < 12; index += 1) {
    const fy =
      theta * (A1 + A2 * theta2 + A3 * theta6 + A4 * theta2 * theta6) - y;
    const fpy =
      A1 + 3 * A2 * theta2 + 7 * A3 * theta6 + 9 * A4 * theta2 * theta6;
    const delta = fy / fpy;
    theta -= delta;
    theta2 = theta * theta;
    theta6 = theta2 * theta2 * theta2;
    if (Math.abs(delta) < 1e-12) break;
  }

  const lambda =
    (x * M * (A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2))) /
    Math.cos(theta);
  return {
    lng: lambda / DEG,
    lat: Math.asin(Math.sin(theta) / M) / DEG,
  };
}

export const EQUAL_EARTH_X_MAX = projectEqualEarth(180, 0).x;
export const EQUAL_EARTH_Y_MAX = Math.abs(projectEqualEarth(0, 90).y);
