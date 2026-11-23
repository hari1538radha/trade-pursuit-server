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

**Option chain (Sensibull).** Each user pastes their own Sensibull session (cookie string or the whole copied curl) on the Options page. With the page open it pulls every 3 seconds through `POST /api/options/chain`.

**Roles.** Every account is a `user` or an `admin`. Users get Dashboard, Journal, News, Strategy, Analytics and Propfirm. Admins also get Options, Stocks, Goldbach, Notes, Quiz, Calm and **Traders** (every trader's journal and trade log, read-only, plus Make admin / Make user). The server enforces this: admin-only APIs answer 403 for users. Set `ADMIN_USERNAMES` (comma-separated) on the server for the first admin; those names are always admins.

**Server recorder.** A user can turn on server recording for up to 3 chains. The server then pulls each chain every 3 seconds from 9:15 to 15:30 IST, even with the site closed, and stores every update (`oiticks`, full per-strike OI whenever something changed, kept 3 days) plus 3-minute snapshots (`oisnapshots`, 14 days). For this the session is stored encrypted (AES-256-GCM) in `sbrecorders`; it is never returned by the API and is deleted with "Remove my session from the server" or account deletion. When an expiry passes, the recorder moves to the next expiry Sensibull has strikes for. An expired session marks the recorder `expired` until a fresh one is pasted.
- Encryption key: `SECRET_KEY` if set, otherwise derived from `JWT_SECRET`. Changing either makes stored sessions unreadable (users paste again).
- The recorder only runs while the server is awake. Render's free plan sleeps after ~15 minutes without traffic: use a paid instance, or point an uptime pinger (e.g. UptimeRobot, every 5 minutes) at `/api/health`.
- This uses an unofficial Sensibull endpoint: it can change or stop working, and frequent automated use may be against Sensibull's terms.

**Goldbach.** `GET /api/markets/goldbach?symbol=XAUUSD|XAGUSD&interval=15m|1h|4h|1d` returns COMEX futures candles shifted to spot (Stooq) plus the average daily range; the page computes the PO3 dealing ranges and Goldbach levels.

**Stocks (NSE end-of-day).** The server downloads NSE's public daily CM bhavcopy files, keeps ~300 days per symbol and re-runs the scanner after each evening's file. The first load backfills a year (a few minutes); later updates take seconds. It runs while the server is awake; Render's free plan sleeps after 15 idle minutes, so opening the Stocks page (or a free uptime monitor hitting `/api/health`) keeps it current.

## Endpoints
`/api/auth` (register, login, me, password) · `/api/trades` · `/api/accounts` · `/api/plans` (list, `/:date`) · `/api/notes` · `/api/quiz` · `/api/news?week=thisweek|nextweek` · `/api/markets/range?symbols=` · `/api/options/*` · `/api/stocks/*` · `/api/watchlist` · `/api/firms` · `/api/health`

The news endpoint reads the free Forex Factory weekly calendar export and caches it for 30 minutes, so the Render service needs outbound internet access (it has it by default).

Prop firm rules live in `src/data/firms.json`.
