# Claude Pocket Console Infrastructure Outputs
# This file defines all output values from the Terraform configuration

# Network Outputs
output "vpc_id" {
  description = "ID of the created VPC"
  value       = "" # TODO: module.base_infrastructure.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = [] # TODO: module.base_infrastructure.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = [] # TODO: module.base_infrastructure.private_subnet_ids
}

# Container Registry Outputs
output "ecr_repository_url" {
  description = "URL of the ECR repository for Docker images"
  value       = "" # TODO: aws_ecr_repository.sandbox_images.repository_url
}

output "ecr_repository_arn" {
  description = "ARN of the ECR repository"
  value       = "" # TODO: aws_ecr_repository.sandbox_images.arn
}

# Load Balancer Outputs
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = "" # TODO: aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  value       = "" # TODO: aws_lb.main.zone_id
}

# Database Outputs
output "database_endpoint" {
  description = "Endpoint of the RDS database"
  value       = "" # TODO: aws_db_instance.main.endpoint
  sensitive   = true
}

output "database_port" {
  description = "Port of the RDS database"
  value       = 0 # TODO: aws_db_instance.main.port
}

# Container Service Outputs
output "ecs_cluster_id" {
  description = "ID of the ECS cluster"
  value       = "" # TODO: aws_ecs_cluster.main.id
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = "" # TODO: aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = "" # TODO: aws_ecs_service.sandbox.name
}

# S3 Bucket Outputs
output "logs_bucket_name" {
  description = "Name of the S3 bucket for logs"
  value       = "" # TODO: aws_s3_bucket.logs.id
}

output "logs_bucket_arn" {
  description = "ARN of the S3 bucket for logs"
  value       = "" # TODO: aws_s3_bucket.logs.arn
}

# IAM Outputs
output "task_execution_role_arn" {
  description = "ARN of the ECS task execution role"
  value       = "" # TODO: aws_iam_role.ecs_task_execution.arn
}

output "task_role_arn" {
  description = "ARN of the ECS task role"
  value       = "" # TODO: aws_iam_role.ecs_task.arn
}

# Security Group Outputs
output "alb_security_group_id" {
  description = "ID of the ALB security group"
  value       = "" # TODO: aws_security_group.alb.id
}

output "container_security_group_id" {
  description = "ID of the container security group"
  value       = "" # TODO: aws_security_group.containers.id
}

# CloudWatch Outputs
output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = "" # TODO: aws_cloudwatch_log_group.main.name
}

output "log_group_arn" {
  description = "ARN of the CloudWatch log group"
  value       = "" # TODO: aws_cloudwatch_log_group.main.arn
}

# DNS Outputs
output "route53_zone_id" {
  description = "ID of the Route53 hosted zone"
  value       = "" # TODO: aws_route53_zone.main.zone_id
}

output "domain_name" {
  description = "Domain name for the application"
  value       = "" # TODO: var.domain_name
}

# Auto-scaling Outputs
output "auto_scaling_group_name" {
  description = "Name of the auto-scaling group"
  value       = "" # TODO: aws_autoscaling_group.containers.name
}

# Monitoring Outputs
output "cloudwatch_dashboard_url" {
  description = "URL to the CloudWatch dashboard"
  value       = "" # TODO: "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

# Cost Estimation Outputs
output "estimated_monthly_cost" {
  description = "Estimated monthly cost (USD) based on current configuration"
  value       = "0.00" # TODO: Calculate based on resources
}

# Environment Information
output "environment" {
  description = "Current environment"
  value       = "" # TODO: var.environment
}

output "deployment_timestamp" {
  description = "Timestamp of the last deployment"
  value       = "" # TODO: timestamp()
}