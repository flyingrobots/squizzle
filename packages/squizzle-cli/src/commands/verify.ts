import { MigrationEngine } from '@squizzle/core'
import chalk from 'chalk'
import ora from 'ora'

interface VerifyOptions {
  json?: boolean
  env: string
}

export async function verifyCommand(
  engine: MigrationEngine,
  version: string,
  options: VerifyOptions
): Promise<void> {
  const spinner = ora(`Verifying version ${version}...`).start()
  
  try {
    const result = await engine.verify(version)
    spinner.stop()
    
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    
    console.log(chalk.bold(`\n🔍 Verification Report for v${version}\n`))
    console.log(`Environment: ${chalk.cyan(options.env)}`)
    console.log(`Status: ${result.valid ? chalk.green('✓ Valid') : chalk.red('✗ Invalid')}`)
    
    if (result.errors.length > 0) {
      console.log(chalk.red('\nErrors:'))
      result.errors.forEach(error => {
        console.log(`  • ${error}`)
      })
    } else {
      console.log(chalk.green('\n✓ All checks passed'))
      console.log(chalk.dim('\nThis version can be safely applied.'))
    }
    
    process.exit(result.valid ? 0 : 1)
    
  } catch (error) {
    spinner.fail('Verification failed')
    console.error(chalk.red(`\nError: ${error}`))
    process.exit(1)
  }
}