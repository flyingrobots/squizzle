import { ArtifactStorage, Version, Manifest, StorageError } from '@squizzle/core'
import { execSync } from 'child_process'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface OCIStorageOptions {
  registry: string
  repository?: string
  username?: string
  password?: string
  insecure?: boolean
}

interface TagsListResponse {
  name: string
  tags: string[]
}

interface RegistryAuth {
  username?: string
  password?: string
  token?: string
  auth?: string
}

interface DockerConfig {
  auths: {
    [registry: string]: {
      auth?: string
      identitytoken?: string
    }
  }
}

interface AuthChallenge {
  scheme: string
  realm: string
  service: string
  scope: string
}

interface TokenResponse {
  token: string
  access_token?: string
  expires_in?: number
  issued_at?: string
}

export class OCIStorage implements ArtifactStorage {
  private registry: string
  private repository: string
  private authCache: { token?: string; expires?: number } = {}

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

  private async getDockerAuth(): Promise<RegistryAuth> {
    // First check if we have explicit credentials
    if (this.options.username && this.options.password) {
      const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64')
      return { username: this.options.username, password: this.options.password, auth }
    }

    // Try to read from Docker config
    const dockerConfigPath = path.join(os.homedir(), '.docker', 'config.json')
    if (fs.existsSync(dockerConfigPath)) {
      try {
        const config: DockerConfig = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf-8'))
        const registryAuth = config.auths[this.registry] || config.auths[`https://${this.registry}`]
        if (registryAuth?.auth) {
          const decoded = Buffer.from(registryAuth.auth, 'base64').toString('utf-8')
          const [username, password] = decoded.split(':')
          return { username, password, auth: registryAuth.auth }
        }
      } catch (error) {
        // Ignore docker config read errors
      }
    }

    return {}
  }

  private parseWwwAuthenticate(header: string): AuthChallenge | null {
    const match = header.match(/Bearer realm="([^"]+)"(?:,service="([^"]+)")?(?:,scope="([^"]+)")?/)
    if (!match) return null

