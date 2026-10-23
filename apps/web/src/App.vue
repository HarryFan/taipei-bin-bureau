<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between bg-[#14302A] px-4 text-[#F6F4EE]">
      <RouterLink to="/" class="flex items-baseline gap-2">
        <span class="text-lg font-black tracking-wide">台北桶報局</span>
        <span class="hidden text-xs text-[#9FC2B8] sm:inline">找回消失的垃圾桶</span>
      </RouterLink>
      <nav class="flex gap-1 rounded-lg bg-white/10 p-1 text-sm">
        <RouterLink to="/" class="rounded-md px-3 py-1" exact-active-class="bg-[#E8833A] font-bold text-white">市民</RouterLink>
        <RouterLink to="/admin" class="rounded-md px-3 py-1" active-class="bg-[#E8833A] font-bold text-white">市府</RouterLink>
      </nav>
    </header>
    <main class="min-h-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>
