<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import Globe from '@lucide/svelte/icons/globe';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Clock from '@lucide/svelte/icons/clock';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	interface GeoIpEntry {
		ip: string;
		country: string;
		countryCode: string;
		city: string | null;
		latitude: number;
		longitude: number;
		timezone: string | null;
		source: string;
	}

	interface Props {
		geoData: Record<string, GeoIpEntry>;
	}

	let { geoData }: Props = $props();

	const geoEntries = $derived(Object.entries(geoData));

	/**
	 * Convert ISO 3166-1 alpha-2 country code to flag emoji
	 * Example: 'US' -> '🇺🇸', 'IT' -> '🇮🇹'
	 */
	function getCountryFlag(countryCode: string): string {
		if (!countryCode || countryCode.length !== 2) return '🌍';
		const codePoints = countryCode
			.toUpperCase()
			.split('')
			.map((char) => 127397 + char.charCodeAt(0));
		return String.fromCodePoint(...codePoints);
	}

	function getGoogleMapsUrl(lat: number, lon: number): string {
		return `https://www.google.com/maps?q=${lat},${lon}`;
	}

	function formatCoordinates(lat: number, lon: number): string {
		const latDir = lat >= 0 ? 'N' : 'S';
		const lonDir = lon >= 0 ? 'E' : 'W';
		return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Globe class="w-4 h-4" />
			Geographic Data
			<Badge variant="secondary" class="ml-auto">{geoEntries.length}</Badge>
		</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="space-y-4">
			{#each geoEntries as [ip, data]}
				<div class="border rounded-lg p-3">
					<div class="flex items-start gap-3">
						<span class="text-2xl" title={data.country}>{getCountryFlag(data.countryCode)}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-mono text-sm font-medium">{ip}</span>
							</div>
							<div class="mt-1 text-sm text-muted-foreground">
								{#if data.city}
									<span>{data.city}, </span>
								{/if}
								<span>{data.country}</span>
							</div>

							<div class="mt-2 space-y-1 text-xs">
								{#if data.timezone}
									<div class="flex items-center gap-1.5 text-muted-foreground">
										<Clock class="w-3 h-3" />
										<span>{data.timezone}</span>
									</div>
								{/if}
								<div class="flex items-center gap-1.5">
									<MapPin class="w-3 h-3 text-muted-foreground" />
									<a
										href={getGoogleMapsUrl(data.latitude, data.longitude)}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={`View ${ip} location on Google Maps (opens in new tab)`}
										class="text-primary hover:underline inline-flex items-center gap-1"
									>
										{formatCoordinates(data.latitude, data.longitude)}
										<ExternalLink class="w-3 h-3" />
									</a>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</CardContent>
</Card>
