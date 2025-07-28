import { z } from 'zod'

// Version follows semver
export const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/)

// Manifest schema with comprehensive metadata
export const ManifestSchema = z.object({
  version: VersionSchema,
  previousVersion: VersionSchema.nullable(),
  created: z.string().datetime(),
  checksum: z.string().length(64), // SHA256
  checksumAlgorithm: z.enum(['sha256', 'sha512']).default('sha256'),
  signature: z.string().optional(), // Sigstore signature
  drizzleKit: z.string(),
  engineVersion: z.string(),
  notes: z.string(),
  author: z.string().optional(),
  files: z.array(z.object({
    path: z.string(),
    checksum: z.string(),
    size: z.number(),
    type: z.enum(['drizzle', 'custom', 'seed', 'rollback'])
  })),
  dependencies: z.array(VersionSchema).default([]),
  platform: z.object({
    os: z.string(),
    arch: z.string(),
    node: z.string()
  }),
  slsa: z.object({
    builderId: z.string(),
    buildType: z.string(),
    invocation: z.record(z.unknown()),
    materials: z.array(z.object({
      uri: z.string(),
      digest: z.record(z.string())
    }))
  }).optional()
})

export type Version = z.infer<typeof VersionSchema>
export type Manifest = z.infer<typeof ManifestSchema>

// Migration file types
export enum MigrationType {
  DRIZZLE = 'drizzle',
  CUSTOM = 'custom', 
  SEED = 'seed',
  ROLLBACK = 'rollback'
}

// Database driver interface
export interface DatabaseDriver {
  name: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  execute(sql: string): Promise<void>
  query<T = any>(sql: string): Promise<T[]>
  transaction<T>(fn: (client: DatabaseDriver) => Promise<T>): Promise<T>
  getAppliedVersions(): Promise<AppliedVersion[]>
  recordVersion(version: Version, manifest: Manifest, success: boolean, error?: string): Promise<void>
  lock(key: string, timeout?: number): Promise<() => Promise<void>>
}

// Applied version record
export interface AppliedVersion {
  version: Version
  appliedAt: Date
  appliedBy: string
  checksum: string
  success: boolean
  error?: string
  rollbackOf?: Version
}

// Artifact storage interface
export interface ArtifactStorage {
  push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string>
  pull(version: Version): Promise<{ artifact: Buffer; manifest: Manifest }>
  exists(version: Version): Promise<boolean>
  list(): Promise<Version[]>
  delete(version: Version): Promise<void>
  getManifest(version: Version): Promise<Manifest>
}

// Migration runner options
export interface MigrationOptions {
  dryRun?: boolean
  force?: boolean
  timeout?: number
  parallel?: boolean
  maxParallel?: number
  stopOnError?: boolean
  beforeEach?: (file: string) => Promise<void>
  afterEach?: (file: string, success: boolean) => Promise<void>
}

// Migration interface
export interface Migration {
  path: string
  sql: string
  type: MigrationType
  checksum: string
}

// Security provider interface
export interface SecurityProvider {
  sign(data: Buffer): Promise<string>
  verify(data: Buffer, signature: string): Promise<boolean>
  generateSLSA(manifest: Manifest, buildInfo: any): Promise<Manifest['slsa']>
}