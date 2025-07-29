import { createHash } from 'crypto'
import os from 'os'
import { v4 as uuid } from 'uuid'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import fetch from 'node-fetch'

interface TelemetryEvent {
  event: string
  properties?: Record<string, any>
  timestamp: number
  sessionId: string
  version: string
}

interface TelemetryConfig {
  enabled: boolean
  endpoint?: string
  userId?: string
  debug?: boolean
}

export class Telemetry {
  private config: TelemetryConfig
  private sessionId: string
  private userId: string
  private queue: TelemetryEvent[] = []
  private flushTimer?: NodeJS.Timeout
  
  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = {
      enabled: this.isTelemetryEnabled(),
      endpoint: process.env.SQUIZZLE_TELEMETRY_ENDPOINT || 'https://telemetry.squizzle.dev',
      debug: process.env.SQUIZZLE_TELEMETRY_DEBUG === 'true',
      ...config
    }
    
    this.sessionId = uuid()
    this.userId = this.getOrCreateUserId()
    
    // Start flush timer if enabled
    if (this.config.enabled) {
      this.startFlushTimer()
    }
    
    // Flush on exit
    process.on('beforeExit', () => this.flush())
  }
  
  private isTelemetryEnabled(): boolean {
    // Check explicit env var first
    if (process.env.SQUIZZLE_TELEMETRY === 'false') return false
    if (process.env.DO_NOT_TRACK === '1') return false
    
    // Check for CI environments
    if (process.env.CI) return false
    
    // Check config file
    const configPath = join(os.homedir(), '.squizzle', 'config.json')
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        return config.telemetry?.enabled !== false
      } catch {
        // Invalid config, default to enabled
      }
    }
    
    return true
  }
  
  private getOrCreateUserId(): string {
    const idPath = join(os.homedir(), '.squizzle', '.telemetry-id')
    
    if (existsSync(idPath)) {
      return readFileSync(idPath, 'utf-8').trim()
    }
    
    // Generate anonymous ID based on machine characteristics
    const machineId = createHash('sha256')
      .update(os.hostname())
      .update(os.platform())
      .update(os.arch())
      .digest('hex')
      .substring(0, 16)
    
    // Save for consistency
    try {
      mkdirSync(join(os.homedir(), '.squizzle'), { recursive: true })
      writeFileSync(idPath, machineId)
    } catch {
      // Can't write, use session ID
      return this.sessionId
    }
    
    return machineId
  }
  
  track(event: string, properties?: Record<string, any>): void {
    if (!this.config.enabled) return
    
    // Filter sensitive data
    const filtered = this.filterSensitiveData(properties)
    
    const telemetryEvent: TelemetryEvent = {
      event,
      properties: {
        ...filtered,
        // Add context
        os: os.platform(),
        node_version: process.version,
        squizzle_version: this.getSquizzleVersion(),
      },
      timestamp: Date.now(),
      sessionId: this.sessionId,
      version: '1.0'
    }
    
    if (this.config.debug) {
      console.log('[Telemetry]', JSON.stringify(telemetryEvent, null, 2))
    }
    
    this.queue.push(telemetryEvent)
    
    // Flush if queue is large
    if (this.queue.length >= 10) {
      this.flush()
    }
  }
  
  private filterSensitiveData(data?: Record<string, any>): Record<string, any> {
    if (!data) return {}
    
    const sensitive = [
      'password', 'token', 'secret', 'key', 'auth',
      'database_url', 'connection_string', 'api_key'
    ]
    
    const filtered = { ...data }
    
    Object.keys(filtered).forEach(key => {
      // Remove sensitive keys
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        delete filtered[key]
        return
      }
      
      // Hash identifiable strings
      if (typeof filtered[key] === 'string') {
        // Hash URLs
        if (filtered[key].includes('://')) {
          filtered[key] = 'URL_REDACTED'
        }
        // Hash file paths
        if (filtered[key].includes('/') || filtered[key].includes('\\')) {
          filtered[key] = createHash('sha256')
            .update(filtered[key])
            .digest('hex')
            .substring(0, 8)
        }
      }
    })
    
    return filtered
  }
  
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return
    
    const events = [...this.queue]
    this.queue = []
    
    try {
      const response = await fetch(`${this.config.endpoint}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': this.userId,
        },
        body: JSON.stringify({ events }),
        timeout: 5000
      } as any)
      
      if (!response.ok && this.config.debug) {
        console.error('[Telemetry] Failed to send:', response.statusText)
      }
    } catch (error: any) {
      if (this.config.debug) {
        console.error('[Telemetry] Error:', error.message)
      }
      // Silently fail - never interrupt user flow
    }
  }
  
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush()
    }, 30000) // Every 30 seconds
    
    this.flushTimer.unref() // Don't keep process alive
  }
  
  private getSquizzleVersion(): string {
    try {
      const pkg = JSON.parse(
        readFileSync(join(__dirname, '../../package.json'), 'utf-8')
      )
      return pkg.version
    } catch {
      return 'unknown'
    }
  }
}

// Global instance
let telemetry: Telemetry

export function getTelemetry(): Telemetry {
  if (!telemetry) {
    telemetry = new Telemetry()
  }
  return telemetry
}

// Convenience tracking functions
export function trackCommand(command: string, options?: Record<string, any>): void {
  getTelemetry().track('command_executed', {
    command,
    ...options
  })
}

export function trackError(error: Error, context?: Record<string, any>): void {
  getTelemetry().track('error_occurred', {
    error_type: error.constructor.name,
    error_message: error.message,
    ...context
  })
}

export function trackPerformance(operation: string, duration: number): void {
  getTelemetry().track('performance_metric', {
    operation,
    duration,
    slow: duration > 1000
  })
}

// CLI integration
export function addTelemetryToCommand(program: any): void {
  program
    .option('--no-telemetry', 'Disable anonymous usage statistics')
    .hook('preAction', (thisCommand: any) => {
      const options = thisCommand.opts()
      
      if (options.telemetry === false) {
        process.env.SQUIZZLE_TELEMETRY = 'false'
      }
      
      // Track command usage
      trackCommand(thisCommand.name(), {
        has_options: Object.keys(options).length > 0
      })
    })
    
  // Add telemetry command
  program
    .command('telemetry')
    .description('Manage telemetry settings')
    .option('--enable', 'Enable anonymous usage statistics')
    .option('--disable', 'Disable anonymous usage statistics')
    .option('--status', 'Show current telemetry status')
    .action((options: any) => {
      const configPath = join(os.homedir(), '.squizzle', 'config.json')
      
      if (options.status) {
        const enabled = getTelemetry().config.enabled
        console.log(`Telemetry is ${enabled ? 'enabled' : 'disabled'}`)
        return
      }
      
      // Update config
      const config = existsSync(configPath) 
        ? JSON.parse(readFileSync(configPath, 'utf-8'))
        : {}
      
      if (options.enable) {
        config.telemetry = { enabled: true }
        console.log('✅ Telemetry enabled')
      } else if (options.disable) {
        config.telemetry = { enabled: false }
        console.log('❌ Telemetry disabled')
      }
      
      mkdirSync(join(os.homedir(), '.squizzle'), { recursive: true })
      writeFileSync(configPath, JSON.stringify(config, null, 2))
    })
}