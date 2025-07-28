# Contributing to SQUIZZLE

Thank you for your interest in contributing to SQUIZZLE! We welcome contributions of all kinds.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct: be respectful, inclusive, and constructive.

## How to Contribute

### Reporting Issues

- Use the GitHub issue tracker
- Check if the issue already exists
- Include reproduction steps
- Provide environment details

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`pnpm test`)
6. Commit with clear messages (`git commit -m 'feat: add amazing feature'`)
7. Push to your fork (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Setup

```bash
# Clone repository
git clone https://github.com/flyingrobots/squizzle.git
cd squizzle

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Project Structure

```
squizzle/
├── packages/          # NPM packages
│   ├── squizzle-cli/      # CLI implementation
│   ├── squizzle-core/     # Core engine
│   ├── squizzle-postgres/ # PostgreSQL driver
│   ├── squizzle-oci/      # OCI storage
│   └── squizzle-security/ # Security features
├── examples/          # Example projects
├── docs/             # Documentation
└── tests/            # Integration tests
```

### Coding Standards

- Use TypeScript for all code
- Follow existing code style
- Add JSDoc comments for public APIs
- Write tests for new features
- Keep commits atomic and focused

### Commit Convention

We use conventional commits:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Maintenance tasks

### Testing

- Unit tests for individual functions
- Integration tests for CLI commands
- E2E tests for complete workflows
- Aim for >80% code coverage

### Documentation

- Update README if needed
- Add JSDoc to new functions
- Update docs/ for new features
- Include examples

## Release Process

1. Update CHANGELOG.md
2. Run `pnpm changeset`
3. Create PR with changes
4. After merge, CI publishes

## Getting Help

- Open a discussion for questions
- Join our Discord server
- Check existing issues/PRs

## Recognition

Contributors are recognized in:
- CHANGELOG.md
- GitHub contributors page
- Release notes

Thank you for contributing!