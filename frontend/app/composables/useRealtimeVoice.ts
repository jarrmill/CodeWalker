/**
 * Drives a real-time, spoken code-review conversation over WebRTC directly with
 * the OpenAI Realtime API. The Mastra server only mints a short-lived ephemeral
 * token (POST /realtime/session); audio never flows through our server.
 *
 * Flow:
 *  1. connect() fetches an ephemeral secret from /realtime/session (Bearer auth,
 *     same as useVoice/useMastra).
 *  2. It opens an RTCPeerConnection: mic track out, remote audio track in, and a
 *     "oai-events" data channel for JSON events (transcripts, tool calls).
 *  3. The SDP offer is POSTed to https://api.openai.com/v1/realtime/calls using
 *     the ephemeral secret; the answer completes the connection.
 *
 * This is the A/B "live" variant — separate from the turn-based useVoice path.
 * Step 2 handles connection + transcript only; PR seeding and the list_open_prs
 * tool land in later steps.
 */

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'error'

export interface TranscriptEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  done: boolean
}

export function useRealtimeVoice() {
  const config = useRuntimeConfig()
  const supabase = useSupabaseClient()

  const baseUrl = config.public.mastraUrl as string

  const status = ref<RealtimeStatus>('idle')
  const error = ref<string | null>(null)
  const muted = ref(false)
  const assistantSpeaking = ref(false)
  const transcript = ref<TranscriptEntry[]>([])

  // Non-reactive connection handles — nothing here needs to trigger renders.
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null
  let micStream: MediaStream | null = null
  let audioEl: HTMLAudioElement | null = null

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  // Find (or create) the transcript entry for a given realtime item id, so
  // streaming assistant deltas accumulate into one bubble.
  function upsertEntry(id: string, role: 'user' | 'assistant'): TranscriptEntry {
    let entry = transcript.value.find((e) => e.id === id)
    if (!entry) {
      entry = { id, role, text: '', done: false }
      transcript.value = [...transcript.value, entry]
    }
    return entry
  }

  // OpenAI has renamed several realtime events across versions; match on the
  // stable suffix rather than the exact prefix so we survive that churn.
  function handleEvent(evt: any) {
    const type: string = evt?.type ?? ''

    // The developer's own speech, transcribed (input transcription is enabled
    // in the minted session).
    if (type.endsWith('input_audio_transcription.completed')) {
      const id = evt.item_id ?? `user-${transcript.value.length}`
      const entry = upsertEntry(id, 'user')
      entry.text = (evt.transcript ?? '').trim()
      entry.done = true
      transcript.value = [...transcript.value]
      return
    }

    // The assistant's spoken reply, streamed as transcript deltas.
    if (type.endsWith('audio_transcript.delta')) {
      const id = evt.item_id ?? evt.response_id ?? 'assistant-current'
      const entry = upsertEntry(id, 'assistant')
      entry.text += evt.delta ?? ''
      assistantSpeaking.value = true
      transcript.value = [...transcript.value]
      return
    }
    if (type.endsWith('audio_transcript.done')) {
      const id = evt.item_id ?? evt.response_id ?? 'assistant-current'
      const entry = upsertEntry(id, 'assistant')
      if (typeof evt.transcript === 'string' && evt.transcript.trim()) {
        entry.text = evt.transcript.trim()
      }
      entry.done = true
      transcript.value = [...transcript.value]
      return
    }

    // Whole response finished — assistant is no longer speaking.
    if (type === 'response.done') {
      assistantSpeaking.value = false
      return
    }

    if (type === 'error') {
      error.value = evt.error?.message ?? 'Realtime session error'
    }
  }

  async function connect() {
    if (status.value === 'connecting' || status.value === 'live') return
    error.value = null
    status.value = 'connecting'

    try {
      // 1. Mint an ephemeral session (expires in ~60s, so do it right before
      //    the handshake).
      const sessionRes = await fetch(`${baseUrl}/realtime/session`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!sessionRes.ok) {
        throw new Error(`Could not start session (${sessionRes.status})`)
      }
      const data = await sessionRes.json()
      const ephemeralKey: string | undefined = data?.value ?? data?.client_secret?.value
      if (!ephemeralKey) throw new Error('Session response had no ephemeral key')

      // 2. Set up the peer connection.
      pc = new RTCPeerConnection()

      // Remote audio (the assistant's voice) → a detached, autoplaying element.
      audioEl = document.createElement('audio')
      audioEl.autoplay = true
      pc.ontrack = (e) => {
        if (audioEl) audioEl.srcObject = e.streams[0] ?? null
      }

      // Local mic → outgoing track.
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of micStream.getTracks()) {
        track.enabled = !muted.value
        pc.addTrack(track, micStream)
      }

      // 3. Events data channel.
      dc = pc.createDataChannel('oai-events')
      dc.addEventListener('message', (e) => {
        try {
          handleEvent(JSON.parse(e.data))
        } catch {
          // Ignore non-JSON frames.
        }
      })
      dc.addEventListener('open', () => {
        status.value = 'live'
      })

      pc.addEventListener('connectionstatechange', () => {
        const s = pc?.connectionState
        if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          if (status.value === 'live' || status.value === 'connecting') {
            if (s === 'failed') error.value = 'Connection lost'
            teardown('idle')
          }
        }
      })

      // 4. SDP handshake. The model/config are baked into the ephemeral key, so
      //    no model param is sent here.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(OPENAI_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      })
      if (!sdpRes.ok) {
        throw new Error(`WebRTC handshake failed (${sdpRes.status})`)
      }
      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      // status flips to 'live' when the data channel opens.
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to connect'
      teardown('error')
    }
  }

  function teardown(next: RealtimeStatus) {
    try { dc?.close() } catch { /* noop */ }
    try { pc?.close() } catch { /* noop */ }
    micStream?.getTracks().forEach((t) => t.stop())
    if (audioEl) {
      audioEl.srcObject = null
      audioEl = null
    }
    dc = null
    pc = null
    micStream = null
    assistantSpeaking.value = false
    status.value = next
  }

  function disconnect() {
    teardown('idle')
  }

  // Mute/unmute by toggling the outgoing mic track rather than tearing down.
  function toggleMute() {
    muted.value = !muted.value
    micStream?.getAudioTracks().forEach((t) => { t.enabled = !muted.value })
  }

  return {
    status,
    error,
    muted,
    assistantSpeaking,
    transcript,
    connect,
    disconnect,
    toggleMute,
  }
}
