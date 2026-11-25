---
created_on: 2026-11-22 19:15
last_modified: 2026-11-22 19:46
status: current
---

# Makiko server global requests

This directory vendors Makiko 0.2.5 from its crates.io archive, licensed under
the included Unlicense. Upstream: https://github.com/honzasp/makiko.

The copy contains the library and its license, without upstream examples,
integration tests, their development dependencies, or the `host_file` unit-test
module that imports their fixtures. Those files contain published private test
keys and are not needed to build Devhost. The remaining library implementation
is preserved apart from the API extension below. PEM documentation describes
the format labels without literal private-key opening markers, which the
publication scanner otherwise flags as private keys. Devhost's native Chisel tests
exercise the patched transport using keys generated for each test run.

The local change adds the generic `ClientEvent::ServerRequest` API for incoming
SSH global requests. Responses use a one-shot sender and preserve request order;
dropping a requested response sends failure. Requests without a requested response
produce no reply. The connection driver continues processing channels while a
response is pending.

Chisel sends a server keepalive every 25 seconds. The unmodified library responds
with `SSH_MSG_UNIMPLEMENTED`, which terminates the Chisel session. Devhost handles
the new event by answering `ping` with `pong`, and rejects other requested global
operations. The native Chisel integration test keeps an upload open beyond the
keepalive interval to exercise both directions of the live connection.

Remove the vendored copy when a released upstream version supplies this API or
equivalent incoming global-request support. No cipher, key exchange, host-key
verification, packet framing, or identification behavior is changed.
