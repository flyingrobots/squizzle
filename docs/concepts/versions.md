# Version Management

SQUIZZLE uses semantic versioning to manage database schema versions, providing clear communication about the nature and impact of changes.

## Semantic Versioning for Databases

SQUIZZLE follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (X.0.0) - Breaking schema changes
- **MINOR** (0.X.0) - Backward-compatible additions
- **PATCH** (0.0.X) - Backward-compatible fixes

### Examples

```bash
1.0.0 -> 2.0.0  # Dropped a column (breaking)
1.0.0 -> 1.1.0  # Added a table (compatible)
1.1.0 -> 1.1.1  # Fixed an index (compatible)
```

## What Constitutes Each Version Type

### Major Version (Breaking Changes)

Increment MAJOR when you:
- Drop tables, columns, or constraints
- Rename tables or columns
- Change column types incompatibly
- Remove enum values
- Change function signatures

```sql
-- Version 2.0.0: Breaking change
ALTER TABLE users DROP COLUMN legacy_field;
ALTER TABLE orders ALTER COLUMN total TYPE DECIMAL(10,2);
```

### Minor Version (New Features)

Increment MINOR when you:
- Add new tables
- Add nullable columns
- Add new indexes
- Add new functions/procedures
- Add enum values

```sql
-- Version 1.1.0: New feature
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  token TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN phone TEXT;
```

### Patch Version (Fixes)

Increment PATCH when you:
- Fix incorrect constraints
- Optimize indexes
- Fix function logic
- Add missing defaults

```sql
-- Version 1.0.1: Bug fix
DROP INDEX idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users(lower(email));
```

## Version Constraints

SQUIZZLE enforces version ordering:

```bash
$ squizzle apply 1.2.0
Error: Cannot apply 1.2.0 - current version is 1.3.0

$ squizzle apply 2.0.0
✓ Applying version 2.0.0 (upgrade from 1.3.0)
```

## Version Dependencies

Specify dependencies in your build:

```javascript
// squizzle.config.js
module.exports = {
  build: {
    dependencies: ['1.0.0', '1.1.0'],  // Requires these versions
    conflicts: ['2.0.0-beta']          // Cannot coexist
  }
}
```

## Pre-release Versions

Support for pre-release versions:

```bash
# Alpha/Beta releases
squizzle build 2.0.0-alpha.1
squizzle build 2.0.0-beta.1

# Release candidates
squizzle build 2.0.0-rc.1
```

Pre-release precedence:
```
1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0-rc.1 < 1.0.0
```

## Build Metadata

Add build metadata for traceability:

```bash
squizzle build 1.0.0+build.123
squizzle build 1.0.0+git.sha.a3f5d8c2
```

Metadata doesn't affect version precedence.

## Version History

Track version history:

```bash
$ squizzle history
Version  Applied              Status   Notes
2.0.0    2024-01-20 14:30:00  ✓       Major refactor of user system
1.2.1    2024-01-18 10:15:00  ✓       Fix user email index
1.2.0    2024-01-15 09:00:00  ✓       Add analytics tables
1.1.0    2024-01-10 16:45:00  ✓       Add user profiles
1.0.0    2024-01-05 11:30:00  ✓       Initial schema
```

## Version Rollback

Rollback creates a new version:

```bash
$ squizzle rollback 2.0.0
✓ Applied rollback-2.0.0-1705759800

$ squizzle status
Current version: rollback-2.0.0-1705759800
Previous version: 2.0.0
```

## Version Planning

### Version Roadmap

Plan versions in advance:

```yaml
# db/VERSIONS.md
## Upcoming Versions

### 2.0.0 (Q1 2024)
- [ ] Remove deprecated user_profiles table
- [ ] Rename email to email_address
- [ ] Change all timestamps to timestamptz

### 1.3.0 (February 2024)
- [ ] Add multi-tenant support
- [ ] Add audit_logs table
- [ ] Add row-level security

### 1.2.2 (Next patch)
- [ ] Fix performance issue in user search
- [ ] Add missing index on created_at
```

### Deprecation Notices

Communicate upcoming breaking changes:

```sql
-- Version 1.2.0: Add deprecation notice
COMMENT ON COLUMN users.legacy_field IS 
  'DEPRECATED: Will be removed in 2.0.0. Use new_field instead.';

-- Version 1.3.0: Add compatibility view
CREATE VIEW users_compat AS 
  SELECT *, new_field AS legacy_field FROM users;
```

## Version Comparison

Compare versions:

```bash
$ squizzle diff 1.0.0 1.1.0
Added tables:
  + user_profiles
  + user_sessions

Added columns:
  + users.phone
  + users.avatar_url

$ squizzle diff 1.0.0 2.0.0
Breaking changes:
  - Dropped users.legacy_field
  - Changed orders.total type
```

## Best Practices

### 1. Plan Major Versions

- Announce well in advance
- Provide migration guides
- Consider compatibility layers

### 2. Batch Minor Changes

- Group related features
- Release regularly
- Avoid too many minor versions

### 3. Minimize Patches

- Test thoroughly before release
- Use patches only for fixes
- Don't add features in patches

### 4. Document Changes

```sql
-- Version: 1.1.0
-- Author: john.doe@company.com  
-- Date: 2024-01-15
-- Changes:
--   - Add user_sessions for authentication
--   - Add phone column for 2FA
--   - Create indexes for performance
```

### 5. Version Tags

Tag your Git repository:

```bash
git tag -a v1.0.0 -m "Initial schema release"
git push origin v1.0.0
```

## Migration Strategies

### Rolling Upgrades

For zero-downtime deployments:

1. Make changes backward compatible
2. Deploy application changes
3. Apply database migration
4. Remove compatibility code

### Feature Flags

Control feature rollout:

```sql
-- Version 1.1.0: Add feature flag
ALTER TABLE organizations 
  ADD COLUMN features JSONB DEFAULT '{}';

-- Check in application
SELECT features->>'new_analytics' = 'true' 
  FROM organizations WHERE id = ?;
```

## Next Steps

- [Storage Backends](./storage.md) - Where versions are stored
- [CI/CD Integration](../guides/cicd.md) - Automated versioning
- [Multi-Environment Setup](../guides/environments.md) - Version per environment