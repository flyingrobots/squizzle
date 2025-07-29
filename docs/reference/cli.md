# CLI Reference

Complete reference for all SQUIZZLE CLI commands and options.

## Global Options

Options available for all commands:

```bash
squizzle [command] [options]

Global Options:
  --config, -c      Path to config file         [default: "./squizzle.config.js"]
  --env, -e         Environment name            [default: process.env.NODE_ENV]
  --log-level, -l   Log level                   [choices: "debug", "info", "warn", "error"]
  --no-color        Disable colored output      [boolean]
  --json            Output in JSON format       [boolean]
  --help, -h        Show help                   [boolean]
  --version, -v     Show version number         [boolean]
```

## Commands

### `init`

Initialize SQUIZZLE in your project.

```bash
squizzle init [options]

Options:
  --force, -f       Overwrite existing config   [boolean]
  --template, -t    Config template             [choices: "basic", "advanced"]
  --skip-install    Skip package installation   [boolean]
```

Example:
```bash
# Basic initialization
squizzle init

# With advanced template
squizzle init --template advanced

# Force overwrite
squizzle init --force
```

Creates:
- `squizzle.config.js` - Configuration file
- `db/drizzle/` - Drizzle migrations directory
- `db/squizzle/` - Custom migrations directory
- `db/rollback/` - Rollback scripts directory
- `.squizzle/` - Working directory

### `build`

Build a new migration version.

```bash
squizzle build <version> [options]

Arguments:
  version           Semantic version (e.g., 1.0.0)

Options:
  --notes, -n       Migration notes/description [string] [required]
  --author, -a      Override author             [string]
  --tag, -t         Additional tags             [array]
  --dry-run, -d     Preview without building    [boolean]
  --skip-drizzle    Skip Drizzle generation     [boolean]
  --sign, -s        Sign the artifact           [boolean]
```

Example:
```bash
# Basic build
squizzle build 1.0.0 --notes "Initial schema"

# With author and signing
squizzle build 1.1.0 \
  --notes "Add user profiles" \
  --author "john@example.com" \
  --sign

# Dry run
squizzle build 2.0.0 --notes "Major refactor" --dry-run

# With tags
squizzle build 1.2.0 \
  --notes "Performance improvements" \
  --tag performance \
  --tag indexes
```

### `push`

Push a built version to the registry.

```bash
squizzle push <version> [options]

Arguments:
  version           Version to push

Options:
  --registry, -r    Override registry URL       [string]
  --tag, -t         Additional registry tags    [array]
  --force, -f       Overwrite if exists         [boolean]
```

Example:
```bash
# Push to default registry
squizzle push 1.0.0

# Push with additional tags
squizzle push 1.0.0 --tag latest --tag stable

# Push to different registry
squizzle push 1.0.0 --registry ghcr.io/myorg/migrations
```

### `pull`

Pull a version from the registry.

```bash
squizzle pull <version> [options]

Arguments:
  version           Version to pull

Options:
  --registry, -r    Override registry URL       [string]
  --output, -o      Output directory            [string]
  --verify          Verify signatures           [boolean] [default: true]
```

Example:
```bash
# Pull version
squizzle pull 1.0.0

# Pull without verification
squizzle pull 1.0.0 --no-verify

# Pull to specific directory
squizzle pull 1.0.0 --output ./migrations/
```

### `apply`

Apply a migration version to the database.

```bash
squizzle apply <version> [options]

Arguments:
  version           Version to apply

Options:
  --dry-run, -d     Preview SQL without executing [boolean]
  --force, -f       Skip safety checks            [boolean]
  --timeout         Lock timeout in ms            [number] [default: 30000]
  --parallel        Run migrations in parallel    [boolean]
  --max-parallel    Max parallel migrations       [number] [default: 1]
  --stop-on-error   Stop on first error          [boolean] [default: true]
  --skip-verify     Skip checksum verification    [boolean]
```

Example:
```bash
# Apply version
squizzle apply 1.0.0

# Dry run to preview
squizzle apply 1.0.0 --dry-run

# Force apply with timeout
squizzle apply 1.0.0 --force --timeout 60000

# Parallel execution
squizzle apply 1.0.0 --parallel --max-parallel 5
```

### `rollback`

Rollback a previously applied version.

