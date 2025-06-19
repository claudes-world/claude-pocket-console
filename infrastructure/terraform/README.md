# Terraform Infrastructure for Claude Pocket Console

This directory contains the Terraform configuration for provisioning cloud infrastructure for the Claude Pocket Console.

## Overview

The Terraform configuration manages the following infrastructure components:

- **Networking**: VPC, subnets, security groups, and load balancers
- **Compute**: ECS cluster for running Docker containers
- **Storage**: S3 buckets for logs and artifacts
- **Database**: RDS instance for persistent data
- **Monitoring**: CloudWatch logs, metrics, and dashboards
- **Security**: IAM roles, policies, and security groups

## Structure

- `main.tf` - Main configuration and provider setup
- `variables.tf` - Input variable definitions
- `outputs.tf` - Output values for use by other systems
- `modules/` - Reusable Terraform modules (to be created)

## Prerequisites

1. Terraform >= 1.0
2. AWS CLI configured with appropriate credentials
3. Docker (for local testing)

## Usage

### Initial Setup

```bash
# Initialize Terraform
terraform init

# Create workspace for environment
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# Review planned changes
terraform plan -var="environment=dev"
```

### Deployment

```bash
# Apply configuration
terraform apply -var="environment=dev"

# Get outputs
terraform output -json > infrastructure-outputs.json
```

### Destruction

```bash
# Destroy all resources (CAUTION!)
terraform destroy -var="environment=dev"
```

## Configuration

### Required Variables

- `environment` - Target environment (dev/staging/prod)
- `aws_region` - AWS region for deployment

### Optional Variables

See `variables.tf` for all configurable options including:
- Network CIDR ranges
- Container resources (CPU/memory)
- Database configuration
- Auto-scaling parameters

## State Management

Terraform state should be stored remotely in S3 with state locking via DynamoDB:

```hcl
backend "s3" {
  bucket         = "claude-pocket-console-terraform-state"
  key            = "infrastructure/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "terraform-state-lock"
  encrypt        = true
}
```

## Security Considerations

- All sensitive outputs are marked as `sensitive`
- Deletion protection enabled for production resources
- Network isolation between public and private subnets
- Encryption at rest for databases and S3 buckets
- IAM roles follow principle of least privilege

## Cost Optimization

- Use spot instances for non-critical workloads
- Auto-scaling configured to minimize idle resources
- CloudWatch log retention set appropriately
- Development environments can be destroyed when not in use

## Integration

The Terraform outputs are used by:
- GitHub Actions for CI/CD pipelines
- Docker deployment scripts
- Application configuration
- Monitoring and alerting systems

## Modules

Future modules to be implemented:
- `base/` - VPC and core networking
- `containers/` - ECS cluster and services
- `database/` - RDS configuration
- `monitoring/` - CloudWatch and alerts
- `security/` - IAM and security groups