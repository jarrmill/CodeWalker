<script setup lang="ts">
const user = useSupabaseUser()
const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <header class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
      <h1 class="font-semibold text-lg">CodeWalker</h1>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ user?.email }}</span>
        <UButton variant="ghost" size="sm" @click="signOut">Sign out</UButton>
      </div>
    </header>

    <main class="max-w-4xl mx-auto px-6 py-10">
      <h2 class="text-2xl font-semibold mb-6">Agents</h2>
      <div class="grid gap-4">
        <div class="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h3 class="text-lg font-semibold mb-2">Code Review Orientation</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            A more natural way to understand the pull requests assigned to you.
            Talk through your reviews with an AI that acts like a coach rather
            than a coworker — asking questions, offering context, and helping you
            build a clear picture of each change before you dive in.
          </p>
          <UButton to="/code-review" size="lg" variant="soft">
            Start a review
          </UButton>
        </div>
      </div>
    </main>
  </div>
</template>
