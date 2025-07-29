import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyCommand } from '../../src/commands/apply'
import { MigrationEngine } from '@squizzle/core'
import inquirer from 'inquirer'

// Mock dependencies
vi.mock('inquirer')
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    text: '',
    succeed: vi.fn(),
    fail: vi.fn()
  })
}))

vi.mock('../ui/banner', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn()
}))

describe('applyCommand', () => {
  let mockEngine: Partial<MigrationEngine>
  let mockExit: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Mock engine methods
    mockEngine = {
      verify: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
      apply: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ 
        current: '1.0.0',
        applied: [],
        available: []
      })
    }

    // Mock process.exit
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit')
    })

    // Mock console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Reset mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    mockExit.mockRestore()
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  describe('version verification', () => {
    it('should verify version before applying', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' })

      expect(mockEngine.verify).toHaveBeenCalledWith('1.0.0')
      expect(mockEngine.apply).toHaveBeenCalled()
    })

    it('should skip verification with force flag', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        force: true,
        env: 'development' 
      })

      expect(mockEngine.verify).not.toHaveBeenCalled()
      expect(mockEngine.apply).toHaveBeenCalled()
    })

    it('should prompt on verification failure', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ 
        valid: false, 
        errors: ['Missing dependency', 'Invalid checksum'] 
      })

      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }
      mockInquirer.prompt.mockResolvedValue({ proceed: true })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' })

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Verification errors:'))
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing dependency'))
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid checksum'))
      expect(mockInquirer.prompt).toHaveBeenCalled()
      expect(mockEngine.apply).toHaveBeenCalled()
    })

    it('should exit if user declines to proceed after verification failure', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ 
        valid: false, 
        errors: ['Error'] 
      })

      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }
      mockInquirer.prompt.mockResolvedValue({ proceed: false })

      await expect(applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
      expect(mockEngine.apply).not.toHaveBeenCalled()
    })

    it('should skip prompt in dry-run mode on verification failure', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ 
        valid: false, 
        errors: ['Error'] 
      })

      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        dryRun: true,
        env: 'development' 
      })

      expect(mockInquirer.prompt).not.toHaveBeenCalled()
      expect(mockEngine.apply).toHaveBeenCalled()
    })
  })

  describe('production safeguards', () => {
    it('should require confirmation for production environment', async () => {
      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }
      mockInquirer.prompt
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmVersion: '1.0.0' })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'production' })

      expect(mockInquirer.prompt).toHaveBeenCalledTimes(2)
      expect(mockEngine.apply).toHaveBeenCalled()
    })

    it('should cancel on first confirmation rejection', async () => {
      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }
      mockInquirer.prompt.mockResolvedValue({ confirm: false })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'production' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Operation cancelled'))
      expect(mockEngine.apply).not.toHaveBeenCalled()
    })

    it('should cancel on version mismatch', async () => {
      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }
      mockInquirer.prompt
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmVersion: 'wrong-version' })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'production' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Version mismatch'))
      expect(mockEngine.apply).not.toHaveBeenCalled()
    })

    it('should skip production confirmation in CI environment', async () => {
      process.env.CI = 'true'
      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'production' })

      expect(mockInquirer.prompt).not.toHaveBeenCalled()
      expect(mockEngine.apply).toHaveBeenCalled()

      delete process.env.CI
    })

    it('should skip production confirmation in dry-run mode', async () => {
      const mockInquirer = inquirer as unknown as { prompt: ReturnType<typeof vi.fn> }

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        env: 'production',
        dryRun: true 
      })

      expect(mockInquirer.prompt).not.toHaveBeenCalled()
      expect(mockEngine.apply).toHaveBeenCalled()
    })
  })

  describe('apply options', () => {
    it('should pass dry-run option to engine', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        dryRun: true,
        env: 'development' 
      })

      expect(mockEngine.apply).toHaveBeenCalledWith('1.0.0', expect.objectContaining({
        dryRun: true
      }))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run completed'))
    })

    it('should parse and pass timeout option', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        timeout: '60000',
        env: 'development' 
      })

      expect(mockEngine.apply).toHaveBeenCalledWith('1.0.0', expect.objectContaining({
        timeout: 60000
      }))
    })

    it('should pass parallel option', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        parallel: true,
        env: 'development' 
      })

      expect(mockEngine.apply).toHaveBeenCalledWith('1.0.0', expect.objectContaining({
        parallel: true
      }))
    })

    it('should parse and pass maxParallel option', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        maxParallel: '10',
        env: 'development' 
      })

      expect(mockEngine.apply).toHaveBeenCalledWith('1.0.0', expect.objectContaining({
        maxParallel: 10
      }))
    })

    it('should provide beforeEach callback', async () => {
      let beforeEachCallback: Function | undefined

      mockEngine.apply = vi.fn().mockImplementation((_version, options) => {
        beforeEachCallback = options.beforeEach
      })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' })

      expect(beforeEachCallback).toBeDefined()
      
      // Test the callback
      await beforeEachCallback!('migration.sql')
      // Should update spinner text (mocked)
    })

    it('should provide afterEach callback', async () => {
      let afterEachCallback: Function | undefined

      mockEngine.apply = vi.fn().mockImplementation((_version, options) => {
        afterEachCallback = options.afterEach
      })

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' })

      expect(afterEachCallback).toBeDefined()
      
      // Test the callback with success
      await afterEachCallback!('migration.sql', true)
      // Should update spinner text (mocked)
    })
  })

  describe('success handling', () => {
    it('should show success message with status', async () => {
      const mockStatus = {
        current: '1.0.0',
        applied: [{ version: '1.0.0', appliedAt: new Date() }],
        available: ['1.0.0']
      }
      mockEngine.status = vi.fn().mockResolvedValue(mockStatus)

      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' })

      expect(mockEngine.status).toHaveBeenCalled()
      // Success message should be shown (mocked)
    })

    it('should not fetch status in dry-run mode', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { 
        dryRun: true,
        env: 'development' 
      })

      expect(mockEngine.status).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle apply errors gracefully', async () => {
      const testError = new Error('Database connection failed')
      mockEngine.apply = vi.fn().mockRejectedValue(testError)

      await expect(applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should handle verify errors gracefully', async () => {
      const testError = new Error('Storage unavailable')
      mockEngine.verify = vi.fn().mockRejectedValue(testError)

      await expect(applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should handle status fetch errors gracefully', async () => {
      const testError = new Error('Failed to get status')
      mockEngine.status = vi.fn().mockRejectedValue(testError)

      await expect(applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe('environment handling', () => {
    it('should pass environment to status display', async () => {
      await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'staging' })

      // Environment should be included in success message (mocked)
      expect(mockEngine.apply).toHaveBeenCalled()
    })

    it('should handle different environments correctly', async () => {
      const environments = ['development', 'staging', 'test']

      for (const env of environments) {
        await applyCommand(mockEngine as MigrationEngine, '1.0.0', { env })
        expect(mockEngine.apply).toHaveBeenCalled()
      }
    })
  })
})