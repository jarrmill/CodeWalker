<script setup lang="ts">
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { agents } = useMastra()

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
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Connected to Mastra API. Add your pages here.
      </p>
    </main>
  </div>
</template>
