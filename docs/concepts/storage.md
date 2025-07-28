# Storage Backends

SQUIZZLE stores migration artifacts in external storage systems, with OCI (Open Container Initiative) registries as the primary backend.

## Why External Storage?

Traditional migration tools keep SQL files in your repository. SQUIZZLE separates concerns:

- **Source code** → Git repository
- **Migration artifacts** → OCI registry
- **Applied versions** → Database

Benefits:
- Artifacts can't be accidentally edited
- Better access control and audit trails
- Efficient distribution and caching
- Works with existing container infrastructure

## OCI Registry Storage

### What is OCI?

OCI registries (like Docker Hub, GitHub Container Registry) store container images using a standard specification. SQUIZZLE leverages this for migration artifacts.

### Supported Registries

- Docker Hub (`docker.io`)
- GitHub Container Registry (`ghcr.io`)
- Google Container Registry (`gcr.io`)
- Amazon ECR (`[account].dkr.ecr.[region].amazonaws.com`)
- Azure Container Registry (`[name].azurecr.io`)
- Self-hosted (Harbor, Nexus, etc.)

### Configuration

```javascript
// squizzle.config.js
module.exports = {
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: 'myorg/squizzle-migrations',
      auth: {
        username: process.env.GITHUB_USER,
        password: process.env.GITHUB_TOKEN
      }
    }
  }
}
```

### How It Works

1. **Build** creates a tarball with migrations
2. **Push** uploads as an OCI artifact
3. **Pull** downloads when applying
4. **List** queries available versions

```bash
# Build and push
squizzle build 1.0.0
squizzle push 1.0.0

# On another machine/environment
squizzle pull 1.0.0
squizzle apply 1.0.0
```

### Registry URLs

Artifacts are stored at:
```
ghcr.io/myorg/squizzle-migrations:1.0.0
```

View in browser:
```
https://github.com/orgs/myorg/packages/container/squizzle-migrations
```

## Authentication

### Docker Hub

```bash
# Login with Docker CLI
docker login

# Or use token
export OCI_USERNAME=myuser
export OCI_PASSWORD=mytoken
```

### GitHub Container Registry

```bash
# Use personal access token
export OCI_USERNAME=github-username
export OCI_PASSWORD=ghp_xxxxxxxxxxxx

# Or use GITHUB_TOKEN in Actions
export OCI_PASSWORD=$GITHUB_TOKEN
```

### AWS ECR

```bash
# Get temporary token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789.dkr.ecr.us-east-1.amazonaws.com

# Or use IAM credentials
export AWS_PROFILE=myprofile
```

## Storage Organization

### Tagging Strategy

```bash
# Semantic versions
ghcr.io/myorg/migrations:1.0.0
ghcr.io/myorg/migrations:1.0.1
ghcr.io/myorg/migrations:1.1.0

# Latest stable
ghcr.io/myorg/migrations:latest

# Environment tags
ghcr.io/myorg/migrations:production
ghcr.io/myorg/migrations:staging
```

### Multi-Environment Setup

Separate repositories per environment:

```javascript
const registry = 'ghcr.io'
const environment = process.env.NODE_ENV

module.exports = {
  storage: {
    type: 'oci',
    config: {
      registry,
      repository: `myorg/migrations-${environment}`
    }
  }
}
```

Or use tag prefixes:

```bash
# Production
squizzle push 1.0.0 --tag prod-1.0.0

# Staging  
squizzle push 1.0.0 --tag staging-1.0.0
```

## Artifact Manifest

OCI artifacts include metadata:

```json
{
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.squizzle.config.v1+json",
    "digest": "sha256:a3f5d8c2...",
    "size": 1234
  },
  "layers": [
    {
      "mediaType": "application/vnd.squizzle.migrations.v1.tar+gzip",
      "digest": "sha256:b4e6f9d3...",
      "size": 5678,
      "annotations": {
        "org.squizzle.version": "1.0.0",
        "org.squizzle.created": "2024-01-15T10:30:00Z"
      }
    }
  ]
}
```

