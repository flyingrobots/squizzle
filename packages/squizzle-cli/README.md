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

Build a new migration version:

```bash
squizzle build 1.0.0 --notes "Add user authentication"

# Options:
#   -n, --notes <notes>     Version release notes
#   -a, --author <author>   Version author
#   -t, --tag <tags...>     Version tags
#   --dry-run              Simulate build without creating artifacts
```

Bundles:
- Drizzle migrations from `db/drizzle/`
- Custom SQL from `db/custom/`
- Creates immutable tarball with manifest

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

## License

MIT