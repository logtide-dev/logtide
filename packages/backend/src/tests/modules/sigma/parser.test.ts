import { describe, it, expect } from 'vitest';
import { SigmaParser } from '../../../modules/sigma/parser.js';

describe('Sigma Parser', () => {
    describe('parseYaml', () => {
        it('should parse valid YAML', () => {
            const yaml = `
title: Test Rule
logsource:
  product: linux
detection:
  selection:
    message|contains: error
  condition: selection
`;
            const result = SigmaParser.parseYaml(yaml);

            expect(result).toBeDefined();
            expect(result.title).toBe('Test Rule');
            expect(result.logsource.product).toBe('linux');
            expect(result.detection.condition).toBe('selection');
        });

        it('should parse YAML with complex detection patterns', () => {
            const yaml = `
title: Complex Detection
logsource:
  product: windows
  service: sysmon
detection:
  selection1:
    EventID: 1
    Image|endswith: '\\\\cmd.exe'
  selection2:
    CommandLine|contains|all:
      - '/c'
      - 'powershell'
  filter:
    User: SYSTEM
  condition: (selection1 or selection2) and not filter
`;
            const result = SigmaParser.parseYaml(yaml);

            expect(result.detection.selection1.EventID).toBe(1);
            expect(result.detection.selection2['CommandLine|contains|all']).toEqual(['/c', 'powershell']);
            expect(result.detection.filter.User).toBe('SYSTEM');
            expect(result.detection.condition).toBe('(selection1 or selection2) and not filter');
        });

        it('should throw error for invalid YAML syntax', () => {
            const invalidYaml = `
title: Broken
  indentation: wrong
    nested: invalid
`;
            expect(() => SigmaParser.parseYaml(invalidYaml)).toThrow('YAML parsing failed');
        });

        it('should throw error for non-object YAML', () => {
            // A plain string is parsed as a string, not an object
            expect(() => SigmaParser.parseYaml('just a string')).toThrow('Invalid YAML: expected object');
            // Note: YAML arrays are valid objects in JS, so we test with a number instead
            expect(() => SigmaParser.parseYaml('12345')).toThrow('Invalid YAML: expected object');
        });

        it('should throw error for empty YAML', () => {
            expect(() => SigmaParser.parseYaml('')).toThrow('Invalid YAML: expected object');
            expect(() => SigmaParser.parseYaml('   ')).toThrow('Invalid YAML: expected object');
            expect(() => SigmaParser.parseYaml('\n\n')).toThrow('Invalid YAML: expected object');
        });
    });

    describe('validate', () => {
        it('should validate rule with all required fields', () => {
            const rule = {
                title: 'Valid Rule',
                logsource: { product: 'linux' },
                detection: {
                    selection: { message: 'test' },
                    condition: 'selection',
                },
            };

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail validation when title is missing', () => {
            const rule = {
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing or invalid "title" field');
        });

        it('should fail validation when title is not a string', () => {
            const rule = {
                title: 123,
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing or invalid "title" field');
        });

        it('should fail validation when logsource is missing', () => {
            const rule = {
                title: 'Test',
                detection: { condition: 'selection' },
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing or invalid "logsource" field');
        });

        it('should fail validation when detection is missing', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing or invalid "detection" field');
        });

        it('should fail validation when detection.condition is missing', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: {
                    selection: { message: 'test' },
                    // condition is missing
                },
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing "detection.condition" field');
        });

        it('should fail validation for invalid level', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
                level: 'invalid_level',
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Invalid "level"');
            expect(result.errors[0]).toContain('invalid_level');
        });

        it('should accept all valid levels', () => {
            const validLevels = ['informational', 'low', 'medium', 'high', 'critical'];

            for (const level of validLevels) {
                const rule = {
                    title: 'Test',
                    logsource: { product: 'linux' },
                    detection: { condition: 'selection' },
                    level,
                };

                const result = SigmaParser.validate(rule);
                expect(result.valid).toBe(true);
            }
        });

        it('should fail validation for invalid status', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
                status: 'invalid_status',
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Invalid "status"');
        });

        it('should accept all valid statuses', () => {
            const validStatuses = ['experimental', 'test', 'stable', 'deprecated', 'unsupported'];

            for (const status of validStatuses) {
                const rule = {
                    title: 'Test',
                    logsource: { product: 'linux' },
                    detection: { condition: 'selection' },
                    status,
                };

                const result = SigmaParser.validate(rule);
                expect(result.valid).toBe(true);
            }
        });

        it('should collect multiple errors', () => {
            const rule = {
                // title missing
                // logsource missing
                // detection missing
            } as any;

            const result = SigmaParser.validate(rule);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
            expect(result.errors).toContain('Missing or invalid "title" field');
            expect(result.errors).toContain('Missing or invalid "logsource" field');
            expect(result.errors).toContain('Missing or invalid "detection" field');
        });
    });

    describe('normalize', () => {
        it('should add default values for optional fields', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
            };

            const result = SigmaParser.normalize(rule);

            expect(result.id).toBeDefined();
            expect(result.level).toBe('medium');
            expect(result.status).toBe('stable');
        });

        it('should preserve existing id', () => {
            const rule = {
                id: 'custom-id-123',
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
            };

            const result = SigmaParser.normalize(rule);

            expect(result.id).toBe('custom-id-123');
        });

        it('should preserve existing level and status', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
                level: 'critical' as const,
                status: 'experimental' as const,
            };

            const result = SigmaParser.normalize(rule);

            expect(result.level).toBe('critical');
            expect(result.status).toBe('experimental');
        });

        it('should generate unique UUIDs', () => {
            const rule = {
                title: 'Test',
                logsource: { product: 'linux' },
                detection: { condition: 'selection' },
            };

            const result1 = SigmaParser.normalize(rule);
            const result2 = SigmaParser.normalize(rule);

            expect(result1.id).not.toBe(result2.id);
        });

        it('should preserve all original fields', () => {
            const rule = {
                title: 'Test Rule',
                description: 'A test rule',
                author: 'Test Author',
                logsource: { product: 'linux', service: 'sshd' },
                detection: {
                    selection: { message: 'test' },
                    condition: 'selection',
                },
                tags: ['attack.initial_access'],
                references: ['https://example.com'],
            };

            const result = SigmaParser.normalize(rule);

            expect(result.title).toBe('Test Rule');
            expect(result.description).toBe('A test rule');
            expect(result.author).toBe('Test Author');
            expect(result.logsource.service).toBe('sshd');
            expect(result.tags).toEqual(['attack.initial_access']);
            expect(result.references).toEqual(['https://example.com']);
        });
    });

    describe('parse (full pipeline)', () => {
        it('should parse, validate, and normalize valid YAML', () => {
            const yaml = `
title: SSH Brute Force Detection
description: Detects SSH brute force attempts
author: Security Team
level: high
status: stable
logsource:
  product: linux
  service: sshd
detection:
  selection:
    message|contains: 'Failed password'
  condition: selection
tags:
  - attack.credential_access
  - attack.t1110
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule).not.toBeNull();
            expect(result.rule!.title).toBe('SSH Brute Force Detection');
            expect(result.rule!.level).toBe('high');
            expect(result.rule!.status).toBe('stable');
            expect(result.rule!.id).toBeDefined();
        });

        it('should return errors for invalid YAML', () => {
            const yaml = `
title: Invalid Rule
logsource:
  product: linux
detection:
  selection:
    message: test
`;
            // This rule is missing detection.condition
            const result = SigmaParser.parse(yaml);

            expect(result.rule).toBeNull();
            expect(result.errors).toContain('Missing "detection.condition" field');
        });

        it('should return errors for malformed YAML', () => {
            // This YAML has invalid syntax (tabs mixed with spaces causing parse error)
            const yaml = `title: Broken
logsource:
\t  product: linux
  invalid: mixed tabs`;
            const result = SigmaParser.parse(yaml);

            expect(result.rule).toBeNull();
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('YAML parsing failed');
        });

        it('should parse minimal valid rule', () => {
            const yaml = `
title: Minimal Rule
logsource:
  product: any
detection:
  selection: true
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule).not.toBeNull();
            expect(result.rule!.level).toBe('medium'); // default
            expect(result.rule!.status).toBe('stable'); // default
        });

        it('should parse rule with array condition', () => {
            const yaml = `
title: Array Condition Rule
logsource:
  product: linux
detection:
  selection1:
    field1: value1
  selection2:
    field2: value2
  condition:
    - selection1
    - selection2
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.condition).toEqual(['selection1', 'selection2']);
        });
    });

    describe('Edge Cases', () => {
        it('should handle Unicode characters in title and fields', () => {
            const yaml = `
title: Rilevamento Attacco SQL 注入检测
logsource:
  product: linux
detection:
  selection:
    message|contains: "' OR '1'='1"
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.title).toBe("Rilevamento Attacco SQL 注入检测");
        });

        it('should handle very long field values', () => {
            const longValue = 'a'.repeat(10000);
            const yaml = `
title: Long Value Rule
logsource:
  product: linux
detection:
  selection:
    message: "${longValue}"
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.selection.message).toBe(longValue);
        });

        it('should handle special characters in detection values', () => {
            const yaml = `
title: Special Characters
logsource:
  product: linux
detection:
  selection:
    message|contains: "test\\nwith\\ttabs\\rand\\\\backslash"
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
        });

        it('should handle numeric field values', () => {
            const yaml = `
title: Numeric Values
logsource:
  product: windows
detection:
  selection:
    EventID: 4625
    LogonType: 3
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.selection.EventID).toBe(4625);
            expect(result.rule!.detection.selection.LogonType).toBe(3);
        });

        it('should handle boolean field values', () => {
            const yaml = `
title: Boolean Values
logsource:
  product: linux
detection:
  selection:
    enabled: true
    disabled: false
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.selection.enabled).toBe(true);
            expect(result.rule!.detection.selection.disabled).toBe(false);
        });

        it('should handle null values', () => {
            const yaml = `
title: Null Values
logsource:
  product: linux
detection:
  selection:
    optional_field: null
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.selection.optional_field).toBeNull();
        });

        it('should handle empty arrays', () => {
            const yaml = `
title: Empty Arrays
logsource:
  product: linux
detection:
  selection:
    message: test
  condition: selection
tags: []
references: []
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.tags).toEqual([]);
        });

        it('should handle nested logsource fields', () => {
            const yaml = `
title: Nested Logsource
logsource:
  product: windows
  service: sysmon
  category: process_creation
  definition: Requires Sysmon with ProcessCreate event
detection:
  selection:
    EventID: 1
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.logsource.product).toBe('windows');
            expect(result.rule!.logsource.service).toBe('sysmon');
            expect(result.rule!.logsource.category).toBe('process_creation');
            expect(result.rule!.logsource.definition).toBe('Requires Sysmon with ProcessCreate event');
        });

        it('should handle multiple modifier chains', () => {
            const yaml = `
title: Modifier Chains
logsource:
  product: linux
detection:
  selection:
    CommandLine|contains|all:
      - 'wget'
      - 'http'
      - '--no-check-certificate'
    Image|endswith|utf16le: '\\\\cmd.exe'
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.selection['CommandLine|contains|all']).toHaveLength(3);
        });

        it('should handle YAML comments', () => {
            const yaml = `
# This is a comment
title: With Comments
# Another comment
logsource:
  product: linux # inline comment
detection:
  selection:
    message: test
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.title).toBe('With Comments');
        });

        it('should handle multi-line strings', () => {
            const yaml = `
title: Multi-line Description
description: |
  This is a multi-line
  description that spans
  multiple lines
logsource:
  product: linux
detection:
  selection:
    message: test
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.description).toContain('multi-line');
            expect(result.rule!.description).toContain('multiple lines');
        });

        it('should handle date fields as strings', () => {
            const yaml = `
title: Date Fields
date: 2024/01/15
modified: 2024/06/20
logsource:
  product: linux
detection:
  selection:
    message: test
  condition: selection
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            // YAML parses dates, so check they exist
            expect(result.rule!.date).toBeDefined();
            expect(result.rule!.modified).toBeDefined();
        });
    });

    describe('Real-world Sigma Rules', () => {
        it('should parse a Windows process creation rule', () => {
            const yaml = `
title: Suspicious PowerShell Download Cradle
id: 3b6ab547-8ec2-4991-b9d2-2b06702a48d7
status: stable
level: high
description: Detects suspicious PowerShell download cradles
author: Security Team
date: 2024/01/15
logsource:
  product: windows
  category: process_creation
detection:
  selection:
    Image|endswith: '\\\\powershell.exe'
    CommandLine|contains|all:
      - 'IEX'
      - 'WebClient'
      - 'DownloadString'
  condition: selection
falsepositives:
  - Legitimate admin scripts
tags:
  - attack.execution
  - attack.t1059.001
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.title).toBe('Suspicious PowerShell Download Cradle');
            expect(result.rule!.id).toBe('3b6ab547-8ec2-4991-b9d2-2b06702a48d7');
            expect(result.rule!.level).toBe('high');
            expect(result.rule!.tags).toContain('attack.execution');
        });

        it('should parse a Linux SSH rule', () => {
            const yaml = `
title: SSH Brute Force Attempt
status: experimental
level: medium
logsource:
  product: linux
  service: sshd
detection:
  selection:
    message|contains|all:
      - 'Failed password'
      - 'from'
  filter:
    message|contains: 'invalid user'
  condition: selection and not filter
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.condition).toBe('selection and not filter');
        });

        it('should parse a rule with multiple selections using 1 of pattern', () => {
            const yaml = `
title: Multiple Selection Detection
logsource:
  product: linux
detection:
  selection1:
    message|contains: 'error'
  selection2:
    message|contains: 'failure'
  selection3:
    message|contains: 'denied'
  condition: 1 of selection*
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.condition).toBe('1 of selection*');
        });

        it('should parse a rule with all of them pattern', () => {
            const yaml = `
title: All Of Them Detection
logsource:
  product: windows
detection:
  keywords1:
    - 'mimikatz'
    - 'sekurlsa'
  keywords2:
    - 'privilege'
    - 'debug'
  condition: all of them
`;
            const result = SigmaParser.parse(yaml);

            expect(result.errors).toHaveLength(0);
            expect(result.rule!.detection.condition).toBe('all of them');
        });
    });
});
