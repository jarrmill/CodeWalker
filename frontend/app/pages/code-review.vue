<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { getToolName, isTextUIPart, isToolUIPart } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import type { PullRequestSummary } from '~/utils/github'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { createChatTransport, fetchOpenPullRequests } = useMastra()
const { transcribe, speak } = useVoice()
const toast = useToast()

const input = ref('')

// The open-PR list, fetched directly on load so the user can pick a PR without
// first asking the agent "what's available" — saving an LLM round-trip.
const pullRequests = ref<PullRequestSummary[]>([])
const prsLoading = ref(false)

// The 'code-review' thread prefix keeps this conversation in its own memory
// thread (code-review-<userId>), separate from the github page's thread.
const chat = new Chat({
  transport: createChatTransport('/code-review-chat', 'code-review'),
  onError(error) {
    toast.add({ title: 'Chat error', description: error.message, color: 'error' })
  },
})

// Show the on-load picker only until the conversation has started.
const showPicker = computed(() => chat.messages.length === 0)

async function loadOpenPrs() {
  prsLoading.value = true
  try {
    const { pullRequests: prs } = await fetchOpenPullRequests()
    pullRequests.value = prs ?? []
  } catch (e: any) {
    toast.add({ title: 'Failed to load open PRs', description: e?.message, color: 'error' })
  } finally {
    prsLoading.value = false
  }
}

onMounted(loadOpenPrs)

// Picking a PR (from the picker or an in-chat list) seeds the conversation so
// the agent starts already knowing the target change.
function selectPr(pullNumber: number) {
  chat.sendMessage({ text: `Let's orient on PR #${pullNumber}.` })
}

// A tool part carries the open-PR list only once its output is available.
function prsFromPart(part: unknown): PullRequestSummary[] | null {
  if (isToolUIPart(part as any) && (part as any).state === 'output-available') {
    const output = (part as any).output as { pullRequests?: PullRequestSummary[] } | undefined
    if (Array.isArray(output?.pullRequests)) return output!.pullRequests
  }
  return null
}

function onSubmit() {
  const text = input.value.trim()
  if (!text) return
  chat.sendMessage({ text })
  input.value = ''
}

// True while the agent is producing a reply — used to disable the mic so a
// recording can't race an in-flight turn.
const busy = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

// --- Voice input (push-to-talk, auto-submits the transcript) ---------------
const recording = ref(false)
const transcribing = ref(false)
let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []

async function toggleRecording() {
  if (recording.value) {
    stopRecording()
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mediaRecorder.onstop = onRecordingStop
    mediaRecorder.start()
    recording.value = true
  } catch (e: any) {
    toast.add({ title: 'Microphone unavailable', description: e?.message, color: 'error' })
  }
}

function stopRecording() {
  mediaRecorder?.stop()
  mediaRecorder?.stream.getTracks().forEach((t) => t.stop())
  recording.value = false
}

async function onRecordingStop() {
  const type = mediaRecorder?.mimeType || 'audio/webm'
  const blob = new Blob(chunks, { type })
  chunks = []
  mediaRecorder = null
  if (!blob.size) return
  transcribing.value = true
  try {
    const text = await transcribe(blob)
    if (text) {
      input.value = text
      onSubmit()
    }
  } catch (e: any) {
    toast.add({ title: 'Transcription failed', description: e?.message, color: 'error' })
  } finally {
    transcribing.value = false
  }
}

// --- Voice output (auto-play replies, with a mute toggle) ------------------
const muted = ref(false)
const speaking = ref(false)
const spokenIds = new Set<string>()
let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  speaking.value = false
}

// Concatenate a message's text parts into the string to synthesize.
function messageText(message: any): string {
  return (message?.parts ?? [])
    .filter((p: any) => isTextUIPart(p))
    .map((p: any) => p.text)
    .join(' ')
    .trim()
}

async function playText(text: string) {
  if (!text) return
  try {
    const url = await speak(text)
    stopAudio()
    currentUrl = url
    currentAudio = new Audio(url)
    speaking.value = true
    currentAudio.onended = stopAudio
    await currentAudio.play()
  } catch (e: any) {
    stopAudio()
    toast.add({ title: 'Playback failed', description: e?.message, color: 'error' })
  }
}

