import { readFile, writeFile, access } from 'fs/promises'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import inquirer from 'inquirer'
import chalk from 'chalk'

const ConfigSchema = z.object({
  version: z.literal('2.0'),
  storage: z.object({
    type: z.enum(['oci', 'filesystem', 's3']),
    registry: z.string().optional(),
    bucket: z.string().optional(),
    path: z.string().optional()
  }),
  environments: z.record(z.object({
    database: z.object({
      connectionString: z.string().optional(),
      host: z.string().optional(),
      port: z.number().optional(),
      database: z.string().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      ssl: z.boolean().optional()
    })
  })),
  security: z.object({
    enabled: z.boolean(),
    sigstore: z.object({
      fulcioURL: z.string().optional(),
      rekorURL: z.string().optional()
    }).optional()
  }).optional(),
  drizzle: z.object({
    schema: z.string().default('./lib/db/schema'),
    out: z.string().default('./db/drizzle')
  }).optional()
})

export type Config = z.infer<typeof ConfigSchema>

export async function loadConfig(path: string): Promise<Config> {
  try {
    const content = await readFile(path, 'utf-8')
    const data = parse(content)
    return ConfigSchema.parse(data)
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      throw new Error(`Config file not found: ${path}. Run 'squizzle init' to create one.`)
    }
    throw error
  }
}

export async function saveConfig(path: string, config: Config): Promise<void> {
  const content = stringify(config, { indent: 2 })
  await writeFile(path, content)
}

export async function createConfig(): Promise<void> {
  console.log(chalk.bold('\n🔧 SQUIZZLE Configuration Setup\n'))
  
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'storageType',
      message: 'Where do you want to store migration artifacts?',
      choices: [
        { name: 'OCI Registry (GitHub, Docker Hub)', value: 'oci' },
        { name: 'Local Filesystem', value: 'filesystem' },
        { name: 'AWS S3', value: 's3' }
      ]
    },
    {
      type: 'input',
      name: 'registry',
      message: 'OCI Registry URL:',
      default: 'ghcr.io/your-org/your-repo',
      when: (ans) => ans.storageType === 'oci'
    },
    {
      type: 'input',
      name: 'bucket',
      message: 'S3 Bucket name:',
      when: (ans) => ans.storageType === 's3'
    },
    {
      type: 'confirm',
      name: 'enableSecurity',
      message: 'Enable artifact signing with Sigstore?',
      default: true
    },
    {
      type: 'input',
      name: 'dbHost',
      message: 'Development database host:',
      default: 'localhost'
    },
    {
      type: 'number',
      name: 'dbPort',
      message: 'Development database port:',
      default: 5432
    },
    {
      type: 'input',
      name: 'dbName',
      message: 'Development database name:',
      default: 'postgres'
    },
    {
      type: 'input',
      name: 'dbUser',
      message: 'Development database user:',
      default: 'postgres'
    },
    {
      type: 'password',
      name: 'dbPassword',
      message: 'Development database password:',
      default: 'postgres'
    }
  ])
  
  const config: Config = {
    version: '2.0',
    storage: {
      type: answers.storageType,
      ...(answers.storageType === 'oci' && { registry: answers.registry }),
      ...(answers.storageType === 's3' && { bucket: answers.bucket }),
      ...(answers.storageType === 'filesystem' && { path: './db/artifacts' })
    },
    environments: {
      development: {
        database: {
          host: answers.dbHost,
          port: answers.dbPort,
          database: answers.dbName,
          user: answers.dbUser,
          password: answers.dbPassword
        }
      },
      test: {
        database: {
          host: 'localhost',
          port: 54325,
          database: 'postgres',
          user: 'postgres',
          password: 'postgres'
        }
      },
      production: {
        database: {
          connectionString: '${PRODUCTION_DATABASE_URL}'
        }
      }
    },
    security: {
      enabled: answers.enableSecurity,
      ...(answers.enableSecurity && {
        sigstore: {
          fulcioURL: 'https://fulcio.sigstore.dev',
          rekorURL: 'https://rekor.sigstore.dev'
        }
      })
    },
    drizzle: {
      schema: './lib/db/schema',
      out: './db/drizzle'
    }
  }
  
  await saveConfig('.squizzle.yaml', config)
  console.log(chalk.green('\n✓ Configuration saved to .squizzle.yaml'))
}

export async function configExists(path: string = '.squizzle.yaml'): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}