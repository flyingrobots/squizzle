import { GenericContainer, Wait } from 'testcontainers'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export interface PostgresConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface RegistryConfig {
  host: string
  port: number
  url: string
}

export interface IntegrationTestEnv {
  postgres: PostgresConfig
  registry: RegistryConfig
  tempDir: string
  cleanup: () => Promise<void>
}

export async function setupIntegrationTest(): Promise<IntegrationTestEnv> {
  // Create temp directory for artifacts
  const tempDir = await mkdtemp(join(tmpdir(), 'squizzle-integration-'))
  
  // Check if running in CI with services
  if (process.env.CI && process.env.POSTGRES_HOST) {
    return {
      postgres: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'squizzle_test',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'test'
      },
      registry: {
        host: process.env.REGISTRY_HOST || 'localhost',
        port: parseInt(process.env.REGISTRY_PORT || '5000'),
        url: `${process.env.REGISTRY_HOST || 'localhost'}:${process.env.REGISTRY_PORT || '5000'}`
      },
      tempDir,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  }
  
  // Local development - use testcontainers
  const postgres = await new GenericContainer('postgres:15')
    .withEnvironment({
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'squizzle_test'
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready'))
    .start()
  
  // Spin up Docker Registry for OCI storage tests
  const registry = await new GenericContainer('registry:2')
    .withExposedPorts(5000)
    .withWaitStrategy(Wait.forHttp('/v2/', 5000))
    .start()
  
  return {
    postgres: {
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'squizzle_test',
      user: 'postgres',
      password: 'test'
    },
    registry: {
      host: registry.getHost(),
      port: registry.getMappedPort(5000),
      url: `localhost:${registry.getMappedPort(5000)}`
    },
    tempDir,
    cleanup: async () => {
      await postgres.stop()
      await registry.stop()
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}

export function getConnectionString(config: PostgresConfig): string {
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`
}

// Helper to ensure proper cleanup even on test failures
export async function withIntegrationTest<T>(
  fn: (env: IntegrationTestEnv) => Promise<T>
): Promise<T> {
  const env = await setupIntegrationTest()
  try {
    return await fn(env)
  } finally {
    await env.cleanup()
  }
}