#!/usr/bin/env node
import { Command } from 'commander'
import { createPostgresDriver } from '@squizzle/postgres'
import { createOCIStorage } from '@squizzle/oci'
import { ArtifactStorage } from '@squizzle/core'
import { MigrationEngine, Logger } from '@squizzle/core'
import { config } from 'dotenv'
import { buildCommand } from './commands/build'
import { applyCommand } from './commands/apply'
import { rollbackCommand } from './commands/rollback'
import { statusCommand } from './commands/status'
import { verifyCommand } from './commands/verify'
import { initCommand } from './commands/init'
import { completionCommand } from './commands/completion'
import { showBanner } from './ui/banner'
import { createConfig, loadConfig, Config } from './config'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateEnvironment, isValidVersion, Version, Manifest } from '@squizzle/core'

// Load environment variables
config()

// Helper to validate environment for commands that need it
function validateForCommand(): void {
  if (process.env.SQUIZZLE_SKIP_VALIDATION !== 'true') {
    validateEnvironment({ exit: true })
  }
}

// Helper to create storage based on config and environment
function createStorage(config: Config): ArtifactStorage {
  // In test mode, return a mock storage
  if (process.env.NODE_ENV === 'test' || process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
    return {
      list: async () => [],
      push: async (version: Version, artifact: Buffer, manifest: Manifest) => version,
      pull: async (version: Version) => ({ 
        artifact: Buffer.from('mock'),
        manifest: {
          version: version,
          previousVersion: null,
          checksum: 'mock',
          created: new Date().toISOString(),
          checksumAlgorithm: 'sha256' as const,
          drizzleKit: '0.25.0',
          engineVersion: '2.0.0',
          notes: '',
          author: 'test',
          files: [],
          dependencies: [],
          tags: [],
          platform: { os: 'linux', arch: 'x64', node: 'v18.0.0' }
        }
      }),
      exists: async () => false,
      delete: async () => {},
      getManifest: async () => ({
        version: '1.0.0' as Version,
        previousVersion: null,
        checksum: 'mock',
        created: new Date().toISOString(),
        checksumAlgorithm: 'sha256' as const,
        drizzleKit: '0.25.0',
        engineVersion: '2.0.0',
        notes: '',
        author: 'test',
        files: [],
        dependencies: [],
        tags: [],
        platform: { os: 'linux', arch: 'x64', node: 'v18.0.0' }
      })
    }
  }
  
  return createOCIStorage(config.storage)
}

const program = new Command()

program
  .name('squizzle')
  .description('SQUIZZLE - Immutable Database Version Management')
  .version('2.0.0')
  .option('-c, --config <path>', 'config file path', '.squizzle.yaml')
  .option('-e, --env <environment>', 'environment to use', 'development')
  .option('-v, --verbose', 'verbose output')
  .option('--no-banner', 'disable banner')
  .option('--quiet', 'suppress all output except errors')
  .option('--format <format>', 'output format (text, json)', 'text')
  .option('--drizzle-path <path>', 'path to drizzle directory', 'db/drizzle')
  .hook('preAction', (thisCommand) => {
    // Don't show banner in quiet mode, when banner is disabled, or when outputting JSON
    const opts = thisCommand.opts()
    if (opts.banner !== false && !opts.quiet && opts.format !== 'json' && !thisCommand.args.includes('--json')) {
      showBanner()
    }
  })

// Initialize project command
program
  .command('init')
  .description('Initialize SQUIZZLE in your project')
  .addHelpText('after', `
Examples:
  $ squizzle init
  $ squizzle init --config .squizzle.yaml`)
  .action(async () => {
    await initCommand()
  })

