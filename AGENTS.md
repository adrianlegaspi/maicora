# AGENTS.md

Instructions for AI coding agents working in this repository. These rules apply
regardless of stack or language unless a more specific project doc overrides
them. If something here conflicts with an explicit user instruction in the
current conversation, the user instruction wins.

## Project specification

The authoritative product and architecture spec is
[docs/mvp/index.md](./docs/mvp/index.md) — an index over numbered chapter files
in the same folder. It defines MVP scope, domain models, the agent/proposal
model, fiscal rules, phasing, and hard architectural constraints.

Consult it before:

- implementing a feature or module, to confirm it's in MVP scope and matches
  the specified model rather than inventing one
- fixing a bug whose correct behavior isn't obvious from the code — the spec,
  not a guess, defines intended behavior
- making any architectural, data-model, or dependency decision
- adding or changing an agent capability, proposal, approval gate, or MCP tool

Read the relevant chapter, not the whole spec — the index says what each
chapter covers. Chapter 14 (non-negotiables) applies to every change.

If the spec contradicts the code, or is silent on something the task needs,
say so instead of quietly picking a direction. If a change makes the spec
outdated, flag it — don't leave the spec and the code disagreeing.

## Prime directives

1. **Never assume — ask when genuinely blocked.** If a requirement, expected
   behavior, or root cause isn't clear from the code, docs, or conversation,
   stop and ask rather than guessing. A wrong guess costs more than a
   question. This does not apply to small, mechanically obvious choices
   (variable names, which existing helper to call) — resolve those yourself
   and, if you made a judgment call worth knowing about, say so in your
   summary rather than asking permission for it.
2. **Stay inside the requested scope.** Do the task asked. If you notice an
   unrelated bug, improvement, or cleanup opportunity, mention it — don't
   fix it unless asked. Don't narrow or widen scope silently.
3. **Read before you edit.** Understand the surrounding code and match its
   existing conventions (naming, formatting, patterns) before changing it.
   Don't reformat or restyle lines you weren't asked to touch.
4. **Reuse before adding.** Prefer an existing utility, pattern, or dependency
   already in the codebase over introducing a new one. Adding a new
   dependency is a decision with a cost (bundle size, security surface,
   maintenance) — justify it, don't default to it.
5. **Report faithfully.** Never describe an outcome you didn't actually
   observe. If you couldn't run or test something, say so explicitly instead
   of implying it works. "Should work" and "verified working" are different
   claims — use the right one.

## Code quality

- **No speculative abstraction.** Solve the problem in front of you. Don't
  build configurability, extensibility, or generality for hypothetical future
  needs. Three similar lines beat a premature abstraction; if a fourth
  near-duplicate shows up, that's the signal to factor it out.
- **No dead code.** Delete code that's no longer used instead of commenting
  it out or leaving it behind a disabled flag. Version control is the
  archive, not the working tree.
- **Comment the why, not the what.** Well-named code already explains what
  it does. Only add a comment when it captures something the code can't:
  a non-obvious constraint, a workaround for a specific bug, a reason a
  simpler approach won't work. Skip comments that just restate the next
  line.
- **File size as a design signal.** When a file grows very large (roughly
  800–1000 lines, depending on language norms), treat it as a prompt to
  look for a natural seam to split along — not a hard rule to game with
  arbitrary cuts. Confirm the split point makes sense before doing a large
  mechanical reorganization; don't drive-by-split files unrelated to the
  task.
- **Validate at boundaries only.** Trust internal function contracts and
  framework guarantees. Add validation and error handling where untrusted
  input actually enters the system (user input, external APIs, file/network
  I/O) — not defensively everywhere.
- **Don't hand-edit generated or tool-owned files.** Lockfiles, build
  output, generated bindings, and files a specific tool/command owns should
  be changed by re-running that tool, not by direct edits. If a file has a
  "generated, do not edit" header, respect it.
- **Naming conventions.** Follow whatever casing/naming convention the
  language and existing codebase already use consistently. If none exists
  yet, pick the idiomatic convention for that language and apply it
  consistently rather than mixing styles.

## Architecture

- **Supabase access goes through the backend only.** The frontend never
  talks to Supabase directly — no Supabase URL, anon/service key, or
  `supabase-js`/client SDK usage in client-side code. All reads/writes go
  through the backend, which is the only layer allowed to hold Supabase
  credentials and call its services. If a feature seems to need direct
  client access to Supabase, treat that as a sign the backend is missing an
  endpoint — add one there instead of reaching around it.

## Security

- Never commit secrets, API keys, tokens, or credentials. `.env` and similar
  files stay gitignored; commit a `.env.example` with placeholder values
  instead.
- Treat all external input (user input, network responses, file contents) as
  untrusted. Guard against injection classes relevant to the stack (SQL,
  command, XSS, path traversal, etc.) at the point where that input is used.
- If you notice you've written something insecure, fix it immediately rather
  than leaving it for later.
- Don't weaken security controls (auth checks, permission gates, TLS
  verification, CSP, etc.) to make something "just work" — flag the
  conflict instead.

## Testing

- Don't add tests reflexively for every change. Add a test when:
  - You fixed a bug — write a regression test that fails before the fix and
    passes after. Name it after the bug scenario, not the fix
    (`does_not_double_charge_on_retry`, not `test_fix`).
  - You implemented new logic from scratch that has no existing coverage.
  - The user explicitly asks for tests.
- Don't proactively run the full test suite, linter, or formatter across the
  whole repo "just to be safe" unless asked or unless it's part of the
  project's own pre-commit/CI gate. Run the tests relevant to what you
  changed.
