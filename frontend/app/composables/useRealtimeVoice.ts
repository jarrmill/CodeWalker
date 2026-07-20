/**
 * Drives a real-time, spoken code-review conversation over WebRTC directly with
 * the OpenAI Realtime API. The Mastra server only mints a short-lived ephemeral
 * token (POST /realtime/session); audio never flows through our server.
 *
 * Flow:
 *  1. connect() fetches an ephemeral secret from /realtime/session (Bearer auth,
 *     same as useVoice/useMastra). A picked PR is seeded into the session there.
 *  2. It opens an RTCPeerConnection: mic track out, remote audio track in, and a
 *     "oai-events" data channel for JSON events (transcripts, tool calls).
 *  3. The SDP offer is POSTed to https://api.openai.com/v1/realtime/calls using
 *     the ephemeral secret; the answer completes the connection.
 *
 * This is the A/B "live" variant — separate from the turn-based useVoice path.
 */

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

// How many times to silently re-establish the session after an unexpected drop
// before giving up and surfacing an error. A reconnect re-mints a fresh OpenAI
// session (re-seeded with the same PR), so the model starts a new conversation;
// the on-screen transcript is preserved and a note marks the break.
const MAX_RECONNECTS = 3

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'error'

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system'

export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  text: string
  done: boolean
  // Tool entries only: the fetch is still running.
  pending?: boolean
}

// Human-readable labels for tool activity shown in the transcript.
function toolLabels(name: string): { pending: string; done: string } {
  switch (name) {
    case 'list_open_prs':
      return { pending: 'Looking up open pull requests…', done: 'Fetched open pull requests' }
    default:
      return { pending: `Running ${name}…`, done: `Finished ${name}` }
  }
}