## Caching

SQUIZZLE caches pulled artifacts locally:

```
.squizzle/
├── cache/
│   ├── artifacts/
│   │   ├── 1.0.0.tar.gz
│   │   └── 1.1.0.tar.gz
│   └── manifests/
│       ├── 1.0.0.json
│       └── 1.1.0.json
└── config.json
```

Clear cache:
```bash
squizzle cache clear
```

## Access Control

### Repository Permissions

Configure registry access:

- **Read** - Pull and apply migrations
- **Write** - Push new versions
- **Admin** - Delete versions

### GitHub Container Registry

```yaml
# .github/workflows/migrations.yml
permissions:
  contents: read
  packages: write  # Push to ghcr.io
```

### Team Access

```bash
# Grant team access (GitHub)
gh api orgs/myorg/packages/container/migrations/permissions \
  -X PUT -f role=write -f team=database-team
```

## Backup and Recovery

### Registry Backup

Most registries provide:
- Geo-replication
- Automated backups
- High availability

### Local Backup

Keep local copies:

```bash
# Export specific version
squizzle export 1.0.0 --output backups/

# Export all versions
squizzle export --all --output backups/
```

### Disaster Recovery

```bash
# Restore from backup
squizzle import backups/squizzle-v1.0.0.tar.gz
squizzle push 1.0.0 --registry backup.registry.io
```

## Performance

### Pull Optimization

- Artifacts are compressed (gzip)
- Only changed files downloaded
- Local cache reduces transfers
- CDN distribution for registries

### Size Limits

- Docker Hub: 10GB per layer
- GitHub: 10GB per package version
- ECR: 10GB per image

Keep artifacts small:
```bash
# Check size before push
squizzle build 1.0.0 --dry-run
# Size: 1.2MB (15 files)
```

## Alternative Storage

While OCI is recommended, SQUIZZLE supports:

### S3-Compatible Storage

```javascript
storage: {
  type: 's3',
  config: {
    bucket: 'mycompany-squizzle',
    region: 'us-east-1',
    prefix: 'migrations/'
  }
}
```

### Local Filesystem

For development only:

```javascript
storage: {
  type: 'local',
  config: {
    path: './db/artifacts'
  }
}
```

## Best Practices

### 1. Use Dedicated Repositories

Don't mix with application images:
```
✓ ghcr.io/myorg/app
✓ ghcr.io/myorg/app-migrations
✗ ghcr.io/myorg/everything
```

### 2. Tag Consistently

```bash
# Version tags
squizzle push 1.0.0

# Environment promotion
squizzle tag 1.0.0 staging
squizzle tag 1.0.0 production
```

### 3. Enable Vulnerability Scanning

Most registries scan for security issues:
- GitHub: Enabled by default
- ECR: Enable scan on push
- Harbor: Built-in scanning

### 4. Set Retention Policies

Clean up old versions:

```yaml
# GitHub Actions
- name: Delete old versions
  uses: actions/delete-package-versions@v4
  with:
    package-name: migrations
    min-versions-to-keep: 10
```

### 5. Monitor Usage

Track storage and bandwidth:
```bash
# GitHub CLI
gh api user/packages/container/migrations

# Docker Hub
curl -H "Authorization: Bearer $TOKEN" \
  https://hub.docker.com/v2/repositories/myorg/migrations/
```

## Troubleshooting

### Authentication Failed

```
Error: authentication required
```

Check credentials:
```bash
docker login ghcr.io
squizzle config validate
```

### Rate Limits

```
Error: rate limit exceeded
```

Docker Hub limits anonymous pulls. Authenticate or use paid plan.

### Network Issues

```
Error: timeout pulling artifact
```

Try:
- Check network connectivity
- Use closer registry region
- Increase timeout: `squizzle pull 1.0.0 --timeout 300`

## Next Steps

- [Security Model](./security.md) - Signing artifacts
- [CI/CD Integration](../guides/cicd.md) - Automated pushes
- [Multi-Environment Setup](../guides/environments.md) - Registry strategies