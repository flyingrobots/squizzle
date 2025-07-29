import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pushToStorage, verifyPush } from './build'
import { StorageError } from '@squizzle/core'
import { createOCIStorage } from '@squizzle/oci'
import ora from 'ora'

// Mock dependencies
vi.mock('@squizzle/oci', () => ({
  createOCIStorage: vi.fn()
}))

describe('build command storage integration', () => {
  let mockStorage: any
  let mockPush: any
  let mockExists: any
  let mockGetManifest: any
  let mockSpinner: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup mock storage
    mockPush = vi.fn().mockResolvedValue('ghcr.io/test/repo:v1.0.0')
    mockExists = vi.fn().mockResolvedValue(true)
    mockGetManifest = vi.fn().mockResolvedValue({ version: '1.0.0' })
    
    mockStorage = {
      push: mockPush,
      exists: mockExists,
      getManifest: mockGetManifest
    }

    vi.mocked(createOCIStorage).mockReturnValue(mockStorage)

    // Mock spinner
    mockSpinner = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      text: ''
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.SQUIZZLE_REGISTRY
    delete process.env.SQUIZZLE_REPOSITORY
  })

  describe('pushToStorage', () => {
    it('should push artifact with correct parameters', async () => {
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      const url = await pushToStorage('1.0.0', buffer, manifest, options, mockSpinner)
      
      expect(mockPush).toHaveBeenCalledWith('1.0.0', buffer, manifest)
      expect(url).toBe('ghcr.io/test/repo:v1.0.0')
    })

    it('should use registry override from options', async () => {
      const options = {
        registry: 'docker.io',
        repository: 'myorg/myrepo',
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      await pushToStorage('1.0.0', buffer, manifest, options, mockSpinner)
      
      expect(createOCIStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          registry: 'docker.io',
          repository: 'myorg/myrepo'
        })
      )
    })

    it('should use environment variables for config', async () => {
      process.env.SQUIZZLE_REGISTRY = 'env-registry.io'
      process.env.SQUIZZLE_REPOSITORY = 'env/repo'
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      await pushToStorage('1.0.0', buffer, manifest, options, mockSpinner)
      
      expect(createOCIStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          registry: 'env-registry.io',
          repository: 'env/repo'
        })
      )
    })

    it('should report upload speed', async () => {
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.alloc(10 * 1024 * 1024) // 10MB
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      // Mock push to take some time
      mockPush.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve('ghcr.io/test/repo:v1.0.0'), 100))
      })
      
      await pushToStorage('1.0.0', buffer, manifest, options, mockSpinner)
      
      expect(mockSpinner.text).toContain('Pushed')
      expect(mockSpinner.text).toContain('MB')
    })

    it('should handle authentication errors with helpful message', async () => {
      mockPush.mockRejectedValue(new StorageError('401 Unauthorized'))
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      await expect(pushToStorage('1.0.0', buffer, manifest, options, mockSpinner))
        .rejects.toThrow(StorageError)
      
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
      )
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('docker login')
      )
      
      consoleError.mockRestore()
    })

    it('should handle network errors with helpful message', async () => {
      mockPush.mockRejectedValue(new StorageError('Network timeout'))
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      await expect(pushToStorage('1.0.0', buffer, manifest, options, mockSpinner))
        .rejects.toThrow(StorageError)
      
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Network error')
      )
      
      consoleError.mockRestore()
    })

    it('should handle repository not found errors', async () => {
      mockPush.mockRejectedValue(new StorageError('404 Not Found'))
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const buffer = Buffer.from('test content')
      const manifest = { version: '1.0.0', checksum: 'abc123' }
      
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      await expect(pushToStorage('1.0.0', buffer, manifest, options, mockSpinner))
        .rejects.toThrow(StorageError)
      
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Repository not found')
      )
      
      consoleError.mockRestore()
    })
  })

  describe('verifyPush', () => {
    it('should verify artifact exists after push', async () => {
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      await verifyPush('1.0.0', 1024, options, mockSpinner)
      
      expect(mockExists).toHaveBeenCalledWith('1.0.0')
      expect(mockGetManifest).toHaveBeenCalledWith('1.0.0')
    })

    it('should warn if verification fails but not throw', async () => {
      mockExists.mockResolvedValue(false)
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      // Should not throw
      await verifyPush('1.0.0', 1024, options, mockSpinner)
      
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Warning'),
        expect.any(String)
      )
      
      consoleWarn.mockRestore()
    })

    it('should warn if manifest version differs', async () => {
      mockGetManifest.mockResolvedValue({ version: '2.0.0' })
      
      const options = {
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      await verifyPush('1.0.0', 1024, options, mockSpinner)
      
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Stored version')
      )
      
      consoleWarn.mockRestore()
    })

    it('should use overridden storage config', async () => {
      const options = {
        registry: 'docker.io',
        repository: 'myorg/myrepo',
        config: {
          storage: {
            type: 'oci',
            registry: 'ghcr.io',
            repository: 'test/repo'
          }
        }
      }
      
      await verifyPush('1.0.0', 1024, options, mockSpinner)
      
      expect(createOCIStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          registry: 'docker.io',
          repository: 'myorg/myrepo'
        })
      )
    })
  })
})