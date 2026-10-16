# Durable human work orders

This milestone extends the existing Team panel and presence orbs. It does not add AI
workers, change the simulation, or replace Supabase/LiveKit.

Select a component in a saved cloud project and choose **Assign Work** in its inspector.
Owners/admins choose an editor, task (build/connect/configure/inspect/repair), title, notes
and priority. The target must exist in the project's latest saved revision. Save newly
placed parts before assigning them.

In **Team → Work**, assignees can accept, start, block, resume, complete or decline jobs.
Managers can cancel jobs but cannot mark someone else's work done. Go to component uses
the existing selection/camera action. Missing targets remain in history with an explanation.
Completion is an explicit human report; it does not certify engineering success or repair
simulation damage. History shows the 50 most recently closed jobs; all active jobs load.

## Data and permissions

`20261016000100_work_orders.sql` adds `work_orders`, a project/status index and an assignee
index. Records hold server-set identity/timestamps, target component and saved revision,
task type, title, notes, priority, status and completion time. Project deletion cascades;
membership removal preserves history. Removed/demoted assignees lose mutation rights and
managers can cancel their remaining work. Reassignment is not part of this milestone.

RLS allows project members (including viewers) to read. Anonymous users and outsiders
cannot read. Browser roles have no INSERT/UPDATE/DELETE privileges: writes use
`create_work_order` and `transition_work_order`. The RPCs check the shared permission matrix,
eligible membership, saved target, bounded fields and transitions. Status changes lock the
row and compare the expected prior status, rejecting stale changes. The two new permissions
are `can_update_work` (editors) and `can_assign_work` (owners/admins), mirrored in protocol
and SQL and tested against each other. Existing audit events record offers/transitions.

Lifecycle: offered → accepted/cancelled; accepted → in_progress/blocked/cancelled;
in_progress → blocked/completed/cancelled; blocked → in_progress/cancelled. Completed and
cancelled jobs are terminal. Limits: 200 active jobs/project, 20 assignments/minute/creator.

## Realtime and orbs

The database publishes a minimal `work.changed` invalidation on private `work:<project>`
Broadcast topics. Project members may subscribe but browsers cannot publish. Payloads
never become task records: the cache re-reads RLS-protected database rows. It refreshes
after reconnect and every 30 seconds as recovery when delivery is unavailable. No task
queries run per animation frame. Failed work reads do not stop chat, saving or voice.

Presence schema and signed event protocol are unchanged; no task is stored in Presence.
Close orb labels annotate accepted/in-progress/blocked work only when the assignee's actual
focus equals the target. Focusing elsewhere removes the annotation, not the assignment.
Completed work removes it. Voice level, mute state, stable colors, LOD and advisory locks
retain their existing sources.

The prior controller initialized a different personal workspace for every member, with no
UI to join the same workspace. As a result, workspace filtering hid teammates' orbs/soft
locks. Members opening a project now use `ws:project:<project-id>` consistently. Filtering
still separates different workspaces/projects. This remains advisory presence over versioned
personal edits, not simultaneous operation replication; conflicting saves keep their
existing protection.

## Verification and limits

- Protocol tests: strict bounded row parsing, lifecycle actions and focus-only annotation.
- Real migrations in PGlite/Postgres: owner/admin assignment, all denied actors, direct-write
  prevention, target/membership validation, every status pair, stale/null requests, role
  demotion/removal, budgets, project deletion, private topic authorization and audit.
- Cache tests: invalidation/reconnect, persisted work after restart, offline recovery,
  racing events, stopped-session responses and failed writes.
- Supabase adapter tests: private topic, project payload filtering, reconnect and cleanup.
- `e2e/work-orders-local.mjs`: three Chromium contexts drive the production Team/Inspector
  controls against the real SQL migrations, using an isolated local HTTP/SSE test transport.
  Covers assignment/notification, accept/start/block/resume, focus callback, page reload,
  completion/history, escaped text, viewer controls and database rejection of outsiders.
  Screenshots clearly identify this fixture; they are not evidence of hosted multiplayer.
- `e2e/collaboration.mjs` additionally specifies the actual Supabase/LiveKit flow: assignment,
  orb over real focus, selection clearing, reconnect and durable completion alongside voice.

Hosted/two-user Supabase Presence and LiveKit verification remains unrun here: no configured
services, and attempting the documented local startup was blocked by a `Forbidden` response
from the container registry. The existing repository config was preserved; compatibility
settings for the installed older CLI were kept outside the checkout. No migration was
applied to a hosted database. Guest/local-only builds continue to work and do not present
fake multiplayer tasks.

## File map

- `packages/protocol/src/{roles,ids,workOrders,index}.ts`: permissions, shared project area,
  durable record parsing and presentation helpers.
- `supabase/migrations/20261016000100_work_orders.sql`: schema, RLS, RPCs and Broadcast.
- `apps/web/src/lib/{collab,workOrders}.ts`: authenticated database calls and subscription.
- `apps/web/src/collab/{workOrders,controller,context,WorkPanel,TeamPanel}.ts[x]` and
  `collab.css`: project cache, lifecycle integration, Team work list, assignment and notices.
- `apps/web/src/builder/{BuilderRoute,ui/Inspector,scene/PresenceOrbs}.tsx`: context actions,
  existing focus/camera integration and close labels.
- Tests accompany protocol, database, adapter and cache. Browser fixture/test files are in
  `e2e/fixtures/work-orders.tsx`, `e2e/work-orders-local.mjs`, `e2e/collaboration.mjs`.

No dependencies, paid assets, microphone recording, autonomous edits or physical-model
changes were introduced.
