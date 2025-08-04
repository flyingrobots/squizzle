import { execa } from 'execa'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runCliCommand(
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {}
): Promise<CommandResult> {
  const cliPath = join(__dirname, '../../packages/squizzle-cli/dist/cli.js')
  
  const { exitCode, stdout, stderr } = await execa(
    'node',
    [cliPath, ...args],
    {
      env: {
        ...process.env,
        ...options.env,
        // Disable color for easier testing
        NO_COLOR: '1',
        FORCE_COLOR: '0'
      },
      cwd: options.cwd,
      reject: false,
      all: true,
      timeout: 30000, // 30 second timeout to prevent hanging
      killSignal: 'SIGKILL' // Force kill if hanging
    }
  )
  
  return { 
    exitCode: exitCode || 0, 
    stdout: stdout || '', 
    stderr: stderr || '' 
  }
}

export async function createTestMigration(
  dir: string,
  filename: string,
  content: string
): Promise<void> {
  const migrationsDir = join(dir, 'drizzle')
  await mkdir(migrationsDir, { recursive: true })
  await writeFile(join(migrationsDir, filename), content)
}

export async function createDrizzleConfig(
  dir: string,
  connectionString: string
): Promise<void> {
  const config = `
import type { Config } from 'drizzle-kit'

export default {
  schema: './schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: '${connectionString}'
  }
} satisfies Config
`
  await writeFile(join(dir, 'drizzle.config.ts'), config)
}

export async function createSquizzleConfig(
  dir: string,
  options: {
    connectionString: string
    registryUrl?: string
    repository?: string
  }
): Promise<void> {
  const config = `
export default {
  driver: {
    type: 'postgres',
    connectionString: '${options.connectionString}'
  },
  storage: {
    type: '${options.registryUrl ? 'oci' : 'filesystem'}',
    ${options.registryUrl ? `registry: '${options.registryUrl}',` : ''}
    ${options.repository ? `repository: '${options.repository}'` : ''}
  }
}
`
  await writeFile(join(dir, 'squizzle.config.ts'), config)
}

// Helper to create a full test project structure
export async function createTestProject(
  dir: string,
  options: {
    connectionString: string
    registryUrl?: string
  }
): Promise<void> {
  // Create basic project structure
  await mkdir(join(dir, 'drizzle'), { recursive: true })
  
  // Create configs
  await createDrizzleConfig(dir, options.connectionString)
  await createSquizzleConfig(dir, {
    connectionString: options.connectionString,
    registryUrl: options.registryUrl,
    repository: 'test/migrations'
  })
  
  // Create a simple schema file
  const schema = `
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow()
})
`
  await writeFile(join(dir, 'schema.ts'), schema)
}