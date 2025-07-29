# Alpha Team - Storage & Registry

**Mission**: Complete OCI registry integration and artifact storage functionality

**Team Lead**: TBD  
**Dependencies**: None (foundational team)  
**Critical Path**: YES - Blocks Charlie team's build pipeline

## Wave 1: Foundation (Week 1)

### Task #2: OCI Storage `list()` Method
**File**: `packages/squizzle-oci/src/index.ts:123-140`  
**Priority**: CRITICAL  
**Description**: Implement Docker Registry HTTP API v2 to list available versions
```typescript
// Current: Returns empty array
// Target: Query registry API for tags, filter by version format
```

### Task #3: OCI Storage `delete()` Method  
**File**: `packages/squizzle-oci/src/index.ts:142-146`  
**Priority**: CRITICAL  
**Description**: Implement manifest deletion via Registry API
```typescript
// Current: Throws "not implemented" error
// Target: Get manifest digest, DELETE by digest
```

## Wave 2: Integration (Week 2)

### Task #4: CLI Build Command Push to Storage
**File**: `packages/squizzle-cli/src/commands/build.ts:84-85`  
**Priority**: CRITICAL  
**Depends On**: Wave 1 tasks (#2, #3)  
**Description**: Actually push built artifacts to OCI registry
```typescript
// Current: TODO comment
// Target: storage.push(version, artifact, manifest)
```

## Wave 3: Enhancement (Week 3)

### Task #7: Get Last Version from Storage
**File**: `packages/squizzle-cli/src/commands/build.ts:108-111`  
**Priority**: CRITICAL  
**Depends On**: Task #2 (list method)  
**Description**: Query storage for latest version to support auto-increment
```typescript
// Current: Returns null
// Target: storage.list() -> sort -> return latest
```

## Wave 4: Polish (Week 4)

### Task #22: Docker Registry Authentication
**File**: `packages/squizzle-oci/src/index.ts`  
**Priority**: HIGH  
**Description**: Handle Docker login automatically
- Check if authenticated
- Use Docker credential helpers
- Support multiple auth methods

## Testing Requirements

- Unit tests for each storage method
- Integration tests with real Docker registry
- Mock tests for offline development
- Error handling for network failures

## Success Metrics

- [ ] All 5 tasks complete
- [ ] 90%+ test coverage for OCI package
- [ ] Integration with Docker Hub verified
- [ ] Performance: list() < 500ms, push() < 5s for 10MB
- [ ] Error messages are actionable

## Resources

- [Docker Registry HTTP API V2 Spec](https://docs.docker.com/registry/spec/api/)
- [OCI Distribution Spec](https://github.com/opencontainers/distribution-spec)
- Test registry: `localhost:5000` (see test/infra)