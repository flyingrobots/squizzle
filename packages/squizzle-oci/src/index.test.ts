import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OCIStorage, FilesystemStorage, createOCIStorage, OCIStorageOptions } from './index'
import { StorageError, Version, Manifest } from '@squizzle/core'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

// Mock fs module
vi.mock('fs', () => ({
  default: {},
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn()
}))

// Mock https module
vi.mock('https', () => ({
  request: vi.fn()
}))

// Mock http module
vi.mock('http', () => ({
  request: vi.fn()
}))

describe('OCIStorage', () => {
  let storage: OCIStorage
  let mockExecSync: jest.Mock
  let mockFs: typeof fs
  let mockHttpsRequest: jest.Mock
  let mockHttpRequest: jest.Mock

  beforeEach(() => {
    mockExecSync = execSync as unknown as jest.Mock
    mockFs = fs as any
    mockHttpsRequest = https.request as unknown as jest.Mock
    mockHttpRequest = http.request as unknown as jest.Mock
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create storage with registry and default repository', () => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
      
      expect(storage).toBeDefined()
    })

    it('should use custom repository if provided', () => {
      storage = new OCIStorage({ 
        registry: 'localhost:5000',
        repository: 'my-artifacts'
      })
      
      expect(storage).toBeDefined()
    })

    it('should login if credentials provided', () => {
      storage = new OCIStorage({
        registry: 'localhost:5000',
        username: 'user',
        password: 'pass'
      })

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker login localhost:5000'),
        { stdio: 'pipe' }
      )
    })

    it('should throw StorageError on login failure', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Login failed')
      })

      expect(() => new OCIStorage({
        registry: 'localhost:5000',
        username: 'user',
        password: 'pass'
      })).toThrow(StorageError)
    })
  })

  describe('push', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
      mockExecSync.mockReturnValue('')
    })

    it('should push artifact to registry', async () => {
      const version = '1.0.0' as Version
      const artifact = Buffer.from('test artifact')
      const manifest: Manifest = {
        version,
        checksum: 'abc123',
        created: '2024-01-01T00:00:00Z',
        checksumAlgorithm: 'sha256',
        drizzleKit: '0.25.0',
        engineVersion: '2.0.0',
        notes: '',
        files: [],
        dependencies: [],
        platform: { os: 'linux', arch: 'x64', node: 'v18.0.0' }
      }

      const result = await storage.push(version, artifact, manifest)

      expect(result).toBe('localhost:5000/squizzle-artifacts:v1.0.0')
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('mkdir -p /tmp/squizzle-'))
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'), expect.any(String))
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('artifact.tar.gz'), artifact)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('manifest.json'), JSON.stringify(manifest))
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker build'), { stdio: 'pipe' })
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker push'), { stdio: 'pipe' })
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('rm -rf'))
    })

    it('should include version labels in dockerfile', async () => {
      const version = '2.0.0' as Version
      const manifest = { 
        version,
        checksum: 'def456',
        created: '2024-01-01T00:00:00Z'
      } as Manifest

      await storage.push(version, Buffer.from('test'), manifest)

      const dockerfileCall = mockFs.writeFileSync.mock.calls.find(
        call => call[0].endsWith('Dockerfile')
      )
      const dockerfileContent = dockerfileCall![1]

      expect(dockerfileContent).toContain('LABEL org.opencontainers.image.version="2.0.0"')
      expect(dockerfileContent).toContain('LABEL io.squizzle.version="2.0.0"')
      expect(dockerfileContent).toContain('LABEL io.squizzle.checksum="def456"')
    })

    it('should cleanup temp directory on error', async () => {
      mockExecSync
        .mockReturnValueOnce('') // mkdir
        .mockImplementationOnce(() => { throw new Error('Build failed') }) // docker build

      await expect(storage.push('1.0.0' as Version, Buffer.from('test'), {} as Manifest))
        .rejects.toThrow(StorageError)

      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('rm -rf'))
    })

    it('should throw StorageError on push failure', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Push failed')
      })

      await expect(storage.push('1.0.0' as Version, Buffer.from('test'), {} as Manifest))
        .rejects.toThrow(StorageError)
    })
  })

  describe('pull', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
    })

    it('should pull artifact from registry', async () => {
      const artifactData = Buffer.from('test artifact data')
      const manifestData = { version: '1.0.0', checksum: 'abc123' }

      mockExecSync
        .mockReturnValueOnce('') // docker pull
        .mockReturnValueOnce('container123\n') // docker create
        .mockReturnValueOnce('') // docker cp artifact
        .mockReturnValueOnce('') // docker cp manifest
        .mockReturnValueOnce('') // docker rm
        .mockReturnValueOnce('') // rm cleanup

      mockFs.readFileSync
        .mockReturnValueOnce(artifactData) // artifact
        .mockReturnValueOnce(JSON.stringify(manifestData)) // manifest

      const result = await storage.pull('1.0.0' as Version)

      expect(result.artifact).toEqual(artifactData)
      expect(result.manifest).toEqual(manifestData)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker pull localhost:5000/squizzle-artifacts:v1.0.0'), { stdio: 'pipe' })
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker create'), expect.any(Object))
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker cp container123:/artifact.tar.gz'))
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker cp container123:/manifest.json'))
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker rm container123'))
    })

    it('should cleanup container on error', async () => {
      mockExecSync
        .mockReturnValueOnce('') // docker pull
        .mockReturnValueOnce('container456\n') // docker create
        .mockImplementationOnce(() => { throw new Error('Copy failed') }) // docker cp

      await expect(storage.pull('1.0.0' as Version))
        .rejects.toThrow(StorageError)

      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('docker rm container456'))
    })

    it('should throw StorageError on pull failure', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Pull failed')
      })

      await expect(storage.pull('1.0.0' as Version))
        .rejects.toThrow(StorageError)
    })
  })

  describe('exists', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
    })

    it('should return true if version exists', async () => {
      mockExecSync.mockReturnValue('')

      const result = await storage.exists('1.0.0' as Version)

      expect(result).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker manifest inspect localhost:5000/squizzle-artifacts:v1.0.0',
        { stdio: 'pipe' }
      )
    })

    it('should return false if version does not exist', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('manifest unknown')
      })

      const result = await storage.exists('1.0.0' as Version)

      expect(result).toBe(false)
    })
  })

  describe('list', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
    })

    it('should return empty array (not implemented)', async () => {
      // Mock the HTTP request to return a 404 (repository not found)
      const mockResponse = {
        statusCode: 404,
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'data') callback('{"errors":[{"code":"NAME_UNKNOWN"}]}')
          if (event === 'end') callback()
        })
      }
      
      const mockRequest = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn()
      }
      
      mockHttpsRequest.mockReturnValue(mockRequest)
      
      // Immediately trigger the response
      setTimeout(() => {
        const responseCallback = mockHttpsRequest.mock.calls[0][1]
        responseCallback(mockResponse)
      }, 0)

      const result = await storage.list()

      expect(result).toEqual([])
    }, 10000)

    it('should throw StorageError on list failure', async () => {
      // Mock the HTTP request to fail
      const mockRequest = {
        on: vi.fn((event, callback) => {
          if (event === 'error') callback(new Error('Connection failed'))
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn()
      }
      
      mockHttpsRequest.mockReturnValue(mockRequest)

      await expect(storage.list()).rejects.toThrow(StorageError)
    }, 10000)
  })

  describe('delete', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
    })

    it('should throw not implemented error', async () => {
      // Create mock response objects
      const createMockResponse = (statusCode: number, data: string, headers: any = {}) => {
        const chunks: string[] = []
        const listeners: { [key: string]: Function[] } = {
          data: [],
          end: []
        }
        
        return {
          statusCode,
          headers,
          on: vi.fn((event: string, callback: Function) => {
            if (!listeners[event]) listeners[event] = []
            listeners[event].push(callback)
            
            // Simulate async response
            if (event === 'end') {
              setImmediate(() => {
                listeners.data.forEach(cb => cb(data))
                listeners.end.forEach(cb => cb())
              })
            }
          })
        }
      }
      
      // Create mock request object
      const createMockRequest = (response: any) => {
        const req = {
          on: vi.fn(),
          setTimeout: vi.fn(),
          destroy: vi.fn(),
          write: vi.fn(),
          end: vi.fn(() => {
            // Simulate calling the response callback
            setImmediate(() => {
              const callback = mockHttpsRequest.mock.calls[mockHttpsRequest.mock.calls.length - 1][1]
              if (callback) callback(response)
            })
          })
        }
        return req
      }
      
      let callCount = 0
      mockHttpsRequest.mockImplementation((options, callback) => {
        callCount++
        if (callCount === 1) {
          // First call: GET manifest
          const response = createMockResponse(200, '{"schemaVersion":2}', { 'docker-content-digest': 'sha256:abc123' })
          return createMockRequest(response)
        } else if (callCount === 2) {
          // Second call: DELETE manifest
          const response = createMockResponse(405, '{"errors":[{"code":"UNSUPPORTED"}]}')
          return createMockRequest(response)
        }
      })

      await expect(storage.delete('1.0.0' as Version))
        .rejects.toThrow('Registry does not support deletion')
    }, 10000)
  })

  describe('getManifest', () => {
    beforeEach(() => {
      storage = new OCIStorage({ registry: 'localhost:5000' })
    })

    it('should get manifest by pulling artifact', async () => {
      const manifestData = { version: '1.0.0', checksum: 'abc123' }

      mockExecSync
        .mockReturnValueOnce('') // docker pull
        .mockReturnValueOnce('container123\n') // docker create
        .mockReturnValueOnce('') // docker cp artifact
        .mockReturnValueOnce('') // docker cp manifest
        .mockReturnValueOnce('') // docker rm
        .mockReturnValueOnce('') // rm cleanup

      mockFs.readFileSync
        .mockReturnValueOnce(Buffer.from('artifact'))
        .mockReturnValueOnce(JSON.stringify(manifestData))

      const result = await storage.getManifest('1.0.0' as Version)

      expect(result).toEqual(manifestData)
    })
  })
})

