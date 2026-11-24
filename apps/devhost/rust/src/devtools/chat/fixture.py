#!/usr/bin/python3
"""Native wire-protocol peer for Rust chat integration tests; no model inference."""
import json
import os
import pathlib
import sys
import signal

claude = pathlib.Path(sys.argv[0]).name == "claude"
scenario = pathlib.Path("scenario").read_text()
pathlib.Path("claude-ready" if claude else "codex-ready").touch()
turn = 0
waiting = None
if scenario == "ignore-term":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)


def emit(value):
    print(json.dumps(value), flush=True)


for line in sys.stdin:
    message = json.loads(line)
    with open("claude-input.jsonl" if claude else "codex-input.jsonl", "a") as output:
        output.write(json.dumps(message) + "\n")
    if claude and message.get("type") == "user":
        if scenario == "unconfirmed":
            continue
        if scenario == "approval":
            waiting = message
            emit({"type": "control_request", "request_id": "approve", "request": {"subtype": "can_use_tool", "input": {"secret": "never log this"}}})
            continue
        if scenario == "refused":
            emit({"type": "command_lifecycle", "command_uuid": message["uuid"], "state": "refused"})
        elif scenario == "queued":
            emit({"type": "command_lifecycle", "command_uuid": message["uuid"], "state": "queued"})
        else:
            emit(dict(message, isReplay=True, session_id="claude-native"))
        continue
    if claude and message.get("type") == "control_response":
        if waiting:
            emit(dict(waiting, isReplay=True, session_id="claude-native"))
            waiting = None
        continue
    method = message.get("request", {}).get("subtype") if claude else message.get("method")
    params = message.get("request", {}) if claude else message.get("params", {})
    if method == "initialized" or method is None:
        continue
    if scenario == "malformed":
        print("{broken", flush=True)
        break
    if scenario == "exit":
        print("native diagnostic", file=sys.stderr, flush=True)
        sys.exit(7)
    if method == "initialize":
        if claude:
            emit({"type": "system", "subtype": "init", "capabilities": ["interrupt_cancel_queued_v1"]})
        result = {"models": [{"value": "sonnet", "displayName": "Sonnet", "description": "Native Claude model"}]}
    elif method == "config/read":
        result = {"config": {"model": "" if scenario == "catalog" else "configured-model"}}
    elif method == "model/list":
        result = {"data": [{"model": "catalog-model", "displayName": "Catalog", "description": "Native model", "isDefault": True}], "nextCursor": ""}
        if scenario == "pagination" and not params.get("cursor"):
            result["nextCursor"] = "second"
        elif scenario == "cursor-loop":
            result["nextCursor"] = "repeat"
        elif scenario == "invalid-model":
            result["data"] = [{}]
    elif method in ("thread/start", "thread/resume"):
        result = {"thread": {"id": params.get("threadId", "codex-native")}}
    elif method in ("turn/start", "turn/steer"):
        if scenario == "unconfirmed":
            continue
        if method == "turn/steer" and scenario == "steer-race":
            emit({"method": "turn/completed", "params": {"turn": {"id": str(turn), "status": "completed"}}})
            emit({"id": message["id"], "error": {"code": -32600, "message": "turn completed"}})
            continue
        turn += 1
        emit({"method": "turn/started", "params": {"turn": {"id": str(turn)}}})
        if scenario == "approval":
            emit({"id": 123456789012345678901234567890, "method": "item/commandExecution/requestApproval", "params": {"secret": "never log this"}})
        result = {"turn": {"id": str(turn)}}
    elif method in ("turn/interrupt", "interrupt"):
        if claude:
            emit({"type": "system", "subtype": "session_state_changed", "state": "idle"})
        else:
            emit({"method": "turn/completed", "params": {"turn": {"id": str(turn), "status": "interrupted"}}})
        result = {"still_queued": []}
    elif method == "set_model":
        result = {}
    else:
        result = {}
    if claude:
        response = {"subtype": "success", "request_id": message["request_id"], "response": result}
        if scenario == "restore" and method == "initialize":
            response["pending_permission_requests"] = [{"request_id": "restored", "request": {"subtype": "can_use_tool"}}]
        emit({"type": "control_response", "response": response})
    else:
        emit({"id": message["id"], "result": result})
