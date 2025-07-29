import { sign, verify } from 'sigstore'
import { createHash } from 'crypto'
import { SecurityProvider, Manifest } from '@squizzle/core'

export interface SigstoreOptions {
  fulcioURL?: string
  rekorURL?: string
  tufMirrorURL?: string
  identityToken?: string
  environment?: {
    github_run_id?: string
    github_run_attempt?: string
    github_actor?: string
    github_event_name?: string
  }
}

export class SigstoreProvider implements SecurityProvider {
  constructor(private options: SigstoreOptions = {}) {}

  async sign(data: Buffer): Promise<string> {
    try {
      // Sign the data using sigstore
      const bundle = await sign(data)

      // Return base64 encoded bundle
      return Buffer.from(JSON.stringify(bundle)).toString('base64')
    } catch (error) {
      throw new Error(`Failed to sign artifact: ${error}`)
    }
  }

  async verify(data: Buffer, signature: string): Promise<boolean> {
    try {
      // Decode bundle from base64
      const bundle = JSON.parse(Buffer.from(signature, 'base64').toString())

      // Verify the bundle
      await verify(bundle, data)

      return true
    } catch (error) {
      console.error('Signature verification failed:', error)
      return false
    }
  }

  async generateSLSA(manifest: Manifest, buildInfo: SLSABuildInfo): Promise<Manifest['slsa']> {
    const materials = [
      {
        uri: `git+${buildInfo.repoURL}@${buildInfo.commitSHA}`,
        digest: {
          sha1: buildInfo.commitSHA
        }
      }
    ]

    // Add dependency materials
    if (manifest.dependencies?.length > 0) {
      manifest.dependencies.forEach(dep => {
        materials.push({
          uri: `pkg:squizzle/${dep}`,
          digest: {
            sha1: 'TODO' // Would need to fetch from storage
          }
        })
      })
    }

    return {
      builderId: buildInfo.builderId || 'https://github.com/squizzle/squizzle',
      buildType: 'https://github.com/squizzle/squizzle/build@v1',
      invocation: {
        configSource: {
          uri: `git+${buildInfo.repoURL}@${buildInfo.commitSHA}`,
          digest: { sha1: buildInfo.commitSHA },
          entryPoint: buildInfo.entryPoint || '.squizzle.yaml'
        },
        parameters: buildInfo.parameters || {},
        environment: {
          github_run_id: this.options.environment?.github_run_id,
          github_run_attempt: this.options.environment?.github_run_attempt,
          github_actor: this.options.environment?.github_actor,
          github_event_name: this.options.environment?.github_event_name
        }
      },
      materials
    }
  }
}

export interface SLSABuildInfo {
  repoURL: string
  commitSHA: string
  builderId?: string
  entryPoint?: string
  parameters?: Record<string, any>
}

export interface LocalSecurityOptions {
  secret?: string
  environment?: {
    node_version?: string
    platform?: string
  }
}

// In-memory signing for development/testing
export class LocalSecurityProvider implements SecurityProvider {
  private secret: string
  private environment: LocalSecurityOptions['environment']

  constructor(options?: LocalSecurityOptions | string) {
    if (typeof options === 'string') {
      // Backward compatibility
      this.secret = options
      this.environment = {}
    } else {
      this.secret = options?.secret || 'development-secret'
      this.environment = options?.environment || {}
    }
  }

  async sign(data: Buffer): Promise<string> {
    const hash = createHash('sha256')
    hash.update(data)
    hash.update(this.secret)
    return hash.digest('hex')
  }

  async verify(data: Buffer, signature: string): Promise<boolean> {
    const expected = await this.sign(data)
    return signature === expected
  }

  async generateSLSA(manifest: Manifest): Promise<Manifest['slsa']> {
    return {
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
          node_version: this.environment?.node_version,
          platform: this.environment?.platform
        }
      },
      materials: []
    }
  }
}

export function createSigstoreProvider(options?: SigstoreOptions): SecurityProvider {
  return new SigstoreProvider(options)
}

export function createLocalProvider(options?: LocalSecurityOptions | string): SecurityProvider {
  return new LocalSecurityProvider(options)
}