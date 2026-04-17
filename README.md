# CustomerReport — FinanzasMIT

Dashboard ejecutivo de cuentas por cobrar (accounts receivable). Los usuarios importan reportes Excel con datos de clientes segmentados por área, visualizan KPIs y gráficas, y registran snapshots semanales para comparativas de tendencia.

- **Producción:** https://customer-report-seven.vercel.app
- **Repositorio:** https://github.com/Lxrala21/CustomerReport
- **Local dev:** http://localhost:3600

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | SPA single-file en vanilla JS (`public/index.html`, ~2600 líneas) |
| Backend | Express 5 + Mongoose sobre Vercel serverless (`api/index.js`) |
| DB | MongoDB Atlas (cluster `FinanzasMIT`, db `customerreport_db`) |
| Deploy | Vercel (`vercel.json` — estático desde `public/` + función `/api`) |
| Auth | NFC card UID (Web NFC API Android) + QR code (iOS) |
| Librerías | xlsx-js-style, ExcelJS, jsPDF (export PDF), Chart.js canvas nativo |

---

## Arquitectura

### Dos entry points del backend

- `server.js` — servidor local (puerto 3600). Sirve archivos estáticos desde la raíz y tiene URI de MongoDB de fallback hardcodeado.
- `api/index.js` — función serverless de Vercel. Usa `process.env.MONGO_URI` y exporta la app Express como `module.exports`.

Ambos comparten la misma lógica de rutas. Al modificar rutas del API, **actualiza `api/index.js`** (producción) y opcionalmente `server.js` (dev local).

### Ruteo Vercel

`vercel.json` redirige todos los `/api/*` a la función `api/index.js`. Los estáticos se sirven desde `public/`. El `index.html` de la raíz sólo se usa localmente por `server.js` — se mantiene sincronizado con `public/index.html` como copia espejo.

> **Después de editar `public/index.html`:**
> ```bash
> cp public/index.html index.html
> ```

### Colecciones MongoDB

Cinco colecciones de clientes comparten el mismo schema (creadas dinámicamente desde el objeto `TABS`):

| Key | Colección | Propósito |
|-----|-----------|-----------|
| `rawdata` | `rawdata` | Fuente de verdad — todos los clientes |
| `balance` | `balance` | Subset con `balance > 0` |
| `employees` | `employees` | Clientes con SR1 asignado |
| `lorena` | `lorena` | Clientes asignados a Lorena Campos |
| `notassigned` | `notassigned` | Sin SR asignado o con "Not Assigned" (incluye Miguel Ferrer) |

Colecciones auxiliares:

- `imports` — metadata del último import (`reportTitle`, `tabs`, `totalRecords`, `importedAt`)
- `previousrawdata` + `previousmeta` — snapshot de `rawdata` anterior, para comparativas
- `snapshots` — datos semanales agregados para la gráfica de tendencia
- `users` — auth NFC/QR

### Schema de cliente (17 campos)

```js
{
    customer:   String,  // Nombre del cliente con CID
    company:    String,
    email:      String,
    phone:      String,
    bought:     Number,  // Total Purchased USD
    boughtMXN:  Number,
    paid:       Number,
    paidMXN:    Number,
    balance:    Number,
    balanceMXN: Number,
    rate:       Number,  // Exchange rate
    firstDate:  Date,
    lastDate:   Date,
    daysAgo:    Number,  // Días desde última compra
    sr1:        String,  // Sales Representative 1 (email o "Not Assigned")
    sr2:        String,
    enteredBy:  String,  // Quién capturó el cliente en el sistema
}
```

### Estructura frontend

`public/index.html` es una SPA monolítica con todo inline:

- Variables CSS en `:root` y `[data-theme="dark"]` para el tema oscuro
- Breakpoints responsive: 1100px, 768px, 420px
- Sistema de tabs: Dashboard + 5 tabs de datos, con bottom sheet bar y slider animado
- Gráficas dibujadas en HTML5 Canvas (sin Chart.js para el dashboard) — `drawLineChart`, `drawDonutChart`, `drawSRChart`
- Toggle dark/light persistido en `localStorage('theme')`
- Swipe gestures para navegar tabs en móvil

Estado global principal: `allData[]`, `tabState{}`, `activeTab`, `hasData`, `window._tabsData`, `window._snapshots`.

---

## Rutas del API

