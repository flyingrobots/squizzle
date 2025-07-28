# Drizzle ORM Integration Example

This example shows how to use SQUIZZLE with Drizzle ORM for type-safe schema management.

## Setup

```bash
# Install dependencies
npm install

# Initialize SQUIZZLE
npx squizzle init
```

## Project Structure

```
with-drizzle/
├── src/
│   └── db/
│       ├── schema.ts      # Drizzle schema definitions
│       └── client.ts      # Database client
├── db/
│   ├── drizzle/          # Drizzle-generated migrations
│   ├── squizzle/         # Custom migrations
│   └── rollback/         # Rollback scripts
├── drizzle.config.ts     # Drizzle configuration
├── squizzle.config.js    # SQUIZZLE configuration
├── package.json
└── README.md
```

## Schema Definition

```typescript
// src/db/schema.ts
import { pgTable, serial, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
})

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  title: text('title').notNull(),
  content: text('content'),
  published: boolean('published').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
})
```

## Drizzle Configuration

```typescript
// drizzle.config.ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './db/drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!
  }
} satisfies Config
```

## SQUIZZLE Configuration

```javascript
// squizzle.config.js
module.exports = {
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL
    }
  },
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
  paths: {
    drizzle: './db/drizzle',
    custom: './db/squizzle',
    rollback: './db/rollback'
  }
}
```

## Workflow

### 1. Make schema changes

```typescript
// Add a new column to users
export const users = pgTable('users', {
  // ... existing columns
  avatarUrl: text('avatar_url'), // New column
})
```

### 2. Generate Drizzle migrations

```bash
npx drizzle-kit generate:pg
```

### 3. Add custom migrations (optional)

```sql
-- db/squizzle/01_triggers.sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 4. Build and apply

```bash
# Build migration
npx squizzle build 1.1.0 --notes "Add avatar URL and update triggers"

# Apply to database
npx squizzle apply 1.1.0
```

### 5. Use in application

```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export const db = drizzle(pool, { schema })

// Usage
const allUsers = await db.select().from(schema.users)
const activeUsers = await db.select()
  .from(schema.users)
  .where(eq(schema.users.isActive, true))
```

## Best Practices

1. **Version incrementally** - Use semantic versioning
2. **Test migrations** - Always test in development first
3. **Include rollbacks** - Plan for reversibility
4. **Document changes** - Use clear migration notes
5. **Type safety** - Leverage Drizzle's TypeScript types

## Scripts

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate:pg",
    "db:build": "squizzle build",
    "db:apply": "squizzle apply",
    "db:status": "squizzle status",
    "db:push": "drizzle-kit push:pg"
  }
}
```

## CI/CD Integration

```yaml
# .github/workflows/migrate.yml
name: Database Migrations

on:
  push:
    branches: [main]
    paths:
      - 'src/db/schema.ts'
      - 'db/**'

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18
          
      - name: Install dependencies
        run: npm ci
        
      - name: Generate migrations
        run: npm run db:generate
        
      - name: Build migration
        run: |
          VERSION=$(date +%Y.%m.%d)-${{ github.run_number }}
          npx squizzle build $VERSION --notes "${{ github.event.head_commit.message }}"
          
      - name: Apply to production
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
        run: npx squizzle apply $VERSION
```