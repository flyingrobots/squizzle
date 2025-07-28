#!/usr/bin/env node
import { Command } from 'commander'
import { createPostgresDriver } from '@squizzle/postgres'
import { createOCIStorage } from '@squizzle/oci'
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
import { createConfig, loadConfig } from './config'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load environment variables
config()

const program = new Command()

program
  .name('squizzle')
  .description('SQUIZZLE - Immutable Database Version Management')
  .version('2.0.0')
  .option('-c, --config <path>', 'config file path', '.squizzle.yaml')
  .option('-e, --env <environment>', 'environment to use', 'development')
  .option('-v, --verbose', 'verbose output')
  .option('--no-banner', 'disable banner')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().banner !== false) {
      showBanner()
    }
  })

// Initialize project command
program
  .command('init')
  .description('Initialize SQUIZZLE in your project')
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
    
    const driver = createPostgresDriver(config.environments[env].database)
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
  .description('Build a new database version')
  .option('-n, --notes <notes>', 'version notes')
  .option('-a, --author <author>', 'version author')
  .option('-t, --tag <tags...>', 'version tags')
  .option('--dry-run', 'simulate build without creating artifacts')
  .action(async (version, options) => {
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
  .action(async (version, options) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env].database)
    const storage = createOCIStorage(config.storage)
    const logger = new Logger({ level: program.opts().verbose ? 'debug' : 'info' })
    
    const engine = new MigrationEngine({
      driver,
      storage,
      logger
    })
    
    await applyCommand(engine, version, { ...options, env })
  })

// Rollback command
program
  .command('rollback <version>')
  .description('Rollback a database version')
  .option('-f, --force', 'force rollback without confirmation')
  .option('--dry-run', 'simulate rollback')
  .action(async (version, options) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env].database)
    const storage = createOCIStorage(config.storage)
    const logger = new Logger({ level: program.opts().verbose ? 'debug' : 'info' })
    
    const engine = new MigrationEngine({
      driver,
      storage,
      logger
    })
    
    await rollbackCommand(engine, version, { ...options, env })
  })

// Status command
program
  .command('status')
  .description('Show database version status')
  .option('-l, --limit <n>', 'limit number of versions shown', '10')
  .option('--json', 'output as JSON')
  .action(async (options) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env].database)
    const storage = createOCIStorage(config.storage)
    
    const engine = new MigrationEngine({
      driver,
      storage
    })
    
    await statusCommand(engine, { ...options, env })
  })

// Verify command
program
  .command('verify <version>')
  .description('Verify a database version can be applied')
  .option('--json', 'output as JSON')
  .action(async (version, options) => {
    const config = await loadConfig(program.opts().config)
    const env = program.opts().env
    
    const driver = createPostgresDriver(config.environments[env].database)
    const storage = createOCIStorage(config.storage)
    
    const engine = new MigrationEngine({
      driver,
      storage
    })
    
    await verifyCommand(engine, version, { ...options, env })
  })

// List command
program
  .command('list')
  .alias('ls')
  .description('List available versions')
  .option('--json', 'output as JSON')
  .action(async (options) => {
    const config = await loadConfig(program.opts().config)
    const storage = createOCIStorage(config.storage)
    
    const versions = await storage.list()
    
    if (options.json) {
      console.log(JSON.stringify(versions, null, 2))
    } else {
      console.log(chalk.bold('\nAvailable versions:'))
      versions.forEach(v => console.log(`  • ${v}`))
    }
  })

// Config command
program
  .command('config')
  .description('Manage SQUIZZLE configuration')
  .option('--init', 'initialize config file')
  .option('--validate', 'validate config file')
  .option('--show', 'show current config')
  .action(async (options) => {
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
  .action(async (options) => {
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