### Datos de clientes

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/customers` | Todos los clientes de `rawdata` + meta del último import |
| `GET` | `/api/tab/:tab` | Datos de una pestaña (`rawdata`, `balance`, `employees`, `lorena`, `notassigned`) |
| `GET` | `/api/tabs` | Conteos por pestaña + metadata |
| `GET` | `/api/status` | Estado de conexión y conteos |
| `POST` | `/api/import` | Importa sólo `rawdata` (legacy) |
| `POST` | `/api/import-all` | Importa todas las pestañas de golpe (flujo principal) |
| `GET` | `/api/previous-rawdata` | Snapshot del import anterior para comparativa |

### Snapshots semanales

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/snapshot` | Upsert por día (normaliza a inicio del día) |
| `GET` | `/api/snapshots` | Lista ordenada por fecha |
| `DELETE` | `/api/snapshot/:id` | Elimina un snapshot |

### Auth (NFC / QR)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/auth/seed` | Crea usuario admin si no hay ninguno |
| `POST` | `/api/auth/login` | Login con `cardUID` |
| `POST` | `/api/auth/register` | Registra tarjeta nueva |
| `GET` | `/api/auth/users` | Lista usuarios (admin) |
| `DELETE` | `/api/auth/users/:id` | Elimina usuario |

---

## Features del frontend

### Dashboard

- **KPIs:** Total Purchased, Balance, No Payment record, Total Paid
- **Gráfica semanal:** tendencia de Purchased / Paid / Balance en base a snapshots
- **Recency:** buckets de últimos días (`0-7`, `8-30`, `31-90`, `91-180`, `181-365`, `365+`)
- **Top 5 Customers** por balance pendiente
- **Balance por Representative (SR1)** con conteos y % pendiente

### Tabs de datos

Cada tab (Balance Details, Not Assigned, per-rep, Raw Data) soporta:

- Orden por cualquier columna (click en header)
- Filtro por SR y texto libre
- Paginación
- Renglones expandibles para ver detalle completo

### Import Excel

Formatos aceptados: `.xlsx`, `.xls`, `.csv`. El parser:

1. Detecta el header row buscando "Customer" en los primeros 10 renglones (Strategy 1)
2. Si no, intenta usar las keys del JSON como headers directamente (Strategy 2)
3. Mapea cada columna contra el array `COLS` con fuzzy matching (normaliza espacios/caso)
4. Convierte money a número, fechas con normalización (`"Aug 27 2025  8:38AM"` → Date), texto trimmed

Si el Excel trae sólo una hoja (`Sheet 1`), se usa como `rawdata` y se derivan las otras pestañas automáticamente con los mismos filtros.

### Export Excel (con estilos)

`exportDashboard()` genera un workbook con ExcelJS:

- **Dashboard** — hoja con KPIs, recency, Top 5 y Balance by Representative (estilos Calibri, alternancia de colores, formatos `$#,##0`, `0.0%`)
- **Balance Details** — clientes con balance > 0
- **Not Assigned** — incluye rows de Miguel Ferrer
- **Una hoja por SR1** (excepto Miguel Ferrer, que va en Not Assigned)
- **Raw Data** — todos los clientes

Headers (17 columnas):
`Customer, Company, Email, Cellphone, Total Purchased, Total MXN, Paid, Paid MXN, Balance USD, Balance MXN, Exchange Rate, First Purchase Date, Last Purchase Date, Last Purchase Days Ago, SR1, SR2, EnteredBy`

### Reporte comparativo

Compara el rawdata actual contra `previousrawdata` y exporta un Excel con:

- Filas modificadas (campo, anterior, nuevo, diferencia)
- Filas nuevas y eliminadas
- Agregados por SR

### PWA

`manifest.json` + `sw.js` (cache-first para estáticos, network-first para API). Iconos en `public/icons/`. Instalable en móvil.

### iOS companion app

Carpeta `ios/CustomerReportNFC/` — proyecto Xcode para una app nativa que lee tarjetas NFC y abre la web con el UID como query param.

---

## Reglas de negocio importantes

### Miguel Ferrer → Not Assigned

Por decisión de negocio, las filas donde SR1 o SR2 contienen `miguel.ferrer@...` se mergean con el grupo "Not Assigned":

- `cleanSR()` devuelve `'No Asignado'` si el valor incluye `miguel.ferrer`
- El filtro de la tab `notassigned` incluye esas filas
- El export los mapea a `"Not Assigned"` en SR1/SR2
- **No se crea hoja separada** "Miguel Ferrer" en el Excel exportado

