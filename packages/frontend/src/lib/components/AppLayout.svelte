<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { authStore } from "$lib/stores/auth";
  import { authAPI } from "$lib/api/auth";
  import { currentOrganization, organizationStore } from "$lib/stores/organization";
  import { toastStore } from "$lib/stores/toast";
  import { shortcutsStore } from "$lib/stores/shortcuts";
  import { NotificationsAPI, type Notification } from "$lib/api/notifications";
  import { layoutStore, type ContentDensity } from "$lib/stores/layout";
  import { getPlatform } from "$lib/utils/keyboard";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import ShortcutsHelpModal from "$lib/components/ShortcutsHelpModal.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Separator } from "$lib/components/ui/separator";
  import { DropdownMenu as DropdownMenuPrimitive, Tooltip as TooltipPrimitive } from "bits-ui";
  import DropdownMenuContent from "$lib/components/ui/dropdown-menu/dropdown-menu-content.svelte";
  import DropdownMenuItem from "$lib/components/ui/dropdown-menu/dropdown-menu-item.svelte";
  import DropdownMenuLabel from "$lib/components/ui/dropdown-menu/dropdown-menu-label.svelte";
  import DropdownMenuSeparator from "$lib/components/ui/dropdown-menu/dropdown-menu-separator.svelte";

  const DropdownMenu = DropdownMenuPrimitive.Root;
  const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
  const DropdownMenuGroup = DropdownMenuPrimitive.Group;
  import { Badge } from "$lib/components/ui/badge";
  import FolderKanban from "@lucide/svelte/icons/folder-kanban";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Bell from "@lucide/svelte/icons/bell";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Settings from "@lucide/svelte/icons/settings";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Menu from "@lucide/svelte/icons/menu";
  import X from "@lucide/svelte/icons/x";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import Check from "@lucide/svelte/icons/check";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { formatTimeAgo } from "$lib/utils/datetime";
  import Footer from "$lib/components/Footer.svelte";
  import EmailVerificationBanner from "$lib/components/EmailVerificationBanner.svelte";
  import TermsAcceptanceModal from "$lib/components/TermsAcceptanceModal.svelte";
  import OnboardingChecklist from "$lib/components/OnboardingChecklist.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import SidebarNav from "$lib/components/shell/SidebarNav.svelte";
  import { logoPath } from "$lib/utils/theme";


  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();

  let user = $state<any>(null);
  let token = $state<string | null>(null);
  let notifications = $state<Notification[]>([]);
  let unreadCount = $state(0);
  let loadingNotifications = $state(false);
  let lastLoadedToken = $state<string | null>(null);
  let currentTime = $state(new Date());
  let mobileMenuOpen = $state(false);
  let sidebarVisible = $state(true);
  let contentDensity = $state<ContentDensity>('compact');

  $effect(() => {
    const unsubscribe = layoutStore.subscribe((state) => {
      sidebarVisible = state.sidebarVisible;
      contentDensity = state.contentDensity;
    });
    return unsubscribe;
  });

  $effect(() => {
    if (!browser) return;

    const unsubscribe = authStore.subscribe((state) => {
      user = state.user;
      token = state.token;
    });

    return unsubscribe;
  });


  // Update current time every minute to refresh relative timestamps
  $effect(() => {
    if (!browser) return;

    const interval = setInterval(() => {
      currentTime = new Date();
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  });

  $effect(() => {
    if (!browser || !token || token === lastLoadedToken || loadingNotifications)
      return;

    loadNotifications();
  });

  async function loadNotifications() {
    if (!token || loadingNotifications) return;

    loadingNotifications = true;
    try {
      const api = new NotificationsAPI(() => token);
      const response = await api.getNotifications({ limit: 10 });
      notifications = response.notifications;
      unreadCount = response.unreadCount;
      lastLoadedToken = token;
    } catch (e) {
      console.error("Failed to load notifications:", e);
    } finally {
      loadingNotifications = false;
    }
  }

  async function markNotificationAsRead(notificationId: string) {
    if (!token) return;

    try {
      const api = new NotificationsAPI(() => token);
      await api.markAsRead(notificationId);

      notifications = notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n,
      );
      unreadCount = Math.max(0, unreadCount - 1);
    } catch (e) {
      console.error("Failed to mark notification as read:", e);
      toastStore.error("Failed to mark notification as read");
    }
  }

  async function markAllAsRead() {
    if (!token) return;

    try {
      const api = new NotificationsAPI(() => token);
      await api.markAllAsRead();

      notifications = notifications.map((n) => ({ ...n, read: true }));
      unreadCount = 0;

      toastStore.success("All notifications marked as read");
    } catch (e) {
      console.error("Failed to mark all as read:", e);
      toastStore.error("Failed to mark all as read");
    }
  }

  async function deleteNotification(notificationId: string) {
    if (!token) return;

    try {
      const api = new NotificationsAPI(() => token);
      await api.deleteNotification(notificationId);

      // Remove from local state
      const deletedNotification = notifications.find(
        (n) => n.id === notificationId,
      );
      notifications = notifications.filter((n) => n.id !== notificationId);

      // Update unread count if the deleted notification was unread
      if (deletedNotification && !deletedNotification.read) {
        unreadCount = Math.max(0, unreadCount - 1);
      }
    } catch (e) {
      console.error("Failed to delete notification:", e);
      toastStore.error("Failed to delete notification");
    }
  }

  async function deleteAllNotifications() {
    if (!token) return;

    try {
      const api = new NotificationsAPI(() => token);
      await api.deleteAllNotifications();

      notifications = [];
      unreadCount = 0;

      toastStore.success("All notifications deleted");
    } catch (e) {
      console.error("Failed to delete all notifications:", e);
      toastStore.error("Failed to delete all notifications");
    }
  }

  function getNotificationIcon(type: string) {
    switch (type) {
      case "alert":
        return AlertTriangle;
      case "system":
        return Bell;
      case "organization_invite":
        return Building2;
      case "project_update":
        return FolderKanban;
      default:
        return Bell;
    }
  }


  // Close the drawer on any route change (links, palette, browser back)
  $effect(() => {
    void page.url.pathname;
    mobileMenuOpen = false;
  });

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && mobileMenuOpen) mobileMenuOpen = false;
  }

  async function handleLogout() {
    // Revoke the server-side session so the token cannot be reused. Best-effort:
    // still clear local state and redirect even if the request fails.
    if (token) {
      try {
        await authAPI.logout(token);
      } catch (e) {
        console.error("Logout request failed", e);
      }
    }
    authStore.clearAuth();
    goto("/login");
  }

  // Install keyboard shortcuts handler
  onMount(() => {
    shortcutsStore.install();

    // First-time hint toast
    let hintTimer: ReturnType<typeof setTimeout> | null = null;
    if (!shortcutsStore.hasShownHint()) {
      const mod = getPlatform().modSymbol;
      // Mark as shown immediately so a fast unmount before the toast fires
      // does not cause the hint to reappear on the next mount.
      shortcutsStore.markHintShown();
      hintTimer = setTimeout(() => {
        toastStore.info(`Pro tip: Press ${mod}+K to open command palette, or ? for shortcuts`, 8000);
      }, 3000);
    }

    return () => {
      if (hintTimer) clearTimeout(hintTimer);
      shortcutsStore.uninstall();
    };
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<TooltipPrimitive.Provider>
<div class="min-h-screen bg-background">
  {#if sidebarVisible}
  <aside
    class="hidden lg:flex fixed left-0 top-0 h-screen w-64 flex-col border-r border-border bg-card z-40"
  >
    <div class="p-6">
      <a href="/dashboard"
        class="flex items-center gap-3 hover:opacity-80 transition-opacity"
      >
        <div class="flex flex-col items-start mx-auto">
            <img src={$logoPath} alt="LogTide" class="h-14 w-auto" />
        </div>
      </a>
    </div>

    <Separator />

    <SidebarNav pathname={page.url.pathname} isAdmin={!!user?.is_admin} />

    <!-- Onboarding Checklist -->
    <div class="p-4 border-t border-border">
      <OnboardingChecklist />
    </div>
  </aside>
  {/if}

  <!-- Mobile menu: always rendered so the slide animation plays; hidden and inert when closed -->
  {#if mobileMenuOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 lg:hidden"
      aria-hidden="true"
      onclick={() => (mobileMenuOpen = false)}
    ></div>
  {/if}

  <aside
    data-drawer
    aria-hidden={mobileMenuOpen ? undefined : "true"}
    inert={!mobileMenuOpen}
    class="fixed left-0 top-0 h-screen w-64 flex flex-col border-r border-border bg-card z-50 lg:hidden transform transition-[transform,visibility] duration-300 ease-in-out {mobileMenuOpen
      ? 'translate-x-0 visible'
      : '-translate-x-full invisible pointer-events-none'}"
  >
    <div class="p-6 flex items-center justify-between">
      <a href="/dashboard" class="flex items-center gap-3 hover:opacity-80 transition-opacity" onclick={() => (mobileMenuOpen = false)}>
        <div class="flex flex-col items-start">
          <img src={$logoPath} alt="LogTide" class="h-14 w-auto" />
        </div>
      </a>
      <Button variant="ghost" size="icon" aria-label="Close menu" onclick={() => (mobileMenuOpen = false)}>
        <X class="w-5 h-5" />
      </Button>
    </div>

    <Separator />

    <SidebarNav
      pathname={page.url.pathname}
      isAdmin={!!user?.is_admin}
      onNavigate={() => (mobileMenuOpen = false)}
    />

    <!-- Onboarding Checklist for Mobile -->
    <div class="p-4 border-t border-border">
      <OnboardingChecklist />
    </div>
  </aside>

  <div class="flex flex-col min-h-screen transition-[margin] duration-200 {sidebarVisible ? 'lg:ml-64' : 'lg:ml-0'}">
    <header
      class="h-16 border-b border-border bg-card px-6 flex items-center justify-between"
    >
      <div class="flex items-center gap-4">
        <Button variant="ghost" size="icon" class="lg:hidden" aria-label="Open menu" onclick={() => (mobileMenuOpen = true)}>
          <Menu class="w-5 h-5" />
        </Button>

        {#if $currentOrganization}
          <div
            class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/50"
          >
            <Building2 class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{$currentOrganization.name}</span>
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-2">
        <!-- Command Palette Trigger -->
        <button
          onclick={() => shortcutsStore.openCommandPalette()}
          class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/50 text-muted-foreground text-sm hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
          title="Command Palette"
        >
          <SearchIcon class="w-4 h-4" />
          <span class="text-xs">Search...</span>
          <kbd class="ml-2 px-1.5 py-0.5 rounded border border-border bg-background text-[10px] font-mono">{getPlatform().modSymbol}K</kbd>
        </button>

        <!-- Layout Controls -->
        <DropdownMenu>
          <DropdownMenuTrigger
            class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-10 w-10"
            title="Layout settings"
          >
            <LayoutGrid class="w-5 h-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuLabel>Layout Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="text-xs font-normal text-muted-foreground py-1">Content Width</DropdownMenuLabel>
            <DropdownMenuItem
              onclick={() => layoutStore.setContentDensity('compact')}
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2 w-full">
                {#if contentDensity === 'compact'}
                  <Check class="w-4 h-4" />
                {:else}
                  <div class="w-4 h-4"></div>
                {/if}
                <span>Compact</span>
                <span class="ml-auto text-xs text-muted-foreground">1280px</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onclick={() => layoutStore.setContentDensity('normal')}
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2 w-full">
                {#if contentDensity === 'normal'}
                  <Check class="w-4 h-4" />
                {:else}
                  <div class="w-4 h-4"></div>
                {/if}
                <span>Normal</span>
                <span class="ml-auto text-xs text-muted-foreground">1536px</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onclick={() => layoutStore.setContentDensity('wide')}
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2 w-full">
                {#if contentDensity === 'wide'}
                  <Check class="w-4 h-4" />
                {:else}
                  <div class="w-4 h-4"></div>
                {/if}
                <span>Wide</span>
                <span class="ml-auto text-xs text-muted-foreground">Full</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onclick={() => layoutStore.toggleSidebar()}
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2 w-full">
                {#if sidebarVisible}
                  <PanelLeftClose class="w-4 h-4" />
                  <span>Hide Sidebar</span>
                {:else}
                  <PanelLeft class="w-4 h-4" />
                  <span>Show Sidebar</span>
                {/if}
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-10 w-10 relative"
          >
            <Bell class="w-5 h-5" />
            {#if unreadCount > 0}
              <Badge
                variant="destructive"
                class="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              >
                {unreadCount}
              </Badge>
            {/if}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-96">
            <div class="flex items-center justify-between px-4 py-2">
              <DropdownMenuLabel class="p-0">Notifications</DropdownMenuLabel>
              <div class="flex items-center gap-2">
                {#if unreadCount > 0}
                  <button
                    onclick={markAllAsRead}
                    class="text-xs text-primary hover:underline"
                  >
                    Mark all as read
                  </button>
                {/if}
                {#if notifications.length > 0}
                  <button
                    onclick={deleteAllNotifications}
                    class="text-xs text-destructive hover:underline"
                  >
                    Delete all
                  </button>
                {/if}
              </div>
            </div>
            <DropdownMenuSeparator />
            <div class="max-h-[400px] overflow-y-auto">
              {#if loadingNotifications}
                <div class="py-8 text-center">
                  <p class="text-sm text-muted-foreground">
                    Loading notifications...
                  </p>
                </div>
              {:else if notifications.length === 0}
                <div class="py-8 text-center">
                  <Bell
                    class="w-12 h-12 mx-auto mb-2 text-muted-foreground opacity-50"
                  />
                  <p class="text-sm text-muted-foreground">No notifications</p>
                </div>
              {:else}
                {#each notifications as notification}
                  {@const Icon = getNotificationIcon(notification.type)}
                  <DropdownMenuItem
                    onclick={() => {
                      if (!notification.read) {
                        markNotificationAsRead(notification.id);
                      }
                      // Switch org if notification belongs to a different one
                      if (notification.organizationId && notification.organizationId !== $currentOrganization?.id) {
                        organizationStore.setCurrentOrganization(notification.organizationId);
                      }
                      // Handle navigation based on notification type
                      if (notification.metadata?.link) {
                        goto(notification.metadata.link);
                      } else if (notification.type === "alert") {
                        goto(`/dashboard/alerts`);
                      }
                    }}
                    class="cursor-pointer flex-col items-start gap-2 px-4 py-3 mb-1 relative group hover:bg-accent/30 transition-colors {!notification.read
                      ? 'bg-accent/50'
                      : ''}"
                  >
                    <div class="flex items-start gap-3 w-full">
                      <div class="mt-0.5">
                        <Icon
                          class="w-4 h-4 {notification.type === 'alert'
                            ? 'text-destructive'
                            : 'text-primary'}"
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                          <p
                            class="text-sm font-medium text-foreground line-clamp-1"
                          >
                            {notification.title}
                          </p>
                          <div class="flex items-center gap-1">
                            {#if !notification.read}
                              <div
                                class="w-2 h-2 rounded-full bg-destructive flex-shrink-0 mt-1.5"
                              ></div>
                            {/if}
                            <button
                              onclick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.id);
                              }}
                              class="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/20 rounded"
                              title="Delete notification"
                            >
                              <X class="w-3 h-3 text-destructive" />
                            </button>
                          </div>
                        </div>
                        <p
                          class="text-xs text-muted-foreground line-clamp-2 mt-0.5"
                        >
                          {notification.message}
                        </p>
                        {#if notification.organizationName || notification.projectName}
                          <div
                            class="flex items-center gap-1 mt-1 text-xs text-muted-foreground"
                          >
                            {#if notification.organizationName}
                              <Building2 class="w-3 h-3" />
                              <span>{notification.organizationName}</span>
                            {/if}
                            {#if notification.projectName}
                              {#if notification.organizationName}
                                <span>•</span>
                              {/if}
                              <FolderKanban class="w-3 h-3" />
                              <span>{notification.projectName}</span>
                            {/if}
                          </div>
                        {/if}
                        <p class="text-xs text-muted-foreground mt-1">
                          {formatTimeAgo(notification.createdAt, currentTime)}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                {/each}
              {/if}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10 p-0"
          >
            <div
              class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold"
            >
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuLabel>
              <div class="flex flex-col space-y-1">
                <p class="text-sm font-medium leading-none">
                  {user?.name || "User"}
                </p>
                <p class="text-xs leading-none text-muted-foreground">
                  {user?.email || ""}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onclick={() => goto("/dashboard/account")}
                class="cursor-pointer"
              >
                <Settings class="w-4 h-4 mr-2" />
                User Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onclick={() => goto("/dashboard/settings")}
                class="cursor-pointer"
              >
                <Building2 class="w-4 h-4 mr-2" />
                Organization Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onclick={handleLogout}
              class="text-destructive cursor-pointer"
            >
              <LogOut class="w-4 h-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    <main class="flex-1 overflow-auto bg-background">
      <!-- SEAM (Wave D): <QuotaBanner /> from W14, props per W14 plan; mount between EmailVerificationBanner and the page content -->
      <EmailVerificationBanner />
      <TermsAcceptanceModal />
      {@render children?.()}
    </main>

    <Footer />
  </div>
</div>

<CommandPalette />
<ShortcutsHelpModal />
</TooltipPrimitive.Provider>
