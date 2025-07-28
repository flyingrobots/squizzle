import { createHash } from 'crypto'
import { z } from 'zod'
import pLimit from 'p-limit'
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
}

export class MigrationEngine {
  private driver: DatabaseDriver
  private storage: ArtifactStorage
  private security?: SecurityProvider
  private logger: Logger

  constructor(options: EngineOptions) {
    this.driver = options.driver
    this.storage = options.storage
    this.security = options.security
    this.logger = options.logger || new Logger()
  }

  async apply(version: Version, options: MigrationOptions = {}): Promise<void> {
    this.logger.info(`Applying version ${version}`, { version, options })
    
    // Acquire distributed lock
    const unlock = await this.driver.lock(`squizzle:apply:${version}`, options.timeout)
    
    try {
      // Check if already applied
      const applied = await this.driver.getAppliedVersions()
      if (applied.some(v => v.version === version && v.success)) {
        throw new VersionError(`Version ${version} already applied`)
      }

      // Pull artifact
      const { artifact, manifest } = await this.storage.pull(version)
      
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
        await tx.recordVersion(version, manifest, true)
      })
      
      this.logger.info(`Successfully applied version ${version}`)
      
    } catch (error) {
      this.logger.error(`Failed to apply version ${version}`, error)
      
      // Record failure
      try {
        await this.driver.recordVersion(
          version, 
          {} as Manifest, 
          false, 
          error instanceof Error ? error.message : String(error)
        )
      } catch (recordError) {
        this.logger.error('Failed to record version failure', recordError)
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
        await this.driver.connect()
        await this.driver.disconnect()
      } catch (error) {
        errors.push(`Database connection failed: ${error}`)
      }

    } catch (error) {
      errors.push(`Verification failed: ${error}`)
    }

    return { valid: errors.length === 0, errors }
  }

  private async verifyIntegrity(artifact: Buffer, manifest: Manifest): Promise<void> {
    const algorithm = manifest.checksumAlgorithm || 'sha256'
    const hash = createHash(algorithm)
    hash.update(artifact)
    const checksum = hash.digest('hex')
    
    if (checksum !== manifest.checksum) {
      throw new ChecksumError(
        `Checksum mismatch: expected ${manifest.checksum}, got ${checksum}`
      )
    }
  }

  private async extractMigrations(artifact: Buffer, manifest: Manifest): Promise<Migration[]> {
    // This would extract files from tarball/zip
    // For now, returning mock data
    return manifest.files.map(file => ({
      path: file.path,
      sql: '', // Would be extracted from artifact
      type: file.type as MigrationType,
      checksum: file.checksum
    }))
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
}