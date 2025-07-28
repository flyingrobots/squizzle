# Charlie Team - CLI & Build Pipeline

**Mission**: Create exceptional CLI UX and robust build pipeline

**Team Lead**: TBD  
**Dependencies**: Alpha team (storage APIs), Delta team (security)  
**Critical Path**: YES - Blocks user experience

## Wave 1: Foundation (Week 1)

### Task #11: Binary/Executable Configuration
**File**: `packages/squizzle-cli/src/cli.ts`  
**Priority**: CRITICAL  
**Description**: Add shebang for npm global install
```typescript
// Add at line 1:
#!/usr/bin/env node
```

Also update `package.json`:
```json
{
  "bin": {
    "squizzle": "./dist/cli.js"
  },
  "scripts": {
    "prepublishOnly": "npm run build"
  }
}
```

### Task #18: CLI Help Examples
**Files**: All command files in `packages/squizzle-cli/src/commands/`  
**Priority**: HIGH  
**Description**: Add usage examples to each command

For each command add:
```typescript
.example('squizzle build 1.0.0 --notes "Initial schema"')
.example('squizzle build --auto-version --notes "Add user tables"')
.example('squizzle apply 1.0.0 --env production --dry-run')
```

## Wave 2: Enhancement (Week 2)

### Task #6: Build Command Size Calculation
**File**: `packages/squizzle-cli/src/commands/build.ts:90`  
**Priority**: CRITICAL  
**Description**: Show actual artifact size instead of "TODO"
```typescript
// Current: 'Size': 'TODO'
// Target: 'Size': prettyBytes(artifactBuffer.length)
```

### Task #21: Dry Run for Build Command
**File**: `packages/squizzle-cli/src/commands/build.ts`  
**Priority**: HIGH  
**Description**: Add --dry-run flag to preview build

Features:
- List files to be included
- Show calculated checksums
- Display manifest preview
- No artifact creation
- Show would-be version

## Wave 3: Integration (Week 3)

### Task #5: CLI Build Artifact Signing
**File**: `packages/squizzle-cli/src/commands/build.ts:78-80`  
**Priority**: CRITICAL  
**Depends On**: Delta team's security implementation  
**Description**: Integrate with security provider for signing

```typescript
if (options.config.security?.enabled) {
  const security = new SigstoreProvider(options.config.security)
  const signature = await security.sign(artifactBuffer)
  manifest.signature = signature
}
```

## Wave 4: Performance (Week 4)

### Task #25: Caching for Remote Operations
**File**: `packages/squizzle-cli/src/cache.ts` (new)  
**Priority**: MEDIUM  
**Description**: Add local cache for remote operations

Cache implementation:
- Version list caching (5 min TTL)
- Manifest caching (immutable)
- Auth token caching
- Clear cache command
- Cache size limits

## Additional CLI Enhancements

### Command Structure
Ensure consistent command structure:
```
squizzle <command> [options]
  init         Initialize squizzle in project
  build        Build migration artifact
  apply        Apply migration version
  rollback     Rollback migration version
  status       Show migration status
  list         List available versions
  verify       Verify migration artifact
  completion   Generate shell completion
```

### Global Options
Implement consistent global options:
- `--config <path>` - Config file path
- `--json` - JSON output format
- `--quiet` - Minimal output
- `--verbose` - Debug output
- `--no-color` - Disable colors

### Error Handling
Improve error messages:
```typescript
try {
  // command logic
} catch (error) {
  if (error instanceof VersionError) {
    console.error(chalk.red('Version error:'), error.message)
    console.error(chalk.gray('Try: squizzle list'))
  } else if (error instanceof StorageError) {
    console.error(chalk.red('Storage error:'), error.message)
    console.error(chalk.gray('Check your registry configuration'))
  }
  process.exit(1)
}
```

## Success Metrics

- [ ] All 6 tasks complete
- [ ] CLI installable via `npm install -g`
- [ ] All commands have examples
- [ ] Consistent error handling
- [ ] Performance: build < 2s for typical project
- [ ] Helpful error messages with suggestions

## Testing Requirements

- CLI command parsing tests
- Output format tests
- Error scenario tests
- Integration tests with real commands
- Performance benchmarks

## Resources

- Commander.js documentation
- Chalk for colors
- Ora for spinners
- Pretty-bytes for size formatting
- Inquirer for interactive prompts