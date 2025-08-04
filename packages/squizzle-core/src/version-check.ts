import { execSync } from 'child_process'
import semver from 'semver'
import chalk from 'chalk'
import { DatabaseError } from './errors'

interface ToolRequirement {
  name: string
  command: string
  versionFlag: string
  versionRegex: RegExp
  required: string
  parseVersion?: (output: string) => string
}

const TOOL_REQUIREMENTS: ToolRequirement[] = [
  {
    name: 'Drizzle Kit',
    command: 'drizzle-kit',
    versionFlag: '--version',
    versionRegex: /drizzle-kit@(\d+\.\d+\.\d+)/,
    required: '>=0.24.0',
    parseVersion: (output) => {
      const match = output.match(/drizzle-kit@(\d+\.\d+\.\d+)/)
      return match?.[1] || '0.0.0'
    }
  },
  {
    name: 'Node.js',
    command: 'node',
    versionFlag: '--version',
    versionRegex: /v(\d+\.\d+\.\d+)/,
    required: '>=18.0.0'
  },
  {
    name: 'PostgreSQL Client',
    command: 'psql',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+)/,
    required: '>=13.0',
    parseVersion: (output) => {
      const match = output.match(/(\d+\.\d+)/)
      const version = match?.[1] || '0.0'
      // PostgreSQL versions are often just major.minor, add .0 for semver
      return version.split('.').length === 2 ? `${version}.0` : version
    }
  }
]

export interface CompatibilityResult {
  compatible: boolean
  tools: Array<{
    name: string
    installed?: string
    required: string
    compatible: boolean
    error?: string
  }>
  suggestions: string[]
}

interface ToolCheckResult {
  name: string
  installed?: string
  required: string
  compatible: boolean
  error?: string
}

export class VersionChecker {
  private cache: Map<string, ToolCheckResult> = new Map()
  
  async checkCompatibility(): Promise<CompatibilityResult> {
    // Skip all checks only when explicitly requested (integration tests)
    if (process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
      const mockResults: ToolCheckResult[] = TOOL_REQUIREMENTS.map(req => ({
        name: req.name,
        installed: '999.999.999', // Mock high version to satisfy requirements
        required: req.required,
        compatible: true
      }))
      
      return {
        compatible: true,
        tools: mockResults,
        suggestions: []
      }
    }
    
    const results = await Promise.all(
      TOOL_REQUIREMENTS.map(tool => this.checkTool(tool))
    )
    
    const incompatible = results.filter(r => !r.compatible)
    const suggestions = this.generateSuggestions(results)
    
    return {
      compatible: incompatible.length === 0,
      tools: results,
      suggestions
    }
  }
  
  private async checkTool(requirement: ToolRequirement): Promise<ToolCheckResult> {
    // Skip external tool checks only when explicitly requested (integration tests)
    if (process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
      return {
        name: requirement.name,
        installed: '999.999.999', // Mock high version
        required: requirement.required,
        compatible: true
      }
    }
    
    // Check cache first
    const cacheKey = `${requirement.command}:${requirement.versionFlag}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }
    
    try {
      // Try to execute the command
      const output = execSync(
        `${requirement.command} ${requirement.versionFlag}`,
        { encoding: 'utf-8', stdio: 'pipe' }
      )
      
      // Parse version
      let version: string
      if (requirement.parseVersion) {
        version = requirement.parseVersion(output)
      } else {
        const match = output.match(requirement.versionRegex)
        version = match?.[1] || '0.0.0'
      }
      
      // Check compatibility
      const compatible = semver.satisfies(version, requirement.required)
      
      const result: ToolCheckResult = {
        name: requirement.name,
        installed: version,
        required: requirement.required,
        compatible,
        error: compatible ? undefined : `Version ${version} does not satisfy ${requirement.required}`
      }
      
      // Cache the result
      this.cache.set(cacheKey, result)
      
      return result
    } catch (error) {
      const result: ToolCheckResult = {
        name: requirement.name,
        required: requirement.required,
        compatible: false,
        error: `Not found. ${error instanceof Error ? error.message : String(error)}`
      }
      
      // Cache the error result too
      this.cache.set(cacheKey, result)
      
      return result
    }
  }
  
  private generateSuggestions(results: ToolCheckResult[]): string[] {
    const suggestions: string[] = []
    
    results.forEach(result => {
      if (!result.compatible) {
        switch (result.name) {
          case 'Drizzle Kit':
            suggestions.push(
              `Install compatible Drizzle Kit:`,
              `  npm install --save-dev drizzle-kit@latest`
            )
            break
            
          case 'Node.js':
            suggestions.push(
              `Update Node.js to ${result.required} or higher:`,
              `  Use nvm: nvm install 18`,
              `  Or download from: https://nodejs.org`
            )
            break
            
