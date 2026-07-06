import { MastraClient } from '@mastra/client-js'
import { DefaultChatTransport } from 'ai'

/**
 * Provides a typed MastraClient configured to attach the current Supabase
 * session's Bearer token to every request. The token is fetched per request
 * via a custom `fetch`, so it stays fresh even after Supabase rotates it.
 */
export function useMastra() {
  const config = useRuntimeConfig()
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const baseUrl = config.public.mastraUrl as string

  const client = new MastraClient({
    baseUrl,
    fetch: async (input, init) => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      return fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
    },
  })

  /**
   * Builds a DefaultChatTransport for an agent's AI SDK chatRoute. On every
   * send it attaches a fresh Supabase Bearer token and forwards only the
   * latest message plus the user's memory thread/resource, so Mastra loads
   * conversation history from storage instead of trusting client history.
   * The threadPrefix keeps each page's conversation in its own memory thread.
   */
  function createChatTransport(agentPath = '/chat', threadPrefix = 'github') {
    return new DefaultChatTransport({
      api: `${baseUrl}${agentPath}`,
      prepareSendMessagesRequest: async ({ messages }) => {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        const userId = session?.user?.id ?? user.value?.id

        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        return {
          headers,
          body: {
            messages: messages.slice(-1),
            memory: {
              thread: `${threadPrefix}-${userId}`,
              resource: userId,
            },
          },
        }
      },
    })
  }

  /**
   * Drives the interactive code-review orientation workflow. The workflow
   * suspends at each stage to collect the user's explanation, so this returns
   * the run plus the initial result. Callers inspect `result.status` and call
   * `run.resumeAsync(...)` with the user's feedback to advance.
   */
  async function startOrientation(inputData: { diff: string; prDescription: string }) {
    const run = await client.getWorkflow('codeReviewOrientationWorkflow').createRun()
    const result = await run.startAsync({ inputData })
    return { run, result }
  }

  /** Fetches a pull request (title, description, unified diff) from GitHub. */
  async function fetchPullRequest(pullNumber: number) {
    return client.getTool('githubGetPullRequestTool').execute({ data: { pullNumber } })
  }

  /** Fetches the repository's open pull requests (summaries, no diffs). */
  async function fetchOpenPullRequests() {
    return client.getTool('githubOpenPullRequestsTool').execute({ data: {} })
  }

  return { client, createChatTransport, startOrientation, fetchPullRequest, fetchOpenPullRequests }
}
