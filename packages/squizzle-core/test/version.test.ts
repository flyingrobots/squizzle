import { describe, it, expect } from 'vitest'
import { isValidVersion, compareVersions, getNextVersion } from '../src/version'
import { Version } from '../src/types'

describe('version utilities', () => {
  describe('isValidVersion', () => {
    it('should validate standard semver versions', () => {
      const validVersions = [
        '0.0.0',
        '0.0.1',
        '0.1.0',
        '1.0.0',
        '1.2.3',
        '10.20.30',
        '999.999.999'
      ]

      validVersions.forEach(version => {
        expect(isValidVersion(version)).toBe(true)
      })
    })

    it('should validate prerelease versions', () => {
      const validVersions = [
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-rc.1',
        '2.0.0-preview',
        '3.0.0-dev.123'
      ]

      validVersions.forEach(version => {
        expect(isValidVersion(version)).toBe(true)
      })
    })

    it('should reject invalid versions', () => {
      const invalidVersions = [
        '',
        '1',
        '1.2',
        '1.2.a',
        'v1.0.0',
        '1.0.0.0',
        '1.0',
        'latest',
        '1.0.0-',
        '-1.0.0',
        '1.-2.3',
        '1.2.-3',
        'abc',
        '1.0.0+build'  // Build metadata not supported
      ]

      invalidVersions.forEach(version => {
        expect(isValidVersion(version)).toBe(false)
      })
    })

    it('should provide type guard functionality', () => {
      const input: string = '1.0.0'
      
      if (isValidVersion(input)) {
        // TypeScript should recognize input as Version here
        const version: Version = input
        expect(version).toBe('1.0.0')
      } else {
        throw new Error('Should be valid')
      }
    })
  })

  describe('compareVersions', () => {
    describe('major version comparison', () => {
      it('should compare major versions correctly', () => {
        expect(compareVersions('2.0.0' as Version, '1.0.0' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.0' as Version, '2.0.0' as Version)).toBeLessThan(0)
        expect(compareVersions('1.0.0' as Version, '1.0.0' as Version)).toBe(0)
      })

      it('should prioritize major over minor and patch', () => {
        expect(compareVersions('2.0.0' as Version, '1.99.99' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.0' as Version, '2.0.0' as Version)).toBeLessThan(0)
      })
    })

    describe('minor version comparison', () => {
      it('should compare minor versions correctly', () => {
        expect(compareVersions('1.2.0' as Version, '1.1.0' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.1.0' as Version, '1.2.0' as Version)).toBeLessThan(0)
        expect(compareVersions('1.1.0' as Version, '1.1.0' as Version)).toBe(0)
      })

      it('should prioritize minor over patch when major is equal', () => {
        expect(compareVersions('1.2.0' as Version, '1.1.99' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.1.0' as Version, '1.2.0' as Version)).toBeLessThan(0)
      })
    })

    describe('patch version comparison', () => {
      it('should compare patch versions correctly', () => {
        expect(compareVersions('1.0.2' as Version, '1.0.1' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.1' as Version, '1.0.2' as Version)).toBeLessThan(0)
        expect(compareVersions('1.0.1' as Version, '1.0.1' as Version)).toBe(0)
      })
    })

    describe('prerelease version comparison', () => {
      it('should treat non-prerelease as greater than prerelease', () => {
        expect(compareVersions('1.0.0' as Version, '1.0.0-alpha' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.0-alpha' as Version, '1.0.0' as Version)).toBeLessThan(0)
      })

      it('should compare prerelease versions alphabetically', () => {
        expect(compareVersions('1.0.0-beta' as Version, '1.0.0-alpha' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.0-alpha' as Version, '1.0.0-beta' as Version)).toBeLessThan(0)
        expect(compareVersions('1.0.0-rc.1' as Version, '1.0.0-beta' as Version)).toBeGreaterThan(0)
      })

      it('should compare prerelease with numbers correctly', () => {
        expect(compareVersions('1.0.0-alpha.2' as Version, '1.0.0-alpha.1' as Version)).toBeGreaterThan(0)
        expect(compareVersions('1.0.0-beta.10' as Version, '1.0.0-beta.2' as Version)).toBeGreaterThan(0)
      })

      it('should handle equal prerelease versions', () => {
        expect(compareVersions('1.0.0-alpha' as Version, '1.0.0-alpha' as Version)).toBe(0)
        expect(compareVersions('1.0.0-beta.1' as Version, '1.0.0-beta.1' as Version)).toBe(0)
      })
    })

    describe('mixed comparisons', () => {
      it('should handle various version combinations', () => {
        const versions: Version[] = [
          '0.0.1',
          '0.1.0',
          '0.1.1',
          '1.0.0-alpha',
          '1.0.0-alpha.1',
          '1.0.0-beta',
          '1.0.0-rc.1',
          '1.0.0',
          '1.0.1',
          '1.1.0',
          '2.0.0'
        ] as Version[]

        // Verify each version is less than the next
        for (let i = 0; i < versions.length - 1; i++) {
          expect(compareVersions(versions[i], versions[i + 1])).toBeLessThan(0)
          expect(compareVersions(versions[i + 1], versions[i])).toBeGreaterThan(0)
        }
      })
    })

    describe('edge cases', () => {
      it('should handle large version numbers', () => {
        expect(compareVersions('999.999.999' as Version, '999.999.998' as Version)).toBeGreaterThan(0)
        expect(compareVersions('100.0.0' as Version, '99.99.99' as Version)).toBeGreaterThan(0)
      })

      it('should handle versions with leading zeros', () => {
        expect(compareVersions('1.01.0' as Version, '1.1.0' as Version)).toBe(0)
        expect(compareVersions('1.0.01' as Version, '1.0.1' as Version)).toBe(0)
      })
    })
  })

  describe('getNextVersion', () => {
    describe('patch bumping (default)', () => {
      it('should increment patch version by default', () => {
        expect(getNextVersion('1.0.0' as Version)).toBe('1.0.1')
        expect(getNextVersion('1.2.3' as Version)).toBe('1.2.4')
        expect(getNextVersion('0.0.0' as Version)).toBe('0.0.1')
      })

      it('should handle double-digit patches', () => {
        expect(getNextVersion('1.0.9' as Version)).toBe('1.0.10')
        expect(getNextVersion('1.0.99' as Version)).toBe('1.0.100')
      })

      it('should strip prerelease when bumping patch', () => {
        expect(getNextVersion('1.0.0-alpha' as Version)).toBe('1.0.1')
        expect(getNextVersion('1.2.3-beta.1' as Version)).toBe('1.2.4')
      })
    })

    describe('minor bumping', () => {
      it('should increment minor version and reset patch', () => {
        expect(getNextVersion('1.0.0' as Version, 'minor')).toBe('1.1.0')
        expect(getNextVersion('1.2.3' as Version, 'minor')).toBe('1.3.0')
        expect(getNextVersion('0.0.1' as Version, 'minor')).toBe('0.1.0')
      })

      it('should handle double-digit minors', () => {
        expect(getNextVersion('1.9.0' as Version, 'minor')).toBe('1.10.0')
        expect(getNextVersion('1.99.5' as Version, 'minor')).toBe('1.100.0')
      })

      it('should strip prerelease when bumping minor', () => {
        expect(getNextVersion('1.0.0-alpha' as Version, 'minor')).toBe('1.1.0')
        expect(getNextVersion('1.2.3-rc.1' as Version, 'minor')).toBe('1.3.0')
      })
    })

    describe('major bumping', () => {
      it('should increment major version and reset minor and patch', () => {
        expect(getNextVersion('1.0.0' as Version, 'major')).toBe('2.0.0')
        expect(getNextVersion('1.2.3' as Version, 'major')).toBe('2.0.0')
        expect(getNextVersion('0.1.0' as Version, 'major')).toBe('1.0.0')
      })

      it('should handle double-digit majors', () => {
        expect(getNextVersion('9.0.0' as Version, 'major')).toBe('10.0.0')
        expect(getNextVersion('99.1.2' as Version, 'major')).toBe('100.0.0')
      })

      it('should strip prerelease when bumping major', () => {
        expect(getNextVersion('1.0.0-alpha' as Version, 'major')).toBe('2.0.0')
        expect(getNextVersion('2.0.0-beta' as Version, 'major')).toBe('3.0.0')
      })
    })

    describe('edge cases', () => {
      it('should handle zero versions', () => {
        expect(getNextVersion('0.0.0' as Version, 'patch')).toBe('0.0.1')
        expect(getNextVersion('0.0.0' as Version, 'minor')).toBe('0.1.0')
        expect(getNextVersion('0.0.0' as Version, 'major')).toBe('1.0.0')
      })

      it('should handle large version numbers', () => {
        expect(getNextVersion('999.999.999' as Version, 'patch')).toBe('999.999.1000')
        expect(getNextVersion('999.999.999' as Version, 'minor')).toBe('999.1000.0')
        expect(getNextVersion('999.999.999' as Version, 'major')).toBe('1000.0.0')
      })

      it('should handle complex prerelease versions', () => {
        expect(getNextVersion('1.0.0-alpha.1.2.3' as Version, 'patch')).toBe('1.0.1')
        expect(getNextVersion('2.0.0-rc.1+build.123' as Version, 'minor')).toBe('2.1.0')
      })
    })
  })

  describe('version sorting', () => {
    it('should enable proper version sorting', () => {
      const versions: Version[] = [
        '2.0.0',
        '1.0.0-alpha',
        '1.0.0',
        '0.1.0',
        '1.1.0',
        '1.0.0-beta',
        '0.0.1'
      ] as Version[]

      const sorted = [...versions].sort(compareVersions)

      expect(sorted).toEqual([
        '0.0.1',
        '0.1.0',
        '1.0.0-alpha',
        '1.0.0-beta',
        '1.0.0',
        '1.1.0',
        '2.0.0'
      ])
    })
  })
})