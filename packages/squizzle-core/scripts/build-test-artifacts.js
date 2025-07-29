#!/usr/bin/env node
const { create } = require('tar')
const { mkdtemp, writeFile, mkdir, rm } = require('fs/promises')
const { join } = require('path')
const { tmpdir } = require('os')
const { createHash } = require('crypto')

async function buildTestArtifact(version, files) {
  const tempDir = await mkdtemp(join(tmpdir(), 'test-artifact-'))
  
  try {
    // Calculate checksums and prepare file metadata
    const fileMetadata = []
    
    for (const file of files) {
      const dir = join(tempDir, file.path.split('/')[0])
      await mkdir(dir, { recursive: true })
      
      const filePath = join(tempDir, file.path)
      await writeFile(filePath, file.content)
      
      const checksum = createHash('sha256').update(file.content).digest('hex')
      
      fileMetadata.push({
        path: file.path,
        checksum: checksum,
        size: Buffer.byteLength(file.content),
        type: file.type
      })
    }
    
    // Calculate manifest checksum from file metadata
    const manifestData = fileMetadata.map(f => `${f.path}:${f.checksum}`).join('\n')
    const manifestChecksum = createHash('sha256').update(manifestData).digest('hex')
    
    // Create manifest
    const manifest = {
      version: version,
      previousVersion: null,
      created: new Date().toISOString(),
      checksum: manifestChecksum,
      checksumAlgorithm: 'sha256',
      drizzleKit: '0.20.0',
      engineVersion: '1.0.0',
      notes: `Test migration ${version}`,
      author: 'test-suite',
      files: fileMetadata,
      dependencies: [],
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version
      }
    }
    
    // Write manifest
    await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    
    // Create tarball
    const outputPath = join(__dirname, `../test/artifacts/test-v${version}.tar.gz`)
    await create({
      gzip: true,
      file: outputPath,
      cwd: tempDir
    }, ['.'])
    
    console.log(`✓ Created test artifact: test-v${version}.tar.gz`)
    
  } finally {
    await rm(tempDir, { recursive: true })
  }
}

// Build common test artifacts
async function main() {
  // Simple migration
  await buildTestArtifact('1.0.0', [
    { 
      path: 'drizzle/001_create_table.sql', 
      content: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);',
      type: 'drizzle'
    }
  ])
  
  // Migration with error
  await buildTestArtifact('1.0.1', [
    { 
      path: 'drizzle/001_bad.sql', 
      content: 'CREATE TABLE INVALID SQL HERE;',
      type: 'drizzle'
    }
  ])
  
  // Multiple migrations with order
  await buildTestArtifact('1.0.2', [
    { 
      path: 'drizzle/001_create.sql', 
      content: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);',
      type: 'drizzle'
    },
    { 
      path: 'squizzle/002_custom.sql', 
      content: 'INSERT INTO test_table (name) VALUES (\'custom\');',
      type: 'custom'
    },
    { 
      path: 'squizzle/003_seed.sql', 
      content: 'INSERT INTO test_table (name) VALUES (\'seed\');',
      type: 'seed'
    }
  ])
  
  // Simple test migration
  await buildTestArtifact('1.0.3', [
    { 
      path: 'drizzle/001_test.sql', 
      content: 'SELECT 1;',
      type: 'drizzle'
    }
  ])
}

main().catch(console.error)