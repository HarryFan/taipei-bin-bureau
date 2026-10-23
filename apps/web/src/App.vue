<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <RouterLink to="/" class="text-lg font-bold">🗑️ 台北桶報局</RouterLink>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/" class="rounded px-3 py-1.5" active-class="bg-emerald-600 text-white" exact-active-class="bg-emerald-600 text-white">市民</RouterLink>
        <RouterLink to="/admin" class="rounded px-3 py-1.5" active-class="bg-emerald-600 text-white">市府</RouterLink>
      </nav>
    </header>
    <main class="min-h-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>
