<script setup lang="ts">
import type { PullRequestSummary } from '~/utils/orientation'

const props = defineProps<{
  pullRequests: PullRequestSummary[]
  prsLoading: boolean
  loading: boolean
  diffTruncated: boolean
  hasDiff: boolean
  prDescription: string
}>()

const emit = defineEmits<{
  refresh: []
  start: []
}>()

// The selected PR number; the parent watches this to load the diff.
const selected = defineModel<number | undefined>('selected', { required: true })

// USelectMenu items: value is the PR number, label carries the number + title
// (and author, via filter-fields) so typing filters across all of them.
const items = computed(() =>
  props.pullRequests.map((pr) => ({
    value: pr.number,
    label: `#${pr.number} ${pr.title}`,
    author: pr.author ?? '',
  })),
)

const selectedPr = computed(() =>
  props.pullRequests.find((pr) => pr.number === selected.value) ?? null,
)
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-medium">Pick a change to orient on</h2>
    </template>

    <div class="flex flex-col gap-4">
      <UAlert
        color="info"
        variant="subtle"
        title="How orientation works"
        description="You'll explain the change across three gated stages: select the task, understand the context, then the rationale. Each explanation is graded — you can retry a stage as many times as you need. Pass all three to unlock deeper analysis."
      />

      <div class="flex items-end gap-2">
        <UFormField label="Open pull request" class="flex-1">
          <USelectMenu
            v-model="selected"
            :items="items"
            value-key="value"
            label-key="label"
            :filter-fields="['label', 'author']"
            :loading="props.prsLoading"
            :disabled="props.prsLoading || props.loading"
            placeholder="Select a pull request..."
            class="w-full"
          >
            <template #item-label="{ item }">
              <span class="truncate">{{ item.label }}</span>
              <span v-if="item.author" class="ml-2 text-xs text-gray-400 dark:text-gray-500">
                @{{ item.author }}
              </span>
            </template>
            <template #empty>
              {{ props.prsLoading ? 'Loading pull requests…' : 'No open pull requests' }}
            </template>
          </USelectMenu>
        </UFormField>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="subtle"
          :loading="props.prsLoading"
          aria-label="Refresh pull requests"
          @click="emit('refresh')"
        />
      </div>

      <!-- Loading the selected PR's diff -->
      <div v-if="props.loading && !props.hasDiff" class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Loading diff…
      </div>

      <!-- Read-only summary of the selected PR -->
      <div v-else-if="selectedPr" class="flex flex-col gap-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="font-medium text-gray-700 dark:text-gray-200">
            #{{ selectedPr.number }} {{ selectedPr.title }}
          </span>
          <ULink v-if="selectedPr.url" :to="selectedPr.url" target="_blank" class="text-xs text-primary-500">
            View on GitHub
          </ULink>
        </div>
        <p v-if="selectedPr.author" class="text-xs text-gray-400 dark:text-gray-500">
          by @{{ selectedPr.author }}
        </p>
        <p
          v-if="props.prDescription"
          class="whitespace-pre-wrap text-gray-600 dark:text-gray-400 line-clamp-6"
        >
          {{ props.prDescription }}
        </p>
      </div>

      <UAlert
        v-if="props.diffTruncated"
        color="warning"
        variant="subtle"
        title="Diff was truncated"
        description="The loaded diff exceeded the size limit and was cut off."
      />

      <div class="flex justify-end">
        <UButton :loading="props.loading" :disabled="!props.hasDiff" @click="emit('start')">
          Start orientation
        </UButton>
      </div>
    </div>
  </UCard>
</template>
