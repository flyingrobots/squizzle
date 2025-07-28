#!/usr/bin/env node
// Simple test to verify database connection

import { createPostgresDriver } from '@squizzle/postgres'

async function test() {
  console.log('🧪 Testing database connection...')
  
  const driver = createPostgresDriver({
    host: 'localhost',
    port: 54336,
    database: 'squizzle_test',
    user: 'postgres',
    password: 'testpass'
  })
  
  try {
    await driver.connect()
    console.log('✅ Connected to database')
    
    // Test query
    const result = await driver.query('SELECT NOW() as time')
    console.log('✅ Query successful:', result[0].time)
    
    // Check if squizzle_versions table exists
    const tables = await driver.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'squizzle_versions'
    `)
    
    if (tables.length > 0) {
      console.log('✅ squizzle_versions table exists')
    } else {
      console.log('❌ squizzle_versions table not found')
      console.log('   Run: docker compose -f test/infra/docker-compose-simple.yml exec -T db psql -U postgres -d squizzle_test < sql/squizzle_system_tables.sql')
    }
    
    await driver.disconnect()
    console.log('✅ Disconnected from database')
    
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

test()