### Formato de fechas en Excel fuente

Las fechas llegan como strings tipo `"Aug 27 2025  8:38AM"` o `"Apr  4 2026 12:26PM"` — dos espacios de padding para día/hora sencilla y sin espacio antes de AM/PM. El parser las normaliza antes de `new Date()`.

### Cache de modelos Mongoose

Los modelos usan `mongoose.models[name] || mongoose.model(...)` para evitar recompilación en cold starts de serverless. Al cambiar el schema, los warm instances pueden quedarse con el modelo viejo hasta que Vercel los recicle — un deploy nuevo basta.

---

## Variables de entorno (Vercel)

- `MONGO_URI` — connection string de MongoDB Atlas (requerido en producción)

Local: el `server.js` tiene un fallback hardcoded para desarrollo.

---

## Comandos

### Desarrollo local

```bash
cd C:/Users/User/Desktop/FinanzasMIT/CustomerReport
npm start                  # Express en http://localhost:3600
```

### Sincronizar frontend antes de deploy

```bash
cp public/index.html index.html
```

### Deploy a producción

```bash
git add -A && git commit -m "…" && git push origin master
npx vercel --prod --yes     # además fuerza rebuild en Vercel
```

GitHub está conectado a Vercel para auto-deploys en `master`.

---

## Estructura del repo

```
CustomerReport/
├── api/
│   └── index.js             # Serverless function (rutas API + schemas Mongoose)
├── public/
│   ├── index.html           # SPA monolítica (fuente de verdad)
│   ├── login.html           # Pantalla NFC/QR login
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker
│   ├── qr-admin.png         # QR de emergencia para login admin
│   └── icons/               # Iconos PWA
├── ios/
│   ├── CustomerReportNFC/   # App iOS nativa (Swift)
│   └── CustomerReportNFC.xcodeproj
├── server.js                # Servidor local (espejo de api/index.js)
├── index.html               # Copia de public/index.html (solo para server.js local)
├── vercel.json              # Rewrites /api/* → api/index.js
├── package.json
├── generate_report.py       # Helper Python para generar Excel (offline)
├── template_cr.xlsx         # Plantilla Excel de referencia
├── START-SERVER.bat         # Windows: arranca el server local
├── CLAUDE.md                # Guía para Claude Code
└── README.md                # Este documento
```

---

## Troubleshooting común

### "No veo valores de `enteredBy` / `firstDate` / `lastDate`"

- Verifica que el Excel de origen tenga la columna con datos (no sólo el header vacío).
- Si llegó un Excel con fechas en el formato `"Aug 27 2025  8:38AM"`, confirma que el parser normaliza espacios y AM/PM.
- Puedes forzar re-importar usando el archivo `Documents/CustomerReport_2026-04-1721.xlsx` como referencia — tiene datos completos.

### "El deploy no refleja los cambios"

- Vercel cachea funciones serverless warm. Haz un deploy nuevo con `npx vercel --prod --yes` para forzar cold start.
- Si es un cambio de schema Mongoose, los modelos cached en warm instances persisten hasta el reciclaje — usa deploy nuevo.

### "Los modelos mongoose dan error `OverwriteModelError`"

Usa siempre el patrón `mongoose.models[name] || mongoose.model(...)` al declarar modelos en `api/index.js`. Es necesario porque Vercel reutiliza el runtime entre requests.

### "No encuentra la pestaña X del Excel al importar"

Revisa `SHEET_MAP` en `public/index.html:1431`. Las pestañas no mapeadas se ignoran salvo en el fallback single-sheet. Añade el nombre en lowercase si necesitas mapear otra.

---

## Historial reciente (2026-04-17)

- Agregado campo `enteredBy` al schema y al pipeline completo (import → DB → export)
- Miguel Ferrer mergeado en "Not Assigned" en cleanSR, filtros y export
- Export Excel restaurado al formato con Dashboard + pestañas por SR1 + estilos
- Fix: `toPayload()` dejaba fuera `enteredBy` al enviar a MongoDB
- Fix: parser de fechas en migración script normaliza `"Mes dd YYYY h:mmAM/PM"` con espacios dobles
- Migración de DB: poblada con `CustomerReport_2026-04-1721.xlsx` (1045 rows, 902 con EnteredBy, 979 con fechas)
