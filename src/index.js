import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';

if (!config.mongoUri) {
  console.error('MONGODB_URI is missing. Copy server/.env.example to server/.env and paste your Atlas connection string.');
  process.exit(1);
}

await mongoose.connect(config.mongoUri, { maxPoolSize: 20 });
console.log('MongoDB connected');
createApp().listen(config.port, () => console.log(`API on http://localhost:${config.port}`));

// Keep NSE end-of-day data current while the server is awake.
const { ensureFresh } = await import('./lib/market/eod.js');
setTimeout(() => ensureFresh().catch(() => {}), 30_000);
setInterval(() => ensureFresh().catch(() => {}), 30 * 60_000);
