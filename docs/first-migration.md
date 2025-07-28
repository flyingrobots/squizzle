# Your First Migration

This guide walks you through creating and applying your first migration with SQUIZZLE.

## Prerequisites

- SQUIZZLE installed and configured
- A PostgreSQL database
- Drizzle ORM (if using Drizzle migrations)

## Step 1: Initialize SQUIZZLE

Initialize SQUIZZLE in your project:

```bash
squizzle init
```

This creates:
- `squizzle.config.js` - Configuration file
- `db/drizzle/` - Directory for Drizzle migrations
- `db/squizzle/` - Directory for custom SQL migrations
- `db/rollback/` - Directory for rollback scripts
- `.squizzle/` - Working directory (add to .gitignore)

## Step 2: Create Your Schema

If using Drizzle ORM, define your schema:

```typescript
// lib/db/schema.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
})
```

## Step 3: Generate Migrations

Generate Drizzle migrations:

```bash
npx drizzle-kit generate:pg
```

This creates SQL files in `db/drizzle/`:
```
db/drizzle/
├── 0000_initial.sql
└── meta/
    └── 0000_snapshot.json
```

## Step 4: Add Custom Migrations (Optional)

Add custom SQL migrations in `db/squizzle/`:

```sql
-- db/squizzle/01_functions.sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- db/squizzle/02_triggers.sql
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
```

## Step 5: Add Rollback Scripts (Optional)

Create rollback scripts in `db/rollback/`:

```sql
-- db/rollback/01_rollback_functions.sql
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

-- db/rollback/02_rollback_triggers.sql
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
```

## Step 6: Build the Migration

Build your migration into an immutable artifact:

```bash
squizzle build 1.0.0 --notes "Initial schema with users table"
```

Options:
- `--notes` - Description of changes
- `--author` - Override author (defaults to current user)
- `--dry-run` - Preview without building

Output:
```
✓ Generating Drizzle migrations...
✓ Collecting migration files...
✓ Creating manifest...
✓ Creating artifact...
✓ Build complete!

Version 1.0.0 built successfully
  Files: 4
  Checksum: a3f5d8c2...
  Location: db/tarballs/squizzle-v1.0.0.tar.gz
```

## Step 7: Push to Registry

Push the artifact to your OCI registry:

```bash
squizzle push 1.0.0
```

This uploads the migration artifact to your configured registry.

## Step 8: Apply the Migration

Apply the migration to your database:

```bash
squizzle apply 1.0.0
```

Options:
- `--dry-run` - Preview SQL without executing
- `--force` - Skip safety checks
- `--timeout` - Set lock timeout (default: 30s)

Output:
```
✓ Pulling version 1.0.0...
✓ Verifying integrity...
✓ Acquiring lock...
✓ Applying migrations...
  ✓ drizzle/0000_initial.sql
  ✓ squizzle/01_functions.sql
  ✓ squizzle/02_triggers.sql
✓ Recording version...
✓ Successfully applied version 1.0.0
```

## Step 9: Verify Status

Check the migration status:

```bash
squizzle status
```

Output:
```
Current version: 1.0.0
Applied at: 2024-01-15 10:30:00
Applied by: john.doe

Applied versions:
  1.0.0 - 2024-01-15 10:30:00 - Initial schema with users table

Available versions:
  1.0.0 ✓
```

## Working with Rollbacks

If you need to rollback:

```bash
squizzle rollback 1.0.0
```

This executes the rollback scripts in reverse order.

## Best Practices

1. **Always test locally** - Apply migrations to a local database first
2. **Use semantic versioning** - Follow major.minor.patch convention
3. **Write rollback scripts** - Plan for reversibility
4. **Document changes** - Use descriptive notes
5. **Review before applying** - Use `--dry-run` to preview

## Troubleshooting

### Migration Already Applied

```
Error: Version 1.0.0 already applied
```

Check status with `squizzle status`. Use `--force` to reapply if needed.

### Lock Timeout

```
Error: Could not acquire lock within 30s
```

Another migration might be running. Wait or increase timeout:
```bash
squizzle apply 1.0.0 --timeout 60
```

### Checksum Mismatch

```
Error: Checksum mismatch: expected a3f5d8c2..., got b4e6f9d3...
```

The artifact has been tampered with. Re-pull or rebuild.

## Next Steps

- [CI/CD Integration](./guides/cicd.md) - Automate migrations
- [Multi-Environment Setup](./guides/environments.md) - Dev/staging/prod
- [Rollback Strategies](./guides/rollbacks.md) - Safe rollbacks