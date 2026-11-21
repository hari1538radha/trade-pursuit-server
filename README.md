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

## Endpoints
`/api/auth` (register, login, me, password) · `/api/trades` · `/api/accounts` · `/api/plans/:date` · `/api/posts` · `/api/firms` · `/api/health`

Prop firm rules live in `src/data/firms.json`.
