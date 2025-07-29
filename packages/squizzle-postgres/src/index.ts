import { Client, Pool, PoolClient } from 'pg'
import advisoryLock from 'advisory-lock'
import { 
  DatabaseDriver, 
  AppliedVersion, 
  Version, 
  Manifest,
  DatabaseError,
  LockError 
} from '@squizzle/core'

export interface PostgresDriverOptions {
  connectionString?: string
  pool?: Pool
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean | object
  max?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
}

export class PostgresDriver implements DatabaseDriver {
  name = 'postgres'
  private pool: Pool
  private client?: PoolClient
  private locks = new Map<string, () => Promise<void>>()

  constructor(private options: PostgresDriverOptions) {
    if (options.pool) {
      this.pool = options.pool
    } else if (options.connectionString) {
      this.pool = new Pool({ connectionString: options.connectionString })
    } else {
      this.pool = new Pool({
        host: options.host || 'localhost',
        port: options.port || 5432,
        database: options.database || 'postgres',
        user: options.user || 'postgres',
        password: options.password,
        ssl: options.ssl,
        max: options.max || 10,
        idleTimeoutMillis: options.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: options.connectionTimeoutMillis || 2000
      })
    }
  }

  async connect(): Promise<void> {
    try {
      this.client = await this.pool.connect()
      await this.ensureVersionTable()
    } catch (error) {
      throw new DatabaseError(`Failed to connect: ${error}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.release()
      this.client = undefined
    }
    await this.pool.end()
  }

  async execute(sql: string): Promise<void> {
    const client = this.client || this.pool
    try {
      await client.query(sql)
    } catch (error) {
      throw new DatabaseError(`Failed to execute SQL: ${error}`)
    }
  }

  async query<T = any>(sql: string): Promise<T[]> {
    const client = this.client || this.pool
    try {
      const result = await client.query(sql)
      return result.rows
    } catch (error) {
      throw new DatabaseError(`Failed to query: ${error}`)
    }
  }

  async transaction<T>(fn: (client: DatabaseDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Create a new driver instance for the transaction
      const txDriver = new PostgresDriver({ pool: this.pool })
      txDriver.client = client
      
      const result = await fn(txDriver)
      
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        // Log rollback error but throw original error
        console.error('Rollback failed:', rollbackError)
      }
      throw error
    } finally {
      client.release()
    }
  }

  async getAppliedVersions(): Promise<AppliedVersion[]> {
    const sql = `
      SELECT 
        version,
        applied_at,
        applied_by,
        checksum,
        success,
        error,
        rollback_of
      FROM squizzle.squizzle_versions
      WHERE NOT is_system
      ORDER BY applied_at DESC
    `
    
    const rows = await this.query<{
      version: string
      applied_at: Date
      applied_by: string
      checksum: string
      success: boolean
      error?: string
      rollback_of?: string
    }>(sql)
    
    return rows.map(row => ({
      version: row.version as Version,
      appliedAt: row.applied_at,
      appliedBy: row.applied_by,
      checksum: row.checksum,
      success: row.success,
      error: row.error || undefined,
      rollbackOf: row.rollback_of ? row.rollback_of as Version : undefined
    }))
  }

  async recordVersion(
    version: Version, 
    manifest: Manifest, 
    success: boolean, 
    error?: string
  ): Promise<void> {
    const sql = `
      INSERT INTO squizzle.squizzle_versions (
        version, 
        checksum, 
        applied_by,
        success,
        error,
        manifest
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `
    
    const client = this.client || this.pool
    await client.query(sql, [
      version,
      manifest.checksum,
      process.env.USER || 'unknown',
      success,
      error,
      JSON.stringify(manifest)
    ])
  }

  async lock(key: string, timeout: number = 60000): Promise<() => Promise<void>> {
    // Get connection string from pool config
    const config = (this.pool as any).options || this.pool
    const connectionString = this.options.connectionString || 
      `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`
    
    try {
      // Use advisory-lock library
      const mutex = advisoryLock(connectionString)(key)
      
      // Try to acquire lock without blocking
      const unlock = await mutex.tryLock()
      
      if (!unlock) {
        throw new LockError(`Lock ${key} is already held by another process`)
      }
      
      const release = async () => {
        await unlock()
        this.locks.delete(key)
      }
      
      this.locks.set(key, release)
      return release
    } catch (error) {
      if (error instanceof LockError) throw error
      throw new LockError(`Failed to acquire lock ${key}: ${error}`)
    }
  }

  private async ensureVersionTable(): Promise<void> {
    const sql = `
      CREATE SCHEMA IF NOT EXISTS squizzle;
      
      CREATE TABLE IF NOT EXISTS squizzle.squizzle_versions (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) NOT NULL UNIQUE,
        checksum VARCHAR(128) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        applied_by VARCHAR(255) NOT NULL,
        success BOOLEAN NOT NULL DEFAULT true,
        error TEXT,
        rollback_of VARCHAR(50),
        manifest JSONB NOT NULL,
        is_system BOOLEAN DEFAULT false
      );
      
      CREATE INDEX IF NOT EXISTS idx_squizzle_versions_applied_at 
        ON squizzle.squizzle_versions(applied_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_squizzle_versions_success 
        ON squizzle.squizzle_versions(success);
      
      CREATE INDEX IF NOT EXISTS idx_squizzle_versions_is_system 
        ON squizzle.squizzle_versions(is_system);
    `
    
    await this.execute(sql)
  }

}

// Factory function
export function createPostgresDriver(options: PostgresDriverOptions): DatabaseDriver {
  return new PostgresDriver(options)
}