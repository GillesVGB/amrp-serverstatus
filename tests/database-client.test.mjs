import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createSqlTag, databaseProvider, postgresConnectionOptions} from '../app/lib/database-client.ts';

test('Bestaande Neon URL blijft de HTTP-driver gebruiken; Supabase gebruikt PostgreSQL', () => {
  assert.equal(databaseProvider('postgresql://user:secret@ep-demo-pooler.us-east-1.aws.neon.tech/db'), 'neon');
  assert.equal(databaseProvider('postgresql://postgres.project:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres'), 'postgres');
  assert.equal(databaseProvider('postgresql://user:secret@neon.tech.attacker.example/db'), 'postgres');
  assert.throws(() => databaseProvider('https://example.com'), /PostgreSQL/);
});

test('De SQL-adapter houdt invoer buiten de query en ondersteunt bestaande .query()', async () => {
  const calls = [];
  const sql = createSqlTag(async (text, values) => {calls.push({text, values}); return [{id: 'ok'}];});
  const input = "'; DROP TABLE amrp_status_services; --";
  assert.deepEqual(await sql`SELECT id FROM amrp_status_services WHERE name = ${input} AND enabled = ${1}`, [{id:'ok'}]);
  assert.equal(calls[0].text, 'SELECT id FROM amrp_status_services WHERE name = $1 AND enabled = $2');
  assert.deepEqual(calls[0].values, [input, 1]);
  await sql.query('SELECT $1::text AS id', ['ok']);
  assert.deepEqual(calls[1], {text:'SELECT $1::text AS id', values:['ok']});
  assert.throws(() => sql('SELECT 1'), /tagged template/);
});

test('TLS-verificatie blijft aan en de pool blijft klein voor serverless gebruik', () => {
  const options = postgresConnectionOptions('postgresql://postgres.project:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=no-verify');
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.equal(options.max, 3);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.allowExitOnIdle, true);
  assert.equal(options.ssl.ca, undefined);
  assert.equal(postgresConnectionOptions('postgresql://u:p@localhost/local').ssl, false);
  assert.equal(postgresConnectionOptions('postgresql://u:p@db.example/db', 'line1\\nline2').ssl.ca, 'line1\nline2');
});

test('pg kan TLS en een eigen CA niet alsnog via URL-parameters uitschakelen', () => {
  for (const parameters of ['ssl=no-verify', 'ssl=true', 'sslmode=disable', 'sslrootcert=unknown.pem&sslmode=verify-ca']) {
    const options = postgresConnectionOptions(`postgresql://u:p@db.example/db?${parameters}`, 'trusted-ca');
    const client = new pg.Client(options);
    assert.deepEqual(client.connectionParameters.ssl, {rejectUnauthorized: true, ca: 'trusted-ca'});
  }
});
