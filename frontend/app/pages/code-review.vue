<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { getToolName, isTextUIPart, isToolUIPart } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import type { PullRequestSummary } from '~/utils/github'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { createChatTransport, fetchOpenPullRequests } = useMastra()
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
        </template>
      </UChatMessages>

      <UChatPrompt
        v-model="input"
        :error="chat.error"
        placeholder="Ask about open pull requests, or paste a diff to orient on..."
        @submit="onSubmit"
      >
        <UChatPromptSubmit
          :status="chat.status"
          @stop="chat.stop()"
          @reload="chat.regenerate()"
        />
      </UChatPrompt>
    </UContainer>
  </div>
</template>
