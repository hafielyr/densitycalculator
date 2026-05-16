# Density Observer

A mobile-first **PWA** for surveyors recording crowd density in the field — Jacobs method, 5-tier classification, offline-first.

Built per [issue #1](../../issues/1). Single page, vanilla JS + Alpine.js + Tailwind CDN, IndexedDB (Dexie). No build step, no backend required.

## Features

- **Form observasi** — surveyor, segmen, GPS auto-capture (with manual fallback), dimensi area, klasifikasi densitas 5-tier (L/M/C/D/DG), auto-calc estimasi orang (override manual), cuaca, foto wajib (auto-compressed < 500KB), insiden.
- **Decision Tree Wizard** — 4-pertanyaan modal step-by-step. Otomatis pilih klasifikasi densitas dan trigger DG alert ke Coordinator.
- **Auto-Reminder** — countdown 15 menit di header, beep + vibrate + Web Notification saat habis.
- **Offline-first** — Service Worker cache app shell; IndexedDB simpan observasi lokal; `pending` → `synced` ke webhook saat online.
- **Export** — CSV (siap masuk spreadsheet) atau JSON (full payload) dari daftar observasi.
- **Mobile UX** — touch target ≥ 44×44px, dark mode otomatis (prefers-color-scheme + toggle), bottom action bar di thumb zone.

## Stack

| Layer | Pilihan |
| ----- | ------- |
| UI | Vanilla HTML + [Alpine.js 3](https://alpinejs.dev/) (CDN) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (CDN, `cdn.tailwindcss.com`) |
| Storage | [Dexie 4](https://dexie.org/) (IndexedDB wrapper) |
| PWA | Service Worker + Web Manifest |
| Sync (optional) | POST JSON ke webhook URL apa pun (Google Apps Script / Make / Netlify Function / dst.) |

## Run locally

App ini static file murni. Pakai static server apa saja — **harus** lewat HTTP/HTTPS (bukan `file://`) supaya Service Worker, Geolocation, dan kamera berfungsi.

```bash
# Node (built-in tidak ada server, pakai package mana saja)
npx http-server . -p 8765

# atau Python 3
python -m http.server 8765
```

Buka <http://localhost:8765/index.html> di browser. Untuk test mobile-real, buka via IP LAN dari HP (perlu HTTPS untuk SW di sebagian browser — tunnel via [ngrok](https://ngrok.com/) atau [cloudflared](https://github.com/cloudflare/cloudflared) bila perlu).

## Install sebagai aplikasi

1. Buka di Chrome / Edge mobile.
2. Menu (⋮) → **Install app** / **Add to Home screen**.
3. Setelah terinstall, jalankan dari home screen (mode standalone, fullscreen).

## Konfigurasi

Buka **Setting** (gear icon) → **Konfigurasi (lanjutan)**:

- **Daftar Surveyor** — satu baris per orang, format `id|nama`. Contoh:
  ```
  svy01|Ardi
  svy02|Budi
  svy03|Citra
  ```
- **Daftar Segmen** — pisahkan koma. Contoh: `A1, A2, B1, B2, C1, C2`.
- **Webhook URL** — opsional. Tiap observasi ter-POST sebagai JSON; HTTP 2xx menandai record sebagai `synced`.

Konfigurasi disimpan di IndexedDB (per device).

## Workflow lapangan

1. **Mulai sesi** — pilih nama surveyor + segmen → tombol **Mulai Sesi Observasi**.
2. **Observasi pertama** — GPS auto-lock, isi dimensi, gunakan Decision Tree (atau pilih manual) → ambil foto landscape → **Simpan**.
3. **Reminder 15 menit** — saat timer berbunyi, ambil foto baru, dimensi baru, simpan lagi. Surveyor + segmen sudah terisi otomatis.
4. **Akhir shift** — buka **Daftar** → **Export CSV/JSON** untuk handover, atau **Sync** kalau webhook diset.

## Data schema

Tiap observasi disimpan di IndexedDB sebagai berikut (lihat [`db.js`](db.js) dan [`app.js#submit`](app.js)):

```js
{
  id: "uuid",
  surveyorId, surveyorName, segmentCode,
  coordinates: { lat, lng, accuracy },
  dimensions:  { width, length, area },
  timestamp,
  densityClass: "L|M|C|D|DG",
  densityFactor,
  estimatedPeople: { auto, manual, isOverridden },
  weather: "cerah|berawan|hujan_ringan|hujan_deras",
  photo: { dataUrl, timestamp, size },
  incident: { category, notes },
  decisionTreePath: ["P1:Y","P2:N",...],
  syncStatus: "local|pending|synced",
  createdAt, updatedAt
}
```

## Files

| File | Isi |
| ---- | --- |
| `index.html` | Single-page shell + Alpine templates |
| `app.js` | Komponen Alpine + helper (kompresi foto, CSV, decision tree, reminder timer, sync) |
| `db.js` | Dexie schema (observations, config) |
| `styles.css` | Custom overrides (touch targets, kontras tinggi) |
| `manifest.json` | PWA manifest |
| `sw.js` | Service Worker (network-first nav, stale-while-revalidate aset) |
| `icons/` | PWA icons (192/512 PNG + SVG) |

## Deploy

Karena tidak ada build step, deploy ke static host apa pun:

- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop folder atau hubungkan repo.
- **GitHub Pages** — set source ke `main` branch.
- Pastikan host melayani `sw.js` dengan header `Service-Worker-Allowed: /` jika SW tidak satu folder dengan halaman.

## Catatan implementasi

- **Foto** dikompresi via canvas (max dimensi 1600px, quality loop sampai < 500KB JPEG). Foto portrait tetap diterima tapi diberi peringatan agar surveyor mengulang dengan orientasi landscape.
- **Decision tree** menyimpan jejak jawaban (`decisionTreePath`) sebagai audit trail.
- **Reminder timer** memakai `setTimeout` (bukan Web Workers / Background Sync) — tab harus tetap aktif. Untuk reminder 100% reliable di latar belakang, tambahkan `serviceWorker` periodic sync (memerlukan permission khusus).
- **DG alert** mem-POST payload `{ type: "COORDINATOR_ALERT", ... }` ke webhook bila diset.

## Lisensi

MIT — silakan adaptasi untuk kebutuhan operasional Anda.
