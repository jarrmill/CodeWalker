<script setup lang="ts">
import { reviewablePullRequests, type PullRequestSummary } from '~/utils/github'

const props = withDefaults(
  defineProps<{
    prs: PullRequestSummary[]
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{ select: [pullNumber: number] }>()

// Same presentation order everywhere: drafts dropped, newest first.
const items = computed(() => reviewablePullRequests(props.prs))
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="loading" class="text-sm text-gray-500 dark:text-gray-400 px-1">
      Loading open pull requests…
    </p>
    <p
      v-else-if="!items.length"
      class="text-sm text-gray-500 dark:text-gray-400 px-1"
    >
      No open pull requests to review.
    </p>

    <button
      v-for="pr in items"
      :key="pr.number"
      type="button"
      class="text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      @click="emit('select', pr.number)"
    >
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm text-gray-500 dark:text-gray-400">#{{ pr.number }}</span>
        <span class="font-medium truncate">{{ pr.title }}</span>
      </div>
      <div class="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span v-if="pr.author">{{ pr.author }}</span>
        <UBadge
          v-for="label in pr.labels"
          :key="label"
          :label="label"
          variant="subtle"
          size="sm"
        />
      </div>
    </button>
  </div>
</template>
