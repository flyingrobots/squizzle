import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { 
  SigstoreProvider, 
  LocalSecurityProvider, 
  createSigstoreProvider, 
  createLocalProvider,
  SLSABuildInfo 
} from '../src/index'
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
    provider = new SigstoreProvider()
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

    it('should generate SLSA provenance', async () => {
      const result = await provider.generateSLSA(mockManifest, mockBuildInfo)

      expect(result.builderId).toBe('https://github.com/actions/runner')
      expect(result.buildType).toBe('https://github.com/squizzle/squizzle/build@v1')
      expect(result.invocation.configSource).toEqual({
        uri: 'git+https://github.com/user/repo@abcdef123456',
        digest: { sha1: 'abcdef123456' },
        entryPoint: 'build.yaml'
      })
      expect(result.invocation.parameters).toEqual({ version: '1.0.0' })
      expect(result.materials).toEqual([{
        uri: 'git+https://github.com/user/repo@abcdef123456',
        digest: { sha1: 'abcdef123456' }
      }])
      
      // Environment variables are optional - they'll be set in CI but undefined locally
      expect(result.invocation.environment).toHaveProperty('github_run_id')
      expect(result.invocation.environment).toHaveProperty('github_run_attempt')
      expect(result.invocation.environment).toHaveProperty('github_actor')
      expect(result.invocation.environment).toHaveProperty('github_event_name')
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

    it('should include GitHub environment variables', async () => {
      process.env.GITHUB_RUN_ID = '12345'
      process.env.GITHUB_RUN_ATTEMPT = '1'
      process.env.GITHUB_ACTOR = 'testuser'
      process.env.GITHUB_EVENT_NAME = 'push'

      const result = await provider.generateSLSA(mockManifest, mockBuildInfo)

      expect(result.invocation.environment).toEqual({
        github_run_id: '12345',
        github_run_attempt: '1',
        github_actor: 'testuser',
        github_event_name: 'push'
      })

      // Cleanup
      delete process.env.GITHUB_RUN_ID
      delete process.env.GITHUB_RUN_ATTEMPT
      delete process.env.GITHUB_ACTOR
      delete process.env.GITHUB_EVENT_NAME
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
      provider = new LocalSecurityProvider()
    })

    it('should generate local SLSA provenance', async () => {
      const mockManifest = {} as Manifest
      const result = await provider.generateSLSA(mockManifest)

      expect(result).toEqual({
        builderId: 'local-development',
        buildType: 'local-build@v1',
        invocation: {
          configSource: {
            uri: 'file://.squizzle.yaml',
            digest: { sha256: 'development' },
            entryPoint: '.squizzle.yaml'
          },
          parameters: {},
          environment: {
            node_version: process.version,
            platform: process.platform
          }
        },
        materials: []
      })
    })

    it('should include current Node.js version', async () => {
      const result = await provider.generateSLSA({} as Manifest)

      expect(result.invocation.environment.node_version).toBe(process.version)
    })

    it('should include current platform', async () => {
      const result = await provider.generateSLSA({} as Manifest)

      expect(result.invocation.environment.platform).toBe(process.platform)
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

  it('should create LocalSecurityProvider with secret', () => {
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