/**
 * Provides a fetch wrapper that automatically attaches the current
 * Supabase session's Bearer token to every Mastra API request.
 */
export function useMastra() {
  const config = useRuntimeConfig()
  const supabase = useSupabaseClient()

  const baseUrl = config.public.mastraUrl as string

  async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      throw new Error(`Mastra API ${res.status}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  /** List all registered agents */
  function agents() {
    return apiFetch<Record<string, unknown>>('/api/agents')
  }

  /** Generate a response from a named agent */
  function generate(agentId: string, messages: { role: string; content: string }[]) {
    return apiFetch<{ text: string }>(`/api/agents/${agentId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    })
  }

  return { apiFetch, agents, generate }
}