```bash
squizzle rollback <version> [options]

Arguments:
  version           Version to rollback

Options:
  --dry-run, -d     Preview rollback SQL         [boolean]
  --force, -f       Force rollback               [boolean]
  --only            Only run specific files      [array]
  --skip            Skip specific files          [array]
```

Example:
```bash
# Rollback version
squizzle rollback 1.0.0

# Dry run
squizzle rollback 1.0.0 --dry-run

# Rollback specific files
squizzle rollback 1.0.0 --only rollback/01_tables.sql

# Skip certain files  
squizzle rollback 1.0.0 --skip rollback/03_data.sql
```

### `status`

Show current migration status.

```bash
squizzle status [options]

Options:
  --detailed, -d    Show detailed information    [boolean]
  --limit, -l       Limit history entries        [number] [default: 10]
  --failed          Show only failed migrations  [boolean]
```

Example:
```bash
# Basic status
squizzle status

# Detailed with full history
squizzle status --detailed --limit 50

# Show failures only
squizzle status --failed

# JSON output
squizzle status --json
```

Output:
```
Current version: 1.2.0
Applied at: 2024-01-20 10:30:00
Applied by: ci-user

Recent migrations:
  ✓ 1.2.0 - 2024-01-20 10:30:00 - Add analytics
  ✓ 1.1.0 - 2024-01-15 14:20:00 - User profiles  
  ✗ 1.0.1 - 2024-01-10 09:15:00 - Failed: syntax error
  ✓ 1.0.0 - 2024-01-05 11:00:00 - Initial schema
```

### `verify`

Verify a migration artifact.

```bash
squizzle verify <version> [options]

Arguments:
  version           Version to verify

Options:
  --checksum        Verify checksums             [boolean] [default: true]
  --signature       Verify signatures            [boolean] [default: true]
  --connectivity    Test database connection     [boolean] [default: true]
```

Example:
```bash
# Full verification
squizzle verify 1.0.0

# Checksum only
squizzle verify 1.0.0 --no-signature --no-connectivity

# With JSON output
squizzle verify 1.0.0 --json
```

### `list`

List available versions.

```bash
squizzle list [options]

Options:
  --registry, -r    List from registry           [boolean]
  --local, -l       List local artifacts         [boolean]
  --applied, -a     List applied versions        [boolean]
  --filter, -f      Filter versions (regex)      [string]
  --sort            Sort order                   [choices: "version", "date"]
```

Example:
```bash
# List all registry versions
squizzle list --registry

# List applied versions
squizzle list --applied

# Filter versions
squizzle list --filter "^1\." --sort version

# List local cached versions
squizzle list --local
```

### `diff`

Show differences between versions.

```bash
squizzle diff <from> <to> [options]

Arguments:
  from              Starting version
  to                Ending version

Options:
  --tables          Show table changes           [boolean]
  --columns         Show column changes          [boolean]
  --indexes         Show index changes           [boolean]
  --functions       Show function changes        [boolean]
```

Example:
```bash
# Compare versions
squizzle diff 1.0.0 1.1.0

# Show only table changes
squizzle diff 1.0.0 2.0.0 --tables

# Full diff
squizzle diff 1.0.0 2.0.0 --tables --columns --indexes --functions
```

### `export`

Export migration artifacts.

```bash
squizzle export [version] [options]

Arguments:
  version           Version to export (optional)

Options:
  --output, -o      Output directory             [string] [required]
  --all             Export all versions          [boolean]
  --format          Export format                [choices: "tar", "zip", "dir"]
```

Example:
```bash
# Export specific version
squizzle export 1.0.0 --output ./backups/

# Export all versions
squizzle export --all --output ./backups/

# Export as zip
squizzle export 1.0.0 --output ./backups/ --format zip
```

### `import`

Import migration artifacts.

```bash
squizzle import <path> [options]

Arguments:
  path              Path to artifact file

Options:
  --push            Push to registry after import [boolean]
  --verify          Verify before importing       [boolean] [default: true]
```

Example:
```bash
# Import artifact
squizzle import ./backups/squizzle-v1.0.0.tar.gz

# Import and push
squizzle import ./backups/squizzle-v1.0.0.tar.gz --push

# Import without verification
squizzle import ./artifact.tar.gz --no-verify
```

### `config`

Manage configuration.

