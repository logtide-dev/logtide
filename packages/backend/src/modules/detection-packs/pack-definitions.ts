import type { DetectionPack } from './types.js';

/**
 * Startup Reliability Pack
 * Essential monitoring for production web applications
 * Sigma rules for error detection, OOM, database issues
 */
const startupReliabilityPack: DetectionPack = {
  id: 'startup-reliability',
  name: 'Startup Reliability Pack',
  description: 'Essential alerts for production web applications. Monitors error rates, crashes, and infrastructure health using pattern-based detection.',
  category: 'reliability',
  icon: 'rocket',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'high-error-rate',
      name: 'High Error Rate Detection',
      description: 'Detects application errors and exceptions in logs.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          level: ['error', 'critical'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1499'],
      references: ['https://attack.mitre.org/techniques/T1499/'],
    },
    {
      id: 'critical-errors',
      name: 'Critical System Errors',
      description: 'Alerts on critical-level errors that require immediate attention.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          level: ['critical'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'oom-crashes',
      name: 'Out of Memory Detection',
      description: 'Detects out-of-memory errors and memory exhaustion patterns.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['out of memory', 'OutOfMemory', 'OOM', 'heap space', 'memory exhausted', 'ENOMEM', 'Cannot allocate memory'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1499.004'],
      references: ['https://attack.mitre.org/techniques/T1499/004/'],
    },
    {
      id: 'unhandled-exceptions',
      name: 'Unhandled Exceptions',
      description: 'Detects unhandled exceptions and uncaught errors.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['unhandled exception', 'uncaught exception', 'UnhandledException', 'UncaughtException', 'fatal error', 'panic:', 'FATAL'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'service-crash',
      name: 'Service Crash Detection',
      description: 'Detects service crashes and unexpected terminations.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['crashed', 'terminated unexpectedly', 'segmentation fault', 'SIGSEGV', 'SIGKILL', 'core dumped', 'process exited'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1489'],
      references: ['https://attack.mitre.org/techniques/T1489/'],
    },
  ],
};

/**
 * Auth & Security Pack
 * Security-focused detection for authentication and access control
 * MITRE ATT&CK mapped rules for brute force, credential access
 */
