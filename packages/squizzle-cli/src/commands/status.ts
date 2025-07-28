import { MigrationEngine } from '@squizzle/core'
import Table from 'cli-table3'
import chalk from 'chalk'
import prettyMs from 'pretty-ms'

interface StatusOptions {
  limit?: string
  json?: boolean
  env: string
}

export async function statusCommand(
  engine: MigrationEngine,
  options: StatusOptions
): Promise<void> {
  try {
    const status = await engine.status()
    
    if (options.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }
    
    // Display current version
    console.log(chalk.bold('\n📍 Current Status\n'))
    console.log(`Environment: ${chalk.cyan(options.env)}`)
    console.log(`Current Version: ${status.current ? chalk.green(status.current) : chalk.yellow('No versions applied')}`)
    
    // Display applied versions table
    if (status.applied.length > 0) {
      console.log(chalk.bold('\n📋 Applied Versions\n'))
      
      const table = new Table({
        head: ['Version', 'Applied At', 'Status', 'Applied By', 'Checksum'],
        style: { head: ['cyan'] }
      })
      
      const limit = options.limit ? parseInt(options.limit) : 10
      status.applied.slice(0, limit).forEach(version => {
        const status = version.success 
          ? chalk.green('✓ Success')
          : chalk.red('✗ Failed')
        
        const timeAgo = prettyMs(Date.now() - version.appliedAt.getTime(), { compact: true })
        
        table.push([
          chalk.bold(version.version),
          `${version.appliedAt.toLocaleString()} (${chalk.dim(timeAgo + ' ago')})`,
          status,
          version.appliedBy,
          chalk.dim(version.checksum.substring(0, 8) + '...')
        ])
      })
      
      console.log(table.toString())
      
      if (status.applied.length > limit) {
        console.log(chalk.dim(`\n... and ${status.applied.length - limit} more versions`))
      }
    }
    
    // Display available versions
    if (status.available.length > 0) {
      console.log(chalk.bold('\n📦 Available Versions\n'))
      
      const unapplied = status.available.filter(v => 
        !status.applied.some(a => a.version === v && a.success)
      )
      
      if (unapplied.length > 0) {
        console.log(chalk.yellow('Not yet applied:'))
        unapplied.forEach(v => console.log(`  • ${v}`))
      }
      
      console.log(chalk.dim(`\nTotal available: ${status.available.length} versions`))
    }
    
    // Show summary
    const failed = status.applied.filter(v => !v.success).length
    if (failed > 0) {
      console.log(chalk.red(`\n⚠️  ${failed} failed version(s) detected`))
    }
    
  } catch (error) {
    console.error(chalk.red(`Failed to get status: ${error}`))
    process.exit(1)
  }
}