/**
 * Test data factories for E2E tests
 */

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate a test log entry
 */
export function createTestLog(overrides: Partial<TestLog> = {}): TestLog {
  const id = generateId();
  return {
    level: 'info',
    message: `Test log message ${id}`,
    service: 'test-service',
    time: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

export interface TestLog {
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  service: string;
  time: string;
  metadata?: Record<string, any>;
  trace_id?: string;
}

/**
 * Generate multiple test logs
 */
export function createTestLogs(count: number, overrides: Partial<TestLog> = {}): TestLog[] {
  return Array.from({ length: count }, (_, i) =>
    createTestLog({
      message: `Test log message ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Generate logs with different levels
 */
export function createLogsWithLevels(): TestLog[] {
  const levels: TestLog['level'][] = ['debug', 'info', 'warn', 'error', 'critical'];
  return levels.map((level) =>
    createTestLog({
      level,
      message: `${level.toUpperCase()} level log message`,
    })
  );
}

/**
 * Generate a valid UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate logs with trace IDs for correlation testing
 */
export function createTracedLogs(traceId?: string, count = 5): TestLog[] {
  // Use provided traceId or generate a valid UUID
  const actualTraceId = traceId || generateUUID();
  return Array.from({ length: count }, (_, i) =>
    createTestLog({
      trace_id: actualTraceId,
      message: `Traced log ${i + 1} for trace ${actualTraceId.substring(0, 8)}`,
      service: i % 2 === 0 ? 'service-a' : 'service-b',
    })
  );
}

/**
 * Generate error logs for alert testing
 */
export function createErrorLogs(count: number, service = 'test-service'): TestLog[] {
  return Array.from({ length: count }, (_, i) =>
    createTestLog({
      level: 'error',
      message: `Error log ${i + 1}: Something went wrong`,
      service,
      metadata: {
        error_code: `ERR_${1000 + i}`,
        stack_trace: `Error at line ${i + 10}`,
      },
    })
  );
}

/**
 * Create a test alert rule
 */
export function createTestAlertRule(overrides: Partial<TestAlertRule> = {}): TestAlertRule {
  const id = generateId();
  return {
    name: `Test Alert Rule ${id}`,
    description: 'Alert rule created for E2E testing',
    condition: {
      type: 'threshold',
      threshold: 5,
      timeWindow: 60, // 1 minute
    },
    level: 'error',
    service: undefined,
    enabled: true,
    notifications: {
      email: true,
      webhook: false,
    },
    ...overrides,
  };
}

export interface TestAlertRule {
  name: string;
  description?: string;
  condition: {
    type: 'threshold';
    threshold: number;
    timeWindow: number;
  };
  level?: string;
  service?: string;
  enabled: boolean;
  notifications: {
    email: boolean;
    webhook: boolean;
    webhookUrl?: string;
  };
}

/**
 * Create a sample Sigma rule YAML
 */
export function createTestSigmaRule(overrides: Partial<SigmaRuleOptions> = {}): string {
  const id = generateId();
  const options: SigmaRuleOptions = {
    title: `Test Sigma Rule ${id}`,
    description: 'Sigma rule created for E2E testing',
    level: 'medium',
    status: 'test',
    author: 'E2E Test',
    logsource: {
      category: 'application',
      product: 'logward',
    },
    detection: {
      selection: {
        message: '*error*',
      },
      condition: 'selection',
    },
    ...overrides,
  };

  return `
title: ${options.title}
id: ${generateId()}
status: ${options.status}
level: ${options.level}
description: ${options.description}
author: ${options.author}
logsource:
    category: ${options.logsource.category}
    product: ${options.logsource.product}
detection:
    selection:
        message|contains: 'error'
    condition: selection
falsepositives:
    - Testing
tags:
    - test
    - e2e
`.trim();
}

export interface SigmaRuleOptions {
  title: string;
  description: string;
  level: 'informational' | 'low' | 'medium' | 'high' | 'critical';
  status: 'test' | 'experimental' | 'stable';
  author: string;
  logsource: {
    category: string;
    product: string;
  };
  detection: {
    selection: Record<string, any>;
    condition: string;
  };
}

/**
 * Create a complex Sigma rule for testing detection
 */
export function createDetectionSigmaRule(keyword: string): string {
  return `
title: Detect ${keyword} in logs
id: ${generateId()}
status: test
level: high
description: Detects logs containing the keyword "${keyword}"
author: E2E Test
logsource:
    category: application
    product: logward
detection:
    selection:
        message|contains: '${keyword}'
    condition: selection
falsepositives:
    - Testing
tags:
    - test
    - e2e
    - detection
`.trim();
}

/**
 * Wait helper for async operations
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
