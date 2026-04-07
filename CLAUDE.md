# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CustomerReport is an accounts receivable dashboard (cuentas por cobrar) for FinanzasMIT. Users import Excel files with customer data across multiple business segments, view KPIs and charts, and track weekly trends via snapshots.

## Tech Stack

- **Frontend:** Single-file vanilla JS SPA (`public/index.html`, ~2600 lines with inline CSS/JS)
- **Backend:** Express 5 + Mongoose on Vercel serverless (`api/index.js`)
- **Database:** MongoDB Atlas (cluster: FinanzasMIT, db: customerreport_db)
- **Deployment:** Vercel (static `public/` folder + serverless `/api` function)
- **Auth:** NFC card UID / QR code (Web NFC API for Android, QR for iOS)

## Commands

```bash
# Local development
npm start                  # Starts Express on http://localhost:3600

# Deploy to production
npx vercel --prod --yes    # Deploy to Vercel

# After editing public/index.html, sync root copy
cp public/index.html index.html
```

## Architecture

### Two entry points for the backend

- `server.js` — Local development server (port 3600), serves static files from root, hardcoded MongoDB URI fallback
- `api/index.js` — Vercel serverless function, uses `process.env.MONGO_URI`, exports Express app as `module.exports`

Both share identical route logic. When changing API routes, **update `api/index.js`** (production) and optionally `server.js` (local dev).

### Vercel routing

`vercel.json` rewrites all `/api/*` requests to the single `api/index.js` function. Static files are served from `public/`. The root `index.html` is only used by `server.js` locally.

### Database collections

Five customer collections share the same schema (customer, company, bought, paid, balance, rate, daysAgo, sr1, sr2, etc.): `rawdata`, `balance`, `employees`, `lorena`, `notassigned`. Models are created dynamically from a `TABS` config object.

Supporting collections: `imports` (import metadata), `snapshots` (weekly trend data), `users` (NFC auth).

### Frontend structure

`public/index.html` is a monolithic SPA with everything inline:
- CSS variables at top (`:root` and `[data-theme="dark"]`)
- Responsive breakpoints at 1100px, 768px, 420px
- Tab system: Dashboard + 5 data tabs, bottom sheet bar with animated slider
- Charts rendered on HTML5 Canvas (no Chart.js) — `drawLineChart`, `drawDonutChart`, `drawSRChart`
- Dark mode toggle persisted in `localStorage('theme')`
- Swipe gestures for tab navigation on mobile

Key global state: `allData[]`, `tabState{}`, `activeTab`, `hasData`

### API routes

**Data:** `GET /api/customers`, `GET /api/tab/:tab`, `GET /api/tabs`, `POST /api/import`, `POST /api/import-all`, `GET /api/status`

**Snapshots:** `POST /api/snapshot` (upsert by date), `GET /api/snapshots`, `DELETE /api/snapshot/:id`

**Auth:** `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/users`, `DELETE /api/auth/users/:id`, `GET /api/auth/seed`

### PWA

`manifest.json`, `sw.js` (cache-first for static, network-first for API), icons in `public/icons/`.

## Environment Variables (Vercel)

- `MONGO_URI` — MongoDB Atlas connection string (required for production)

## Important Patterns

- Mongoose models use `mongoose.models[name] || mongoose.model(...)` pattern to avoid recompilation in serverless cold starts
- The `connectDB()` function guards against duplicate connections with an `isConnected` flag
- Frontend uses `window.location.origin + '/api'` as API base — works identically in local and production
- Excel import replaces all data in target collections (`deleteMany` + `insertMany`)
- Charts read theme colors via `getThemeColor('--var-name')` and `isDarkMode()` helpers for dark mode support
