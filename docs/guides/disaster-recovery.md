# Disaster Recovery

Prepare for and recover from database migration disasters using SQUIZZLE's recovery features.

## Disaster Scenarios

Common migration disasters:

1. **Corrupted Migration** - Bad SQL that damages data
2. **Performance Degradation** - Migration causes slowdowns  
3. **Data Loss** - Accidental DROP or DELETE
4. **Locked Database** - Migration hangs with locks
5. **Wrong Environment** - Production migration on wrong database
6. **Cascading Failures** - Migration breaks dependent systems

## Prevention Strategies

### 1. Pre-Migration Checks

```bash
#!/bin/bash
# pre-migration-check.sh

echo "Pre-migration safety checks..."

# Check environment
if [ "$NODE_ENV" = "production" ]; then
  read -p "⚠️  PRODUCTION deployment. Continue? (yes/no): " confirm
  [ "$confirm" != "yes" ] && exit 1
fi

# Check database health
psql $DATABASE_URL -c "SELECT version();" || exit 1

# Check disk space
DISK_USAGE=$(psql $DATABASE_URL -t -c "
  SELECT pg_size_pretty(pg_database_size(current_database()));
")
echo "Database size: $DISK_USAGE"

# Check active connections
CONNECTIONS=$(psql $DATABASE_URL -t -c "
  SELECT count(*) FROM pg_stat_activity 
  WHERE state = 'active';
")
echo "Active connections: $CONNECTIONS"

# Backup before migration
if [ "$NODE_ENV" = "production" ]; then
  echo "Creating backup..."
  pg_dump $DATABASE_URL | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
fi
```

### 2. Migration Validation

```javascript
// Validate SQL before execution
const validateMigration = (sql) => {
  // Check for dangerous operations
  const dangerous = [
    /DROP\s+DATABASE/i,
    /DELETE\s+FROM\s+\w+\s*;/i,  // DELETE without WHERE
    /UPDATE\s+\w+\s+SET\s+[^W]+$/i,  // UPDATE without WHERE
    /TRUNCATE/i
  ]
  
  for (const pattern of dangerous) {
    if (pattern.test(sql)) {
      throw new Error(`Dangerous operation detected: ${pattern}`)
    }
  }
  
  // Check for transaction blocks
  if (!/BEGIN|START TRANSACTION/i.test(sql)) {
    console.warn('Migration not wrapped in transaction')
  }
}
```

### 3. Staged Rollouts

```yaml
# Canary deployment
production_rollout:
  stages:
    - name: canary
      percentage: 5
      duration: 30m
      rollback_on_error: true
      
    - name: partial
      percentage: 25
      duration: 2h
      rollback_on_error: true
      
    - name: full
      percentage: 100
      approval_required: true
```

## Backup Strategies

### 1. Point-in-Time Backups

```bash
# Before critical migration
pg_basebackup -D /backup/before-migration-$(date +%Y%m%d) -Ft -z -P

# Or use cloud provider backups
aws rds create-db-snapshot \
  --db-instance-identifier myapp-prod \
  --db-snapshot-identifier before-migration-$(date +%Y%m%d)
```

### 2. Logical Backups

```bash
# Full backup
pg_dump $DATABASE_URL \
  --format=custom \
  --compress=9 \
  --file=backup-full-$(date +%Y%m%d).dump

# Schema only (faster)
pg_dump $DATABASE_URL \
  --schema-only \
  --file=schema-$(date +%Y%m%d).sql

# Data only  
pg_dump $DATABASE_URL \
  --data-only \
  --format=custom \
  --file=data-$(date +%Y%m%d).dump
```

### 3. Incremental Backups

```sql
-- Track changes for incremental backup
CREATE TABLE backup.change_log (
  id SERIAL PRIMARY KEY,
  table_name TEXT,
  operation TEXT,
  row_data JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to log changes
CREATE OR REPLACE FUNCTION log_changes() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO backup.change_log (table_name, operation, row_data)
  VALUES (TG_TABLE_NAME, TG_OP, row_to_json(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Recovery Procedures

### 1. Immediate Recovery

When disaster strikes:

```bash
#!/bin/bash
# emergency-recovery.sh

echo "🚨 EMERGENCY RECOVERY INITIATED"

# 1. Stop applications
kubectl scale deployment myapp --replicas=0

# 2. Terminate active connections
psql $DATABASE_URL << EOF
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid();
EOF

