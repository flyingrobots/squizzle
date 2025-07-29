import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { execSync } from 'child_process'
import { create } from 'tar'
import ora, { Ora } from 'ora'
import chalk from 'chalk'
import { createManifest, Version, StorageError, Manifest } from '@squizzle/core'
import { createOCIStorage } from '@squizzle/oci'
import { showSuccess, showError } from '../ui/banner'
import { Config } from '../config'
import prettyBytes from 'pretty-bytes'

interface BuildOptions {
  notes?: string
  author?: string
  tag?: string[]
  dryRun?: boolean
  config: Config
  registry?: string
  repository?: string
  skipPush?: boolean
}

export async function buildCommand(version: Version, options: BuildOptions): Promise<void> {
  const spinner = ora('Building database version...').start()
  
  try {
    // Step 1: Generate Drizzle migrations
    spinner.text = 'Generating Drizzle migrations...'
    if (!options.dryRun) {
      execSync('npx drizzle-kit generate', { stdio: 'pipe' })
    }
    
    // Step 2: Collect migration files
    spinner.text = 'Collecting migration files...'
    const files = await collectMigrationFiles()
    
    // Step 3: Get Drizzle Kit version
    const drizzleKit = getDrizzleKitVersion()
    
    // Step 4: Create manifest
    spinner.text = 'Creating manifest...'
    const manifest = createManifest({
      version,
      previousVersion: await getLastVersion(options.config),
      notes: options.notes || '',
      author: options.author || process.env.USER || 'unknown',
      drizzleKit,
      files
    })
    
    // Step 5: Create artifact
    if (!options.dryRun) {
      spinner.text = 'Creating artifact...'
      const artifactPath = await createArtifact(version, files, manifest)
      
      // Step 6: Sign artifact if security is enabled
      if (options.config.security?.enabled) {
        spinner.text = 'Signing artifact...'
        // TODO: Implement signing
      }
      
      // Step 7: Push to storage
      if (!options.skipPush) {
        spinner.text = 'Pushing to storage...'
        const artifactBuffer = await readFile(artifactPath)
        const pushUrl = await pushToStorage(version, artifactBuffer, manifest, options, spinner)
        
        // Step 8: Verify push
        await verifyPush(version, artifactBuffer.length, options, spinner)
        
        spinner.succeed('Build complete!')
        
        showSuccess(`Version ${version} built successfully`, {
          'Files': files.length,
          'Checksum': manifest.checksum.substring(0, 16) + '...',
          'Size': prettyBytes(artifactBuffer.length),
          'Location': pushUrl
        })
      } else {
        spinner.succeed('Build complete!')
        
        showSuccess(`Version ${version} built successfully`, {
          'Files': files.length,
          'Checksum': manifest.checksum.substring(0, 16) + '...',
          'Size': prettyBytes((await readFile(artifactPath)).length),
          'Location': artifactPath
        })
      }
    } else {
      spinner.succeed('Dry run complete!')
      console.log('\nWould create version with:')
      console.log(`  Files: ${files.length}`)
      console.log(`  Checksum: ${manifest.checksum.substring(0, 16)}...`)
    }
    
  } catch (error) {
    spinner.fail('Build failed')
    showError('Build failed', error as Error)
    process.exit(1)
  }
}

async function collectMigrationFiles(): Promise<Array<{
  path: string
  content: Buffer
  type: 'drizzle' | 'custom' | 'seed' | 'rollback'
}>> {
  const files: Array<{
    path: string
    content: Buffer
    type: 'drizzle' | 'custom' | 'seed' | 'rollback'
  }> = []
  
  // Collect Drizzle migrations
  const drizzleDir = join(process.cwd(), 'db/drizzle')
  try {
    const drizzleFiles = await readdir(drizzleDir)
    for (const file of drizzleFiles) {
      if (file.endsWith('.sql')) {
        files.push({
          path: `drizzle/${file}`,
          content: await readFile(join(drizzleDir, file)),
          type: 'drizzle'
        })
      }
    }
  } catch (error) {
    // Drizzle directory might not exist
  }
  
  // Collect custom migrations
  const customDir = join(process.cwd(), 'db/squizzle')
  try {
    const customFiles = await readdir(customDir)
    for (const file of customFiles) {
      if (file.endsWith('.sql')) {
        const content = await readFile(join(customDir, file))
        const type = file.includes('rollback') ? 'rollback' : 
                    file.includes('seed') ? 'seed' : 'custom'
        files.push({
          path: `squizzle/${file}`,
          content,
          type
        })
      }
    }
  } catch (error) {
    // Custom directory might not exist
  }
  
  return files
}

function getDrizzleKitVersion(): string {
  try {
    const packageJson = require(join(process.cwd(), 'package.json'))
    return packageJson.devDependencies?.['drizzle-kit'] || 
           packageJson.dependencies?.['drizzle-kit'] || 
           'unknown'
  } catch {
    return 'unknown'
  }
}

