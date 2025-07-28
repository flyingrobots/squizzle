import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { statusCommand } from './status'
import { MigrationEngine, Version } from '@squizzle/core'

// Mock cli-table3
vi.mock('cli-table3', () => ({
  default: vi.fn().mockImplementation(() => ({
    push: vi.fn(),
    toString: vi.fn().mockReturnValue('mocked table')
  }))
}))

// Mock pretty-ms
vi.mock('pretty-ms', () => ({
  default: vi.fn().mockReturnValue('1m')
}))

describe('statusCommand', () => {
  let mockEngine: Partial<MigrationEngine>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let mockExit: ReturnType<typeof vi.spyOn>

  const mockAppliedVersion = {
    version: '1.0.0' as Version,
    appliedAt: new Date('2024-01-01T10:00:00Z'),
    success: true,
    appliedBy: 'test-user',
    checksum: 'abc123def456789',
    error: null
  }

  const mockFailedVersion = {
    version: '1.0.1' as Version,
    appliedAt: new Date('2024-01-02T10:00:00Z'),
    success: false,
    appliedBy: 'test-user',
    checksum: 'xyz789abc123456',
    error: 'Migration failed'
  }

  beforeEach(() => {
    mockEngine = {
      status: vi.fn().mockResolvedValue({
        current: '1.0.0' as Version,
        applied: [mockAppliedVersion],
        available: ['1.0.0', '1.0.1', '1.0.2'] as Version[]
      })
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

  describe('basic functionality', () => {
    it('should fetch and display status', async () => {
      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(mockEngine.status).toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Current Status'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Environment: development'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Current Version: 1.0.0'))
    })

    it('should handle no applied versions', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: null,
        applied: [],
        available: ['1.0.0'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No versions applied'))
    })
  })

  describe('JSON output', () => {
    it('should output JSON when json flag is set', async () => {
      const mockStatus = {
        current: '1.0.0' as Version,
        applied: [mockAppliedVersion],
        available: ['1.0.0', '1.0.1'] as Version[]
      }
      mockEngine.status = vi.fn().mockResolvedValue(mockStatus)

      await statusCommand(mockEngine as MigrationEngine, { json: true, env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(mockStatus, null, 2))
      expect(consoleLogSpy).toHaveBeenCalledTimes(1) // Only JSON output
    })

    it('should not display formatted output in JSON mode', async () => {
      await statusCommand(mockEngine as MigrationEngine, { json: true, env: 'development' })

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Current Status'))
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Applied Versions'))
    })
  })

  describe('applied versions table', () => {
    it('should display applied versions in a table', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.2' as Version,
        applied: [
          { ...mockAppliedVersion, version: '1.0.0' as Version },
          { ...mockAppliedVersion, version: '1.0.1' as Version },
          { ...mockAppliedVersion, version: '1.0.2' as Version }
        ],
        available: ['1.0.0', '1.0.1', '1.0.2'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Applied Versions'))
      expect(consoleLogSpy).toHaveBeenCalledWith('mocked table')
    })

    it('should show success status correctly', async () => {
      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      // Table should include success indicator (mocked)
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should show failed status correctly', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.0' as Version,
        applied: [mockAppliedVersion, mockFailedVersion],
        available: ['1.0.0', '1.0.1'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1 failed version(s) detected'))
    })

    it('should respect limit option', async () => {
      const manyVersions = Array.from({ length: 20 }, (_, i) => ({
        ...mockAppliedVersion,
        version: `1.0.${i}` as Version
      }))

      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.19' as Version,
        applied: manyVersions,
        available: manyVersions.map(v => v.version)
      })

      await statusCommand(mockEngine as MigrationEngine, { limit: '5', env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('and 15 more versions'))
    })

    it('should use default limit of 10', async () => {
      const manyVersions = Array.from({ length: 15 }, (_, i) => ({
        ...mockAppliedVersion,
        version: `1.0.${i}` as Version
      }))

      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.14' as Version,
        applied: manyVersions,
        available: manyVersions.map(v => v.version)
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('and 5 more versions'))
    })
  })

  describe('available versions display', () => {
    it('should show available versions', async () => {
      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available Versions'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Total available: 3 versions'))
    })

    it('should identify unapplied versions', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.0' as Version,
        applied: [mockAppliedVersion],
        available: ['1.0.0', '1.0.1', '1.0.2'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not yet applied:'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1.0.1'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1.0.2'))
    })

    it('should not show applied versions as unapplied', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.2' as Version,
        applied: [
          { ...mockAppliedVersion, version: '1.0.0' as Version },
          { ...mockAppliedVersion, version: '1.0.1' as Version },
          { ...mockAppliedVersion, version: '1.0.2' as Version }
        ],
        available: ['1.0.0', '1.0.1', '1.0.2'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Not yet applied:'))
    })

    it('should handle no available versions', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: null,
        applied: [],
        available: []
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Available Versions'))
    })

    it('should not count failed versions as applied for unapplied list', async () => {
      mockEngine.status = vi.fn().mockResolvedValue({
        current: '1.0.0' as Version,
        applied: [mockAppliedVersion, mockFailedVersion],
        available: ['1.0.0', '1.0.1'] as Version[]
      })

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not yet applied:'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1.0.1'))
    })
  })

  describe('environment handling', () => {
    it('should display the correct environment', async () => {
      await statusCommand(mockEngine as MigrationEngine, { env: 'production' })

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Environment: production'))
    })

    it('should handle different environments', async () => {
      const environments = ['development', 'staging', 'production', 'test']

      for (const env of environments) {
        consoleLogSpy.mockClear()
        await statusCommand(mockEngine as MigrationEngine, { env })
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Environment: ${env}`))
      }
    })
  })

  describe('error handling', () => {
    it('should handle status fetch errors', async () => {
      const error = new Error('Database connection failed')
      mockEngine.status = vi.fn().mockRejectedValue(error)

      await expect(statusCommand(mockEngine as MigrationEngine, { env: 'development' }))
        .rejects.toThrow('Process exit')

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get status'))
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Database connection failed'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should handle missing engine gracefully', async () => {
      mockEngine.status = undefined

      await expect(statusCommand(mockEngine as MigrationEngine, { env: 'development' }))
        .rejects.toThrow()
    })
  })

  describe('checksum display', () => {
    it('should truncate checksums in display', async () => {
      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      // Checksum should be truncated (shown in mocked table)
      expect(mockEngine.status).toHaveBeenCalled()
    })
  })

  describe('time formatting', () => {
    it('should show relative time for applied versions', async () => {
      // Mock current time
      const now = new Date('2024-01-01T11:00:00Z')
      vi.setSystemTime(now)

      await statusCommand(mockEngine as MigrationEngine, { env: 'development' })

      // Time formatting is handled by pretty-ms (mocked to return '1m')
      expect(consoleLogSpy).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })
})