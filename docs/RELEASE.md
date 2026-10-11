# Branches and release

## Where things are today

| Branch                         | What it holds                                                           |
| ------------------------------ | ----------------------------------------------------------------------- |
| `claude/lucid-cray-ihyc12`     | Repository default. Milestone 0 (`021534a`): the original 3D workspace. |
| `ccr-1795abcb-q03im7`          | Earlier product branch; fully contained in the branch below.            |
| `ccr-3bd0d75a-5yspev`          | The current product (78 commits past Milestone 0), CI attached.         |
| `claude/project-thread-9k1an3` | Draft PR #1 head (`ed0c9b8`), six commits behind the product branch.    |

The default branch is a strict ancestor of the working branch, so promotion is a
**fast-forward**: no history is rewritten and nothing is lost.

## Promotion plan (needs the repository owner)

A coding session may only push to its working branch, so these steps are for the owner:

1. Create `main` at the current head of `ccr-3bd0d75a-5yspev` (GitHub → Branches → New
   branch, source `ccr-3bd0d75a-5yspev`), or open a pull request from it into
   `claude/lucid-cray-ihyc12` and merge it with a merge commit.
2. Settings → General → Default branch → `main`.
3. Protect `main`: require the `CI` workflow (both jobs) to pass, require pull requests,
   disallow force pushes.
4. Keep `claude/lucid-cray-ihyc12` as a historical tag (`v0.0-milestone-0`) rather than
   deleting it; delete the branch once the tag exists.
5. From then on, work happens on short-lived branches merged into `main` through pull
   requests, and releases are tagged (`v0.x.y`) from `main`.

## CI status (checked 2026-10-11)

Runs 58–61 (`b436463` … `1ad7588`) and the re-run of PR #1 (run 57) failed in about three
seconds: the job was never assigned a runner (runner id 0, no steps, no log). The same
commit `ed0c9b8` passed on push (run 56) and failed on re-run, so the code is not
the cause. Most likely the account's Actions minutes, billing or spending limit stopped
jobs from starting. The repository owner should check GitHub → Settings → Billing and
Actions usage. The same gates pass locally (see `docs/V1_STATUS.md`).

## Release checklist

- `pnpm verify` and `pnpm format:check` green.
- Acceptance, collaboration and showroom E2E green against the production build
  (CI job "Acceptance and collaboration tests").
- `docs/V1_STATUS.md` updated; known defects listed.
- Simulation, component-definition and material-data versions bumped when physics,
  catalogue or data change (published runs and scores record them).
- Deployment per `docs/DEPLOYMENT.md`.
