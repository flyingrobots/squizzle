import { createHash } from 'crypto'
import { Manifest, ManifestSchema, Version } from './types'

export interface ManifestOptions {
  version: Version
  previousVersion?: Version | null
  notes?: string
  author?: string
  drizzleKit: string
  files: Array<{
    path: string
    content: Buffer
    type: 'drizzle' | 'custom' | 'seed' | 'rollback'
  }>
}

export function createManifest(options: ManifestOptions): Manifest {
  const files = options.files.map(file => {
    const hash = createHash('sha256')
    hash.update(file.content)
    return {
      path: file.path,
      checksum: hash.digest('hex'),
      size: file.content.length,
      type: file.type
    }
  })

  // Calculate overall checksum
  const hash = createHash('sha256');
  [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach(file => {
      hash.update(file.path)
      hash.update(file.checksum)
    })

  const manifest: Manifest = {
    version: options.version,
    previousVersion: options.previousVersion || null,
    created: new Date().toISOString(),
    checksum: hash.digest('hex'),
    checksumAlgorithm: 'sha256',
    drizzleKit: options.drizzleKit,
    engineVersion: '2.0.0',
    notes: options.notes || '',
    author: options.author,
    files,
    dependencies: [],
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.version
    }
  }

  return ManifestSchema.parse(manifest)
}