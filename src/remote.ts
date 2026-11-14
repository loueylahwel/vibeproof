import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Scanning a public repository by its link: the repository is cloned into a
 * temporary folder, scanned, and deleted. Cloning never uses the user's stored
 * git credentials, so private repositories fail with a clear message instead of
 * being fetched silently; for those, the user downloads the project and scans
 * the folder.
 */

const HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'] as const;
type Host = (typeof HOSTS)[number];

/** Repositories larger than this (GitHub-reported size) must be downloaded and scanned locally. */
export const MAX_REPO_KB = 500 * 1024;

export interface RemoteRepo {
  host: Host;
  owner: string;
  repo: string;
  branch?: string;
  /** Folder inside the repository to scan, from a /tree/<branch>/<path> link. */
  subPath?: string;
  cloneUrl: string;
  /** Canonical link shown in reports. */
  display: string;
}

export class RepoAccessError extends Error {}

const NAME = /^[A-Za-z0-9_.-]+$/;

/** Recognise a link to a public repository on a supported host. Returns null for anything else. */
export function parseRepoUrl(input: string): RemoteRepo | null {
  const raw = input.trim();
  if (/^git@|^ssh:\/\//i.test(raw)) {
    throw new RepoAccessError('SSH links use your private keys. For a private repository, download it and enter the folder path; for a public one, use its https link.');
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '') as Host;
  if (!HOSTS.includes(host) || url.username || url.password || (url.port && url.port !== '443')) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(repo) || owner.startsWith('.') || repo.startsWith('.')) return null;

  let branch: string | undefined;
  let subPath: string | undefined;
  // github.com/o/r/tree/<branch>/<path>, gitlab.com/o/r/-/tree/<branch>/<path>, bitbucket.org/o/r/src/<branch>/<path>
  const rest = parts.slice(2);
  const treeAt = rest.findIndex((p, i) => (p === 'tree' || p === 'src') && i <= 1);
  if (treeAt >= 0 && rest[treeAt + 1]) {
    branch = decodeURIComponent(rest[treeAt + 1]);
    const sub = rest.slice(treeAt + 2).map(decodeURIComponent).join('/');
    if (sub) subPath = sub;
  }
  if (branch && !/^[\w.\-/]+$/.test(branch)) return null;
  if (subPath && (subPath.split('/').includes('..') || !/^[\w.\-/ ]+$/.test(subPath))) return null;

  const base = `https://${host}/${owner}/${repo}`;
  return {
    host,
    owner,
    repo,
    branch,
    subPath,
    cloneUrl: `${base}.git`,
    display: branch ? `${base}/tree/${branch}${subPath ? `/${subPath}` : ''}` : base,
  };
}

/** For GitHub, check through the public API that the repository exists, is public, and is not too large. */
async function checkGitHub(r: RemoteRepo): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, {
      headers: { 'user-agent': 'vibeproof', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null; // API unreachable: let the clone decide
  }
  if (res.status === 404) {
    throw new RepoAccessError(`${r.display} was not found. If it is private, download it and enter the folder path instead.`);
  }
  if (!res.ok) return null; // rate limited or similar: let the clone decide
  const info = (await res.json()) as { private?: boolean; size?: number; default_branch?: string };
  if (info.private) throw new RepoAccessError(`${r.display} is private. Download it and enter the folder path instead.`);
  if ((info.size ?? 0) > MAX_REPO_KB) {
    throw new RepoAccessError(`${r.display} is about ${Math.round((info.size ?? 0) / 1024)} MB, too large to fetch here. Download it and enter the folder path instead.`);
  }
  return info.default_branch ?? null;
}

/** Run git clone without any stored credentials or prompts. Exported for tests. */
export async function gitClone(source: string, dest: string, opts: { history: boolean; branch?: string; timeoutMs?: number }): Promise<void> {
  const args = [
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'protocol.file.allow=user',
    'clone', '--quiet', '--no-recurse-submodules',
    ...(opts.history ? [] : ['--depth', '1']),
    ...(opts.branch ? ['--branch', opts.branch] : []),
    '--', source, dest,
  ];
  try {
    await execFileP('git', args, {
      timeout: opts.timeoutMs ?? 5 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never' },
    });
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? (err as Error).message);
    if ((err as { killed?: boolean }).killed) throw new RepoAccessError('Downloading the repository took too long. Download it yourself and enter the folder path instead.');
    if (/authentication|could not read username|repository not found|not found|403|401/i.test(msg)) {
      throw new RepoAccessError('The repository could not be downloaded without signing in, so it is private or does not exist. Download it and enter the folder path instead.');
    }
    if (/remote branch .* not found/i.test(msg)) throw new RepoAccessError(`Branch "${opts.branch}" was not found in the repository.`);
    throw new RepoAccessError(`Downloading the repository failed: ${msg.split('\n').find((l) => l.trim()) ?? 'unknown error'}`);
  }
}

export interface ClonedRepo {
  /** Folder to scan (the clone, or a subfolder of it). */
  dir: string;
  /** Short description of what was fetched, for the report notes. */
  note: string;
  cleanup: () => Promise<void>;
}

export async function cloneRemote(r: RemoteRepo, opts: { history: boolean }): Promise<ClonedRepo> {
  const defaultBranch = r.host === 'github.com' ? await checkGitHub(r) : null;
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibeproof-clone-'));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    const dest = path.join(root, r.repo);
    await gitClone(r.cloneUrl, dest, { history: opts.history, branch: r.branch });
    const { stdout } = await execFileP('git', ['-C', dest, 'rev-parse', '--short', 'HEAD']);
    const dir = r.subPath ? path.join(dest, r.subPath) : dest;
    if (r.subPath && !dir.startsWith(dest + path.sep)) throw new RepoAccessError('Invalid folder in the link.');
    const branch = r.branch ?? defaultBranch;
    const details = [branch && `branch ${branch}`, `commit ${stdout.trim()}`, opts.history ? 'full history' : 'latest commit only'].filter(Boolean).join(', ');
    return { dir, note: `Public repository ${r.display} downloaded for this scan (${details}) and deleted afterwards.`, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
