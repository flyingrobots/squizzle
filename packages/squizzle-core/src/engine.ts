import { createHash } from 'crypto'
import pLimit from 'p-limit'
import * as tar from 'tar'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { readFileSync } from 'fs'
import { join } from 'path'
import { 
  DatabaseDriver, 
  ArtifactStorage, 
  SecurityProvider,
  Manifest, 
  Version, 
  MigrationOptions,
  MigrationType,
  AppliedVersion,
  Migration
} from './types'
import { Logger } from './logger'
import { MigrationError, ChecksumError, VersionError, SecurityError } from './errors'

export interface EngineOptions {
  driver: DatabaseDriver
  storage: ArtifactStorage
  security?: SecurityProvider
  logger?: Logger
  autoInit?: boolean // Enable/disable auto-initialization of system tables
}

export class MigrationEngine {
  private driver: DatabaseDriver
  private storage: ArtifactStorage
  private security?: SecurityProvider
  private logger: Logger
  private autoInit: boolean

  constructor(options: EngineOptions) {
    this.driver = options.driver
    this.storage = options.storage
    this.security = options.security
    this.logger = options.logger || new Logger()
    this.autoInit = options.autoInit !== false // Default to true
  }

  async apply(version: Version, options: MigrationOptions = {}): Promise<void> {
    this.logger.info(`Applying version ${version}`, { version, options })
    
    // Check and initialize system tables if needed
    await this.ensureSystemTables()
    
    // Acquire distributed lock
    const unlock = await this.driver.lock(`squizzle:apply:${version}`, options.timeout)
    
    let manifest: Manifest | undefined
    
    try {
      // Check if already applied
      const applied = await this.driver.getAppliedVersions()
      if (applied.some(v => v.version === version && v.success)) {
        throw new VersionError(`Version ${version} already applied`)
      }

      // Pull artifact
      const pulled = await this.storage.pull(version)
      const artifact = pulled.artifact
      manifest = pulled.manifest
      
      // Verify integrity
      await this.verifyIntegrity(artifact, manifest)
      
      // Verify signature if security provider available
      if (this.security && manifest.signature) {
        const valid = await this.security.verify(artifact, manifest.signature)
        if (!valid) {
          throw new SecurityError('Invalid artifact signature')
        }
      }

      // Extract and sort migrations
      const migrations = await this.extractMigrations(artifact, manifest)
      const sorted = this.sortMigrations(migrations)

      // Run migrations
      if (options.dryRun) {
        this.logger.info('Dry run - would apply:', { migrations: sorted.map(m => m.path) })
        return
      }

      await this.driver.transaction(async (tx) => {
        await this.runMigrations(tx, sorted, options)
        await tx.recordVersion(version, manifest!, true)
      })
      
      this.logger.info(`Successfully applied version ${version}`)
      
    } catch (error) {
      this.logger.error(`Failed to apply version ${version}`, error)
      
      // Record failure only if we have a manifest
      if (manifest) {
        try {
          await this.driver.recordVersion(
            version, 
            manifest, 
            false, 
            error instanceof Error ? error.message : String(error)
          )
        } catch (recordError) {
          this.logger.error('Failed to record version failure', { 
            error: recordError, 
            message: recordError instanceof Error ? recordError.message : String(recordError),
            stack: recordError instanceof Error ? recordError.stack : undefined
          })
        }
      }
      
      throw error
    } finally {
      await unlock()
    }
  }

  async rollback(version: Version, options: MigrationOptions = {}): Promise<void> {
    this.logger.info(`Rolling back version ${version}`, { version, options })
    
    const unlock = await this.driver.lock(`squizzle:rollback:${version}`, options.timeout)
    
    try {
      // Verify version is applied
      const applied = await this.driver.getAppliedVersions()
      const target = applied.find(v => v.version === version && v.success)
      
      if (!target) {
        throw new VersionError(`Version ${version} not found or not successfully applied`)
      }

      // Get rollback migrations from artifact
      const { artifact, manifest } = await this.storage.pull(version)
      const migrations = await this.extractMigrations(artifact, manifest)
      const rollbacks = migrations.filter(m => m.type === MigrationType.ROLLBACK)

      if (rollbacks.length === 0) {
        throw new MigrationError(`No rollback migrations found for version ${version}`)
      }

      // Run rollbacks in reverse order
      await this.driver.transaction(async (tx) => {
        await this.runMigrations(tx, rollbacks.reverse(), options)
        
        // Record rollback
        await tx.recordVersion(
          `rollback-${version}-${Date.now()}` as Version,
          manifest,
          true,
          undefined
        )
      })
      
      this.logger.info(`Successfully rolled back version ${version}`)
      
    } finally {
      await unlock()
    }
  }

  async status(): Promise<{ current: Version | null; applied: AppliedVersion[]; available: Version[] }> {
    const [applied, available] = await Promise.all([
      this.driver.getAppliedVersions(),
      this.storage.list()
    ])

    const current = applied
      .filter(v => v.success)
      .sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())[0]

