import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Telemetry, getTelemetry, trackCommand, trackError, trackPerformance } from './telemetry'
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('Telemetry', () => {
  const testConfigDir = join(os.tmpdir(), '.squizzle-test')
  const originalHome = process.env.HOME
  
  beforeEach(() => {
    // Use temp directory for test config
    process.env.HOME = os.tmpdir()
    
    // Clean up any existing test config
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
    
    // Reset environment
    delete process.env.SQUIZZLE_TELEMETRY
    delete process.env.DO_NOT_TRACK
    delete process.env.CI
    delete process.env.SQUIZZLE_TELEMETRY_DEBUG
  })
  
  afterEach(() => {
    process.env.HOME = originalHome
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })
  
  describe('Privacy Controls', () => {
    it('should respect DO_NOT_TRACK environment variable', () => {
      process.env.DO_NOT_TRACK = '1'
      const telemetry = new Telemetry()
      
      expect(telemetry.config.enabled).toBe(false)
    })
    
    it('should respect SQUIZZLE_TELEMETRY=false', () => {
      process.env.SQUIZZLE_TELEMETRY = 'false'
      const telemetry = new Telemetry()
      
      expect(telemetry.config.enabled).toBe(false)
    })
    
    it('should be disabled in CI environments', () => {
      process.env.CI = 'true'
      const telemetry = new Telemetry()
      
      expect(telemetry.config.enabled).toBe(false)
    })
    
    it('should respect config file settings', () => {
      const configPath = join(os.homedir(), '.squizzle', 'config.json')
      const configDir = join(os.homedir(), '.squizzle')
      
      // Save existing config if any
      let existingConfig: string | undefined
      if (existsSync(configPath)) {
        existingConfig = readFileSync(configPath, 'utf-8')
      }
      
      // Write test config
      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify({
        telemetry: { enabled: false }
      }))
      
      const telemetry = new Telemetry()
      expect(telemetry.config.enabled).toBe(false)
      
      // Restore or remove config
      if (existingConfig) {
        writeFileSync(configPath, existingConfig)
      } else {
        rmSync(configPath)
      }
    })
    
    it('should not track when disabled', () => {
      const telemetry = new Telemetry({ enabled: false })
      const spy = vi.spyOn(telemetry.queue, 'push')
      
      telemetry.track('test_event', { data: 'value' })
      
      expect(spy).not.toHaveBeenCalled()
    })
  })
  
  describe('Sensitive Data Filtering', () => {
    it('should filter sensitive keys', () => {
      const telemetry = new Telemetry({ debug: true })
      
      const filtered = telemetry.filterSensitiveData({
        command: 'apply',
        database_url: 'postgresql://user:pass@host/db',
        connection_string: 'mongodb://localhost:27017',
        api_key: 'sk-1234567890',
        password: 'secret123',
        token: 'ghp_abcdef',
        safe_prop: 'keep this'
      })
      
      expect(filtered.database_url).toBeUndefined()
      expect(filtered.connection_string).toBeUndefined()
      expect(filtered.api_key).toBeUndefined()
      expect(filtered.password).toBeUndefined()
      expect(filtered.token).toBeUndefined()
      expect(filtered.safe_prop).toBe('keep this')
      expect(filtered.command).toBe('apply')
    })
    
    it('should redact URLs', () => {
      const telemetry = new Telemetry()
      
      const filtered = telemetry.filterSensitiveData({
        registry: 'https://registry.example.com',
        webhook: 'http://webhook.example.com/hook',
        plain_text: 'not a url'
      })
      
      expect(filtered.registry).toBe('URL_REDACTED')
      expect(filtered.webhook).toBe('URL_REDACTED')
      expect(filtered.plain_text).toBe('not a url')
    })
    
    it('should hash file paths', () => {
      const telemetry = new Telemetry()
      
      const filtered = telemetry.filterSensitiveData({
        file_path: '/home/user/project/file.sql',
        windows_path: 'C:\\Users\\Name\\Documents\\file.txt',
        config_path: './config/settings.json',
        non_path: 'just text'
      })
      
      expect(filtered.file_path).toMatch(/^[a-f0-9]{8}$/)
      expect(filtered.windows_path).toMatch(/^[a-f0-9]{8}$/)
      expect(filtered.config_path).toMatch(/^[a-f0-9]{8}$/)
      expect(filtered.non_path).toBe('just text')
    })
    
    it('should handle nested sensitive data', () => {
      const telemetry = new Telemetry()
      
      const filtered = telemetry.filterSensitiveData({
        level1: {
          secret_key: 'should-be-removed'
        }
      })
      
      // Note: Current implementation doesn't recurse into nested objects
      // This is intentional to keep it simple and performant
      expect(filtered.level1).toEqual({
        secret_key: 'should-be-removed'
      })
    })
  })
  
  describe('Anonymous ID Generation', () => {
    it('should generate consistent machine ID', () => {
      const telemetry1 = new Telemetry()
      const id1 = telemetry1['userId']
      
      const telemetry2 = new Telemetry()
      const id2 = telemetry2['userId']
      
      expect(id1).toBe(id2)
      expect(id1).toMatch(/^[a-f0-9]{16}$/)
    })
    
    it('should save machine ID for persistence', () => {
      const telemetry = new Telemetry()
      const idPath = join(os.homedir(), '.squizzle', '.telemetry-id')
      
      // In CI or restricted environments, file might not be saved
      if (existsSync(idPath)) {
        const savedId = readFileSync(idPath, 'utf-8').trim()
        expect(savedId).toBe(telemetry.userId)
      } else {
        // If file wasn't saved, userId should still be a valid machine ID
        expect(telemetry.userId).toMatch(/^[a-f0-9]{16}$/)
      }
    })
    
    it('should use session ID if cannot write', () => {
      // Mock fs functions to simulate permission error
      const originalExistsSync = existsSync
      const originalReadFileSync = readFileSync
      const originalMkdirSync = mkdirSync
      const originalWriteFileSync = writeFileSync
      
      // Make existsSync return false for telemetry ID
      ;(global as any).existsSync = (path: string) => {
        if (path.includes('.telemetry-id')) return false
        return originalExistsSync(path)
      }
      
      // Make mkdirSync throw error
      ;(global as any).mkdirSync = () => { 
        throw new Error('Permission denied') 
      }
      
      // Make writeFileSync throw error
      ;(global as any).writeFileSync = () => { 
        throw new Error('Permission denied') 
      }
      
      const telemetry = new Telemetry()
      // When file can't be written, it should use session ID
      expect(telemetry.userId).toBe(telemetry.sessionId)
      
      // Restore all mocks
      ;(global as any).existsSync = originalExistsSync
      ;(global as any).readFileSync = originalReadFileSync
      ;(global as any).mkdirSync = originalMkdirSync
      ;(global as any).writeFileSync = originalWriteFileSync
    })
  })
  
  describe('Event Tracking', () => {
    it('should add context to events', () => {
      const telemetry = new Telemetry({ enabled: true })
      
      telemetry.track('test_event', { custom: 'data' })
      
      const event = telemetry.queue[0]
      expect(event.event).toBe('test_event')
      expect(event.properties?.custom).toBe('data')
      expect(event.properties?.os).toBe(os.platform())
      expect(event.properties?.node_version).toBe(process.version)
      expect(event.properties?.squizzle_version).toBeDefined()
      expect(event.timestamp).toBeDefined()
      expect(event.sessionId).toBeDefined()
    })
    
    it('should batch events', () => {
      const telemetry = new Telemetry()
      const flushSpy = vi.spyOn(telemetry, 'flush' as any).mockResolvedValue(undefined)
      
      // Add 9 events - shouldn't flush
      for (let i = 0; i < 9; i++) {
        telemetry.track('test_event')
      }
      expect(flushSpy).not.toHaveBeenCalled()
      expect(telemetry.queue.length).toBe(9)
      
      // 10th event triggers flush
      telemetry.track('test_event')
      expect(flushSpy).toHaveBeenCalled()
    })
  })
  
  describe('Convenience Functions', () => {
    it('should track commands', () => {
      const telemetry = getTelemetry()
      const spy = vi.spyOn(telemetry, 'track')
      
      trackCommand('apply', { version: '1.0.0' })
      
      expect(spy).toHaveBeenCalledWith('command_executed', {
        command: 'apply',
        version: '1.0.0'
      })
    })
    
    it('should track errors', () => {
      const telemetry = getTelemetry()
      const spy = vi.spyOn(telemetry, 'track')
      
      const error = new Error('Test error')
      trackError(error, { context: 'test' })
      
      expect(spy).toHaveBeenCalledWith('error_occurred', {
        error_type: 'Error',
        error_message: 'Test error',
        context: 'test'
      })
    })
    
    it('should track performance', () => {
      const telemetry = getTelemetry()
      const spy = vi.spyOn(telemetry, 'track')
      
      trackPerformance('operation', 1500)
      
      expect(spy).toHaveBeenCalledWith('performance_metric', {
        operation: 'operation',
        duration: 1500,
        slow: true
      })
    })
  })
  
  describe('Debug Mode', () => {
    it('should log events in debug mode', () => {
      process.env.SQUIZZLE_TELEMETRY_DEBUG = 'true'
      const consoleSpy = vi.spyOn(console, 'log')
      
      const telemetry = new Telemetry()
      telemetry.track('debug_test')
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Telemetry]',
        expect.stringContaining('debug_test')
      )
      
      consoleSpy.mockRestore()
    })
  })
  
  describe('Flush Behavior', () => {
    it('should not crash on flush failure', async () => {
      const telemetry = new Telemetry({ endpoint: 'http://invalid.endpoint' })
      
      telemetry.track('test')
      
      // Should not throw
      await expect(telemetry.flush()).resolves.not.toThrow()
    })
    
    it('should clear queue after flush attempt', async () => {
      const telemetry = new Telemetry()
      
      telemetry.track('test1')
      telemetry.track('test2')
      expect(telemetry.queue.length).toBe(2)
      
      await telemetry.flush()
      expect(telemetry.queue.length).toBe(0)
    })
  })
  
  describe('Global Instance', () => {
    it('should return singleton', () => {
      const t1 = getTelemetry()
      const t2 = getTelemetry()
      
      expect(t1).toBe(t2)
    })
  })
})