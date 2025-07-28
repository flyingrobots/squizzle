# Bravo Team - Testing Infrastructure

**Mission**: Achieve 80%+ test coverage and robust testing infrastructure

**Team Lead**: TBD  
**Dependencies**: None initially, later depends on other teams' implementations  
**Critical Path**: NO - But blocks final release

## Wave 1: Foundation (Week 1)

### Task #1: Missing Test Coverage
**Files**: All packages need test files  
**Priority**: CRITICAL  
**Description**: Create comprehensive test suites for all modules

Test files to create:
```
packages/squizzle-cli/src/cli.test.ts
packages/squizzle-cli/src/commands/*.test.ts
packages/squizzle-postgres/src/index.test.ts
packages/squizzle-oci/src/index.test.ts
packages/squizzle-security/src/index.test.ts
packages/squizzle-core/src/manifest.test.ts
packages/squizzle-core/src/version.test.ts
packages/squizzle-core/src/errors.test.ts
```

Focus areas:
- CLI command parsing and execution
- Database driver operations
- Storage operations (mock & real)
- Security provider functions
- Manifest creation/validation
- Version parsing/comparison
- Error handling scenarios

## Wave 2: Integration (Week 2)

### Task #17: Integration Tests
**File**: `test/integration/workflow.test.ts` (create new)  
**Priority**: HIGH  
**Depends On**: Basic test infrastructure from Wave 1  
**Description**: End-to-end workflow testing

Test scenarios:
1. Build artifact from migrations
2. Push to storage (mock)
3. Pull from storage
4. Apply to test database
5. Verify application
6. Status checking
7. Rollback testing
8. Error recovery

## Wave 3: Automation (Week 3)

### Task #12: Test Infrastructure Automation
**File**: Root `package.json`  
**Priority**: CRITICAL  
**Depends On**: All test files created  
**Description**: Automate test setup/teardown

Implementation:
```json
{
  "scripts": {
    "test:setup": "cd test/infra && ./start-simple.sh",
    "test:teardown": "cd test/infra && docker compose -f docker-compose-simple.yml down",
    "test": "npm run test:setup && vitest run; npm run test:teardown",
    "test:watch": "npm run test:setup && vitest watch"
  }
}
```

Additional automation:
- Pre-commit hooks for tests
- CI pipeline configuration
- Test database seeding
- Cleanup on failure

## Wave 4: Validation (Week 4)

### Task #23: Migration Validation
**File**: `packages/squizzle-core/src/validator.ts` (new)  
**Priority**: HIGH  
**Depends On**: Core functionality complete  
**Description**: SQL validation before execution

Features:
- SQL syntax validation
- Dangerous operation detection (DROP, TRUNCATE)
- Schema compatibility checks
- Rollback availability verification
- Add `--validate` flag to build command

### Additional Wave 4 Work

**Test Coverage Analysis**
- Generate coverage reports
- Identify untested code paths
- Add missing edge case tests
- Performance benchmarks

## Testing Standards

### Unit Tests
- Mock all external dependencies
- Test happy path and error cases
- Use descriptive test names
- Keep tests focused and fast

### Integration Tests
- Use real databases (Docker)
- Test complete workflows
- Include failure scenarios
- Measure performance

### Test Utilities
Create shared test utilities:
```typescript
// test/utils/index.ts
export async function createTestMigration() { }
export async function setupTestStorage() { }
export async function cleanupTestData() { }
```

## Success Metrics

- [ ] Test coverage > 80% across all packages
- [ ] All critical paths have integration tests
- [ ] Tests run in < 2 minutes
- [ ] Zero flaky tests
- [ ] Clear test output and error messages
- [ ] CI/CD pipeline configured

## Resources

- Vitest documentation
- Docker Compose for test infrastructure
- Test artifacts in `test/artifacts/`
- Existing test setup in `test/setup.ts`