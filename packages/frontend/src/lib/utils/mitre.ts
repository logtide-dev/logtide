/**
 * MITRE ATT&CK Framework Mappings
 *
 * This file contains human-readable names for MITRE ATT&CK tactics and techniques.
 * Based on MITRE ATT&CK Enterprise Matrix v14.1
 */

// ============================================================================
// TACTICS (14 tactics in the Enterprise Matrix)
// ============================================================================

export const MITRE_TACTICS: Record<string, { name: string; description: string }> = {
  reconnaissance: {
    name: 'Reconnaissance',
    description: 'Gathering information to plan future adversary operations',
  },
  resource_development: {
    name: 'Resource Development',
    description: 'Establishing resources to support operations',
  },
  initial_access: {
    name: 'Initial Access',
    description: 'Trying to get into your network',
  },
  execution: {
    name: 'Execution',
    description: 'Trying to run malicious code',
  },
  persistence: {
    name: 'Persistence',
    description: 'Trying to maintain their foothold',
  },
  privilege_escalation: {
    name: 'Privilege Escalation',
    description: 'Trying to gain higher-level permissions',
  },
  defense_evasion: {
    name: 'Defense Evasion',
    description: 'Trying to avoid being detected',
  },
  credential_access: {
    name: 'Credential Access',
    description: 'Trying to steal account credentials',
  },
  discovery: {
    name: 'Discovery',
    description: 'Trying to figure out your environment',
  },
  lateral_movement: {
    name: 'Lateral Movement',
    description: 'Trying to move through your environment',
  },
  collection: {
    name: 'Collection',
    description: 'Gathering data of interest to their goal',
  },
  command_and_control: {
    name: 'Command and Control',
    description: 'Communicating with compromised systems',
  },
  exfiltration: {
    name: 'Exfiltration',
    description: 'Trying to steal data',
  },
  impact: {
    name: 'Impact',
    description: 'Trying to manipulate, interrupt, or destroy systems',
  },
};

// ============================================================================
// TECHNIQUES (Most common techniques - not exhaustive)
// ============================================================================

