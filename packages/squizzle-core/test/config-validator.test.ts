import { describe, it, expect, beforeEach } from 'vitest'
import { ConfigValidator } from '../src/config-validator'

describe('ConfigValidator', () => {
  let validator: ConfigValidator

  beforeEach(() => {
    validator = new ConfigValidator()
  })

  describe('required environment variables', () => {
    it('should require DATABASE_URL', () => {
      const result = validator.validate({})
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('DATABASE_URL is required')
      expect(result.suggestions).toContain('Set DATABASE_URL to your PostgreSQL connection string:')
    })

    it('should validate DATABASE_URL format', () => {
      const result = validator.validate({
        DATABASE_URL: 'not-a-url'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('DATABASE_URL is not a valid URL')
    })

    it('should require PostgreSQL protocol', () => {
      const result = validator.validate({
        DATABASE_URL: 'mysql://user:pass@localhost/db'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('DATABASE_URL must be a PostgreSQL connection string')
    })

    it('should accept valid PostgreSQL URLs', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db'
      })
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('storage configuration', () => {
    it('should require storage config for OCI type', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_STORAGE_TYPE: 'oci'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SQUIZZLE_STORAGE_REGISTRY required for OCI storage')
      expect(result.errors).toContain('SQUIZZLE_STORAGE_REPOSITORY required for OCI storage')
    })

    it('should warn about Docker config for OCI', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_STORAGE_TYPE: 'oci',
        SQUIZZLE_STORAGE_REGISTRY: 'ghcr.io',
        SQUIZZLE_STORAGE_REPOSITORY: 'org/repo'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('DOCKER_CONFIG not set - ensure you are logged into your registry')
    })

    it('should require path for filesystem storage', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_STORAGE_TYPE: 'filesystem'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SQUIZZLE_STORAGE_PATH required for filesystem storage')
    })
  })

  describe('security configuration', () => {
    it('should require sigstore config when signing enabled', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_SIGNING_ENABLED: 'true'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SIGSTORE_OIDC_CLIENT_ID required when signing is enabled')
    })

    it('should warn about plain text passwords', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://user:password=secret@localhost/test'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('DATABASE_URL contains password in plain text. Consider using a secrets manager.')
    })

    it('should warn about production without signing', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        NODE_ENV: 'production',
        SQUIZZLE_SIGNING_ENABLED: 'false'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('Running in production without artifact signing. Consider enabling security features.')
    })
  })

  describe('deprecated variables', () => {
    it('should warn about deprecated SQUIZZLE_REGISTRY', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_REGISTRY: 'old-registry'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('SQUIZZLE_REGISTRY is deprecated. Use SQUIZZLE_STORAGE_REGISTRY instead')
    })

    it('should warn about deprecated DB_URL', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        DB_URL: 'postgresql://localhost/test'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('DB_URL is deprecated. Use DATABASE_URL instead')
    })

    it('should warn about deprecated SQUIZZLE_DEBUG', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_DEBUG: 'true'
      })
      
      expect(result.valid).toBe(true)
      expect(result.warnings).toContain('SQUIZZLE_DEBUG is deprecated. Use SQUIZZLE_LOG_LEVEL=debug instead')
    })
  })

  describe('numeric validation', () => {
    it('should validate SQUIZZLE_PARALLEL_LIMIT as number', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_PARALLEL_LIMIT: 'not-a-number'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SQUIZZLE_PARALLEL_LIMIT must be a number')
    })

    it('should validate SQUIZZLE_LOCK_TIMEOUT as number', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_LOCK_TIMEOUT: 'invalid'
      })
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SQUIZZLE_LOCK_TIMEOUT must be a number')
    })

    it('should accept valid numeric values', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test',
        SQUIZZLE_PARALLEL_LIMIT: '5',
        SQUIZZLE_LOCK_TIMEOUT: '30000'
      })
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('suggestions', () => {
    it('should provide example .env file on errors', () => {
      const result = validator.validate({})
      
      expect(result.suggestions).toContain('Example .env file:')
      expect(result.suggestions).toContain('DATABASE_URL=postgresql://postgres:password@localhost:5432/mydb')
      expect(result.suggestions).toContain('SQUIZZLE_STORAGE_TYPE=oci')
    })

    it('should not provide example when valid', () => {
      const result = validator.validate({
        DATABASE_URL: 'postgresql://localhost/test'
      })
      
      expect(result.valid).toBe(true)
      expect(result.suggestions).not.toContain('Example .env file:')
    })
  })
})