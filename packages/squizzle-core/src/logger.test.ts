import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Logger, getLogger } from './logger'
import { existsSync, rmSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Helper to capture console output
function captureConsole(fn: () => void): string {
  const originalLog = console.log
  const originalError = console.error
  let output = ''
  
  console.log = (msg: string) => { output += msg + '\n' }
  console.error = (msg: string) => { output += msg + '\n' }
  
  try {
    fn()
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  
  return output
}

// Helper to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Logger', () => {
  const testLogDir = './test-logs'
  
  beforeEach(() => {
    // Clean up any existing test logs
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true })
    }
    process.env.SQUIZZLE_LOG_DIR = testLogDir
  })
  
  afterEach(() => {
    // Clean up test logs
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true })
    }
    delete process.env.SQUIZZLE_LOG_DIR
  })
  
  describe('Console Logging', () => {
    it('should format console output correctly', () => {
      const output = captureConsole(() => {
        const logger = new Logger({ level: 'debug' })
        logger.info('Test message', { operation: 'test', duration: 123 })
      })
      
      expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}\] INFO Test message \[test\] \(123ms\)/)
    })
    
    it('should use appropriate colors for log levels', () => {
      const output = captureConsole(() => {
        const logger = new Logger()
        logger.debug('Debug message')
        logger.info('Info message')
        logger.warn('Warning message')
        logger.error('Error message')
      })
      
      // Check that color codes are present (ANSI escape sequences)
      expect(output).toContain('\x1b[') // ANSI escape sequence indicator
    })
    
    it('should handle error objects correctly', () => {
      const output = captureConsole(() => {
        const logger = new Logger()
        const error = new Error('Test error')
        logger.error('Operation failed', error)
      })
      
      expect(output).toContain('ERROR Operation failed')
      expect(output).toContain('Test error')
      expect(output).toContain('at ') // Stack trace indicator
    })
    
    it('should output JSON format when requested', () => {
      const output = captureConsole(() => {
        const logger = new Logger({ json: true })
        logger.info('Test message', { operation: 'test' })
      })
      
      const parsed = JSON.parse(output.trim())
      expect(parsed.level).toBe('info')
      expect(parsed.message).toBe('Test message')
      expect(parsed.operation).toBe('test')
    })
  })
  
  describe('File Logging', () => {
    it('should create log files', async () => {
      const logger = new Logger({
        file: true,
        console: false
      })
      
      logger.info('Test message')
      
      // Wait a bit for file to be written
      await sleep(100)
      
      expect(existsSync(testLogDir)).toBe(true)
      const files = readdirSync(testLogDir)
      expect(files.length).toBeGreaterThan(0)
      expect(files[0]).toMatch(/squizzle-\d{4}-\d{2}-\d{2}\.log/)
    })
    
    it('should write JSON formatted logs to files', async () => {
      const logger = new Logger({
        file: true,
        console: false
      })
      
      logger.info('Test message', { operation: 'test', value: 42 })
      
      await sleep(100)
      
      const files = readdirSync(testLogDir)
      const logContent = readFileSync(join(testLogDir, files[0]), 'utf-8')
      const logEntry = JSON.parse(logContent.trim())
      
      expect(logEntry.level).toBe('info')
      expect(logEntry.message).toBe('Test message')
      expect(logEntry.operation).toBe('test')
      expect(logEntry.value).toBe(42)
      expect(logEntry.timestamp).toBeDefined()
    })
    
    it('should handle custom file names', async () => {
      const logger = new Logger({
        file: 'custom-name-%DATE%.log',
        console: false
      })
      
      logger.info('Test')
      
      await sleep(100)
      
      const files = readdirSync(testLogDir)
      expect(files[0]).toMatch(/custom-name-\d{4}-\d{2}-\d{2}\.log/)
    })
  })
  
  describe('Operation Timing', () => {
    it('should track operation timing', async () => {
      const output = captureConsole(async () => {
        const logger = new Logger()
        const timer = logger.time('test_operation')
        
        // Simulate work
        await sleep(100)
        
        timer()
      })
      
      expect(output).toContain('Starting test_operation')
      expect(output).toContain('Completed test_operation')
      expect(output).toMatch(/\(\d+ms\)/)
    })
    
    it('should report accurate timing', async () => {
      let duration = 0
      const output = captureConsole(async () => {
        const logger = new Logger()
        const timer = logger.time('test_operation')
        
        await sleep(150)
        
        timer()
      })
      
      // Extract duration from output
      const match = output.match(/\((\d+)ms\)/)
      if (match) {
        duration = parseInt(match[1])
      }
      
      expect(duration).toBeGreaterThanOrEqual(150)
      expect(duration).toBeLessThan(200)
    })
  })
  
  describe('Log Levels', () => {
    it('should respect log level settings', () => {
      const output = captureConsole(() => {
        const logger = new Logger({ level: 'warn' })
        logger.debug('Debug message')
        logger.info('Info message')
        logger.warn('Warning message')
        logger.error('Error message')
      })
      
      expect(output).not.toContain('Debug message')
      expect(output).not.toContain('Info message')
      expect(output).toContain('Warning message')
      expect(output).toContain('Error message')
    })
    
    it('should respect environment variable log level', () => {
      process.env.SQUIZZLE_LOG_LEVEL = 'error'
      
      const output = captureConsole(() => {
        const logger = new Logger()
        logger.info('Info message')
        logger.error('Error message')
      })
      
      expect(output).not.toContain('Info message')
      expect(output).toContain('Error message')
      
      delete process.env.SQUIZZLE_LOG_LEVEL
    })
  })
  
  describe('Context and Correlation', () => {
    it('should include correlation ID in logs', async () => {
      const logger = new Logger({
        correlationId: 'test-correlation-123',
        file: true,
        console: false
      })
      
      logger.info('Test message')
      
      await sleep(100)
      
      const files = readdirSync(testLogDir)
      const logContent = readFileSync(join(testLogDir, files[0]), 'utf-8')
      const logEntry = JSON.parse(logContent.trim())
      
      expect(logEntry.correlationId).toBe('test-correlation-123')
    })
    
    it('should create child loggers with context', () => {
      const output = captureConsole(() => {
        const logger = new Logger()
        const childLogger = logger.child({ 
          correlationId: 'child-123',
          operation: 'child-op'
        })
        
        childLogger.info('Child message')
      })
      
      // Child logger should inherit parent settings
      expect(output).toContain('Child message')
    })
  })
  
  describe('Metadata Handling', () => {
    it('should show metadata in debug mode', () => {
      const output = captureConsole(() => {
        const logger = new Logger({ level: 'debug' })
        logger.debug('Debug with metadata', {
          metadata: {
            key1: 'value1',
            key2: 42,
            nested: { prop: 'value' }
          }
        })
      })
      
      expect(output).toContain('Debug with metadata')
      expect(output).toContain('key1')
      expect(output).toContain('value1')
      expect(output).toContain('42')
    })
    
    it('should not show metadata in non-debug mode', () => {
      const output = captureConsole(() => {
        const logger = new Logger({ level: 'info' })
        logger.info('Info with metadata', {
          metadata: {
            key1: 'value1'
          }
        })
      })
      
      expect(output).toContain('Info with metadata')
      expect(output).not.toContain('key1')
    })
  })
  
  describe('Global Logger', () => {
    it('should return singleton instance', () => {
      const logger1 = getLogger()
      const logger2 = getLogger()
      
      expect(logger1).toBe(logger2)
    })
  })
  
  describe('Error Handling', () => {
    it('should not crash on logging errors', () => {
      // Create logger with invalid log directory
      process.env.SQUIZZLE_LOG_DIR = '/root/no-permission'
      
      expect(() => {
        const logger = new Logger({ file: true })
        logger.info('Test')
      }).not.toThrow()
      
      delete process.env.SQUIZZLE_LOG_DIR
    })
  })
})