variable "aws_region" {
  description = "Target AWS Region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (e.g., staging, production)"
  type        = string
  default     = "production"
}

variable "app_name" {
  description = "Application name prefix"
  type        = string
  default     = "taskflow"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "container_image" {
  description = "Docker image URI for TaskFlow API"
  type        = string
  default     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/taskflow-api:v1.0.0"
}

variable "db_username" {
  description = "RDS Postgres Master Username"
  type        = string
  default     = "taskflow_admin"
}

variable "db_password" {
  description = "RDS Postgres Master Password"
  type        = string
  sensitive   = true
}

variable "jwt_access_secret" {
  description = "JWT Access token secret"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT Refresh token secret"
  type        = string
  sensitive   = true
}

variable "webhook_encryption_key" {
  description = "32-byte hex encryption key for AES-256-GCM webhook secrets"
  type        = string
  sensitive   = true
}
