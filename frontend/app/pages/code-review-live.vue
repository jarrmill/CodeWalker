<script setup lang="ts">
import type { PullRequestSummary } from '~/utils/github'

// A/B "live" variant of the code-review orientation: a real-time spoken
// conversation over WebRTC, instead of the turn-based Q&A on /code-review.
// Picking a PR seeds its diff into the session up front; "start without a PR"
// lets the model list open PRs by voice instead.
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { fetchOpenPullRequests } = useMastra()
const {
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
} = useRealtimeVoice()

const toast = useToast()

// Offer the open PRs directly on load, same as /code-review, so the user can
// seed a change without a round-trip.
const pullRequests = ref<PullRequestSummary[]>([])
const prsLoading = ref(false)

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

watch(error, (msg) => {
  if (msg) toast.add({ title: 'Live session error', description: msg, color: 'error' })
})

// Show the picker only before a conversation has started.
const showPicker = computed(() => status.value === 'idle')

const statusLabel = computed(() => ({
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  error: 'Error',
}[status.value]))

const statusColor = computed(() => ({
  idle: 'neutral',
  connecting: 'warning',
  live: 'success',
  error: 'error',
}[status.value] as 'neutral' | 'warning' | 'success' | 'error'))

onBeforeUnmount(disconnect)

async function signOut() {
  disconnect()
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
    <header class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="font-semibold text-lg">Code Review Orientation</h1>
        <UBadge :color="statusColor" variant="subtle" size="sm">{{ statusLabel }}</UBadge>
        <UBadge v-if="seededPr" color="primary" variant="subtle" size="sm">PR #{{ seededPr }}</UBadge>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ user?.email }}</span>
        <UButton variant="ghost" size="sm" @click="signOut">Sign out</UButton>
      </div>
    </header>

    <UContainer class="flex-1 flex flex-col min-h-0 w-full max-w-3xl gap-4 py-4">
      <!-- Before connecting: pick a PR to orient on, or start without one. -->
      <template v-if="showPicker">
        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Pick a pull request to talk through, or start a conversation and ask
            me what's open.
          </p>
          <PrList :prs="pullRequests" :loading="prsLoading" @select="connect" />
        </div>
        <div class="shrink-0 flex items-center justify-center py-2">
          <UButton
            icon="i-lucide-phone"
            color="primary"
            size="lg"
            @click="connect()"
          >
            Start conversation
          </UButton>
        </div>
      </template>

      <!-- Connecting / live: transcript + controls. -->
      <template v-else>
        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
          <p v-if="transcript.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
            {{ status === 'live'
              ? 'Listening… start talking to orient on the change.'
              : 'Connecting…' }}
          </p>

          <template v-for="entry in transcript" :key="entry.id">
            <!-- Spoken turns as chat bubbles. -->
            <div
              v-if="entry.role === 'user' || entry.role === 'assistant'"
              class="flex"
              :class="entry.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <div
                class="rounded-2xl px-4 py-2 max-w-[80%] whitespace-pre-wrap text-sm"
                :class="entry.role === 'user'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'"
              >
                {{ entry.text || '…' }}
              </div>
            </div>
            <!-- Tool activity and reconnect notes as subtle centered lines. -->
            <div v-else class="flex justify-center">
              <span class="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                <UIcon
                  :name="entry.pending
                    ? 'i-lucide-loader-circle'
                    : (entry.role === 'tool' ? 'i-lucide-wrench' : 'i-lucide-info')"
                  :class="entry.pending ? 'animate-spin' : ''"
                />
                {{ entry.text }}
              </span>
            </div>
          </template>
        </div>

        <div class="shrink-0 flex items-center justify-center gap-3 py-2">
          <UButton
            :icon="muted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
            :color="muted ? 'neutral' : 'primary'"
            :variant="muted ? 'soft' : 'solid'"
            size="lg"
            square
            :disabled="status !== 'live'"
            :aria-label="muted ? 'Unmute microphone' : 'Mute microphone'"
            :title="muted ? 'Unmute microphone' : 'Mute microphone'"
            @click="toggleMute"
          />
          <!-- Live mic input level. -->
          <div class="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden" aria-hidden="true">
            <div
              class="h-full bg-primary-500 rounded-full origin-left transition-transform duration-75"
              :style="{ transform: `scaleX(${micLevel})` }"
            />
          </div>
          <span
            class="text-sm"
            :class="assistantSpeaking ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'"
          >
            {{ assistantSpeaking ? 'Assistant speaking…' : (muted ? 'Muted' : 'Listening…') }}
          </span>
          <UButton
            icon="i-lucide-phone-off"
            color="error"
            variant="soft"
            size="lg"
            @click="disconnect"
          >
            End
          </UButton>
        </div>
      </template>
    </UContainer>
  </div>
</template>
