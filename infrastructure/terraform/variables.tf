# Claude Pocket Console Infrastructure Variables
# This file defines all input variables for the Terraform configuration

# General Configuration
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "claude-pocket-console"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

# AWS Configuration
variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "List of availability zones to use"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# Network Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

# Container Configuration
variable "container_cpu" {
  description = "CPU units for sandbox containers"
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Memory (MB) for sandbox containers"
  type        = number
  default     = 512
}

variable "max_containers_per_user" {
  description = "Maximum number of concurrent containers per user"
  type        = number
  default     = 3
}

# Database Configuration
variable "database_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "database_allocated_storage" {
  description = "Allocated storage in GB for database"
  type        = number
  default     = 20
}

# Security Configuration
variable "allowed_ip_ranges" {
  description = "IP ranges allowed to access the application"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for critical resources"
  type        = bool
  default     = true
}

# Docker Configuration
variable "docker_host" {
  description = "Docker daemon host"
  type        = string
  default     = "unix:///var/run/docker.sock"
}

variable "docker_registry_url" {
  description = "URL for Docker registry"
  type        = string
  default     = ""
}

# Monitoring Configuration
variable "enable_detailed_monitoring" {
  description = "Enable detailed CloudWatch monitoring"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Number of days to retain logs"
  type        = number
  default     = 7
}

# Auto-scaling Configuration
variable "min_container_count" {
  description = "Minimum number of container instances"
  type        = number
  default     = 1
}

variable "max_container_count" {
  description = "Maximum number of container instances"
  type        = number
  default     = 10
}

# Cost Management
variable "enable_spot_instances" {
  description = "Use spot instances for cost savings"
  type        = bool
  default     = false
}

# Tags
variable "additional_tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}