import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { execSync } from 'child_process'
import { create } from 'tar'
import ora from 'ora'
import chalk from 'chalk'
import { createManifest, Version } from '@squizzle/core'
import { showSuccess, showError } from '../ui/banner'
import { Config } from '../config'

interface BuildOptions {
  notes?: string
  author?: string
  tag?: string[]
  dryRun?: boolean
  config: Config
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
      spinner.text = 'Pushing to storage...'
      // TODO: Push to OCI registry
      
      spinner.succeed('Build complete!')
      
      showSuccess(`Version ${version} built successfully`, {
        'Files': files.length,
        'Checksum': manifest.checksum.substring(0, 16) + '...',
        'Size': 'TODO',
        'Location': artifactPath
      })
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
  // TODO: Get from storage
  return null
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