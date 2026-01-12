import type { Severity, Incident, DetectionEvent, IncidentComment, IncidentHistoryEntry } from '$lib/api/siem';

// ============================================================================
// SEVERITY HELPERS
// ============================================================================

export function getSeverityColor(severity: Severity): string {
	switch (severity) {
		case 'critical':
			return '#a855f7'; // purple-500
		case 'high':
			return '#ef4444'; // red-500
		case 'medium':
			return '#f97316'; // orange-500
		case 'low':
			return '#eab308'; // yellow-500
		case 'informational':
			return '#3b82f6'; // blue-500
		default:
			return '#6b7280'; // gray-500
	}
}

export function getSeverityLabel(severity: Severity): string {
	switch (severity) {
		case 'critical':
			return 'Critical';
		case 'high':
			return 'High';
		case 'medium':
			return 'Medium';
		case 'low':
			return 'Low';
		case 'informational':
			return 'Informational';
		default:
			return severity;
	}
}

// ============================================================================
// STATUS HELPERS
// ============================================================================

export function getStatusLabel(status: string): string {
	switch (status) {
		case 'open':
			return 'Open';
		case 'investigating':
			return 'Investigating';
		case 'resolved':
			return 'Resolved';
		case 'false_positive':
			return 'False Positive';
		default:
			return status;
	}
}

// ============================================================================
// MITRE HELPERS
// ============================================================================

const MITRE_TACTICS: Record<string, string> = {
	'TA0043': 'Reconnaissance',
	'TA0042': 'Resource Development',
	'TA0001': 'Initial Access',
	'TA0002': 'Execution',
	'TA0003': 'Persistence',
	'TA0004': 'Privilege Escalation',
	'TA0005': 'Defense Evasion',
	'TA0006': 'Credential Access',
	'TA0007': 'Discovery',
	'TA0008': 'Lateral Movement',
	'TA0009': 'Collection',
	'TA0011': 'Command and Control',
	'TA0010': 'Exfiltration',
	'TA0040': 'Impact',
};

export function formatMitreTactic(tactic: string): string {
	const upper = tactic.toUpperCase();
	if (MITRE_TACTICS[upper]) {
		return `${upper}: ${MITRE_TACTICS[upper]}`;
	}
	return tactic;
}

export function formatMitreTechnique(technique: string): string {
	// Format T1234 or T1234.001
	if (technique.match(/^T\d{4}(\.\d{3})?$/i)) {
		return technique.toUpperCase();
	}
	return technique;
}

// ============================================================================
// DATE HELPERS
// ============================================================================

export function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('it-IT', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function formatShortDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('it-IT', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function formatTimeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) {
		return 'Just now';
	} else if (diffMins < 60) {
		return `${diffMins}m ago`;
	} else if (diffHours < 24) {
		return `${diffHours}h ago`;
	} else {
		return `${diffDays}d ago`;
	}
}

// ============================================================================
// PDF EXPORT
// ============================================================================

interface PdfExportData {
	incident: Incident;
	detections: DetectionEvent[];
	comments: IncidentComment[];
	history: IncidentHistoryEntry[];
}

/**
 * Export incident data to PDF format.
 * Uses the browser's print functionality to generate a PDF.
 */
