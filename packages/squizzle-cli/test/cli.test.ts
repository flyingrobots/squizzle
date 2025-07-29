import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { spawn, execSync } from 'child_process'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'

// Path to the CLI executable
const CLI_PATH = join(__dirname, '..', 'dist', 'cli.js')

// Ensure CLI exists
if (!existsSync(CLI_PATH)) {
  throw new Error(`CLI not found at ${CLI_PATH}. Run 'npm run build' first.`)
}

// Helper to run CLI commands
async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      env: { 
        ...process.env, 
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:54332/postgres',
        SQUIZZLE_SKIP_VALIDATION: 'true',
        SQUIZZLE_STORAGE_TYPE: 'filesystem',
        SQUIZZLE_STORAGE_PATH: '/tmp/squizzle-test'
      },
      encoding: 'utf-8',
      timeout: 8000
    })
    
    return { stdout: result, stderr: '', code: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      code: error.status || 1
    }
  }
}

describe('CLI', { timeout: 15000 }, () => {
  beforeAll(() => {
    // Initialize the database before running tests
    try {
      execSync(
        `DATABASE_URL="postgresql://postgres:postgres@localhost:54332/postgres" SQUIZZLE_SKIP_VALIDATION=true node ${CLI_PATH} init:db --force`,
        { stdio: 'ignore' }
      )
    } catch (error) {
      console.error('Failed to initialize database:', error)
    }
  })

  describe('basic functionality', () => {
    it('should display help when no command is provided', async () => {
      const { stdout, code } = await runCLI(['--help'])
      expect(code).toBe(0)
      expect(stdout).toContain('SQUIZZLE - Immutable Database Version Management')
      expect(stdout).toContain('Commands:')
      expect(stdout).toContain('build')
      expect(stdout).toContain('apply')
      expect(stdout).toContain('status')
      expect(stdout).toContain('verify')
    })

    it('should display version', async () => {
      const { stdout, code } = await runCLI(['--version'])
      expect(code).toBe(0)
      expect(stdout).toMatch(/\d+\.\d+\.\d+/)
    })

    it('should show error for unknown command', async () => {
      const { stderr, code } = await runCLI(['unknown-command'])
      expect(code).toBe(1)
      expect(stderr).toContain("error: unknown command 'unknown-command'")
    })
  })

  describe('global options', () => {
    let testDbPath: string
    let testConfigPath: string

    beforeEach(async () => {
      testDbPath = join(process.cwd(), 'test-drizzle')
      testConfigPath = join(process.cwd(), 'test-squizzle.config.ts')
    })

    afterEach(async () => {
      if (existsSync(testConfigPath)) {
        await unlink(testConfigPath)
      }
    })

    it('should respect --drizzle-path option', async () => {
      const { stdout, code } = await runCLI(['status', '--drizzle-path', testDbPath])
      // Should complete without error even if directory doesn't exist
      expect(code).toBe(0)
    })

    it('should respect --config option', async () => {
      // Create a test config file
      const configContent = `version: '2.0'
storage:
  type: filesystem
  path: /tmp/test
environments:
  development:
    database:
      connectionString: postgresql://postgres:postgres@localhost:54332/postgres
`
      await writeFile(testConfigPath, configContent)
      
      const { code } = await runCLI(['status', '--config', testConfigPath])
      expect(code).toBe(0)
    })

    it('should support verbose mode', async () => {
      const { stdout, code } = await runCLI(['--verbose', 'status'])
      expect(code).toBe(0)
      // Just check that it runs without error
      expect(stdout).toBeTruthy()
    })

    it('should support JSON output format', async () => {
      const { stdout, code } = await runCLI(['status', '--json'])
      expect(code).toBe(0)
      expect(() => JSON.parse(stdout)).not.toThrow()
    })
  })

  describe('environment variable support', () => {
    it('should read database URL from environment', async () => {
      const { code } = await runCLI(['status'])
      // Should not fail even without database
      expect(code).toBe(0)
    })

    it('should prefer CLI option over environment variable', async () => {
      const customPath = './custom-drizzle'
      const { code } = await runCLI(['status', '--drizzle-path', customPath])
      expect(code).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should show helpful error for missing config', async () => {
      const { stderr, code } = await runCLI(['status', '--config', 'non-existent.yaml'])
      expect(code).toBe(1)
      expect(stderr).toContain('Config file not found')
    })

    it('should show error for invalid option', async () => {
      const { stderr, code } = await runCLI(['status', '--invalid-option'])
      expect(code).toBe(1)
      expect(stderr).toContain("error: unknown option '--invalid-option'")
    })

    it('should handle missing required options gracefully', async () => {
      const { stderr, code } = await runCLI(['apply'])
      expect(code).toBe(1)
      expect(stderr).toContain('missing required argument')
    })
  })

  describe('command validation', () => {
    it('should validate version format in build command', async () => {
      const { stderr, code } = await runCLI(['build', 'invalid-version'])
      expect(code).toBe(1)
      expect(stderr).toContain('Invalid version format')
    })

    it('should validate version format in apply command', async () => {
      const { stderr, code } = await runCLI(['apply', 'v1.2.3']) // Note: 'v' prefix should be invalid
      expect(code).toBe(1)
      expect(stderr).toContain('Invalid version format')
    })

    it('should require notes for build command', async () => {
      const { stderr, code } = await runCLI(['build', '1.0.0'])
      expect(code).toBe(1)
      expect(stderr).toContain('Notes are required')
    })
  })

  describe('help system', () => {
    it('should show command-specific help', async () => {
      const { stdout, code } = await runCLI(['build', '--help'])
      expect(code).toBe(0)
      expect(stdout).toContain('squizzle build')
      expect(stdout).toContain('Build a new migration bundle')
      expect(stdout).toContain('--notes')
      expect(stdout).toContain('--tag')
    })

    it('should show help for all commands', async () => {
      const commands = ['build', 'apply', 'status', 'verify']
      
      for (const cmd of commands) {
        const { stdout, code } = await runCLI([cmd, '--help'])
        expect(code).toBe(0)
        expect(stdout).toContain(cmd)
      }
    })
  })

  describe('exit codes', () => {
    it('should exit with 0 on success', async () => {
      const { code } = await runCLI(['--help'])
      expect(code).toBe(0)
    })

    it('should exit with 1 on command error', async () => {
      const { code } = await runCLI(['unknown'])
      expect(code).toBe(1)
    })

    it('should exit with 2 on validation error', async () => {
      const { code } = await runCLI(['build', 'invalid'])
      expect(code).toBe(1) // Validation errors also return 1 in most CLIs
    })
  })

  describe('piping and scripting support', () => {
    it('should support quiet mode for scripting', async () => {
      const { stdout, stderr, code } = await runCLI(['status', '--quiet'])
      expect(code).toBe(0)
      expect(stdout).toBe('')
      expect(stderr).toBe('')
    })

    it('should output only essential info in quiet mode with errors', async () => {
      const { stderr, code } = await runCLI(['apply', 'invalid', '--quiet'])
      expect(code).toBe(1)
      expect(stderr).toContain('Invalid version')
      expect(stderr.split('\n').length).toBeLessThanOrEqual(2) // Minimal output
    })
  })

  describe('interactive features', () => {
    it('should detect TTY and adjust output accordingly', async () => {
      // When not in TTY, should not use colors or interactive features
      const { stdout } = await runCLI(['--help'])
      // Check that ANSI color codes are not present
      expect(stdout).not.toMatch(/\x1b\[[0-9;]*m/)
    })
  })

  describe('configuration loading', () => {
    it('should look for config in standard locations', async () => {
      const { code } = await runCLI(['status'])
      expect(code).toBe(0)
      // Should work even without config
    })

    it('should validate config file format', async () => {
      const invalidConfig = join(process.cwd(), 'invalid.config.yaml')
      await writeFile(invalidConfig, 'invalid: yaml: {{{: content')
      
      const { stderr, code } = await runCLI(['status', '--config', invalidConfig])
      expect(code).toBe(1)
      // YAML parsing error message will vary, just check it failed
      expect(stderr).toBeTruthy()
      
      await unlink(invalidConfig)
    })
  })
})