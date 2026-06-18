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

  return { client, createChatTransport }
}
