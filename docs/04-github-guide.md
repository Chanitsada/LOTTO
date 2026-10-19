# GitHub Team Workflow for LOTTO

Use this guide to download the project, work on a task and submit changes for review.
Run commands in a terminal or the VS Code terminal. These are instructions, not
commands that have already been run.

## 1. Repository access

- Use our existing [LOTTO repository](https://github.com/Chanitsada/LOTTO).
- Accept the collaborator invitation before cloning or pushing to the private repository.
- Use the GitHub account that received the invitation; sharing the link alone does not grant access.
- Install Git and sign in to GitHub when the editor or Git authentication flow requests it.
- Skip cloning if a local LOTTO copy already exists; use that folder instead.

## 2. Main branch rules

- Work on a feature branch, not directly on main.
- Open a pull request targeting main when the task is ready.
- Request my review (@Chanitsada). **Only my approval counts for the team workflow.**
- Wait for my review and fix any requested changes. I approve and merge finished PRs.
- Require PRs, approving reviews and my Code Owner review where the repository's
  GitHub plan supports them. Other reviews do not replace mine.
- Do not bypass the rules or push directly to main. Protection settings are not
  confirmed as enabled just because they are described here.

## 3. Team workflow

1. Clone the repository once and open the LOTTO folder.
2. Update local main before starting each task, then create a feature branch.
3. Edit files and check that the changes work.
4. Stage the intended files, commit them and push the feature branch.
5. Open a PR with base main and request my review.
6. Push any requested fixes to the same branch. After I approve and merge, update
   local main before starting the next task.

## 4. Step-by-step commands

### A. Clone the project once

Open a terminal in the parent folder where the project should be saved:

```bash
git clone https://github.com/Chanitsada/LOTTO.git
cd LOTTO
```

Clone downloads the repository and creates a local LOTTO folder. Open that folder
in the editor. Do not run clone inside an existing LOTTO folder.

Set the commit author identity for this repository:

```bash
git config user.name "FULL_NAME"
git config user.email "GITHUB_EMAIL"
```

Replace FULL_NAME and GITHUB_EMAIL with the author's name and GitHub-associated
email. These identify commits; they do not sign in to GitHub or grant repository access.

### B. Update main and start a branch

From the LOTTO folder:

```bash
git status
git switch main
git pull --ff-only origin main
git switch -c feature/login
```

Check for unfinished work with git status before switching branches. Save and commit
that work on its feature branch first, or stop and ask for help; do not discard it.
The pull command downloads the latest main. The switch -c command creates and
opens a new branch. Replace feature/login with the actual task name, for example
feature/draws, feature/checkout or fix/ticket-display.

### C. Make and check changes

Edit the files needed for the task, save them and run the relevant checks. Inspect
what changed before committing:

```bash
git status
git diff
```

Status lists changed files; diff shows edits to tracked files that are not yet staged.
Open new/untracked files in the editor too, since git diff does not show their contents.

### D. Stage and commit

```bash
git add .
git diff --cached
git commit -m "Implement customer login"
```

Git add prepares files for the next commit. Inspect git diff --cached before
committing: git add . stages all non-ignored changes in the current folder tree,
including unrelated files. Stage individual paths instead when needed. If an
unintended file was staged, use git restore --staged PATH_TO_FILE; this keeps its
local edits. Replace the placeholder with the actual file path.

A commit saves a local checkpoint. Use a message describing the actual change,
such as Add draw availability API or Fix closed-draw purchase check. A commit does
not upload anything to GitHub.

### E. Push the feature branch

```bash
git push -u origin feature/login
```

Use the same branch name created in step B. This uploads the commits and connects
that local branch to its remote branch. Later commits on this branch can use
`git push` without repeating -u. Pushing the branch does not merge it into main.

### F. Open a pull request on GitHub

1. Open [LOTTO on GitHub](https://github.com/Chanitsada/LOTTO).
2. Select Compare & pull request, or Pull requests → New pull request.
3. Set **base: main** and **compare: feature/login** (or the actual task branch).
4. Add a clear title and a short description: what changed, what was checked and
   anything unfinished.
5. Inspect Files changed for unrelated files or secrets.
6. Create the PR and request my review (@Chanitsada). Use a draft if work is unfinished.

### G. Make fixes on the same PR

Stay on the same feature branch, edit/check the requested fixes, then commit and push:

```bash
git add .
git diff --cached
git commit -m "Fix login review comments"
git push
```

The existing PR updates automatically. Do not create a second PR for fixes to the
same task. Wait for my review of the latest changes; new commits may require approval again.

### H. Continue after the PR is merged

With no uncommitted work, update local main:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/next-task
```

Replace feature/next-task with the next task name. Start from updated main rather
than reusing the old merged branch. Pulling code does not apply SQL changes to a
local database; follow the relevant SQL/setup instructions if those files changed.

### If main changes before the task is finished

Commit the current feature work first, then bring updated main into that branch:

```bash
git fetch origin
git merge origin/main
```

Run these while on the feature branch. Resolve any conflicts, check the combined
result, commit the resolution if needed and push. If the conflict is unclear,
discuss it with the relevant teammate and me instead of forcing or discarding changes.

## 5. Important rules

- Never commit .env, database passwords, API keys, private draw secrets or node_modules.
- Share placeholder settings through .env.example; keep actual credentials local.
- Use one feature branch per task and discuss shared API/database changes together.
- Commit small, related changes and check them before requesting review.
- Keep main stable: no unfinished direct pushes or unapproved merges.
- Request my approval for frontend and backend PRs; teammates may help test and comment.
- Check GitHub-plan support for protection on private repositories. If unavailable,
  follow the approval rule as a team agreement; GitHub cannot enforce it on that plan.