describe('FilesystemStorage', () => {
  let storage: FilesystemStorage
  let mockFs: typeof fs
  const testPath = '/tmp/test-artifacts'

  beforeEach(() => {
    mockFs = fs as any
    vi.clearAllMocks()
    mockFs.mkdirSync.mockReturnValue(undefined)
    storage = new FilesystemStorage(testPath)
  })

  describe('constructor', () => {
    it('should create base directory', () => {
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(testPath, { recursive: true })
    })
  })

  describe('push', () => {
    it('should write artifact and manifest files', async () => {
      const version = '1.0.0' as Version
      const artifact = Buffer.from('test artifact')
      const manifest = { version, checksum: 'abc123' } as Manifest

      const result = await storage.push(version, artifact, manifest)

      expect(result).toBe(`${testPath}/squizzle-v1.0.0.tar.gz`)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        `${testPath}/squizzle-v1.0.0.tar.gz`,
        artifact
      )
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        `${testPath}/squizzle-v1.0.0.manifest.json`,
        JSON.stringify(manifest, null, 2)
      )
    })
  })

  describe('pull', () => {
    it('should read artifact and manifest files', async () => {
      const artifactData = Buffer.from('test artifact')
      const manifestData = { version: '1.0.0', checksum: 'abc123' }

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync
        .mockReturnValueOnce(artifactData)
        .mockReturnValueOnce(JSON.stringify(manifestData))

      const result = await storage.pull('1.0.0' as Version)

      expect(result.artifact).toEqual(artifactData)
      expect(result.manifest).toEqual(manifestData)
      expect(mockFs.readFileSync).toHaveBeenCalledWith(`${testPath}/squizzle-v1.0.0.tar.gz`)
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        `${testPath}/squizzle-v1.0.0.manifest.json`,
        'utf-8'
      )
    })

    it('should throw StorageError if artifact not found', async () => {
      mockFs.existsSync.mockReturnValue(false)

      await expect(storage.pull('1.0.0' as Version))
        .rejects.toThrow(StorageError)
      await expect(storage.pull('1.0.0' as Version))
        .rejects.toThrow('Artifact not found: 1.0.0')
    })
  })

  describe('exists', () => {
    it('should check if artifact file exists', async () => {
      mockFs.existsSync.mockReturnValue(true)

      const result = await storage.exists('1.0.0' as Version)

      expect(result).toBe(true)
      expect(mockFs.existsSync).toHaveBeenCalledWith(`${testPath}/squizzle-v1.0.0.tar.gz`)
    })

    it('should return false if artifact does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const result = await storage.exists('1.0.0' as Version)

      expect(result).toBe(false)
    })
  })

  describe('list', () => {
    it('should list all artifact versions', async () => {
      mockFs.readdirSync.mockReturnValue([
        'squizzle-v1.0.0.tar.gz',
        'squizzle-v1.0.1.tar.gz',
        'squizzle-v2.0.0.tar.gz',
        'squizzle-v1.0.0.manifest.json',
        'other-file.txt'
      ])

      const result = await storage.list()

      expect(result).toEqual(['1.0.0', '1.0.1', '2.0.0'])
      expect(mockFs.readdirSync).toHaveBeenCalledWith(testPath)
    })

    it('should return empty array if no artifacts', async () => {
      mockFs.readdirSync.mockReturnValue(['readme.txt'])

      const result = await storage.list()

      expect(result).toEqual([])
    })

    it('should sort versions', async () => {
      mockFs.readdirSync.mockReturnValue([
        'squizzle-v2.0.0.tar.gz',
        'squizzle-v1.0.0.tar.gz',
        'squizzle-v1.1.0.tar.gz'
      ])

      const result = await storage.list()

      expect(result).toEqual(['1.0.0', '1.1.0', '2.0.0'])
    })
  })

  describe('delete', () => {
    it('should delete artifact and manifest files', async () => {
      await storage.delete('1.0.0' as Version)

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${testPath}/squizzle-v1.0.0.tar.gz`)
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${testPath}/squizzle-v1.0.0.manifest.json`)
    })
  })

  describe('getManifest', () => {
    it('should read manifest file', async () => {
      const manifestData = { version: '1.0.0', checksum: 'abc123' }
      mockFs.readFileSync.mockReturnValue(JSON.stringify(manifestData))

      const result = await storage.getManifest('1.0.0' as Version)

      expect(result).toEqual(manifestData)
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        `${testPath}/squizzle-v1.0.0.manifest.json`,
        'utf-8'
      )
    })
  })
})

describe('createOCIStorage factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create FilesystemStorage for filesystem type', () => {
    const storage = createOCIStorage({ type: 'filesystem', path: '/custom/path' })

    expect(storage).toBeInstanceOf(FilesystemStorage)
  })

  it('should use default path for filesystem storage', () => {
    const storage = createOCIStorage({ type: 'filesystem' })

    expect(storage).toBeInstanceOf(FilesystemStorage)
  })

  it('should create OCIStorage for oci type', () => {
    const storage = createOCIStorage({ type: 'oci', registry: 'localhost:5000' })

    expect(storage).toBeInstanceOf(OCIStorage)
  })

  it('should throw error for oci type without registry', () => {
    expect(() => createOCIStorage({ type: 'oci' }))
      .toThrow('OCI storage requires registry option')
  })

  it('should throw error for unknown storage type', () => {
    expect(() => createOCIStorage({ type: 'unknown' } as any))
      .toThrow('Unknown storage type: unknown')
  })

  it('should create OCIStorage when options is OCIStorageOptions', () => {
    const storage = createOCIStorage({ registry: 'localhost:5000' })

    expect(storage).toBeInstanceOf(OCIStorage)
  })
})