import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

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

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
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