- Don't test framework internals, third-party libraries, or trivial
  getters/setters — test behavior that could plausibly break.

## Git & version control

- **Commit and push only when explicitly asked.** Making local edits doesn't
  imply the user wants them committed, and committing doesn't imply they
  want it pushed.
- **One logical change per commit.** Use
  [Conventional Commits](https://www.conventionalcommits.org/) style
  (`type(scope): subject`) where the project doesn't already dictate
  otherwise: lowercase subject, no trailing period, keep the subject line
  short (~72 chars), blank line before any body.
- **Never bypass hooks or checks** (`--no-verify`, disabling a linter rule
  inline, skipping CI) to get past a failure — fix the underlying issue
  instead. If a hook seems wrong, say so and ask rather than routing around
  it silently.
- **Never force-push or push to the default/main branch** without explicit
  confirmation for that specific action.
- Before any destructive git operation (`reset --hard`, `checkout --`,
  `clean -f`, discarding a branch), check `git status` first and make sure
  nothing valuable is about to be lost.
- Investigate unfamiliar existing state (stray branches, uncommitted changes,
  unusual files) before overwriting or deleting it — it may be someone's
  in-progress work.

## Configuration & tooling

- Config files owned by a specific tool (formatter configs, IDE settings,
  auto-generated manifests) should be changed through that tool's own
  workflow when one exists, not hand-edited around it.
- Prefer scripts/tasks the project already defines (`package.json` scripts,
  `Makefile` targets, etc.) over ad hoc equivalent commands.
- If a hook or check depends on a tool that isn't installed yet (fresh
  clone, no `install` step run), it should degrade gracefully — skip with a
  warning rather than hard-failing — so the repo stays usable before setup
  is complete.

## Communication style

- Keep responses concise and relevant. Lead with the answer or result, not a
  restatement of the request.
- State assumptions and judgment calls explicitly rather than burying them.
- When something didn't work, say what failed and why — don't soften it into
  vague language.
- Avoid filler, hedging, and unnecessary preamble ("I'll now proceed to...").
- **Never use em dashes or Oxford commas**, in code comments, commit
  messages, PR descriptions, docs, or chat responses. Use a comma, period, or
  separate sentence instead of an em dash; drop the serial comma before the
  final "and"/"or" in a list.

## Definition of done

Before considering a task complete, check that:

- [ ] The actual request was fulfilled — not a broader or narrower version of it.
- [ ] Existing conventions (style, structure, naming) were matched, not overridden.
- [ ] No dead code, debug prints, or commented-out blocks were left behind.
- [ ] No secrets, credentials, or sensitive data were introduced.
- [ ] Tests were added only where warranted (see Testing) and pass.
- [ ] Anything unverified or assumed is called out explicitly in the summary.
- [ ] Nothing was committed or pushed unless explicitly requested.

## Node-specific rules

This project is a Node.js/TypeScript project, so the following rules layer on
top of everything above.

### Package manager

- Use whichever package manager the project already committed a lockfile
  for (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`).
  Don't introduce a second one, mixed lockfiles cause divergent dependency
  trees between contributors and CI.
- Never hand-edit a lockfile. Let the package manager regenerate it via its
  own install/update commands (see the "generated or tool-owned files" rule
  above).
- Pin exact versions for anything security-sensitive or prone to breaking
  changes, otherwise follow whatever range style (`^`, `~`, exact) the
  existing `package.json` already uses.

### Project conventions

- Match the module system already in use (`"type": "module"` / ESM vs
  CommonJS `require`), don't mix `import` and `require` in the same package
  without a specific reason (e.g. a `.cjs`/`.mjs` boundary).
- Follow the existing TypeScript strictness level (`strict` in
  `tsconfig.json`) rather than loosening it to make new code compile.
- Naming: `camelCase` for variables and functions, `PascalCase` for
  classes/types/interfaces/components, `kebab-case` or `camelCase` for
  filenames, match whichever the codebase already uses consistently.
- Keep `package.json` scripts as the entry point for common tasks (build,
  test, lint, dev) rather than telling contributors to run the underlying
  tool directly.

### Environment & secrets

- Config and secrets come from environment variables, loaded via whatever
  the project already uses (`dotenv`, `process.env` directly, a framework's
  built-in config loader), don't add a second env-loading mechanism.
- `.env`, `.env.local`, and any other real env files stay gitignored. Commit
  `.env.example` with placeholder values so contributors know what's
  required.

### Dependencies

- Prefer a well-maintained existing dependency in `package.json` over adding
  a new one for the same job (e.g. don't add `moment` when `date-fns` is
  already a dependency).
- Check `engines` in `package.json` before using a language/runtime feature
  newer than the declared minimum Node version.
- Run the project's audit command (`npm audit`, `pnpm audit`, etc.) only
  when asked or when it's part of the project's own CI gate, not
  proactively on every change.

### Testing

- Use whichever test runner is already configured (Jest, Vitest, Mocha,
  node's built-in `node:test`, etc.), don't introduce a second one.
- Mirror the source layout for test files unless the project's existing
  convention is co-located `*.test.ts`/`*.spec.ts` files next to the
  source, match what's already there.
- Mock network/filesystem/time at the boundary (fetch, fs, `Date.now`), not
  internal application logic, so tests exercise real behavior.

### Repo hygiene specific to Node

- `.gitignore` should exclude `node_modules/`, build output directories
  (`dist/`, `build/`, `.next/`, etc.), and any framework-specific cache
  directories, never commit `node_modules/`, it's fully reproducible from
  the lockfile.
- Don't commit editor/OS artifacts (`.DS_Store`, `Thumbs.db`) or local
  environment overrides.
