import { Version, VersionSchema } from './types'

export function isValidVersion(version: string): version is Version {
  try {
    VersionSchema.parse(version)
    return true
  } catch {
    return false
  }
}

export function compareVersions(a: Version, b: Version): number {
  const parseVersion = (v: string) => {
    const [main = '', prerelease] = v.split('-')
    const parts = main.split('.')
    const major = Number(parts[0] || 0)
    const minor = Number(parts[1] || 0)
    const patch = Number(parts[2] || 0)
    return { major, minor, patch, prerelease }
  }

  const va = parseVersion(a)
  const vb = parseVersion(b)

  // Compare major.minor.patch
  if (va.major !== vb.major) return va.major - vb.major
  if (va.minor !== vb.minor) return va.minor - vb.minor
  if (va.patch !== vb.patch) return va.patch - vb.patch

  // Compare prerelease
  if (!va.prerelease && vb.prerelease) return 1
  if (va.prerelease && !vb.prerelease) return -1
  if (va.prerelease && vb.prerelease) {
    return va.prerelease.localeCompare(vb.prerelease)
  }

  return 0
}

export function getNextVersion(current: Version, bump: 'major' | 'minor' | 'patch' = 'patch'): Version {
  const [main = ''] = current.split('-')
  const parts = main.split('.')
  const major = Number(parts[0] || 0)
  const minor = Number(parts[1] || 0)
  const patch = Number(parts[2] || 0)

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}