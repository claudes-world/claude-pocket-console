# Deployment Guide

> Complete guide for deploying Claude Pocket Console to production using Google Cloud Platform and Terraform.

## Table of Contents

1. [Infrastructure Overview](#1-infrastructure-overview)
2. [Environment Configuration](#2-environment-configuration)
3. [Terraform Setup](#3-terraform-setup)
4. [CI/CD Pipelines](#4-cicd-pipelines)
5. [Deployment Procedures](#5-deployment-procedures)
6. [Monitoring & Observability](#6-monitoring--observability)
7. [Rollback Procedures](#7-rollback-procedures)
8. [Security Considerations](#8-security-considerations)

---

## 1. Infrastructure Overview

### 1.1 Cloud Architecture

```mermaid
graph TB
    subgraph "Google Cloud Platform"
        LB[Cloud Load Balancer] --> CR1[Cloud Run: Web]
        LB --> CR2[Cloud Run: Terminal Server]
        CR1 --> Conv[Convex Cloud]
        CR2 --> AR[Artifact Registry]
        CR2 --> SM[Secret Manager]
    end
    
    Users[Users] --> CF[Cloudflare CDN]
    CF --> LB
    GH[GitHub Actions] --> AR
```

### 1.2 Services Used

| Service | Purpose | Configuration |
| --- | --- | --- |
| **Cloud Run** | Serverless container hosting | 2 services (web, terminal-server) |
| **Artifact Registry** | Docker image storage | Multi-region replication |
| **Secret Manager** | Secure credential storage | Automatic rotation |
| **Cloud Load Balancer** | Traffic distribution | Global anycast IPs |
| **Cloud Armor** | DDoS protection | Rate limiting rules |
| **Cloudflare** | CDN and DNS | Proxy enabled |

### 1.3 Environments

| Environment | Branch | URL | Purpose |
| --- | --- | --- | --- |
| **Development** | `dev` | `dev.claude-console.app` | Integration testing |
| **Staging** | `staging` | `staging.claude-console.app` | Pre-production validation |
| **Production** | `main` | `console.claude.app` | Live environment |

---

## 2. Environment Configuration

### 2.1 Required Secrets

**Google Cloud Secrets:**
```bash
# List all required secrets
gcloud secrets list --project=claude-pocket-console

# Required secrets:
# - convex-deploy-key
# - github-client-id
# - github-client-secret
# - docker-registry-key
# - monitoring-api-key
```

**Setting Secrets:**
```bash
# Create new secret
echo -n "secret-value" | gcloud secrets create SECRET_NAME --data-file=-

# Update existing secret
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

### 2.2 Environment Variables

**Production Configuration:**
```env
# apps/web/.env.production
NEXT_PUBLIC_API_URL=https://api.console.claude.app
NEXT_PUBLIC_CONVEX_URL=https://happy-otter-123.convex.cloud
NEXT_PUBLIC_ENVIRONMENT=production

# apps/terminal-server/.env.production
ENVIRONMENT=production
DOCKER_TIMEOUT=300
MAX_SESSIONS_PER_USER=10
CONTAINER_MEMORY_LIMIT=512m
CONTAINER_CPU_LIMIT=0.5
```

### 2.3 Service Accounts

```bash
# Create service accounts
gcloud iam service-accounts create cloud-run-web \
  --display-name="Cloud Run Web Service"

gcloud iam service-accounts create cloud-run-terminal \
  --display-name="Cloud Run Terminal Service"

# Grant necessary permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:cloud-run-web@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 3. Terraform Setup

### 3.1 Directory Structure

```
infrastructure/terraform/
   environments/
      dev/
         terraform.tfvars
         backend.tf
      staging/
         terraform.tfvars
         backend.tf
      prod/
          terraform.tfvars
          backend.tf
   modules/
      cloud-run/
      networking/
      security/
   main.tf
   variables.tf
   outputs.tf
```

### 3.2 Terraform Commands

```bash
# Initialize Terraform
cd infrastructure/terraform/environments/prod
terraform init

# Plan changes
terraform plan -out=tfplan

# Apply changes
terraform apply tfplan

# Common operations
terraform workspace list     # List workspaces
terraform state list        # List resources
terraform destroy           # Destroy all resources (careful!)
```

### 3.3 Key Terraform Resources

```hcl
# Example Cloud Run service definition
resource "google_cloud_run_service" "web" {
  name     = "claude-console-web"
  location = var.region

  template {
    spec {
      containers {
        image = "${var.registry_url}/web:${var.image_tag}"
        
        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
        
        env {
          name = "NEXT_PUBLIC_CONVEX_URL"
          value_from {
            secret_key_ref {
              name = "convex-url"
              key  = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}
```

---

## 4. CI/CD Pipelines

### 4.1 GitHub Actions Workflows

**Pipeline Overview:**
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and Deploy
        # ... deployment steps
```

### 4.2 Deployment Workflows

| Workflow | Trigger | Actions |
| --- | --- | --- |
| `ci.yml` | PR/Push | Lint � Test � Build � Security Scan |
| `deploy-dev.yml` | Push to `dev` | Build � Push to Registry � Deploy to Dev |
| `deploy-staging.yml` | Push to `staging` | Build � Push � Deploy � Smoke Tests |
| `deploy-prod.yml` | Tag `v*` | Build � Push � Deploy � Health Checks |

### 4.3 Build and Push Process

```yaml
# Build Docker images
- name: Build Web Image
  run: |
    docker build -t web:${{ github.sha }} \
      --build-arg NODE_ENV=production \
      --file apps/web/Dockerfile \
      apps/web

- name: Build Terminal Server Image
  run: |
    docker build -t terminal-server:${{ github.sha }} \
      --build-arg PYTHON_ENV=production \
      --file apps/terminal-server/Dockerfile \
      apps/terminal-server

# Push to Artifact Registry
- name: Push Images
  run: |
    docker tag web:${{ github.sha }} \
      ${{ env.REGISTRY }}/web:${{ github.sha }}
    docker push ${{ env.REGISTRY }}/web:${{ github.sha }}
```

### 4.4 Security Scanning

```yaml
# Trivy security scan
- name: Run Trivy Scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: '${{ env.REGISTRY }}/web:${{ github.sha }}'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'HIGH,CRITICAL'
    exit-code: '1'
```

---

## 5. Deployment Procedures

### 5.1 Production Deployment Checklist

```markdown
## Pre-Deployment
- [ ] All tests passing in CI
- [ ] Security scans clean
- [ ] Changelog updated
- [ ] Database migrations reviewed
- [ ] Rollback plan documented

## Deployment Steps
- [ ] Create release tag: `git tag -a v1.2.3 -m "Release v1.2.3"`
- [ ] Push tag: `git push origin v1.2.3`
- [ ] Monitor GitHub Actions deployment
- [ ] Verify staging deployment
- [ ] Approve production deployment
- [ ] Monitor health checks

## Post-Deployment
- [ ] Verify production health endpoints
- [ ] Check error rates in monitoring
- [ ] Run smoke tests
- [ ] Update status page
- [ ] Notify team in Slack
```

### 5.2 Manual Deployment (Emergency)

```bash
# Build and push manually
docker build -t web:emergency apps/web
docker tag web:emergency gcr.io/project/web:emergency
docker push gcr.io/project/web:emergency

# Deploy to Cloud Run
gcloud run deploy claude-console-web \
  --image gcr.io/project/web:emergency \
  --region us-central1 \
  --platform managed

# Update traffic split (canary)
gcloud run services update-traffic claude-console-web \
  --to-revisions emergency=10
```

### 5.3 Database Migrations

```bash
# Convex migrations are automatic on push
pnpm convex push --prod

# For schema changes:
# 1. Deploy functions with backward compatibility
# 2. Run data migration
# 3. Deploy cleanup functions
```

---

## 6. Monitoring & Observability

### 6.1 Health Endpoints

| Service | Endpoint | Expected Response |
| --- | --- | --- |
| Web | `/api/health` | `{"status": "healthy", "version": "1.2.3"}` |
| Terminal API | `/api/v1/health` | `{"status": "healthy", "containers": 5}` |
| Overall | `/healthz` | `{"web": "ok", "api": "ok", "db": "ok"}` |

### 6.2 Monitoring Setup

**Google Cloud Monitoring:**
```bash
# Create uptime checks
gcloud monitoring uptime-checks create https \
  --display-name="Web Health Check" \
  --uri="https://console.claude.app/api/health"

# Create alerts
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-display-name="Error rate > 1%" \
  --condition-threshold-value=0.01
```

**Key Metrics:**
- Request latency (p50, p95, p99)
- Error rate (4xx, 5xx)
- Container count and utilization
- WebSocket connection count
- Database query performance

### 6.3 Logging

```bash
# View logs
gcloud logging read "resource.type=cloud_run_revision" \
  --limit 50 \
  --format json

# Stream logs
gcloud logging tail "resource.type=cloud_run_revision" \
  --filter="severity>=ERROR"

# Export logs to BigQuery
gcloud logging sinks create bigquery-sink \
  bigquery.googleapis.com/projects/PROJECT/datasets/logs \
  --log-filter='resource.type="cloud_run_revision"'
```

---

## 7. Rollback Procedures

### 7.1 Immediate Rollback

```bash
# List revisions
gcloud run revisions list --service=claude-console-web

# Rollback to previous revision
gcloud run services update-traffic claude-console-web \
  --to-revisions PREVIOUS_REVISION=100

# Or use Terraform
cd infrastructure/terraform/environments/prod
terraform apply -var="image_tag=previous-tag"
```

### 7.2 Gradual Rollback

```bash
# Start with 10% traffic to old revision
gcloud run services update-traffic claude-console-web \
  --to-revisions OLD=10,CURRENT=90

# Monitor metrics, then increase if stable
gcloud run services update-traffic claude-console-web \
  --to-revisions OLD=50,CURRENT=50

# Complete rollback
gcloud run services update-traffic claude-console-web \
  --to-revisions OLD=100
```

### 7.3 Data Rollback

```javascript
// Convex function rollback
// Deploy previous function version
pnpm convex push --prod --version=previous

// For data rollback, use point-in-time recovery
// Available in Convex dashboard
```

---

## 8. Security Considerations

### 8.1 Production Security Checklist

- [ ] All secrets in Secret Manager (not in code)
- [ ] Service accounts follow least privilege
- [ ] Cloud Armor rules configured
- [ ] SSL/TLS certificates valid
- [ ] Security headers configured
- [ ] Container images scanned
- [ ] Dependencies up to date
- [ ] Access logs enabled

### 8.2 Security Headers

```typescript
// Configured in Cloud Run service
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'",
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};
```

### 8.3 Incident Response

**Security Incident Playbook:**
1. **Detect** - Alert triggered or issue reported
2. **Assess** - Determine severity and scope
3. **Contain** - Isolate affected systems
4. **Respond** - Apply fixes or rollback
5. **Document** - Create incident report
6. **Review** - Post-mortem and improvements

**Emergency Contacts:**
- On-call engineer: [Rotation schedule]
- Security team: security@company.com
- GCP Support: [Support case URL]

---

## Related Documentation

- [Architecture Guide](./ARCHITECTURE.md) - System design
- [Development Guide](./DEVELOPMENT.md) - Local setup
- [Contributing Guidelines](../.github/CONTRIBUTING.md) - Workflow

For cloud-specific guidance:
- [Google Cloud Run Docs](https://cloud.google.com/run/docs)
- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest)
- [Convex Production Guide](https://docs.convex.dev/production)