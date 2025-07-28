# CI/CD Integration

Integrate SQUIZZLE into your continuous integration and deployment pipelines for automated database migrations.

## GitHub Actions

### Basic Workflow

```yaml
# .github/workflows/migrations.yml
name: Database Migrations

on:
  push:
    branches: [main]
    paths:
      - 'db/**'
      - 'lib/db/schema/**'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to build'
        required: true
        type: string

permissions:
  contents: read
  packages: write
  id-token: write  # For Sigstore signing

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Install SQUIZZLE
        run: npm install -g @squizzle/cli
        
      - name: Build migrations
        run: |
          VERSION="${{ github.event.inputs.version || github.sha }}"
          squizzle build $VERSION \
            --notes "Automated build from ${{ github.sha }}" \
            --author "${{ github.actor }}"
            
      - name: Sign artifact
        if: github.ref == 'refs/heads/main'
        run: squizzle sign $VERSION
        
      - name: Push to registry
        env:
          OCI_USERNAME: ${{ github.actor }}
          OCI_PASSWORD: ${{ secrets.GITHUB_TOKEN }}
        run: |
          squizzle push $VERSION \
            --registry ghcr.io \
            --repository ${{ github.repository }}-migrations
```

### Automated Deployment

```yaml
# .github/workflows/deploy.yml
name: Deploy Migrations

on:
  workflow_run:
    workflows: ["Database Migrations"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to deploy'
        required: true
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production

jobs:
  deploy-staging:
    if: github.event.inputs.environment == 'staging' || github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Install SQUIZZLE
        run: npm install -g @squizzle/cli
        
      - name: Configure SQUIZZLE
        run: |
          cat > squizzle.config.js << EOF
          module.exports = {
            driver: {
              type: 'postgres',
              config: {
                connectionString: '${{ secrets.DATABASE_URL }}'
              }
            },
            storage: {
              type: 'oci',
              config: {
                registry: 'ghcr.io',
                repository: '${{ github.repository }}-migrations',
                auth: {
                  username: '${{ github.actor }}',
                  password: '${{ secrets.GITHUB_TOKEN }}'
                }
              }
            }
          }
          EOF
          
      - name: Apply migrations
        run: |
          VERSION="${{ github.event.inputs.version || github.sha }}"
          squizzle apply $VERSION
          
      - name: Verify deployment
        run: squizzle status

  deploy-production:
    if: github.event.inputs.environment == 'production'
    runs-on: ubuntu-latest
    environment: production
    needs: [deploy-staging]  # Require staging first
    steps:
      # Same as staging but with production secrets
```

### Pull Request Checks

```yaml
# .github/workflows/pr-check.yml
name: PR Migration Check

on:
  pull_request:
    paths:
      - 'db/**'
      - 'lib/db/schema/**'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check migrations
        run: |
          # Generate Drizzle migrations
          npx drizzle-kit generate
          
          # Check for conflicts
          if git diff --exit-code db/drizzle/; then
            echo "✅ No migration conflicts"
          else
            echo "❌ Uncommitted migrations detected"
            exit 1
          fi
          
      - name: Dry run
        run: |
          squizzle build pr-${{ github.event.pull_request.number }} \
            --dry-run \
            --notes "PR #${{ github.event.pull_request.number }}"
```

## GitLab CI/CD

```yaml
# .gitlab-ci.yml
stages:
  - build
  - deploy

variables:
  SQUIZZLE_VERSION: "${CI_COMMIT_TAG:-$CI_COMMIT_SHORT_SHA}"

build-migrations:
  stage: build
  image: node:18
  rules:
    - if: $CI_COMMIT_TAG
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - db/**
        - lib/db/schema/**
  script:
    - npm install -g @squizzle/cli
    - squizzle build $SQUIZZLE_VERSION
    - squizzle sign $SQUIZZLE_VERSION
    - squizzle push $SQUIZZLE_VERSION
  artifacts:
    paths:
      - db/tarballs/

deploy-staging:
  stage: deploy
  image: node:18
  environment: staging
  needs: [build-migrations]
  script:
    - npm install -g @squizzle/cli
    - |
      cat > squizzle.config.js << EOF
      module.exports = {
        driver: {
          type: 'postgres',
          config: { connectionString: '$DATABASE_URL' }
        },
        storage: {
          type: 'oci',
          config: {
            registry: '$CI_REGISTRY',
            repository: '$CI_PROJECT_PATH/migrations',
            auth: {
              username: '$CI_REGISTRY_USER',
              password: '$CI_REGISTRY_PASSWORD'
            }
          }
        }
      }
      EOF
    - squizzle apply $SQUIZZLE_VERSION
    - squizzle status

deploy-production:
  stage: deploy
  image: node:18
  environment: production
  when: manual
  only:
    - tags
  needs: [deploy-staging]
  script:
    # Same as staging with production variables
```

## Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent any
    
    parameters {
        string(name: 'VERSION', defaultValue: '', description: 'Migration version')
        choice(name: 'ENVIRONMENT', choices: ['staging', 'production'], description: 'Target environment')
    }
    
    environment {
        SQUIZZLE_VERSION = "${params.VERSION ?: env.GIT_COMMIT}"
    }
    
    stages {
        stage('Build') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                }
            }
            steps {
                sh 'npm install -g @squizzle/cli'
                sh "squizzle build ${SQUIZZLE_VERSION}"
                
                withCredentials([usernamePassword(
                    credentialsId: 'docker-registry',
                    usernameVariable: 'OCI_USERNAME',
                    passwordVariable: 'OCI_PASSWORD'
                )]) {
                    sh "squizzle push ${SQUIZZLE_VERSION}"
                }
            }
        }
        
        stage('Deploy') {
            when {
                expression { params.ENVIRONMENT }
            }
            steps {
                script {
                    def dbCreds = params.ENVIRONMENT == 'production' 
                        ? 'prod-db' : 'staging-db'
                    
                    withCredentials([string(
                        credentialsId: dbCreds,
                        variable: 'DATABASE_URL'
                    )]) {
                        sh """
                            cat > squizzle.config.js << EOF
                            module.exports = {
                                driver: {
                                    type: 'postgres',
                                    config: { connectionString: '${DATABASE_URL}' }
                                },
                                storage: {
                                    type: 'oci',
                                    config: {
                                        registry: 'registry.company.com',
                                        repository: 'migrations'
                                    }
                                }
                            }
                            EOF
                        """
                        sh "squizzle apply ${SQUIZZLE_VERSION}"
                    }
                }
            }
        }
    }
    
    post {
        success {
            slackSend(
                color: 'good',
                message: "Migration ${SQUIZZLE_VERSION} deployed to ${params.ENVIRONMENT}"
            )
        }
        failure {
            slackSend(
                color: 'danger',
                message: "Migration ${SQUIZZLE_VERSION} failed in ${params.ENVIRONMENT}"
            )
        }
    }
}
```

## CircleCI

```yaml
# .circleci/config.yml
version: 2.1

orbs:
  node: circleci/node@5

workflows:
  migrations:
    jobs:
      - build:
          filters:
            branches:
              only: main
            tags:
              only: /^v.*/
      - deploy-staging:
          requires: [build]
          filters:
            branches:
              only: main
      - approve-production:
          type: approval
          requires: [deploy-staging]
          filters:
            tags:
              only: /^v.*/
      - deploy-production:
          requires: [approve-production]
          filters:
            tags:
              only: /^v.*/

jobs:
  build:
    executor: node/default
    steps:
      - checkout
      - node/install-packages
      - run:
          name: Install SQUIZZLE
          command: npm install -g @squizzle/cli
      - run:
          name: Build migrations
          command: |
            VERSION="${CIRCLE_TAG:-${CIRCLE_SHA1:0:7}}"
            squizzle build $VERSION
      - run:
          name: Push to registry
          command: |
            echo $DOCKER_PASSWORD | docker login -u $DOCKER_USERNAME --password-stdin
            squizzle push $VERSION
            
  deploy-staging:
    executor: node/default
    environment:
      NODE_ENV: staging
    steps:
      - run:
          name: Install SQUIZZLE
          command: npm install -g @squizzle/cli
      - run:
          name: Apply migrations
          command: |
            VERSION="${CIRCLE_TAG:-${CIRCLE_SHA1:0:7}}"
            squizzle apply $VERSION
