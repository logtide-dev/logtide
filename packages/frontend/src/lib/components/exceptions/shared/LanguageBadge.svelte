<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { BrandIcon, languageBrand } from '$lib/components/brand';
	import type { ExceptionLanguage } from '$lib/api/exceptions';

	interface Props {
		language: ExceptionLanguage;
		size?: 'sm' | 'md';
	}

	let { language, size = 'sm' }: Props = $props();

	const LABELS: Record<ExceptionLanguage, string> = {
		nodejs: 'Node.js',
		python: 'Python',
		java: 'Java',
		go: 'Go',
		php: 'PHP',
		kotlin: 'Kotlin',
		csharp: 'C#',
		rust: 'Rust',
		ruby: 'Ruby',
		unknown: 'Unknown',
	};

	const label = $derived(LABELS[language] ?? LABELS.unknown);
	const brand = $derived(languageBrand(language));
	const sizeClass = $derived(size === 'sm' ? 'text-xs px-1.5 py-0.5 gap-1' : 'text-sm px-2 py-1 gap-1.5');
	const iconClass = $derived(size === 'sm' ? 'size-3.5' : 'size-4');
</script>

<Badge variant="outline" class="{sizeClass} font-normal text-foreground">
	{#if brand}<BrandIcon {brand} class={iconClass} />{/if}
	{label}
</Badge>
