import chalk from 'chalk'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  suggestions: string[]
}


export class ConfigValidator {
  private errors: string[] = []
  private warnings: string[] = []
  private suggestions: string[] = []
  
  validate(env: Record<string, string | undefined> = process.env): ValidationResult {
    this.errors = []
    this.warnings = []
    this.suggestions = []
    
    // First, check required base vars
    this.validateRequired(env)
    
    // Then validate based on feature flags
    this.validateConditional(env)
    
    // Check for deprecated vars
    this.checkDeprecated(env)
    
    // Security checks
    this.validateSecurity(env)
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      suggestions: this.generateSuggestions()
    }
  }
  
  private validateRequired(env: Record<string, string | undefined>) {
    if (!env.DATABASE_URL) {
      this.errors.push('DATABASE_URL is required')
      this.suggestions.push(
        'Set DATABASE_URL to your PostgreSQL connection string:',
        '  export DATABASE_URL="postgresql://user:pass@localhost:5432/db"'
      )
    } else {
      // Validate format
      try {
        const url = new URL(env.DATABASE_URL)
        if (!url.protocol.startsWith('postgres')) {
          this.errors.push('DATABASE_URL must be a PostgreSQL connection string')
        }
      } catch {
        this.errors.push('DATABASE_URL is not a valid URL')
      }
    }
  }
  
  private validateConditional(env: Record<string, string | undefined>) {
    // If using OCI storage
    if (env.SQUIZZLE_STORAGE_TYPE === 'oci') {
      if (!env.SQUIZZLE_STORAGE_REGISTRY) {
        this.errors.push('SQUIZZLE_STORAGE_REGISTRY required for OCI storage')
      }
      if (!env.SQUIZZLE_STORAGE_REPOSITORY) {
        this.errors.push('SQUIZZLE_STORAGE_REPOSITORY required for OCI storage')
      }
      
      // Warn about auth
      if (!env.DOCKER_CONFIG) {
        this.warnings.push(
          'DOCKER_CONFIG not set - ensure you are logged into your registry'
        )
      }
    }
    
    // If using filesystem storage
    if (env.SQUIZZLE_STORAGE_TYPE === 'filesystem') {
      if (!env.SQUIZZLE_STORAGE_PATH) {
        this.errors.push('SQUIZZLE_STORAGE_PATH required for filesystem storage')
      }
    }
    
    // If security enabled
    if (env.SQUIZZLE_SIGNING_ENABLED === 'true') {
      if (!env.SIGSTORE_OIDC_CLIENT_ID) {
        this.errors.push('SIGSTORE_OIDC_CLIENT_ID required when signing is enabled')
      }
    }
  }
  
  private checkDeprecated(env: Record<string, string | undefined>) {
    const deprecated: Record<string, string> = {
      'SQUIZZLE_REGISTRY': 'Use SQUIZZLE_STORAGE_REGISTRY instead',
      'DB_URL': 'Use DATABASE_URL instead',
      'SQUIZZLE_DEBUG': 'Use SQUIZZLE_LOG_LEVEL=debug instead'
    }
    
    Object.entries(deprecated).forEach(([old, message]) => {
      if (env[old]) {
        this.warnings.push(`${old} is deprecated. ${message}`)
      }
    })
  }
  
  private validateSecurity(env: Record<string, string | undefined>) {
    // Check for sensitive values
    if (env.DATABASE_URL?.includes('password=')) {
      this.warnings.push(
        'DATABASE_URL contains password in plain text. Consider using a secrets manager.'
      )
    }
    
    // Check permissions
    if (env.NODE_ENV === 'production' && env.SQUIZZLE_SIGNING_ENABLED !== 'true') {
      this.warnings.push(
        'Running in production without artifact signing. Consider enabling security features.'
      )
    }
    
    // Validate number formats
    if (env.SQUIZZLE_PARALLEL_LIMIT && isNaN(Number(env.SQUIZZLE_PARALLEL_LIMIT))) {
      this.errors.push('SQUIZZLE_PARALLEL_LIMIT must be a number')
    }
    
    if (env.SQUIZZLE_LOCK_TIMEOUT && isNaN(Number(env.SQUIZZLE_LOCK_TIMEOUT))) {
      this.errors.push('SQUIZZLE_LOCK_TIMEOUT must be a number')
    }
  }
  
  private generateSuggestions(): string[] {
    const suggestions: string[] = [...this.suggestions]
    
    // Provide example .env file
    if (this.errors.length > 0) {
      suggestions.push(
        '',
        'Example .env file:',
        '```',
        '# Required',
        'DATABASE_URL=postgresql://postgres:password@localhost:5432/mydb',
        '',
        '# Storage (OCI)',
        'SQUIZZLE_STORAGE_TYPE=oci',
        'SQUIZZLE_STORAGE_REGISTRY=ghcr.io',
        'SQUIZZLE_STORAGE_REPOSITORY=myorg/squizzle-migrations',
        '',
        '# Security (optional)',
        'SQUIZZLE_SIGNING_ENABLED=true',
        'SIGSTORE_OIDC_CLIENT_ID=sigstore',
        '```'
      )
    }
    
    return suggestions
  }
}

// Export a configuration error class
export class ConfigurationError extends Error {
  constructor(message: string, public errors: string[]) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

// Integration with CLI/Engine
export function validateEnvironment(options: { exit?: boolean } = {}): void {
  const validator = new ConfigValidator()
  const result = validator.validate()
  
  if (!result.valid) {
    console.error(chalk.red('\n❌ Configuration Errors:\n'))
    result.errors.forEach(error => {
      console.error(chalk.red(`  • ${error}`))
    })
    
    if (result.suggestions.length > 0) {
      console.log(chalk.blue('\n💡 Suggestions:\n'))
      result.suggestions.forEach(suggestion => {
        console.log(chalk.blue(`  ${suggestion}`))
      })
    }
    
    if (options.exit !== false) {
      process.exit(1)
    }
  }
  
  if (result.warnings.length > 0) {
    console.warn(chalk.yellow('\n⚠️  Configuration Warnings:\n'))
    result.warnings.forEach(warning => {
      console.warn(chalk.yellow(`  • ${warning}`))
    })
  }
}