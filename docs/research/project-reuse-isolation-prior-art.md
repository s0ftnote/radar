# Cross-project content reuse and isolation: product prior art

Research date: 2026-08-24
Scope: official, first-party product documentation only. “Project” below means a Radar task boundary, not a new domain term.

## Product facts

### Notion: choose explicitly between a live reference and an independent copy

- Notion workspaces are separate containers, but synced blocks are an explicit exception: the same block can appear across pages or workspaces, edits from any instance propagate to every instance, and a reader who cannot access the page containing the original block cannot see the synced content. Unsyncing breaks the connection and leaves independent copies. This makes shared identity, source access, and detachment visible parts of the reuse operation. ([Synced blocks](https://www.notion.com/help/synced-blocks), [Intro to workspaces](https://www.notion.com/help/intro-to-workspaces))
- Moving content between workspaces is implemented as duplication: the destination receives a copy while the original remains. Notion warns that links, relations, permissions, page history, and other settings may not survive correctly, and requires the acting account to have access to nested source content plus permission to create content in the destination. Workspace admins can disable cross-workspace duplication entirely. ([Move & duplicate content](https://www.notion.com/help/transfer-content-to-another-account), [Workspace settings](https://www.notion.com/help/workspace-settings))
- Within a workspace, pages inherit access from their parent and teamspace content inherits teamspace defaults; moving a page into `Private` removes others' access to that parent page. Permissions therefore follow placement unless a more specific grant remains. ([Sharing & permissions](https://www.notion.com/help/sharing-and-permissions))

### Airtable: a synchronized projection is not the source record's identity

- Airtable lets a source view be synced into another base, with explicit field selection, manual versus automatic refresh, optional two-way editing, and a choice to delete or retain destination records when they disappear from the source. Cross-base reuse is therefore a declared relationship with direction and lifecycle policy, not an invisible global lookup. ([Getting started with Airtable Sync](https://support.airtable.com/articles/2849803278-getting-started-with-airtable-sync))
- Airtable states that source and destination records have different record IDs and are technically unique; record comments remain scoped to the base where a record resides. A destination table can also be unsynced and kept as a normal editable table. This is copy-with-provenance/synchronization, not one record simultaneously owned by two bases. ([Getting started with Airtable Sync](https://support.airtable.com/articles/2849803278-getting-started-with-airtable-sync))
- Moving a base preserves the base ID and existing sync connections, but recalculates access: source-workspace members who are not in the destination lose access, while directly invited base collaborators retain it. The invariant is content identity; the variable is container-derived access. ([Transferring bases between workspaces](https://support.airtable.com/articles/7768846948-transferring-airtable-bases-between-workspaces))
- Cross-base sync can be disabled or constrained at the source through share-link, domain, organization-unit, and admin restrictions. Revoking or regenerating the source link pauses downstream syncs until reauthorization rather than silently transferring ownership to destinations. ([Getting started with Airtable Sync](https://support.airtable.com/articles/2849803278-getting-started-with-airtable-sync))

### Obsidian: the vault is the hard content and preference boundary

- An Obsidian vault is a filesystem folder containing notes plus its own `.obsidian` configuration. Internal links are local to a vault, and Obsidian explicitly presents separate vaults as a way to isolate work and school notes. Cross-vault navigation is possible through an `obsidian://open` URI that names the target vault and file, but that is an external pointer, not a shared graph object. ([How Obsidian stores data](https://help.obsidian.md/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata), [Obsidian URI](https://help.obsidian.md/Extending%2BObsidian/Obsidian%2BURI))
- Hotkeys, themes, plugins, and other preferences are vault-specific, while a smaller set of application settings is global. Reusing a configuration in another vault is an explicit copy of the `.obsidian` folder; changing configuration folders does not transfer settings automatically. ([How Obsidian stores data](https://help.obsidian.md/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata), [Manage vaults](https://help.obsidian.md/Files%2Band%2Bfolders/Manage%2Bvaults), [Configuration folder](https://help.obsidian.md/Files%2Band%2Bfolders/Configuration%2Bfolder))
- A shared Sync vault grants every collaborator the owner's content permissions; only the owner can invite collaborators. Obsidian documents that fine-grained permissions are not supported. This is a useful warning: a container that lacks per-object authorization should not pretend that cross-container sharing is safely granular. ([Collaborate on a shared vault](https://help.obsidian.md/Obsidian%2BSync/Collaborate%2Bon%2Ba%2Bshared%2Bvault))

### Figma: publish a single source of truth through a governed library

- Figma library assets live in one source file and can be reused across files and folders. Source changes are published; downstream editors then review and accept or ignore updates. This preserves one authoritative definition without making every consumer update implicitly. ([Guide to libraries](https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma))
- A library can be scoped to a team or an organization, and its source file's sharing settings determine who can use it. Guests require access to the original file. Unpublishing breaks the source-instance connection but does not delete existing instances; they simply stop receiving updates. ([Share libraries in an organization](https://help.figma.com/hc/en-us/articles/360040529593-Share-libraries-in-an-organization))
- Moving a file between folders or teams preserves direct file invitees while adding the destination folder/team audience, so a move can widen access. Across organizations, the fallback is transfer or save/import; an imported copy no longer receives updates from the original team's libraries. ([Move a file](https://help.figma.com/hc/en-us/articles/360038511573-Move-a-file))

## Cross-product pattern

| Concern | Repeated mature-product pattern |
| --- | --- |
| Identity | One object has one authoritative owner/container. Cross-container reuse is either a reference/instance to that source or a new identity with explicit provenance. |
| Copy, move, reference | Products name these separately. Copy detaches, move preserves identity but recomputes inherited access, and reference/sync retains a dependency on source availability and authorization. |
| Permissions | A reference never grants access to its source by implication. Moves are guarded by source and destination authority and warn when the destination audience changes. |
| Failure and revocation | Revoked source access makes a reference unavailable or pauses synchronization; it does not silently promote the consumer's materialized copy to an authoritative source. |
| Preferences | Defaults belong to a container; global defaults are a separate layer. Reusing container-specific behavior is explicit copy/publish/inheritance, not accidental bleed-through. |
| Consumer stability | Figma and Airtable protect consumers from uncontrolled source changes through publish/accept or configurable sync direction and deletion policy. |

## Decision implications for Radar

The following are design inferences, not claims about the cited products.

1. **Keep each domain object owned by exactly one Radar task.** A 情报条目, Idea, Report, Radar Brief, feedback event, or output plan should have one canonical task identity. Do not model one mutable object as jointly owned by multiple tasks.
2. **Offer three verbs with different invariants:**
   - **引用** keeps source identity and provenance; the target stores a reference and any target-local annotation, not a second authoritative object.
   - **复制到** creates a new identity and records `copiedFrom`; later edits and feedback are independent.
   - **移动到** preserves identity but changes ownership, then recomputes inherited permissions, policies, schedules, and visibility from the destination.
3. **Do not let reference imply disclosure.** Resolving a cross-task reference must require access to both the target task and the source object. If source access is revoked, show an unavailable reference with provenance/status rather than leaking cached content. Materialized evidence needed for audit should be governed by an explicit snapshot rule, not an accidental cache.
4. **Separate reusable knowledge from task-local judgment.** The safest initial candidates for reference are immutable or version-addressed artifacts—source content, evidence snapshots, and perhaps a published 情报条目 revision. Radar Brief, negative preference, ranking state, suppression, feedback, and generation baselines should remain task-local because their meaning depends on the owning task.
5. **Treat copied judgments as divergence, not synchronization.** A copied 情报条目 or Idea should stop following the source immediately. If live reuse is needed later, introduce an explicit published-reference model with source revision, update availability, and deliberate accept/ignore; do not make ordinary copies secretly sync.
6. **Make cross-task behavior opt-in and auditable.** Record actor, source task/object/revision, destination task, operation, and time. Moving should preview access gained/lost and block when the actor lacks authority on either side. Copy/reference can be disabled at task or account policy level.
7. **Use a two-layer preference model.** Account defaults may seed a new Radar task, but the task owns its effective Radar Brief, feedback-derived preferences, delivery choices, and generation state. Changing account defaults should not retroactively rewrite existing tasks unless the user explicitly applies them.

## Smallest plausible Radar policy surface

For a walking skeleton, support **copy with provenance** for selected artifacts and keep all mutable behavior task-local. Defer live references and moves until Radar has an authorization model that can answer source access, revocation, audit snapshot, and destination-policy questions. If one live reuse path is needed now, make it a read-only, version-pinned evidence reference; do not start with bidirectional synchronization.
