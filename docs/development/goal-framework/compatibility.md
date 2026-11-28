# GF-06 adapter compatibility

Issue #368 owns this checkpoint. The runner adapter and optional preflight
planner are tooling-only. Continue with operator-run V3 and ordinary GitHub CI.

## Read-only inventory

Observed on 2026-11-25 in the local issue #368 worktree. Installed metadata,
the manual receipt and synthetic tests each describe a different boundary.

| Surface or control | Status | Observation and effect |
| --- | --- | --- |
| Local installation | Verified installation metadata | Desktop bundle version `26.1111.21308`, build `27194`. Bundled CLI metadata `0.169.0-alpha.11.1`, `x86_64-apple-darwin`. Running CLI identity and account binding remain unverified. |
| Local manual V3 | Verified for this worktree | The session hook accepted saved issue #368 for the exact linked branch. Native grant-bound launch, runtime config and tamper-resistant pre-write and post-write enforcement remain unverified. |
| Optional local preflight environment | Unavailable in this worktree | The read-only Node diagnostic found Node 22 and npm on PATH. TypeScript and Vitest were absent. npm 10, installed toolchain integrity, host allowance and a supervisor-bound exact-command path remain unverified. |
| Local native execution | Unverified | No independently authenticated start/terminal identity, separate worker/observer/control/merge credentials, native hard cap, watchdog/host limit, model/effort controls, quota/context coverage, artifact persistence, or late billing evidence. |
| Cloud native execution | Unverified | No authenticated native control/observer transport is exposed to this task. Cloud runtime/configuration, scope fences, credentials, model/effort, quotas, native cap, cancellation and artifact retention need separate evidence. |
| Goals and subagents | Disabled in this profile | V1 exposes no delegation or merge operation. Local project configuration keeps Goals and multi-agent features disabled. |