```

## Best Practices

### 1. Version Strategy

Use Git-based versioning:

```javascript
// Determine version
const version = process.env.CI_COMMIT_TAG ||      // Git tag
                process.env.CI_COMMIT_SHA ||      // Commit SHA
                process.env.CI_BUILD_NUMBER ||     // Build number
                `dev-${Date.now()}`                // Fallback

// For PRs
const version = `pr-${process.env.PR_NUMBER}-${process.env.COMMIT_SHA}`
```

### 2. Environment Promotion

```yaml
# Promote through environments
stages:
  - Build → Development
  - Development → Staging (automatic)
  - Staging → Production (manual approval)
```

### 3. Rollback Strategy

```yaml
- name: Rollback on failure
  if: failure()
  run: |
    CURRENT=$(squizzle status --json | jq -r .current)
    if [ "$CURRENT" == "$VERSION" ]; then
      squizzle rollback $VERSION
    fi
```

### 4. Notifications

```javascript
// Send notifications
const webhook = process.env.SLACK_WEBHOOK
const payload = {
  text: `Migration ${version} ${success ? 'deployed' : 'failed'}`,
  attachments: [{
    color: success ? 'good' : 'danger',
    fields: [
      { title: 'Version', value: version },
      { title: 'Environment', value: environment },
      { title: 'Applied by', value: process.env.CI_USER }
    ]
  }]
}
fetch(webhook, { method: 'POST', body: JSON.stringify(payload) })
```

### 5. Parallel Environments

Deploy to multiple environments:

```yaml
jobs:
  deploy:
    strategy:
      matrix:
        environment: [dev, staging, qa]
    environment: ${{ matrix.environment }}
    steps:
      - name: Deploy to ${{ matrix.environment }}
        env:
          DATABASE_URL: ${{ secrets[format('DATABASE_URL_{0}', matrix.environment)] }}
        run: squizzle apply $VERSION
```

## Security Considerations

### 1. Secrets Management

Never hardcode credentials:

```yaml
# ❌ Bad
env:
  DATABASE_URL: postgresql://user:pass@host/db

# ✅ Good  
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### 2. Least Privilege

CI/CD should have minimal permissions:

```sql
-- CI/CD user
CREATE USER ci_migrator WITH PASSWORD '...';
GRANT CREATE ON DATABASE app TO ci_migrator;
GRANT ALL ON SCHEMA public TO ci_migrator;
-- Don't grant SUPERUSER or database ownership
```

### 3. Audit Trail

Log all deployments:

```yaml
- name: Log deployment
  if: always()
  run: |
    echo "::notice::Migration $VERSION deployed by ${{ github.actor }}"
    echo "$VERSION|${{ github.actor }}|$(date -u)" >> deployments.log
```

## Monitoring

### 1. Health Checks

```yaml
- name: Post-deployment check
  run: |
    # Check migration status
    squizzle status
    
    # Run application health check
    curl -f https://app.example.com/health || exit 1
    
    # Check database connectivity
    psql $DATABASE_URL -c "SELECT 1" || exit 1
```

### 2. Performance Monitoring

```yaml
- name: Migration metrics
  run: |
    START=$(date +%s)
    squizzle apply $VERSION
    END=$(date +%s)
    DURATION=$((END - START))
    
    # Send to monitoring
    curl -X POST https://metrics.example.com/v1/custom \
      -d "migration.duration:$DURATION|s|#version:$VERSION"
```

### 3. Alerting

```javascript
// Alert on long-running migrations
const timeout = setTimeout(() => {
  console.error('Migration taking longer than expected')
  // Send alert
}, 5 * 60 * 1000) // 5 minutes

await squizzle.apply(version)
clearTimeout(timeout)
```

## Next Steps

- [Multi-Environment Setup](./environments.md) - Environment strategies
- [Rollback Strategies](./rollbacks.md) - Safe rollbacks
- [Disaster Recovery](./disaster-recovery.md) - Incident response