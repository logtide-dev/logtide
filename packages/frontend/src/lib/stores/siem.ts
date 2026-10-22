import { writable, derived, get } from 'svelte/store';
import { getDashboardStats, type DashboardStats, type Severity } from '$lib/api/siem';
import { incidentsAPI, type InboxFilters } from '$lib/api/incidents';
import type { IncidentListItem } from '@logtide/shared';
import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { requestStreamTicket } from '$lib/api/stream-tickets';

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
	incidents: IncidentListItem[];
	incidentsLoading: boolean;
	incidentsError: string | null;
	incidentsTotal: number;

	// Real-time
	sseConnection: EventSource | null;
	realtimeEnabled: boolean;
	lastSseEvent: { type: string; timestamp: number } | null;
	sseStatus: SseStatus;
}

export type SseStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'disconnected';

export interface RealtimeOptions {
	incidentId?: string;
	projectIds?: string[];
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

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
	incidentsTotal: 0,

	// Real-time
	sseConnection: null,
	realtimeEnabled: false,
	lastSseEvent: null,
	sseStatus: 'idle',
};

// ============================================================================
// STORE
// ============================================================================

function createSiemStore() {
	const { subscribe, set, update } = writable<SiemState>(initialState);

	// Bookkeeping that must not trigger renders.
	let loadSeq = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempts = 0;
	let realtimeGeneration = 0;
	let realtimeTarget: { organizationId: string; opts: RealtimeOptions } | null = null;
	let incidentMatcher: ((i: IncidentListItem) => boolean) | null = null;

	function clearReconnectTimer(): void {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function closeSource(): void {
		const current = get({ subscribe }).sseConnection;
		if (current) {
			current.onmessage = null;
			current.onerror = null;
			current.close();
		}
	}

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

		async loadIncidents(
			organizationId: string,
			filters: Omit<InboxFilters, 'organizationId'>,
			opts: { silent?: boolean } = {}
		): Promise<void> {
			const seq = ++loadSeq;
			if (!opts.silent) {
				update((state) => ({ ...state, incidentsLoading: true, incidentsError: null }));
			}

			try {
				const response = await incidentsAPI.list({ ...filters, organizationId });
				// A newer load started meanwhile: its result wins.
				if (seq !== loadSeq) return;
				update((state) => ({
					...state,
					incidents: response.incidents,
					incidentsTotal: response.total,
					incidentsLoading: false,
					incidentsError: null,
				}));
			} catch (error) {
				if (seq !== loadSeq) return;
				// A failed background refresh keeps the rows on screen.
				if (opts.silent) return;
				update((state) => ({
					...state,
					incidentsLoading: false,
					incidentsError: error instanceof Error ? error.message : 'Failed to load incidents',
				}));
			}
		},

		/** Decides whether an incident_created event belongs in the current list. */
		setIncidentMatcher(fn: ((i: IncidentListItem) => boolean) | null): void {
			incidentMatcher = fn;
		},

		// ========================================
		// Real-time Methods (SSE)
		// ========================================

		async startRealtimeUpdates(organizationId: string, opts: RealtimeOptions = {}): Promise<void> {
			clearReconnectTimer();
			closeSource();
			reconnectAttempts = 0;
			realtimeGeneration++;
			realtimeTarget = { organizationId, opts };
			update((state) => ({ ...state, sseConnection: null, sseStatus: 'connecting' }));
			await this.connectRealtime(realtimeGeneration);
		},

		/** One connection attempt with a fresh single-use ticket. */
		async connectRealtime(generation: number): Promise<void> {
			const target = realtimeTarget;
			if (!target || generation !== realtimeGeneration) return;

			const token = getAuthToken();
			if (!token) {
				update((state) => ({ ...state, sseStatus: 'disconnected', realtimeEnabled: false }));
				return;
			}

			let ticket: string;
			try {
				ticket = await requestStreamTicket(token);
			} catch (error) {
				console.error('Failed to obtain SIEM stream ticket:', error);
				this.scheduleReconnect(generation);
				return;
			}
			if (generation !== realtimeGeneration) return;

			const params = new URLSearchParams({ organizationId: target.organizationId });
			if (target.opts.incidentId) params.append('incidentId', target.opts.incidentId);
			// The stream filters by one project only; several are filtered by the matcher.
			if (target.opts.projectIds?.length === 1) params.append('projectId', target.opts.projectIds[0]);
			params.append('ticket', ticket);

			closeSource();
			const eventSource = new EventSource(`${getApiUrl()}/api/v1/siem/events?${params.toString()}`);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data?.type === 'connected') {
						reconnectAttempts = 0;
						update((state) => ({ ...state, sseStatus: 'live' }));
					}
					this.handleRealtimeEvent(data);
				} catch {
					console.error('Failed to parse SSE event:', event.data);
				}
			};

			// A ticket is single use, so the browser's own retry would reuse a dead URL:
			// close the source and reconnect with a new ticket.
			eventSource.onerror = () => {
				if (generation !== realtimeGeneration) return;
				eventSource.onmessage = null;
				eventSource.onerror = null;
				eventSource.close();
				this.scheduleReconnect(generation);
			};

			update((state) => ({
				...state,
				sseConnection: eventSource,
				realtimeEnabled: true,
			}));
		},

		scheduleReconnect(generation: number): void {
			if (generation !== realtimeGeneration) return;
			clearReconnectTimer();
			closeSource();
			if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
				update((state) => ({
					...state,
					sseConnection: null,
					realtimeEnabled: false,
					sseStatus: 'disconnected',
				}));
				return;
			}
			const delay = RECONNECT_BASE_MS * 2 ** reconnectAttempts;
			reconnectAttempts++;
			update((state) => ({ ...state, sseConnection: null, sseStatus: 'reconnecting' }));
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				void this.connectRealtime(generation);
			}, delay);
		},

		stopRealtimeUpdates(): void {
			clearReconnectTimer();
			closeSource();
			realtimeGeneration++;
			realtimeTarget = null;
			reconnectAttempts = 0;
			update((state) => ({
				...state,
				sseConnection: null,
				realtimeEnabled: false,
				sseStatus: 'idle',
			}));
		},

		handleRealtimeEvent(event: {
			type: string;
			data: unknown;
		}): void {
			const timestamp = Date.now();

			switch (event.type) {
				case 'incident_created': {
					const incoming = event.data as IncidentListItem;
					update((state) => {
						const exists = state.incidents.some((inc) => inc.id === incoming.id);
						const accepted = !incidentMatcher || incidentMatcher(incoming);
						const add = !exists && accepted;
						return {
							...state,
							incidents: add ? [incoming, ...state.incidents] : state.incidents,
							incidentsTotal: add ? state.incidentsTotal + 1 : state.incidentsTotal,
							lastSseEvent: { type: 'incident_created', timestamp },
						};
					});
					break;
				}

				case 'incident_updated':
					// Merge by id and keep the row position; rows not in the list are ignored.
					update((state) => ({
						...state,
						incidents: state.incidents.map((inc) =>
							inc.id === (event.data as IncidentListItem).id
								? { ...inc, ...(event.data as IncidentListItem) }
								: inc
						),
						lastSseEvent: { type: 'incident_updated', timestamp },
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
					break;
			}
		},

		// ========================================
		// Utility Methods
		// ========================================

		clear(): void {
			clearReconnectTimer();
			closeSource();
			realtimeGeneration++;
			realtimeTarget = null;
			reconnectAttempts = 0;
			incidentMatcher = null;
			loadSeq++;
			set(initialState);
		},

		/** Replace the local rows (the detail page seeds its own incident so stream updates merge in place). */
		seedIncidents(items: IncidentListItem[]): void {
			update((state) => ({ ...state, incidents: items, incidentsTotal: items.length }));
		},

		// Add incident to local state (for optimistic updates)
		addIncident(incident: IncidentListItem): void {
			update((state) => ({
				...state,
				incidents: [incident, ...state.incidents],
			}));
		},

		// Update incident in local state (for optimistic updates)
		updateIncidentLocal(incidentId: string, updates: Partial<IncidentListItem>): void {
			update((state) => ({
				...state,
				incidents: state.incidents.map((inc) =>
					inc.id === incidentId ? { ...inc, ...updates } : inc
				),
			}));
		},

		// Remove incident from local state
		removeIncident(incidentId: string): void {
			update((state) => {
				const present = state.incidents.some((inc) => inc.id === incidentId);
				return {
					...state,
					incidents: state.incidents.filter((inc) => inc.id !== incidentId),
					incidentsTotal: present ? Math.max(0, state.incidentsTotal - 1) : state.incidentsTotal,
				};
			});
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
export const incidentsTotal = derived(siemStore, ($store) => $store.incidentsTotal);

export const realtimeEnabled = derived(siemStore, ($store) => $store.realtimeEnabled);
export const lastSseEvent = derived(siemStore, ($store) => $store.lastSseEvent);
export const sseStatus = derived(siemStore, ($store) => $store.sseStatus);