Documented candidates include [CLI, SDK and app-server](https://developers.openai.com/blog/codex-as-a-platform),
[Goals and continuation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex),
[Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud) and
[plan-specific usage limits](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
The inventory used no native launch, stop, paid probe or API fallback.

### Supervised local preparation and Remote

The offline #368 increment keeps the read-only capability inventory separate
from the Git preparation result and the actual hook receipt.

| Interface | Documented capability | Evidence still needed for this host |
| --- | --- | --- |
| Desktop Remote in the ChatGPT mobile app | Connect to a desktop running Codex, start or continue supported desktop work, and inspect progress. [Remote guide](https://developers.openai.com/blog/mastering-codex-remote-for-engineering) · [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) | The operator observed manual project/workspace selection. Authenticated exact-worktree/session binding, installed permissions and a pre-write/pre-charge barrier still require evidence. |
| Codex app-server and SDK | Programmatic local thread and turn operations. [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform) | A versioned, installed and permissioned bridge that exposes a matching prepared receipt before a charged turn or any possible write, along with separate credentials, hard resource limits, stop and terminal proof. Programmatic thread support alone establishes none of these. |
| Repository hook | Actual policy source creates a non-owning PREPARED receipt in `UserPromptSubmit` and claims it at the first allowed mutation in `PreToolUse`. [Hooks documentation](https://developers.openai.com/docs/hooks) | Synthetic CI composition can exercise these two events. The installed transport still needs authenticated delivery, fencing and enforcement across every mutation entry point. |
| Cloud | A separate documented execution surface. [Using Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud) | Separate certification after local certification. |

Bootstrap and independent preflight can yield `PREPARATION_ONLY`. The
handoff returns the exact issue pointer and worktree path for manual
selection. Authenticated inventory that shows pending project or hook trust
produces `HANDOFF_APPROVAL_REQUIRED`. The operator reviews the hook definitions
and configuration in Codex and can then continue in the same prepared worktree
when review is required. Unknown trust or handshake evidence produces
`HANDOFF_UNVERIFIED`. Authenticated evidence that the capability is absent
produces `HANDOFF_UNAVAILABLE`. Observed trust leaves the result
preparation-only. Admission requires independent evidence of the exact hook
configuration, SessionStart root, actual UserPromptSubmit receipt, approved
worker and session/turn mapping, and a nonwriting barrier.
Desktop metadata and chat tool descriptions supply no proof of this
transition. There is no phone endpoint or native start/stop port in the
supervised preparation controller.

After independent review and PM merge, inventory the actual installed
transport, app/CLI versions, active config and permissions, credential
separation, hooks, session visibility and pre-write barrier. A finite local
canary requires separate PM approval, a host allowance including cleanup, a
real GF-05 reservation for any native turn, and evidence of external
nonwriting enforcement through prepared receipt, grant, native start and
GF-03 claim. Test actual first-party phone initiation on new and resume
worktrees, exact Remote session selection, stale and replay denial, bounded
cancellation and terminal proof, publication, late usage and retained
artifacts. Record host idle time and operator interventions. If the installed
surface requires manual workspace selection, report that intervention and
retain preparation-only status. Local then cloud certification still gates
#368 acceptance and #369 dispatch.

## Installed local capability qualification

On the reviewed Mac, PATH Python 3.8.5 raised `NotImplementedError` on
descriptor-relative `os.stat`. The already installed Apple Command Line Tools
Python 3.9.6 supported the descriptor-relative stat, open and path checks.
Under that interpreter the reviewed strict diagnostic returned app and CLI
`unsafe-path` at the `/Applications` ancestor (mode `0o775`) and protocol
`not-selected`. The focused owner check passed, with exact UID and GID
undisclosed. The current installed build, executable version and digest are
unknown and the schema is unobserved. The earlier version and build are
historical. [Host observation](https://github.com/bensmullen/personal-finance-app/issues/368#issuecomment-7241760412)

The repository fixtures are synthetic. An installed observation and a
separately approved canary provide different evidence.

| Capability | Recognized static declarations | Installed host or UI observation | Enforcement evidence for certification |
| --- | --- | --- | --- |
| Thread identity and working directory | `thread/start` request ID and cwd, plus the turn request's thread ID field | Exact workspace, branch, path and environment selection | Authenticated returned identity and exact new or resumed session binding |
| Exact prompt and model/effort | `turn/start` typed text input and model and effort declarations | Available prompt, model and effort controls | Exact issue-pointer delivery to the correct hook and independently verified effective model and effort |
| Permissions, project and hook trust | Recognized thread-level permission request fields | Installed permission modes and human project or hook review | Current policy, exact SessionStart root and authenticated hook configuration for the selected session |
| Pre-write and pre-charge barrier | Unobserved | Setup and prompt submission order | Trusted external boundary that exposes the real PREPARED receipt and withholds writes and chargeable execution pending admission |
| Start, interrupt and terminal events | Typed turn start and interrupt requests and known completion statuses | Available start, stop and status controls | Authenticated admission, effective revocation and stop, terminal proof and writer-fence release after disconnect |
| Quota and hard ceiling | Unobserved | Displayed limits and availability | GF-05 reservation, native hard ceiling and watchdog, independent capacity and kill switch |
| Usage and late billing | Token usage notification with typed last and total counts | Available usage information | Authenticated usage, quota coverage and late settlement against the same reservation after termination |
| Artifacts and ownership | Unobserved | Visible output and workspace ownership | Durable output, stopped-writer ownership and expected-head publication |
| Phone visibility | Unobserved | First-party Remote shows the selected workspace, branch, thread and approval controls | Authenticated binding to the same host, workspace and session used for admission |

First-party Remote is preferred for human-supervised manual V3 handoff. The
phone UI allowed creating a project and new folder/worktree or selecting an
existing folder/worktree, choosing an existing or new thread, and seeing
branch/workspace and approval controls. The operator did not observe an actual
config or hook-trust view. This establishes manual registration and selection.
Automated registration, deterministic bootstrap from a UI-created folder,
pre-turn setup ordering, hook trust and phone-only execution remain unproven.
Use the reviewed manual sequence in [execution](execution.md).
[Phone observation](https://github.com/bensmullen/personal-finance-app/issues/368#issuecomment-7241505267)

A pinned app-server CLI or SDK is a separate candidate. The documented
`turn/start` starts generation. A read-only turn followed by tool approval
or a sandbox change supplies no proof of the required pre-admission writer
barrier or bounded paid call. The current runner needs the actual prepared
hook receipt, canonical grant, GF-03 prepared state, GF-05 reservation,
verified profile binding, all 19 operation capabilities and all 10 native
controls before dispatch. A surface that only produces PREPARED inside an
already generating turn leaves this ordering unresolved. Static declarations
and human UI observations leave every native control unverified. Do not
expose `thread/shellCommand` (documented outside the sandbox), general
command RPC, a TCP/WebSocket listener, third-party routine access or
credentials. Account entitlements and cross-client visibility require their
own evidence. [App-server documentation](https://learn.chatgpt.com/docs/app-server) · [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)

Keep manual V3 and preparation-only handoff if neither surface proves the
pre-writing and pre-charge admission handshake. Any finite staged no-write
alternative requires separate design review and PM approval. A separately
approved actual local canary must establish enforcement before local profile
certification. Cloud certification is separate and follows local. GF-06/P3
and GF-07 dispatch remain gated. After this increment merges, collect one
actual static advisory observation and select the smallest supported supervised
local approach or record an explicit refusal. The synthetic Darwin fixtures
exercise the policy and cannot establish installed behavior or native certification.

## Supervisor contract

`createRunnerAdapter` returns versioned probe, prepare, launch, observe,
stop, checkpoint and resume results. The inventory port supplies current
read-only observations, pinned configuration, transport and permission
identity, and authenticated capability evidence. Lookup ports read GF-03
lifecycle and GF-05 accounting. The verifier, clock, provider credentials
and durable effect port belong outside the worker context.

A future native effect port must atomically revalidate the current issue,
approved merged control/parser revision, runtime, workspace, head, grant,
scope, reservation, capacity and kill switch while acquiring the global
writer fence. Persist GF-05 admission intent before the native call and
prevent writes until GF-03 binds the actual run and claims the writer.
Reconcile repeated intents. Authenticate observer events against the exact
reservation and native run. Retain possible liability and ownership through
expiry, a cancellation request, credential loss or an offline host. Release
the writer only after independent terminal proof. Reconcile late usage in
GF-05 through settlement. Checkpoint reconciles the current GF-03 publication
intent using its expected-head fence. Resume requires a stopped worker, clean
published checkpoint and fresh grant on the same lineage. Cloud admission
also requires local certification. Runtime, permissions, hook or profile
changes require fresh evidence.

The grant names `RUNNER_CAPABILITIES_V1` and the reservation names the
distinct GF-05 registry profile. The grant pins `RUNNER_PROFILE_BINDING_V1`
to authenticate the two references against the exact installed tool,
runtime identifier, model, effort, credentials, config, permissions,
merged parser/control revision, reservation and workspace fence. GF-05
resolves the registry profile at reserve and begin. Existing unbound grants
require fresh issuance for live use. The synthetic composition fixture uses
both journals and binds distinct local and cloud environments to separate
workspaces when transferring a published checkpoint. Its quota refusal case
keeps the lower bound after a higher same-epoch report and reconciles the
reservation with authenticated nonstart evidence. Actual native execution on
both surfaces still requires independent certification.

## Optional preflight and next gates

Host prepare can record eligibility before writer admission or a patch.
With a worthwhile approved profile, verified environment, free foreground
capacity and bounded allowance, the planner selects full typecheck and one
directly affected tracked unit. It rechecks the exact patch, active grant,
tool and lockfile before the current hook can reserve an attempt. Optional
dependency preparation belongs to the operator or supervisor on an idle,
clean worktree.

`LOCAL_PREFLIGHT_DECISION_V1` stores the binding and finite reason.
`PFM_LOCAL_PREFLIGHT_ADVISORY_V1` references that decision and the protected
receipt. A never-invoked check is `NOT_ATTEMPTED`. An invocation without
verifiable host evidence is `NOT_OBSERVED`. A matching observed interruption
seals `INCOMPLETE` and its diagnostic references. The
helper keeps the shared 60-second compiler and 30-second unit budgets,
records phase timings and case progress in one private stream, and caps
the aggregate runner log at 1 MiB. The existing hook owns merged-tool
equivalence, attempt reservation and result capture. GF-04's exact-candidate
acceptance inputs are independent.

CI owns the synthetic adapter and hook regressions. A separately authorized
canary on a reviewed trusted revision must establish actual local control
and credential separation, hard resource limits, terminal proof, late
usage and artifact survival within a finite budget including cleanup.
Cloud requires its own evidence, including reconciliation where work
continues after cancellation. GF-06/P3 hybrid acceptance and GF-07 dispatch
require both certifications. GF-09 can compare measured phase time, CI
runner minutes, avoided retries, host cost and acceptance latency before
changing defaults.
