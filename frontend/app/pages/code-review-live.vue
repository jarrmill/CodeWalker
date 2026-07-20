<script setup lang="ts">
// A/B "live" variant of the code-review orientation: a real-time spoken
// conversation over WebRTC, instead of the turn-based Q&A on /code-review.
// Step 2 is bare on purpose — connect, talk, hear a reply, see the transcript.
// PR seeding and the list_open_prs tool arrive in later steps.
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const {
  status,
  error,
  muted,
  assistantSpeaking,
  transcript,
  connect,
  disconnect,
  toggleMute,
} = useRealtimeVoice()

const toast = useToast()

watch(error, (msg) => {
  if (msg) toast.add({ title: 'Live session error', description: msg, color: 'error' })
})

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
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ user?.email }}</span>
        <UButton variant="ghost" size="sm" @click="signOut">Sign out</UButton>
      </div>
    </header>

    <UContainer class="flex-1 flex flex-col min-h-0 w-full max-w-3xl gap-4 py-4">
      <!-- Transcript -->
      <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        <p v-if="transcript.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ status === 'live'
            ? 'Listening… start talking to orient on a change.'
            : 'Press “Start conversation” and talk through a pull request out loud.' }}
        </p>

        <div
          v-for="entry in transcript"
          :key="entry.id"
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
      </div>

      <!-- Controls -->
      <div class="shrink-0 flex items-center justify-center gap-3 py-2">
        <UButton
          v-if="status !== 'live'"
          icon="i-lucide-phone"
          color="primary"
          size="lg"
          :loading="status === 'connecting'"
          @click="connect"
        >
          Start conversation
        </UButton>

        <template v-else>
          <UButton
            :icon="muted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
            :color="muted ? 'neutral' : 'primary'"
            :variant="muted ? 'soft' : 'solid'"
            size="lg"
            square
            :aria-label="muted ? 'Unmute microphone' : 'Mute microphone'"
            :title="muted ? 'Unmute microphone' : 'Mute microphone'"
            @click="toggleMute"
          />
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
        </template>
      </div>
    </UContainer>
  </div>
</template>
