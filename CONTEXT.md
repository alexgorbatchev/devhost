# devhost

devhost runs a project's local services behind shared HTTPS hostnames and injects devtools into their pages. This glossary fixes the words used for its configuration and how changes to it take effect.

## Language

**Stack**:
One running devhost instance for one project: its services, routes, devtools, and annotation sessions, identified by the path of its root manifest file. Its `name` is a label that can change while it runs.
_Avoid_: instance, project, app

**Manifest**:
The complete configuration of a stack, merged from the root manifest file and every file it includes.
_Avoid_: config, settings file

**Manifest file**:
One TOML file that contributes to a manifest: the root file or one of its includes.
_Avoid_: config file, toml

**Hot reload**:
Applying a saved manifest to the running stack without stopping it, so services, routes, and annotation sessions that the change does not affect keep running. Every manifest setting is applied this way; none requires restarting the stack.
_Avoid_: live reload, refresh, restart

**Accepted manifest**:
The manifest the stack is running. It differs from the manifest files only when a file was changed outside devhost into a state the stack cannot run, such as invalid TOML or a port another program holds; the stack then keeps the accepted manifest until the files can run again.
_Avoid_: current config, active config, previous config

**Shared Caddy settings**:
The listener settings of the one Caddy that every running stack on the machine shares. They are set only in the devhost config file, never in a manifest, and a saved change hot reloads that Caddy and moves the URLs of every running stack.
_Avoid_: global config, Caddy config

**Devhost config file**:
The one `config.toml` per machine that holds settings shared by every stack, currently the shared Caddy settings. It is separate from every manifest.
_Avoid_: global config, global manifest, settings file
