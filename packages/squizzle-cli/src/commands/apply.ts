import { MigrationEngine } from '@squizzle/core'
import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import { showSuccess, showError, showWarning } from '../ui/banner'

interface ApplyOptions {
  force?: boolean
  dryRun?: boolean
  timeout?: string
  parallel?: boolean
  maxParallel?: string
  env: string
}

export async function applyCommand(
  engine: MigrationEngine, 
  version: string, 
  options: ApplyOptions
): Promise<void> {
  try {
    // Verify version first
    if (!options.force) {
      const spinner = ora('Verifying version...').start()
      const { valid, errors } = await engine.verify(version)
      
      if (!valid) {
        spinner.fail('Verification failed')
        console.error(chalk.red('\nVerification errors:'))
        errors.forEach(err => console.error(`  • ${err}`))
        
        if (!options.dryRun) {
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Do you want to proceed anyway?',
            default: false
          }])
          
          if (!proceed) {
            process.exit(1)
          }
        }
      } else {
        spinner.succeed('Version verified')
      }
    }
    
    // Production confirmation
    if (options.env === 'production' && !options.dryRun && !process.env.CI) {
      showWarning('⚠️  You are about to apply migrations to PRODUCTION!')
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.red.bold('Are you absolutely sure?'),
        default: false
      }])
      
      if (!confirm) {
        console.log(chalk.yellow('Operation cancelled'))
        return
      }
      
      // Double confirmation for production
      const { confirmVersion } = await inquirer.prompt([{
        type: 'input',
        name: 'confirmVersion',
        message: `Type the version "${version}" to confirm:`
      }])
      
      if (confirmVersion !== version) {
        console.log(chalk.red('Version mismatch. Operation cancelled'))
        return
      }
    }
    
    // Apply version
    const applySpinner = ora(`Applying version ${version}...`).start()
    
    await engine.apply(version, {
      dryRun: options.dryRun,
      timeout: options.timeout ? parseInt(options.timeout) : undefined,
      parallel: options.parallel,
      maxParallel: options.maxParallel ? parseInt(options.maxParallel) : undefined,
      beforeEach: async (file) => {
        applySpinner.text = `Applying ${file}...`
      },
      afterEach: async (file, success) => {
        if (success) {
          applySpinner.text = `✓ Applied ${file}`
        }
      }
    })
    
    applySpinner.succeed(`Version ${version} applied successfully`)
    
    if (!options.dryRun) {
      const status = await engine.status()
      showSuccess(`Successfully applied v${version}`, {
        'Environment': options.env,
        'Current Version': status.current,
        'Applied At': new Date().toISOString()
      })
    } else {
      console.log(chalk.dim('\nDry run completed. No changes were made.'))
    }
    
  } catch (error) {
    showError('Failed to apply version', error as Error)
    process.exit(1)
  }
}