```bash
squizzle config <subcommand> [options]

Subcommands:
  validate          Validate configuration
  show              Show current configuration
  init              Initialize configuration
```

Example:
```bash
# Validate config
squizzle config validate

# Show current config
squizzle config show

# Show specific environment
squizzle config show --env production

# Initialize new config
squizzle config init --template advanced
```

### `cache`

Manage local cache.

```bash
squizzle cache <subcommand> [options]

Subcommands:
  clear             Clear all cache
  size              Show cache size
  prune             Remove old entries
```

Example:
```bash
# Clear cache
squizzle cache clear

# Show cache size
squizzle cache size

# Prune old entries
squizzle cache prune --older-than 30d
```

### `completion`

Generate shell completion scripts for enhanced CLI experience.

```bash
squizzle completion [options]

Options:
  --shell           Shell type                   [choices: "bash", "zsh", "fish", "powershell"] [default: "bash"]
```

Example:
```bash
# Generate bash completion
squizzle completion --shell bash > ~/.bash_completion.d/squizzle

# Generate zsh completion  
squizzle completion --shell zsh > ~/.zsh/completions/_squizzle

# Generate fish completion
squizzle completion --shell fish > ~/.config/fish/completions/squizzle.fish

# Generate PowerShell completion
squizzle completion --shell powershell >> $PROFILE
```

See the [Shell Completions Guide](../guides/shell-completions.md) for detailed installation instructions.

### `sign`

Sign a migration artifact.

```bash
squizzle sign <version> [options]

Arguments:
  version           Version to sign

Options:
  --provider        Signature provider           [string] [default: "sigstore"]
  --key             Private key path             [string]
```

Example:
```bash
# Sign with Sigstore
squizzle sign 1.0.0

# Sign with custom key
squizzle sign 1.0.0 --key ./private-key.pem
```

### `tag`

Tag a version in the registry.

```bash
squizzle tag <version> <tag> [options]

Arguments:
  version           Version to tag
  tag               Tag name

Options:
  --force, -f       Overwrite existing tag       [boolean]
  --registry, -r    Registry URL                 [string]
```

Example:
```bash
# Tag as latest
squizzle tag 1.0.0 latest

# Tag for environment
squizzle tag 1.0.0 production --force

# Tag in specific registry
squizzle tag 1.0.0 stable --registry ghcr.io/myorg/migrations
```

### `compare`

Compare environments.

```bash
squizzle compare <env1> <env2> [options]

Arguments:
  env1              First environment
  env2              Second environment

Options:
  --detailed        Show detailed differences    [boolean]
```

Example:
```bash
# Compare environments
squizzle compare staging production

# Detailed comparison
squizzle compare development production --detailed
```

## Configuration File

Example configuration file:

```javascript
// squizzle.config.js
module.exports = {
  // Database driver
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
    }
  },

  // Storage backend
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: 'myorg/migrations',
      auth: {
        username: process.env.GITHUB_USER,
        password: process.env.GITHUB_TOKEN
      }
    }
  },

  // Security settings
  security: {
    enabled: true,
    provider: 'sigstore',
    requireSignature: process.env.NODE_ENV === 'production'
  },

  // File paths
  paths: {
    drizzle: './db/drizzle',
    custom: './db/squizzle',
    rollback: './db/rollback',
    seed: './db/seed'
  },

  // Build options
  build: {
    compression: 'gzip',
    outputDir: './db/tarballs'
  },

  // Apply options
  apply: {
    timeout: 30000,
    stopOnError: true
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SQUIZZLE_CONFIG` | Config file path | `./squizzle.config.js` |
| `SQUIZZLE_ENV` | Environment name | `development` |
| `SQUIZZLE_LOG_LEVEL` | Log verbosity | `info` |
| `SQUIZZLE_NO_COLOR` | Disable colors | `false` |
| `SQUIZZLE_REGISTRY` | Default registry | From config |
| `SQUIZZLE_TIMEOUT` | Default timeout | `30000` |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Connection error |
| 4 | Authentication error |
| 5 | Version conflict |
| 6 | Checksum mismatch |
| 7 | Rollback failed |
| 8 | Lock timeout |

## Next Steps

- [Configuration Schema](./config.md) - Configuration options
- [API Reference](./api.md) - Programmatic usage
- [Examples](../../examples/) - Example projects