<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { Snippet } from 'svelte';

  interface Props {
    /** CSS selector for the target element to highlight */
    target?: string;
    /** Padding around the highlighted element */
    padding?: number;
    /** Whether the spotlight is visible */
    visible?: boolean;
    /** Position of the tooltip relative to target */
    tooltipPosition?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
    /** Allow clicking the highlighted element */
    allowTargetClick?: boolean;
    /** Callback when overlay is clicked */
    onOverlayClick?: () => void;
    /** Children content */
    children?: Snippet;
  }

  let {
    target = '',
    padding = 8,
    visible = true,
    tooltipPosition = 'auto',
    allowTargetClick = true,
    onOverlayClick,
    children
  }: Props = $props();

  let targetRect = $state<DOMRect | null>(null);
  let windowSize = $state({ width: 0, height: 0 });
  let calculatedPosition = $state(tooltipPosition);

  function updateTargetRect() {
    if (!target) {
      targetRect = null;
      return;
    }

    const element = document.querySelector(target);
    if (element) {
      targetRect = element.getBoundingClientRect();
    } else {
      targetRect = null;
    }
  }

  function updateWindowSize() {
    windowSize = {
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function calculateTooltipPosition() {
    if (!targetRect || tooltipPosition !== 'auto') {
      calculatedPosition = tooltipPosition;
      return;
    }

    const spaceTop = targetRect.top;
    const spaceBottom = windowSize.height - targetRect.bottom;
    const spaceLeft = targetRect.left;
    const spaceRight = windowSize.width - targetRect.right;

    const maxSpace = Math.max(spaceTop, spaceBottom, spaceLeft, spaceRight);

    if (maxSpace === spaceBottom) calculatedPosition = 'bottom';
    else if (maxSpace === spaceTop) calculatedPosition = 'top';
    else if (maxSpace === spaceRight) calculatedPosition = 'right';
    else calculatedPosition = 'left';
  }

  function handleOverlayClick(e: MouseEvent) {
    if (!allowTargetClick) {
      onOverlayClick?.();
      return;
    }

    // Check if click is within the highlighted area
    if (targetRect) {
      const rect = {
        left: targetRect.left - padding,
        right: targetRect.right + padding,
        top: targetRect.top - padding,
        bottom: targetRect.bottom + padding
      };

      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        // Click was on the target - let it through
        return;
      }
    }

    onOverlayClick?.();
  }

  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;

  onMount(() => {
    updateWindowSize();
    updateTargetRect();
    calculateTooltipPosition();

    window.addEventListener('resize', updateWindowSize);
    window.addEventListener('scroll', updateTargetRect, true);

    // Observe DOM changes that might affect target position
    resizeObserver = new ResizeObserver(() => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        updateTargetRect();
        calculateTooltipPosition();
      });
    });

    resizeObserver.observe(document.body);

    return () => {
      window.removeEventListener('resize', updateWindowSize);
      window.removeEventListener('scroll', updateTargetRect, true);
      resizeObserver?.disconnect();
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  });

  $effect(() => {
    if (visible && target) {
      updateTargetRect();
      calculateTooltipPosition();
    }
  });

  let clipPath = $derived.by(() => {
    if (!targetRect) return 'none';

    const left = Math.max(0, targetRect.left - padding);
    const top = Math.max(0, targetRect.top - padding);
    const right = Math.min(windowSize.width, targetRect.right + padding);
    const bottom = Math.min(windowSize.height, targetRect.bottom + padding);

    // Create a path that covers the entire screen except the target area
    return `polygon(
      0% 0%,
      0% 100%,
      ${left}px 100%,
      ${left}px ${top}px,
      ${right}px ${top}px,
      ${right}px ${bottom}px,
      ${left}px ${bottom}px,
      ${left}px 100%,
      100% 100%,
      100% 0%
    )`;
  });

  let tooltipStyle = $derived.by(() => {
    if (!targetRect) return '';

    const centerX = targetRect.left + targetRect.width / 2;
    const centerY = targetRect.top + targetRect.height / 2;

    switch (calculatedPosition) {
      case 'top':
        return `bottom: ${windowSize.height - targetRect.top + padding + 16}px; left: ${centerX}px; transform: translateX(-50%);`;
      case 'bottom':
        return `top: ${targetRect.bottom + padding + 16}px; left: ${centerX}px; transform: translateX(-50%);`;
      case 'left':
        return `right: ${windowSize.width - targetRect.left + padding + 16}px; top: ${centerY}px; transform: translateY(-50%);`;
      case 'right':
        return `left: ${targetRect.right + padding + 16}px; top: ${centerY}px; transform: translateY(-50%);`;
      default:
        return `top: ${targetRect.bottom + padding + 16}px; left: ${centerX}px; transform: translateX(-50%);`;
    }
  });
</script>

{#if visible}
  <!-- Overlay backdrop with hole for target -->
  <div
    class="fixed inset-0 z-[9998] bg-black/70 transition-all duration-300"
    style:clip-path={clipPath}
    onclick={handleOverlayClick}
    role="presentation"
    transition:fade={{ duration: 200 }}
  ></div>

  <!-- Target highlight border -->
  {#if targetRect}
    <div
      class="fixed z-[9999] pointer-events-none border-2 border-primary rounded-lg shadow-[0_0_0_4px_rgba(var(--primary-rgb),0.3)] transition-all duration-300"
      style="
        left: {targetRect.left - padding}px;
        top: {targetRect.top - padding}px;
        width: {targetRect.width + padding * 2}px;
        height: {targetRect.height + padding * 2}px;
      "
      transition:scale={{ duration: 300, easing: quintOut }}
    ></div>
  {/if}

  <!-- Tooltip content slot -->
  {#if targetRect}
    <div
      class="fixed z-[10000] max-w-sm"
      style={tooltipStyle}
      transition:fade={{ duration: 200, delay: 100 }}
    >
      {#if children}
        {@render children()}
      {/if}
    </div>
  {:else}
    <!-- Centered content when no target -->
    <div
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      transition:fade={{ duration: 200 }}
    >
      {#if children}
        {@render children()}
      {/if}
    </div>
  {/if}
{/if}

<style>
  :global(:root) {
    --primary-rgb: 59, 130, 246;
  }
</style>