// Replay button on an individual assistant message.
function playMessage(message: any) {
  playText(messageText(message))
}

function toggleMute() {
  muted.value = !muted.value
  if (muted.value) stopAudio()
}

// Speak each assistant reply once, when its turn finishes streaming.
watch(
  () => chat.status,
  (status, prev) => {
    if (status !== 'ready' || prev === 'ready' || muted.value) return
    const last = chat.messages[chat.messages.length - 1]
    if (!last || last.role !== 'assistant' || spokenIds.has(last.id)) return
    spokenIds.add(last.id)
    playText(messageText(last))
  },
)

onBeforeUnmount(() => {
  stopRecording()
  stopAudio()
})

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
    <header class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
      <h1 class="font-semibold text-lg">Code Review Orientation</h1>
      <div class="flex items-center gap-3">
        <UButton
          :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
          :color="muted ? 'neutral' : 'primary'"
          variant="ghost"
          size="sm"
          square
          :aria-label="muted ? 'Unmute spoken replies' : 'Mute spoken replies'"
          :title="muted ? 'Unmute spoken replies' : 'Mute spoken replies'"
          @click="toggleMute"
        />
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ user?.email }}</span>
        <UButton variant="ghost" size="sm" @click="signOut">Sign out</UButton>
      </div>
    </header>

    <UContainer class="flex-1 flex flex-col min-h-0 w-full max-w-3xl gap-3 py-4">
      <!-- On load, offer the open PRs directly so the user can start without a round-trip. -->
      <div v-if="showPicker" class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          Pick a pull request to orient on, or ask me anything below.
        </p>
        <PrList :prs="pullRequests" :loading="prsLoading" @select="selectPr" />
      </div>

      <UChatMessages
        v-else
        :messages="chat.messages"
        :status="chat.status"
        should-auto-scroll
        class="flex-1 min-h-0 overflow-y-auto"
      >
        <template #content="{ message }">
          <template v-for="(part, index) in message.parts">
            <!-- Render an open-PR tool result as the same clickable list as the picker. -->
            <PrList
              v-if="prsFromPart(part)"
              :key="`${message.id}-prs-${index}`"
              :prs="prsFromPart(part)!"
              @select="selectPr"
            />
            <UChatTool
              v-else-if="isToolUIPart(part)"
              :key="`${message.id}-tool-${index}`"
              :text="getToolName(part)"
              :streaming="isToolStreaming(part)"
            />
            <p
              v-else-if="isTextUIPart(part)"
              :key="`${message.id}-text-${index}`"
              class="whitespace-pre-wrap"
            >
              {{ part.text }}
            </p>
          </template>
          <!-- Replay this assistant reply as speech. -->
          <div v-if="message.role === 'assistant'" class="mt-1">
            <UButton
              icon="i-lucide-volume-2"
              variant="ghost"
              color="neutral"
              size="xs"
              square
              aria-label="Play this reply"
              title="Play this reply"
              @click="playMessage(message)"
            />
          </div>
        </template>
      </UChatMessages>

      <UChatPrompt
        v-model="input"
        :error="chat.error"
        placeholder="Ask about open pull requests, or paste a diff to orient on..."
        @submit="onSubmit"
      >
        <UButton
          :icon="recording ? 'i-lucide-square' : 'i-lucide-mic'"
          :color="recording ? 'error' : 'neutral'"
          :variant="recording ? 'solid' : 'ghost'"
          :loading="transcribing"
          :disabled="busy"
          square
          :aria-label="recording ? 'Stop recording' : 'Record a voice message'"
          :title="recording ? 'Stop recording' : 'Record a voice message'"
          @click="toggleRecording"
        />
        <UChatPromptSubmit
          :status="chat.status"
          @stop="chat.stop()"
          @reload="chat.regenerate()"
        />
      </UChatPrompt>
    </UContainer>
  </div>
</template>
