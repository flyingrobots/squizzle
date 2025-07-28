# NPM Publishing Guide for SQUIZZLE

This guide walks through publishing the SQUIZZLE monorepo packages to npm.

## Prerequisites

1. **NPM Account**: Create an account at https://www.npmjs.com/
2. **Login**: Run `npm login` and enter your credentials
3. **Permissions**: Ensure you have publish rights to the @squizzle scope

## Initial Setup

### 1. Claim the npm organization scope

```bash
# Create the organization on npm (one time only)
# Go to https://www.npmjs.com/org/create
# Create organization: squizzle
```

### 2. Configure Changesets (Recommended)

Since the repo uses changesets, let's set it up:

```bash
cd /Users/james/git/squizzle

# Initialize changesets config
pnpm changeset init
```

This will create `.changeset/config.json`. The default config should work fine.

### 3. Build all packages

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Publishing Process

### Option 1: Using Changesets (Recommended)

1. **Create a changeset**:
   ```bash
   pnpm changeset
   ```
   - Select which packages changed
   - Choose the version bump type (patch/minor/major)
   - Write a summary of changes

2. **Version packages**:
   ```bash
   pnpm changeset version
   ```
   This updates package.json versions and creates CHANGELOG.md files.

3. **Publish to npm**:
   ```bash
   pnpm changeset publish
   ```
   This publishes all changed packages to npm.

### Option 2: Manual Publishing

If you prefer to publish manually:

1. **Set package versions**:
   ```bash
   # Update version in each package.json
   # Since these are new packages, start with 0.1.0
   ```

2. **Publish each package**:
   ```bash
   # Publish in dependency order
   cd packages/squizzle-core
   npm publish --access public
   
   cd ../squizzle-postgres
   npm publish --access public
   
   cd ../squizzle-oci
   npm publish --access public
   
   cd ../squizzle-security
   npm publish --access public
   
   cd ../squizzle-cli
   npm publish --access public
   ```

## Important Notes

### Package Access

Since these are scoped packages (@squizzle/*), you need to publish with public access:
- First time: `npm publish --access public`
- Subsequent times: `npm publish`

### Version Strategy

- Start with `0.1.0` for initial release
- Use semantic versioning:
  - PATCH (0.1.1): Bug fixes
  - MINOR (0.2.0): New features (backwards compatible)
  - MAJOR (1.0.0): Breaking changes

### Pre-publish Checklist

- [ ] All tests pass: `pnpm test`
- [ ] TypeScript compiles: `pnpm typecheck`
- [ ] Linting passes: `pnpm lint`
- [ ] READMEs are complete
- [ ] package.json has all required fields:
  - name
  - version
  - description
  - main/types
  - repository
  - keywords
  - author
  - license

### Registry Configuration

If you need to configure the registry:

```bash
# Check current registry
npm config get registry

# Use default npm registry
npm config set registry https://registry.npmjs.org/
```

## Troubleshooting

### "You need to be logged in"
```bash
npm login
```

### "Scope not found"
You need to create the organization on npm first.

### "Package name too similar"
Add more specific names like `@squizzle/core` instead of just `squizzle-core`.

### "Cannot publish over existing version"
Bump the version number in package.json.

## After Publishing

1. **Verify packages**:
   ```bash
   npm view @squizzle/core
   npm view @squizzle/cli
   # etc.
   ```

2. **Test installation**:
   ```bash
   # In a test directory
   npm install @squizzle/cli
   npx squizzle --version
   ```

3. **Create git tag**:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. **Create GitHub release**:
   - Go to https://github.com/flyingrobots/squizzle/releases
   - Create release from tag
   - Add release notes
