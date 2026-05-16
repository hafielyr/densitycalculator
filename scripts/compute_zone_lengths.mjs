#!/usr/bin/env node
/**
 * Compute per-zone segment length from each zone's Google Maps URL and write
 * the results back into zona_maps.json as `panjang_m`. Also seeds `lebar_m`
 * with a sensible default (6 m) for any zone missing it — surveyors edit at
 * runtime, but every zone needs a starting value.
 *
 * Usage: node scripts/compute_zone_lengths.mjs
 *
 * Each maps_url contains either `/dir/lat1,lng1/lat2,lng2/...` (directions) or
 * a `place` URL with embedded `!1d<lng>!2d<lat>` pairs. We pick the first two
 * geographic points in URL order and compute the great-circle distance.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '..', 'zona_maps.json');
const DEFAULT_LEBAR_M = 6;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function extractCoordPairs(url) {
  // Strip the `@lat,lng,zoomz` camera token so we don't pick it up as a waypoint
  const cleaned = url.replace(/@-?\d+\.\d+,-?\d+\.\d+,[\d.]+[azm]/g, '@CAMERA');
  const dir = [];
  const poi = [];
  const llRe = /[/|](-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/g;
  let m;
  while ((m = llRe.exec(cleaned))) {
    dir.push({ pos: m.index, lat: +m[1], lng: +m[2] });
  }
  const plRe = /!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g;
  while ((m = plRe.exec(cleaned))) {
    poi.push({ pos: m.index, lat: +m[2], lng: +m[1] });
  }
  return { dir, poi };
}

function pickEndpointsFromSources({ dir, poi }) {
  // Prefer two waypoints from the /dir/ path: they are the segment endpoints.
  if (dir.length >= 2) return [dir[0], dir[dir.length - 1]];
  // One /dir/ waypoint + one POI: combine them in URL order.
  if (dir.length === 1 && poi.length >= 1) {
    const all = [...dir, ...poi].sort((a, b) => a.pos - b.pos);
    return [all[0], all[all.length - 1]];
  }
  // No /dir/ waypoints: use first and last POI references.
  if (poi.length >= 2) return [poi[0], poi[poi.length - 1]];
  return null;
}


const raw = JSON.parse(await readFile(FILE, 'utf8'));
let total = 0;
let computed = 0;
for (const z of raw.zona) {
  const sources = extractCoordPairs(z.maps_url || '');
  const ends = pickEndpointsFromSources(sources);
  if (ends) {
    const d = haversineMeters(ends[0].lat, ends[0].lng, ends[1].lat, ends[1].lng);
    z.panjang_m = Math.round(d * 10) / 10;
    total += z.panjang_m;
    computed++;
  } else {
    z.panjang_m = raw.per_zona_meter ?? 96.8;
    console.warn(`Zone ${z.no}: no coords parsed; fallback to ${z.panjang_m}`);
  }
  if (typeof z.lebar_m !== 'number') z.lebar_m = DEFAULT_LEBAR_M;
}

await writeFile(FILE, JSON.stringify(raw, null, 2) + '\n', 'utf8');
console.log(`Wrote ${FILE}`);
console.log(`Computed panjang_m for ${computed}/${raw.zona.length} zones; sum=${total.toFixed(1)} m (route total ${raw.total_rute_meter} m).`);
