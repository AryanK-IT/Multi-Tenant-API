output "alb_dns_name" {
  description = "Application Load Balancer DNS entry for TaskFlow API"
  value       = aws_lb.alb.dns_name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL connection endpoint"
  value       = aws_db_instance.postgres.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint address"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "ecs_service_name" {
  description = "ECS Fargate Service Name"
  value       = aws_ecs_service.api.name
}
