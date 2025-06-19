# **Contributing to Claude Pocket Console**

> Author: Gemini 2.5

Thank you for your interest in contributing\! This document outlines our development process and guidelines to help make the contribution process smooth and effective for everyone.

## **1\. Code of Conduct**

This project and everyone participating in it is governed by our [Code of Conduct](http://docs.google.com/CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## **2\. Git Workflow**

We use a main/dev branching model.

* **main:** This branch represents the latest stable, production-ready release. Direct pushes are disabled.  
* **dev:** This is the primary development branch. All feature branches are created from dev and merged back into it.  
* **Feature Branches:** All new work should be done on a feature branch.  
  * Branch names should be descriptive and prefixed with feature/, fix/, docs/, etc.  
  * Example: feature/session-reconnection-logic, fix/terminal-render-bug.

**Typical Workflow:**

1. Sync your local dev branch: git checkout dev && git pull origin dev  
2. Create your feature branch: git checkout \-b feature/my-new-feature  
3. Make your changes and commit your work.  
4. Push your branch to the remote: git push \-u origin feature/my-new-feature  
5. Open a Pull Request from your branch into dev.

## **3\. Commit Conventions**

We follow the **Conventional Commits** specification. This helps us generate automated changelogs and makes the commit history more readable.

Each commit message should consist of a **type**, a **scope** (optional), and a **subject**.

\<type\>(\<scope\>): \<subject\>

* **Types:** feat, fix, build, chore, ci, docs, perf, refactor, style, test.  
* **Example Commits:**  
  * feat(web): add theme toggle button to navbar  
  * fix(terminal-server): prevent container resource leak on disconnect  
  * docs(readme): update setup instructions  
  * refactor(shared-types): rename SessionSchema to TerminalSessionSchema

## **4\. Pull Request (PR) Process**

1. **Create your PR against the dev branch.**  
2. **Use a clear and descriptive title.** It should summarize the changes.  
3. **Fill out the PR template.** Explain the "what," "why," and "how" of your changes. Link to any relevant issues.  
4. **Keep PRs focused and small.** A good PR addresses a single issue or feature. We suggest a soft limit of **\~400 lines of code changed** (excluding generated files) to keep reviews manageable.  
5. **Ensure all CI checks are passing.** Your PR will be blocked from merging if any tests, linting, or type checks fail.  
6. **Request a review.** At least **one approval** from a core team member is required to merge.

## **5\. Coding Style & Quality**

* **Code Style:** We use Prettier for code formatting and ESLint (for TS/JS) and Ruff (for Python) for linting. These are run automatically as a pre-commit hook and in our CI pipeline. Your code must be free of linting errors to be merged.  
* **Testing:** We aim for a high level of test coverage.  
  * New features should be accompanied by unit or integration tests.  
  * Bugs fixed should include a regression test to prevent the issue from recurring.  
  * Run tests locally before pushing: pnpm turbo test.