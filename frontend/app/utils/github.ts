/** A single open pull request as returned by githubOpenPullRequestsTool. */
export interface PullRequestSummary {
  number: number
  title: string
  state: string
  draft: boolean
  url: string
  author: string | null
  authorUrl: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
}

/** The full payload of githubOpenPullRequestsTool. */
export interface OpenPullRequestsResult {
  owner: string
  repo: string
  total: number
  pullRequests: PullRequestSummary[]
}

/**
 * Presentation order for a PR list: drop drafts, newest PR number first.
 * Shared by the on-load picker and the in-chat tool-output rendering so both
 * surfaces look identical.
 */
export function reviewablePullRequests(prs: PullRequestSummary[]): PullRequestSummary[] {
  return prs.filter((pr) => !pr.draft).sort((a, b) => b.number - a.number)
}
