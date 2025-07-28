# @squizzle/oci

OCI (Open Container Initiative) registry storage backend for SQUIZZLE artifacts.

## Installation

```bash
npm install @squizzle/oci
```

## Overview

Store your database migrations in any OCI-compliant registry:
- Docker Hub
- GitHub Container Registry (ghcr.io)
- Amazon Elastic Container Registry (ECR)
- Google Container Registry (GCR)
- Azure Container Registry (ACR)
- Self-hosted registries (Harbor, etc.)

## Usage

```typescript
import { createOCIStorage } from '@squizzle/oci'
import { MigrationEngine } from '@squizzle/core'

const storage = createOCIStorage({
  registry: 'ghcr.io',
  repository: 'myorg/migrations'
})

const engine = new MigrationEngine({
  storage,
  // ... other options
})
```

## Configuration

```typescript
interface OCIStorageOptions {
  registry: string      // Registry hostname
  repository?: string   // Repository name (default: 'squizzle-artifacts')
  username?: string     // Registry username
  password?: string     // Registry password
  insecure?: boolean   // Allow insecure registries
}
```

## Authentication

### Docker Hub

```typescript
const storage = createOCIStorage({
  registry: 'docker.io',
  repository: 'myuser/migrations',
  username: process.env.DOCKER_USERNAME,
  password: process.env.DOCKER_PASSWORD
})
```

### GitHub Container Registry

```typescript
const storage = createOCIStorage({
  registry: 'ghcr.io',
  repository: 'myorg/migrations',
  username: process.env.GITHUB_ACTOR,
  password: process.env.GITHUB_TOKEN
})
```

### Amazon ECR

```typescript
// First, get ECR token
const token = await getECRAuthToken()

const storage = createOCIStorage({
  registry: '123456789.dkr.ecr.us-east-1.amazonaws.com',
  repository: 'migrations',
  username: 'AWS',
  password: token
})
```

### Using Docker Config

If already logged in via `docker login`:

```typescript
const storage = createOCIStorage({
  registry: 'ghcr.io',
  repository: 'myorg/migrations'
  // Credentials read from ~/.docker/config.json
})
```

## How It Works

1. **Build**: Creates a tarball of your migrations
2. **Package**: Creates a minimal Docker image containing the artifact
3. **Push**: Uses Docker API to push to OCI registry
4. **Pull**: Downloads image and extracts artifact
5. **Extract**: Unpacks migrations for application

Note: This implementation uses the Docker API to store artifacts in OCI registries. For a pure OCI artifact approach, you can use the ORAS CLI tool separately.

### Artifact Structure

```
migrations:v1.0.0
├── manifest.json       # SQUIZZLE manifest
├── artifact.tar.gz    # Migration files
└── signatures/        # Sigstore signatures (if enabled)
```

### Tags

Each version gets multiple tags:
- `v1.0.0` - Exact version
- `v1.0` - Minor version (latest patch)
- `v1` - Major version (latest minor)
- `latest` - Most recent version

## Operations

### Push Artifact

```typescript
const artifact = await buildArtifact(version)
const url = await storage.push(version, artifact, manifest)
// Returns: ghcr.io/myorg/migrations:v1.0.0
```

### Pull Artifact

```typescript
const { artifact, manifest } = await storage.pull('1.0.0')
// Verifies checksum automatically
```

### List Versions

```typescript
const versions = await storage.list()
// Returns: ['1.0.0', '1.0.1', '1.1.0']
```

### Check Existence

```typescript
const exists = await storage.exists('1.0.0')
// Returns: true/false
```

### Delete Version

```typescript
await storage.delete('1.0.0')
// Removes from registry (if permissions allow)
```

## Registry Examples

### GitHub Actions

```yaml
- name: Push Migration
  run: |
    squizzle build ${{ github.sha }}
    squizzle push ${{ github.sha }}
  env:
    SQUIZZLE_REGISTRY: ghcr.io
    SQUIZZLE_REPOSITORY: ${{ github.repository }}/migrations
    SQUIZZLE_USERNAME: ${{ github.actor }}
    SQUIZZLE_PASSWORD: ${{ secrets.GITHUB_TOKEN }}
```

### GitLab CI

```yaml
push:
  script:
    - squizzle build $CI_COMMIT_SHA
    - squizzle push $CI_COMMIT_SHA
  variables:
    SQUIZZLE_REGISTRY: $CI_REGISTRY
    SQUIZZLE_REPOSITORY: $CI_PROJECT_PATH/migrations
    SQUIZZLE_USERNAME: $CI_REGISTRY_USER
    SQUIZZLE_PASSWORD: $CI_REGISTRY_PASSWORD
```

### Local Registry

```typescript
const storage = createOCIStorage({
  registry: 'localhost:5000',
  repository: 'migrations',
  insecure: true // For testing only!
})
```

## Security

### Checksum Verification

All artifacts include SHA256 checksums that are verified on pull:

```typescript
// Automatic verification
const { artifact } = await storage.pull('1.0.0')

// Manual verification
const checksum = createHash('sha256').update(artifact).digest('hex')
assert(checksum === manifest.checksum)
```

### Signature Support

When used with @squizzle/security, artifacts are signed:

```typescript
// Push with signature
await storage.push(version, artifact, signedManifest)

// Pull verifies signature
const { manifest } = await storage.pull(version)
```

## Advantages

1. **Immutable**: Registry tags are immutable by design
2. **Versioned**: Natural version management with tags
3. **Distributed**: Use existing registry infrastructure
4. **Secure**: Built-in auth, RBAC, and scanning
5. **Cached**: Registries provide global CDN caching
6. **Auditable**: Full audit logs of who pushed what

## Troubleshooting

### Authentication Failed

```bash
# Test docker login first
docker login ghcr.io -u USERNAME -p TOKEN

# Check credentials
echo $SQUIZZLE_USERNAME
echo $SQUIZZLE_PASSWORD | wc -c  # Check not empty
```

### Registry Not Found

```bash
# Verify registry URL
nslookup ghcr.io
curl https://ghcr.io/v2/
```

### Permission Denied

Ensure your token has required scopes:
- `read:packages` - For pulling
- `write:packages` - For pushing
- `delete:packages` - For cleanup

## License

MIT