#!/usr/bin/env node
const { create } = require('tar')
const { mkdtemp, writeFile, mkdir, readFile, rm } = require('fs/promises')
const { join } = require('path')
const { tmpdir } = require('os')
const { createHash } = require('crypto')

async function buildSystemArtifact() {
  const tempDir = await mkdtemp(join(tmpdir(), 'squizzle-system-'))
  
  try {
    // Read system SQL
    const systemSQL = await readFile(
      join(__dirname, '../sql/system/v1.0.0.sql'), 
      'utf-8'
    )
    
    // Calculate checksum
    const checksum = createHash('sha256').update(systemSQL).digest('hex')
    
    // Create manifest
    const manifest = {
      version: 'system-v1.0.0',
      previousVersion: null,
      created: new Date().toISOString(),
      checksum: checksum,
      checksumAlgorithm: 'sha256',
      drizzleKit: 'n/a',
      engineVersion: '1.0.0',
      notes: 'Squizzle system tables initialization',
      author: 'squizzle-init',
      files: [{
        path: 'system/v1.0.0.sql',
        checksum: checksum,
        size: Buffer.byteLength(systemSQL),
        type: 'custom'
      }],
      dependencies: [],
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version
      }
    }
    
    // Create directory structure
    await mkdir(join(tempDir, 'system'), { recursive: true })
    
    // Write files
    await writeFile(join(tempDir, 'system/v1.0.0.sql'), systemSQL)
    await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    
    // Create tarball
    const outputPath = join(__dirname, '../test/artifacts/system-v1.0.0.tar.gz')
    await create({
      gzip: true,
      file: outputPath,
      cwd: tempDir
    }, ['.'])
    
    console.log(`✓ Created system artifact at: ${outputPath}`)
    console.log(`  Checksum: ${checksum}`)
    console.log(`  Size: ${Buffer.byteLength(systemSQL)} bytes`)
    
  } finally {
    await rm(tempDir, { recursive: true })
  }
}

buildSystemArtifact().catch(console.error)