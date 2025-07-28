# Installation

SQUIZZLE can be installed via npm, yarn, or pnpm.

## Prerequisites

- Node.js 16 or higher
- npm, yarn, or pnpm
- A supported database (currently PostgreSQL)
- Access to an OCI registry (Docker Hub, ghcr.io, etc.) for storing migration artifacts

## Global Installation

Install the CLI globally for use across all projects:

```bash
# npm
npm install -g @squizzle/cli

# yarn
yarn global add @squizzle/cli

# pnpm
pnpm add -g @squizzle/cli
```

## Project Installation

Add SQUIZZLE to your project:

```bash
# npm
npm install --save-dev @squizzle/cli @squizzle/core

# yarn
yarn add -D @squizzle/cli @squizzle/core

# pnpm
pnpm add -D @squizzle/cli @squizzle/core
```

## Database Drivers

Install the appropriate driver for your database:

### PostgreSQL

```bash
npm install @squizzle/postgres
```

## Storage Backends

Install the storage backend for your artifact registry:

### OCI Registry (Docker Hub, ghcr.io, etc.)

```bash
npm install @squizzle/oci
```

## Security (Optional)

For Sigstore signing support:

```bash
npm install @squizzle/security
```

## Verify Installation

Check that SQUIZZLE is installed correctly:

```bash
squizzle --version
```

## Next Steps

- [Configuration](./configuration.md) - Set up your squizzle.config.js
- [Your First Migration](./first-migration.md) - Create and apply your first migration