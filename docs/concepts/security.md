# Security Model

SQUIZZLE provides comprehensive security features to ensure the integrity and authenticity of database migrations.

## Overview

Security concerns in database migrations:

1. **Tampering** - Migrations modified after creation
2. **Impersonation** - Unauthorized users creating migrations
3. **Supply Chain** - Compromised dependencies or build systems
4. **Replay Attacks** - Old migrations reapplied maliciously

SQUIZZLE addresses these through:
- Cryptographic checksums
- Digital signatures (Sigstore)
- SLSA provenance
- Audit logging

## Integrity Verification

### Checksums

Every artifact and file has SHA256 checksums:

```json
{
  "version": "1.0.0",
  "checksum": "a3f5d8c2b1e4f7d9c6a8b3e5f2d4e7a9...",
  "files": [
    {
      "path": "drizzle/0001_initial.sql",
      "checksum": "b4e6f9d3c2a5e8f1d7b9a4c6e3f5d8a2...",
      "size": 1024
    }
  ]
}
```

Verification process:
```bash
$ squizzle apply 1.0.0
✓ Verifying artifact checksum...
✓ Verifying file checksums (4/4)...
✓ Integrity verified
```

### Tamper Detection

If any file is modified:
```bash
$ squizzle apply 1.0.0
✗ Checksum mismatch in drizzle/0001_initial.sql
  Expected: b4e6f9d3c2a5e8f1d7b9a4c6e3f5d8a2...
  Actual:   c5f7e0a4d3b6f9e2e8a0b5d7f4e6a9c3...
✗ Integrity verification failed
```

## Digital Signatures (Sigstore)

### What is Sigstore?

