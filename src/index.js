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
