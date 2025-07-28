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

// Initialize command
program
  .command('init')
  .description('Initialize SQUIZZLE in your project')
  .example('squizzle init')
  .example('squizzle init --config .squizzle.yaml')
  .action(async () => {
    await initCommand()
  })

// Build command
program
  .command('build <version>')
  .description('Build a new database version')
  .option('-n, --notes <notes>', 'version notes')
  .option('-a, --author <author>', 'version author')
  .option('-t, --tag <tags...>', 'version tags')
  .option('--dry-run', 'simulate build without creating artifacts')
  .example('squizzle build 1.0.0 --notes "Initial schema"')
  .example('squizzle build 1.1.0 --notes "Add user tables" --author "John Doe"')
  .example('squizzle build 2.0.0 --notes "Major refactor" --tag breaking --tag v2')
  .example('squizzle build 1.2.3 --dry-run')
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
  .example('squizzle apply 1.0.0')
  .example('squizzle apply 1.2.0 --env production')
  .example('squizzle apply 2.0.0 --dry-run')
  .example('squizzle apply 1.5.0 --parallel --max-parallel 10')
  .example('squizzle apply 3.0.0 --force --timeout 600000')
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
  .example('squizzle rollback 2.0.0')
  .example('squizzle rollback 1.5.0 --force')
  .example('squizzle rollback 3.0.0 --dry-run')
  .example('squizzle rollback 2.1.0 --env production')
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
  .example('squizzle status')
  .example('squizzle status --limit 20')
  .example('squizzle status --json')
  .example('squizzle status --env production')
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
  .example('squizzle verify 1.0.0')
  .example('squizzle verify 2.1.0 --json')
  .example('squizzle verify 3.0.0 --env staging')
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
  .example('squizzle list')
  .example('squizzle ls')
  .example('squizzle list --json')
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
  .example('squizzle config --init')
  .example('squizzle config --validate')
  .example('squizzle config --show')
  .example('squizzle config --show --config custom.yaml')
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