// Initialize database command
program
  .command('init:db')
  .alias('db:init')
  .description('Initialize Squizzle system tables in the database')
  .option('--force', 'Recreate tables even if they exist')
  .option('--dry-run', 'Show what would be created')
  .action(async (options) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env]?.database || {})
    const logger = new Logger({ level: program.opts().verbose ? 'debug' : 'info' })
    
    try {
      await driver.connect()
      
      // Read system SQL
      const systemSqlPath = join(__dirname, '../../squizzle-core/sql/system/v1.0.0.sql')
      const systemSql = readFileSync(systemSqlPath, 'utf-8')
      
      if (options.dryRun) {
        console.log(chalk.bold('\nSystem tables SQL to be executed:\n'))
        console.log(chalk.dim(systemSql))
        return
      }
      
      // Check if tables already exist
      const tables = await driver.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'squizzle_versions'
      `)
      
      if (tables.length > 0 && !options.force) {
        console.log(chalk.yellow('System tables already exist. Use --force to recreate.'))
        return
      }
      
      if (options.force && tables.length > 0) {
        logger.warn('Dropping existing system tables...')
        await driver.execute('DROP TABLE IF EXISTS squizzle_versions CASCADE')
      }
      
      logger.info('Creating Squizzle system tables...')
      await driver.execute(systemSql)
      
      console.log(chalk.green('✓ System tables initialized successfully'))
    } catch (error) {
      console.error(chalk.red(`Failed to initialize system tables: ${error}`))
      process.exit(1)
    } finally {
      await driver.disconnect()
    }
  })

// Build command
program
  .command('build <version>')
  .description('Build a new migration bundle')
  .option('-n, --notes <notes>', 'version notes')
  .option('-a, --author <author>', 'version author')
  .option('-t, --tag <tags...>', 'version tags')
  .option('--dry-run', 'preview build without creating artifact')
  .option('--verbose', 'show detailed file information')
  .addHelpText('after', `
Examples:
  $ squizzle build 1.0.0 --notes "Initial schema"
  $ squizzle build 1.1.0 --notes "Add user tables" --author "John Doe"
  $ squizzle build 2.0.0 --notes "Major refactor" --tag breaking --tag v2
  $ squizzle build 1.2.3 --dry-run
  $ squizzle build 1.0.1 --dry-run --verbose`)
  .action(async (version: string, options: any) => {
    // Validate version format
    if (!isValidVersion(version)) {
      console.error(chalk.red(`Invalid version format: ${version}`))
      console.error(chalk.dim('Version must be in semver format (e.g., 1.0.0, 2.1.0-beta.1)'))
      process.exit(1)
    }
    
    // Check for required notes
    if (!options.notes) {
      console.error(chalk.red('Notes are required for build command'))
      console.error(chalk.dim('Use --notes "Description of changes" to provide version notes'))
      process.exit(1)
    }
    
    validateForCommand()
    const config = await loadConfig(program.opts().config)
    await buildCommand(version, { ...options, config })
  })

// Apply command
program
  .command('apply <version>')
  .description('Apply a database version')
  .option('-f, --force', 'force apply even if checks fail')
  .option('--dry-run', 'simulate apply without running migrations')
  .option('--timeout <ms>', 'migration timeout in milliseconds', '300000')
  .option('--parallel', 'run independent migrations in parallel')
  .option('--max-parallel <n>', 'max parallel migrations', '5')
  .addHelpText('after', `
Examples:
  $ squizzle apply 1.0.0
  $ squizzle apply 1.2.0 --env production
  $ squizzle apply 2.0.0 --dry-run
  $ squizzle apply 1.5.0 --parallel --max-parallel 10
  $ squizzle apply 3.0.0 --force --timeout 600000`)
  .action(async (version: string, options: any) => {
    const globalOpts = program.opts()
    
    // Validate version format
    if (!isValidVersion(version)) {
      if (globalOpts.quiet) {
        console.error(`Invalid version format: ${version}`)
      } else {
        console.error(chalk.red(`Invalid version format: ${version}`))
        console.error(chalk.dim('Version must be in semver format (e.g., 1.0.0, 2.1.0-beta.1)'))
      }
      process.exit(1)
    }
    
    validateForCommand()
    const config = await loadConfig(globalOpts.config)
    const env = globalOpts.env
    
    const driver = createPostgresDriver(config.environments[env]?.database || {})
    try {
      const storage = createStorage(config)
      const logger = new Logger({ level: globalOpts.verbose ? 'debug' : 'info' })
      
      const engine = new MigrationEngine({
        driver,
        storage,
        logger
      })
      
      await applyCommand(engine, version, { ...options, env })
    } finally {
      await driver.disconnect()
    }
  })

// Rollback command
program
  .command('rollback <version>')
  .description('Rollback a database version')
  .option('-f, --force', 'force rollback without confirmation')
  .option('--dry-run', 'simulate rollback')
  .addHelpText('after', `
Examples:
  $ squizzle rollback 2.0.0
  $ squizzle rollback 1.5.0 --force
  $ squizzle rollback 3.0.0 --dry-run
  $ squizzle rollback 2.1.0 --env production`)
  .action(async (version: string, options: any) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env]?.database || {})
    try {
      const storage = createStorage(config)
      const logger = new Logger({ level: program.opts().verbose ? 'debug' : 'info' })
      
      const engine = new MigrationEngine({
        driver,
        storage,
        logger
      })
      
      await rollbackCommand(engine, version, { ...options, env })
    } finally {
      await driver.disconnect()
    }
  })

// Status command
program
  .command('status')
  .description('Show database version status')
  .option('-l, --limit <n>', 'limit number of versions shown', '10')
  .option('--json', 'output as JSON')
  .addHelpText('after', `
Examples:
  $ squizzle status
  $ squizzle status --limit 20
  $ squizzle status --json
  $ squizzle status --env production`)
  .action(async (options: any) => {
    validateForCommand()
    const globalOpts = program.opts()
    const config = await loadConfig(globalOpts.config)
    const env = globalOpts.env
    
    // Handle --format json as --json
    if (globalOpts.format === 'json') {
      options.json = true
    }
    
    // Handle quiet mode
    if (globalOpts.quiet) {
      // Suppress all console output for quiet mode
      const originalLog = console.log
      const originalError = console.error
      console.log = () => {}
      
      const driver = createPostgresDriver(config.environments[env]?.database || {})
      try {
        const storage = createStorage(config)
        
        const engine = new MigrationEngine({
          driver,
          storage
        })
        
        await statusCommand(engine, { ...options, env })
      } finally {
        console.log = originalLog
        console.error = originalError
        await driver.disconnect()
      }
    } else {
      const driver = createPostgresDriver(config.environments[env]?.database || {})
      try {
        const storage = createStorage(config)
        
        const engine = new MigrationEngine({
          driver,
          storage
        })
        
        await statusCommand(engine, { ...options, env })
      } finally {
        await driver.disconnect()
      }
    }
  })

// Verify command
program
  .command('verify <version>')
  .description('Verify a database version can be applied')
  .option('--json', 'output as JSON')
  .addHelpText('after', `
Examples:
  $ squizzle verify 1.0.0
  $ squizzle verify 2.1.0 --json
  $ squizzle verify 3.0.0 --env staging`)
  .action(async (version: string, options: any) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env]?.database || {})
    try {
      const storage = createStorage(config)
      
      const engine = new MigrationEngine({
        driver,
        storage
      })
      
      await verifyCommand(engine, version, { ...options, env })
    } finally {
      await driver.disconnect()
    }
  })

// List command
program
  .command('list')
  .alias('ls')
  .description('List available versions')
  .option('--json', 'output as JSON')
  .addHelpText('after', `
Examples:
  $ squizzle list
  $ squizzle ls
  $ squizzle list --json`)
  .action(async (options: any) => {
    const config = await loadConfig(program.opts().config)
    const storage = createStorage(config)
    
    const versions = await storage.list()
    
    if (options.json) {
      console.log(JSON.stringify(versions, null, 2))
    } else {
      console.log(chalk.bold('\nAvailable versions:'))
      versions.forEach((v: string) => console.log(`  • ${v}`))
    }
  })

// Config command
program
  .command('config')
  .description('Manage SQUIZZLE configuration')
  .option('--init', 'initialize config file')
  .option('--validate', 'validate config file')
  .option('--show', 'show current config')
  .addHelpText('after', `
Examples:
  $ squizzle config --init
  $ squizzle config --validate
  $ squizzle config --show
  $ squizzle config --show --config custom.yaml`)
  .action(async (options: any) => {
    if (options.init) {
      await createConfig()
    } else if (options.validate) {
      try {
        await loadConfig(program.opts().config)
        console.log(chalk.green('✓ Configuration is valid'))
      } catch (error) {
        console.error(chalk.red(`✗ Configuration is invalid: ${error}`))
        process.exit(1)
      }
    } else if (options.show) {
      const config = await loadConfig(program.opts().config)
      console.log(JSON.stringify(config, null, 2))
    }
  })

// Doctor command - check system health
program
  .command('doctor')
  .description('Check system health and compatibility')
  .option('--fix', 'attempt to fix issues automatically')
  .action(async () => {
    const { checkVersionCompatibility, checkDatabaseConnection } = await import('@squizzle/core')
    
    console.log(chalk.bold('\n🩺 Running system diagnostics...\n'))
    
    // Check environment
    console.log(chalk.bold('Environment Variables:'))
    validateEnvironment({ exit: false })
    
    // Check versions
    const compatible = await checkVersionCompatibility({ exit: false, verbose: true })
    
    // Check database connection
    if (process.env.DATABASE_URL) {
      console.log(chalk.bold('\nDatabase Connection:'))
      const dbCheck = await checkDatabaseConnection(process.env.DATABASE_URL)
      if (dbCheck.connected) {
        console.log(chalk.green('  ✅ Database connection successful'))
      } else {
        console.log(chalk.red(`  ❌ ${dbCheck.error}`))
      }
    }
    
    if (!compatible) {
      console.log(chalk.yellow('\n⚕️  Some issues were found. Run with --fix to attempt automatic fixes.'))
    } else {
      console.log(chalk.green('\n✅ All systems healthy!'))
    }
  })

// Completion command
program
  .command('completion')
  .description('Generate shell completion script')
  .option('--shell <shell>', 'Shell type (bash, zsh, fish, powershell)', 'bash')
  .addHelpText('after', `
Examples:
  # Generate bash completion
  $ squizzle completion --shell bash > ~/.bash_completion.d/squizzle

  # Generate zsh completion
  $ squizzle completion --shell zsh > ~/.zsh/completions/_squizzle

  # Generate fish completion
  $ squizzle completion --shell fish > ~/.config/fish/completions/squizzle.fish

  # Generate PowerShell completion
  $ squizzle completion --shell powershell >> $PROFILE
`)
  .action(async (options: any) => {
    await completionCommand(options)
  })

// Parse and execute
program.parse()

// Handle errors
process.on('unhandledRejection', (error: any) => {
  console.error(chalk.red(`\n✗ ${error.message || error}`))
  if (program.opts().verbose && error.stack) {
    console.error(chalk.dim(error.stack))
  }
  process.exit(1)
})