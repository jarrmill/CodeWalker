<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { getToolName, isTextUIPart, isToolUIPart } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { createChatTransport } = useMastra()
const toast = useToast()

const input = ref('')

const chat = new Chat({
  transport: createChatTransport('/code-review-chat', 'code-review'),
  onError(error) {
    toast.add({ title: 'Chat error', description: error.message, color: 'error' })
  },
})

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
      <UChatMessages
        :messages="chat.messages"
        :status="chat.status"
        should-auto-scroll
        class="flex-1 min-h-0 overflow-y-auto"
      >
        <template #content="{ message }">
          <template v-for="(part, index) in message.parts">
            <UChatTool
              v-if="isToolUIPart(part)"
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
        placeholder="Paste a diff or describe a code change..."
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
