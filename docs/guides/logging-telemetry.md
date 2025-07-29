# Logging and Telemetry

SQUIZZLE provides professional logging and privacy-first telemetry to help debug issues and improve the product while respecting your privacy.

## Logging

### Overview

SQUIZZLE uses a structured logging system that provides:
- Pretty console output with colors
- JSON structured file logs with rotation
- Correlation IDs for request tracing
- Operation timing helpers
- Multiple log levels

### Configuration

Configure logging through environment variables or options:

```bash
# Set log level (debug, info, warn, error)
export SQUIZZLE_LOG_LEVEL=debug

# Set log directory (default: ./logs)
export SQUIZZLE_LOG_DIR=/var/log/squizzle

# Run with verbose logging
squizzle apply 1.0.0 --verbose
```

### Console Output

Console logs are formatted for readability:

```
[14:23:45] INFO Applying version 1.0.0 [apply_migration]
[14:23:46] DEBUG Starting database transaction [apply_migration]
[14:23:47] INFO Migration completed [apply_migration] (1234ms)
[14:23:47] WARN Deprecated feature used [validation]
[14:23:48] ERROR Connection failed [database]
Error: Connection timeout
    at connect (connection.js:123:45)
```

### File Logging

Enable file logging for production environments:

```javascript
// squizzle.config.js
export default {
  logging: {
    file: true,              // Enable file logging
    maxSize: '10m',          // Max size before rotation
    maxFiles: 7,             // Keep 7 days of logs
    level: 'info'            // File log level
  }
}
```

Log files are:
- Automatically rotated daily
- Named with dates: `squizzle-2024-01-15.log`
- Stored as JSON for easy parsing
- Cleaned up after retention period

### Structured Logging

File logs use JSON format for analysis:

```json
{
  "timestamp": "2024-01-15T14:23:45.123Z",
  "level": "info",
  "message": "Migration completed",
  "operation": "apply_migration",
  "version": "1.0.0",
  "duration": 1234,
  "correlationId": "abc-123-def"
}
```

### Using the Logger

In your code:

```typescript
import { Logger } from '@squizzle/core'

const logger = new Logger({
  level: 'debug',
  file: true,
  correlationId: 'request-123'
})

// Basic logging
logger.info('Starting operation')
logger.debug('Debug details', { metadata: { key: 'value' } })
logger.warn('Deprecation warning')
logger.error('Operation failed', new Error('Details'))

// Operation timing
const timer = logger.time('database_operation')
// ... do work ...
timer() // Logs: "Completed database_operation (123ms)"

// Child logger with context
const childLogger = logger.child({ 
  correlationId: 'child-456',
  operation: 'sub-task'
})
```

### Log Levels

| Level | Use Case | Console Color |
|-------|----------|---------------|
| `debug` | Detailed debugging info | Gray |
| `info` | General information | Blue |
| `warn` | Warning messages | Yellow |
| `error` | Error messages | Red |

### Performance

Logging overhead is minimal:
- Console logging: <1ms per call
- File logging: Async, non-blocking
- Automatic buffering for high throughput

## Telemetry

### Overview

SQUIZZLE collects anonymous usage statistics to:
- Understand which features are used
- Identify common errors
- Measure performance
- Improve the product

**Privacy is paramount**: No personal information is ever collected.

### Privacy Features

1. **100% Anonymous**
   - No usernames, emails, or IDs
   - No file paths or URLs
   - No passwords or tokens
   - No database contents

2. **Automatic Opt-Out**
   - Respects `DO_NOT_TRACK` environment variable
   - Disabled in CI environments
   - One-command disable

3. **Data Filtering**
   - Sensitive keys removed
   - URLs replaced with "URL_REDACTED"
   - File paths hashed (8 chars)

### What's Collected

Anonymous metrics only:
```json
{
  "event": "command_executed",
  "properties": {
    "command": "apply",
    "has_options": true,
    "os": "darwin",
    "node_version": "v20.0.0",
    "squizzle_version": "1.0.0"
  },
  "timestamp": 1234567890,
  "sessionId": "uuid-here",
  "userId": "a1b2c3d4e5f6" // Anonymous hardware hash
}
```

### Opting Out

Multiple ways to disable telemetry:

```bash
# Method 1: Environment variable
export SQUIZZLE_TELEMETRY=false

# Method 2: Standard Do Not Track
export DO_NOT_TRACK=1

# Method 3: CLI command
squizzle telemetry --disable

# Method 4: Per-command
squizzle apply 1.0.0 --no-telemetry
```

### Managing Telemetry

Check status and manage settings:

