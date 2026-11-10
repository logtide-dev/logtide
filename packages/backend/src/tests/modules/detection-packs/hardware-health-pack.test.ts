import { describe, it, expect, vi } from 'vitest';

// matchRule is pure; the engine module only needs the db import to resolve.
vi.mock('../../../database/connection.js', () => ({ db: {} }));

import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';
import { getPackById } from '../../../modules/detection-packs/pack-definitions.js';
import type { ParsedSigmaRule } from '../../../modules/sigma/types.js';

const pack = getPackById('hardware-health')!;

function matches(message: string, extra: { service?: string; level?: string } = {}): string[] {
    const log = { service: extra.service ?? 'kernel', level: extra.level ?? 'warn', message };
    const flat = SigmaDetectionEngine.flatten(log);
    return pack.rules
        .filter((rule) => {
            const parsed = {
                id: rule.id,
                title: rule.name,
                level: rule.level,
                logsource: rule.logsource,
                detection: rule.detection,
                tags: rule.tags,
            } as unknown as ParsedSigmaRule;
            return SigmaDetectionEngine.matchRule(parsed, log, flat) !== null;
        })
        .map((r) => r.id);
}

describe('Hardware Health Pack', () => {
    it('is a hardware pack with a frontend-mapped icon and no fake MITRE tags', () => {
        expect(pack).toBeDefined();
        expect(pack.category).toBe('hardware');
        expect(pack.icon).toBe('cpu');
        for (const rule of pack.rules) {
            expect(rule.tags!.some((t) => t.startsWith('attack.'))).toBe(false);
            expect(rule.tags).toContain('hardware');
        }
    });

    it('has the expected rules', () => {
        expect(pack.rules.map((r) => r.id)).toEqual([
            'memory-corrected-error',
            'memory-uncorrected-error',
            'machine-check-exception',
            'disk-io-error',
            'ata-command-failed',
            'ata-link-reset',
            'nvme-controller-fault',
            'pcie-aer-uncorrected',
            'pcie-aer-corrected',
            'cpu-thermal-throttle',
            'thermal-critical',
            'power-supply-fault',
            'nic-link-problem',
            'nic-link-not-ready',
        ]);
    });

    describe('matches realistic hardware lines', () => {
        const cases: Array<[string, string, string]> = [
            ['EDAC corrected', 'EDAC MC0: 1 CE memory read error on CPU_SrcID#0_Ha#0_Chan#1_DIMM#0 (channel:1 slot:0 page:0x1a2b3 offset:0x0 grain:32 syndrome:0x0)', 'memory-corrected-error'],
            ['EDAC uncorrected', 'EDAC MC1: 1 UE memory read error on CPU_SrcID#1_Ha#0_Chan#0_DIMM#1 (channel:0 slot:1 page:0x1a2b3)', 'memory-uncorrected-error'],
            ['SEL uncorrectable ECC', 'Memory | Uncorrectable ECC | Asserted | DIMM A1', 'memory-uncorrected-error'],
            ['SEL correctable ECC', 'Memory | Correctable ECC | Asserted | DIMM A1', 'memory-corrected-error'],
            ['mce hardware error', 'mce: [Hardware Error]: Machine check events logged', 'machine-check-exception'],
            ['mce cpu line', 'mce: [Hardware Error]: CPU 0: Machine Check: 0 Bank 5: be00000000800400', 'machine-check-exception'],
            ['block I/O error', 'blk_update_request: I/O error, dev sda, sector 123 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 0', 'disk-io-error'],
            ['buffer I/O error', 'Buffer I/O error on dev sda1, logical block 4096, async page read', 'disk-io-error'],
            ['ata UNC', 'ata3.00: error: { UNC }', 'disk-io-error'],
            ['ata failed command', 'ata3.00: failed command: READ FPDMA QUEUED', 'ata-command-failed'],
            ['ata exception', 'ata3.00: exception Emask 0x0 SAct 0x1000 SErr 0x0 action 0x6 frozen', 'ata-command-failed'],
            ['ata hard reset', 'ata3: hard resetting link', 'ata-link-reset'],
            ['sata link down', 'ata4: SATA link down (SStatus 0 SControl 300)', 'ata-link-reset'],
            ['nvme timeout', 'nvme nvme0: I/O 123 QID 4 timeout, aborting', 'nvme-controller-fault'],
            ['nvme controller down', 'nvme nvme0: controller is down; will reset: CSTS=0xffffffff, PCI_STATUS=0xffff', 'nvme-controller-fault'],
            ['aer corrected', 'pcieport 0000:00:1c.0: AER: Corrected error received: 0000:03:00.0', 'pcie-aer-corrected'],
            ['pcie bus error corrected', 'pcieport 0000:00:1c.0: PCIe Bus Error: severity=Corrected, type=Physical Layer, (Receiver ID)', 'pcie-aer-corrected'],
            ['aer uncorrected', 'pcieport 0000:00:1c.0: AER: Uncorrected (Non-Fatal) error received: 0000:03:00.0', 'pcie-aer-uncorrected'],
            ['cpu throttled', 'CPU0: Core temperature above threshold, cpu clock throttled (total events = 1)', 'cpu-thermal-throttle'],
            ['package throttled', 'CPU0: Package temperature above threshold, cpu clock throttled (total events = 3)', 'cpu-thermal-throttle'],
            ['thermal critical', 'thermal thermal_zone0: critical temperature reached (105 C), shutting down', 'thermal-critical'],
            ['sel psu failure', 'Power Supply #0x57 | Failure detected | Asserted', 'power-supply-fault'],
            ['sel redundancy', 'Power Supply | Redundancy lost | Asserted', 'power-supply-fault'],
            ['nic link down', 'e1000e 0000:00:19.0 eth0: NIC Link is Down', 'nic-link-problem'],
            ['tx hang', 'e1000e 0000:00:19.0 eth0: Detected Tx Unit Hang', 'nic-link-problem'],
            ['link not ready', 'IPv6: ADDRCONF(NETDEV_UP): eth0: link is not ready', 'nic-link-not-ready'],
        ];

        for (const [label, line, ruleId] of cases) {
            it(`${label}: "${line.slice(0, 50)}"`, () => {
                expect(matches(line)).toContain(ruleId);
            });
        }

        it('is case-insensitive', () => {
            expect(matches('edac mc0: 1 ce memory read error on dimm#0')).toContain('memory-corrected-error');
            expect(matches('NVME NVME0: I/O 1 QID 2 TIMEOUT, ABORTING')).toContain('nvme-controller-fault');
        });

        it('also matches events sent by the agent (service hardware)', () => {
            expect(matches('EDAC MC0: 1 CE memory read error on DIMM#0', { service: 'hardware', level: 'warn' })).toContain('memory-corrected-error');
        });

        it('does not confuse corrected and uncorrected', () => {
            expect(matches('EDAC MC1: 1 UE memory read error on DIMM#1')).not.toContain('memory-corrected-error');
            expect(matches('Memory | Uncorrectable ECC | Asserted')).not.toContain('memory-corrected-error');
            expect(matches('EDAC MC0: 1 CE memory read error on DIMM#0')).not.toContain('memory-uncorrected-error');
            expect(matches('pcieport 0000:00:1c.0: AER: Uncorrected (Fatal) error received')).not.toContain('pcie-aer-corrected');
            expect(matches('pcieport 0000:00:1c.0: AER: Corrected error received')).not.toContain('pcie-aer-uncorrected');
        });
    });

    describe('does not match benign lines', () => {
        const benign = [
            'EDAC MC: Ver: 3.0.0',
            'EDAC sbridge: Ver: 1.1.2',
            'EDAC amd64: F17h detected (node 0).',
            'ata3: SATA link up 6.0 Gbps (SStatus 133 SControl 300)',
            'ata3.00: configured for UDMA/133',
            'nvme nvme0: pci function 0000:01:00.0',
            'nvme nvme0: 8/0/0 default/read/poll queues',
            ' nvme0n1: p1 p2 p3',
            'mce: Using 32 MCE banks',
            'CPU0: Core temperature/speed normal',
            'pcieport 0000:00:1c.0: AER: enabled with IRQ 122',
            'e1000e 0000:00:19.0 eth0: NIC Link is Up 1000 Mbps Full Duplex, Flow Control: Rx/Tx',
            'ACPI: AC Adapter [AC] (on-line)',
            'Power Supply | Presence detected | Asserted',
            'EXT4-fs (sda1): mounted filesystem with ordered data mode',
            'systemd[1]: Shutting down.',
            'Started Capsule update service.',
            'GET /api/users 200 12ms',
            'request failed: connection timeout to upstream',
            'Temperature sensor reading: 45 C',
        ];
        for (const line of benign) {
            it(`ignores "${line}"`, () => {
                expect(matches(line)).toEqual([]);
            });
        }
    });
});
