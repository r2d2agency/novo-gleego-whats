import pg from 'pg';
import dotenv from 'dotenv';
import { logError, logInfo } from './logger.js';

dotenv.config();

const { Pool } = pg;

// Parse DATABASE_URL manually to handle special characters in password
function parseConnectionString(url) {
  if (!url) return {};

  // Format: postgres://user:password@host:port/database?options
  const regex = /^postgres(?:ql)?:\/\/([^:]+):(.+)@([^:]+):(\d+)\/([^?]+)(?:\?(.*))?$/;
  const match = url.match(regex);

  if (match) {
    const config = {
      user: match[1],
      password: match[2],
      host: match[3],
      port: parseInt(match[4], 10),
      database: match[5],
    };

    // Parse query options like sslmode
    if (match[6]) {
      const params = new URLSearchParams(match[6]);
      if (params.get('sslmode') === 'disable') {
        config.ssl = false;
      } else if (params.get('sslmode')) {
        config.ssl = { rejectUnauthorized: false };
      }
    }

    return config;
  }

  // Fallback to connectionString if parsing fails
  return { connectionString: url };
}

function summarizeSql(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function paramTypes(params) {
  if (!Array.isArray(params)) return [];
  return params.map((v) => {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (v instanceof Date) return 'Date';
    if (Buffer.isBuffer(v)) return 'Buffer';
    if (Array.isArray(v)) return 'Array';
    return typeof v;
  });
}

const rawUrl = process.env.DATABASE_URL || '';
const parsed = parseConnectionString(rawUrl);

// SSL resolution:
// - sslmode=disable (or PGSSL=disable) => no SSL (internal Easypanel network)
// - otherwise => SSL allowing self-signed certificates
const sslDisabled =
  parsed.ssl === false ||
  /sslmode=disable/i.test(rawUrl) ||
  String(process.env.PGSSL || '').toLowerCase() === 'disable';

const dbConfig = {
  ...parsed,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 15000),
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 300000),
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 300000),
  keepAlive: true,
};

logInfo('db.config_resolved', {
  host: parsed.host || 'from_connection_string',
  port: parsed.port || null,
  database: parsed.database || null,
  ssl: sslDisabled ? 'disabled' : 'relaxed',
  has_database_url: Boolean(rawUrl),
});


export const pool = new Pool(dbConfig);

pool.on('error', (err) => {
  logError('db.pool_error', err);
});

// Auto-healing: reconnect if connection is lost
pool.on('connect', () => {
  logInfo('db.client_connected');
});

export async function query(text, params) {
  const startedAt = Date.now();
  try {
    const res = await pool.query(text, params);
    const durationMs = Date.now() - startedAt;

    if (durationMs > 800) {
      logInfo('db.query_slow', {
        duration_ms: durationMs,
        sql: summarizeSql(text),
      });
    }

    return res;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logError('db.query_failed', error, {
      duration_ms: durationMs,
      sql: summarizeSql(text),
      param_count: Array.isArray(params) ? params.length : 0,
      param_types: paramTypes(params),
    });
    throw error;
  }
}

