---
name: 🐛 Bug Report
about: Report a bug or unexpected behavior
title: '[BUG] '
labels: ['bug', 'needs-triage', 'agent-ready']
assignees: ''
---

<!-- 🤖 AGENT ASSIGNMENT & COORDINATION -->
## 🤖 Agent Assignment

**Primary Agent:**
<!-- Choose based on bug location and complexity -->
- [ ] Claude Code (general debugging)
- [ ] Frontend Agent (UI/browser issues)
- [ ] Backend Agent (API/server issues)
- [ ] Infrastructure Specialist (Docker/deployment)
- [ ] Research Agent (complex investigation)
- [ ] Custom: _____________

**Agent Workspace:**
- Expected branch: `fix/<issue-number>-<bug-description>`
- Investigation scope: Component-specific or system-wide
- Debugging environment: Local, staging, or production analysis

## 🔗 Agent Coordination

**Multi-Agent Considerations:**
- [ ] Single agent fix (isolated issue)
- [ ] Cross-component bug (multiple agents)
- [ ] Requires infrastructure changes
- [ ] Needs security review

**Resource Requirements:**
- Debug environment: [ ] Local [ ] Docker [ ] Staging [ ] Production logs
- Required access: [ ] Logs [ ] Metrics [ ] Database [ ] Container shell
- Dependencies: List any services needed for reproduction

**Coordination Notes:**
<!-- How does this bug relate to other work or agents? -->
- May affect: List impacted components or ongoing work
- Requires input from: Specify if domain expertise needed
- Blocking: List any work this bug is blocking

## 🐛 Bug Description

Clear and concise description of what the bug is.

## 🔄 Steps to Reproduce

1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## ✅ Expected Behavior

What should happen?

## ❌ Actual Behavior

What actually happens?

## 🖼️ Screenshots/Logs

*If applicable, add screenshots or paste error logs*

```
Paste error logs here
```

## 🌐 Environment

**Frontend:**
- Browser: [e.g. Chrome 119, Firefox 120]
- OS: [e.g. macOS 14.1, Windows 11, Ubuntu 22.04]
- Screen size: [e.g. 1920x1080, mobile]

**Backend:**
- Docker version: [if relevant]
- Python version: [if relevant]
- Node.js version: [if relevant]

**Repository:**
- Branch: [e.g. main, feat/123-websocket]
- Commit SHA: [e.g. abc123f]
- Clean install: [ ] Yes [ ] No

## 🔍 Terminal Session Info

*If bug involves terminal functionality:*
- Container image: [e.g. cpc/sandbox:latest]
- Session ID: [if available]
- Commands run: [if relevant]

## 📊 Impact Assessment

- [ ] Blocks development work
- [ ] Affects user experience
- [ ] Security concern
- [ ] Performance issue
- [ ] Minor cosmetic issue

## 🎯 Component Affected

- [ ] Web frontend (Next.js)
- [ ] Terminal server (FastAPI)
- [ ] WebSocket connection
- [ ] Container management
- [ ] Authentication (Convex)
- [ ] Docker containers
- [ ] Build/deployment process

## 🔗 Related Issues

*Link any related issues*

- Similar to #
- Caused by #
- Blocks #

## 💡 Possible Solution

*Optional: If you have ideas for fixing the bug*

## 🧪 Testing Notes

*How to verify the fix works:*

- [ ] Test case 1
- [ ] Test case 2
- [ ] Regression testing needed

## 🤖 Agent Investigation Workflow

**Expected Debugging Flow:**
```bash
# Agent debugging pattern:
git checkout -b fix/<issue-number>-<bug-description>
# 1. Reproduce the issue
# 2. Identify root cause
# 3. Implement fix
# 4. Verify fix works
# 5. Test for regressions
```

**Agent Success Criteria:**
- [ ] Bug reproduced and understood
- [ ] Root cause identified
- [ ] Fix implemented and tested
- [ ] Regression testing completed
- [ ] Documentation updated (if needed)

---

**For Claude Agents:** Use micro-blogging to document your investigation process, findings, and solution approach. Include:
- Initial investigation steps and findings
- Root cause analysis
- Fix approach and implementation details
- Testing results and verification
- Any follow-up work needed

**Agent Micro-Blog Format:**
```
[Timestamp] [Agent-ID] [Phase]: Brief update with key findings
```