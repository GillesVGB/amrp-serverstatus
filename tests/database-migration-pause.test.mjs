import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDatabaseAvailable, clearDatabaseUnavailable, DatabaseUnavailableError} from '../app/lib/database-availability.ts';

test('Een migratiepauze blokkeert databasehandelingen ook zonder quota-fout', () => {
  const previous = process.env.STATUS_DATABASE_MIGRATION_PAUSED;
  try {
    clearDatabaseUnavailable();
    process.env.STATUS_DATABASE_MIGRATION_PAUSED = '1';
    assert.throws(() => assertDatabaseAvailable(), (error) => error instanceof DatabaseUnavailableError && error.retryAfterSeconds === 300);
    clearDatabaseUnavailable();
    assert.throws(() => assertDatabaseAvailable(), DatabaseUnavailableError);
    delete process.env.STATUS_DATABASE_MIGRATION_PAUSED;
    assert.doesNotThrow(() => assertDatabaseAvailable());
  } finally {
    if (previous === undefined) delete process.env.STATUS_DATABASE_MIGRATION_PAUSED;
    else process.env.STATUS_DATABASE_MIGRATION_PAUSED = previous;
    clearDatabaseUnavailable();
  }
});
