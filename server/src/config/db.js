import mongoose from 'mongoose';
import { env } from './env.js';

let supportsTransactions = false;

export async function connectDB(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: !env.isProd });

  // Multi-document transactions need a replica set (Atlas, or the local
  // docker-compose rs0). On a standalone mongod we degrade gracefully.
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  console.log(`[db] connected to ${mongoose.connection.name} (transactions: ${supportsTransactions ? 'on' : 'off'})`);
  return mongoose.connection;
}

/**
 * Run `fn(session)` inside a transaction when the deployment supports it,
 * otherwise run it without one. Writes to `tasks` and `task_events` must
 * commit together so the event log never drifts from current state.
 */
export async function withTransaction(fn) {
  if (!supportsTransactions) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
