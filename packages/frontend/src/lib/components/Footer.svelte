<script lang="ts">
  import Github from "@lucide/svelte/icons/github";

  const version = "Beta v1.0.3";
  const currentYear = new Date().getFullYear();
  const githubUrl = "https://github.com/logtide-dev/logtide";
</script>

<footer class="border-t border-border bg-card">
  <div class="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
    <div class="flex items-center gap-2">
      <span class="font-medium text-foreground/80">LogTide</span>
      <span class="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold whitespace-nowrap">
        {version}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
      <span class="whitespace-nowrap">© {currentYear} LogTide</span>
      <a
        href="https://logtide.dev/docs"
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-foreground transition-colors whitespace-nowrap"
      >
        <span class="hidden sm:inline">Documentation</span>
        <span class="sm:hidden">Docs</span>
      </a>
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 hover:text-foreground transition-colors"
        title="View on GitHub"
      >
        <Github class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        GitHub
      </a>
    </div>
  </div>
</footer>