async function getLastVersion(config: Config): Promise<Version | null> {
  try {
    // Create storage instance with environment overrides
    const storageConfig = {
      ...config.storage,
      registry: process.env.SQUIZZLE_REGISTRY || config.storage.registry,
      repository: process.env.SQUIZZLE_REPOSITORY || (config.storage as any).repository
    }
    
    const storage = createOCIStorage(storageConfig as any)
    const versions = await storage.list()
    
    return versions.length > 0 ? versions[versions.length - 1] : null
  } catch (error) {
    // If we can't list versions, assume this is the first
    return null
  }
}

async function createArtifact(
  version: Version, 
  files: Array<{ path: string; content: Buffer; type: string }>,
  manifest: any
): Promise<string> {
  const tempDir = join(process.cwd(), '.squizzle', 'build', version)
  await mkdir(tempDir, { recursive: true })
  
  // Write files
  for (const file of files) {
    const filePath = join(tempDir, file.path)
    await mkdir(join(tempDir, file.path.split('/')[0]), { recursive: true })
    await writeFile(filePath, file.content)
  }
  
  // Write manifest
  await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  
  // Create tarball
  const tarballPath = join(process.cwd(), 'db/tarballs', `squizzle-v${version}.tar.gz`)
  await mkdir(join(process.cwd(), 'db/tarballs'), { recursive: true })
  
  await create({
    gzip: true,
    file: tarballPath,
    cwd: tempDir
  }, ['.'])
  
  return tarballPath
}

export async function pushToStorage(
  version: Version,
  artifactBuffer: Buffer,
  manifest: Manifest,
  options: BuildOptions,
  spinner: Ora
): Promise<string> {
  try {
    // Create storage instance with CLI overrides
    const storageConfig = {
      ...options.config.storage,
      registry: options.registry || process.env.SQUIZZLE_REGISTRY || options.config.storage.registry,
      repository: options.repository || process.env.SQUIZZLE_REPOSITORY || (options.config.storage as any).repository
    }
    
    const storage = createOCIStorage(storageConfig as any)
    
    // Push with progress reporting if large
    const startTime = Date.now()
    let lastProgressUpdate = startTime
    
    const url = await storage.push(version, artifactBuffer, manifest)
    
    const duration = Date.now() - startTime
    const durationSec = Math.max(0.001, duration / 1000) // Avoid division by zero
    const speed = artifactBuffer.length / durationSec
    spinner.text = `Pushed ${prettyBytes(artifactBuffer.length)} in ${durationSec.toFixed(1)}s (${prettyBytes(speed)}/s)`
    
    return url
  } catch (error) {
    if (error instanceof StorageError) {
      spinner.fail('Failed to push to storage')
      
      // Provide helpful error messages based on error type
      if (error.message.includes('401') || error.message.includes('403') || error.message.includes('authentication')) {
        console.error(chalk.red('\nAuthentication failed'))
        console.error(chalk.yellow('Try running: docker login <registry>'))
        console.error(chalk.yellow(`Registry: ${options.registry || options.config.storage.registry}`))
      } else if (error.message.includes('network') || error.message.includes('timeout')) {
        console.error(chalk.red('\nNetwork error'))
        console.error(chalk.yellow('Check your internet connection and registry URL'))
        console.error(chalk.yellow(`Registry: ${options.registry || options.config.storage.registry}`))
      } else if (error.message.includes('404')) {
        console.error(chalk.red('\nRepository not found'))
        console.error(chalk.yellow('Make sure the repository exists in your registry'))
        console.error(chalk.yellow(`Repository: ${options.repository || (options.config.storage as any).repository}`))
      } else {
        console.error(chalk.red('\nStorage error:'), error.message)
      }
      
      throw error
    }
    throw error
  }
}

export async function verifyPush(
  version: Version,
  expectedSize: number,
  options: BuildOptions,
  spinner: Ora
): Promise<void> {
  try {
    const storageConfig = {
      ...options.config.storage,
      registry: options.registry || process.env.SQUIZZLE_REGISTRY || options.config.storage.registry,
      repository: options.repository || process.env.SQUIZZLE_REPOSITORY || (options.config.storage as any).repository
    }
    
    const storage = createOCIStorage(storageConfig as any)
    
    // Verify it exists
    const exists = await storage.exists(version)
    if (!exists) {
      throw new Error('Push reported success but artifact not found in storage')
    }
    
    // Optionally verify manifest
    try {
      const manifest = await storage.getManifest(version)
      // Basic sanity check
      if (manifest.version !== version) {
        console.warn(chalk.yellow(`Warning: Stored version (${manifest.version}) differs from expected (${version})`))
      }
    } catch (error) {
      // getManifest might not be available in all storage implementations
    }
  } catch (error) {
    console.warn(chalk.yellow('\nWarning: Could not verify push:'), (error as Error).message)
    // Don't fail the build, just warn
  }
}