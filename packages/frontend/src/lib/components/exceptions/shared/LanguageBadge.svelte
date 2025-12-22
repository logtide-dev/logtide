<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { ExceptionLanguage } from '$lib/api/exceptions';

	interface Props {
		language: ExceptionLanguage;
		size?: 'sm' | 'md';
	}

	let { language, size = 'sm' }: Props = $props();

	const languageConfig: Record<ExceptionLanguage, { label: string; color: string }> = {
		nodejs: { label: 'Node.js', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
		python: { label: 'Python', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
		java: { label: 'Java', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
		go: { label: 'Go', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200' },
		php: { label: 'PHP', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
		unknown: { label: 'Unknown', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200' },
	};

	const config = $derived(languageConfig[language] || languageConfig.unknown);
	const sizeClass = $derived(size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1');
</script>

<Badge variant="outline" class="{config.color} {sizeClass} font-mono">
	{config.label}
</Badge>
