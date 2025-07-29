import gradient from 'gradient-string'
import boxen from 'boxen'
import chalk from 'chalk'

const fire = gradient(['#FF6B6B', '#FF8E53', '#FE6B8B'])

export function showBanner(): void {
  const banner = `
███████╗ ██████╗ ██╗   ██╗██╗███████╗███████╗██╗     ███████╗
██╔════╝██╔═══██╗██║   ██║██║╚══███╔╝╚══███╔╝██║     ██╔════╝
███████╗██║   ██║██║   ██║██║  ███╔╝   ███╔╝ ██║     █████╗  
╚════██║██║▄▄ ██║██║   ██║██║ ███╔╝   ███╔╝  ██║     ██╔══╝  
███████║╚██████╔╝╚██████╔╝██║███████╗███████╗███████╗███████╗
╚══════╝ ╚══▀▀═╝  ╚═════╝ ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝`

  console.log(fire(banner))
  console.log(chalk.dim('Immutable Database Version Management v2.0.0'))
  console.log()
}

export function showSuccess(message: string, details?: Record<string, any>): void {
  const content = [message]
  
  if (details) {
    content.push('')
    Object.entries(details).forEach(([key, value]) => {
      content.push(`${chalk.dim(key)}: ${chalk.cyan(value)}`)
    })
  }
  
  console.log(
    boxen(content.join('\n'), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'green'
    })
  )
}

export function showError(message: string, error?: Error): void {
  const content = [chalk.red(message)]
  
  if (error?.message) {
    content.push('')
    content.push(chalk.dim(error.message))
  }
  
  console.log(
    boxen(content.join('\n'), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'red'
    })
  )
}

export function showWarning(message: string): void {
  console.log(
    boxen(chalk.yellow(message), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'yellow'
    })
  )
}