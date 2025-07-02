---
name: 🏗️ Infrastructure & DevOps
about: Infrastructure, deployment, tooling, and DevOps improvements
title: '[INFRA] '
labels: ['infrastructure', 'devops', 'needs-triage', 'agent-ready']
assignees: ''
---

<!-- 🤖 AGENT ASSIGNMENT & COORDINATION -->
## 🤖 Agent Assignment

**Primary Agent:**
<!-- Infrastructure work typically requires specialized agents -->
- [ ] Infrastructure Specialist (recommended for DevOps)
- [ ] Claude Code (simple infrastructure changes)
- [ ] Security Agent (security-focused changes)
- [ ] Performance Agent (optimization focus)
- [ ] Custom: _____________

**Agent Workspace:**
- Infrastructure branch: `infra/<issue-number>-<change-type>`
- Config location: `/.github/`, `/docker/`, `/terraform/`, `/k8s/`
- Access requirements: Docker, cloud resources, CI/CD systems

## 🔗 Agent Coordination

**Multi-Agent Considerations:**
- [ ] Isolated infrastructure change
- [ ] Affects multiple development agents
- [ ] Requires coordination with deployment
- [ ] Impacts security or compliance

**Resource Requirements:**
- Infrastructure access: [ ] Docker [ ] GCP [ ] GitHub Actions [ ] Monitoring
- Service dependencies: [ ] Database [ ] External APIs [ ] Storage [ ] Network
- Deployment coordination: [ ] Zero-downtime [ ] Maintenance window [ ] Rollback ready

**Coordination Notes:**
<!-- How does this infrastructure change affect other agents? -->
- Affects agents: List agents that depend on this infrastructure
- Deployment timing: Coordinate with ongoing development work
- Communication: Notify relevant agents of changes

## 🎯 Infrastructure Goal

What infrastructure improvement or change is needed?

## 🏗️ Infrastructure Type

- [ ] CI/CD pipeline
- [ ] Container/Docker changes
- [ ] Deployment configuration
- [ ] Monitoring/logging
- [ ] Security hardening
- [ ] Performance optimization
- [ ] Backup/recovery
- [ ] Scaling/load balancing
- [ ] Development tooling
- [ ] Build process improvements

## 🌐 Environment Scope

Which environments are affected?

- [ ] Local development
- [ ] Testing/staging
- [ ] Production
- [ ] All environments

## 📋 Current State

Describe the current infrastructure setup and limitations:

## 💡 Proposed Changes

Detail the proposed infrastructure changes:

### Components Affected
- [ ] Docker containers
- [ ] Terraform configurations
- [ ] GitHub Actions workflows
- [ ] Kubernetes manifests
- [ ] Convex deployment
- [ ] GCP resources
- [ ] Monitoring tools
- [ ] Security policies

### Configuration Changes
```yaml
# Include relevant config snippets
```

## ✅ Acceptance Criteria

Define what "done" looks like:

- [ ] Infrastructure change implemented
- [ ] Configuration updated
- [ ] Documentation updated
- [ ] Deployment tested
- [ ] Rollback plan ready
- [ ] Monitoring configured
- [ ] Security review passed

## 🔒 Security Considerations

*Any security implications or requirements?*

- [ ] Security assessment completed
- [ ] Access controls reviewed
- [ ] Secrets management updated
- [ ] Network security evaluated
- [ ] Compliance requirements met

## 📊 Performance Impact

*Expected performance changes*

- [ ] Performance baseline established
- [ ] Expected improvements quantified
- [ ] Performance testing plan ready

## 🧪 Testing Strategy

How will this infrastructure change be tested?

- [ ] Local testing
- [ ] Staging deployment
- [ ] Gradual rollout
- [ ] A/B testing
- [ ] Load testing
- [ ] Disaster recovery testing

## 📈 Monitoring & Observability

What monitoring is needed?

- [ ] Metrics collection
- [ ] Alerting rules
- [ ] Dashboard updates
- [ ] Log aggregation
- [ ] Health checks

## 🔄 Rollback Plan

*How to revert if things go wrong*

1. Step 1
2. Step 2
3. Step 3

## 📚 Documentation Updates

What documentation needs to be updated?

- [ ] Deployment guide
- [ ] Architecture documentation
- [ ] Runbooks/playbooks
- [ ] Developer setup guide
- [ ] Troubleshooting guide

## 💰 Cost Implications

*Any cost changes expected?*

## 🔗 Related Issues

- Depends on #
- Related to #
- Blocks #

## 🌍 Claude's World Context

*How does this infrastructure improvement support autonomous AI operations?*

## 🤖 Agent Infrastructure Workflow

**Expected Infrastructure Process:**
```bash
# Agent infrastructure pattern:
git checkout -b infra/<issue-number>-<change-type>
# 1. Assess current infrastructure
# 2. Plan changes with minimal disruption
# 3. Implement with proper testing
# 4. Deploy with monitoring
# 5. Verify and document
```

**Agent Success Criteria:**
- [ ] Infrastructure change implemented
- [ ] Testing completed (staging/production)
- [ ] Monitoring and alerting configured
- [ ] Documentation updated
- [ ] Rollback plan verified
- [ ] Other agents notified of changes

**Infrastructure Handoff:**
- [ ] Configuration changes documented
- [ ] Access/permissions updated
- [ ] Monitoring baselines established
- [ ] Team knowledge transfer completed

---

**For Claude Agents:** Document your infrastructure decisions, trade-offs, and lessons learned through micro-blogging. Include:
- Current state analysis and limitations
- Proposed changes and alternatives considered
- Implementation approach and reasoning
- Testing results and validation
- Deployment process and outcomes
- Impact on other agents and services

**Agent Micro-Blog Format:**
```
[Timestamp] [Agent-ID] [Infra-Phase]: Infrastructure update with rationale
```

Include details about why certain approaches were chosen over alternatives, especially for future infrastructure decisions.