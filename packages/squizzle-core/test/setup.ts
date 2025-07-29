import { execSync } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { MigrationEngine } from '../src/engine'
import { createPostgresDriver } from '@squizzle/postgres'

const SYSTEM_ARTIFACT_PATH = join(__dirname, './artifacts/system-v1.0.0.tar.gz')
const SYSTEM_SQL_PATH = join(__dirname, '../sql/system/v1.0.0.sql')
const INFRA_PATH = join(__dirname, './infra')

export async function setupTestDatabase() {
  // Check if we're in CI environment
  const isCI = process.env.CI === 'true'
  const databaseUrl = process.env.DATABASE_URL
  
  if (isCI && databaseUrl) {
    // In CI, use the DATABASE_URL directly
    const sql = readFileSync(SYSTEM_SQL_PATH, 'utf-8')
    
    try {
      // Test connection
      execSync(`psql "${databaseUrl}" -c "SELECT 1"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      
      // Apply system tables
      execSync(`psql "${databaseUrl}"`, {
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      console.error('Failed to setup test database:', error)
      throw error
    }
  } else {
    // Local development - use Docker Compose
    const isRunning = execSync('docker compose -f docker-compose-simple.yml ps -q db', { 
      cwd: INFRA_PATH,
      encoding: 'utf-8' 
    }).trim()
    
    if (!isRunning) {
      throw new Error('Test database is not running. Run: cd test/infra && ./start.sh')
    }
    
    // For tests, we need to ensure the schema exists with proper permissions
    // First drop and recreate the schema to ensure clean state
    // Use superuser to drop and create schema with proper ownership
    const setupSql = `
      -- Drop schema if exists (cascade to drop all tables)
      DROP SCHEMA IF EXISTS squizzle CASCADE;
      
      -- Create schema with postgres as owner
      CREATE SCHEMA squizzle;
      
      -- Change ownership to postgres user
      ALTER SCHEMA squizzle OWNER TO postgres;
      
      -- Grant all privileges to postgres user
      GRANT ALL ON SCHEMA squizzle TO postgres;
    `
    
    execSync('docker compose -f docker-compose-simple.yml exec -T db psql -U supabase_admin -d squizzle_test', {
      cwd: INFRA_PATH,
      input: setupSql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    
    // Now apply system tables
    const sql = readFileSync(SYSTEM_SQL_PATH, 'utf-8')
    
    execSync('docker compose -f docker-compose-simple.yml exec -T db psql -U postgres -d squizzle_test', {
      cwd: INFRA_PATH,
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
}

export async function cleanupTestDatabase() {
  // Truncate all tables to ensure clean state
  const sql = `
    -- Clear all version records
    DELETE FROM squizzle.versions;
    -- Drop any test tables
    DROP TABLE IF EXISTS test_table CASCADE;
    DROP TABLE IF EXISTS bad_table CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `
  
  const isCI = process.env.CI === 'true'
  const databaseUrl = process.env.DATABASE_URL
  
  if (isCI && databaseUrl) {
    execSync(`psql "${databaseUrl}"`, {
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } else {
    execSync('docker compose -f docker-compose-simple.yml exec -T db psql -U postgres -d squizzle_test', {
      cwd: INFRA_PATH,
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
<<<<<<< HEAD
  } else {
    // In CI, skip cleanup as tables will be truncated per test
    console.log('Running in CI, skipping database cleanup')
=======
>>>>>>> origin/release/v0.1.0
  }
}