<script lang="ts">
	import { browser } from '$app/environment';
	import { tick, onMount } from 'svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import MapIcon from '@lucide/svelte/icons/map';
	import type { Map as LeafletMap } from 'leaflet';

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

	let mapContainer: HTMLDivElement | undefined = $state();
	let map: LeafletMap | null = $state(null);
	let mapError = $state<string | null>(null);
	let isInitializing = $state(false);
	let isMounted = $state(false);

	const geoEntries = $derived(Object.entries(geoData));

	// Filter out entries with invalid coordinates
	const validEntries = $derived(
		geoEntries.filter(([, data]) => {
			return (
				data.latitude !== 0 &&
				data.longitude !== 0 &&
				!isNaN(data.latitude) &&
				!isNaN(data.longitude)
			);
		})
	);

	/**
	 * Escape HTML to prevent XSS in popup content
	 */
	function escapeHtml(text: string | null | undefined): string {
		if (!text) return '';
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function destroyMap() {
		if (map) {
			try {
				map.remove();
			} catch {
				// Ignore errors during cleanup
			}
			map = null;
		}
	}

	async function initializeMap() {
		// Guard against multiple concurrent initializations
		if (isInitializing || !browser || !isMounted) return;

		// Wait for DOM to settle
		await tick();

		if (!mapContainer || validEntries.length === 0) return;

		// Check if container already has a map (Leaflet adds _leaflet_id)
		if ((mapContainer as any)._leaflet_id) {
			destroyMap();
			await tick();
		}

		// Final check after cleanup
		if (!mapContainer || !document.body.contains(mapContainer)) return;

		isInitializing = true;

		try {
			// Dynamic import to avoid SSR issues
			const L = await import('leaflet');

			// Import CSS
			await import('leaflet/dist/leaflet.css');

			// Fix default marker icon path issue in bundlers
			// @ts-ignore
			delete L.Icon.Default.prototype._getIconUrl;
			L.Icon.Default.mergeOptions({
				iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
				iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
				shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
			});

			// Final check before creating map
			if (!mapContainer || !document.body.contains(mapContainer)) {
				isInitializing = false;
				return;
			}

			// Initialize map
			map = L.map(mapContainer).setView([0, 0], 2);

			// Add OpenStreetMap tiles
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution:
					'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
				maxZoom: 19,
			}).addTo(map);

			// Add markers with sanitized popup content
			const bounds = L.latLngBounds([]);

			validEntries.forEach(([ip, data]) => {
				const marker = L.marker([data.latitude, data.longitude]).addTo(map!);

				// Create popup content with escaped values to prevent XSS
				const escapedIp = escapeHtml(ip);
				const escapedCity = escapeHtml(data.city);
				const escapedCountry = escapeHtml(data.country);

				marker.bindPopup(`
					<div class="text-sm">
						<div class="font-mono font-semibold">${escapedIp}</div>
						<div class="text-muted-foreground mt-1">
							${escapedCity ? `${escapedCity}, ` : ''}${escapedCountry}
						</div>
						<div class="text-xs text-muted-foreground mt-1">
							${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}
						</div>
					</div>
				`);
				bounds.extend([data.latitude, data.longitude]);
			});

			// Fit bounds with padding
			if (validEntries.length > 0) {
				if (validEntries.length === 1) {
					// Single marker: center on it with fixed zoom
					const [, data] = validEntries[0];
					map.setView([data.latitude, data.longitude], 10);
				} else {
					// Multiple markers: fit bounds
					map.fitBounds(bounds, { padding: [50, 50] });
				}
			}

			mapError = null;
		} catch (error) {
			console.error('Failed to initialize map:', error);
			mapError = 'Failed to load map';
		} finally {
			isInitializing = false;
		}
	}

	onMount(() => {
		isMounted = true;
		return () => {
			isMounted = false;
			destroyMap();
		};
	});

	$effect(() => {
		// Track dependencies
		const entries = validEntries;
		const container = mapContainer;

		if (browser && isMounted && container && entries.length > 0) {
			// Use timeout to debounce rapid updates
			const timeout = setTimeout(() => {
				initializeMap();
			}, 100);

			return () => {
				clearTimeout(timeout);
			};
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</svelte:head>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<MapIcon class="w-4 h-4" />
			IP Locations
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if validEntries.length === 0}
			<div class="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
				No valid coordinates available
			</div>
		{:else if mapError}
			<div class="h-[300px] flex items-center justify-center text-destructive text-sm">
				{mapError}
			</div>
		{:else}
			<div bind:this={mapContainer} class="h-[300px] rounded-md border"></div>
		{/if}
	</CardContent>
</Card>