    return {
      scheme: 'Bearer',
      realm: match[1],
      service: match[2] || '',
      scope: match[3] || ''
    }
  }

  private async getAuthToken(challenge: AuthChallenge): Promise<string> {
    // Check cache first
    if (this.authCache.token && this.authCache.expires && Date.now() < this.authCache.expires) {
      return this.authCache.token
    }

    const auth = await this.getDockerAuth()
    const url = new URL(challenge.realm)
    
    if (challenge.service) {
      url.searchParams.set('service', challenge.service)
    }
    if (challenge.scope) {
      url.searchParams.set('scope', challenge.scope)
    }

    const headers: http.OutgoingHttpHeaders = {}
    
    if (auth.username && auth.password) {
      headers['Authorization'] = `Basic ${auth.auth}`
    }

    const options: https.RequestOptions = {
      method: 'GET',
      headers
    }

    const response = await this.makeHttpRequest(url.toString(), options)
    const tokenData: TokenResponse = JSON.parse(response.body)
    const token = tokenData.token || tokenData.access_token

    if (!token) {
      throw new StorageError('Failed to obtain auth token from registry')
    }

    // Cache the token
    this.authCache.token = token
    this.authCache.expires = Date.now() + ((tokenData.expires_in || 300) - 10) * 1000

    return token
  }

  private makeHttpRequest(
    url: string, 
    options: https.RequestOptions & { body?: string } = {}
  ): Promise<{
    statusCode: number
    headers: http.IncomingHttpHeaders
    body: string
  }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const requestOptions: https.RequestOptions = {
        ...options,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      }

      if (this.options.insecure) {
        requestOptions.rejectUnauthorized = false
      }

      const req = httpModule.request(requestOptions, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body
          })
        })
      })

      req.on('error', (error) => {
        reject(new StorageError(`HTTP request failed: ${error.message}`))
      })

      req.setTimeout(30000, () => {
        req.destroy()
        reject(new StorageError('HTTP request timeout'))
      })

      if (options.body) {
        req.write(options.body)
      }

      req.end()
    })
  }

  private async makeAuthenticatedRequest(
    url: string, 
    options: https.RequestOptions & { body?: string } = {},
    retry = true
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
    // First try without auth token
    let response = await this.makeHttpRequest(url, options)

    // If we get 401, try to authenticate
    if (response.statusCode === 401 && retry) {
      const wwwAuth = response.headers['www-authenticate']
      if (typeof wwwAuth === 'string') {
        const challenge = this.parseWwwAuthenticate(wwwAuth)
        if (challenge) {
          const token = await this.getAuthToken(challenge)
          
          // Retry with token
          const authOptions: https.RequestOptions & { body?: string } = {
            ...options,
            headers: {
              ...options.headers,
              'Authorization': `Bearer ${token}`
            }
          }
          response = await this.makeHttpRequest(url, authOptions)
        }
      }
    }

    return response
  }

  async push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string> {
    try {
      const tag = `${this.registry}/${this.repository}:v${version}`
      
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
      const protocol = this.options.insecure ? 'http' : 'https'
      const baseUrl = `${protocol}://${this.registry}/v2/${this.repository}/tags/list`
      
      const allTags: string[] = []
      let nextUrl: string | null = baseUrl

      // Handle pagination using Link header
      while (nextUrl) {
        const response = await this.makeAuthenticatedRequest(nextUrl)
        
        if (response.statusCode !== 200) {
          if (response.statusCode === 404) {
            // Repository doesn't exist yet, return empty array
            return []
          }
          throw new StorageError(
            `Failed to list tags: HTTP ${response.statusCode} - ${response.body}`,
            { statusCode: response.statusCode, body: response.body }
          )
        }

        const data: TagsListResponse = JSON.parse(response.body)
        if (data.tags && Array.isArray(data.tags)) {
          allTags.push(...data.tags)
        }

        // Check for pagination in Link header
        nextUrl = null
        const linkHeader = response.headers.link
        if (linkHeader && typeof linkHeader === 'string') {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
          if (match && match[1]) {
            // Handle relative URLs in Link header
            if (match[1].startsWith('/')) {
              nextUrl = `${protocol}://${this.registry}${match[1]}`
            } else {
              nextUrl = match[1]
            }
          }
        }
      }

      // Filter tags that are version tags (start with 'v') and convert to Version type
      const versions = allTags
        .filter(tag => tag.startsWith('v') && tag.length > 1)
        .map(tag => tag.substring(1))
        .filter(version => {
          // Validate semver format
          try {
            return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version)
          } catch {
            return false
          }
        })
        .map(version => version as Version)

      // Sort versions using semver comparison
      return versions.sort((a, b) => {
        const aParts = this.parseSemver(a)
        const bParts = this.parseSemver(b)
        
        // Compare major.minor.patch
        for (let i = 0; i < 3; i++) {
          if (aParts.numbers[i] !== bParts.numbers[i]) {
            return aParts.numbers[i] - bParts.numbers[i]
          }
        }
        
        // If one has prerelease and other doesn't, non-prerelease is greater
        if (aParts.prerelease && !bParts.prerelease) return -1
        if (!aParts.prerelease && bParts.prerelease) return 1
        
        // Compare prereleases lexically
        if (aParts.prerelease && bParts.prerelease) {
          return aParts.prerelease.localeCompare(bParts.prerelease)
        }
        
        return 0
      })
    } catch (error) {
      if (error instanceof StorageError) {
        throw error
      }
      throw new StorageError(`Failed to list artifacts: ${error}`)
    }
  }

  private parseSemver(version: string): { numbers: number[]; prerelease?: string } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-(.+))?/)
    if (!match) {
      throw new Error(`Invalid version format: ${version}`)
    }
    
    return {
      numbers: [
        parseInt(match[1], 10),
        parseInt(match[2], 10),
        parseInt(match[3], 10)
      ],
      prerelease: match[5]
    }
  }

  async delete(version: Version): Promise<void> {
    try {
      const tag = `v${version}`
      const protocol = this.options.insecure ? 'http' : 'https'
      
      // Step 1: Get the manifest to obtain the digest
      const manifestUrl = `${protocol}://${this.registry}/v2/${this.repository}/manifests/${tag}`
      
      // We need to request with specific Accept headers to get the digest
      const manifestResponse = await this.makeAuthenticatedRequest(manifestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        }
      })

      if (manifestResponse.statusCode === 404) {
        throw new StorageError(
          `Version ${version} not found in registry`,
          { statusCode: 404, version }
        )
      }

      if (manifestResponse.statusCode !== 200) {
        throw new StorageError(
          `Failed to get manifest for version ${version}: HTTP ${manifestResponse.statusCode} - ${manifestResponse.body}`,
          { statusCode: manifestResponse.statusCode, body: manifestResponse.body }
        )
      }

      // Get the digest from Docker-Content-Digest header
      const digest = manifestResponse.headers['docker-content-digest']
      if (!digest || typeof digest !== 'string') {
        throw new StorageError(
          `No digest found for version ${version}`,
          { version, headers: manifestResponse.headers }
        )
      }

      // Step 2: Delete the manifest by digest
      const deleteUrl = `${protocol}://${this.registry}/v2/${this.repository}/manifests/${digest}`
      
      const deleteResponse = await this.makeAuthenticatedRequest(deleteUrl, {
        method: 'DELETE'
      })

      if (deleteResponse.statusCode === 404) {
        // Already deleted, consider it success
        return
      }

      if (deleteResponse.statusCode === 405) {
        throw new StorageError(
          'Registry does not support deletion. This is common for Docker Hub and some other registries.',
          { statusCode: 405, registry: this.registry }
        )
      }

      if (deleteResponse.statusCode === 401 || deleteResponse.statusCode === 403) {
        throw new StorageError(
          `Insufficient permissions to delete from registry`,
          { statusCode: deleteResponse.statusCode }
        )
      }

      if (deleteResponse.statusCode !== 202 && deleteResponse.statusCode !== 200) {
        throw new StorageError(
          `Failed to delete version ${version}: HTTP ${deleteResponse.statusCode} - ${deleteResponse.body}`,
          { statusCode: deleteResponse.statusCode, body: deleteResponse.body }
        )
      }

      // Step 3: Verify deletion by checking if tag still exists
      const verifyResponse = await this.makeAuthenticatedRequest(manifestUrl, {
        method: 'HEAD'
      })

      if (verifyResponse.statusCode !== 404) {
        throw new StorageError(
          `Failed to verify deletion of version ${version}`,
          { statusCode: verifyResponse.statusCode }
        )
      }
    } catch (error) {
      if (error instanceof StorageError) {
        throw error
      }
      throw new StorageError(`Failed to delete artifact: ${error}`)
    }
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