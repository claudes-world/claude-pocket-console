# **Infrastructure & Deployment**

>Author: Genini 2.5

This document outlines the infrastructure, deployment strategy, and local development environment for the Claude Pocket Console.

## **1\. Cloud Provider & Services**

* **Provider:** Google Cloud Platform (GCP)  
* **Hosting:** Google Cloud Run is used to host our containerized web and terminal-server applications, providing a serverless, scalable environment.  
* **Container Registry:** Google Artifact Registry stores our production Docker images.  
* **CI/CD:** Google Cloud Build is triggered by GitHub Actions to build and push images.  
* **Security:** Cloud Armor can be configured for DDoS protection at the load balancer level.

## **2\. Infrastructure as Code (IaC)**

We use **Terraform** to manage all cloud resources, ensuring our environments are reproducible, version-controlled, and easy to manage.

**Terraform Directory Structure (infrastructure/terraform):**

Our Terraform code is organized into reusable modules and environment-specific configurations.

terraform/  
├── environments/  
│   ├── dev/  
│   │   ├── terraform.tfvars    \# Variables for the 'dev' environment  
│   │   └── backend.tf          \# Remote state config for 'dev'  
│   └── prod/  
│       ├── terraform.tfvars    \# Variables for 'prod'  
│       └── backend.tf          \# Remote state for 'prod'  
├── modules/  
│   ├── cloud-run/              \# Reusable module for creating a Cloud Run service  
│   ├── networking/             \# VPC, subnets, firewall rules  
│   └── iam/                    \# IAM roles and service accounts  
├── main.tf                     \# Root module wiring environments to modules  
├── variables.tf  
└── outputs.tf

## **3\. CI/CD Pipeline & Deployment**

Our pipeline is defined in GitHub Actions (.github/workflows/) and is designed for safety and efficiency.

**Key Workflows:**

* **ci.yml (On Pull Request):**  
  * Runs parallel jobs for lint, type-check, and test across the Node.js and Python workspaces.  
  * Leverages Turborepo's remote cache to accelerate checks.  
  * Runs terraform plan to show the infrastructure changes for review.  
* **deploy-\*.yml (On Merge to main):**  
  * A push to the main branch triggers the deployment workflows.  
  * terraform apply is executed to provision any infrastructure changes.  
  * Cloud Build builds the production Docker images for the changed apps.  
  * The new image is pushed to Artifact Registry and a new revision is deployed to Cloud Run.  
* **Container Security Scan:**  
  * As part of the CI pipeline, we use tools like **Trivy** to scan our Docker images for known vulnerabilities before they can be deployed. A high-severity vulnerability will fail the build.

## **4\. Local Development Environment**

We use **Docker Compose** to replicate the production environment locally, ensuring consistency and minimizing "it works on my machine" issues.

To manage complexity, we use an override system:

* infrastructure/docker/compose.yml: Defines the base services.  
* infrastructure/docker/compose.dev.yml: Overrides the base configuration for development, adding hot-reloading and mounting source code volumes.

**Development Docker Compose (compose.dev.yml):**

This file enables a seamless developer experience.

\# infrastructure/docker/compose.dev.yml  
version: "3.9"

services:  
  terminal-server:  
    build:  
      context: ../../apps/terminal-server  
      dockerfile: Dockerfile.dev  
    \# Mount local source code into the container for hot-reloading  
    volumes:  
      \- ../../apps/terminal-server/src:/app/src  
      \- /var/run/docker.sock:/var/run/docker.sock  
    environment:  
      \- PYTHONUNBUFFERED=1  
      \- ENV=development  
    ports:  
      \- "8000:8000"  
    command: uvicorn src.main:app \--reload \--host 0.0.0.0

  web:  
    build:  
      context: ../../apps/web  
      dockerfile: Dockerfile.dev  
    volumes:  
      \- ../../apps/web:/app  
      \# Exclude node\_modules and .next to use the ones built inside the container  
      \- /app/node\_modules  
      \- /app/.next  
    ports:  
      \- "3000:3000"  
    command: pnpm dev

The entire local stack is launched with a single command from the root: pnpm dev.