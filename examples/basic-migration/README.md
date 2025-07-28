# Basic Migration Example

This example demonstrates a basic SQUIZZLE setup with simple SQL migrations.

## Setup

```bash
# Install dependencies
npm install

# Initialize SQUIZZLE
npx squizzle init
```

## Project Structure

```
basic-migration/
├── db/
│   ├── squizzle/          # Custom SQL migrations
│   │   ├── 01_tables.sql
│   │   ├── 02_indexes.sql
│   │   └── 03_functions.sql
│   └── rollback/          # Rollback scripts
│       ├── 01_rollback_tables.sql
│       ├── 02_rollback_indexes.sql
│       └── 03_rollback_functions.sql
├── squizzle.config.js     # Configuration
├── package.json
└── README.md
```

## Configuration

```javascript
// squizzle.config.js
module.exports = {
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/example'
    }
  },
  storage: {
    type: 'local',
    config: {
      path: './db/artifacts'
    }
  }
}
```

## Usage

### 1. Create migrations

```sql
-- db/squizzle/01_tables.sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Create rollback scripts

```sql
-- db/rollback/01_rollback_tables.sql
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;
```

### 3. Build and apply

```bash
# Build version 1.0.0
npx squizzle build 1.0.0 --notes "Initial schema"

# Apply the migration
npx squizzle apply 1.0.0

# Check status
npx squizzle status
```

### 4. Rollback if needed

```bash
npx squizzle rollback 1.0.0
```

## Next Steps

- Add more complex migrations
- Set up CI/CD integration
- Configure production storage (OCI registry)