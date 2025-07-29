# SQUIZZLE Project Guidelines

## Environment Variables and Dependency Injection

**NEVER access process.env directly in the codebase.** Always use dependency injection to pass environment variables as configuration options. This ensures:

1. Better testability - tests can inject mock values without modifying global state
2. Clearer dependencies - it's explicit what environment variables a component needs
3. Type safety - environment variables can be validated and typed at the injection point
4. No CI/test environment conflicts - tests won't fail due to different environment variables in CI

### Example Pattern

❌ **Bad:**
```typescript
class MyService {
  private token = process.env.API_TOKEN
}
```

✅ **Good:**
```typescript
interface MyServiceOptions {
  apiToken?: string
}

class MyService {
  private token: string | undefined
  
  constructor(options: MyServiceOptions = {}) {
    this.token = options.apiToken
  }
}

// At the application entry point:
const service = new MyService({
  apiToken: process.env.API_TOKEN
})
```

This rule applies to ALL packages in the monorepo.