export async function exportIncidentToPdf(data: PdfExportData): Promise<void> {
	const { incident, detections, comments, history } = data;

	// Create a new window with formatted content
	const printWindow = window.open('', '_blank');
	if (!printWindow) {
		throw new Error('Could not open print window. Please allow popups.');
	}

	const html = `
<!DOCTYPE html>
<html>
<head>
	<title>Incident Report - ${incident.title}</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			font-size: 12px;
			line-height: 1.5;
			color: #1a1a1a;
			padding: 40px;
		}
		.header {
			border-bottom: 2px solid #3b82f6;
			padding-bottom: 20px;
			margin-bottom: 30px;
		}
		.logo {
			font-size: 24px;
			font-weight: bold;
			color: #3b82f6;
			margin-bottom: 10px;
		}
		.title {
			font-size: 20px;
			font-weight: bold;
			margin-bottom: 8px;
		}
		.subtitle {
			color: #666;
			font-size: 14px;
		}
		.badges {
			display: flex;
			gap: 8px;
			margin-top: 12px;
		}
		.badge {
			display: inline-block;
			padding: 4px 10px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
		}
		.badge-critical { background: #a855f7; color: white; }
		.badge-high { background: #ef4444; color: white; }
		.badge-medium { background: #f97316; color: white; }
		.badge-low { background: #eab308; color: black; }
		.badge-info { background: #3b82f6; color: white; }
		.badge-status { background: #e5e7eb; color: #374151; }

		.section {
			margin-bottom: 30px;
		}
		.section-title {
			font-size: 14px;
			font-weight: bold;
			color: #374151;
			margin-bottom: 12px;
			padding-bottom: 6px;
			border-bottom: 1px solid #e5e7eb;
		}

		.info-grid {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 16px;
		}
		.info-item label {
			display: block;
			font-size: 10px;
			text-transform: uppercase;
			color: #6b7280;
			margin-bottom: 4px;
		}
		.info-item span {
			font-weight: 500;
		}

		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 11px;
		}
		th {
			background: #f3f4f6;
			text-align: left;
			padding: 8px;
			font-weight: 600;
			border-bottom: 1px solid #e5e7eb;
		}
		td {
			padding: 8px;
			border-bottom: 1px solid #f3f4f6;
			vertical-align: top;
		}
		tr:nth-child(even) {
			background: #fafafa;
		}

		.comment {
			background: #f9fafb;
			border-radius: 6px;
			padding: 12px;
			margin-bottom: 12px;
		}
		.comment-header {
			display: flex;
			justify-content: space-between;
			margin-bottom: 8px;
			font-size: 11px;
		}
		.comment-author {
			font-weight: 600;
		}
		.comment-time {
			color: #6b7280;
		}
		.comment-text {
			white-space: pre-wrap;
		}

		.timeline-item {
			display: flex;
			gap: 12px;
			margin-bottom: 12px;
		}
		.timeline-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #3b82f6;
			margin-top: 4px;
			flex-shrink: 0;
		}
		.timeline-content {
			flex: 1;
		}
		.timeline-action {
			font-weight: 500;
		}
		.timeline-meta {
			font-size: 10px;
			color: #6b7280;
		}

		.footer {
			margin-top: 40px;
			padding-top: 20px;
			border-top: 1px solid #e5e7eb;
			font-size: 10px;
			color: #6b7280;
			text-align: center;
		}

		@media print {
			body { padding: 20px; }
			.section { page-break-inside: avoid; }
		}
	</style>
</head>
<body>
	<div class="header">
		<div class="logo">LogTide Security</div>
		<div class="title">${escapeHtml(incident.title)}</div>
		<div class="subtitle">Incident Report - Generated ${formatDate(new Date().toISOString())}</div>
		<div class="badges">
			<span class="badge badge-${incident.severity}">${getSeverityLabel(incident.severity)}</span>
			<span class="badge badge-status">${getStatusLabel(incident.status)}</span>
		</div>
	</div>

	<div class="section">
		<h2 class="section-title">Incident Details</h2>
		<div class="info-grid">
			<div class="info-item">
				<label>Incident ID</label>
				<span>${incident.id}</span>
			</div>
			<div class="info-item">
				<label>Created</label>
				<span>${formatDate(incident.createdAt)}</span>
			</div>
			<div class="info-item">
				<label>Detection Events</label>
				<span>${incident.detectionCount}</span>
			</div>
			<div class="info-item">
				<label>Status</label>
				<span>${getStatusLabel(incident.status)}</span>
			</div>
			${incident.resolvedAt ? `
			<div class="info-item">
				<label>Resolved</label>
				<span>${formatDate(incident.resolvedAt)}</span>
			</div>
			` : ''}
			${incident.affectedServices && incident.affectedServices.length > 0 ? `
			<div class="info-item">
				<label>Affected Services</label>
				<span>${incident.affectedServices.join(', ')}</span>
			</div>
			` : ''}
		</div>
		${incident.description ? `
		<div style="margin-top: 16px;">
			<label style="display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Description</label>
			<p>${escapeHtml(incident.description)}</p>
		</div>
		` : ''}
	</div>

	${(incident.mitreTactics && incident.mitreTactics.length > 0) || (incident.mitreTechniques && incident.mitreTechniques.length > 0) ? `
	<div class="section">
		<h2 class="section-title">MITRE ATT&CK Mapping</h2>
		${incident.mitreTactics && incident.mitreTactics.length > 0 ? `
		<div style="margin-bottom: 12px;">
			<label style="display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Tactics</label>
			<span>${incident.mitreTactics.map(t => formatMitreTactic(t)).join(', ')}</span>
		</div>
		` : ''}
		${incident.mitreTechniques && incident.mitreTechniques.length > 0 ? `
		<div>
			<label style="display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Techniques</label>
			<span>${incident.mitreTechniques.map(t => formatMitreTechnique(t)).join(', ')}</span>
		</div>
		` : ''}
	</div>
	` : ''}

	${detections.length > 0 ? `
	<div class="section">
		<h2 class="section-title">Detection Events (${detections.length})</h2>
		<table>
			<thead>
				<tr>
					<th>Time</th>
					<th>Severity</th>
					<th>Rule</th>
					<th>Service</th>
					<th>Message</th>
				</tr>
			</thead>
			<tbody>
				${detections.slice(0, 50).map(d => `
				<tr>
					<td>${formatShortDate(d.time)}</td>
					<td><span class="badge badge-${d.severity}" style="font-size: 9px;">${getSeverityLabel(d.severity)}</span></td>
					<td>${escapeHtml(d.ruleTitle)}</td>
					<td>${escapeHtml(d.service)}</td>
					<td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(d.logMessage.substring(0, 100))}</td>
				</tr>
				`).join('')}
			</tbody>
		</table>
		${detections.length > 50 ? `<p style="margin-top: 8px; color: #6b7280; font-size: 10px;">Showing 50 of ${detections.length} detection events</p>` : ''}
	</div>
	` : ''}

	${comments.length > 0 ? `
	<div class="section">
		<h2 class="section-title">Comments (${comments.length})</h2>
		${comments.map(c => `
		<div class="comment">
			<div class="comment-header">
				<span class="comment-author">${escapeHtml(c.userName || 'Unknown')}</span>
				<span class="comment-time">${formatShortDate(c.createdAt)}</span>
			</div>
			<div class="comment-text">${escapeHtml(c.comment)}</div>
		</div>
		`).join('')}
	</div>
	` : ''}

	${history.length > 0 ? `
	<div class="section">
		<h2 class="section-title">Activity Timeline (${history.length})</h2>
		${history.map(h => `
		<div class="timeline-item">
			<div class="timeline-dot"></div>
			<div class="timeline-content">
				<div class="timeline-action">${formatHistoryAction(h)}</div>
				<div class="timeline-meta">
					${h.userName ? `by ${escapeHtml(h.userName)} · ` : ''}${formatShortDate(h.createdAt)}
				</div>
			</div>
		</div>
		`).join('')}
	</div>
	` : ''}

	<div class="footer">
		Generated by LogTide Security · ${formatDate(new Date().toISOString())}
	</div>
</body>
</html>
	`;

	printWindow.document.write(html);
	printWindow.document.close();

	// Wait for content to load then print
	printWindow.onload = () => {
		printWindow.print();
	};
}

function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function formatHistoryAction(entry: IncidentHistoryEntry): string {
	switch (entry.action) {
		case 'created':
			return 'Incident created';
		case 'status_changed':
			return `Status changed from ${entry.oldValue || 'none'} to ${entry.newValue || 'none'}`;
		case 'assignee_changed':
			return entry.newValue ? `Assigned to ${entry.newValue}` : 'Assignee removed';
		case 'severity_changed':
			return `Severity changed from ${entry.oldValue || 'none'} to ${entry.newValue || 'none'}`;
		case 'field_changed':
			return `${entry.fieldName || 'Field'} updated`;
		default:
			return entry.action.replace(/_/g, ' ');
	}
}
