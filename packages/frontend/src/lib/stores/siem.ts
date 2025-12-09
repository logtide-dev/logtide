import { writable, derived, get } from 'svelte/store';
import {
	getDashboardStats,
	listIncidents,
	type DashboardStats,
	type Incident,
	type IncidentFilters,
	type Severity,
} from '$lib/api/siem';

// ============================================================================
// TYPES
// ============================================================================

export interface SiemState {
	// Dashboard
	dashboardStats: DashboardStats | null;
	dashboardLoading: boolean;
	dashboardError: string | null;
	dashboardTimeRange: '24h' | '7d' | '30d';
	dashboardSeverityFilter: Severity[];

	// Incidents
	incidents: Incident[];
	incidentsLoading: boolean;
	incidentsError: string | null;
	incidentFilters: Omit<IncidentFilters, 'organizationId'>;
	incidentsTotal: number;

	// Real-time
	sseConnection: EventSource | null;
	realtimeEnabled: boolean;
	lastSseEvent: { type: string; timestamp: number } | null;
}

const initialState: SiemState = {
	// Dashboard
	dashboardStats: null,
	dashboardLoading: false,
	dashboardError: null,
	dashboardTimeRange: '24h',
	dashboardSeverityFilter: [],

	// Incidents
	incidents: [],
	incidentsLoading: false,
	incidentsError: null,
	incidentFilters: {
		limit: 20,
		offset: 0,
	},
	incidentsTotal: 0,

	// Real-time
	sseConnection: null,
	realtimeEnabled: false,
	lastSseEvent: null,
};

// ============================================================================
// STORE
// ============================================================================