          case 'PostgreSQL Client':
            suggestions.push(
              `Install PostgreSQL client tools:`,
              `  macOS: brew install postgresql`,
              `  Ubuntu: apt-get install postgresql-client`,
              `  Or download from: https://www.postgresql.org/download/`
            )
            break
        }
      }
    })
    
    return suggestions
  }
  
  // Clear cache method for testing
  clearCache(): void {
    this.cache.clear()
  }
}

// CLI Integration
export async function checkVersionCompatibility(options: { 
  exit?: boolean,
  verbose?: boolean 
} = {}): Promise<boolean> {
  const checker = new VersionChecker()
  const result = await checker.checkCompatibility()
  
  if (options.verbose || !result.compatible) {
    console.log(chalk.bold('\n🔍 Version Compatibility Check:\n'))
    
    const table = result.tools.map(tool => ({
      Tool: tool.name,
      Required: tool.required,
      Installed: tool.installed || 'Not found',
      Status: tool.compatible ? '✅' : '❌'
    }))
    
    console.table(table)
  }
  
  if (!result.compatible) {
    console.error(chalk.red('\n❌ Incompatible tool versions detected\n'))
    
    if (result.suggestions.length > 0) {
      console.log(chalk.blue('💡 How to fix:\n'))
      result.suggestions.forEach(suggestion => {
        console.log(chalk.blue(`  ${suggestion}`))
      })
    }
    
    if (options.exit !== false) {
      process.exit(1)
    }
  } else if (options.verbose) {
    console.log(chalk.green('\n✅ All tools are compatible\n'))
  }
  
  return result.compatible
}

// Database connection check
export async function checkDatabaseConnection(
  connectionUrl: string
): Promise<{ connected: boolean; error?: string }> {
  // Skip database checks only when explicitly requested (integration tests)
  if (process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
    return { connected: true }
  }
  
  try {
    // Parse connection URL
    const url = new URL(connectionUrl)
    const host = url.hostname
    const port = url.port || '5432'
    
    // Try to connect using psql
    execSync(
      `psql -h ${host} -p ${port} -U ${url.username} -d postgres -c "SELECT 1" > /dev/null 2>&1`,
      { 
        env: { ...process.env, PGPASSWORD: url.password },
        timeout: 5000 
      }
    )
    
    return { connected: true }
  } catch (error) {
    return { 
      connected: false, 
      error: `Cannot connect to database: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// Storage access check
export async function checkStorageAccess(config: any): Promise<{ accessible: boolean; error?: string }> {
  // Skip storage checks only when explicitly requested (integration tests)
  if (process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
    return { accessible: true }
  }
  
  try {
    switch (config.type) {
      case 'filesystem':
        // Check if directory exists and is writable
        execSync(`test -w ${config.path}`)
        return { accessible: true }
        
      case 'oci':
        // Check if logged into registry
        const registryCheck = execSync(
          `docker manifest inspect ${config.registry}/${config.repository}:latest 2>&1 || true`,
          { encoding: 'utf-8' }
        )
        
        if (registryCheck.includes('unauthorized') || registryCheck.includes('denied')) {
          return { 
            accessible: false, 
            error: 'Not authenticated to OCI registry. Run docker login first.'
          }
        }
        
        return { accessible: true }
        
      default:
        return { accessible: true }
    }
  } catch (error) {
    return { 
      accessible: false, 
      error: `Storage not accessible: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// Pre-build checks combining all validations
export async function preBuildChecks(config: any): Promise<void> {
  // Skip all pre-build checks only when explicitly requested (integration tests)
  if (process.env.SQUIZZLE_SKIP_VALIDATION === 'true') {
    console.log(chalk.green('✅ Pre-build checks skipped (test mode)\n'))
    return
  }
  
  console.log(chalk.bold('\n🛡️  Running pre-build checks...\n'))
  
  // Check environment first
  const { validateEnvironment } = await import('./config-validator')
  validateEnvironment({ exit: false })
  
  // Then check versions
  const compatible = await checkVersionCompatibility({ exit: false })
  if (!compatible) {
    throw new Error('Tool version requirements not met')
  }
  
  // Check database connection
  const dbCheck = await checkDatabaseConnection(config.database.url)
  if (!dbCheck.connected) {
    throw new DatabaseError(dbCheck.error || 'Database connection failed')
  }
  
  // Check storage access
  const storageCheck = await checkStorageAccess(config.storage)
  if (!storageCheck.accessible) {
    throw new Error(storageCheck.error || 'Storage not accessible')
  }
  
  console.log(chalk.green('✅ All pre-build checks passed\n'))
}