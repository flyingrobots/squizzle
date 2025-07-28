#!/bin/bash

# This script automates the creation of a sequence of Git commits
# based on the provided diff breakdown.
#
# IMPORTANT:
# - Run this script from the root of your Git repository.
# - Review each command carefully before executing.
# - Ensure your working directory is clean before starting (e.g., `git status`).
# - This script assumes you have the original files from the diff.

echo "Starting Git commit automation..."
echo "---------------------------------"

# Commit 1: chore: clean up Obsidian files and update gitignore
echo "Applying commit 1/22: chore: clean up Obsidian files and update gitignore"
git rm .obsidian/app.json .obsidian/appearance.json .obsidian/core-plugins.json .obsidian/workspace.json
git add .gitignore
git commit -m "chore: clean up Obsidian files and update gitignore"
echo "---------------------------------"

# Commit 2: docs: add CONTRIBUTING.md with contribution guidelines
echo "Applying commit 2/22: docs: add CONTRIBUTING.md with contribution guidelines"
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md with contribution guidelines"
echo "---------------------------------"

# Commit 3: docs: add documentation update summary
echo "Applying commit 3/22: docs: add documentation update summary"
git add docs/DOCUMENTATION_UPDATE_SUMMARY.md
git commit -m "docs: add documentation update summary"
echo "---------------------------------"

# Commit 4: docs: add immutable artifacts concept documentation
echo "Applying commit 4/22: docs: add immutable artifacts concept documentation"
git add docs/concepts/immutable-artifacts.md
git commit -m "docs: add immutable artifacts concept documentation"
echo "---------------------------------"

# Commit 5: docs: add security model concept documentation
echo "Applying commit 5/22: docs: add security model concept documentation"
git add docs/concepts/security.md
git commit -m "docs: add security model concept documentation"
echo "---------------------------------"

# Commit 6: docs: add storage backends concept documentation
echo "Applying commit 6/22: docs: add storage backends concept documentation"
git add docs/concepts/storage.md
git commit -m "docs: add storage backends concept documentation"
echo "---------------------------------"

# Commit 7: docs: add CI/CD integration guide
echo "Applying commit 7/22: docs: add CI/CD integration guide"
git add docs/guides/cicd.md
git commit -m "docs: add CI/CD integration guide"
echo "---------------------------------"

# Commit 8: docs: add multi-environment setup guide
echo "Applying commit 8/22: docs: add multi-environment setup guide"
git add docs/guides/environments.md
git commit -m "docs: add multi-environment setup guide"
echo "---------------------------------"

# Commit 9: docs: add rollback strategies guide
echo "Applying commit 9/22: docs: add rollback strategies guide"
git add docs/guides/rollbacks.md
git commit -m "docs: add rollback strategies guide"
echo "---------------------------------"

# Commit 10: docs: add disaster recovery guide
echo "Applying commit 10/22: docs: add disaster recovery guide"
git add docs/guides/disaster-recovery.md
git commit -m "docs: add disaster recovery guide"
echo "---------------------------------"

# Commit 11: docs: add installation guide
echo "Applying commit 11/22: docs: add installation guide"
git add docs/installation.md
git commit -m "docs: add installation guide"
echo "---------------------------------"

# Commit 12: docs: add API reference
echo "Applying commit 12/22: docs: add API reference"
git add docs/reference/api.md
git commit -m "docs: add API reference"
echo "---------------------------------"

# Commit 13: docs: add CLI reference
echo "Applying commit 13/22: docs: add CLI reference"
git add docs/reference/cli.md
git commit -m "docs: add CLI reference"
echo "---------------------------------"

# Commit 14: docs: add configuration schema reference
echo "Applying commit 14/22: docs: add configuration schema reference"
git add docs/reference/config.md
git commit -m "docs: add configuration schema reference"
echo "---------------------------------"

# Commit 15: feat: add basic SQL migration example
echo "Applying commit 15/22: feat: add basic SQL migration example"
git add examples/basic-migration/README.md
git commit -m "feat: add basic SQL migration example"
echo "---------------------------------"

# Commit 16: feat: add GitHub Actions CI/CD example
echo "Applying commit 16/22: feat: add GitHub Actions CI/CD example"
git add examples/github-actions/README.md
git commit -m "feat: add GitHub Actions CI/CD example"
echo "---------------------------------"

# Commit 17: feat: add Kubernetes deployment example
echo "Applying commit 17/22: feat: add Kubernetes deployment example"
git add examples/kubernetes/README.md
git commit -m "feat: add Kubernetes deployment example"
echo "---------------------------------"

# Commit 18: feat: add multi-environment example
echo "Applying commit 18/22: feat: add multi-environment example"
git add examples/multi-environment/README.md
git commit -m "feat: add multi-environment example"
echo "---------------------------------"

# Commit 19: feat: add Drizzle ORM integration example
echo "Applying commit 19/22: feat: add Drizzle ORM integration example"
git add examples/with-drizzle/README.md
git commit -m "feat: add Drizzle ORM integration example"
echo "---------------------------------"

# Commit 20: chore: remove squizzle-driver-postgres directory
echo "Applying commit 20/22: chore: remove squizzle-driver-postgres directory"
git rm -r squizzle-driver-postgres
git commit -m "chore: remove squizzle-driver-postgres directory"
echo "---------------------------------"

# Commit 21: chore: remove squizzle-driver-postgres-integration directory
echo "Applying commit 21/22: chore: remove squizzle-driver-postgres-integration directory"
git rm -r squizzle-driver-postgres-integration
git commit -m "chore: remove squizzle-driver-postgres-integration directory"
echo "---------------------------------"

# Commit 22: chore: remove squizzle-schemas directory
echo "Applying commit 22/22: chore: remove squizzle-schemas directory"
git rm -r squizzle-schemas
git commit -m "chore: remove squizzle-schemas directory"
echo "---------------------------------"

# Commit 23: chore: remove squizzle-storage-oci-test directory
echo "Applying commit 23/22: chore: remove squizzle-storage-oci-test directory"
git rm -r squizzle-storage-oci-test
git commit -m "chore: remove squizzle-storage-oci-test directory"
echo "---------------------------------"

# Commit 24: chore: remove squizzle-tools directory
echo "Applying commit 24/22: chore: remove squizzle-tools directory"
git rm -r squizzle-tools
git commit -m "chore: remove squizzle-tools directory"
echo "---------------------------------"

echo "All commits have been applied!"