    return {
      current: current?.version || null,
      applied,
      available
    }
  }

  async verify(version: Version): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []
    
    try {
      // Check if artifact exists
      const exists = await this.storage.exists(version)
      if (!exists) {
        errors.push(`Artifact for version ${version} not found`)
        return { valid: false, errors }
      }

      // Pull and verify
      const { artifact, manifest } = await this.storage.pull(version)
      
      // Verify integrity
      try {
        await this.verifyIntegrity(artifact, manifest)
      } catch (error) {
        errors.push(`Integrity check failed: ${error}`)
      }

      // Verify signature
      if (this.security && manifest.signature) {
        try {
          const valid = await this.security.verify(artifact, manifest.signature)
          if (!valid) {
            errors.push('Invalid signature')
          }
        } catch (error) {
          errors.push(`Signature verification failed: ${error}`)
        }
      }

      // Test database connection
      try {
        // Just verify we can execute a simple query
        await this.driver.query('SELECT 1')
      } catch (error) {
        errors.push(`Database connection failed: ${error}`)
      }

    } catch (error) {
      errors.push(`Verification failed: ${error}`)
    }

    return { valid: errors.length === 0, errors }
  }

  private async verifyIntegrity(_artifact: Buffer, manifest: Manifest): Promise<void> {
    // The manifest checksum is calculated from the sorted file paths and their checksums.
    // Individual file checksums are verified during extraction in extractMigrations.
    // Here we verify that the manifest checksum matches what we calculate from the files.
    
    // Calculate manifest checksum from files
    const sortedFiles = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path))
    const checksumData = sortedFiles
      .map(file => `${file.path}:${file.checksum}`)
      .join('\n')
    
    const calculatedChecksum = createHash(manifest.checksumAlgorithm || 'sha256')
      .update(checksumData)
      .digest('hex')
    
    // Use constant-time comparison to prevent timing attacks
    if (!this.constantTimeEqual(calculatedChecksum, manifest.checksum)) {
      throw new ChecksumError(
        `Manifest checksum mismatch: expected ${manifest.checksum}, got ${calculatedChecksum}`
      )
    }
  }

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false
    }
    
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    
    return result === 0
  }

  private async extractMigrations(artifact: Buffer, manifest: Manifest): Promise<Migration[]> {
    const migrations: Migration[] = []
    const extractedFiles = new Map<string, string>()
    
    try {
      // Create a readable stream from the buffer
      const stream = Readable.from(artifact)
      
      // Extract files from tarball
      await pipeline(
        stream,
        tar.extract({
          onentry: async (entry) => {
            const path = entry.path.toString()
            
            // Skip directories and non-SQL files
            if (entry.type !== 'File' || !path.endsWith('.sql')) {
              return
            }
            
            // Read file content
            const chunks: Buffer[] = []
            for await (const chunk of entry) {
              chunks.push(chunk)
            }
            const content = Buffer.concat(chunks).toString('utf-8')
            
            // Store the extracted content
            // Remove leading ./ if present
            const normalizedPath = path.startsWith('./') ? path.slice(2) : path
            extractedFiles.set(normalizedPath, content)
          }
        })
      )
      
      // Match extracted files with manifest entries
      for (const file of manifest.files) {
        if (!file.path.endsWith('.sql')) {
          continue
        }
        
        const content = extractedFiles.get(file.path)
        if (!content) {
          throw new MigrationError(`File ${file.path} not found in artifact`)
        }
        
        // Verify checksum
        const fileChecksum = createHash('sha256').update(content).digest('hex')
        if (fileChecksum !== file.checksum) {
          throw new ChecksumError(
            `Checksum mismatch for ${file.path}: expected ${file.checksum}, got ${fileChecksum}`
          )
        }
        
        migrations.push({
          path: file.path,
          sql: content,
          type: file.type as MigrationType,
          checksum: file.checksum
        })
      }
      
      return migrations
    } catch (error) {
      if (error instanceof ChecksumError || error instanceof MigrationError) {
        throw error
      }
      throw new MigrationError(`Failed to extract migrations: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private sortMigrations(migrations: Migration[]): Migration[] {
    // Sort by type priority: drizzle -> custom -> seed
    const priority: Record<string, number> = {
      [MigrationType.DRIZZLE]: 0,
      [MigrationType.CUSTOM]: 1,
      [MigrationType.SEED]: 2,
      [MigrationType.ROLLBACK]: 3
    }
    
    return migrations.sort((a, b) => {
      const aPriority = priority[a.type] ?? 999
      const bPriority = priority[b.type] ?? 999
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.path.localeCompare(b.path)
    })
  }

  private async runMigrations(
    driver: DatabaseDriver,
    migrations: Migration[],
    options: MigrationOptions
  ): Promise<void> {
    const limit = pLimit(options.maxParallel || 1)
    
    const tasks = migrations.map(migration => 
      limit(async () => {
        try {
          if (options.beforeEach) {
            await options.beforeEach(migration.path)
          }
          
          await driver.execute(migration.sql)
          
          if (options.afterEach) {
            await options.afterEach(migration.path, true)
          }
        } catch (error) {
          if (options.afterEach) {
            await options.afterEach(migration.path, false)
          }
          
          if (options.stopOnError !== false) {
            throw new MigrationError(
              `Failed to apply ${migration.path}: ${error}`,
              { migration, error }
            )
          }
        }
      })
    )
    
    await Promise.all(tasks)
  }

  private async ensureSystemTables(): Promise<void> {
    try {
      // Try to query the versions table
      await this.driver.query('SELECT 1 FROM squizzle_versions LIMIT 1')
      // If successful, tables exist
      return
    } catch (error) {
      // Tables don't exist
      if (!this.autoInit) {
        throw new MigrationError(
          'Squizzle system tables not found. Run "squizzle init:db" to initialize the database.'
        )
      }
      
      this.logger.warn('System tables missing, initializing...')
      
      try {
        // Read and execute system SQL
        const systemSqlPath = join(__dirname, '../sql/system/v1.0.0.sql')
        const systemSql = readFileSync(systemSqlPath, 'utf-8')
        
        await this.driver.execute(systemSql)
        this.logger.info('System tables created successfully')
      } catch (initError) {
        throw new MigrationError(
          `Failed to auto-initialize system tables: ${initError}. Run "squizzle init:db" manually.`
        )
      }
    }
  }
}