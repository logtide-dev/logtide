import {
  MITRE_TACTICS,
  MITRE_TECHNIQUES,
  MITRE_TACTIC_IDS,
  type MitreTacticId,
  type MitreTechniqueId,
} from '../constants/mitre-constants.js';

export function getTacticName(tacticId: string): string {
  const tactic = MITRE_TACTICS[tacticId.toLowerCase() as MitreTacticId];
  if (tactic) return tactic.name;

  const upper = tacticId.toUpperCase();
  if (MITRE_TACTIC_IDS[upper]) return MITRE_TACTIC_IDS[upper];

  return formatTacticId(tacticId);
}

export function getTacticDescription(tacticId: string): string {
  const tactic = MITRE_TACTICS[tacticId.toLowerCase() as MitreTacticId];
  return tactic?.description || '';
}

export function getTechniqueName(techniqueId: string): string {
  const technique = MITRE_TECHNIQUES[techniqueId.toUpperCase() as MitreTechniqueId];
  return technique?.name || techniqueId;
}

export function getTechniqueInfo(
  techniqueId: string
): { name: string; tactic: string; tacticName: string } | null {
  const technique = MITRE_TECHNIQUES[techniqueId.toUpperCase() as MitreTechniqueId];
  if (!technique) return null;

  return {
    name: technique.name,
    tactic: technique.tactic,
    tacticName: getTacticName(technique.tactic),
  };
}

function formatTacticId(tacticId: string): string {
  return tacticId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getMitreUrl(techniqueId: string): string {
  const baseId = techniqueId.split('.')[0];
  const subId = techniqueId.includes('.') ? techniqueId.split('.')[1] : null;

  if (subId) {
    return `https://attack.mitre.org/techniques/${baseId}/${subId}/`;
  }
  return `https://attack.mitre.org/techniques/${baseId}/`;
}

export function getMitreTacticUrl(tacticId: string): string {
  const tactic = MITRE_TACTICS[tacticId.toLowerCase() as MitreTacticId];
  return tactic
    ? `https://attack.mitre.org/tactics/${tactic.id}/`
    : `https://attack.mitre.org/tactics/TA0000/`;
}

export function formatMitreTactic(tactic: string): string {
  const upper = tactic.toUpperCase();
  if (MITRE_TACTIC_IDS[upper]) {
    return `${upper}: ${MITRE_TACTIC_IDS[upper]}`;
  }

  const tacticObj = MITRE_TACTICS[tactic.toLowerCase() as MitreTacticId];
  if (tacticObj) {
    return `${tacticObj.id}: ${tacticObj.name}`;
  }

  return tactic;
}

export function formatMitreTechnique(technique: string): string {
  if (technique.match(/^T\d{4}(\.\d{3})?$/i)) {
    return technique.toUpperCase();
  }
  return technique;
}
