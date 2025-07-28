# GitHub Actions CI/CD Example

This example shows how to automate SQUIZZLE migrations with GitHub Actions.

## Workflow Files

### Basic Migration Workflow

```yaml
# .github/workflows/migrate.yml
name: Database Migrations

on:
  push:
    branches: [main]
    paths:
      - 'db/**'
      - 'src/db/schema/**'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to deploy'
        required: true
        type: string
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production

permissions:
  contents: read
  packages: write
  id-token: write  # For Sigstore signing

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          
      - name: Install dependencies
        run: |
          npm ci
          npm install -g @squizzle/cli
          
      - name: Determine version
        id: version
        run: |
          if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then
            echo "version=${{ github.event.inputs.version }}" >> $GITHUB_OUTPUT
          else
            echo "version=$(date +%Y.%m.%d)-${{ github.run_number }}" >> $GITHUB_OUTPUT
          fi
          
      - name: Generate Drizzle migrations
        run: npx drizzle-kit generate:pg
        
      - name: Build migration artifact
        run: |
          squizzle build ${{ steps.version.outputs.version }} \
            --notes "Automated build from ${{ github.sha }}" \
            --author "${{ github.actor }}"
            
      - name: Sign artifact (production only)
        if: github.ref == 'refs/heads/main'
        run: squizzle sign ${{ steps.version.outputs.version }}
        
      - name: Push to registry
        env:
          OCI_USERNAME: ${{ github.actor }}
          OCI_PASSWORD: ${{ secrets.GITHUB_TOKEN }}
        run: |
          squizzle push ${{ steps.version.outputs.version }} \
            --registry ghcr.io \
            --repository ${{ github.repository }}/migrations

  deploy-staging:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: staging
    if: github.event_name == 'push' || github.event.inputs.environment == 'staging'
    steps:
      - uses: actions/checkout@v4
      
      - name: Install SQUIZZLE
        run: npm install -g @squizzle/cli
        
      - name: Configure SQUIZZLE
        run: |
          cat > squizzle.config.js << EOF
          module.exports = {
            driver: {
              type: 'postgres',
              config: {
                connectionString: '${{ secrets.STAGING_DATABASE_URL }}'
              }
            },
            storage: {
              type: 'oci',
              config: {
                registry: 'ghcr.io',
                repository: '${{ github.repository }}/migrations',
                auth: {
                  username: '${{ github.actor }}',
                  password: '${{ secrets.GITHUB_TOKEN }}'
                }
              }
            }
          }
          EOF
          
      - name: Apply migration
        run: |
          squizzle apply ${{ needs.build-and-push.outputs.version }}
          
      - name: Run smoke tests
        run: |
          npm install
          npm run test:staging
          
      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Staging deployment ${{ job.status }}",
              "blocks": [{
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "*Staging Migration:* ${{ job.status }}\n*Version:* ${{ needs.build-and-push.outputs.version }}"
                }
              }]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}

  deploy-production:
    needs: [build-and-push, deploy-staging]
    runs-on: ubuntu-latest
    environment: production
    if: github.event.inputs.environment == 'production'
    steps:
      - uses: actions/checkout@v4
      
      - name: Install SQUIZZLE
        run: npm install -g @squizzle/cli
        
      - name: Configure SQUIZZLE
        run: |
          cat > squizzle.config.js << EOF
          module.exports = {
            driver: {
              type: 'postgres',
              config: {
                connectionString: '${{ secrets.PRODUCTION_DATABASE_URL }}',
                ssl: { rejectUnauthorized: true }
              }
            },
            storage: {
              type: 'oci',
              config: {
                registry: 'ghcr.io',
                repository: '${{ github.repository }}/migrations',
                auth: {
                  username: '${{ github.actor }}',
                  password: '${{ secrets.GITHUB_TOKEN }}'
                }
              }
            },
            security: {
              enabled: true,
              requireSignature: true
            }
          }
          EOF
          
      - name: Verify migration
        run: |
          squizzle verify ${{ needs.build-and-push.outputs.version }}
          
      - name: Create backup
        run: |
          pg_dump ${{ secrets.PRODUCTION_DATABASE_URL }} | \
            gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
          # Upload backup to S3 or other storage
          
      - name: Apply migration
        run: |
          squizzle apply ${{ needs.build-and-push.outputs.version }}
          
      - name: Verify deployment
        run: |
          squizzle status
          # Add custom health checks
          
      - name: Create release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ needs.build-and-push.outputs.version }}
          release_name: Release ${{ needs.build-and-push.outputs.version }}
          body: |
            Database migration ${{ needs.build-and-push.outputs.version }}
            
            **Changes:**
            ${{ github.event.head_commit.message }}
```

