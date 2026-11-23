# Trade Pursuit — API server

Express + MongoDB (Atlas) API for Trade Pursuit. Deploy on Render; the React client is a separate project on Vercel.

## Run locally
```bash
cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
npm install
npm run dev            # http://localhost:4000
npm test               # API tests (no database needed)
```

## Deploy on Render (free)
New → Web Service → pick this repository.

| Setting | Value |
|---|---|
| Root Directory | *(empty)* |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | Free |

Environment variables:

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your Atlas connection string |
| `JWT_SECRET` | long random string |
| `CLIENT_ORIGIN` | your Vercel URL(s), comma-separated, e.g. `https://trade-pursuit.vercel.app,https://trade-pursuit-*.vercel.app` |

In MongoDB Atlas → Network Access, allow `0.0.0.0/0` (Render's IPs change).

Check it: `https://<your-service>.onrender.com/api/health` → `{"ok":true}`.

Free services sleep after 15 minutes idle and take about a minute to wake on the next request.

## Market data

**Option chain (Sensibull).** Each user pastes their own Sensibull session (cookie string or the whole copied curl) on the Options page. It is kept only in that user's browser and sent with each refresh; the server uses it for that one request, never stores or logs it, and allows at most one refresh per user every 20 seconds. Snapshots of the derived OI totals are saved while the page is open during market hours (kept 14 days) for the time charts. This uses an unofficial Sensibull endpoint: it can change or stop working, and using it may be against Sensibull's terms.

**Stocks (NSE end-of-day).** The server downloads NSE's public daily CM bhavcopy files, keeps ~300 days per symbol and re-runs the scanner after each evening's file. The first load backfills a year (a few minutes); later updates take seconds. It runs while the server is awake; Render's free plan sleeps after 15 idle minutes, so opening the Stocks page (or a free uptime monitor hitting `/api/health`) keeps it current.

## Endpoints
`/api/auth` (register, login, me, password) · `/api/trades` · `/api/accounts` · `/api/plans` (list, `/:date`) · `/api/notes` · `/api/quiz` · `/api/news?week=thisweek|nextweek` · `/api/markets/range?symbols=` · `/api/options/*` · `/api/stocks/*` · `/api/watchlist` · `/api/firms` · `/api/health`

The news endpoint reads the free Forex Factory weekly calendar export and caches it for 30 minutes, so the Render service needs outbound internet access (it has it by default).

Prop firm rules live in `src/data/firms.json`.
