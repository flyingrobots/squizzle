# Kubernetes Deployment Example

This example demonstrates running SQUIZZLE migrations in Kubernetes environments.

## Migration Job

```yaml
# k8s/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: squizzle-migration-{{ .Values.version }}
  namespace: {{ .Values.namespace }}
  labels:
    app: squizzle
    version: {{ .Values.version }}
spec:
  backoffLimit: 2
  template:
    metadata:
      labels:
        app: squizzle-migration
        version: {{ .Values.version }}
    spec:
      restartPolicy: OnFailure
      serviceAccountName: squizzle-migrator
      
      initContainers:
      # Wait for database to be ready
      - name: wait-for-db
        image: postgres:15-alpine
        env:
        - name: PGHOST
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: host
        - name: PGPORT
          value: "5432"
        command:
        - sh
        - -c
        - |
          until pg_isready; do
            echo "Waiting for database..."
            sleep 2
          done
          
      containers:
      - name: migration
        image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
        imagePullPolicy: Always
        
        env:
        - name: NODE_ENV
          value: {{ .Values.environment }}
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        - name: OCI_REGISTRY
          value: {{ .Values.oci.registry }}
        - name: OCI_REPOSITORY
          value: {{ .Values.oci.repository }}
        - name: OCI_USERNAME
          valueFrom:
            secretKeyRef:
              name: oci-credentials
              key: username
        - name: OCI_PASSWORD
          valueFrom:
            secretKeyRef:
              name: oci-credentials
              key: password
              
        command:
        - sh
        - -c
        - |
          echo "Starting migration version {{ .Values.version }}"
          
          # Configure SQUIZZLE
          cat > squizzle.config.js << EOF
          module.exports = {
            driver: {
              type: 'postgres',
              config: { connectionString: process.env.DATABASE_URL }
            },
            storage: {
              type: 'oci',
              config: {
                registry: process.env.OCI_REGISTRY,
                repository: process.env.OCI_REPOSITORY,
                auth: {
                  username: process.env.OCI_USERNAME,
                  password: process.env.OCI_PASSWORD
                }
              }
            }
          }
          EOF
          
          # Apply migration
          squizzle apply {{ .Values.version }}
          
          # Verify
          squizzle status
          
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
            
      # Notification sidecar
      - name: notifier
        image: curlimages/curl:latest
        env:
        - name: WEBHOOK_URL
          valueFrom:
            secretKeyRef:
              name: notification-webhook
              key: url
        command:
        - sh
        - -c
        - |
          # Wait for main container to finish
          while kill -0 1 2>/dev/null; do sleep 1; done
          
          # Send notification
          STATUS=$?
          if [ $STATUS -eq 0 ]; then
            curl -X POST $WEBHOOK_URL \
              -H "Content-Type: application/json" \
              -d '{"text":"Migration {{ .Values.version }} completed successfully"}'
          else
            curl -X POST $WEBHOOK_URL \
              -H "Content-Type: application/json" \
              -d '{"text":"Migration {{ .Values.version }} failed!"}'
          fi
```

## Helm Chart

```yaml
# helm/squizzle/values.yaml
environment: production

version: "1.0.0"

namespace: default

image:
  repository: ghcr.io/myorg/squizzle
  tag: latest
  pullPolicy: Always

oci:
  registry: ghcr.io
  repository: myorg/migrations

database:
  host: postgres.default.svc.cluster.local
  port: 5432
  name: myapp

rbac:
  create: true
  
serviceAccount:
  create: true
  name: squizzle-migrator
  
secrets:
  database:
    create: true
    url: ""  # Set via --set or secrets manager
    
  oci:
    create: true
    username: ""
    password: ""
    
monitoring:
  enabled: true
  prometheus:
    enabled: true
```

## Service Account and RBAC

```yaml
# k8s/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: squizzle-migrator
  namespace: {{ .Values.namespace }}
  
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: squizzle-migrator
  namespace: {{ .Values.namespace }}
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["get", "list", "watch"]
  
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: squizzle-migrator
  namespace: {{ .Values.namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: squizzle-migrator
subjects:
- kind: ServiceAccount
  name: squizzle-migrator
  namespace: {{ .Values.namespace }}
```

## ConfigMap for Scripts

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: squizzle-scripts
  namespace: {{ .Values.namespace }}
data:
  pre-migration.sh: |
    #!/bin/bash
    echo "Pre-migration checks..."
    
    # Check database connectivity
    pg_isready -h $PGHOST -p $PGPORT
    
    # Check current version
    squizzle status
    
    # Create backup
    pg_dump $DATABASE_URL | gzip > /backup/pre-migration.sql.gz
    
  post-migration.sh: |
    #!/bin/bash
    echo "Post-migration validation..."
    
    # Run health checks
    psql $DATABASE_URL -c "SELECT version();"
    
    # Verify migration
    squizzle verify {{ .Values.version }}
