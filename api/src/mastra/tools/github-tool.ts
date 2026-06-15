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
    throw new Error('GITHUB_TOKEN environment variable is not set.');
  }
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
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
    if (!response.ok) {
      throw new Error(
        `Failed to fetch open pull requests: ${response.status} ${response.statusText}`,
      );
    }

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
