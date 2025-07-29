# CLAUDE.md - Project Guidelines for Squizzle

## Testing Guidelines

1. **Test Organization**: Tests go in `test/` directory, next to `src/` - no colocating tests with their source files
2. **Test Integrity**: NEVER skip, disable, fake, or otherwise circumvent a test
3. **Use Real Infrastructure**: Always use the real test database and infrastructure (Docker containers) - avoid mocking database connections or storage when integration testing
4. **Clean Up Resources**: Always close database connections in `finally` blocks to prevent hanging tests
5. **Test Behavior, Not Implementation**: Focus on testing what the code does, not how it does it

## TypeScript Best Practices

1. **Static Typing**: TypeScript is intentionally used to achieve static typing. Avoid the use of `any`
2. **Explicit Types**: Prefer explicit type declarations over type inference for function parameters and return types
3. **Error Types**: Use custom error classes instead of generic Error objects
4. **Schema Validation**: Use Zod schemas for runtime validation at system boundaries

## Database Architecture

1. **Schema Separation**: System tables belong in the `squizzle` schema, not mixed with user tables
2. **Connection Management**: Always use try/finally blocks to ensure database connections are properly closed
3. **Migration Safety**: Never modify existing migrations - only add new ones

## CLI Development

1. **Environment Handling**: Use `process.env.NODE_ENV` and `SQUIZZLE_SKIP_VALIDATION` appropriately for test mode
2. **Exit Codes**: Use proper exit codes (0 for success, 1 for general errors, 2 for validation errors)
3. **Error Messages**: Provide clear, actionable error messages with suggestions for fixes

## Docker and Infrastructure

1. **Container Health**: Ensure all dependent containers are healthy before running tests
2. **Port Management**: Be aware of port conflicts and handle them gracefully
3. **Schema Ownership**: Ensure proper database user permissions and schema ownership

## Code Quality

1. **No Premature Optimization**: Don't add mock implementations unless absolutely necessary
2. **Fail Fast**: Validate inputs early and fail with clear error messages
3. **Consistency**: Follow existing patterns in the codebase for similar functionality