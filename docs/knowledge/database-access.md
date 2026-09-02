# Knowledge — database access: the reasoning behind the boundary

> The **rules** are in `CLAUDE.md`. This file holds the *why*, moved out on 2026-09-02 so the rules
> file stays terse. Nothing here overrides `CLAUDE.md`.

### why-the-boundary-is-written-down-not-assumed:

Read-only mode constrains **the tool, not the workflow.** Once schema access makes SQL easy to write
correctly, convenience quietly pressures the talked-through step out of existence — one small write at
a time. The boundary has to be explicit to survive that pressure.

**Protects against:** the gradual, individually-reasonable erosion of a rule that only matters in
aggregate.

### why-prod-is-connected-rather-than-walled-off:

Staging↔prod drift checks are a **cross-database question by definition.** One connection structurally
cannot answer "do these agree," and the answer matters — staging is a stale copy for some tables (see
`players.team_id`, ~15,706 empty stubs on prod). Verifying accuracy across the two is normal work, and
doing it by hand is what the agent is meant to replace.

**Safety comes from naming, not absence:** every tool call carries its database in the server name, so
"which DB am I on" is answered by the call itself rather than by anyone remembering.

### mcp-writes-skip-the-verification-ritual:

Keeping MCP read-only is not caution for its own sake — it **routes writes through the path that has
the verification.** An MCP write returns a bare success with no catalog check. That is precisely the
`exec_sql OK` trap that lost `gm_contracts` on prod: the runner reported success, the transaction had
rolled back, and the table never existed.

**Corollaries, each from a real failure:**
- `exec_sql` runs a migration file as **one transaction** — any failed statement rolls back the whole
  file, including its `CREATE TABLE`. **Runner success is not proof the objects exist.**
- A PostgREST / `.from().select()` read can be a **stale-cache false positive.** Use `to_regclass` or a
  DDL probe (`COMMENT ON TABLE …` errors if absent) for authoritative existence.
- A Supabase write filtered by RLS returns **success with 0 rows affected, no error.** Always
  `.select()` the affected rows when correctness matters.
- Storage (`storage.objects` / `storage.buckets`) and other owner-restricted DDL cannot run via the
  service-role runner — those go through the dashboard.

### this-document-is-point-in-time:

Where `CLAUDE.md` and a recent conversation disagree, **the conversation wins** — update the file and
note what it supersedes. Two claims in it were already wrong once:

1. that prod wasn't connected, and
2. that every write always comes to Trevor as paste-SQL.

**Both were agent inferences that never matched the actual process.** That is the failure mode to
watch: a plausible rule, written confidently, that nobody ever verified against how the work is
actually done.
