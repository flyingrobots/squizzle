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
    
    // Extract database name from DATABASE_URL
    const dbName = databaseUrl.includes('/postgres') ? 'postgres' : 'squizzle_test'
    
    execSync(`psql ${databaseUrl} -c "SELECT 1"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    
    execSync(`psql ${databaseUrl}`, {
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } else {
    // Local development - use Docker Compose
    const isRunning = execSync('docker compose -f docker-compose-simple.yml ps -q db', { 
      cwd: INFRA_PATH,
      encoding: 'utf-8' 
    }).trim()
    
    if (!isRunning) {
      throw new Error('Test database is not running. Run: cd test/infra && ./start.sh')
    }
    
    // For tests, we'll apply system tables directly via SQL for speed
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
    TRUNCATE TABLE squizzle_versions CASCADE;
    DROP TABLE IF EXISTS test_table CASCADE;
  `
  
  const isCI = process.env.CI === 'true'
  const databaseUrl = process.env.DATABASE_URL
  
  if (isCI && databaseUrl) {
    execSync(`psql ${databaseUrl}`, {
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } else {
    execSync('docker compose -f docker-compose-simple.yml exec -T db psql -U postgres -d squizzle_test', {
      cwd: INFRA_PATH,
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
}