### Pull Request Checks

```yaml
# .github/workflows/pr-check.yml
name: PR Migration Check

on:
  pull_request:
    paths:
      - 'db/**'
      - 'src/db/schema/**'

jobs:
  check-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: |
          npm ci
          npm install -g @squizzle/cli
          
      - name: Generate migrations
        run: npx drizzle-kit generate:pg
        
      - name: Check for uncommitted migrations
        run: |
          if [ -n "$(git status --porcelain db/drizzle)" ]; then
            echo "❌ Uncommitted migrations detected"
            echo "Please run 'npm run db:generate' and commit the changes"
            exit 1
          fi
          
      - name: Dry run build
        run: |
          squizzle build pr-${{ github.event.pull_request.number }} \
            --dry-run \
            --notes "PR #${{ github.event.pull_request.number }}"
            
      - name: SQL linting
        run: |
          # Install sqlfluff or similar
          pip install sqlfluff
          sqlfluff lint db/squizzle/*.sql
          
      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '✅ Migration checks passed'
            })
```

### Scheduled Backups

```yaml
# .github/workflows/backup.yml
name: Database Backup

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [staging, production]
    environment: ${{ matrix.environment }}
    steps:
      - name: Create backup
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          FILENAME="backup-${{ matrix.environment }}-$(date +%Y%m%d-%H%M%S).sql.gz"
          pg_dump $DATABASE_URL | gzip > $FILENAME
          
      - name: Upload to S3
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          aws s3 cp $FILENAME s3://mybackups/squizzle/${{ matrix.environment }}/
          
      - name: Clean old backups
        run: |
          # Keep only last 30 days
          aws s3 ls s3://mybackups/squizzle/${{ matrix.environment }}/ | \
            while read -r line; do
              createDate=$(echo $line | awk '{print $1" "$2}')
              createDate=$(date -d "$createDate" +%s)
              olderThan=$(date -d "30 days ago" +%s)
              if [[ $createDate -lt $olderThan ]]; then
                fileName=$(echo $line | awk '{print $4}')
                aws s3 rm s3://mybackups/squizzle/${{ matrix.environment }}/$fileName
              fi
            done
```

## Security Best Practices

### Repository Secrets

Required secrets:
- `STAGING_DATABASE_URL` - Staging database connection
- `PRODUCTION_DATABASE_URL` - Production database connection
- `SLACK_WEBHOOK` - Slack notifications
- `AWS_ACCESS_KEY_ID` - For backups
- `AWS_SECRET_ACCESS_KEY` - For backups

### Environment Protection Rules

```yaml
# Settings > Environments > Production
- Required reviewers: 1
- Deployment branches: main only
- Environment secrets: PRODUCTION_DATABASE_URL
```

### Least Privilege

Create dedicated CI/CD database users:

```sql
-- Staging CI/CD user
CREATE USER ci_staging WITH PASSWORD '...';
GRANT CONNECT ON DATABASE staging TO ci_staging;
GRANT CREATE ON SCHEMA public TO ci_staging;

-- Production CI/CD user
CREATE USER ci_production WITH PASSWORD '...';
GRANT CONNECT ON DATABASE production TO ci_production;
GRANT CREATE ON SCHEMA public TO ci_production;
-- Grant specific permissions as needed
```

## Monitoring

### Status Badge

```markdown
![Migration Status](https://github.com/myorg/myrepo/actions/workflows/migrate.yml/badge.svg)
```

### Deployment Dashboard

Create a GitHub Pages dashboard:

```yaml
- name: Update deployment status
  run: |
    cat > deployment-status.json << EOF
    {
      "staging": {
        "version": "${{ needs.build-and-push.outputs.version }}",
        "deployed": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
        "status": "${{ job.status }}"
      }
    }
    EOF
    
- name: Deploy to GitHub Pages
  uses: peaceiris/actions-gh-pages@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./public
```