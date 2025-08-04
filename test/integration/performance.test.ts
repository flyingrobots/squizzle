import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { IntegrationTestEnv, setupIntegrationTest, getConnectionString } from './setup'
import { runCliCommand, createTestMigration, createTestProject } from './helpers'
import { createPostgresDriver } from '@squizzle/postgres'

describe('Schema Integration Tests', () => {
  let testEnv: IntegrationTestEnv
  
  beforeAll(async () => {
    testEnv = await setupIntegrationTest()
  }, 30000)
  
  afterAll(async () => {
    await testEnv.cleanup()
  })

  it('should create and maintain foreign key relationships across multiple tables', async () => {
    // Test: Complex multi-table schema with foreign keys works correctly
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create a realistic e-commerce schema with foreign key relationships
    const migration = `
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT
      );
      
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL CHECK (price > 0),
        stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE customers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        order_date TIMESTAMPTZ DEFAULT NOW(),
        total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
        status VARCHAR(50) NOT NULL DEFAULT 'pending'
      );
      
      CREATE TABLE order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price > 0)
      );
    `
    
    await createTestMigration(testEnv.tempDir, '0001_ecommerce_schema.sql', migration)
    
    const buildResult = await runCliCommand(['build', '1.0.0', '--notes', 'E-commerce schema'], { 
      cwd: testEnv.tempDir 
    })
    expect(buildResult.exitCode).toBe(0)
    
    const applyResult = await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(applyResult.exitCode).toBe(0)
    
    // Verify schema exists and foreign key relationships work
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Test that we can insert data and foreign keys are enforced
      await driver.execute(`
        INSERT INTO categories (name, description) VALUES 
        ('Electronics', 'Electronic devices and accessories'),
        ('Books', 'Physical and digital books');
      `)
      
      await driver.execute(`
        INSERT INTO products (category_id, name, price, stock_quantity) VALUES 
        (1, 'Smartphone', 599.99, 50),
        (1, 'Laptop', 1299.99, 25),
        (2, 'Programming Book', 49.99, 100);
      `)
      
      await driver.execute(`
        INSERT INTO customers (email, name) VALUES 
        ('john@example.com', 'John Doe'),
        ('jane@example.com', 'Jane Smith');
      `)
      
      await driver.execute(`
        INSERT INTO orders (customer_id, total_amount, status) VALUES 
        (1, 649.98, 'completed'),
        (2, 49.99, 'pending');
      `)
      
      await driver.execute(`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES 
        (1, 1, 1, 599.99),
        (1, 2, 1, 49.99),
        (2, 3, 1, 49.99);
      `)
      
      // Verify the data was inserted correctly with joins
      const orderDetails = await driver.query(`
        SELECT 
          o.id as order_id,
          c.name as customer_name,
          c.email,
          o.total_amount,
          o.status,
          COUNT(oi.id) as item_count
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        JOIN order_items oi ON o.id = oi.order_id
        GROUP BY o.id, c.name, c.email, o.total_amount, o.status
        ORDER BY o.id
      `)
      
      expect(orderDetails).toHaveLength(2)
      expect(orderDetails[0]).toMatchObject({
        customer_name: 'John Doe',
        email: 'john@example.com',
        item_count: '2' // PostgreSQL returns bigint as string
      })
      
      // Test foreign key constraint enforcement - this should fail
      let constraintViolated = false
      try {
        await driver.execute(`INSERT INTO products (category_id, name, price) VALUES (999, 'Invalid Product', 10.00)`)
      } catch (error) {
        constraintViolated = true
      }
      expect(constraintViolated).toBe(true)
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)

  it('should handle schema evolution with existing data preservation', async () => {
    // Test: Adding columns to existing tables preserves data and maintains functionality
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Initial schema with some data
    const initialMigration = `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Insert initial test data
      INSERT INTO users (username, email) VALUES 
        ('alice', 'alice@example.com'),
        ('bob', 'bob@example.com');
        
      INSERT INTO posts (user_id, title, content) VALUES 
        (1, 'First Post', 'This is Alice first post'),
        (1, 'Second Post', 'This is Alice second post'),
        (2, 'Bob Post', 'This is Bob first post');
    `
    
    await createTestMigration(testEnv.tempDir, '0001_initial_blog.sql', initialMigration)
    
    await runCliCommand(['build', '1.0.0', '--notes', 'Initial blog schema'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Schema evolution - add new columns and table
    const evolutionMigration = `
      -- Add new columns to existing tables
      ALTER TABLE users ADD COLUMN bio TEXT;
      ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
      
      ALTER TABLE posts ADD COLUMN is_published BOOLEAN DEFAULT false;
      ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0;
      ALTER TABLE posts ADD COLUMN tags TEXT[];
      
      -- Add new table with relationships
      CREATE TABLE comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        is_approved BOOLEAN DEFAULT false
      );
      
      -- Update existing data to use new columns
      UPDATE posts SET is_published = true WHERE created_at < NOW();
      UPDATE users SET is_active = true;
    `
    
    await createTestMigration(testEnv.tempDir, '0002_schema_evolution.sql', evolutionMigration)
    
    await runCliCommand(['build', '2.0.0', '--notes', 'Schema evolution'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '2.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Verify original data is preserved
      const originalPosts = await driver.query(`
        SELECT u.username, p.title, p.content, p.is_published, p.view_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.id
      `)
      
      expect(originalPosts).toHaveLength(3)
      expect(originalPosts[0]).toMatchObject({
        username: 'alice',
        title: 'First Post',
        content: 'This is Alice first post',
        is_published: true, // Should be updated by migration
        view_count: 0 // Should have default value
      })
      
      // Test that new functionality works
      await driver.execute(`
        UPDATE users SET 
          bio = 'Software developer and blogger',
          last_login = NOW()
        WHERE username = 'alice'
      `)
      
      await driver.execute(`
        INSERT INTO comments (post_id, user_id, content, is_approved) VALUES 
        (1, 2, 'Great post Alice!', true),
        (2, 2, 'Looking forward to more content', false)
      `)
      
      // Verify new relationships work
      const postWithComments = await driver.query(`
        SELECT 
          p.title,
          p.is_published,
          u.username as author,
          u.bio,
          COUNT(c.id) as comment_count,
          COUNT(c.id) FILTER (WHERE c.is_approved = true) as approved_comments
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.id = 1
        GROUP BY p.id, p.title, p.is_published, u.username, u.bio
      `)
      
      expect(postWithComments[0]).toMatchObject({
        title: 'First Post',
        is_published: true,
        author: 'alice',
        bio: 'Software developer and blogger',
        comment_count: '2',
        approved_comments: '1'
      })
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)

  it('should create and enforce indexes and constraints correctly', async () => {
    // Test: Indexes improve query performance and constraints prevent invalid data
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    const migration = `
      CREATE TABLE inventory (
        id SERIAL PRIMARY KEY,
        sku VARCHAR(50) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        stock_quantity INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        
        -- Constraints
        CONSTRAINT uk_inventory_sku UNIQUE (sku),
        CONSTRAINT ck_inventory_price CHECK (price > 0),
        CONSTRAINT ck_inventory_stock CHECK (stock_quantity >= 0),
        CONSTRAINT ck_inventory_sku_format CHECK (sku ~ '^[A-Z0-9-]+$')
      );
      
      -- Indexes for performance
      CREATE INDEX idx_inventory_category ON inventory(category);
      CREATE INDEX idx_inventory_price ON inventory(price);
      CREATE INDEX idx_inventory_stock ON inventory(stock_quantity) WHERE stock_quantity > 0;
      CREATE INDEX idx_inventory_name_search ON inventory USING gin(to_tsvector('english', product_name));
      CREATE INDEX idx_inventory_created_at ON inventory(created_at DESC);
      
      -- Composite index for common queries
      CREATE INDEX idx_inventory_category_price ON inventory(category, price);
      
      -- Insert test data
      INSERT INTO inventory (sku, product_name, category, price, stock_quantity) VALUES 
        ('SKU-001', 'Wireless Headphones', 'Electronics', 79.99, 150),
        ('SKU-002', 'Bluetooth Speaker', 'Electronics', 49.99, 200),
        ('SKU-003', 'Python Programming Book', 'Books', 39.99, 50),
        ('SKU-004', 'JavaScript Guide', 'Books', 34.99, 75),
        ('SKU-005', 'Mechanical Keyboard', 'Electronics', 129.99, 30);
    `
    
    await createTestMigration(testEnv.tempDir, '0001_inventory_constraints.sql', migration)
    
    await runCliCommand(['build', '1.0.0', '--notes', 'Inventory with constraints'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Verify indexes were created
      const indexes = await driver.query(`
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename = 'inventory' 
        AND schemaname = 'public'
        ORDER BY indexname
      `)
      
      expect(indexes.length).toBeGreaterThan(5) // Should have multiple indexes
      const indexNames = indexes.map(idx => idx.indexname)
      expect(indexNames).toContain('idx_inventory_category')
      expect(indexNames).toContain('idx_inventory_price')
      expect(indexNames).toContain('idx_inventory_category_price')
      
      // Test unique constraint enforcement
      let uniqueViolated = false
      try {
        await driver.execute(`
          INSERT INTO inventory (sku, product_name, category, price, stock_quantity) 
          VALUES ('SKU-001', 'Duplicate SKU', 'Test', 10.00, 1)
        `)
      } catch (error) {
        uniqueViolated = true
      }
      expect(uniqueViolated).toBe(true)
      
      // Test check constraint enforcement - negative price
      let priceCheckViolated = false
      try {
        await driver.execute(`
          INSERT INTO inventory (sku, product_name, category, price, stock_quantity) 
          VALUES ('SKU-BAD1', 'Negative Price', 'Test', -10.00, 1)
        `)
      } catch (error) {
        priceCheckViolated = true
      }
      expect(priceCheckViolated).toBe(true)
      
      // Test check constraint enforcement - invalid SKU format
      let skuFormatViolated = false
      try {
        await driver.execute(`
          INSERT INTO inventory (sku, product_name, category, price, stock_quantity) 
          VALUES ('invalid sku!', 'Invalid SKU Format', 'Test', 10.00, 1)
        `)
      } catch (error) {
        skuFormatViolated = true
      }
      expect(skuFormatViolated).toBe(true)
      
      // Test that valid data can be inserted
      await driver.execute(`
        INSERT INTO inventory (sku, product_name, category, price, stock_quantity) 
        VALUES ('SKU-VALID', 'Valid Product', 'Test', 25.99, 10)
      `)
      
      // Verify the insert worked
      const validProduct = await driver.query(`
        SELECT * FROM inventory WHERE sku = 'SKU-VALID'
      `)
      expect(validProduct).toHaveLength(1)
      expect(validProduct[0].product_name).toBe('Valid Product')
      
      // Test index usage with queries that should benefit from indexes
      const categoryQuery = await driver.query(`
        SELECT product_name, price 
        FROM inventory 
        WHERE category = 'Electronics' 
        ORDER BY price DESC
      `)
      expect(categoryQuery.length).toBeGreaterThan(0)
      
      // Test full-text search index
      const searchQuery = await driver.query(`
        SELECT product_name, category
        FROM inventory 
        WHERE to_tsvector('english', product_name) @@ plainto_tsquery('english', 'programming')
      `)
      expect(searchQuery).toHaveLength(1)
      expect(searchQuery[0].product_name).toBe('Python Programming Book')
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)

  it('should handle complex realistic schema with proper data integrity', async () => {
    // Test: Complete application schema with realistic relationships and data flows
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    const migration = `
      -- User management
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        is_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- User profiles
      CREATE TABLE user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bio TEXT,
        avatar_url VARCHAR(500),
        location VARCHAR(255),
        website VARCHAR(500),
        birth_date DATE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        
        CONSTRAINT uk_user_profiles_user_id UNIQUE (user_id)
      );
      
      -- Content management
      CREATE TABLE articles (
        id SERIAL PRIMARY KEY,
        author_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(500) NOT NULL,
        slug VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT,
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
        featured BOOLEAN DEFAULT false,
        view_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        
        CONSTRAINT uk_articles_slug UNIQUE (slug)
      );
      
      -- Tagging system
      CREATE TABLE tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        slug VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        color VARCHAR(7), -- hex color
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE article_tags (
        article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        
        PRIMARY KEY (article_id, tag_id)
      );
      
      -- Comments system
      CREATE TABLE comments (
        id SERIAL PRIMARY KEY,
        article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id),
        parent_id INTEGER REFERENCES comments(id),
        content TEXT NOT NULL,
        is_approved BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Indexes for performance
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_users_username ON users(username);
      CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;
      
      CREATE INDEX idx_articles_author ON articles(author_id);
      CREATE INDEX idx_articles_status ON articles(status);
      CREATE INDEX idx_articles_published ON articles(published_at DESC) WHERE status = 'published';
      CREATE INDEX idx_articles_featured ON articles(featured, published_at DESC) WHERE featured = true;
      CREATE INDEX idx_articles_search ON articles USING gin(to_tsvector('english', title || ' ' || content));
      
      CREATE INDEX idx_comments_article ON comments(article_id);
      CREATE INDEX idx_comments_author ON comments(author_id);
      CREATE INDEX idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
      CREATE INDEX idx_comments_approved ON comments(is_approved, created_at DESC) WHERE is_approved = true;
      
      -- Insert realistic test data
      INSERT INTO users (email, username, password_hash, first_name, last_name, is_verified) VALUES 
        ('alice@example.com', 'alice_writer', 'hash1', 'Alice', 'Johnson', true),
        ('bob@example.com', 'bob_blogger', 'hash2', 'Bob', 'Smith', true),
        ('carol@example.com', 'carol_reader', 'hash3', 'Carol', 'Brown', true);
      
      INSERT INTO user_profiles (user_id, bio, location) VALUES 
        (1, 'Technical writer and software developer', 'San Francisco, CA'),
        (2, 'Food blogger and photography enthusiast', 'New York, NY'),
        (3, 'Avid reader and book reviewer', 'Portland, OR');
      
      INSERT INTO tags (name, slug, description, color) VALUES 
        ('Technology', 'technology', 'Posts about technology and programming', '#3B82F6'),
        ('Food', 'food', 'Recipes and food reviews', '#EF4444'),
        ('Books', 'books', 'Book reviews and reading recommendations', '#10B981'),
        ('Tutorial', 'tutorial', 'How-to guides and tutorials', '#F59E0B');
      
      INSERT INTO articles (author_id, title, slug, content, excerpt, status, published_at) VALUES 
        (1, 'Getting Started with PostgreSQL', 'getting-started-postgresql', 
         'PostgreSQL is a powerful open-source relational database...', 
         'Learn the basics of PostgreSQL database', 'published', NOW() - INTERVAL '2 days'),
        (1, 'Advanced SQL Techniques', 'advanced-sql-techniques', 
         'In this article we will explore advanced SQL techniques...', 
         'Master advanced SQL for better database queries', 'published', NOW() - INTERVAL '1 day'),
        (2, 'The Perfect Pasta Recipe', 'perfect-pasta-recipe', 
         'Making perfect pasta is an art form...', 
         'A step-by-step guide to perfect pasta', 'published', NOW() - INTERVAL '3 hours'),
        (1, 'Draft Article', 'draft-article', 
         'This is a draft article...', 
         'Work in progress', 'draft', NULL);
      
      INSERT INTO article_tags (article_id, tag_id) VALUES 
        (1, 1), (1, 4), -- PostgreSQL article: Technology, Tutorial
        (2, 1), (2, 4), -- SQL article: Technology, Tutorial  
        (3, 2);         -- Pasta article: Food
      
      INSERT INTO comments (article_id, author_id, content, is_approved) VALUES 
        (1, 2, 'Great introduction to PostgreSQL! Very helpful.', true),
        (1, 3, 'Thanks for this tutorial, exactly what I needed.', true),
        (2, 3, 'The advanced techniques section was particularly useful.', true),
        (3, 1, 'Tried this recipe and it turned out amazing!', true),
        (3, 3, 'Going to try this tonight. Looks delicious!', false); -- Not approved yet
    `
    
    await createTestMigration(testEnv.tempDir, '0001_blog_platform.sql', migration)
    
    await runCliCommand(['build', '1.0.0', '--notes', 'Blog platform schema'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Test complex queries that represent real application usage
      
      // Get published articles with author info and tag counts
      const publishedArticles = await driver.query(`
        SELECT 
          a.id,
          a.title,
          a.slug,
          a.excerpt,
          a.view_count,
          a.like_count,
          a.published_at,
          u.username,
          u.first_name,
          u.last_name,
          up.bio as author_bio,
          COUNT(DISTINCT at.tag_id) as tag_count,
          COUNT(DISTINCT c.id) FILTER (WHERE c.is_approved = true) as approved_comment_count
        FROM articles a
        JOIN users u ON a.author_id = u.id
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN article_tags at ON a.id = at.article_id
        LEFT JOIN comments c ON a.id = c.article_id
        WHERE a.status = 'published'
        GROUP BY a.id, u.id, up.bio
        ORDER BY a.published_at DESC
      `)
      
      expect(publishedArticles).toHaveLength(3)
      expect(publishedArticles[0].title).toBe('The Perfect Pasta Recipe')
      expect(publishedArticles[0].username).toBe('bob_blogger')
      expect(publishedArticles[0].approved_comment_count).toBe('1')
      
      // Test tag-based article discovery
      const techArticles = await driver.query(`
        SELECT 
          a.title,
          a.slug,
          string_agg(t.name, ', ' ORDER BY t.name) as tags
        FROM articles a
        JOIN article_tags at ON a.id = at.article_id
        JOIN tags t ON at.tag_id = t.id
        WHERE a.status = 'published'
        AND EXISTS (
          SELECT 1 FROM article_tags at2 
          JOIN tags t2 ON at2.tag_id = t2.id 
          WHERE at2.article_id = a.id AND t2.slug = 'technology'
        )
        GROUP BY a.id, a.title, a.slug
        ORDER BY a.title
      `)
      
      expect(techArticles).toHaveLength(2)
      expect(techArticles.map(a => a.title)).toContain('Getting Started with PostgreSQL')
      expect(techArticles.map(a => a.title)).toContain('Advanced SQL Techniques')
      
      // Test user activity summary
      const userStats = await driver.query(`
        SELECT 
          u.username,
          u.first_name,
          u.last_name,
          COUNT(DISTINCT a.id) as total_articles,
          COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'published') as published_articles,
          COUNT(DISTINCT c.id) as total_comments,
          COUNT(DISTINCT c.id) FILTER (WHERE c.is_approved = true) as approved_comments
        FROM users u
        LEFT JOIN articles a ON u.id = a.author_id
        LEFT JOIN comments c ON u.id = c.author_id
        GROUP BY u.id, u.username, u.first_name, u.last_name
        ORDER BY published_articles DESC, total_comments DESC
      `)
      
      expect(userStats).toHaveLength(3)
      const aliceStats = userStats.find(s => s.username === 'alice_writer')
      expect(aliceStats).toMatchObject({
        total_articles: '3',
        published_articles: '2',
        total_comments: '1',
        approved_comments: '1'
      })
      
      // Test full-text search functionality
      const searchResults = await driver.query(`
        SELECT 
          title,
          slug,
          ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', 'postgresql sql')) as rank
        FROM articles
        WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', 'postgresql sql')
        AND status = 'published'
        ORDER BY rank DESC
      `)
      
      expect(searchResults.length).toBeGreaterThan(0)
      expect(searchResults[0].title).toContain('PostgreSQL')
      
      // Test that referential integrity is maintained
      let integrityViolated = false
      try {
        // Try to insert comment for non-existent article
        await driver.execute(`
          INSERT INTO comments (article_id, author_id, content) 
          VALUES (999, 1, 'Comment on non-existent article')
        `)
      } catch (error) {
        integrityViolated = true
      }
      expect(integrityViolated).toBe(true)
      
      // Test cascade delete behavior
      const initialCommentCount = await driver.query(`SELECT COUNT(*) as count FROM comments WHERE article_id = 3`)
      expect(parseInt(initialCommentCount[0].count)).toBeGreaterThan(0)
      
      // Delete an article and verify comments are cascade deleted
      await driver.execute(`DELETE FROM articles WHERE id = 3`)
      
      const finalCommentCount = await driver.query(`SELECT COUNT(*) as count FROM comments WHERE article_id = 3`)
      expect(parseInt(finalCommentCount[0].count)).toBe(0)
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)

  it('should handle migration rollback and error recovery correctly', async () => {
    // Test: System recovers gracefully from failed migrations and maintains database integrity
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // First, create a successful migration
    const goodMigration = `
      CREATE TABLE test_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      INSERT INTO test_table (name) VALUES ('Initial data');
    `
    
    await createTestMigration(testEnv.tempDir, '0001_good_migration.sql', goodMigration)
    
    await runCliCommand(['build', '1.0.0', '--notes', 'Good migration'], { 
      cwd: testEnv.tempDir 
    })
    
    const goodApplyResult = await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(goodApplyResult.exitCode).toBe(0)
    
    // Now create a migration that will fail
    const badMigration = `
      CREATE TABLE another_table (
        id SERIAL PRIMARY KEY,
        test_table_id INTEGER NOT NULL REFERENCES test_table(id)
      );
      
      -- This will fail because column doesn't exist
      ALTER TABLE test_table ADD COLUMN invalid_reference INTEGER REFERENCES non_existent_table(id);
      
      -- This should never execute due to the above failure
      INSERT INTO another_table (test_table_id) VALUES (1);
    `
    
    await createTestMigration(testEnv.tempDir, '0002_bad_migration.sql', badMigration)
    
    await runCliCommand(['build', '2.0.0', '--notes', 'Bad migration'], { 
      cwd: testEnv.tempDir 
    })
    
    // This migration should fail
    const badApplyResult = await runCliCommand(['apply', '2.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(badApplyResult.exitCode).not.toBe(0)
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Verify the original table and data are still intact
      const originalData = await driver.query(`SELECT * FROM test_table`)
      expect(originalData).toHaveLength(1)
      expect(originalData[0].name).toBe('Initial data')
      
      // Verify the bad migration didn't partially apply
      const hasAnotherTable = await driver.hasTable('another_table')
      expect(hasAnotherTable).toBe(false)
      
      // Verify system is still in a consistent state
      const statusResult = await runCliCommand(['status'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(statusResult.exitCode).toBe(0)
      
      // Verify we can still apply good migrations after a failure
      const fixMigration = `
        CREATE TABLE fixed_table (
          id SERIAL PRIMARY KEY,
          test_table_id INTEGER NOT NULL REFERENCES test_table(id),
          description TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        INSERT INTO fixed_table (test_table_id, description) VALUES (1, 'Fixed after failure');
      `
      
      await createTestMigration(testEnv.tempDir, '0003_fix_migration.sql', fixMigration)
      
      await runCliCommand(['build', '3.0.0', '--notes', 'Fix migration'], { 
        cwd: testEnv.tempDir 
      })
      
      const fixApplyResult = await runCliCommand(['apply', '3.0.0'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(fixApplyResult.exitCode).toBe(0)
      
      // Verify the fix migration worked
      const fixedData = await driver.query(`
        SELECT ft.description, tt.name 
        FROM fixed_table ft 
        JOIN test_table tt ON ft.test_table_id = tt.id
      `)
      expect(fixedData).toHaveLength(1)
      expect(fixedData[0].description).toBe('Fixed after failure')
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)

  it('should maintain proper version sequencing and state tracking', async () => {
    // Test: System correctly tracks migration versions and maintains consistent state
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create multiple migrations in sequence
    const migrations = [
      {
        version: '1.0.0',
        file: '0001_users.sql',
        content: `
          CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE
          );
        `
      },
      {
        version: '1.1.0',
        file: '0002_profiles.sql',
        content: `
          CREATE TABLE profiles (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name VARCHAR(255)
          );
        `
      },
      {
        version: '1.2.0',
        file: '0003_posts.sql',
        content: `
          CREATE TABLE posts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            title VARCHAR(255) NOT NULL,
            content TEXT
          );
        `
      }
    ]
    
    // Apply migrations in sequence
    for (const migration of migrations) {
      await createTestMigration(testEnv.tempDir, migration.file, migration.content)
      
      const buildResult = await runCliCommand(['build', migration.version, '--notes', `Migration ${migration.version}`], { 
        cwd: testEnv.tempDir 
      })
      expect(buildResult.exitCode).toBe(0)
      
      const applyResult = await runCliCommand(['apply', migration.version], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(applyResult.exitCode).toBe(0)
    }
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      // Verify all tables were created
      for (const table of ['users', 'profiles', 'posts']) {
        const hasTable = await driver.hasTable(table)
        expect(hasTable).toBe(true)
      }
      
      // Test version listing
      const listResult = await runCliCommand(['list'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(listResult.exitCode).toBe(0)
      
      // Should list all applied versions
      expect(listResult.stdout).toContain('1.0.0')
      expect(listResult.stdout).toContain('1.1.0')
      expect(listResult.stdout).toContain('1.2.0')
      
      // Test status shows current version
      const statusResult = await runCliCommand(['status'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(statusResult.exitCode).toBe(0)
      
      // Verify database contains version history
      const versions = await driver.getAppliedVersions()
      expect(versions).toHaveLength(3)
      
      const versionNumbers = versions.map(v => v.version).sort()
      expect(versionNumbers).toEqual(['1.0.0', '1.1.0', '1.2.0'])
      
      // All versions should be successful
      const successfulVersions = versions.filter(v => v.success)
      expect(successfulVersions).toHaveLength(3)
      
      // Test that data integrity is maintained across all tables
      await driver.execute(`
        INSERT INTO users (email) VALUES ('test@example.com');
        INSERT INTO profiles (user_id, name) VALUES (1, 'Test User');
        INSERT INTO posts (user_id, title, content) VALUES (1, 'Test Post', 'Test content');
      `)
      
      // Verify relationships work across all tables
      const joinedData = await driver.query(`
        SELECT u.email, p.name, po.title
        FROM users u
        JOIN profiles p ON u.id = p.user_id
        JOIN posts po ON u.id = po.user_id
      `)
      
      expect(joinedData).toHaveLength(1)
      expect(joinedData[0]).toMatchObject({
        email: 'test@example.com',
        name: 'Test User',
        title: 'Test Post'
      })
      
      // Test verify command works on the final state
      const verifyResult = await runCliCommand(['verify', '1.2.0'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
      expect(verifyResult.exitCode).toBe(0)
      
    } finally {
      await driver.disconnect()
    }
  }, 60000)
})