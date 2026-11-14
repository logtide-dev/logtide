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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
        product: 'any',
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
 * Antivirus & Malware Pack
 * Detects malware findings, AV scan failures, and infection patterns
 * from ClamAV and similar antivirus tools
 */
const antivirusMalwarePack: DetectionPack = {
  id: 'antivirus-malware',
  name: 'Antivirus & Malware Pack',
  description: 'Monitors antivirus tools for malware detections, scan failures, and signature issues. Covers ClamAV and similar AV engines.',
  category: 'security',
  icon: 'bug',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'malware-detected',
      name: 'Malware Detected',
      description: 'Triggers when antivirus software reports a malware finding.',
      logsource: {
        product: 'linux',
        service: 'clamav',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['FOUND', 'Virus found', 'malware detected', 'infected:', 'Trojan found', 'Worm found', 'threat detected'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.execution', 'attack.t1204'],
      references: ['https://attack.mitre.org/techniques/T1204/'],
    },
    {
      id: 'av-scan-failure',
      name: 'Antivirus Scan Failure',
      description: 'Detects scan errors that could indicate AV tampering or misconfiguration.',
      logsource: {
        product: 'linux',
        service: 'clamav',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['scan failed', 'scan error', 'access denied', 'database corrupt', 'engine error', 'cannot open'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.defense_evasion', 'attack.t1562'],
      references: ['https://attack.mitre.org/techniques/T1562/'],
    },
    {
      id: 'webshell-detected',
      name: 'Malware in Web Directory',
      description: 'Detects malware findings inside web-accessible directories, indicating a possible webshell.',
      logsource: {
        product: 'linux',
        service: 'clamav',
      },
      detection: {
        condition: 'selection_malware and selection_path',
        selection_malware: {
          'message|contains': ['FOUND', 'infected:', 'malware detected'],
        },
        selection_path: {
          'message|contains': ['/var/www', '/usr/share/nginx', '/opt/apache', 'public_html', 'htdocs', 'wwwroot'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1505.003'],
      references: ['https://attack.mitre.org/techniques/T1505/003/'],
    },
    {
      id: 'av-signatures-outdated',
      name: 'Virus Signatures Outdated',
      description: 'Detects when antivirus definitions are stale, reducing detection capability.',
      logsource: {
        product: 'linux',
        service: 'clamav',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['database is older than', 'outdated signatures', 'update recommended', 'definitions expired', 'freshclam error', 'update failed'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.defense_evasion', 'attack.t1562.001'],
      references: ['https://attack.mitre.org/techniques/T1562/001/'],
    },
    {
      id: 'quarantine-failure',
      name: 'Quarantine or Removal Failed',
      description: 'Alerts when malware quarantine or removal fails, leaving the host exposed.',
      logsource: {
        product: 'linux',
        service: 'clamav',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['quarantine failed', 'removal failed', 'cannot delete', 'disinfect failed', 'clean failed', 'move to quarantine error'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.defense_evasion', 'attack.t1070'],
      references: ['https://attack.mitre.org/techniques/T1070/'],
    },
  ],
};

/**
 * Rootkit Detection Pack
 * Detects rootkits, hidden processes, kernel tampering, and system binary modifications
 * from rkhunter, chkrootkit, and similar scanners
 */
const rootkitDetectionPack: DetectionPack = {
  id: 'rootkit-detection',
  name: 'Rootkit Detection Pack',
  description: 'Monitors for rootkit indicators from rkhunter, chkrootkit, and similar tools. Detects hidden processes, binary tampering, and kernel anomalies.',
  category: 'security',
  icon: 'skull',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'rootkit-found',
      name: 'Rootkit Detected',
      description: 'Triggers on positive rootkit identification by any scanner.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['Possible rootkit', 'Rootkit found', 'INFECTED', 'rootkit detected', 'rootkit warning', 'known rootkit'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.persistence', 'attack.privilege_escalation', 'attack.t1014'],
      references: ['https://attack.mitre.org/techniques/T1014/'],
    },
    {
      id: 'hidden-process',
      name: 'Hidden Process Detected',
      description: 'Detects processes hidden from standard tools, a classic rootkit indicator.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['hidden process', 'process not visible', 'Suspicious: PID', 'hidden PID', 'unlisted process', 'process hidden from'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.defense_evasion', 'attack.t1564', 'attack.t1014'],
      references: ['https://attack.mitre.org/techniques/T1564/'],
    },
    {
      id: 'system-binary-modified',
      name: 'System Binary Modified',
      description: 'Detects modifications to critical system binaries that could indicate trojanization.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['has been replaced', 'binary modified', 'checksum mismatch', 'hash changed', 'file properties have changed', 'binary hash mismatch'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1554'],
      references: ['https://attack.mitre.org/techniques/T1554/'],
    },
    {
      id: 'suspicious-kernel-module',
      name: 'Suspicious Kernel Module',
      description: 'Detects loading of suspicious or unknown kernel modules.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['suspicious kernel module', 'unknown module', 'unhidden module', 'LKM trojan', 'module not in modprobe', 'unsigned kernel module'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1547.006'],
      references: ['https://attack.mitre.org/techniques/T1547/006/'],
    },
    {
      id: 'promiscuous-interface',
      name: 'Network Interface in Promiscuous Mode',
      description: 'Detects network interfaces set to promiscuous mode, indicating possible sniffing.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['promiscuous mode', 'PROMISC', 'packet sniffing', 'interface sniffing', 'entered promiscuous'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.credential_access', 'attack.discovery', 'attack.t1040'],
      references: ['https://attack.mitre.org/techniques/T1040/'],
    },
  ],
};

/**
 * File Integrity Monitoring Pack
 * Detects unauthorized file modifications on critical paths
 * from AIDE, OSSEC, Tripwire, and similar FIM tools
 */
const fileIntegrityPack: DetectionPack = {
  id: 'file-integrity',
  name: 'File Integrity Monitoring Pack',
  description: 'Monitors critical system files, SSH configs, web directories, and scheduled tasks for unauthorized changes. Works with AIDE, OSSEC, Tripwire, and similar tools.',
  category: 'security',
  icon: 'file-check',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'critical-file-modified',
      name: 'Critical System File Modified',
      description: 'Detects changes to sensitive files like /etc/passwd, /etc/shadow, /etc/sudoers.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection_fim and selection_path',
        selection_fim: {
          'message|contains': ['file modified', 'integrity check', 'changed:', 'AIDE found differences', 'ossec: integrity'],
        },
        selection_path: {
          'message|contains': ['/etc/passwd', '/etc/shadow', '/etc/sudoers', '/etc/gshadow', '/boot/', '/lib/modules'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1098', 'attack.t1543'],
      references: ['https://attack.mitre.org/techniques/T1098/'],
    },
    {
      id: 'ssh-config-changed',
      name: 'SSH Configuration Modified',
      description: 'Detects changes to SSH server or client configuration files.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection_fim and selection_path',
        selection_fim: {
          'message|contains': ['file modified', 'integrity check', 'changed:', 'AIDE found differences', 'file changed'],
        },
        selection_path: {
          'message|contains': ['sshd_config', 'ssh_config', 'authorized_keys', '.ssh/config', 'ssh_host_'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.persistence', 'attack.lateral_movement', 'attack.t1098.004'],
      references: ['https://attack.mitre.org/techniques/T1098/004/'],
    },
    {
      id: 'web-files-modified',
      name: 'Web Application Files Modified',
      description: 'Detects unauthorized file changes in web directories that could indicate webshell deployment.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection_fim and selection_path',
        selection_fim: {
          'message|contains': ['file modified', 'file added', 'new file:', 'integrity check', 'file changed'],
        },
        selection_path: {
          'message|contains': ['/var/www', '/usr/share/nginx', '/opt/apache', 'htdocs', 'wwwroot'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1505.003'],
      references: ['https://attack.mitre.org/techniques/T1505/003/'],
    },
    {
      id: 'cron-modified',
      name: 'Scheduled Task Modified',
      description: 'Detects changes to cron jobs and scheduled tasks, a common persistence mechanism.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['/etc/crontab', '/etc/cron.d', '/var/spool/cron', 'crontab modified', 'cron job changed', 'at job created', 'systemd timer changed'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['attack.persistence', 'attack.t1053.003'],
      references: ['https://attack.mitre.org/techniques/T1053/003/'],
    },
    {
      id: 'mass-file-changes',
      name: 'Mass File System Changes',
      description: 'Detects bulk file modifications that could indicate ransomware or wiper activity.',
      logsource: {
        product: 'linux',
      },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['mass file change', 'bulk modification', 'files changed:', 'large number of changes', 'files encrypted', 'files deleted in bulk', 'ransom'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['attack.impact', 'attack.t1486'],
      references: ['https://attack.mitre.org/techniques/T1486/'],
    },
  ],
};

/**
 * Hardware Health Pack
 * Kernel and BMC hardware events (memory ECC, machine checks, disk and NVMe
 * errors, PCIe AER, thermal throttling, power supplies, NIC problems).
 * Matches plain syslog/journald kernel lines as well as the events sent by the
 * LogTide hardware agent. Hardware faults are not attacks, so rules carry no
 * MITRE ATT&CK tags. Matching is case-insensitive.
 */
const hardwareHealthPack: DetectionPack = {
  id: 'hardware-health',
  name: 'Hardware Health Pack',
  description: 'Early warning for failing hardware from kernel and BMC logs: ECC memory errors, machine checks, disk and NVMe I/O errors, PCIe errors, thermal throttling, power supply faults and NIC problems.',
  category: 'hardware',
  icon: 'cpu',
  author: 'LogTide',
  version: '1.0.0',
  rules: [
    {
      id: 'memory-corrected-error',
      name: 'Corrected Memory Error (ECC)',
      description: 'EDAC or BMC reported a corrected memory error. A steady stream means a DIMM is degrading.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection_edac or selection_sel',
        selection_edac: {
          'message|contains|all': ['EDAC', ' CE '],
        },
        selection_sel: {
          // leading space keeps "Uncorrectable ECC" out
          'message|contains': [' Correctable ECC'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['hardware', 'hardware.memory'],
    },
    {
      id: 'memory-uncorrected-error',
      name: 'Uncorrected Memory Error (ECC)',
      description: 'EDAC or BMC reported an uncorrectable memory error. Data may be corrupted, replace the DIMM.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection_edac or selection_text',
        selection_edac: {
          'message|contains|all': ['EDAC', ' UE '],
        },
        selection_text: {
          'message|contains': ['Uncorrectable ECC', 'Uncorrected memory error', 'Uncorrectable memory error'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['hardware', 'hardware.memory'],
    },
    {
      id: 'machine-check-exception',
      name: 'Machine Check Exception',
      description: 'The CPU reported a hardware error through the machine check architecture (cache, bus, memory or CPU fault).',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['mce: [Hardware Error]', 'Machine check events logged', 'Machine Check Exception'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.cpu'],
    },
    {
      id: 'apei-error-corrected',
      name: 'Corrected Hardware Error (APEI)',
      description: 'Firmware reported a corrected hardware error through APEI/GHES (memory, PCIe or CPU). Frequent ones point to a degrading component.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains|all': ['Hardware Error]:', 'event severity: corrected'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['hardware', 'hardware.cpu'],
    },
    {
      id: 'apei-error-recoverable',
      name: 'Recoverable Hardware Error (APEI)',
      description: 'Firmware reported a recoverable (uncorrected) hardware error through APEI/GHES.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains|all': ['Hardware Error]:', 'event severity: recoverable'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.cpu'],
    },
    {
      id: 'apei-error-fatal',
      name: 'Fatal Hardware Error (APEI)',
      description: 'Firmware reported a fatal hardware error through APEI/GHES. The machine is likely to crash or reset.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains|all': ['Hardware Error]:', 'event severity: fatal'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['hardware', 'hardware.cpu'],
    },
    {
      id: 'disk-io-error',
      name: 'Disk I/O Error',
      description: 'The kernel failed a block I/O request, or the drive reported a medium or unrecovered read error.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': [
            'I/O error, dev',
            'Buffer I/O error',
            'Medium Error',
            'Unrecovered read error',
            'error: { UNC }',
            'Error: UNC',
          ],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.disk'],
    },
    {
      id: 'ata-command-failed',
      name: 'ATA Command Failed',
      description: 'A SATA or ATA command failed or the port raised an exception. Often a failing drive, cable or controller.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': [
            'failed command: READ FPDMA',
            'failed command: WRITE FPDMA',
            'failed command: READ DMA',
            'failed command: WRITE DMA',
            'failed command: FLUSH',
            'exception Emask',
          ],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.disk'],
    },
    {
      id: 'ata-link-reset',
      name: 'SATA Link Reset or Down',
      description: 'The kernel reset a SATA link or lost it. One occurrence at boot is normal, repeated ones point to a bad cable, port or drive.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['hard resetting link', 'SATA link down'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['hardware', 'hardware.disk'],
    },
    {
      id: 'nvme-controller-fault',
      name: 'NVMe Timeout or Controller Down',
      description: 'An NVMe command timed out or the controller stopped responding.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection_nvme and selection_fault',
        selection_nvme: {
          'message|contains': ['nvme'],
        },
        selection_fault: {
          'message|contains': ['timeout', 'controller is down', 'will reset', 'probe failure'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.disk'],
    },
    {
      id: 'pcie-aer-uncorrected',
      name: 'PCIe Uncorrected Error',
      description: 'PCIe Advanced Error Reporting logged an uncorrected (fatal or non-fatal) error on a device or link.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['AER: Uncorrected', 'AER: Multiple Uncorrected', 'severity=Uncorrected'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.pcie'],
    },
    {
      id: 'pcie-aer-corrected',
      name: 'PCIe Corrected Error',
      description: 'PCIe Advanced Error Reporting logged a corrected error. Frequent ones indicate a marginal slot, riser or device.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['AER: Corrected error', 'AER: Multiple Corrected', 'severity=Corrected'],
        },
      },
      level: 'low',
      status: 'stable',
      tags: ['hardware', 'hardware.pcie'],
    },
    {
      id: 'cpu-thermal-throttle',
      name: 'CPU Thermal Throttling',
      description: 'The CPU exceeded its temperature threshold and was throttled. Check cooling and airflow.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['temperature above threshold', 'cpu clock throttled'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.thermal'],
    },
    {
      id: 'thermal-critical',
      name: 'Critical Temperature or Threshold Reached',
      description: 'A thermal zone hit its critical trip point or the BMC reported an upper critical or non-recoverable threshold, the system may shut down.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection_text or selection_sel or (selection_thermal and selection_critical)',
        selection_text: {
          'message|contains': ['critical temperature reached'],
        },
        selection_sel: {
          'message|contains': ['Upper Critical - going high', 'Upper Critical going high', 'Upper Non-recoverable'],
        },
        selection_thermal: {
          'message|contains': ['thermal'],
        },
        selection_critical: {
          'message|contains': ['critical'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['hardware', 'hardware.thermal'],
    },
    {
      id: 'power-supply-fault',
      name: 'Power Supply Fault',
      description: 'The BMC or kernel reported a power supply failure, AC loss or lost redundancy.',
      logsource: { product: 'any' },
      detection: {
        condition: '(selection_psu and selection_fault) or selection_redundancy',
        selection_psu: {
          // "psu" alone would match words like "capsule", so only PSU followed by a number or surrounded by spaces
          'message|contains': ['power supply', 'psu1', 'psu2', 'psu3', 'psu4', 'psu 1', 'psu 2', 'psu 3', 'psu 4', ' psu ', 'ps1 status', 'ps2 status'],
        },
        selection_fault: {
          'message|contains': ['fail', 'fault', 'AC lost', 'lost', 'predictive', 'non-recoverable', 'critical'],
        },
        selection_redundancy: {
          'message|contains': ['redundancy lost', 'Non-redundant'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.power'],
    },
    {
      id: 'power-supply-removed',
      name: 'Power Supply Removed',
      description: 'The BMC reports that a power supply is no longer present (removed or dead). This is the one rule that matches a deasserted SEL entry.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection_psu and selection_removed',
        selection_psu: {
          'message|contains': ['power supply', 'psu', 'ps1', 'ps2'],
        },
        selection_removed: {
          'message|contains': ['Presence detected | Deasserted'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.power'],
    },
    {
      id: 'cpu-ierr',
      name: 'CPU Internal Error (IERR)',
      description: 'The BMC logged a processor internal error (IERR). The CPU or board is faulty.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': [' IERR'],
        },
      },
      level: 'critical',
      status: 'stable',
      tags: ['hardware', 'hardware.cpu'],
    },
    {
      id: 'drive-fault',
      name: 'Drive Fault (BMC)',
      description: 'The BMC or RAID backplane reported a drive fault.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['Drive Fault'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.disk'],
    },
    {
      id: 'pci-parity-error',
      name: 'PCI Parity or System Error',
      description: 'The BMC logged a PCI parity (PERR) or system (SERR) error.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['PCI PERR', 'PCI SERR'],
        },
      },
      level: 'high',
      status: 'stable',
      tags: ['hardware', 'hardware.pcie'],
    },
    {
      id: 'nic-link-problem',
      name: 'NIC Link Down or Hang',
      description: 'A network card lost its link, hung its transmit unit or hit the transmit watchdog.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['NIC Link is Down', 'Detected Tx Unit Hang', 'NETDEV WATCHDOG'],
        },
      },
      level: 'medium',
      status: 'stable',
      tags: ['hardware', 'hardware.network'],
    },
    {
      id: 'nic-link-not-ready',
      name: 'NIC Link Not Ready',
      description: 'The kernel reported a network interface whose link is not ready. Common at boot, informative when repeated.',
      logsource: { product: 'any' },
      detection: {
        condition: 'selection',
        selection: {
          'message|contains': ['link is not ready'],
        },
      },
      level: 'low',
      status: 'experimental',
      tags: ['hardware', 'hardware.network'],
    },
  ],
};

// BMC (SEL) recoveries are logged as "... | Deasserted". They must never fire a rule,
// except the one that deliberately looks for a deasserted presence sensor.
const RECOVERY_EXEMPT_RULES = new Set(['power-supply-removed']);
hardwareHealthPack.rules = hardwareHealthPack.rules.map((rule) =>
  RECOVERY_EXEMPT_RULES.has(rule.id)
    ? rule
    : {
        ...rule,
        detection: {
          ...rule.detection,
          condition: `(${rule.detection.condition}) and not recovery_filter`,
          recovery_filter: { 'message|contains': ['| Deasserted'] },
        },
      }
);

/**
 * All available detection packs
 */
export const DETECTION_PACKS: DetectionPack[] = [
  startupReliabilityPack,
  authSecurityPack,
  databaseHealthPack,
  paymentBillingPack,
  antivirusMalwarePack,
  rootkitDetectionPack,
  fileIntegrityPack,
  hardwareHealthPack,
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