const authSecurityPack: DetectionPack = {
  id: 'auth-security',
  name: 'Auth & Security Pack',
  description: 'Security monitoring for authentication systems. Detects brute force attempts, suspicious patterns, and access anomalies.',
  category: 'security',
  icon: 'shield',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'failed-login-attempts',
      name: 'Failed Login Attempts',
      description: 'Detects failed authentication attempts indicating potential brute force attacks.',
      logsource: {
        product: 'application',
        category: 'authentication',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['failed login', 'login failed', 'authentication failed', 'invalid password', 'invalid credentials', 'wrong password', 'access denied', 'unauthorized'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.credential_access', 'attack.t1110', 'attack.t1110.001'],
      references: ['https://attack.mitre.org/techniques/T1110/'],
    },
    {
      id: 'brute-force-detection',
      name: 'Brute Force Attack Detection',
      description: 'Detects rapid repeated authentication failures from same source.',
      logsource: {
        product: 'application',
        category: 'authentication',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['too many attempts', 'account locked', 'temporarily blocked', 'rate limited', 'brute force', 'multiple failed'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.credential_access', 'attack.t1110.001', 'attack.t1110.003'],
      references: ['https://attack.mitre.org/techniques/T1110/001/'],
    },
    {
      id: 'suspicious-user-agent',
      name: 'Suspicious User Agent',
      description: 'Detects requests with suspicious or automated user agents.',
      logsource: {
        product: 'webserver',
        category: 'webserver',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['sqlmap', 'nikto', 'nmap', 'masscan', 'burp', 'dirbuster', 'gobuster', 'hydra', 'medusa'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.reconnaissance', 'attack.t1595', 'attack.t1592'],
      references: ['https://attack.mitre.org/techniques/T1595/'],
    },
    {
      id: 'privilege-escalation',
      name: 'Privilege Escalation Attempt',
      description: 'Monitors for unauthorized access attempts to admin or elevated resources.',
      logsource: {
        product: 'application',
        category: 'authentication',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['privilege escalation', 'unauthorized admin', 'forbidden', 'insufficient permissions', 'not authorized', 'access violation', 'elevated privileges'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.privilege_escalation', 'attack.t1078', 'attack.t1548'],
      references: ['https://attack.mitre.org/techniques/T1078/'],
    },
    {
      id: 'session-hijacking',
      name: 'Session Hijacking Detection',
      description: 'Detects potential session hijacking or token theft.',
      logsource: {
        product: 'application',
        category: 'authentication',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['session hijack', 'token stolen', 'invalid session', 'session expired', 'session mismatch', 'concurrent session', 'session replay'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.credential_access', 'attack.t1539', 'attack.t1550'],
      references: ['https://attack.mitre.org/techniques/T1539/'],
    },
  ],
};

/**
 * Database Health Pack
 * Database performance and reliability monitoring
 * Detects slow queries, connection issues, deadlocks
 */
const databaseHealthPack: DetectionPack = {
  id: 'database-health',
  name: 'Database Health Pack',
  description: 'Database monitoring for query performance, connection health, and data integrity issues.',
  category: 'database',
  icon: 'database',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'slow-query-detection',
      name: 'Slow Query Detection',
      description: 'Detects database queries exceeding performance thresholds.',
      logsource: {
        product: 'database',
        category: 'database',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['slow query', 'query timeout', 'long running query', 'execution time exceeded', 'query took'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1499.001'],
      references: ['https://attack.mitre.org/techniques/T1499/001/'],
    },
    {
      id: 'connection-pool-exhaustion',
      name: 'Connection Pool Exhaustion',
      description: 'Monitors connection pool exhaustion and timeout warnings.',
      logsource: {
        product: 'database',
        category: 'database',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['connection pool', 'pool exhausted', 'no available connections', 'connection timeout', 'max connections', 'too many connections'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1499'],
    },
    {
      id: 'deadlock-detection',
      name: 'Database Deadlock Detection',
      description: 'Alerts on database deadlock occurrences.',
      logsource: {
        product: 'database',
        category: 'database',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['deadlock', 'lock wait timeout', 'transaction aborted', 'lock conflict', 'concurrent update'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'replication-issues',
      name: 'Replication Issues',
      description: 'Monitors database replication lag and sync issues.',
      logsource: {
        product: 'database',
        category: 'database',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['replication lag', 'replica behind', 'sync failed', 'replication error', 'slave lag', 'standby lag'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'sql-injection-attempt',
      name: 'SQL Injection Attempt',
      description: 'Detects potential SQL injection attack patterns.',
      logsource: {
        product: 'database',
        category: 'database',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['sql injection', 'syntax error', 'malformed query', 'UNION SELECT', 'OR 1=1', "' OR '", '-- -', 'DROP TABLE'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.initial_access', 'attack.t1190', 'attack.t1059.005'],
      references: ['https://attack.mitre.org/techniques/T1190/'],
    },
  ],
};

/**
 * Payment & Billing Pack
 * Payment gateway and financial transaction monitoring
 * Detects payment failures, fraud indicators
 */
const paymentBillingPack: DetectionPack = {
  id: 'payment-billing',
  name: 'Payment & Billing Pack',
  description: 'Payment system monitoring for transaction errors, fraud indicators, and billing anomalies.',
  category: 'business',
  icon: 'credit-card',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'payment-failure',
      name: 'Payment Failure Detection',
      description: 'Monitors payment processing failures and transaction errors.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['payment failed', 'transaction declined', 'card declined', 'insufficient funds', 'payment error', 'charge failed'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'webhook-failure',
      name: 'Payment Webhook Failure',
      description: 'Detects failed webhook deliveries from payment providers.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['webhook failed', 'webhook error', 'stripe webhook', 'payment notification failed', 'IPN failed'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'fraud-indicators',
      name: 'Fraud Indicator Detection',
      description: 'Detects potential fraudulent transaction patterns.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['fraud', 'suspicious transaction', 'velocity check', 'risk score', 'blocked transaction', 'card testing'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1657'],
      references: ['https://attack.mitre.org/techniques/T1657/'],
    },
    {
      id: 'chargeback-refund',
      name: 'Chargeback/Refund Activity',
      description: 'Monitors chargebacks and refund requests.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['chargeback', 'refund', 'dispute', 'reversed', 'money back'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.impact'],
    },
    {
      id: 'payment-gateway-error',
      name: 'Payment Gateway Errors',
      description: 'Detects payment gateway connectivity and processing errors.',
      logsource: {
        product: 'application',
        category: 'application',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['gateway error', 'payment gateway', 'stripe error', 'paypal error', 'gateway timeout', 'payment timeout'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.impact'],
    },
  ],
};

/**
 * All available detection packs
 */
export const DETECTION_PACKS: DetectionPack[] = [
  startupReliabilityPack,
  authSecurityPack,
  databaseHealthPack,
  paymentBillingPack,
];

/**
 * Get pack by ID
 */
export function getPackById(packId: string): DetectionPack | undefined {
  return DETECTION_PACKS.find((p) => p.id === packId);
}

/**
 * Get all pack IDs
 */
export function getPackIds(): string[] {
  return DETECTION_PACKS.map((p) => p.id);
}