function createSiemStore() {
	const { subscribe, set, update } = writable<SiemState>(initialState);

	return {
		subscribe,

		// ========================================
		// Dashboard Methods
		// ========================================

		async loadDashboard(organizationId: string, projectId?: string): Promise<void> {
			update((state) => ({
				...state,
				dashboardLoading: true,
				dashboardError: null,
			}));

			try {
				const stats = await getDashboardStats({
					organizationId,
					projectId,
					timeRange: get({ subscribe }).dashboardTimeRange,
					severity:
						get({ subscribe }).dashboardSeverityFilter.length > 0
							? get({ subscribe }).dashboardSeverityFilter
							: undefined,
				});

				update((state) => ({
					...state,
					dashboardStats: stats,
					dashboardLoading: false,
				}));
			} catch (error) {
				update((state) => ({
					...state,
					dashboardLoading: false,
					dashboardError: error instanceof Error ? error.message : 'Failed to load dashboard',
				}));
			}
		},

		setTimeRange(range: '24h' | '7d' | '30d'): void {
			update((state) => ({
				...state,
				dashboardTimeRange: range,
			}));
		},

		setSeverityFilter(severities: Severity[]): void {
			update((state) => ({
				...state,
				dashboardSeverityFilter: severities,
			}));
		},

		// ========================================
		// Incidents Methods
		// ========================================

		async loadIncidents(organizationId: string, projectId?: string): Promise<void> {
			update((state) => ({
				...state,
				incidentsLoading: true,
				incidentsError: null,
			}));

			try {
				const currentState = get({ subscribe });
				const response = await listIncidents({
					organizationId,
					projectId,
					...currentState.incidentFilters,
				});

				update((state) => ({
					...state,
					incidents: response.incidents,
					incidentsLoading: false,
				}));
			} catch (error) {
				update((state) => ({
					...state,
					incidentsLoading: false,
					incidentsError: error instanceof Error ? error.message : 'Failed to load incidents',
				}));
			}
		},

		setIncidentFilters(filters: Partial<Omit<IncidentFilters, 'organizationId'>>): void {
			update((state) => ({
				...state,
				incidentFilters: {
					...state.incidentFilters,
					...filters,
				},
			}));
		},

		resetIncidentFilters(): void {
			update((state) => ({
				...state,
				incidentFilters: {
					limit: 20,
					offset: 0,
				},
			}));
		},

		setPage(page: number): void {
			update((state) => ({
				...state,
				incidentFilters: {
					...state.incidentFilters,
					offset: (page - 1) * (state.incidentFilters.limit || 20),
				},
			}));
		},

		// ========================================
		// Real-time Methods (SSE)
		// ========================================

		startRealtimeUpdates(organizationId: string, incidentId?: string): void {
			const currentState = get({ subscribe });

			// Close existing connection
			if (currentState.sseConnection) {
				currentState.sseConnection.close();
			}

			const token = localStorage.getItem('session_token');
			if (!token) return;

			const params = new URLSearchParams({ organizationId });
			if (incidentId) {
				params.append('incidentId', incidentId);
			}

			const eventSource = new EventSource(
				`/api/v1/siem/events?${params.toString()}&token=${token}`
			);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					this.handleRealtimeEvent(data);
				} catch {
					console.error('Failed to parse SSE event:', event.data);
				}
			};

			eventSource.onerror = () => {
				console.error('SSE connection error, attempting reconnect...');
				// Auto-reconnect handled by EventSource
			};

			update((state) => ({
				...state,
				sseConnection: eventSource,
				realtimeEnabled: true,
			}));
		},

		stopRealtimeUpdates(): void {
			update((state) => {
				if (state.sseConnection) {
					state.sseConnection.close();
				}
				return {
					...state,
					sseConnection: null,
					realtimeEnabled: false,
				};
			});
		},

		handleRealtimeEvent(event: {
			type: string;
			data: unknown;
		}): void {
			const timestamp = Date.now();

			switch (event.type) {
				case 'incident_created':
					update((state) => ({
						...state,
						incidents: [event.data as Incident, ...state.incidents],
						lastSseEvent: { type: 'incident_created', timestamp },
					}));
					break;

				case 'incident_updated':
					update((state) => ({
						...state,
						incidents: state.incidents.map((inc) =>
							inc.id === (event.data as Incident).id ? (event.data as Incident) : inc
						),
						lastSseEvent: { type: 'incident_updated', timestamp },
					}));
					break;

				case 'incident_deleted':
					update((state) => ({
						...state,
						incidents: state.incidents.filter(
							(inc) => inc.id !== (event.data as { id: string }).id
						),
						lastSseEvent: { type: 'incident_deleted', timestamp },
					}));
					break;

				case 'detection_created':
					// Refresh dashboard stats when new detection occurs
					// The component should call loadDashboard after receiving this
					update((state) => ({
						...state,
						lastSseEvent: { type: 'detection_created', timestamp },
					}));
					break;

				case 'connected':
					// Initial connection established
					break;

				default:
					console.log('Unknown SSE event type:', event.type);
			}
		},

		// ========================================
		// Utility Methods
		// ========================================

		clear(): void {
			const currentState = get({ subscribe });
			if (currentState.sseConnection) {
				currentState.sseConnection.close();
			}
			set(initialState);
		},

		// Add incident to local state (for optimistic updates)
		addIncident(incident: Incident): void {
			update((state) => ({
				...state,
				incidents: [incident, ...state.incidents],
			}));
		},

		// Update incident in local state (for optimistic updates)
		updateIncidentLocal(incidentId: string, updates: Partial<Incident>): void {
			update((state) => ({
				...state,
				incidents: state.incidents.map((inc) =>
					inc.id === incidentId ? { ...inc, ...updates } : inc
				),
			}));
		},

		// Remove incident from local state
		removeIncident(incidentId: string): void {
			update((state) => ({
				...state,
				incidents: state.incidents.filter((inc) => inc.id !== incidentId),
			}));
		},
	};
}

// ============================================================================
// EXPORTS
// ============================================================================

export const siemStore = createSiemStore();

// Derived stores for easy access to specific state slices
export const dashboardStats = derived(siemStore, ($store) => $store.dashboardStats);
export const dashboardLoading = derived(siemStore, ($store) => $store.dashboardLoading);
export const dashboardError = derived(siemStore, ($store) => $store.dashboardError);
export const dashboardTimeRange = derived(siemStore, ($store) => $store.dashboardTimeRange);

export const incidents = derived(siemStore, ($store) => $store.incidents);
export const incidentsLoading = derived(siemStore, ($store) => $store.incidentsLoading);
export const incidentsError = derived(siemStore, ($store) => $store.incidentsError);
export const incidentFilters = derived(siemStore, ($store) => $store.incidentFilters);

export const realtimeEnabled = derived(siemStore, ($store) => $store.realtimeEnabled);
export const lastSseEvent = derived(siemStore, ($store) => $store.lastSseEvent);
