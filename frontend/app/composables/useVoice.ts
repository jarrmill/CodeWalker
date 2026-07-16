/**
 * Talks to the Mastra voice routes (/voice/transcribe, /voice/speak) as the
 * current Supabase user. Mirrors useMastra's per-request token handling so the
 * Bearer token stays valid after Supabase rotates it.
 */
export function useVoice() {
  const config = useRuntimeConfig()
  const supabase = useSupabaseClient()

  const baseUrl = config.public.mastraUrl as string

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /**
   * Sends recorded audio to the transcription route and returns the text.
   * The blob's mime type tells the backend which filetype to hand OpenAI.
   */
  async function transcribe(audio: Blob): Promise<string> {
    const res = await fetch(`${baseUrl}/voice/transcribe`, {
      method: 'POST',
      headers: {
        ...(await authHeaders()),
        'Content-Type': audio.type || 'audio/webm',
      },
      body: audio,
    })
    if (!res.ok) {
      throw new Error(`Transcription failed (${res.status})`)
    }
    const { text } = await res.json()
    return typeof text === 'string' ? text.trim() : ''
  }

  /**
   * Synthesizes speech for the given text and returns an object URL for an
   * <audio> element. Callers should revokeObjectURL when playback is done.
   */
  async function speak(text: string): Promise<string> {
    const res = await fetch(`${baseUrl}/voice/speak`, {
      method: 'POST',
      headers: {
        ...(await authHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      throw new Error(`Speech synthesis failed (${res.status})`)
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  return { transcribe, speak }
}
