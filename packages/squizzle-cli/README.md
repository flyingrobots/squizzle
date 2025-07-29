# @squizzle/cli

Command-line interface for SQUIZZLE - immutable database migrations.

## Installation

```bash
# Global installation (recommended)
npm install -g @squizzle/cli

# Or as a dev dependency
npm install --save-dev @squizzle/cli
```

## Commands

### `squizzle init`

Initialize SQUIZZLE in your project:

```bash
squizzle init
```

Creates:

- `.squizzle.yaml` configuration file
- `db/` directory structure
- Version tracking table in database

### `squizzle build <version>`

Build a new migration version and push to storage:

```bash
squizzle build 1.0.0 --notes "Add user authentication"

# Options:
#   -n, --notes <notes>     Version release notes
#   -a, --author <author>   Version author
#   -t, --tag <tags...>     Version tags
#   --dry-run              Simulate build without creating artifacts
#   --registry <registry>   Override OCI registry URL
#   --repository <repo>     Override OCI repository name
#   --skip-push            Skip pushing to storage (local build only)
```

Features:

- Bundles Drizzle migrations from `db/drizzle/`
- Includes custom SQL from `db/custom/`
- Creates immutable tarball with manifest
- Pushes to configured OCI registry
- Verifies successful upload
- Reports upload speed and size

#### Storage Configuration

The build command supports flexible storage configuration with precedence:

1. **CLI options** (`--registry`, `--repository`) - Highest priority
2. **Environment variables** (`SQUIZZLE_REGISTRY`, `SQUIZZLE_REPOSITORY`)
3. **Config file** (`.squizzle.yaml`) - Default

Examples:

```bash
# Use config file settings
squizzle build 1.0.0

# Override registry via CLI
squizzle build 1.0.0 --registry docker.io --repository myorg/myapp

# Override via environment variables
export SQUIZZLE_REGISTRY=ghcr.io
export SQUIZZLE_REPOSITORY=myorg/myapp
squizzle build 1.0.0

# Build locally without pushing
squizzle build 1.0.0 --skip-push
```

### `squizzle apply <version>`

Apply a migration version:

```bash
squizzle apply 1.0.0

# Options:
#   -f, --force            Force apply even if checks fail
#   --dry-run             Show what would be applied
#   --timeout <ms>        Migration timeout (default: 300000)
#   --parallel            Run independent migrations in parallel
#   --max-parallel <n>    Max parallel migrations (default: 5)
```

### `squizzle rollback <version>`

Rollback to a previous version:

```bash
squizzle rollback 0.9.0

# Options:
#   -f, --force    Force rollback without confirmation
#   --dry-run     Simulate rollback
```

### `squizzle status`

Show current migration status:

```bash
squizzle status

# Output:
# Current Version: 1.0.0
# Applied: 2024-01-15 10:30:00
# Pending Migrations: None
```

### `squizzle verify <version>`

Verify artifact integrity:

```bash
squizzle verify 1.0.0

# Checks:
# - Checksum validation
# - Signature verification (if signed)
# - Manifest integrity
```

## Configuration

Create `.squizzle.yaml`:

```yaml
version: '2.0'

# Artifact storage
storage:
  type: oci  # or filesystem
  registry: ghcr.io/myorg/migrations
  
# Environments
environments:
  development:
    database:
      host: localhost
      port: 5432
      database: myapp_dev
      user: postgres
      password: postgres
      
  production:
    database:
      connectionString: ${DATABASE_URL}

# Security
security:
  enabled: true
  sigstore:
    fulcioURL: https://fulcio.sigstore.dev
    rekorURL: https://rekor.sigstore.dev

# Migration sources
drizzle:
  schema: ./lib/db/schema
  out: ./db/drizzle
  
custom:
  - ./db/custom/*.sql
  - ./db/triggers/*.sql
```

## Environment Variables

- `DATABASE_URL` - Database connection string
- `SQUIZZLE_ENV` - Default environment (overrides -e flag)
- `SQUIZZLE_CONFIG` - Config file path (overrides -c flag)
- `SQUIZZLE_REGISTRY` - Override OCI registry URL for storage
- `SQUIZZLE_REPOSITORY` - Override OCI repository name for storage
- `NO_COLOR` - Disable colored output
- `CI` - Enable CI mode (no interactive prompts)

## Global Options

Available on all commands:

- `-c, --config <path>` - Config file path (default: .squizzle.yaml)
- `-e, --env <name>` - Environment to use (default: development)
- `-v, --verbose` - Verbose output
- `--no-banner` - Disable ASCII banner

## Examples

### Basic Workflow

```bash
# Initialize
squizzle init

# Create and apply first migration
squizzle build 1.0.0 --notes "Initial schema"
squizzle apply 1.0.0

# Make changes, create new version
squizzle build 1.1.0 --notes "Add user profiles"
squizzle apply 1.1.0

# Check status
squizzle status
```

### Production Deployment

```bash
# Build in CI
squizzle build $VERSION --notes "$COMMIT_MESSAGE"

# Apply in production
squizzle apply $VERSION --env production --timeout 600000

# Verify deployment
squizzle status --env production
```

### Rollback Scenario

```bash
# Something went wrong!
squizzle rollback 1.0.0 --env production

# Or dry-run first
squizzle rollback 1.0.0 --env production --dry-run
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Build Migration
  run: squizzle build ${{ github.sha }} --notes "${{ github.event.head_commit.message }}"
  
- name: Apply Migration
  run: squizzle apply ${{ github.sha }} --env production
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### GitLab CI

```yaml
deploy:
  script:
    - squizzle apply $CI_COMMIT_SHA --env production
  environment:
    name: production
```

## Testing

### Unit Tests

Run unit tests for CLI commands:

```bash
npm test
```

### Integration Tests

Integration tests require a real OCI registry to test push functionality:

```bash
# Set test registry credentials
export SQUIZZLE_TEST_REGISTRY=ghcr.io
export SQUIZZLE_TEST_REPOSITORY=your-org/squizzle-test

# Login to registry
docker login ghcr.io

# Run integration tests
npm test -- build.integration.test.ts
```

Integration tests will:

- Create temporary test versions (99.99.x)
- Push artifacts to the configured test registry
- Verify push, retrieval, and deletion operations
- Clean up test artifacts after completion

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev -- <command>

# Run tests
npm test
```

## License

MIT
