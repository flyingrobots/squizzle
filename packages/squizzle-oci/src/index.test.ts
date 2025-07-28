import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OCIStorage } from './index'
import { StorageError } from '@squizzle/core'
import * as https from 'https'
import * as http from 'http'
import { EventEmitter } from 'events'
import * as fs from 'fs'

// Mock modules
vi.mock('fs')
vi.mock('child_process')
vi.mock('https')
vi.mock('http')

// Helper to create mock HTTP response
class MockResponse extends EventEmitter {
  statusCode: number
  headers: http.IncomingHttpHeaders
  
  constructor(statusCode: number, headers: http.IncomingHttpHeaders = {}) {
    super()
    this.statusCode = statusCode
    this.headers = headers
  }

  simulateData(data: string) {
    this.emit('data', data)
    this.emit('end')
  }
}

// Helper to create mock HTTP request
class MockRequest extends EventEmitter {
  public destroyed = false
  
  write = vi.fn()
  end = vi.fn()
  
  destroy = vi.fn(() => {
    this.destroyed = true
  })
  
  setTimeout = vi.fn()
}

describe('OCIStorage', () => {
  let storage: OCIStorage

  beforeEach(() => {
    vi.clearAllMocks()
    
    storage = new OCIStorage({
      registry: 'registry.example.com',
      repository: 'test-repo'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('list()', () => {
    it('should return empty array when repository does not exist', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(404)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData('{"errors":[{"code":"NAME_UNKNOWN"}]}')
        })
        return mockReq as any
      })

      const versions = await storage.list()
      
      expect(versions).toEqual([])
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'registry.example.com',
          path: '/v2/test-repo/tags/list'
        }),
        expect.any(Function)
      )
    })

    it('should return sorted versions from tags', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(200)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData(JSON.stringify({
            name: 'test-repo',
            tags: ['v1.0.0', 'v2.1.0', 'v1.5.0', 'latest', 'v1.0.0-beta.1', 'invalid']
          }))
        })
        return mockReq as any
      })

      const versions = await storage.list()
      
      expect(versions).toEqual(['1.0.0-beta.1', '1.0.0', '1.5.0', '2.1.0'])
    })

    it('should handle pagination with Link header', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // First page
            const mockRes = new MockResponse(200, {
              link: '<https://registry.example.com/v2/test-repo/tags/list?n=10&last=v1.5.0>; rel="next"'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({
              name: 'test-repo',
              tags: ['v1.0.0', 'v1.2.0', 'v1.5.0']
            }))
          } else {
            // Second page
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({
              name: 'test-repo',
              tags: ['v1.8.0', 'v2.0.0']
            }))
          }
        })
        
        return mockReq as any
      })

      const versions = await storage.list()
      
      expect(versions).toEqual(['1.0.0', '1.2.0', '1.5.0', '1.8.0', '2.0.0'])
      expect(https.request).toHaveBeenCalledTimes(2)
    })

    it('should handle authentication challenge', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // First request returns 401
            const mockRes = new MockResponse(401, {
              'www-authenticate': 'Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:test-repo:pull"'
            })
            callback(mockRes)
            mockRes.simulateData('')
          } else if (callCount === 2) {
            // Auth token request
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ token: 'test-token' }))
          } else {
            // Retry with token
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({
              name: 'test-repo',
              tags: ['v1.0.0']
            }))
          }
        })
        
        return mockReq as any
      })

      const versions = await storage.list()
      
      expect(versions).toEqual(['1.0.0'])
      expect(https.request).toHaveBeenCalledTimes(3)
      
      // Check auth header was added
      const lastCall = vi.mocked(https.request).mock.calls[2][0]
      expect(lastCall.headers.Authorization).toBe('Bearer test-token')
    })

    it('should throw StorageError on HTTP errors', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(500)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData('Internal Server Error')
        })
        return mockReq as any
      })

      await expect(storage.list()).rejects.toThrow(StorageError)
      await expect(storage.list()).rejects.toThrow('Failed to list tags: HTTP 500')
    })

    it('should handle network errors', async () => {
      const mockReq = new MockRequest()
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          mockReq.emit('error', new Error('Network error'))
        })
        return mockReq as any
      })

      await expect(storage.list()).rejects.toThrow(StorageError)
      await expect(storage.list()).rejects.toThrow('HTTP request failed: Network error')
    })

    it('should handle request timeout', async () => {
      const mockReq = new MockRequest()
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        mockReq.setTimeout.mockImplementation((timeout, cb) => {
          // Simulate timeout
          setImmediate(() => cb())
        })
        return mockReq as any
      })

      await expect(storage.list()).rejects.toThrow(StorageError)
      await expect(storage.list()).rejects.toThrow('HTTP request timeout')
    })

    it('should filter out non-semver tags', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(200)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData(JSON.stringify({
            name: 'test-repo',
            tags: ['v1.0.0', 'v1.2', 'latest', 'v', 'vtest', 'v1.0.0.0', '1.0.0']
          }))
        })
        return mockReq as any
      })

      const versions = await storage.list()
      
      expect(versions).toEqual(['1.0.0'])
    })

    it('should use insecure protocol when configured', async () => {
      const insecureStorage = new OCIStorage({
        registry: 'registry.example.com',
        repository: 'test-repo',
        insecure: true
      })

      const mockReq = new MockRequest()
      const mockRes = new MockResponse(200)
      
      vi.mocked(http.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData(JSON.stringify({
            name: 'test-repo',
            tags: ['v1.0.0']
          }))
        })
        return mockReq as any
      })

      const versions = await insecureStorage.list()
      
      expect(versions).toEqual(['1.0.0'])
      expect(http.request).toHaveBeenCalled()
      expect(https.request).not.toHaveBeenCalled()
    })
  })

  describe('delete()', () => {
    it('should successfully delete a version', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // GET manifest
            const mockRes = new MockResponse(200, {
              'docker-content-digest': 'sha256:abc123'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ layers: [] }))
          } else if (callCount === 2) {
            // DELETE by digest
            const mockRes = new MockResponse(202)
            callback(mockRes)
            mockRes.simulateData('')
          } else if (callCount === 3) {
            // HEAD to verify deletion
            const mockRes = new MockResponse(404)
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      await storage.delete('1.0.0')
      
      expect(https.request).toHaveBeenCalledTimes(3)
      
      // Check DELETE was called with digest
      const deleteCall = vi.mocked(https.request).mock.calls[1][0]
      expect(deleteCall.method).toBe('DELETE')
      expect(deleteCall.path).toBe('/v2/test-repo/manifests/sha256:abc123')
    })

    it('should throw error when version not found', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(404)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData('')
        })
        return mockReq as any
      })

      await expect(storage.delete('1.0.0')).rejects.toThrow(StorageError)
      await expect(storage.delete('1.0.0')).rejects.toThrow('Version 1.0.0 not found in registry')
    })

    it('should throw error when digest not found', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(200, {})
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData(JSON.stringify({ layers: [] }))
        })
        return mockReq as any
      })

      await expect(storage.delete('1.0.0')).rejects.toThrow(StorageError)
      await expect(storage.delete('1.0.0')).rejects.toThrow('No digest found for version 1.0.0')
    })

    it('should handle registry that does not support deletion', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // GET manifest
            const mockRes = new MockResponse(200, {
              'docker-content-digest': 'sha256:abc123'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ layers: [] }))
          } else {
            // DELETE returns 405
            const mockRes = new MockResponse(405)
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      await expect(storage.delete('1.0.0')).rejects.toThrow(StorageError)
      await expect(storage.delete('1.0.0')).rejects.toThrow('Registry does not support deletion')
    })

    it('should handle insufficient permissions', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // GET manifest
            const mockRes = new MockResponse(200, {
              'docker-content-digest': 'sha256:abc123'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ layers: [] }))
          } else {
            // DELETE returns 403
            const mockRes = new MockResponse(403)
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      await expect(storage.delete('1.0.0')).rejects.toThrow(StorageError)
      await expect(storage.delete('1.0.0')).rejects.toThrow('Insufficient permissions to delete from registry')
    })

    it('should handle already deleted (404 on DELETE)', async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // GET manifest
            const mockRes = new MockResponse(200, {
              'docker-content-digest': 'sha256:abc123'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ layers: [] }))
          } else {
            // DELETE returns 404 (already deleted)
            const mockRes = new MockResponse(404)
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      // Should not throw
      await expect(storage.delete('1.0.0')).resolves.toBeUndefined()
    })

    it('should throw error if deletion verification fails', { timeout: 10000 }, async () => {
      let callCount = 0
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            // GET manifest
            const mockRes = new MockResponse(200, {
              'docker-content-digest': 'sha256:abc123'
            })
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ layers: [] }))
          } else if (callCount === 2) {
            // DELETE succeeds
            const mockRes = new MockResponse(202)
            callback(mockRes)
            mockRes.simulateData('')
          } else if (callCount === 3) {
            // HEAD still returns 200 (not deleted)
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      await expect(storage.delete('1.0.0')).rejects.toThrow(StorageError)
      await expect(storage.delete('1.0.0')).rejects.toThrow('Failed to verify deletion of version 1.0.0')
    })

    it('should use correct Accept headers for manifest', async () => {
      const mockReq = new MockRequest()
      const mockRes = new MockResponse(404)
      
      vi.mocked(https.request).mockImplementation((_options: any, callback: any) => {
        setImmediate(() => {
          callback(mockRes)
          mockRes.simulateData('')
        })
        return mockReq as any
      })

      try {
        await storage.delete('1.0.0')
      } catch {
        // Expected to throw
      }

      const call = vi.mocked(https.request).mock.calls[0][0]
      expect(call.headers.Accept).toContain('application/vnd.docker.distribution.manifest.v2+json')
      expect(call.headers.Accept).toContain('application/vnd.oci.image.manifest.v1+json')
    })
  })

  describe('authentication', () => {
    it('should read Docker config when available', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        auths: {
          'registry.example.com': {
            auth: Buffer.from('user:pass').toString('base64')
          }
        }
      }) as any)

      const authStorage = new OCIStorage({
        registry: 'registry.example.com'
      })

      // Trigger auth by making request that returns 401
      let callCount = 0
      vi.mocked(https.request).mockImplementation((options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            const mockRes = new MockResponse(401, {
              'www-authenticate': 'Bearer realm="https://auth.example.com/token"'
            })
            callback(mockRes)
            mockRes.simulateData('')
          } else if (callCount === 2) {
            // Auth request should have basic auth
            expect(options.headers?.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ token: 'test-token' }))
          } else {
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ name: 'test-repo', tags: [] }))
          }
        })
        
        return mockReq as any
      })

      await authStorage.list()
    })

    it('should use explicit credentials over Docker config', async () => {
      const authStorage = new OCIStorage({
        registry: 'registry.example.com',
        username: 'explicit-user',
        password: 'explicit-pass'
      })

      let callCount = 0
      vi.mocked(https.request).mockImplementation((options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          callCount++
          
          if (callCount === 1) {
            const mockRes = new MockResponse(401, {
              'www-authenticate': 'Bearer realm="https://auth.example.com/token"'
            })
            callback(mockRes)
            mockRes.simulateData('')
          } else if (callCount === 2) {
            // Should use explicit credentials
            expect(options.headers?.Authorization).toBe(
              `Basic ${Buffer.from('explicit-user:explicit-pass').toString('base64')}`
            )
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ token: 'test-token' }))
          } else {
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ name: 'test-repo', tags: [] }))
          }
        })
        
        return mockReq as any
      })

      await authStorage.list()
    })

    it('should cache auth tokens', async () => {
      let authCallCount = 0
      
      vi.mocked(https.request).mockImplementation((options: any, callback: any) => {
        const mockReq = new MockRequest()
        
        setImmediate(() => {
          const isAuthRequest = options.hostname === 'auth.example.com'
          
          if (isAuthRequest) {
            authCallCount++
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ 
              token: 'test-token',
              expires_in: 300
            }))
          } else if (options.headers?.Authorization) {
            // Regular request with auth
            const mockRes = new MockResponse(200)
            callback(mockRes)
            mockRes.simulateData(JSON.stringify({ name: 'test-repo', tags: [] }))
          } else {
            // Initial 401
            const mockRes = new MockResponse(401, {
              'www-authenticate': 'Bearer realm="https://auth.example.com/token"'
            })
            callback(mockRes)
            mockRes.simulateData('')
          }
        })
        
        return mockReq as any
      })

      // First call should trigger auth
      await storage.list()
      expect(authCallCount).toBe(1)

      // Second call should use cached token
      await storage.list()
      expect(authCallCount).toBe(1)
    })
  })
})