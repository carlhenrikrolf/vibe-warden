# Claude Permissions

*"Permissions" is used in the broad computer science sense. The Claude setting `permissions` is further discussed below.*

This is meant as a cheat sheet for permission management with Claude Code.
It is not meant as an in-depth manual.
See the footnotes for further information.

**OS permissions**.
Read and write.

**Train**.
You can opt-in/opt-out of Claude Code training on your code (if it is not publicly available online).[^data]

**Claude tools**.
`Read`, `Write`, `Edit`, `WebFetch`, and `Bash`.
Note that Claude code can read a file either through its `Read` tool or through its `Bash` tool, likewise for `Write` and `Edit`.

**Security levels**.
Deny, allow, and ask.[^perms]

## Configurations

Configurations are saved in the files `.claude/settings.json` and `.claude/settings.local.json`.
Claude's Edit/Write tools treat .claude/ as a protected path — writes always prompt and can't be pre-approved by allow rules.[^modes]

`.claude/settings.local.json` is meant for local, machine-specific configurations, whereas `.claude/settings.json` is meant for configurations useful to share via git, otherwise, they are the same.
Local precedes project which precedes user settings.
(There are also managed/enterprise settings at an even higher precedence.)[^settings]
Consider the json content
```json
{
    "permissions": {
        "deny": [],
        "allow": [],
        "ask": []
    },
    "sandbox": {
        "enabled": true,
        "filesystem": {
            "denyRead": [],
            "denyWrite": [],
            "allowRead": [],
            "allowWrite": []
        }
    }
}
```
`enabled` can of course be set to `false`.
Let us proceed by filling out the `[]`s.

`permissions`.
Here, we specify permissions for Claude Code's tools.
For example, `"deny": ["Read(./.env)"]` means that Claude Code cannot use its `Read` tool to read the local `.env` file, but it could use `Bash(python -c "print(open('.env').read())")`.
`deny` has precedence over `ask` which has precedence over `allow`.
You can check the resulting permissions in the terminal with `claude /permissions`.[^cli]

`sandbox`.
Here, we specify OS-level permissions for files, directories (through recursion) and networks.[^sandbox]
Unlike, `permissions`, `sandbox` allows carve-outs.
For example, `"denyRead": ["~/"], "allowRead": ["~/repo"]` disables the sandbox from reading the home directory but makes an exception for `repo`.
You can check the result in the terminal with `claude /sandbox`.

There is a merge of `permissions` and `sandbox` such that the `Read` and `Write` are applied to (folded into) the OS level permissions in `sandbox`.[^perms][^sandbox][^merge]
`Edit` is interpreted as write.


## Templates

**Simple**.
Recommended settings.
```jsonc
{
    "sandbox": {
        "enabled": true,
        "failIfUnavailable": true,
        "filesystem": {
            // denyWrite already active outside
            "denyRead": [
                "/Users", // Mac
                "/home" // Linux
            ]
            // others at / protected by OS permissions
            "allowRead" : ["."] // Carve-out
        }
    },
    "permissions": {
        "deny": [
            "Read(//Users/*/.ssh/**)", // non-bash read tool
            "Read(//Users/*/.aws/**)",
            "Read(//home/*/.ssh/**)",
            "Read(//home/*/.aws/**)",
            "Read(//**/.env)", // looks both in repo and outside
            "Write(//**/.env)", // no write inside repo
            "Edit(//**/.env)",
            "Read(//**/.env.*)",
            "Write(//**/.env.*)",
            "Edit(//**/.env.*)"
        ]
    }
}
```

**Paranoid**.
One step below using a virtual machine instead.

**Defaults**.
What is already there by default—no need to copy.


[^data]: Two separate pipelines. (1) Your Claude Code *session* data (prompts and code you send): consumer accounts (Free/Pro/Max) choose opt-in/opt-out, commercial/API is not trained on by default — Anthropic, *Data usage*: <https://code.claude.com/docs/en/data-usage>. (2) Code you have *published publicly* online: may be collected under "Publicly available information via the Internet," a separate training source the Claude Code opt-out does not affect — Anthropic *Privacy Policy*, §1: <https://www.anthropic.com/legal/privacy>.
[^perms]: Anthropic — *Configure permissions* (Claude Code docs): <https://code.claude.com/docs/en/permissions>
[^modes]: Anthropic — *Choose a permission mode*, see "Protected paths" (Claude Code docs): <https://code.claude.com/docs/en/permission-modes>
[^settings]: Anthropic — *Settings* (Claude Code docs): <https://code.claude.com/docs/en/settings>
[^sandbox]: Anthropic — *Configure the sandboxed Bash tool* (Claude Code docs): <https://code.claude.com/docs/en/sandboxing>
[^cli]: Anthropic — *CLI reference* (Claude Code docs): <https://code.claude.com/docs/en/cli-reference>
[^merge]: With the sandbox on, its OS-level filesystem boundary is the *union* of two independent rule sets — the `sandbox.filesystem.*` paths and your `Read`/`Edit` tool-permission rules — combined, not one derived from the other. Map each tool to an OS dimension: `Read` rules govern what can be *read*; `Edit` rules (which also cover the `Write` tool) govern what can be *written*. `Bash(...)` rules do not fold in — they match command strings, not paths — while `WebFetch(domain:...)` rules merge into the network side. So "the merge" just means: enabling the sandbox makes your file-tool allow/deny rules part of the OS boundary too.
