# Delta Team - Core Engine & Security

**Mission**: Ensure core engine reliability and comprehensive security

**Team Lead**: TBD  
**Dependencies**: None initially (foundational)  
**Critical Path**: YES - Core functionality blocks everything

## Wave 1: Foundation (Week 1)

### Task #10: System Table Initialization
**File**: `packages/squizzle-cli/src/commands/init.ts` (new)  
**Priority**: CRITICAL  
**Description**: Implement `squizzle init` command for database setup

Implementation:
```typescript
program
  .command('init')
  .description('Initialize Squizzle system tables')
  .option('--force', 'Recreate tables even if they exist')
  .action(async (options) => {
    const sql = readFileSync('sql/system/v1.0.0.sql', 'utf-8')
    await driver.execute(sql)
  })
```

Also create auto-bootstrap in engine:
```typescript
// In engine.apply()
if (!(await this.driver.systemTablesExist())) {
  await this.initSystemTables()
}
```

### Task #8: Engine verifyIntegrity Implementation
**File**: `packages/squizzle-core/src/engine.ts:218-232`  
**Priority**: CRITICAL  
**Description**: Implement proper checksum verification

Current implementation extracts files and verifies individual checksums. Need to:
1. Calculate manifest checksum from file checksums
2. Compare with manifest.checksum
3. Throw ChecksumError on mismatch

```typescript
private async verifyIntegrity(artifact: Buffer, manifest: Manifest): Promise<void> {
  // Extract and verify is already in extractMigrations
  // Just need to verify manifest checksum
  const calculated = calculateManifestChecksum(manifest.files)
  if (calculated !== manifest.checksum) {
    throw new ChecksumError('Manifest checksum mismatch')
  }
}
```

## Wave 2: Validation (Week 2)

### Task #13: Environment Variable Validation
**File**: `packages/squizzle-cli/src/config.ts`  
**Priority**: CRITICAL  
**Description**: Validate required environment variables

```typescript
const requiredEnvVars = ['DATABASE_URL']
const conditionalEnvVars = {
  'oci': ['SQUIZZLE_STORAGE_REGISTRY'],
  'sigstore': ['SIGSTORE_OIDC_CLIENT_ID']
}

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required: ${envVar}`)
  }
}
```

### Task #14: Version Compatibility Check
**File**: `packages/squizzle-cli/src/commands/build.ts`  
**Priority**: CRITICAL  
**Description**: Check Drizzle Kit version compatibility

```typescript
const REQUIRED_DRIZZLE_VERSION = '>=0.36.0'

function checkDrizzleVersion() {
  const version = execSync('npx drizzle-kit --version')
  if (!semver.satisfies(version, REQUIRED_DRIZZLE_VERSION)) {
    throw new Error(`Drizzle Kit ${REQUIRED_DRIZZLE_VERSION} required`)
  }
}
```

## Wave 3: Security & Features (Week 3)

### Task #9: Security Provider SBOM Generation
**File**: `packages/squizzle-security/src/index.ts:93`  
**Priority**: CRITICAL  
**Description**: Calculate proper SHA1/SHA256 digests for SBOM

```typescript
// In generateSBOM()
for (const dep of manifest.dependencies) {
  const depPath = `node_modules/${dep.name}/package.json`
  const depContent = readFileSync(depPath)
  
  components.push({
    // ... existing fields ...
    digest: {
      sha1: createHash('sha1').update(depContent).digest('hex'),
      sha256: createHash('sha256').update(depContent).digest('hex')
    }
  })
}
```

### Task #19: Rollback Implementation
**File**: `packages/squizzle-core/src/engine.ts:110-151`  
**Priority**: HIGH  
**Description**: Complete rollback functionality

Current implementation exists but needs:
1. CLI command implementation
2. Rollback file detection in build
3. Validation of rollback migrations
4. Testing with real scenarios

## Wave 4: Performance (Week 4)

### Task #24: Efficient Tarball Extraction
**File**: `packages/squizzle-core/src/engine.ts:234-303`  
**Priority**: MEDIUM  
**Description**: Stream processing for large tarballs

Current implementation loads entire buffer. For large files:
```typescript
// Use streaming with backpressure
import { pipeline } from 'stream/promises'
import { PassThrough } from 'stream'

// Stream directly from storage to tar extraction
const stream = await storage.pullStream(version)
await pipeline(
  stream,
  tar.extract({
    onentry: (entry) => {
      // Process entries as they stream
    }
  })
)
```

## Security Best Practices

### Input Validation
- Validate all version strings
- Sanitize SQL inputs
- Check file paths for traversal
- Validate manifest structure

### Secrets Management
- Never log sensitive data
- Use secure storage for keys
- Rotate credentials regularly
- Audit access logs

### Artifact Security
- Verify signatures before apply
- Check artifact size limits
- Scan for malicious patterns
- Log all operations

## Success Metrics

- [ ] All 7 tasks complete
- [ ] Security audit passed
- [ ] No known vulnerabilities
- [ ] Performance benchmarks met
- [ ] 95%+ test coverage for security code
- [ ] Clear security documentation

## Testing Requirements

- Security vulnerability tests
- Performance benchmarks
- Edge case handling
- Integration with real providers
- Failure scenario tests

## Resources

- OWASP Security Guidelines
- Node.js Security Best Practices
- Sigstore Documentation
- Docker Security Scanning
- npm audit tools