[Sigstore](https://sigstore.dev) provides keyless signing using OpenID Connect (OIDC) identity providers.

### Configuration

```javascript
// squizzle.config.js
module.exports = {
  security: {
    enabled: true,
    provider: 'sigstore',
    config: {
      // Use public good instance (default)
      fulcio: 'https://fulcio.sigstore.dev',
      rekor: 'https://rekor.sigstore.dev',
      
      // Or private instance
      privateInstance: {
        fulcio: 'https://fulcio.company.com',
        rekor: 'https://rekor.company.com'
      }
    }
  }
}
```

### Signing Process

```bash
$ squizzle build 1.0.0 --sign
✓ Building artifact...
✓ Authenticating with Sigstore...
  → Logged in as john.doe@company.com
✓ Signing artifact...
✓ Recording in transparency log...
  → Entry: 24296fb24b8ad77a3b3c5e3f
✓ Signature added to manifest
```

### Verification

```bash
$ squizzle verify 1.0.0
✓ Pulling artifact...
✓ Verifying signature...
  → Signer: john.doe@company.com
  → Timestamp: 2024-01-15T10:30:00Z
  → Transparency log verified
✓ Signature valid
```

## SLSA Provenance

### Supply Chain Levels for Software Artifacts

SQUIZZLE can generate [SLSA](https://slsa.dev) provenance:

```json
{
  "version": "1.0.0",
  "slsa": {
    "builderId": "https://github.com/myorg/myrepo/.github/workflows/build.yml@refs/heads/main",
    "buildType": "https://squizzle.dev/build/v1",
    "invocation": {
      "configSource": {
        "uri": "https://github.com/myorg/myrepo",
        "digest": {"sha1": "a3f5d8c2..."},
        "entryPoint": "squizzle.config.js"
      }
    },
    "materials": [
      {
        "uri": "https://github.com/myorg/myrepo",
        "digest": {"sha1": "b4e6f9d3..."}
      }
    ]
  }
}
```

### GitHub Actions Integration

```yaml
# .github/workflows/build.yml
name: Build Migrations
on:
  push:
    tags: ['v*']

permissions:
  contents: read
  packages: write
  id-token: write  # For OIDC

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build and sign
        run: |
          squizzle build ${{ github.ref_name }}
          squizzle sign ${{ github.ref_name }}
          
      - name: Generate SLSA provenance
        uses: slsa-framework/slsa-github-generator@v1
        with:
          artifact: db/tarballs/squizzle-*.tar.gz
```

## Access Control

### Database Permissions

Minimal permissions for applying migrations:

```sql
-- Create migration user
CREATE USER squizzle_migrator WITH PASSWORD 'secure';

-- Grant necessary permissions
GRANT CREATE ON DATABASE myapp TO squizzle_migrator;
GRANT ALL ON SCHEMA public TO squizzle_migrator;

-- Grant on specific schemas
GRANT ALL ON SCHEMA squizzle TO squizzle_migrator;
```

### Registry Permissions

Control who can push migrations:

```yaml
# GitHub repository settings
- Read: Pull migrations (developers)
- Write: Push migrations (CI/CD)
- Admin: Delete versions (admins only)
```

### Environment Isolation

Separate credentials per environment:

```bash
# Production
SQUIZZLE_REGISTRY=ghcr.io/myorg/migrations-prod
SQUIZZLE_REGISTRY_TOKEN=ghp_prod_xxxxx
DATABASE_URL=postgresql://prod-host/prod-db

# Staging
SQUIZZLE_REGISTRY=ghcr.io/myorg/migrations-staging
SQUIZZLE_REGISTRY_TOKEN=ghp_staging_xxxxx
DATABASE_URL=postgresql://staging-host/staging-db
```

## Audit Logging

### Migration History

Track all applied migrations:

```sql
-- SQUIZZLE creates this table
CREATE TABLE squizzle_history (
  version VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL,
  applied_by VARCHAR(255) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  signature TEXT,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  metadata JSONB
);
```

Query audit log:
```sql
SELECT 
  version,
  applied_at,
  applied_by,
  success,
  metadata->>'source_ip' as source_ip
FROM squizzle_history
ORDER BY applied_at DESC;
```

### Registry Audit

Most registries provide audit logs:

```bash
# GitHub audit log
gh api /orgs/myorg/audit-log \
  --jq '.[] | select(.action == "package.publish")'

# AWS ECR
aws ecr describe-image-scan-findings \
  --repository-name migrations \
  --image-id imageTag=1.0.0
```

## Security Best Practices

### 1. Always Sign Production Migrations

```javascript
// squizzle.config.js
module.exports = {
  security: {
    enabled: process.env.NODE_ENV === 'production',
    requireSignature: true  // Fail if unsigned
  }
}
```

### 2. Separate Build Environment

Build migrations in isolated CI/CD:
- Clean environment
- No local modifications
- Automated process
- Audit trail

### 3. Principle of Least Privilege

```sql
-- Read-only user for verification
CREATE USER squizzle_reader WITH PASSWORD 'secure';
GRANT SELECT ON squizzle_history TO squizzle_reader;

-- Apply user with minimal permissions
CREATE USER squizzle_applier WITH PASSWORD 'secure';
GRANT INSERT ON squizzle_history TO squizzle_applier;
-- Grant specific schema permissions as needed
```

### 4. Regular Security Scans

```bash
# Scan for vulnerabilities
trivy image ghcr.io/myorg/migrations:1.0.0

# Check dependencies
npm audit
```

### 5. Secure Configuration

Never commit secrets:

```javascript
// ❌ Bad
module.exports = {
  driver: {
    config: {
      password: 'hardcoded-password'
    }
  }
}

// ✅ Good
module.exports = {
  driver: {
    config: {
      password: process.env.DB_PASSWORD
    }
  }
}
```

### 6. Network Security

Use TLS for all connections:

```javascript
driver: {
  config: {
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync('ca-cert.pem'),
      cert: fs.readFileSync('client-cert.pem'),
      key: fs.readFileSync('client-key.pem')
    }
  }
}
```

## Incident Response

### Compromised Migration

If a migration is compromised:

1. **Revoke** - Remove from registry
2. **Audit** - Check where it was applied
3. **Rollback** - If already applied
4. **Re-sign** - Create new version
5. **Notify** - Alert affected teams

```bash
# Remove compromised version
squizzle revoke 1.0.0 --reason "Compromised signature"

# Check deployments
squizzle audit 1.0.0

# Create fixed version
squizzle build 1.0.1 --notes "Security fix for 1.0.0"
```

### Key Rotation

For long-lived keys:

```bash
# Rotate registry credentials
docker logout ghcr.io
docker login ghcr.io -u new-token

# Update CI/CD secrets
gh secret set REGISTRY_TOKEN
```

## Compliance

### SOC 2 / ISO 27001

SQUIZZLE helps meet compliance requirements:

- **Change Management** - All changes tracked
- **Access Control** - Role-based permissions
- **Audit Trail** - Complete history
- **Integrity** - Cryptographic verification

### GDPR / Data Protection

For sensitive data:

```sql
-- Encrypt sensitive columns
ALTER TABLE users 
  ALTER COLUMN email TYPE TEXT USING pgp_sym_encrypt(email, 'key');

-- Audit data access
CREATE TRIGGER audit_sensitive_access
AFTER SELECT ON users
FOR EACH ROW EXECUTE FUNCTION log_access();
```

## Next Steps

- [CI/CD Integration](../guides/cicd.md) - Automated security
- [Disaster Recovery](../guides/disaster-recovery.md) - Security incidents
- [CLI Commands](../reference/cli.md) - Security commands