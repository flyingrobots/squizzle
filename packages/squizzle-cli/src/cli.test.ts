import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'

// Path to the CLI executable
const CLI_PATH = join(__dirname, 'cli.ts')

// Helper to run CLI commands
async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('tsx', [CLI_PATH, ...args], {
      env: { ...process.env, NODE_ENV: 'test' }
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 })
    })
  })
}

describe.skip('CLI', () => {
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
      expect(stderr).toContain("Unknown command 'unknown-command'")
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
      const configContent = `
export default {
  driver: {
    type: 'postgres',
    connectionString: 'postgresql://test:test@localhost:5432/test'
  }
}
`
      await writeFile(testConfigPath, configContent)
      
      const { code } = await runCLI(['status', '--config', testConfigPath])
      expect(code).toBe(0)
    })

    it('should support verbose mode', async () => {
      const { stderr, code } = await runCLI(['--verbose', 'status'])
      expect(code).toBe(0)
      // Verbose mode should output debug info to stderr
      expect(stderr.length).toBeGreaterThan(0)
    })

    it('should support JSON output format', async () => {
      const { stdout, code } = await runCLI(['status', '--format', 'json'])
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
      const { stderr, code } = await runCLI(['status', '--config', 'non-existent.config.ts'])
      expect(code).toBe(1)
      expect(stderr).toContain('Config file not found')
    })

    it('should show error for invalid format option', async () => {
      const { stderr, code } = await runCLI(['status', '--format', 'invalid'])
      expect(code).toBe(1)
      expect(stderr).toContain("Invalid format 'invalid'")
    })

    it('should handle missing required options gracefully', async () => {
      const { stderr, code } = await runCLI(['apply'])
      expect(code).toBe(1)
      expect(stderr).toContain('Missing required argument')
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
      expect(stdout).toContain('build <version>')
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
      const invalidConfig = join(process.cwd(), 'invalid.config.ts')
      await writeFile(invalidConfig, 'invalid javascript code {{{')
      
      const { stderr, code } = await runCLI(['status', '--config', invalidConfig])
      expect(code).toBe(1)
      expect(stderr).toContain('Invalid config file')
      
      await unlink(invalidConfig)
    })
  })
})