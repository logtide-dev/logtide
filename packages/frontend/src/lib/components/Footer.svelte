<script lang="ts">
  import Github from "@lucide/svelte/icons/github";

  const version = "Alpha v0.5.0";
  const currentYear = new Date().getFullYear();
  const githubUrl = "https://github.com/logtide-dev/logtide";
</script>

<footer class="border-t border-border bg-card">
  <div class="container mx-auto px-6 py-4 flex items-center justify-between text-sm text-muted-foreground">
    <div class="flex items-center gap-2">
      <span class="font-medium">LogTide</span>
      <span class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
        {version}
      </span>
    </div>

    <div class="flex items-center gap-4">
      <span>© {currentYear} LogTide</span>
      <a
        href="https://logtide.dev/docs"
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-foreground transition-colors"
      >
        Documentation
      </a>
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 hover:text-foreground transition-colors"
        title="View on GitHub"
      >
        <Github class="w-4 h-4" />
        GitHub
      </a>
    </div>
  </div>
</footer>
