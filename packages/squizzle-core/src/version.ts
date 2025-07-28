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
    const [main, prerelease] = v.split('-')
    const [major, minor, patch] = main.split('.').map(Number)
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
    // Split prerelease into parts and compare
    const partsA = va.prerelease.split('.')
    const partsB = vb.prerelease.split('.')
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || ''
      const partB = partsB[i] || ''
      
      // If both parts are numeric, compare as numbers
      const numA = Number(partA)
      const numB = Number(partB)
      
      if (!isNaN(numA) && !isNaN(numB)) {
        if (numA !== numB) return numA - numB
      } else {
        // Otherwise compare as strings
        const cmp = partA.localeCompare(partB)
        if (cmp !== 0) return cmp
      }
    }
  }

  return 0
}

export function getNextVersion(current: Version, bump: 'major' | 'minor' | 'patch' = 'patch'): Version {
  const [main] = current.split('-')
  const [major, minor, patch] = main.split('.').map(Number)

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}