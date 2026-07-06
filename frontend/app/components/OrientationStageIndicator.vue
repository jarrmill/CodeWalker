<script setup lang="ts">
import type { OrientationPhase } from '~/utils/orientation'

const props = defineProps<{
  phase: OrientationPhase
  currentStageIndex: number
  attempt?: number
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
      <template v-if="props.phase === 'done'">All stages complete</template>
      <template v-else>
        Stage {{ props.currentStageIndex + 1 }} of {{ TOTAL_STAGES }}
        <span v-if="props.attempt && props.attempt > 1"> · Attempt {{ props.attempt }}</span>
      </template>
    </p>
    <ol class="flex items-center gap-2 text-sm">
      <li
        v-for="(id, i) in STAGE_ORDER"
        :key="id"
        class="flex items-center gap-2"
      >
        <span
          class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium"
          :class="
            props.phase === 'done' || i < props.currentStageIndex
              ? 'bg-primary-500 text-white'
              : i === props.currentStageIndex
                ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-500 dark:bg-primary-900 dark:text-primary-200'
                : 'bg-gray-200 text-gray-500 dark:bg-gray-800'
          "
        >
          {{ props.phase === 'done' || i < props.currentStageIndex ? '✓' : i + 1 }}
        </span>
        <span :class="i === props.currentStageIndex && props.phase === 'running' ? 'font-medium' : 'text-gray-500'">
          {{ STAGE_LABELS[id] }}
        </span>
        <span v-if="i < STAGE_ORDER.length - 1" class="text-gray-300 dark:text-gray-700">→</span>
      </li>
    </ol>
  </div>
</template>
