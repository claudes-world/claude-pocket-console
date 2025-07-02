---
name: 🚀 Feature Request
about: Suggest a new feature for Claude Pocket Console
title: '[FEATURE] '
labels: ['feature', 'needs-triage', 'agent-ready']
assignees: ''
---

<!-- 🤖 AGENT ASSIGNMENT & COORDINATION -->
## 🤖 Agent Assignment

**Primary Agent:** 
<!-- Choose: claude-code, task-specialist, research-agent, infra-specialist, frontend-agent, backend-agent, or specify custom -->
- [ ] Claude Code (general development)
- [ ] Task Specialist (complex multi-step)
- [ ] Research Agent (analysis required) 
- [ ] Infrastructure Specialist (DevOps/Docker)
- [ ] Frontend Agent (UI/UX focus)
- [ ] Backend Agent (API/server focus)
- [ ] Custom: _____________

**Agent Workspace:**
- Expected branch: `feat/<issue-number>-<short-description>`
- Working directory: `/apps/web/`, `/apps/terminal-server/`, or `/`
- Development environment: Local, Docker, or Cloud

## 🔗 Agent Coordination

**Multi-Agent Considerations:**
- [ ] Single agent task (no coordination needed)
- [ ] Requires coordination with other agents
- [ ] Sequential work (depends on other tasks)
- [ ] Parallel work (can work alongside others)

**Resource Requirements:**
- Ports needed: `3000` (web), `8000` (terminal), `5432` (db), Other: ________
- Docker containers: [ ] Web [ ] Terminal [ ] Database [ ] Custom: ________
- External services: [ ] Convex [ ] GitHub API [ ] Docker Registry [ ] Other: ________

**Coordination Notes:**
<!-- How does this work relate to other agents or ongoing development? -->
- Related agent work: #issue-numbers
- Shared resources: Specify any shared code, configs, or infrastructure
- Handoff points: When/where work transitions between agents

## 🎯 Problem Statement

What problem does this feature solve? Describe the current limitation or gap.

## 💡 Proposed Solution

Describe your proposed solution in detail. How should this feature work?

## 🏗️ Implementation Approach

*Optional: If you have ideas about implementation*

- [ ] Frontend changes needed
- [ ] Backend API changes needed  
- [ ] Database schema changes needed
- [ ] Infrastructure changes needed
- [ ] Security considerations

## ✅ Acceptance Criteria

Define what "done" looks like:

- [ ] Criteria 1
- [ ] Criteria 2
- [ ] Criteria 3
- [ ] Unit tests implemented
- [ ] Integration tests pass
- [ ] Documentation updated

## 🔗 Related Issues

*Link any related issues or epics*

- Related to #
- Depends on #
- Blocks #

## 📱 User Experience

*How will users interact with this feature?*

## 🧪 Testing Strategy

*How should this feature be tested?*

- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual testing scenarios
- [ ] Performance testing
- [ ] Security testing

## 📚 Additional Context

*Screenshots, mockups, examples, or other helpful context*

## 🌍 Claude's World Context

*How does this feature contribute to the broader autonomous AI goals?*

## 🤖 Agent Workspace Setup

**Expected Development Flow:**
```bash
# Agent should follow this pattern:
git checkout -b feat/<issue-number>-<short-description>
cd /path/to/relevant/workspace  # specify above
# Begin implementation
```

**Agent Success Criteria:**
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Code reviewed (self or peer)
- [ ] Ready for integration

---

**For Claude Agents:** Remember to use micro-blogging in this issue to document your thought process, decisions, and discoveries. Include:
- Initial analysis and approach
- Implementation decisions and trade-offs
- Testing results and findings
- Integration considerations
- Final status and next steps

**Agent Micro-Blog Format:** 
```
[Timestamp] [Agent-ID] [Status/Phase]: Brief update (1-4 sentences)
```