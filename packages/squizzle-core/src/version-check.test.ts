import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as cp from 'child_process'
import { VersionChecker, checkDatabaseConnection, checkStorageAccess } from './version-check'

// Mock child_process
vi.mock('child_process')

describe('VersionChecker', () => {
  let checker: VersionChecker

  beforeEach(() => {
    checker = new VersionChecker()
    checker.clearCache() // Clear cache before each test
    vi.clearAllMocks()
  })

  describe('checkCompatibility', () => {
    it('should detect compatible versions', async () => {
      // Mock execSync to return valid versions
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('drizzle-kit --version')) {
          return 'drizzle-kit@0.24.2\n'
        }
        if (cmd.includes('node --version')) {
          return 'v18.17.0\n'
        }
        if (cmd.includes('psql --version')) {
          return 'psql (PostgreSQL) 15.3\n'
        }
        return ''
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.compatible).toBe(true)
      expect(result.tools).toHaveLength(3)
      expect(result.tools[0]).toMatchObject({
        name: 'Drizzle Kit',
        installed: '0.24.2',
        required: '>=0.24.0',
        compatible: true
      })
    })

    it('should detect incompatible versions', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('drizzle-kit --version')) {
          return 'drizzle-kit@0.20.0\n' // Too old
        }
        if (cmd.includes('node --version')) {
          return 'v16.0.0\n' // Too old
        }
        if (cmd.includes('psql --version')) {
          return 'psql (PostgreSQL) 12.0\n' // Too old
        }
        return ''
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.compatible).toBe(false)
      expect(result.suggestions).toContain('Install compatible Drizzle Kit:')
      expect(result.suggestions).toContain('Update Node.js to >=18.0.0 or higher:')
    })

    it('should handle missing tools', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation(() => {
        throw new Error('command not found')
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.compatible).toBe(false)
      expect(result.tools.every(t => !t.compatible)).toBe(true)
      expect(result.tools[0].error).toContain('Not found')
    })

    it('should parse different version formats correctly', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('drizzle-kit')) {
          return 'drizzle-kit version 0.24.2\ndrizzle-kit@0.24.2'
        }
        if (cmd.includes('node')) {
          return 'v20.11.0'
        }
        if (cmd.includes('psql')) {
          return 'psql (PostgreSQL) 16.1 (Ubuntu 16.1-1.pgdg22.04+1)'
        }
        return ''
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.compatible).toBe(true)
      expect(result.tools[0].installed).toBe('0.24.2')
      expect(result.tools[1].installed).toBe('20.11.0')
      expect(result.tools[2].installed).toBe('16.1')
    })

    it('should cache results for performance', async () => {
      const mockExecSync = vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('drizzle-kit')) return 'drizzle-kit@0.24.2'
        if (cmd.includes('node')) return 'v18.17.0'
        if (cmd.includes('psql')) return 'psql (PostgreSQL) 15.3'
        return ''
      })
      
      // First call
      await checker.checkCompatibility()
      expect(mockExecSync).toHaveBeenCalledTimes(3)
      
      // Second call should use cache
      await checker.checkCompatibility()
      expect(mockExecSync).toHaveBeenCalledTimes(3) // Still 3, not 6
    })
  })

  describe('suggestions', () => {
    it('should provide installation suggestions for Drizzle Kit', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('drizzle-kit')) {
          throw new Error('command not found')
        }
        return 'v18.0.0'
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.suggestions).toContain('Install compatible Drizzle Kit:')
      expect(result.suggestions).toContain('npm install --save-dev drizzle-kit@latest')
    })

    it('should provide Node.js update suggestions', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('node')) {
          return 'v16.0.0'
        }
        return ''
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.suggestions).toContain('Update Node.js to >=18.0.0 or higher:')
      expect(result.suggestions).toContain('Use nvm: nvm install 18')
      expect(result.suggestions).toContain('Or download from: https://nodejs.org')
    })

    it('should provide PostgreSQL installation suggestions', async () => {
      vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('psql')) {
          throw new Error('command not found')
        }
        return 'v18.0.0'
      })
      
      const result = await checker.checkCompatibility()
      
      expect(result.suggestions).toContain('Install PostgreSQL client tools:')
      expect(result.suggestions).toContain('macOS: brew install postgresql')
      expect(result.suggestions).toContain('Ubuntu: apt-get install postgresql-client')
    })
  })
})

describe('checkDatabaseConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return connected for successful connection', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => '1\n')
    
    const result = await checkDatabaseConnection('postgresql://user:pass@localhost:5432/db')
    
    expect(result.connected).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should return error for failed connection', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => {
      throw new Error('connection refused')
    })
    
    const result = await checkDatabaseConnection('postgresql://user:pass@localhost:5432/db')
    
    expect(result.connected).toBe(false)
    expect(result.error).toContain('Cannot connect to database')
  })

  it('should handle invalid URLs', async () => {
    const result = await checkDatabaseConnection('not-a-url')
    
    expect(result.connected).toBe(false)
    expect(result.error).toContain('Cannot connect to database')
  })
})

describe('checkStorageAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should check filesystem storage access', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => '')
    
    const result = await checkStorageAccess({
      type: 'filesystem',
      path: '/tmp/storage'
    })
    
    expect(result.accessible).toBe(true)
  })

  it('should detect inaccessible filesystem storage', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => {
      throw new Error('Permission denied')
    })
    
    const result = await checkStorageAccess({
      type: 'filesystem',
      path: '/root/storage'
    })
    
    expect(result.accessible).toBe(false)
    expect(result.error).toContain('Storage not accessible')
  })

  it('should check OCI registry authentication', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => 
      'manifest unknown'
    )
    
    const result = await checkStorageAccess({
      type: 'oci',
      registry: 'ghcr.io',
      repository: 'org/repo'
    })
    
    expect(result.accessible).toBe(true)
  })

  it('should detect OCI authentication failure', async () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => 
      'unauthorized: authentication required'
    )
    
    const result = await checkStorageAccess({
      type: 'oci',
      registry: 'ghcr.io',
      repository: 'org/repo'
    })
    
    expect(result.accessible).toBe(false)
    expect(result.error).toContain('Not authenticated to OCI registry')
  })
})