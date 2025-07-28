# @squizzle/security

Supply chain security for SQUIZZLE migrations using Sigstore.

## Installation

```bash
npm install @squizzle/security
```

## Overview

Provides cryptographic signing and verification for migration artifacts:
- **Keyless signing** with Sigstore
- **Transparency logs** with Rekor
- **SLSA provenance** generation
- **Checksum verification** (SHA256/SHA512)
- **Certificate-based identity** verification

## Usage

```typescript
import { createSigstoreProvider } from '@squizzle/security'
import { MigrationEngine } from '@squizzle/core'

const security = createSigstoreProvider({
  fulcioURL: 'https://fulcio.sigstore.dev',
  rekorURL: 'https://rekor.sigstore.dev'
})

const engine = new MigrationEngine({
  security,
  // ... other options
})
```

## Features

### Keyless Signing

No need to manage keys - uses OIDC identity:

```typescript
// Signing happens automatically during build
await engine.build('1.0.0', {
  notes: 'Security-critical update'
})

// Creates:
// - artifact.tar.gz
// - artifact.tar.gz.sig (signature)
// - artifact.tar.gz.cert (certificate)
```

### Verification

Signatures are verified automatically:

```typescript
// Throws if signature invalid
await engine.apply('1.0.0')

// Manual verification
const valid = await security.verify(artifact, signature)
```

### SLSA Provenance

Generates supply chain metadata:

```typescript
const manifest = await engine.build('1.0.0')

console.log(manifest.slsa)
// {
//   builderId: "github.com/myorg/repo/.github/workflows/build.yml",
//   buildType: "https://github.com/slsa-framework/slsa-github-generator/...",
//   invocation: { ... },
//   materials: [ ... ]
// }
```

## Configuration

### Basic Setup

```typescript
const security = createSigstoreProvider({
  // Use public good instance (default)
  fulcioURL: 'https://fulcio.sigstore.dev',
  rekorURL: 'https://rekor.sigstore.dev'
})
```

### Private Sigstore

```typescript
const security = createSigstoreProvider({
  // Private instance
  fulcioURL: 'https://fulcio.internal.company.com',
  rekorURL: 'https://rekor.internal.company.com',
  
  // Custom CA certificate
  fulcioCA: fs.readFileSync('./fulcio-ca.pem'),
  rekorPublicKey: fs.readFileSync('./rekor-pub.pem')
})
```

### Local Development

```typescript
const security = createLocalProvider({
  // Uses local keys for development
  privateKey: fs.readFileSync('./dev-key.pem'),
  publicKey: fs.readFileSync('./dev-key.pub')
})
```

## Identity Providers

Sigstore supports various OIDC providers:

### GitHub Actions

```yaml
permissions:
  id-token: write  # Required for OIDC

steps:
  - name: Sign and Push
    run: |
      squizzle build ${{ github.sha }}
      squizzle push ${{ github.sha }}
```

### GitLab CI

```yaml
sign:
  id_tokens:
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  script:
    - squizzle build $CI_COMMIT_SHA
```

### Google Cloud

```typescript
// Workload Identity Federation
const security = createSigstoreProvider({
  identityToken: await getGoogleIdentityToken()
})
```

## Verification Policies

### Verify Signer Identity

```typescript
const security = createSigstoreProvider({
  verification: {
    // Only accept signatures from specific identities
    certificateIdentities: [
      {
        issuer: 'https://github.com/login/oauth',
        subject: 'repo:myorg/myrepo:ref:refs/heads/main'
      }
    ]
  }
})
```

### Verify Certificate Extensions

```typescript
const security = createSigstoreProvider({
  verification: {
    // Require specific workflow
    certificateExtensions: {
      'github-workflow-ref': '.github/workflows/release.yml'
    }
  }
})
```

## Checksum Algorithms

### SHA256 (Default)

```typescript
const security = createSigstoreProvider({
  checksumAlgorithm: 'sha256'
})
```

### SHA512

```typescript
const security = createSigstoreProvider({
  checksumAlgorithm: 'sha512'
})
```

### Multiple Algorithms

```typescript
// Generate both for compatibility
const security = createSigstoreProvider({
  checksumAlgorithm: ['sha256', 'sha512']
})
```

## CLI Integration

### Sign During Build

```bash
# Automatically signs if security configured
squizzle build 1.0.0 --sign
```

### Verify Artifact

```bash
# Verify before applying
squizzle verify 1.0.0

# Output:
# ✓ Checksum valid: sha256:abc123...
# ✓ Signature valid: Signed by repo:myorg/myrepo
# ✓ Transparency log: Entry at index 12345678
```

### Export Signatures

```bash
# Export for offline verification
squizzle export-sig 1.0.0 -o v1.0.0.bundle
```

## Offline Verification

For air-gapped environments:

```typescript
import { createOfflineVerifier } from '@squizzle/security'

const verifier = createOfflineVerifier({
  // Trusted root certificates
  trustedRoots: fs.readFileSync('./trusted-roots.json'),
  
  // Rekor public key
  rekorPublicKey: fs.readFileSync('./rekor.pub'),
  
  // Time of verification (for cert validity)
  time: new Date('2024-01-15')
})

const valid = await verifier.verify(artifact, bundle)
```

## Troubleshooting

### No OIDC Token

```bash
# GitHub Actions - check permissions
permissions:
  id-token: write

# Local development - use ambient credentials
export SIGSTORE_ID_TOKEN=$(gcloud auth print-identity-token)
```

### Certificate Expired

Certificates are valid for 10 minutes:
```typescript
// Build and push immediately
const version = await engine.build('1.0.0')
await storage.push(version) // Do this within 10 minutes
```

### Verification Failed

Check certificate details:
```bash
# Inspect certificate
openssl x509 -in artifact.cert -text -noout

# Check transparency log
rekor-cli get --log-index 12345678
```

## Best Practices

1. **Always verify in production**:
   ```typescript
   const engine = new MigrationEngine({
     security: createSigstoreProvider(),
     requireSignatures: true // Fail if not signed
   })
   ```

2. **Pin certificate identities**:
   ```typescript
   // Only accept releases from main branch
   verification: {
     certificateIdentities: [{
       subject: 'repo:myorg/myrepo:ref:refs/heads/main'
     }]
   }
   ```

3. **Monitor transparency logs**:
   ```typescript
   // Log Rekor entries for audit
   engine.on('verified', (event) => {
     console.log('Rekor index:', event.logIndex)
   })
   ```

## License

MIT