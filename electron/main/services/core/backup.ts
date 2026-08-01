import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const BACKUP_DUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isBackupDue(latestBackupCreatedAt: string | null): boolean {
  if (!latestBackupCreatedAt) {
    return true;
  }
  return Date.now() - new Date(latestBackupCreatedAt).getTime() >= BACKUP_DUE_THRESHOLD_MS;
}

interface CommandResult {
  code: number;
  stderr: string;
}

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stderr = '';
    let timedOut = false;

    // Without this, a hung pg_dump/pg_restore (e.g. blocked on a lock) would
    // never resolve this promise — leaving withScratchDatabase's `finally`
    // cleanup unreachable and the scratch database orphaned indefinitely.
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ code: 1, stderr: `${stderr}\nTimed out after ${COMMAND_TIMEOUT_MS}ms` });
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
  });
}

const WINDOWS_FALLBACK_DIRS = [
  'C:\\Program Files\\PostgreSQL\\17\\bin',
  'C:\\Program Files\\PostgreSQL\\16\\bin',
  'C:\\Program Files\\PostgreSQL\\15\\bin',
];

async function locateBinary(name: string): Promise<string> {
  try {
    const result = await runCommand(name, ['--version'], process.env);
    if (result.code === 0) {
      return name;
    }
  } catch {
    // Not on PATH — fall through to the directory search below.
  }

  if (process.platform === 'win32') {
    for (const dir of WINDOWS_FALLBACK_DIRS) {
      const candidate = path.join(dir, `${name}.exe`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Could not locate ${name}. Make sure PostgreSQL's command-line tools are installed and on PATH.`,
  );
}

let resolvedPgDumpPath: string | null = null;
let resolvedPgRestorePath: string | null = null;

export async function locatePgDump(): Promise<string> {
  resolvedPgDumpPath ??= await locateBinary('pg_dump');
  return resolvedPgDumpPath;
}

export async function locatePgRestore(): Promise<string> {
  resolvedPgRestorePath ??= await locateBinary('pg_restore');
  return resolvedPgRestorePath;
}

interface ConnectionInfo {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(databaseUrl: string): ConnectionInfo {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

function getConnectionInfo(): ConnectionInfo {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return parseDatabaseUrl(databaseUrl);
}

export interface CreateBackupResult {
  filePath: string;
  sizeBytes: number;
}

export async function createBackup(backupDir: string): Promise<CreateBackupResult> {
  const connection = getConnectionInfo();
  const pgDumpPath = await locatePgDump();

  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(backupDir, `omnes-backup-${timestamp}.pgdump`);

  const result = await runCommand(
    pgDumpPath,
    [
      '-Fc',
      '-h',
      connection.host,
      '-p',
      connection.port,
      '-U',
      connection.user,
      '-d',
      connection.database,
      '-f',
      filePath,
    ],
    { ...process.env, PGPASSWORD: connection.password },
  );

  if (result.code !== 0) {
    throw new Error(`pg_dump failed: ${result.stderr.trim()}`);
  }

  const stats = statSync(filePath);
  return { filePath, sizeBytes: stats.size };
}

const SCRATCH_DATABASE_NAME = 'omnes_backup_verify';

async function withScratchDatabase<T>(
  connection: ConnectionInfo,
  fn: () => Promise<T>,
): Promise<T> {
  const { Client } = pg;
  const adminClient = new Client({
    host: connection.host,
    port: Number(connection.port),
    user: connection.user,
    password: connection.password,
    database: 'postgres',
  });
  await adminClient.connect();

  try {
    await adminClient.query(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE_NAME}" WITH (FORCE)`);
    await adminClient.query(
      `CREATE DATABASE "${SCRATCH_DATABASE_NAME}" OWNER "${connection.user}"`,
    );
    return await fn();
  } finally {
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE_NAME}" WITH (FORCE)`);
    } finally {
      await adminClient.end();
    }
  }
}

export async function verifyBackup(filePath: string): Promise<boolean> {
  const connection = getConnectionInfo();
  const pgRestorePath = await locatePgRestore();

  return withScratchDatabase(connection, async () => {
    const result = await runCommand(
      pgRestorePath,
      [
        '-h',
        connection.host,
        '-p',
        connection.port,
        '-U',
        connection.user,
        '-d',
        SCRATCH_DATABASE_NAME,
        filePath,
      ],
      { ...process.env, PGPASSWORD: connection.password },
    );
    return result.code === 0;
  });
}

export async function restoreBackup(filePath: string): Promise<void> {
  const connection = getConnectionInfo();
  const pgRestorePath = await locatePgRestore();

  const result = await runCommand(
    pgRestorePath,
    [
      '--clean',
      '--if-exists',
      '--single-transaction',
      '-h',
      connection.host,
      '-p',
      connection.port,
      '-U',
      connection.user,
      '-d',
      connection.database,
      filePath,
    ],
    { ...process.env, PGPASSWORD: connection.password },
  );

  if (result.code !== 0) {
    throw new Error(`pg_restore failed: ${result.stderr.trim()}`);
  }
}