```

## CronJob for Scheduled Migrations

```yaml
# k8s/cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: squizzle-nightly
  namespace: {{ .Values.namespace }}
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: migration
            image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
            env:
            - name: AUTO_MIGRATE
              value: "true"
            command:
            - sh
            - -c
            - |
              # Check for new migrations
              LATEST=$(squizzle list --registry | head -1)
              CURRENT=$(squizzle status --json | jq -r .current)
              
              if [ "$LATEST" != "$CURRENT" ]; then
                echo "New migration available: $LATEST"
                squizzle apply $LATEST
              else
                echo "No new migrations"
              fi
```

## Deployment Strategies

### Blue-Green Database Migration

```yaml
# k8s/blue-green.yaml
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
    version: {{ .Values.database.activeVersion }}  # blue or green
  ports:
  - port: 5432
    
---
# Run migration on inactive database
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate-{{ .Values.database.inactiveVersion }}
spec:
  template:
    spec:
      containers:
      - name: migration
        env:
        - name: DATABASE_URL
          value: postgres://{{ .Values.database.inactiveVersion }}-postgres:5432/myapp
        command:
        - squizzle
        - apply
        - {{ .Values.version }}
        
---
# Switch service after migration
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
    version: {{ .Values.database.inactiveVersion }}  # Switch to migrated DB
```

### Canary Deployment

```yaml
# k8s/canary.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: squizzle-canary-{{ .Values.version }}
spec:
  parallelism: 1
  completions: {{ .Values.canary.shards }}
  template:
    spec:
      containers:
      - name: migration
        env:
        - name: SHARD_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
        command:
        - sh
        - -c
        - |
          # Apply to specific shard only
          DATABASE_URL="${DATABASE_URL}_shard_${SHARD_ID}"
          squizzle apply {{ .Values.version }}
```

## Monitoring

### Prometheus Metrics

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: squizzle-metrics
spec:
  selector:
    matchLabels:
      app: squizzle
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

### Custom Metrics Exporter

```go
// metrics-exporter/main.go
package main

import (
    "database/sql"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "net/http"
)

var (
    migrationGauge = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "squizzle_migration_version",
            Help: "Current migration version",
        },
        []string{"environment"},
    )
    
    migrationDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "squizzle_migration_duration_seconds",
            Help: "Migration execution duration",
        },
        []string{"version", "status"},
    )
)

func init() {
    prometheus.MustRegister(migrationGauge)
    prometheus.MustRegister(migrationDuration)
}

func main() {
    // Query migration status
    go func() {
        for {
            version := getCurrentVersion()
            migrationGauge.WithLabelValues(os.Getenv("ENVIRONMENT")).Set(version)
            time.Sleep(60 * time.Second)
        }
    }()
    
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":9090", nil)
}
```

## Secrets Management

### Using Sealed Secrets

```yaml
# k8s/sealed-secret.yaml
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: database-credentials
  namespace: {{ .Values.namespace }}
spec:
  encryptedData:
    url: AgB4D5... # Encrypted DATABASE_URL
```

### Using External Secrets

```yaml
# k8s/external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
spec:
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: database-credentials
  data:
  - secretKey: url
    remoteRef:
      key: prod/database/url
```

## Backup Before Migration

```yaml
# k8s/backup-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pre-migration-backup
spec:
  template:
    spec:
      containers:
      - name: backup
        image: postgres:15-alpine
        volumeMounts:
        - name: backup-storage
          mountPath: /backup
        command:
        - sh
        - -c
        - |
          BACKUP_FILE="/backup/$(date +%Y%m%d-%H%M%S).sql.gz"
          pg_dump $DATABASE_URL | gzip > $BACKUP_FILE
          echo "Backup created: $BACKUP_FILE"
      volumes:
      - name: backup-storage
        persistentVolumeClaim:
          claimName: backup-pvc
```

## Rollback Strategy

```yaml
# k8s/rollback.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: rollback-script
data:
  rollback.sh: |
    #!/bin/bash
    CURRENT=$(squizzle status --json | jq -r .current)
    echo "Current version: $CURRENT"
    
    if [ "$1" == "auto" ]; then
      # Automatic rollback on failure
      squizzle rollback $CURRENT
    else
      # Manual rollback to specific version
      squizzle rollback $1
    fi
```

## Usage

### Deploy with Helm

```bash
# Install
helm install squizzle ./helm/squizzle \
  --set version=1.0.0 \
  --set database.url=$DATABASE_URL \
  --set oci.username=$GITHUB_USER \
  --set oci.password=$GITHUB_TOKEN

# Upgrade
helm upgrade squizzle ./helm/squizzle \
  --set version=1.1.0

# Rollback
helm rollback squizzle
```

### Manual Job Creation

```bash
# Create migration job
kubectl apply -f k8s/migration-job.yaml

# Watch progress
kubectl logs -f job/squizzle-migration-1.0.0

# Check status
kubectl get job squizzle-migration-1.0.0
```

### GitOps with ArgoCD

```yaml
# argocd/application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: squizzle-migrations
spec:
  source:
    repoURL: https://github.com/myorg/migrations
    targetRevision: HEAD
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: false
      selfHeal: false
```