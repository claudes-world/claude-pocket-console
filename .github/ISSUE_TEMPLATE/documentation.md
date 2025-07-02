---
name: 📚 Documentation
about: Documentation improvements, updates, or new content
title: '[DOCS] '
labels: ['documentation', 'content', 'agent-ready']
assignees: ''
---

<!-- 🤖 AGENT ASSIGNMENT & COORDINATION -->
## 🤖 Agent Assignment

**Primary Agent:**
<!-- Documentation work can be done by various agent types -->
- [ ] Claude Code (general documentation)
- [ ] Documentation Specialist (complex/extensive docs)
- [ ] Domain Expert (technical/specialized content)
- [ ] Research Agent (research-backed documentation)
- [ ] Custom: _____________

**Agent Workspace:**
- Documentation branch: `docs/<issue-number>-<doc-type>`
- Content location: `/docs/`, `/README.md`, `.taskmaster/docs/`
- Format: Markdown, code comments, or external platform

## 🔗 Agent Coordination

**Multi-Agent Considerations:**
- [ ] Solo documentation work
- [ ] Requires input from development agents
- [ ] Cross-references other documentation
- [ ] Needs technical review from specialists

**Resource Requirements:**
- Content sources: [ ] Codebase [ ] Existing docs [ ] Subject matter experts
- Validation needs: [ ] Technical accuracy [ ] User testing [ ] Link verification
- Publication: [ ] GitHub [ ] Wiki [ ] Documentation site [ ] In-code

**Coordination Notes:**
<!-- How does this documentation work relate to other agents? -->
- Input needed from: Specify agents with domain knowledge
- Affects: List agents that will reference this documentation
- Dependencies: Other documentation that must be updated together

## 📝 Documentation Goal

What documentation needs to be created, updated, or improved?

## 📚 Documentation Type

- [ ] API documentation
- [ ] User guide/tutorial
- [ ] Developer setup guide
- [ ] Architecture documentation
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Code comments
- [ ] README updates
- [ ] CHANGELOG updates
- [ ] Security documentation

## 🎯 Target Audience

Who is this documentation for?

- [ ] End users
- [ ] Developers (new to project)
- [ ] DevOps/Infrastructure team
- [ ] Claude AI agents
- [ ] Future maintainers
- [ ] External contributors
- [ ] Security auditors

## 📋 Current State

Describe the current state of this documentation:

- [ ] Documentation doesn't exist
- [ ] Documentation is outdated
- [ ] Documentation is incomplete
- [ ] Documentation is hard to find
- [ ] Documentation is unclear

## 💡 Proposed Content

What should the documentation include?

### Sections/Topics
- [ ] Section 1: [Description]
- [ ] Section 2: [Description]
- [ ] Section 3: [Description]

### Content Format
- [ ] Written guide
- [ ] Code examples
- [ ] Screenshots/diagrams
- [ ] Video tutorial
- [ ] Interactive examples
- [ ] FAQ section

## ✅ Acceptance Criteria

Define what "done" looks like:

- [ ] Content written and reviewed
- [ ] Examples tested and working
- [ ] Screenshots/diagrams current
- [ ] Links verified
- [ ] Content accessible
- [ ] Feedback incorporated
- [ ] Style guide followed

## 📍 Documentation Location

Where should this documentation live?

- [ ] README.md
- [ ] docs/ directory
- [ ] GitHub Wiki
- [ ] External documentation site
- [ ] Code comments
- [ ] API schema files
- [ ] Architecture diagrams

## 🔗 Related Documentation

Link to related or dependent documentation:

- Updates #
- Related to #
- Depends on #

## 📊 Success Metrics

How will we measure documentation success?

- [ ] Reduces support questions
- [ ] Improves onboarding time
- [ ] Gets positive feedback
- [ ] Reduces setup errors
- [ ] Enables self-service

## 🧪 Validation Plan

How will you ensure documentation quality?

- [ ] Technical review
- [ ] Fresh eyes review (someone unfamiliar)
- [ ] Test instructions on clean environment
- [ ] Proofread for clarity
- [ ] Check all links work
- [ ] Verify screenshots are current

## 🌍 Claude's World Context

*How does this documentation support autonomous AI development?*

## 📋 Content Outline

*Optional: Rough outline of the content structure*

1. Introduction
2. Prerequisites
3. Main content sections
4. Examples
5. Troubleshooting
6. Next steps

## 🎨 Style Requirements

- [ ] Follow project style guide
- [ ] Include code examples
- [ ] Use clear headings
- [ ] Add table of contents (if long)
- [ ] Include troubleshooting section
- [ ] Add related links

## 🤖 Agent Documentation Workflow

**Expected Documentation Process:**
```bash
# Agent documentation pattern:
git checkout -b docs/<issue-number>-<doc-type>
# 1. Analyze existing documentation
# 2. Identify gaps and requirements
# 3. Create/update content
# 4. Validate accuracy and usability
# 5. Link to related documentation
```

**Agent Success Criteria:**
- [ ] Content created/updated
- [ ] Technical accuracy verified
- [ ] Examples tested and working
- [ ] Links and references validated
- [ ] Style and format consistent
- [ ] Accessible to target audience

**Documentation Quality Checks:**
- [ ] Fresh eyes review (unfamiliar reader)
- [ ] Technical accuracy review
- [ ] Link and example verification
- [ ] Agent-readable format (for AI consumption)
- [ ] Human-readable format (for developers)

---

**For Claude Agents:** Use micro-blogging to share your documentation approach, decisions about content structure, and any challenges you encounter. Include:
- Content analysis and gaps identified
- Structure and organization decisions
- Writing approach and style choices
- Validation process and results
- Accessibility considerations for both AI agents and humans

**Agent Micro-Blog Format:**
```
[Timestamp] [Agent-ID] [Doc-Phase]: Documentation insight or decision
```

Document what works well for AI agent consumption vs. human readers - this helps future agents understand how to create documentation that serves both audiences effectively.