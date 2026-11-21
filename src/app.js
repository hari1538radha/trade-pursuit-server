import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import tradeRoutes from './routes/trades.js';
import accountRoutes from './routes/accounts.js';
import planRoutes from './routes/plans.js';
import postRoutes from './routes/posts.js';
import friendRoutes from './routes/friends.js';
import { getNews } from './lib/news.js';
import { HttpError } from './lib/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const firms = JSON.parse(readFileSync(path.join(here, 'data/firms.json'), 'utf8'));

// CLIENT_ORIGIN is a comma-separated list. An entry may use * as a wildcard,
// e.g. https://trade-pursuit-*.vercel.app to allow Vercel preview deployments.
const originRules = config.clientOrigins.map((o) =>
  o.includes('*') ? new RegExp('^' + o.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+') + '$') : o
);
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true); // curl, health checks
  const ok = originRules.some((r) => (typeof r === 'string' ? r === origin : r.test(origin)));
  cb(null, ok);
};

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: corsOrigin, credentials: false }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  if (!config.isProd && process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/', (_req, res) => res.json({ name: 'Trade Pursuit API', ok: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/firms', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').json(firms));
  app.use('/api/auth', authRoutes);
  app.use('/api/trades', requireAuth, tradeRoutes);
  app.use('/api/accounts', requireAuth, accountRoutes);
  app.use('/api/plans', requireAuth, planRoutes);
  app.use('/api/posts', requireAuth, postRoutes);
  app.use('/api/friends', requireAuth, friendRoutes);
  // Economic calendar: ?week=thisweek|nextweek
  app.get('/api/news', async (req, res) => {
    try {
      const out = await getNews(String(req.query.week || 'thisweek'));
      res.set('Cache-Control', 'public, max-age=300').json(out);
    } catch (e) {
      throw new HttpError(e.status || 502, e.message, e.reason ? { reason: e.reason } : undefined);
    }
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
