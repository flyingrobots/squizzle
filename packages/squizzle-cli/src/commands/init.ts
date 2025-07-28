import { mkdir } from 'fs/promises'
import { join } from 'path'
import chalk from 'chalk'
import { configExists, createConfig } from '../config'
import { showSuccess } from '../ui/banner'

export async function initCommand(): Promise<void> {
  console.log(chalk.bold('\n🚀 Initializing SQUIZZLE\n'))
  
  // Check if already initialized
  if (await configExists()) {
    console.log(chalk.yellow('SQUIZZLE is already initialized in this project.'))
    return
  }
  
  // Create directory structure
  console.log('Creating directory structure...')
  const dirs = [
    'db/drizzle',
    'db/squizzle',
    'db/tarballs',
    '.squizzle/cache'
  ]
  
  for (const dir of dirs) {
    await mkdir(join(process.cwd(), dir), { recursive: true })
    console.log(chalk.dim(`  ✓ Created ${dir}`))
  }
  
  // Create configuration
  await createConfig()
  
  // Create example migration
  const exampleMigration = `-- Example: Create version tracking table
-- This is automatically created by SQUIZZLE, shown here for reference

CREATE TABLE IF NOT EXISTS squizzle_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL UNIQUE,
  checksum VARCHAR(128) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR(255) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  rollback_of VARCHAR(50),
  manifest JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_squizzle_versions_applied_at 
  ON squizzle_versions(applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_squizzle_versions_success 
  ON squizzle_versions(success);
`
  
  await mkdir(join(process.cwd(), 'db/squizzle/examples'), { recursive: true })
  await require('fs/promises').writeFile(
    join(process.cwd(), 'db/squizzle/examples/000-version-tracking.sql'),
    exampleMigration
  )
  
  showSuccess('SQUIZZLE initialized successfully!', {
    'Config': '.squizzle.yaml',
    'Migrations': 'db/drizzle/',
    'Custom SQL': 'db/squizzle/',
    'Artifacts': 'db/tarballs/'
  })
  
  console.log(chalk.dim('\nNext steps:'))
  console.log(chalk.dim('  1. Review and adjust .squizzle.yaml'))
  console.log(chalk.dim('  2. Run `squizzle build <version>` to create your first version'))
  console.log(chalk.dim('  3. Run `squizzle apply <version>` to apply it'))
}