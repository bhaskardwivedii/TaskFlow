/**
 * Database-level schema validation ($jsonSchema).
 *
 * Mongoose validates writes made through the app, but scripts, imports, the
 * shell and other services can bypass it. These validators make the database
 * itself reject malformed rows in the two collections analytics depends on.
 *
 *   npm run validators
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { TASK_STATUSES, PRIORITIES, EVENT_TYPES } from '../src/models/constants.js';

const nullable = (bsonType) => ({ bsonType: [bsonType, 'null'] });
const statusOrNull = { enum: [...TASK_STATUSES, null] };

export const validators = {
  tasks: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['teamId', 'projectId', 'number', 'title', 'status', 'priority', 'creatorId', 'createdAt'],
      properties: {
        teamId: { bsonType: 'objectId' },
        projectId: { bsonType: 'objectId' },
        number: { bsonType: ['int', 'long', 'double'], minimum: 1 },
        title: { bsonType: 'string', minLength: 1, maxLength: 200 },
        status: { enum: TASK_STATUSES },
        priority: { enum: PRIORITIES },
        assigneeId: nullable('objectId'),
        estimateHours: { bsonType: ['int', 'double', 'null'], minimum: 0, maximum: 400 },
        dueDate: nullable('date'),
        startedAt: nullable('date'),
        completedAt: nullable('date'),
        reopenCount: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        labels: { bsonType: 'array', maxItems: 10, items: { bsonType: 'string' } },
      },
    },
    // Cross-field rule: a done task must have a completion timestamp, an open one must not.
    $expr: {
      $cond: [{ $eq: ['$status', 'done'] }, { $eq: [{ $type: '$completedAt' }, 'date'] }, { $ne: [{ $type: '$completedAt' }, 'date'] }],
    },
  },
  task_events: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['taskId', 'teamId', 'projectId', 'actorId', 'type', 'at'],
      properties: {
        taskId: { bsonType: 'objectId' },
        teamId: { bsonType: 'objectId' },
        projectId: { bsonType: 'objectId' },
        actorId: { bsonType: 'objectId' },
        type: { enum: EVENT_TYPES },
        fromStatus: statusOrNull,
        toStatus: statusOrNull,
        at: { bsonType: 'date' },
      },
    },
  },
};

export async function applyValidators(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, validator] of Object.entries(validators)) {
    if (!existing.has(name)) await db.createCollection(name);
    await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    console.log(`  validator applied: ${name}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDB, disconnectDB } = await import('../src/config/db.js');
  await connectDB();
  await applyValidators(mongoose.connection.db);
  await disconnectDB();
}
