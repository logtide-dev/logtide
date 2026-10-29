<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DropdownMenuPrimitive.SubContentProps = $props();
</script>

<DropdownMenuPrimitive.SubContent
	bind:ref
	collisionPadding={8}
	class={cn(
		"bg-popover text-popover-foreground z-50 min-w-[8rem] max-w-[calc(100vw-1rem)] max-h-[var(--bits-floating-available-height)] overflow-y-auto rounded-md border p-1 shadow-lg focus:outline-none",
		className
	)}
	{...restProps}
/>