export const MITRE_TECHNIQUES: Record<string, { name: string; tactic: string }> = {
  // Initial Access
  T1190: { name: 'Exploit Public-Facing Application', tactic: 'initial_access' },
  T1133: { name: 'External Remote Services', tactic: 'initial_access' },
  T1200: { name: 'Hardware Additions', tactic: 'initial_access' },
  T1566: { name: 'Phishing', tactic: 'initial_access' },
  'T1566.001': { name: 'Spearphishing Attachment', tactic: 'initial_access' },
  'T1566.002': { name: 'Spearphishing Link', tactic: 'initial_access' },
  T1091: { name: 'Replication Through Removable Media', tactic: 'initial_access' },
  T1195: { name: 'Supply Chain Compromise', tactic: 'initial_access' },
  T1199: { name: 'Trusted Relationship', tactic: 'initial_access' },
  T1078: { name: 'Valid Accounts', tactic: 'initial_access' },

  // Execution
  T1059: { name: 'Command and Scripting Interpreter', tactic: 'execution' },
  'T1059.001': { name: 'PowerShell', tactic: 'execution' },
  'T1059.003': { name: 'Windows Command Shell', tactic: 'execution' },
  'T1059.004': { name: 'Unix Shell', tactic: 'execution' },
  'T1059.005': { name: 'Visual Basic', tactic: 'execution' },
  'T1059.006': { name: 'Python', tactic: 'execution' },
  'T1059.007': { name: 'JavaScript', tactic: 'execution' },
  T1203: { name: 'Exploitation for Client Execution', tactic: 'execution' },
  T1047: { name: 'Windows Management Instrumentation', tactic: 'execution' },
  T1053: { name: 'Scheduled Task/Job', tactic: 'execution' },
  T1204: { name: 'User Execution', tactic: 'execution' },

  // Persistence
  T1098: { name: 'Account Manipulation', tactic: 'persistence' },
  T1547: { name: 'Boot or Logon Autostart Execution', tactic: 'persistence' },
  'T1547.001': { name: 'Registry Run Keys / Startup Folder', tactic: 'persistence' },
  T1136: { name: 'Create Account', tactic: 'persistence' },
  T1543: { name: 'Create or Modify System Process', tactic: 'persistence' },
  T1546: { name: 'Event Triggered Execution', tactic: 'persistence' },
  // T1133 already defined in initial_access (multi-tactic technique)
  T1574: { name: 'Hijack Execution Flow', tactic: 'persistence' },

  // Privilege Escalation
  T1548: { name: 'Abuse Elevation Control Mechanism', tactic: 'privilege_escalation' },
  'T1548.002': { name: 'Bypass User Account Control', tactic: 'privilege_escalation' },
  T1134: { name: 'Access Token Manipulation', tactic: 'privilege_escalation' },
  T1068: { name: 'Exploitation for Privilege Escalation', tactic: 'privilege_escalation' },
  T1055: { name: 'Process Injection', tactic: 'privilege_escalation' },
  // T1078 already defined in initial_access (multi-tactic technique)

  // Defense Evasion
  T1070: { name: 'Indicator Removal', tactic: 'defense_evasion' },
  'T1070.001': { name: 'Clear Windows Event Logs', tactic: 'defense_evasion' },
  'T1070.004': { name: 'File Deletion', tactic: 'defense_evasion' },
  T1036: { name: 'Masquerading', tactic: 'defense_evasion' },
  T1027: { name: 'Obfuscated Files or Information', tactic: 'defense_evasion' },
  T1218: { name: 'System Binary Proxy Execution', tactic: 'defense_evasion' },
  T1562: { name: 'Impair Defenses', tactic: 'defense_evasion' },
  'T1562.001': { name: 'Disable or Modify Tools', tactic: 'defense_evasion' },

  // Credential Access
  T1110: { name: 'Brute Force', tactic: 'credential_access' },
  'T1110.001': { name: 'Password Guessing', tactic: 'credential_access' },
  'T1110.002': { name: 'Password Cracking', tactic: 'credential_access' },
  'T1110.003': { name: 'Password Spraying', tactic: 'credential_access' },
  'T1110.004': { name: 'Credential Stuffing', tactic: 'credential_access' },
  T1003: { name: 'OS Credential Dumping', tactic: 'credential_access' },
  'T1003.001': { name: 'LSASS Memory', tactic: 'credential_access' },
  T1555: { name: 'Credentials from Password Stores', tactic: 'credential_access' },
  T1056: { name: 'Input Capture', tactic: 'credential_access' },
  T1539: { name: 'Steal Web Session Cookie', tactic: 'credential_access' },

  // Discovery
  T1087: { name: 'Account Discovery', tactic: 'discovery' },
  T1083: { name: 'File and Directory Discovery', tactic: 'discovery' },
  T1046: { name: 'Network Service Discovery', tactic: 'discovery' },
  T1135: { name: 'Network Share Discovery', tactic: 'discovery' },
  T1057: { name: 'Process Discovery', tactic: 'discovery' },
  T1018: { name: 'Remote System Discovery', tactic: 'discovery' },
  T1082: { name: 'System Information Discovery', tactic: 'discovery' },
  T1016: { name: 'System Network Configuration Discovery', tactic: 'discovery' },

  // Lateral Movement
  T1021: { name: 'Remote Services', tactic: 'lateral_movement' },
  'T1021.001': { name: 'Remote Desktop Protocol', tactic: 'lateral_movement' },
  'T1021.002': { name: 'SMB/Windows Admin Shares', tactic: 'lateral_movement' },
  'T1021.004': { name: 'SSH', tactic: 'lateral_movement' },
  'T1021.006': { name: 'Windows Remote Management', tactic: 'lateral_movement' },
  T1080: { name: 'Taint Shared Content', tactic: 'lateral_movement' },
  T1550: { name: 'Use Alternate Authentication Material', tactic: 'lateral_movement' },
  'T1550.002': { name: 'Pass the Hash', tactic: 'lateral_movement' },
  'T1550.003': { name: 'Pass the Ticket', tactic: 'lateral_movement' },

  // Collection
  T1560: { name: 'Archive Collected Data', tactic: 'collection' },
  T1119: { name: 'Automated Collection', tactic: 'collection' },
  T1115: { name: 'Clipboard Data', tactic: 'collection' },
  T1213: { name: 'Data from Information Repositories', tactic: 'collection' },
  'T1213.003': { name: 'Code Repositories', tactic: 'collection' },
  T1005: { name: 'Data from Local System', tactic: 'collection' },
  T1039: { name: 'Data from Network Shared Drive', tactic: 'collection' },
  T1025: { name: 'Data from Removable Media', tactic: 'collection' },
  T1074: { name: 'Data Staged', tactic: 'collection' },
  T1113: { name: 'Screen Capture', tactic: 'collection' },

  // Command and Control
  T1071: { name: 'Application Layer Protocol', tactic: 'command_and_control' },
  'T1071.001': { name: 'Web Protocols', tactic: 'command_and_control' },
  'T1071.004': { name: 'DNS', tactic: 'command_and_control' },
  T1132: { name: 'Data Encoding', tactic: 'command_and_control' },
  T1001: { name: 'Data Obfuscation', tactic: 'command_and_control' },
  T1568: { name: 'Dynamic Resolution', tactic: 'command_and_control' },
  T1573: { name: 'Encrypted Channel', tactic: 'command_and_control' },
  T1008: { name: 'Fallback Channels', tactic: 'command_and_control' },
  T1105: { name: 'Ingress Tool Transfer', tactic: 'command_and_control' },
  T1104: { name: 'Multi-Stage Channels', tactic: 'command_and_control' },
  T1095: { name: 'Non-Application Layer Protocol', tactic: 'command_and_control' },
  T1571: { name: 'Non-Standard Port', tactic: 'command_and_control' },
  T1572: { name: 'Protocol Tunneling', tactic: 'command_and_control' },
  T1090: { name: 'Proxy', tactic: 'command_and_control' },
  T1219: { name: 'Remote Access Software', tactic: 'command_and_control' },
  'T1219.002': { name: 'Remote Access Tools', tactic: 'command_and_control' },

  // Exfiltration
  T1020: { name: 'Automated Exfiltration', tactic: 'exfiltration' },
  T1030: { name: 'Data Transfer Size Limits', tactic: 'exfiltration' },
  T1048: { name: 'Exfiltration Over Alternative Protocol', tactic: 'exfiltration' },
  T1041: { name: 'Exfiltration Over C2 Channel', tactic: 'exfiltration' },
  T1011: { name: 'Exfiltration Over Other Network Medium', tactic: 'exfiltration' },
  T1052: { name: 'Exfiltration Over Physical Medium', tactic: 'exfiltration' },
  T1567: { name: 'Exfiltration Over Web Service', tactic: 'exfiltration' },
  T1029: { name: 'Scheduled Transfer', tactic: 'exfiltration' },

  // Impact
  T1531: { name: 'Account Access Removal', tactic: 'impact' },
  T1485: { name: 'Data Destruction', tactic: 'impact' },
  T1486: { name: 'Data Encrypted for Impact', tactic: 'impact' },
  T1565: { name: 'Data Manipulation', tactic: 'impact' },
  T1491: { name: 'Defacement', tactic: 'impact' },
  T1561: { name: 'Disk Wipe', tactic: 'impact' },
  T1499: { name: 'Endpoint Denial of Service', tactic: 'impact' },
  T1495: { name: 'Firmware Corruption', tactic: 'impact' },
  T1490: { name: 'Inhibit System Recovery', tactic: 'impact' },
  T1498: { name: 'Network Denial of Service', tactic: 'impact' },
  T1496: { name: 'Resource Hijacking', tactic: 'impact' },
  T1489: { name: 'Service Stop', tactic: 'impact' },
  T1529: { name: 'System Shutdown/Reboot', tactic: 'impact' },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the human-readable name for a MITRE tactic
 */
export function getTacticName(tacticId: string): string {
  const tactic = MITRE_TACTICS[tacticId.toLowerCase()];
  return tactic?.name || formatTacticId(tacticId);
}

/**
 * Get the human-readable description for a MITRE tactic
 */
export function getTacticDescription(tacticId: string): string {
  const tactic = MITRE_TACTICS[tacticId.toLowerCase()];
  return tactic?.description || '';
}

/**
 * Get the human-readable name for a MITRE technique
 */
export function getTechniqueName(techniqueId: string): string {
  const technique = MITRE_TECHNIQUES[techniqueId.toUpperCase()];
  return technique?.name || techniqueId;
}

/**
 * Get technique with its parent tactic info
 */
export function getTechniqueInfo(techniqueId: string): { name: string; tactic: string; tacticName: string } | null {
  const technique = MITRE_TECHNIQUES[techniqueId.toUpperCase()];
  if (!technique) return null;

  return {
    name: technique.name,
    tactic: technique.tactic,
    tacticName: getTacticName(technique.tactic),
  };
}

/**
 * Format a tactic ID to a more readable format (fallback)
 * e.g., "privilege_escalation" -> "Privilege Escalation"
 */
function formatTacticId(tacticId: string): string {
  return tacticId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get MITRE ATT&CK URL for a technique
 */
export function getMitreUrl(techniqueId: string): string {
  const baseId = techniqueId.split('.')[0];
  const subId = techniqueId.includes('.') ? techniqueId.split('.')[1] : null;

  if (subId) {
    return `https://attack.mitre.org/techniques/${baseId}/${subId}/`;
  }
  return `https://attack.mitre.org/techniques/${baseId}/`;
}

/**
 * Get MITRE ATT&CK URL for a tactic
 */
export function getMitreTacticUrl(tacticId: string): string {
  // MITRE URLs use kebab-case for tactics
  const urlId = tacticId.toLowerCase().replace(/_/g, '-');
  return `https://attack.mitre.org/tactics/TA${getTacticNumber(tacticId)}/`;
}

/**
 * Get tactic number for MITRE URL
 */
function getTacticNumber(tacticId: string): string {
  const tacticNumbers: Record<string, string> = {
    reconnaissance: '0043',
    resource_development: '0042',
    initial_access: '0001',
    execution: '0002',
    persistence: '0003',
    privilege_escalation: '0004',
    defense_evasion: '0005',
    credential_access: '0006',
    discovery: '0007',
    lateral_movement: '0008',
    collection: '0009',
    command_and_control: '0011',
    exfiltration: '0010',
    impact: '0040',
  };
  return tacticNumbers[tacticId.toLowerCase()] || '0000';
}
