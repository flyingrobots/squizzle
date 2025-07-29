import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyCommand } from '../../src/commands/verify'
import { MigrationEngine } from '@squizzle/core'

// Mock ora
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    fail: vi.fn()
  })
}))

describe('verifyCommand', () => {
  let mockEngine: Partial<MigrationEngine>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let mockExit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockEngine = {
      verify: vi.fn().mockResolvedValue({ valid: true, errors: [] })
    }

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit')
    })

    vi.clearAllMocks()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    mockExit.mockRestore()
  })

  describe('successful verification', () => {
    it('should verify version and show success', async () => {
      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockEngine.verify).toHaveBeenCalledWith('1.0.0')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Verification Report for v1.0.0'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status: ✓ Valid'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('All checks passed'))
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('should display environment in output', async () => {
      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'production' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Environment: production'))
    })

    it('should show safe to apply message on success', async () => {
      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('This version can be safely applied'))
    })
  })

  describe('failed verification', () => {
    it('should show errors when verification fails', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ 
        valid: false, 
        errors: ['Missing migration file', 'Invalid checksum', 'Dependency not satisfied'] 
      })

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status: ✗ Invalid'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Errors:'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Missing migration file'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid checksum'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Dependency not satisfied'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should exit with code 1 on invalid version', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ valid: false, errors: ['Error'] })

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should not show success message when invalid', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ valid: false, errors: ['Error'] })

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('All checks passed'))
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('This version can be safely applied'))
    })
  })

  describe('JSON output', () => {
    it('should output JSON when json flag is set', async () => {
      const mockResult = { valid: true, errors: [] }
      mockEngine.verify = vi.fn().mockResolvedValue(mockResult)

      await verifyCommand(mockEngine as MigrationEngine, '1.0.0', { json: true, env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(mockResult, null, 2))
      expect(consoleLogSpy).toHaveBeenCalledTimes(1) // Only JSON output
    })

    it('should output JSON for failed verification', async () => {
      const mockResult = { valid: false, errors: ['Error 1', 'Error 2'] }
      mockEngine.verify = vi.fn().mockResolvedValue(mockResult)

      await verifyCommand(mockEngine as MigrationEngine, '1.0.0', { json: true, env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(mockResult, null, 2))
    })

    it('should not show formatted output in JSON mode', async () => {
      await verifyCommand(mockEngine as MigrationEngine, '1.0.0', { json: true, env: 'development' })

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Verification Report'))
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Status:'))
    })

    it('should not call process.exit in JSON mode', async () => {
      await verifyCommand(mockEngine as MigrationEngine, '1.0.0', { json: true, env: 'development' })

      expect(mockExit).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle verification errors gracefully', async () => {
      const error = new Error('Storage unavailable')
      mockEngine.verify = vi.fn().mockRejectedValue(error)

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Error: Storage unavailable'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should stop spinner on error', async () => {
      const error = new Error('Connection failed')
      mockEngine.verify = vi.fn().mockRejectedValue(error)

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      // Spinner fail method should be called (mocked)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle missing version gracefully', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ 
        valid: false, 
        errors: ['Artifact for version 2.0.0 not found'] 
      })

      await expect(verifyCommand(mockEngine as MigrationEngine, '2.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Artifact for version 2.0.0 not found'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe('version formatting', () => {
    it('should format version with v prefix in output', async () => {
      await expect(verifyCommand(mockEngine as MigrationEngine, '2.1.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Verification Report for v2.1.0'))
    })

    it('should pass raw version to engine', async () => {
      await expect(verifyCommand(mockEngine as MigrationEngine, '3.0.0-beta.1', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockEngine.verify).toHaveBeenCalledWith('3.0.0-beta.1')
    })
  })

  describe('environment handling', () => {
    it('should display different environments correctly', async () => {
      const environments = ['development', 'staging', 'production', 'test']

      for (const env of environments) {
        consoleLogSpy.mockClear()
        mockExit.mockClear()
        
        await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env }))
          .rejects.toThrow('Process exit')
        
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Environment: ${env}`))
      }
    })
  })

  describe('exit codes', () => {
    it('should exit with 0 on successful verification', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ valid: true, errors: [] })

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('should exit with 1 on failed verification', async () => {
      mockEngine.verify = vi.fn().mockResolvedValue({ valid: false, errors: ['Error'] })

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should exit with 1 on exception', async () => {
      mockEngine.verify = vi.fn().mockRejectedValue(new Error('Failed'))

      await expect(verifyCommand(mockEngine as MigrationEngine, '1.0.0', { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })
})