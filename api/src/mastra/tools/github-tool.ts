import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_OWNER = 'jarrmill';
const DEFAULT_REPO = 'CodeWalker';

interface GitHubUser {
  login: string;
  html_url: string;
}

interface GitHubLabel {
  name: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  body?: string | null;
  user?: GitHubUser | null;
  labels?: GitHubLabel[];
  created_at: string;
  updated_at: string;
}

function getGitHubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. Add a GitHub token to GITHUB_TOKEN in api/.env and restart the server.',
    );
  }
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Turn a failed GitHub response into an actionable error. The important
// distinction for operators is "the token is bad" (401 / expired / revoked)
// versus everything else (rate limits, missing permissions, transient errors),
// since a generic "401 Unauthorized" gives no hint that GITHUB_TOKEN is the
// thing to fix. Only reads the body on failure; callers still read it on success.
async function assertGitHubOk(response: Response, context: string): Promise<void> {
  if (response.ok) {
    return;
  }

  // GitHub returns a JSON body with a human-readable `message` on errors, even
  // for the diff endpoint. Surface it when present for extra context.
  let apiMessage = '';
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) {
      apiMessage = ` GitHub said: "${body.message}".`;
    }
  } catch {
    // Body wasn't JSON — nothing extra to add.
  }

  if (response.status === 401) {
    throw new Error(
      `${context}: GitHub rejected the credentials (401 Unauthorized). The GITHUB_TOKEN is ` +
        `invalid, expired, or revoked. Generate a new token, update GITHUB_TOKEN in api/.env, ` +
        `and restart the server.${apiMessage}`,
    );
  }

  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = response.headers.get('x-ratelimit-reset');
      const resetHint = reset
        ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`
        : '';
      throw new Error(
        `${context}: GitHub API rate limit exceeded (403 Forbidden).${resetHint}${apiMessage}`,
      );
    }
    throw new Error(
      `${context}: GitHub denied access (403 Forbidden). The token is valid but lacks ` +
        `permission for this repository or resource — check the token's scopes and repo access.${apiMessage}`,
    );
  }

  throw new Error(`${context}: ${response.status} ${response.statusText}.${apiMessage}`);
}

const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  url: z.string(),
  author: z.string().nullable(),
  authorUrl: z.string().nullable(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const githubOpenPullRequestsTool = createTool({
  id: 'get-github-open-pull-requests',
  description:
    'Fetch the open pull requests for the CodeWalker GitHub repository. Paginates through every open PR.',
  inputSchema: z.object({
    owner: z
      .string()
      .default(DEFAULT_OWNER)
      .describe('The GitHub repository owner / organization.'),
    repo: z.string().default(DEFAULT_REPO).describe('The GitHub repository name.'),
  }),
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    total: z.number(),
    pullRequests: z.array(pullRequestSchema),
  }),
  execute: async (inputData) => {
    return await getOpenPullRequests(inputData);
  },
});

const MAX_DIFF_CHARS = 60000;

const pullRequestDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  description: z.string(),
  state: z.string(),
  draft: z.boolean(),
  url: z.string(),
  author: z.string().nullable(),
  diff: z.string(),
  diffTruncated: z.boolean(),
});

type PullRequestDetail = z.infer<typeof pullRequestDetailSchema>;

// During an orientation session the agent re-fetches the same PR on every grade
// turn (it needs the diff to pass to the grader). PR contents don't change
// mid-session, so cache each fetched PR briefly to turn those repeat calls into
// cache hits instead of two fresh GitHub round-trips (metadata + diff) each time.
const PR_CACHE_TTL_MS = 5 * 60 * 1000;
const pullRequestCache = new Map<string, { detail: PullRequestDetail; expiresAt: number }>();

export const githubGetPullRequestTool = createTool({
  id: 'get-github-pull-request',
  description:
    'Fetch a single GitHub pull request including its title, description, and unified diff so it can be reviewed and discussed. Defaults to the CodeWalker repository.',
  inputSchema: z.object({
    owner: z
      .string()
      .default(DEFAULT_OWNER)
      .describe('The GitHub repository owner / organization.'),
    repo: z.string().default(DEFAULT_REPO).describe('The GitHub repository name.'),
    pullNumber: z.number().describe('The pull request number to fetch.'),
  }),
  outputSchema: pullRequestDetailSchema,
  execute: async ({ owner, repo, pullNumber }) => {
    return await getPullRequest({ owner, repo, pullNumber });
  },
});

const getOpenPullRequests = async ({ owner, repo }: { owner: string; repo: string }) => {
  const headers = getGitHubHeaders();

  const pullRequests: PullRequest[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?${new URLSearchParams({
      state: 'open',
      per_page: String(perPage),
      page: String(page),
    }).toString()}`;

    const response = await fetch(url, { headers });
    if (response.status === 404) {
      throw new Error(`Repository ${owner}/${repo} was not found.`);
    }
    await assertGitHubOk(response, 'Failed to fetch open pull requests');

    const page_data = (await response.json()) as PullRequest[];
    pullRequests.push(...page_data);

    if (page_data.length < perPage) {
      break;
    }
    page += 1;
  }

  return {
    owner,
    repo,
    total: pullRequests.length,
    pullRequests: pullRequests.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      url: pr.html_url,
      author: pr.user?.login ?? null,
      authorUrl: pr.user?.html_url ?? null,
      labels: (pr.labels ?? []).map((label) => label.name),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    })),
  };
};

const getPullRequest = async ({
  owner,
  repo,
  pullNumber,
}: {
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<PullRequestDetail> => {
  const cacheKey = `${owner}/${repo}#${pullNumber}`;
  const cached = pullRequestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.detail;
  }

  const headers = getGitHubHeaders();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`;

  const metaResponse = await fetch(url, { headers });
  if (metaResponse.status === 404) {
    throw new Error(`Pull request #${pullNumber} was not found in ${owner}/${repo}.`);
  }
  await assertGitHubOk(metaResponse, `Failed to fetch pull request #${pullNumber}`);
  const pr = (await metaResponse.json()) as PullRequest;

  const diffResponse = await fetch(url, {
    headers: { ...headers, Accept: 'application/vnd.github.diff' },
  });
  await assertGitHubOk(diffResponse, `Failed to fetch diff for pull request #${pullNumber}`);

  let diff = await diffResponse.text();
  const diffTruncated = diff.length > MAX_DIFF_CHARS;
  if (diffTruncated) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters]`;
  }

  const detail: PullRequestDetail = {
    number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    state: pr.state,
    draft: pr.draft,
    url: pr.html_url,
    author: pr.user?.login ?? null,
    diff,
    diffTruncated,
  };

  pullRequestCache.set(cacheKey, { detail, expiresAt: Date.now() + PR_CACHE_TTL_MS });
  return detail;
};
