---
name: 🔬 Research Task
about: Investigation, analysis, or exploration work
title: '[RESEARCH] '
labels: ['research', 'investigation', 'agent-ready']
assignees: ''
---

<!-- 🤖 AGENT ASSIGNMENT & COORDINATION -->
## 🤖 Agent Assignment

**Primary Agent:**
<!-- Research tasks typically suit specific agent types -->
- [ ] Research Agent (primary choice for analysis)
- [ ] Claude Code (quick technical research)
- [ ] Task Specialist (complex multi-phase research)
- [ ] Domain Specialist: _____________ (specify expertise area)
- [ ] Custom: _____________

**Agent Workspace:**
- Research branch: `research/<issue-number>-<topic>`
- Documentation location: `.taskmaster/docs/research/`
- Deliverable format: Markdown, presentation, code examples

## 🔗 Agent Coordination

**Multi-Agent Considerations:**
- [ ] Solo research (independent investigation)
- [ ] Collaborative research (multiple perspectives)
- [ ] Sequential research (builds on other findings)
- [ ] Feeds into development work (specify agents)

**Resource Requirements:**
- Research tools: [ ] Web search [ ] Code analysis [ ] External APIs [ ] Documentation
- Data access: [ ] Codebase [ ] Logs [ ] Metrics [ ] External resources
- Collaboration: [ ] Expert consultation [ ] Stakeholder input [ ] Peer review

**Coordination Notes:**
<!-- How does this research relate to other work? -->
- Informs: List tasks/agents that will use these findings
- Depends on: List prerequisite research or data
- Timeline alignment: How this fits with other agent work

## 🎯 Research Question

What are we trying to learn, investigate, or explore?

## 🌍 Context & Motivation

Why is this research needed? What problem are we trying to solve or understand?

## 🔍 Research Scope

Define the boundaries of this investigation:

- [ ] Technical feasibility study
- [ ] Performance analysis
- [ ] Security assessment
- [ ] Architecture exploration
- [ ] Technology comparison
- [ ] User behavior analysis
- [ ] Market research
- [ ] Literature review

## 📋 Research Plan

*How will you approach this investigation?*

### Phase 1: Initial Investigation
- [ ] Research task 1
- [ ] Research task 2
- [ ] Research task 3

### Phase 2: Deep Dive
- [ ] Analysis task 1
- [ ] Analysis task 2
- [ ] Analysis task 3

### Phase 3: Synthesis
- [ ] Document findings
- [ ] Create recommendations
- [ ] Prepare presentation/summary

## ✅ Success Criteria

How will we know this research is complete and valuable?

- [ ] Research question answered
- [ ] Key findings documented
- [ ] Recommendations provided
- [ ] Decision support ready
- [ ] Implementation plan (if applicable)

## 📊 Expected Deliverables

What outputs should this research produce?

- [ ] Research notes and findings
- [ ] Summary document
- [ ] Recommendations report
- [ ] Technical specifications (if applicable)
- [ ] Implementation roadmap (if applicable)
- [ ] Presentation materials
- [ ] Updated documentation

## 🔗 Related Work

*Link related issues, previous research, or external resources*

- Builds on #
- Related to #
- External resource: [link]

## ⏰ Timeline

*Optional: Research milestones and timeline*

- [ ] Week 1: Initial investigation
- [ ] Week 2: Deep analysis
- [ ] Week 3: Documentation and recommendations

## 🧠 Research Areas

*Specific topics or technologies to investigate*

- [ ] Topic 1
- [ ] Topic 2
- [ ] Topic 3

## 📚 Resources & References

*Known resources to investigate*

- Documentation: [links]
- Papers/articles: [links]
- Tools/platforms: [links]
- People to consult: [names/roles]

## 🎪 Claude's World Implications

*How might this research impact the autonomous AI project goals?*

## 💡 Initial Hypotheses

*Optional: What do you expect to find?*

1. Hypothesis 1
2. Hypothesis 2
3. Hypothesis 3

## 🤖 Agent Research Workflow

**Expected Research Process:**
```bash
# Agent research pattern:
git checkout -b research/<issue-number>-<topic>
mkdir -p .taskmaster/docs/research/
# 1. Define research questions
# 2. Gather information
# 3. Analyze findings
# 4. Document insights
# 5. Provide recommendations
```

**Agent Success Criteria:**
- [ ] Research questions answered
- [ ] Key findings documented
- [ ] Recommendations provided
- [ ] Next steps identified
- [ ] Knowledge transferred to relevant agents

**Research Deliverables:**
- [ ] Research notes in `.taskmaster/docs/research/`
- [ ] Summary report with key findings
- [ ] Recommendations for action
- [ ] Updated documentation (if applicable)

---

**Research Micro-blogging:** Use this issue to document your research journey, discoveries, insights, dead ends, and "aha!" moments. Include:
- Research methodology and approach
- Key discoveries and insights
- Dead ends and why they didn't work
- Connections to other project areas
- Final recommendations and next steps

**Agent Micro-Blog Format:**
```
[Timestamp] [Agent-ID] [Research-Phase]: Discovery or insight (1-4 sentences)
```

Future historians (and agents) will want to understand not just what you found, but how you found it and what you learned along the way.