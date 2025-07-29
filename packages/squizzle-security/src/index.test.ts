import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { 
  SigstoreProvider, 
  LocalSecurityProvider, 
  createSigstoreProvider, 
  createLocalProvider,
  SLSABuildInfo 
} from './index'
import { Manifest, Version } from '@squizzle/core'
import * as sigstore from 'sigstore'
import { createHash } from 'crypto'

// Mock sigstore
vi.mock('sigstore', () => ({
  sign: vi.fn(),
  verify: vi.fn()
}))

describe('SigstoreProvider', () => {
  let provider: SigstoreProvider
  let mockSign: jest.Mock
  let mockVerify: jest.Mock

  beforeEach(() => {
    provider = new SigstoreProvider({
      environment: {
        github_run_id: undefined,
        github_run_attempt: undefined,
        github_actor: undefined,
        github_event_name: undefined
      }
    })
    mockSign = sigstore.sign as unknown as jest.Mock
    mockVerify = sigstore.verify as unknown as jest.Mock
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create provider with default options', () => {
      const provider = new SigstoreProvider()
      expect(provider).toBeDefined()
    })

    it('should create provider with custom options', () => {
      const provider = new SigstoreProvider({
        fulcioURL: 'https://fulcio.custom',
        rekorURL: 'https://rekor.custom',
        tufMirrorURL: 'https://tuf.custom',
        identityToken: 'custom-token'
      })
      expect(provider).toBeDefined()
    })
  })

  describe('sign', () => {
    it('should sign data and return base64 encoded bundle', async () => {
      const testData = Buffer.from('test data')
      const mockBundle = { 
        messageSignature: { 
          messageDigest: { 
            algorithm: 'SHA2_256',
            digest: 'abc123' 
          },
          signature: 'sig123'
        }
      }

      mockSign.mockResolvedValue(mockBundle)

      const result = await provider.sign(testData)

      expect(mockSign).toHaveBeenCalledWith(testData)
      expect(result).toBe(Buffer.from(JSON.stringify(mockBundle)).toString('base64'))
    })

    it('should throw error on signing failure', async () => {
      mockSign.mockRejectedValue(new Error('Signing failed'))

      await expect(provider.sign(Buffer.from('test')))
        .rejects.toThrow('Failed to sign artifact: Error: Signing failed')
    })
  })

  describe('verify', () => {
    it('should verify valid signature', async () => {
      const testData = Buffer.from('test data')
      const mockBundle = { signature: 'valid' }
      const signature = Buffer.from(JSON.stringify(mockBundle)).toString('base64')

      mockVerify.mockResolvedValue(undefined) // Sigstore verify throws on failure

      const result = await provider.verify(testData, signature)

      expect(result).toBe(true)
      expect(mockVerify).toHaveBeenCalledWith(mockBundle, testData)
    })

    it('should return false for invalid signature', async () => {
      const testData = Buffer.from('test data')
      const signature = Buffer.from(JSON.stringify({ signature: 'invalid' })).toString('base64')

      mockVerify.mockRejectedValue(new Error('Verification failed'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await provider.verify(testData, signature)

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Signature verification failed:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })

    it('should handle malformed signature', async () => {
      const testData = Buffer.from('test data')
      const signature = 'not-valid-base64!!!'

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await provider.verify(testData, signature)

      expect(result).toBe(false)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('generateSLSA', () => {
    const mockManifest: Manifest = {
      version: '1.0.0' as Version,
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

    const mockBuildInfo: SLSABuildInfo = {
      repoURL: 'https://github.com/user/repo',
      commitSHA: 'abcdef123456',
      builderId: 'https://github.com/actions/runner',
      entryPoint: 'build.yaml',
      parameters: { version: '1.0.0' }
    }

    it('should generate SLSA provenance structure', async () => {
      const result = await provider.generateSLSA(mockManifest, mockBuildInfo)

      // Test structure
      expect(result).toHaveProperty('builderId')
      expect(result).toHaveProperty('buildType')
      expect(result).toHaveProperty('invocation')
      expect(result).toHaveProperty('materials')
      
      // Test that builder info is used
      expect(result.builderId).toBe(mockBuildInfo.builderId)
      expect(result.invocation.configSource.entryPoint).toBe(mockBuildInfo.entryPoint)
      expect(result.invocation.parameters).toEqual(mockBuildInfo.parameters)
      
      // Test that materials include the source repo
      expect(result.materials.length).toBeGreaterThan(0)
      expect(result.materials[0].uri).toContain(mockBuildInfo.repoURL)
      expect(result.materials[0].uri).toContain(mockBuildInfo.commitSHA)
    })

    it('should use default builder ID if not provided', async () => {
      const buildInfo = { ...mockBuildInfo, builderId: undefined }
      const result = await provider.generateSLSA(mockManifest, buildInfo)

      expect(result.builderId).toBe('https://github.com/squizzle/squizzle')
    })

    it('should use default entry point if not provided', async () => {
      const buildInfo = { ...mockBuildInfo, entryPoint: undefined }
      const result = await provider.generateSLSA(mockManifest, buildInfo)

      expect(result.invocation.configSource.entryPoint).toBe('.squizzle.yaml')
    })

    it('should use injected environment variables', async () => {
      // Create provider with injected environment
      const envProvider = new SigstoreProvider({
        environment: {
          github_run_id: 'test-run-123',
          github_run_attempt: '1',
          github_actor: 'test-user',
          github_event_name: 'push'
        }
      })
      
      const result = await envProvider.generateSLSA(mockManifest, mockBuildInfo)
      
      expect(result.invocation.environment).toEqual({
        github_run_id: 'test-run-123',
        github_run_attempt: '1',
        github_actor: 'test-user',
        github_event_name: 'push'
      })
    })

    it('should include dependency materials', async () => {
      const manifestWithDeps = {
        ...mockManifest,
        dependencies: ['0.9.0', '0.8.0'] as Version[]
      }

      const result = await provider.generateSLSA(manifestWithDeps, mockBuildInfo)

      expect(result.materials).toHaveLength(3)
      expect(result.materials[1]).toEqual({
        uri: 'pkg:squizzle/0.9.0',
        digest: { sha1: 'TODO' }
      })
      expect(result.materials[2]).toEqual({
        uri: 'pkg:squizzle/0.8.0',
        digest: { sha1: 'TODO' }
      })
    })


    it('should handle empty parameters', async () => {
      const buildInfo = { ...mockBuildInfo, parameters: undefined }
      const result = await provider.generateSLSA(mockManifest, buildInfo)

      expect(result.invocation.parameters).toEqual({})
    })
  })
})

describe('LocalSecurityProvider', () => {
  let provider: LocalSecurityProvider

  describe('constructor', () => {
    it('should create provider with default secret', () => {
      provider = new LocalSecurityProvider()
      expect(provider).toBeDefined()
    })

    it('should create provider with custom secret', () => {
      provider = new LocalSecurityProvider('custom-secret')
      expect(provider).toBeDefined()
    })
  })

  describe('sign and verify', () => {
    beforeEach(() => {
      provider = new LocalSecurityProvider('test-secret')
    })

    it('should sign data with HMAC', async () => {
      const testData = Buffer.from('test data')
      const signature = await provider.sign(testData)

      const expectedHash = createHash('sha256')
      expectedHash.update(testData)
      expectedHash.update('test-secret')
      const expected = expectedHash.digest('hex')

      expect(signature).toBe(expected)
    })

    it('should verify valid signature', async () => {
      const testData = Buffer.from('test data')
      const signature = await provider.sign(testData)

      const result = await provider.verify(testData, signature)

      expect(result).toBe(true)
    })

    it('should reject invalid signature', async () => {
      const testData = Buffer.from('test data')
      const invalidSignature = 'invalid-signature'

      const result = await provider.verify(testData, invalidSignature)

      expect(result).toBe(false)
    })

    it('should reject signature from different data', async () => {
      const data1 = Buffer.from('data 1')
      const data2 = Buffer.from('data 2')
      const signature = await provider.sign(data1)

      const result = await provider.verify(data2, signature)

      expect(result).toBe(false)
    })

    it('should produce different signatures with different secrets', async () => {
      const provider1 = new LocalSecurityProvider('secret1')
      const provider2 = new LocalSecurityProvider('secret2')
      const testData = Buffer.from('same data')

      const signature1 = await provider1.sign(testData)
      const signature2 = await provider2.sign(testData)

      expect(signature1).not.toBe(signature2)
    })
  })

  describe('generateSLSA', () => {
    beforeEach(() => {
      provider = new LocalSecurityProvider({
        environment: {
          node_version: process.version,
          platform: process.platform
        }
      })
    })

    it('should generate local SLSA provenance structure', async () => {
      const mockManifest = {} as Manifest
      const result = await provider.generateSLSA(mockManifest)

      // Test structure, not specific values
      expect(result).toHaveProperty('builderId')
      expect(result).toHaveProperty('buildType')
      expect(result).toHaveProperty('invocation')
      expect(result.invocation).toHaveProperty('configSource')
      expect(result.invocation).toHaveProperty('parameters')
      expect(result.invocation).toHaveProperty('environment')
      expect(result).toHaveProperty('materials')
      
      // Test that it's marked as local development
      expect(result.builderId).toContain('local')
      expect(result.buildType).toContain('local')
    })

    it('should use injected environment values when provided', async () => {
      const testProvider = new LocalSecurityProvider({
        environment: {
          node_version: 'test-version',
          platform: 'test-platform'
        }
      })
      const result = await testProvider.generateSLSA({} as Manifest)

      expect(result.invocation.environment.node_version).toBe('test-version')
      expect(result.invocation.environment.platform).toBe('test-platform')
    })

    it('should handle missing environment values gracefully', async () => {
      const testProvider = new LocalSecurityProvider({})
      const result = await testProvider.generateSLSA({} as Manifest)

      // Should have environment object but values can be undefined
      expect(result.invocation).toHaveProperty('environment')
      expect(result.invocation.environment).toBeDefined()
    })
  })
})

describe('Factory functions', () => {
  it('should create SigstoreProvider', () => {
    const provider = createSigstoreProvider()

    expect(provider).toBeInstanceOf(SigstoreProvider)
  })

  it('should create SigstoreProvider with options', () => {
    const provider = createSigstoreProvider({
      fulcioURL: 'https://custom.fulcio',
      rekorURL: 'https://custom.rekor'
    })

    expect(provider).toBeInstanceOf(SigstoreProvider)
  })

  it('should create LocalSecurityProvider', () => {
    const provider = createLocalProvider()

    expect(provider).toBeInstanceOf(LocalSecurityProvider)
  })

  it('should create LocalSecurityProvider with options object', () => {
    const provider = createLocalProvider({ secret: 'my-secret' })

    expect(provider).toBeInstanceOf(LocalSecurityProvider)
  })

  it('should create LocalSecurityProvider with string for backward compatibility', () => {
    const provider = createLocalProvider('my-secret')

    expect(provider).toBeInstanceOf(LocalSecurityProvider)
  })
})

describe('Security integration', () => {
  it('should support round-trip signing and verification with LocalProvider', async () => {
    const provider = new LocalSecurityProvider('integration-secret')
    const testData = Buffer.from('Important migration data')

    const signature = await provider.sign(testData)
    const isValid = await provider.verify(testData, signature)

    expect(isValid).toBe(true)
  })

  it('should detect tampering with LocalProvider', async () => {
    const provider = new LocalSecurityProvider('integration-secret')
    const originalData = Buffer.from('Original data')
    const tamperedData = Buffer.from('Tampered data')

    const signature = await provider.sign(originalData)
    const isValid = await provider.verify(tamperedData, signature)

    expect(isValid).toBe(false)
  })
})