import { execSync } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { MigrationEngine } from '../src/engine'
import { createPostgresDriver } from '@squizzle/postgres'

const SYSTEM_ARTIFACT_PATH = join(__dirname, './artifacts/system-v1.0.0.tar.gz')
const SYSTEM_SQL_PATH = join(__dirname, '../sql/system/v1.0.0.sql')
const INFRA_PATH = join(__dirname, './infra')

export async function setupTestDatabase() {
  // Check if running in CI
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
  
  if (!isCI) {
    // Ensure database is running locally
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
  } else {
    // In CI, database setup is handled by ci-setup.sh
    console.log('Running in CI, skipping database setup (handled by ci-setup.sh)')
  }
}

export async function cleanupTestDatabase() {
  // Truncate all tables to ensure clean state
  const sql = `
    TRUNCATE TABLE squizzle_versions CASCADE;
    DROP TABLE IF EXISTS test_table CASCADE;
  `
  
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
  
  if (!isCI) {
    execSync('docker compose -f docker-compose-simple.yml exec -T db psql -U postgres -d squizzle_test', {
      cwd: INFRA_PATH,
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } else {
    // In CI, skip cleanup as tables will be truncated per test
    console.log('Running in CI, skipping database cleanup')
  }
}