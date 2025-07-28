# Immutable Artifacts

SQUIZZLE treats database migrations as immutable, versioned artifacts that can never be changed once created.

## Why Immutability Matters

Traditional migration tools store SQL files in your repository that can be edited after deployment:

```sql
-- migrations/001_create_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT  -- Oops, forgot UNIQUE constraint!
);
```

Developers might be tempted to "fix" this file:

```sql
-- migrations/001_create_users.sql (edited)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE  -- Fixed!
);
```

This creates inconsistency - databases that already ran the migration have different schemas than new deployments.

## The SQUIZZLE Approach

SQUIZZLE prevents this by:

1. **Building artifacts** - Migrations are packaged into versioned tarballs
2. **Generating checksums** - Each artifact has a SHA256 checksum
3. **Storing externally** - Artifacts live in OCI registries, not your repo
4. **Verifying integrity** - Checksums are verified before applying

## Artifact Structure

A SQUIZZLE artifact is a compressed tarball containing:

```
squizzle-v1.0.0.tar.gz
├── manifest.json          # Metadata and checksums
├── drizzle/              # Drizzle-generated migrations
│   ├── 0001_initial.sql
│   └── 0002_add_email_index.sql
├── squizzle/             # Custom migrations
│   ├── 01_functions.sql
│   └── 02_triggers.sql
└── rollback/             # Rollback scripts
    └── 01_rollback.sql
```

## Manifest File

Each artifact includes a manifest with:

```json
{
  "version": "1.0.0",
  "previousVersion": "0.9.0",
  "created": "2024-01-15T10:30:00Z",
  "checksum": "a3f5d8c2b1e4f7d9c6a8b3e5f2d4e7a9...",
  "checksumAlgorithm": "sha256",
  "signature": "MEUCIQDaHR...",  // Optional Sigstore signature
  "drizzleKit": "0.20.0",
  "engineVersion": "1.0.0",
  "notes": "Add user authentication tables",
  "author": "john.doe@company.com",
  "files": [
    {
      "path": "drizzle/0001_initial.sql",
      "checksum": "b4e6f9d3...",
      "size": 1024,
      "type": "drizzle"
    }
  ],
  "platform": {
    "os": "darwin",
    "arch": "arm64", 
    "node": "18.17.0"
  }
}
```

## Checksum Verification

Before applying any migration, SQUIZZLE:

1. Downloads the artifact from the registry
2. Calculates the SHA256 checksum
3. Compares with the manifest checksum
4. Verifies individual file checksums
5. Only proceeds if all match

```bash
$ squizzle apply 1.0.0
✓ Pulling version 1.0.0...
✓ Verifying integrity...
  ✓ Artifact checksum: a3f5d8c2... ✓
  ✓ File checksums: 4/4 valid
✓ Applying migrations...
```

## Benefits

### 1. Consistency
Every environment gets the exact same migrations.

### 2. Auditability
Complete history of what was deployed when:
```bash
$ squizzle history
1.0.0 - 2024-01-15 - a3f5d8c2... - Add user auth
0.9.0 - 2024-01-10 - b4e6f9d3... - Initial schema
```

### 3. Rollback Safety
Can always retrieve and apply the exact rollback scripts that shipped with a version.

### 4. Supply Chain Security
With Sigstore integration, verify who built each artifact and when.

### 5. Distribution
Artifacts can be cached, mirrored, and distributed through standard OCI registries.

## Comparison with Git

While you could achieve some immutability with Git tags, SQUIZZLE provides:

- **Stronger guarantees** - Git history can be rewritten
- **Better distribution** - OCI registries are designed for artifacts
- **Built-in verification** - Checksums are part of the workflow
- **Metadata richness** - More than just commit messages

## Working with Immutability

### Making Changes

Since you can't edit existing migrations:

1. Create a new migration file
2. Build a new version
3. Apply the new version

```bash
# Wrong: Edit existing migration
# Right: Create new migration
echo "ALTER TABLE users ADD COLUMN phone TEXT;" > db/squizzle/03_add_phone.sql
squizzle build 1.1.0 --notes "Add phone column to users"
squizzle apply 1.1.0
```

### Handling Mistakes

If a migration has errors:

1. **Before pushing** - Rebuild with the same version
2. **After pushing** - Create a fix in a new version
3. **After applying** - Use rollback, then new version

## Best Practices

1. **Review before building** - Can't change after
2. **Test locally** - Catch errors early
3. **Use semantic versioning** - Communicate change impact
4. **Write good notes** - Your future self will thank you
5. **Include rollbacks** - Plan for reversibility

## Next Steps

- [Version Management](./versions.md) - Semantic versioning for schemas
- [Security Model](./security.md) - Signing and verification
- [Storage Backends](./storage.md) - OCI registries