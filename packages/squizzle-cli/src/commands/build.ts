import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join } from 'path'
import { execSync } from 'child_process'
import { create } from 'tar'
import { createGzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { createReadStream, createWriteStream } from 'fs'
import { createHash } from 'crypto'
import ora from 'ora'
import chalk from 'chalk'
import prettyBytes from 'pretty-bytes'
import { createManifest, Version } from '@squizzle/core'
import { showSuccess, showError } from '../ui/banner'
import { Config } from '../config'

interface BuildOptions {
  notes?: string
  author?: string
  tag?: string[]
  dryRun?: boolean
  verbose?: boolean
  config: Config
}

interface BuildFile {
  path: string
  content: Buffer
  type: 'migration' | 'rollback' | 'seed' | 'drizzle' | 'custom'
  size: number
  checksum: string
}

interface BuildStats {
  totalSize: number
  compressedSize: number
  fileCount: number
  breakdown: {
    migrations: number
    rollbacks: number
    seeds: number
  }
}

export async function buildCommand(version: Version, options: BuildOptions): Promise<void> {
  if (options.dryRun) {
    console.log(chalk.blue('\n🔍 DRY RUN MODE - No artifact will be created\n'))
  }

  const spinner = ora('Scanning for migrations...').start()
  
  try {
    // Step 1: Generate Drizzle migrations
    if (!options.dryRun) {
      spinner.text = 'Generating Drizzle migrations...'
      execSync('npx drizzle-kit generate', { stdio: 'pipe' })
    }
    
    // Step 2: Collect migration files with progress
    const files: BuildFile[] = []
    const scanProgress = {
      drizzle: 0,
      custom: 0,
      seeds: 0
    }

    spinner.text = 'Scanning Drizzle migrations...'
    const rawFiles = await collectMigrationFiles()
    
    // Enhanced file collection with size and checksum
    for (const file of rawFiles) {
      const checksum = createHash('sha256').update(file.content).digest('hex')
      files.push({
        ...file,
        size: file.content.length,
        checksum
      })
    }

    // Update scan progress
    scanProgress.drizzle = files.filter(f => f.type === 'drizzle').length
    scanProgress.custom = files.filter(f => f.type === 'custom').length
    scanProgress.seeds = files.filter(f => f.type === 'seed').length
    
    spinner.succeed(`Found ${files.length} files to include`)
    
    // Step 3: Get Drizzle Kit version
    const drizzleKit = getDrizzleKitVersion()
    
    // Step 4: Create manifest
    const manifest = createManifest({
      version,
      previousVersion: await getLastVersion(options.config),
      notes: options.notes || '',
      author: options.author || process.env.USER || 'unknown',
      drizzleKit,
      files: files.map(f => ({
        path: f.path,
        content: f.content,
        type: f.type as 'drizzle' | 'custom' | 'seed' | 'rollback'
      }))
    })

    // Calculate stats
    const stats: BuildStats = {
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      compressedSize: 0, // Will be calculated after compression
      fileCount: files.length,
      breakdown: {
        migrations: files.filter(f => f.type === 'migration' || f.type === 'drizzle').length,
        rollbacks: files.filter(f => f.type === 'rollback').length,
        seeds: files.filter(f => f.type === 'seed').length
      }
    }

    if (options.dryRun) {
      // Dry run mode - show detailed preview
      console.log(chalk.bold('📁 Files to include:\n'))
      
      const fileTable = files.map(file => ({
        'Path': file.path,
        'Type': file.type,
        'Size': prettyBytes(file.size),
        'Checksum': file.checksum.slice(0, 8) + '...'
      }))
      
      console.table(fileTable)
      
      // Show build preview
      console.log(chalk.bold('\n📊 Build Preview:\n'))
      console.table({
        'Version': version,
        'Total Files': files.length,
        'Total Size': prettyBytes(stats.totalSize),
        'Would Create': `database-v${version}.tar.gz`
      })
      
      // Show manifest preview if verbose
      if (options.verbose) {
        console.log(chalk.bold('\n📄 Manifest Preview:\n'))
        console.log(JSON.stringify(manifest, null, 2))
      }
      
      // Check for potential issues
      const issues = validateBuild(files, manifest)
      if (issues.length > 0) {
        console.log(chalk.yellow('\n⚠️  Potential Issues:\n'))
        issues.forEach(issue => {
          console.log(chalk.yellow(`  • ${issue}`))
        })
      }
      
      console.log(chalk.green('\n✅ Dry run complete. No files were created.\n'))
      return
    }

    // Step 5: Create artifact
    spinner.start('Creating artifact...')
    const artifactPath = await createArtifact(version, files, manifest)
    
    // Get compressed size
    const artifactStats = await stat(artifactPath)
    stats.compressedSize = artifactStats.size
    
    // Step 6: Sign artifact if security is enabled
    if (options.config.security?.enabled) {
      spinner.text = 'Signing artifact...'
      // TODO: Implement signing
    }
    
    // Step 7: Push to storage
    spinner.text = 'Pushing to storage...'
    // TODO: Push to OCI registry
    
    spinner.succeed('Build complete!')
    
    // Display summary with real size
    console.log(chalk.bold('\n📦 Build Summary:\n'))
    
    console.table({
      'Version': version,
      'Total Files': stats.fileCount,
      'Migrations': stats.breakdown.migrations,
      'Size': prettyBytes(stats.compressedSize),
      'Checksum': manifest.checksum.slice(0, 12) + '...'
    })

    // Warn about large artifacts
    if (stats.compressedSize > 10 * 1024 * 1024) { // 10MB
      console.warn(chalk.yellow(`\n⚠️  Large artifact (${prettyBytes(stats.compressedSize)}). Consider splitting into multiple versions.`))
    }

    console.log(chalk.dim(`\n📍 Location: ${artifactPath}\n`))
    
  } catch (error) {
    spinner.fail('Build failed')
    showError('Build failed', error as Error)
    process.exit(1)
  }
}

function validateBuild(files: BuildFile[], manifest: any): string[] {
  const issues: string[] = []
  
  // Check for suspicious patterns
  files.forEach(file => {
    const content = file.content.toString()
    if (content.includes('DROP TABLE') || content.includes('DROP DATABASE')) {
      issues.push('Destructive operations detected (DROP TABLE/DATABASE)')
    }
  })
  
  // Check for missing rollbacks
  const migrations = files.filter(f => f.type === 'migration' || f.type === 'drizzle')
  const rollbacks = files.filter(f => f.type === 'rollback')
  if (migrations.length > 0 && rollbacks.length === 0) {
    issues.push('No rollback files found')
  }
  
  // Check for large files
  const largeFiles = files.filter(f => f.size > 1024 * 1024) // 1MB
  if (largeFiles.length > 0) {
    issues.push(`${largeFiles.length} large file(s) detected (>1MB)`)
  }
  
  // Check for common mistakes
  if (files.some(f => f.path.endsWith('.sql.bak'))) {
    issues.push('Backup files detected (.bak) - these should not be included')
  }
  
  return issues
}

async function collectMigrationFiles(): Promise<Array<{
  path: string
  content: Buffer
  type: 'migration' | 'rollback' | 'seed' | 'drizzle' | 'custom'
}>> {
  const files: Array<{
    path: string
    content: Buffer
    type: 'migration' | 'rollback' | 'seed' | 'drizzle' | 'custom'
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

async function getLastVersion(_config: Config): Promise<Version | null> {
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
    await mkdir(join(tempDir, file.path.split('/')[0] || ''), { recursive: true })
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