import { ArtifactStorage, Version, Manifest, StorageError } from '@squizzle/core'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

export interface OCIStorageOptions {
  registry: string
  repository?: string
  username?: string
  password?: string
  insecure?: boolean
}

export class OCIStorage implements ArtifactStorage {
  private registry: string
  private repository: string

  constructor(private options: OCIStorageOptions) {
    this.registry = options.registry
    this.repository = options.repository || 'squizzle-artifacts'
    
    // Login if credentials provided
    if (options.username && options.password) {
      this.login()
    }
  }

  private login(): void {
    try {
      execSync(
        `echo "${this.options.password}" | docker login ${this.registry} -u ${this.options.username} --password-stdin`,
        { stdio: 'pipe' }
      )
    } catch (error) {
      throw new StorageError(`Failed to login to registry: ${error}`)
    }
  }

  async push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string> {
    try {
      const tag = `${this.registry}/${this.repository}:v${version}`
      const manifestTag = `${this.registry}/${this.repository}:v${version}-manifest`
      
      // Create temporary dockerfile with artifact embedded
      const dockerfile = `
FROM scratch
COPY --from=busybox:latest /bin/sh /bin/sh
ADD artifact.tar.gz /
ADD manifest.json /manifest.json
LABEL org.opencontainers.image.version="${version}"
LABEL org.opencontainers.image.created="${manifest.created}"
LABEL org.opencontainers.image.revision="${manifest.checksum}"
LABEL io.squizzle.version="${version}"
LABEL io.squizzle.checksum="${manifest.checksum}"
`
      
      // Build and push using Docker CLI (temporary solution)
      // In production, use proper OCI libraries
      const tempDir = `/tmp/squizzle-${version}-${Date.now()}`
      execSync(`mkdir -p ${tempDir}`)
      
      try {
        // Write files
        require('fs').writeFileSync(`${tempDir}/Dockerfile`, dockerfile)
        require('fs').writeFileSync(`${tempDir}/artifact.tar.gz`, artifact)
        require('fs').writeFileSync(`${tempDir}/manifest.json`, JSON.stringify(manifest))
        
        // Build image
        execSync(`docker build -t ${tag} ${tempDir}`, { stdio: 'pipe' })
        
        // Push image
        execSync(`docker push ${tag}`, { stdio: 'pipe' })
        
        return tag
      } finally {
        // Cleanup
        execSync(`rm -rf ${tempDir}`)
      }
    } catch (error) {
      throw new StorageError(`Failed to push artifact: ${error}`)
    }
  }

  async pull(version: Version): Promise<{ artifact: Buffer; manifest: Manifest }> {
    try {
      const tag = `${this.registry}/${this.repository}:v${version}`
      
      // Pull image
      execSync(`docker pull ${tag}`, { stdio: 'pipe' })
      
      // Extract files using docker create and cp
      const containerId = execSync(`docker create ${tag}`, { encoding: 'utf-8' }).trim()
      
      try {
        // Extract artifact
        execSync(`docker cp ${containerId}:/artifact.tar.gz /tmp/artifact.tar.gz`)
        const artifact = require('fs').readFileSync('/tmp/artifact.tar.gz')
        
        // Extract manifest
        execSync(`docker cp ${containerId}:/manifest.json /tmp/manifest.json`)
        const manifest = JSON.parse(require('fs').readFileSync('/tmp/manifest.json', 'utf-8'))
        
        return { artifact, manifest }
      } finally {
        // Cleanup
        execSync(`docker rm ${containerId}`)
        execSync(`rm -f /tmp/artifact.tar.gz /tmp/manifest.json`)
      }
    } catch (error) {
      throw new StorageError(`Failed to pull artifact: ${error}`)
    }
  }

  async exists(version: Version): Promise<boolean> {
    try {
      const tag = `${this.registry}/${this.repository}:v${version}`
      execSync(`docker manifest inspect ${tag}`, { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  async list(): Promise<Version[]> {
    try {
      // Use docker registry API or CLI tools
      // This is a simplified version using docker
      const output = execSync(
        `docker search ${this.registry}/${this.repository} --format "{{.Name}}"`,
        { encoding: 'utf-8' }
      )
      
      // Parse versions from tags
      const versions: Version[] = []
      // Would need proper registry API integration here
      
      return versions
    } catch (error) {
      throw new StorageError(`Failed to list artifacts: ${error}`)
    }
  }

  async delete(version: Version): Promise<void> {
    // Note: Deleting from registry requires API access
    // Most registries don't support deletion via docker CLI
    throw new StorageError('Deletion not implemented for OCI storage')
  }

  async getManifest(version: Version): Promise<Manifest> {
    const { manifest } = await this.pull(version)
    return manifest
  }
}

// Filesystem storage for local development
export class FilesystemStorage implements ArtifactStorage {
  constructor(private basePath: string) {
    require('fs').mkdirSync(basePath, { recursive: true })
  }

  async push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string> {
    const artifactPath = `${this.basePath}/squizzle-v${version}.tar.gz`
    const manifestPath = `${this.basePath}/squizzle-v${version}.manifest.json`
    
    require('fs').writeFileSync(artifactPath, artifact)
    require('fs').writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    
    return artifactPath
  }

  async pull(version: Version): Promise<{ artifact: Buffer; manifest: Manifest }> {
    const artifactPath = `${this.basePath}/squizzle-v${version}.tar.gz`
    const manifestPath = `${this.basePath}/squizzle-v${version}.manifest.json`
    
    if (!require('fs').existsSync(artifactPath)) {
      throw new StorageError(`Artifact not found: ${version}`)
    }
    
    const artifact = require('fs').readFileSync(artifactPath)
    const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'))
    
    return { artifact, manifest }
  }

  async exists(version: Version): Promise<boolean> {
    const artifactPath = `${this.basePath}/squizzle-v${version}.tar.gz`
    return require('fs').existsSync(artifactPath)
  }

  async list(): Promise<Version[]> {
    const files = require('fs').readdirSync(this.basePath)
    return files
      .filter((f: string) => f.startsWith('squizzle-v') && f.endsWith('.tar.gz'))
      .map((f: string) => f.replace('squizzle-v', '').replace('.tar.gz', '') as Version)
      .sort()
  }

  async delete(version: Version): Promise<void> {
    const artifactPath = `${this.basePath}/squizzle-v${version}.tar.gz`
    const manifestPath = `${this.basePath}/squizzle-v${version}.manifest.json`
    
    require('fs').unlinkSync(artifactPath)
    require('fs').unlinkSync(manifestPath)
  }

  async getManifest(version: Version): Promise<Manifest> {
    const manifestPath = `${this.basePath}/squizzle-v${version}.manifest.json`
    return JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'))
  }
}

export function createOCIStorage(options: OCIStorageOptions | { type: string; path?: string; registry?: string }): ArtifactStorage {
  if ('type' in options) {
    switch (options.type) {
      case 'filesystem':
        return new FilesystemStorage(options.path || './db/artifacts')
      case 'oci':
        if (!('registry' in options)) {
          throw new Error('OCI storage requires registry option')
        }
        return new OCIStorage(options as OCIStorageOptions)
      default:
        throw new Error(`Unknown storage type: ${options.type}`)
    }
  }
  return new OCIStorage(options as OCIStorageOptions)
}