# 3. Assess damage
CURRENT_VERSION=$(squizzle status --json | jq -r .current)
echo "Current version: $CURRENT_VERSION"

# 4. Rollback if possible
if squizzle rollback $CURRENT_VERSION; then
  echo "✓ Rollback successful"
else
  echo "✗ Rollback failed, restoring from backup"
  # Restore procedure below
fi

# 5. Restart applications
kubectl scale deployment myapp --replicas=3
```

### 2. Restore from Backup

```bash
# Find latest backup
LATEST_BACKUP=$(ls -t backups/*.dump | head -1)

# Create new database
createdb myapp_restore

# Restore
pg_restore \
  --dbname=myapp_restore \
  --verbose \
  --clean \
  --if-exists \
  $LATEST_BACKUP

# Verify
psql myapp_restore -c "SELECT COUNT(*) FROM users;"

# Switch over
psql << EOF
ALTER DATABASE myapp RENAME TO myapp_corrupted;
ALTER DATABASE myapp_restore RENAME TO myapp;
EOF
```

### 3. Point-in-Time Recovery

```bash
# PostgreSQL PITR
recovery_target_time = '2024-01-20 14:30:00'
recovery_target_action = 'promote'

# AWS RDS
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier myapp-prod \
  --target-db-instance-identifier myapp-prod-pitr \
  --restore-time 2024-01-20T14:30:00.000Z
```

## Handling Specific Disasters

### 1. Locked Database

```sql
-- Find blocking queries
SELECT 
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  blocking.pid AS blocking_pid,
  blocking.query AS blocking_query
FROM pg_stat_activity AS blocked
JOIN pg_stat_activity AS blocking 
  ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE blocked.query NOT LIKE '%pg_stat_activity%';

-- Kill blocking queries
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND state_change < NOW() - INTERVAL '5 minutes';
```

### 2. Performance Degradation

```sql
-- Emergency performance fixes
-- Disable expensive constraints temporarily
ALTER TABLE large_table DISABLE TRIGGER ALL;

-- Kill long-running queries
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
  AND query_start < NOW() - INTERVAL '30 minutes';

-- Emergency VACUUM
VACUUM ANALYZE;

-- Reset statistics
SELECT pg_stat_reset();
```

### 3. Data Corruption

```sql
-- Check for corruption
VACUUM FULL VERBOSE ANALYZE;

-- Find corrupted pages
CREATE EXTENSION IF NOT EXISTS pageinspect;

SELECT c.relname, b.relblocknumber, b.isdirty, b.usagecount
FROM pg_buffercache b
JOIN pg_class c ON b.relfilenode = c.relfilenode
WHERE b.isdirty = true
ORDER BY b.usagecount DESC;

-- Mark corrupted pages
SET zero_damaged_pages = on;
VACUUM FULL corrupted_table;
```

### 4. Wrong Environment

```bash
# If migration applied to wrong database
echo "⚠️  Migration applied to wrong environment!"

# 1. Document what was applied
squizzle status > wrong-env-status.txt

# 2. Generate reverse migration
squizzle generate-rollback $VERSION > emergency-rollback.sql

# 3. Review and apply
psql $WRONG_DATABASE < emergency-rollback.sql

# 4. Apply to correct database
squizzle apply $VERSION --env production
```

## Monitoring and Alerts

### 1. Health Checks

```sql
-- Migration health check view
CREATE VIEW squizzle.health_check AS
SELECT
  -- Last successful migration
  (SELECT MAX(applied_at) 
   FROM squizzle_history 
   WHERE success = true) AS last_success,
   
  -- Failed migrations
  (SELECT COUNT(*) 
   FROM squizzle_history 
   WHERE success = false 
   AND applied_at > NOW() - INTERVAL '24 hours') AS recent_failures,
   
  -- Database size
  pg_database_size(current_database()) AS db_size,
  
  -- Active connections
  (SELECT COUNT(*) 
   FROM pg_stat_activity) AS connections,
   
  -- Replication lag
  EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) AS replication_lag;
```

### 2. Alert Configuration

```yaml
# monitoring/alerts.yml
alerts:
  - name: migration_failed
    condition: |
      SELECT COUNT(*) > 0
      FROM squizzle_history
      WHERE success = false
      AND applied_at > NOW() - INTERVAL '5 minutes'
    severity: critical
    notify:
      - pagerduty
      - slack
      
  - name: long_running_migration
    condition: |
      SELECT COUNT(*) > 0
      FROM pg_stat_activity
      WHERE query LIKE '%squizzle%'
      AND state = 'active'
      AND query_start < NOW() - INTERVAL '30 minutes'
    severity: warning
    notify:
      - slack
```

### 3. Automated Recovery

```javascript
// Auto-recovery system
const autoRecover = async () => {
  const health = await checkHealth()
  
  if (health.recentFailures > 0) {
    console.error('Migration failure detected')
    
    // Try rollback
    const lastVersion = await getLastVersion()
    try {
      await squizzle.rollback(lastVersion)
      await notifyTeam('Auto-rollback successful', 'info')
    } catch (error) {
      await notifyTeam('Auto-rollback failed - manual intervention required', 'critical')
      await pageOncall()
    }
  }
}

// Run every 5 minutes
setInterval(autoRecover, 5 * 60 * 1000)
```

## Recovery Testing

### 1. Disaster Recovery Drills

```bash
#!/bin/bash
# dr-drill.sh

echo "Starting disaster recovery drill..."

# 1. Create test database
createdb dr_test

# 2. Apply migrations
squizzle apply --all --env test

# 3. Simulate disaster
psql dr_test -c "DROP TABLE users CASCADE;"

# 4. Test recovery
if ./emergency-recovery.sh dr_test; then
  echo "✓ Recovery successful"
else
  echo "✗ Recovery failed"
  exit 1
fi

# 5. Verify
psql dr_test -c "SELECT COUNT(*) FROM users;"

# 6. Cleanup
dropdb dr_test
```

### 2. Chaos Engineering

```javascript
// Randomly fail migrations in test
if (process.env.CHAOS_ENABLED === 'true') {
  const shouldFail = Math.random() < 0.1  // 10% failure rate
  if (shouldFail) {
    throw new Error('Chaos monkey struck!')
  }
}
```

## Documentation

### 1. Runbook Template

```markdown
# Migration Disaster Runbook

## Symptoms
- [ ] Application errors
- [ ] Database connection failures  
- [ ] Performance degradation
- [ ] Data inconsistencies

## Immediate Actions
1. Check current migration status: `squizzle status`
2. Check database health: `psql -c "SELECT version();"`
3. Check application logs
4. Page on-call if critical

## Recovery Procedures

### Option 1: Rollback
```bash
squizzle rollback <version>
```

### Option 2: Restore from Backup
```bash
./restore-from-backup.sh <backup-file>
```

### Option 3: Manual Fix
1. Connect to database
2. Run corrective SQL
3. Update migration history

## Contacts
- Database Team: #db-team
- On-call: +1-555-ONCALL
- Escalation: CTO
```

### 2. Post-Mortem Template

```markdown
# Post-Mortem: Migration Failure

**Date**: 2024-01-20
**Duration**: 45 minutes
**Impact**: 5% of users affected

## Timeline
- 14:00 - Migration 2.0.0 started
- 14:05 - First errors reported
- 14:10 - Rollback initiated
- 14:45 - Service restored

## Root Cause
Missing index on foreign key caused table locks

## Lessons Learned
1. Always create indexes before foreign keys
2. Test with production-like data volume
3. Add lock timeout to migrations

## Action Items
- [ ] Add pre-migration index check
- [ ] Update migration guidelines
- [ ] Improve monitoring
```

## Best Practices

### 1. Defense in Depth

- Multiple backup strategies
- Automated health checks
- Manual approval gates
- Rollback procedures
- Communication plans

### 2. Regular Testing

- Monthly DR drills
- Chaos engineering
- Backup restoration tests
- Runbook reviews

### 3. Clear Communication

```javascript
// Notify stakeholders
const notifyDisaster = async (severity) => {
  const channels = {
    low: ['slack'],
    medium: ['slack', 'email'],
    high: ['slack', 'email', 'sms'],
    critical: ['slack', 'email', 'sms', 'phone']
  }
  
  for (const channel of channels[severity]) {
    await notify(channel, {
      title: 'Migration Issue Detected',
      severity,
      runbook: 'https://wiki/migration-runbook'
    })
  }
}
```

## Next Steps

- [Rollback Strategies](./rollbacks.md) - Rollback procedures
- [Monitoring Guide](./monitoring.md) - Set up monitoring
- [Security Model](../concepts/security.md) - Security considerations