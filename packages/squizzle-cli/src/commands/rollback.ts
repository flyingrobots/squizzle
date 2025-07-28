import { MigrationEngine } from '@squizzle/core'
import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import { showSuccess, showError, showWarning } from '../ui/banner'

interface RollbackOptions {
  force?: boolean
  dryRun?: boolean
  env: string
}

export async function rollbackCommand(
  engine: MigrationEngine,
  version: string,
  options: RollbackOptions
): Promise<void> {
  try {
    // Check if version can be rolled back
    const status = await engine.status()
    const targetVersion = status.applied.find(v => v.version === version && v.success)
    
    if (!targetVersion) {
      showError(`Version ${version} not found or was not successfully applied`)
      process.exit(1)
    }
    
    // Show warning
    showWarning(`⚠️  Rolling back version ${version} from ${options.env}`)
    console.log(chalk.dim('\nThis operation will:'))
    console.log(chalk.dim('  • Execute rollback migrations for this version'))
    console.log(chalk.dim('  • Mark the version as rolled back'))
    console.log(chalk.dim('  • May result in data loss\n'))
    
    // Confirmation
    if (!options.force && !options.dryRun) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('Do you want to proceed with the rollback?'),
        default: false
      }])
      
      if (!confirm) {
        console.log(chalk.yellow('Rollback cancelled'))
        return
      }
      
      // Production double confirmation
      if (options.env === 'production') {
        const { confirmProd } = await inquirer.prompt([{
          type: 'input',
          name: 'confirmProd',
          message: chalk.red('Type "ROLLBACK PRODUCTION" to confirm:')
        }])
        
        if (confirmProd !== 'ROLLBACK PRODUCTION') {
          console.log(chalk.red('Confirmation failed. Rollback cancelled'))
          return
        }
      }
    }
    
    // Execute rollback
    const spinner = ora(`Rolling back version ${version}...`).start()
    
    await engine.rollback(version, {
      dryRun: options.dryRun,
      beforeEach: async (file) => {
        spinner.text = `Rolling back ${file}...`
      },
      afterEach: async (file, success) => {
        if (success) {
          spinner.text = `✓ Rolled back ${file}`
        }
      }
    })
    
    spinner.succeed(`Version ${version} rolled back successfully`)
    
    if (!options.dryRun) {
      showSuccess(`Successfully rolled back v${version}`, {
        'Environment': options.env,
        'Rolled Back At': new Date().toISOString()
      })
    } else {
      console.log(chalk.dim('\nDry run completed. No changes were made.'))
    }
    
  } catch (error) {
    showError('Rollback failed', error as Error)
    process.exit(1)
  }
}