```bash
# Check current status
squizzle telemetry --status
# Output: Telemetry is enabled

# Disable telemetry
squizzle telemetry --disable
# Output: ❌ Telemetry disabled

# Re-enable telemetry
squizzle telemetry --enable
# Output: ✅ Telemetry enabled
```

Settings are stored in `~/.squizzle/config.json`:
```json
{
  "telemetry": {
    "enabled": false
  }
}
```

### Debug Mode

See what telemetry sends (without sending):

```bash
export SQUIZZLE_TELEMETRY_DEBUG=true
squizzle apply 1.0.0

# Output:
[Telemetry] {
  "event": "command_executed",
  "properties": {
    "command": "apply",
    "has_options": false,
    "os": "darwin",
    "node_version": "v20.0.0",
    "squizzle_version": "1.0.0"
  },
  "timestamp": 1705334625123,
  "sessionId": "550e8400-e29b-41d4-a716",
  "version": "1.0"
}
```

### Performance Impact

Telemetry is designed for zero impact:
- Events batched (sent every 30s)
- Async sending (non-blocking)
- <5ms overhead per event
- Silent failures (never interrupts)
- Process doesn't wait for sending

### For Developers

Track custom events in extensions:

```typescript
import { trackCommand, trackError, trackPerformance } from '@squizzle/core'

// Track command usage
trackCommand('custom-command', { 
  option: 'value' 
})

// Track errors (anonymized)
try {
  // ... operation ...
} catch (error) {
  trackError(error, { 
    operation: 'custom-op' 
  })
}

// Track performance
const start = Date.now()
// ... operation ...
trackPerformance('operation-name', Date.now() - start)
```

## Integration Examples

### Express Middleware

```typescript
import { loggerMiddleware } from '@squizzle/core'
import express from 'express'

const app = express()

// Add logging to all requests
app.use(loggerMiddleware)

// Logs:
// [14:23:45] INFO Incoming request [GET /api/status]
// [14:23:45] INFO Request completed [GET /api/status] (23ms)
```

### Migration Engine Integration

```typescript
class MigrationEngine {
  private logger: Logger
  
  async apply(version: Version): Promise<void> {
    const timer = this.logger.time(`apply_${version}`)
    
    try {
      this.logger.info(`Applying version ${version}`, { 
        version,
        operation: 'apply'
      })
      
      // Track telemetry
      trackCommand('apply', { version })
      
      // ... migration logic ...
      
      timer() // Logs completion with duration
      trackPerformance('apply', duration)
      
    } catch (error) {
      this.logger.error('Migration failed', error)
      trackError(error, { version })
      throw error
    }
  }
}
```

## Troubleshooting

### Logs Not Appearing

1. Check log level:
```bash
echo $SQUIZZLE_LOG_LEVEL
# Should be debug, info, warn, or error
```

2. Check log directory permissions:
```bash
ls -la $SQUIZZLE_LOG_DIR
# Should be writable
```

3. Enable debug logging:
```bash
export SQUIZZLE_LOG_LEVEL=debug
```

### Telemetry Not Disabled

1. Check all opt-out methods:
```bash
echo $SQUIZZLE_TELEMETRY
echo $DO_NOT_TRACK
cat ~/.squizzle/config.json
```

2. Clear environment and config:
```bash
unset SQUIZZLE_TELEMETRY
rm ~/.squizzle/config.json
squizzle telemetry --disable
```

### High Log Volume

1. Increase log level:
```bash
export SQUIZZLE_LOG_LEVEL=warn
```

2. Disable console logging:
```javascript
new Logger({ console: false, file: true })
```

3. Filter by operation:
```bash
grep '"operation":"apply"' logs/squizzle-*.log
```

## Best Practices

### For Logging

1. **Use appropriate levels**
   - `debug`: Development details
   - `info`: User-facing information
   - `warn`: Deprecations and warnings
   - `error`: Actual errors only

2. **Include context**
   ```typescript
   logger.info('Operation completed', {
     operation: 'apply',
     version: '1.0.0',
     duration: 1234
   })
   ```

3. **Use correlation IDs**
   ```typescript
   const logger = parentLogger.child({
     correlationId: request.id
   })
   ```

### For Telemetry

1. **Never log sensitive data**
   - No user credentials
   - No file contents
   - No personal information

2. **Track meaningful events**
   - Command usage
   - Error categories
   - Performance metrics

3. **Respect user choice**
   - Check opt-out preference
   - Fail silently
   - Document what's collected

## Privacy Policy

SQUIZZLE telemetry:
- ✅ Collects anonymous usage statistics
- ✅ Helps improve the product
- ✅ Respects your privacy choices
- ❌ Never collects personal data
- ❌ Never sells or shares data
- ❌ Never requires telemetry

Your privacy is our priority. Thank you for helping improve SQUIZZLE!