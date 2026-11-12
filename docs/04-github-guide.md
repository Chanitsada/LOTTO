# 04 - GitHub team workflow

Use our existing [LOTTO repository](https://github.com/Chanitsada/LOTTO). Accept the
private-repository invitation with the invited GitHub account. A link alone does
not grant access. Use a terminal or the VS Code terminal for these commands.

## Main branch rules

Use a separate branch for each task. Open a PR targeting main and request my
review (@Chanitsada). **I am the only approver for teammates' frontend/backend
PRs into main.** Teammates can test/comment; their approvals do not replace mine.
I review and merge approved work. Avoid direct pushes/bypasses.

Repository settings can enforce PR/reviewer requirements only where the GitHub
plan supports them. This guide does not assert those settings are enabled. The
team approval rule applies independently of the settings. My own PRs cannot
receive my self-approval; I check them and make the final merge decision.

## Clone once

Open a terminal in the parent folder:

```bash
git clone https://github.com/Chanitsada/LOTTO.git
cd LOTTO
git config user.name "FULL_NAME"
git config user.email "GITHUB_EMAIL"
```

Replace the identity placeholders with the commit author's details. These do
not sign in to GitHub. Skip cloning if the local LOTTO folder already exists.
Cloning does not copy another teammate's .env or MySQL database; use the
[local setup](../README.md#local-setup).

## Start a task

From LOTTO, with no unfinished work on another branch:

```bash
git status
git switch main
git pull --ff-only origin main
git switch -c feature/login
```

`switch -c` creates/opens a branch. Replace feature/login with the task name,
such as feature/checkout or fix/ticket-display. If status shows unfinished work,
commit it on its own branch or ask for help before switching; do not discard it.

## Edit, check and commit

Save the intended files and run relevant checks. Inspect tracked differences
and open new/untracked files too:

```bash
git status
git diff
git add backend/controllers/auth-controller.js
git diff --cached
git commit -m "Implement customer login"
```

Replace the example file/message with the actual task. `git add` stages files;
`git diff --cached` shows the staged content; `commit` saves a local checkpoint.
To stage all intended non-ignored files, `git add .` is available after reviewing
status. To unstage an accidental file without deleting edits, use
`git restore --staged PATH_TO_FILE` with the real path.

## Push and open a PR

```bash
git push -u origin feature/login
```

Use the same branch name. The push uploads commits and sets the remote tracking
branch; later pushes can use `git push`. It does not merge into main.

1. Open LOTTO on GitHub → Pull requests → New pull request.
2. Set base main and compare to the feature branch.
3. Describe the feature, checks and any unfinished behavior.
4. Inspect Files changed and request my review (@Chanitsada).
5. Use a draft PR while work is unfinished.

For requested fixes, stay on that branch, edit/check, commit and push. The same
PR receives the commits automatically. Wait for my review of the final changes.

## After merging

With a clean working folder:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/next-task
```

Use an actual task name. Pulling SQL files does not execute them against MySQL.
Follow the database guide for compatible updates; schema.sql is a full reset.

If main changes during a task, commit feature work first, then on that feature
branch run:

```bash
git fetch origin
git merge origin/main
```

Resolve conflicts with the relevant teammate, check the result, commit if needed
and push. Do not force/discard changes to avoid a conflict.

## Files to exclude

Keep .env, passwords, API keys, private secrets, node_modules and generated dist
out of commits. Share placeholders with .env.example and exact dependency
versions with package-lock.json. Discuss API/schema/shared-file changes before
editing the same area. Small related commits make reviews easier.