export function useRealtimeVoice() {
  const config = useRuntimeConfig()
  const supabase = useSupabaseClient()
  // Reuse the existing Mastra tool-exec path (same one the /code-review picker
  // uses) to fulfill the model's tool calls over the data channel.
  const { fetchOpenPullRequests } = useMastra()

  const baseUrl = config.public.mastraUrl as string

  const status = ref<RealtimeStatus>('idle')
  const error = ref<string | null>(null)
  const muted = ref(false)
  const assistantSpeaking = ref(false)
  const transcript = ref<TranscriptEntry[]>([])
  // The PR number seeded into the session at connect time, if any — so the UI
  // can show which change is loaded. Preserved across reconnects.
  const seededPr = ref<number | null>(null)
  // Mic input level, 0..1, for a live meter. Reads 0 while muted.
  const micLevel = ref(0)

  // Non-reactive connection handles — nothing here needs to trigger renders.
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null
  let micStream: MediaStream | null = null
  let audioEl: HTMLAudioElement | null = null
  // Mic-level metering handles.
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let levelRaf: number | null = null
  // Tool calls already fulfilled this session, so a repeated event can't run a
  // tool twice.
  const handledCallIds = new Set<string>()
  // Distinguishes a user-initiated End from an unexpected drop, so we only
  // auto-reconnect on the latter.
  let userClosed = false
  let reconnectAttempts = 0

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  // Find (or create) the transcript entry for a given id, so streaming assistant
  // deltas accumulate into one bubble.
  function upsertEntry(id: string, role: TranscriptRole): TranscriptEntry {
    let entry = transcript.value.find((e) => e.id === id)
    if (!entry) {
      entry = { id, role, text: '', done: false }
      transcript.value = [...transcript.value, entry]
    }
    return entry
  }

  function addNote(text: string) {
    transcript.value = [
      ...transcript.value,
      { id: `note-${transcript.value.length}-${text.length}`, role: 'system', text, done: true },
    ]
  }

  // Send a client event over the data channel (no-op if it isn't open yet).
  function sendEvent(event: Record<string, unknown>) {
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event))
  }

  /**
   * Fulfill a tool call the model made over the data channel. The Realtime
   * protocol blocks the model until it receives a function_call_output for the
   * call_id, so we MUST always reply — with the result or an error — and then
   * response.create to let the model continue. Failing to reply is what makes
   * the model believe a call is perpetually "stuck". Surfaces the activity in
   * the transcript so a fetch doesn't read as dead air.
   */
  async function handleToolCall(name: string, callId: string, argsJson: string) {
    const labels = toolLabels(name)
    const entry = upsertEntry(`tool-${callId}`, 'tool')
    entry.text = labels.pending
    entry.pending = true
    transcript.value = [...transcript.value]

    let output: unknown
    let ok = true
    try {
      const args = argsJson ? JSON.parse(argsJson) : {}
      if (name === 'list_open_prs') {
        output = await fetchOpenPullRequests()
      } else {
        ok = false
        output = { error: `Unknown tool: ${name}` }
      }
      void args
    } catch (e: any) {
      ok = false
      output = { error: e?.message ?? 'Tool execution failed' }
    }

    entry.text = ok ? labels.done : 'That tool call failed'
    entry.pending = false
    entry.done = true
    transcript.value = [...transcript.value]

    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    })
    // Prompt the model to speak now that it has the tool result.
    sendEvent({ type: 'response.create' })
  }

  // OpenAI has renamed several realtime events across versions; match on the
  // stable suffix rather than the exact prefix so we survive that churn.
  function handleEvent(evt: any) {
    const type: string = evt?.type ?? ''

    // A completed output item that is a tool call — execute it and return the
    // output so the model isn't left blocking on us. output_item.done carries
    // the whole item (name + call_id + arguments) in one place, unlike
    // function_call_arguments.done, whose `name` isn't reliable across versions.
    if (type.endsWith('output_item.done') && evt.item?.type === 'function_call') {
      const { name, call_id: callId, arguments: argsJson } = evt.item
      if (callId && !handledCallIds.has(callId)) {
        handledCallIds.add(callId)
        void handleToolCall(name ?? '', callId, argsJson ?? '')
      }
      return
    }

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

  // Continuously sample the mic's RMS level into micLevel for the UI meter.
  function startMicMeter(stream: MediaStream) {
    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (!analyser) return
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        // Scale up (speech RMS is small) and clamp; force 0 when muted.
        micLevel.value = muted.value ? 0 : Math.min(1, rms * 3)
        levelRaf = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // AudioContext unavailable — the meter just stays at 0.
    }
  }

  function stopMicMeter() {
    if (levelRaf != null) cancelAnimationFrame(levelRaf)
    levelRaf = null
    analyser = null
    audioCtx?.close().catch(() => { /* noop */ })
    audioCtx = null
    micLevel.value = 0
  }

  // Establish the WebRTC session. Shared by the initial connect and reconnect;
  // uses (and preserves) the current seededPr. Throws on failure.
  async function establish() {
    const pullNumber = seededPr.value ?? undefined

    // 1. Mint an ephemeral session (expires in ~60s, so do it right before the
    //    handshake). If a PR was picked, the server seeds its diff.
    const sessionRes = await fetch(`${baseUrl}/realtime/session`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(pullNumber ? { pullNumber } : {}),
    })
    if (!sessionRes.ok) {
      throw new Error(`Could not start session (${sessionRes.status})`)
    }
    const data = await sessionRes.json()
    const ephemeralKey: string | undefined = data?.value ?? data?.client_secret?.value
    if (!ephemeralKey) throw new Error('Session response had no ephemeral key')

    // 2. Set up the peer connection.
    pc = new RTCPeerConnection()
    const thisPc = pc

    // Remote audio (the assistant's voice) → a detached, autoplaying element.
    audioEl = document.createElement('audio')
    audioEl.autoplay = true
    pc.ontrack = (e) => {
      if (audioEl) audioEl.srcObject = e.streams[0] ?? null
    }

    // Local mic → outgoing track, plus the level meter.
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of micStream.getTracks()) {
      track.enabled = !muted.value
      pc.addTrack(track, micStream)
    }
    startMicMeter(micStream)

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
      reconnectAttempts = 0
    })

    // Only react to the connection this closure was created for — after a
    // reconnect, `pc` points at a new object and stale events must be ignored.
    thisPc.addEventListener('connectionstatechange', () => {
      if (pc !== thisPc) return
      if (thisPc.connectionState === 'failed') {
        if (!userClosed && reconnectAttempts < MAX_RECONNECTS) {
          reconnectAttempts += 1
          void reconnect()
        } else if (!userClosed) {
          error.value = 'Connection lost'
          teardown('error')
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
  }

  async function connect(pullNumber?: number) {
    if (status.value === 'connecting' || status.value === 'live') return
    error.value = null
    userClosed = false
    reconnectAttempts = 0
    transcript.value = []
    seededPr.value = pullNumber ?? null
    status.value = 'connecting'

    try {
      await establish()
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to connect'
      teardown('error')
    }
  }

  // Re-establish after an unexpected drop, keeping the seeded PR and the visible
  // transcript. The OpenAI session itself is fresh, so the model won't remember
  // the prior conversation — the note makes that break visible.
  async function reconnect() {
    if (userClosed) return
    releaseConnection()
    status.value = 'connecting'
    addNote(`Connection dropped — reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECTS})…`)
    try {
      await establish()
    } catch (e: any) {
      error.value = e?.message ?? 'Reconnect failed'
      teardown('error')
    }
  }

  // Release all connection resources without touching conversation state
  // (transcript, seededPr, status) — so a reconnect can reuse them.
  function releaseConnection() {
    stopMicMeter()
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
    handledCallIds.clear()
    assistantSpeaking.value = false
  }

  function teardown(next: RealtimeStatus) {
    releaseConnection()
    seededPr.value = null
    status.value = next
  }

  function disconnect() {
    userClosed = true
    teardown('idle')
  }

  // Mute/unmute by toggling the outgoing mic track rather than tearing down.
  function toggleMute() {
    muted.value = !muted.value
    micStream?.getAudioTracks().forEach((t) => { t.enabled = !muted.value })
    if (muted.value) micLevel.value = 0
  }

  return {
    status,
    error,
    muted,
    assistantSpeaking,
    transcript,
    seededPr,
    micLevel,
    connect,
    disconnect,
    toggleMute,
  }
}
