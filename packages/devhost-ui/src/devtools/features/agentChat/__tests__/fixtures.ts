import type { IChatEvent } from "../types";
export const fixture_codexConversation: readonly IChatEvent[] = [
  {
    sequence: 17,
    payload: {
      method: "item/started",
      params: {
        item: {
          type: "userMessage",
          id: "01a15d19-3080-7280-86cf-27e6461003ca",
          clientId: null,
          content: [
            {
              type: "text",
              text: "Reply with exactly DEVHOST_CHAT_OK. Do not use any tools or modify any files.",
              text_elements: [],
            },
          ],
        },
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        startedAtMs: 1792563294337,
      },
      emittedAtMs: 1792563294337,
    },
  },
  {
    sequence: 18,
    payload: {
      method: "item/completed",
      params: {
        item: {
          type: "userMessage",
          id: "01a15d19-3080-7280-86cf-27e6461003ca",
          clientId: null,
          content: [
            {
              type: "text",
              text: "Reply with exactly DEVHOST_CHAT_OK. Do not use any tools or modify any files.",
              text_elements: [],
            },
          ],
        },
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        completedAtMs: 1792563294337,
      },
      emittedAtMs: 1792563294339,
    },
  },
  {
    sequence: 19,
    payload: {
      method: "item/started",
      params: {
        item: {
          type: "agentMessage",
          id: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
          text: "",
          phase: "final_answer",
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        startedAtMs: 1792563295628,
      },
      emittedAtMs: 1792563295628,
    },
  },
  {
    sequence: 20,
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        itemId: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
        delta: "DEV",
      },
      emittedAtMs: 1792563295630,
    },
  },
  {
    sequence: 21,
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        itemId: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
        delta: "HOST",
      },
      emittedAtMs: 1792563295631,
    },
  },
  {
    sequence: 22,
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        itemId: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
        delta: "_CHAT",
      },
      emittedAtMs: 1792563295631,
    },
  },
  {
    sequence: 23,
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        itemId: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
        delta: "_OK",
      },
      emittedAtMs: 1792563295631,
    },
  },
  {
    sequence: 24,
    payload: {
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          id: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
          text: "DEVHOST_CHAT_OK",
          phase: "final_answer",
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
        completedAtMs: 1792563295679,
      },
      emittedAtMs: 1792563295681,
    },
  },
  {
    sequence: 30,
    payload: {
      method: "turn/completed",
      params: {
        threadId: "01a15d19-2bbc-7e00-906a-5ad0e22f5407",
        turn: {
          id: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
          rootTurnId: "01a15d19-2c0f-7bb0-8d75-3cb24ae29c19",
          items: [
            {
              type: "agentMessage",
              id: "msg_03dbee76730adce0016ad8585f98f881988e548ce4b0e51539",
              text: "DEVHOST_CHAT_OK",
              phase: "final_answer",
              memoryCitation: null,
              delivery: null,
              questions: null,
            },
          ],
          itemsView: "summary",
          status: "completed",
          error: null,
          startedAt: 1792563293,
          completedAt: 1792563295,
          durationMs: 2502,
        },
      },
      emittedAtMs: 1792563295705,
    },
  },
];
export const fixture_claudeAuthFailure: readonly IChatEvent[] = [
  {
    sequence: 6,
    payload: {
      type: "assistant",
      message: {
        diagnostics: null,
        id: "d63e0b5a-b3d0-4018-8220-5e5c791f61bc",
        container: null,
        model: "<synthetic>",
        role: "assistant",
        stop_details: null,
        stop_reason: "stop_sequence",
        stop_sequence: "",
        type: "message",
        usage: {
          output_tokens_details: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: {
            web_search_requests: 0,
            web_fetch_requests: 0,
          },
          service_tier: null,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
          inference_geo: null,
          iterations: null,
          speed: null,
          fallback_credit: null,
        },
        content: [
          {
            type: "text",
            text: "Not logged in · Please run /login",
          },
        ],
        context_management: null,
      },
      parent_tool_use_id: null,
      session_id: "75f00f49-75c7-4e39-a516-3f74589bd404",
      uuid: "bd270668-0edb-4e77-8b27-5a1211091675",
      timestamp: "2026-10-21T06:14:56.120Z",
      error: "authentication_failed",
      is_api_error_message: true,
    },
  },
  {
    sequence: 7,
    payload: {
      duration_api_ms: 0,
      stop_reason: "stop_sequence",
      session_id: "75f00f49-75c7-4e39-a516-3f74589bd404",
      total_cost_usd: 0,
      usage: {
        output_tokens_details: {
          thinking_tokens: 0,
        },
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0,
        },
        service_tier: "standard",
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        inference_geo: "",
        iterations: [],
        speed: "standard",
        fallback_credit: null,
      },
      modelUsage: {},
      permission_denials: [],
      terminal_reason: "api_error",
      fast_mode_state: "off",
      fast_mode_disabled_reason: "sdk_opt_in_required",
      subagent_stats: {
        spawned: 0,
        requested: {
          background: 0,
          foreground: 0,
          unset: 0,
        },
        started_in_background: 0,
        max_depth: 0,
        spawned_by_subagents: 0,
        completed: 0,
        failed: 0,
        killed: {
          parent: 0,
          user: 0,
          system: 0,
        },
        refused: {
          depth_limit: 0,
          concurrency_limit: 0,
          budget: 0,
        },
        by_type: {},
      },
      safety_stops: 0,
      is_error: true,
      num_turns: 1,
      subtype: "success",
      api_error_status: null,
      result: "Not logged in · Please run /login",
      type: "result",
      duration_ms: 96,
      uuid: "5c7dcd2b-6fd5-462e-9c77-9bc8bf846d1b",
      queued_turn_count: 0,
      result_index: 0,
    },
  },
];
export const fixture_claudeInheritedRequests: IChatEvent[] = [
  {
    sequence: 1,
    payload: {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "initialize-one",
        response: {},
        pending_permission_requests: [
          {
            type: "control_request",
            request_id: "inherited",
            request: { subtype: "can_use_tool", tool_name: "Read", input: { file_path: "example.txt" } },
          },
        ],
        pending_user_dialog_requests: [
          {
            type: "control_request",
            request_id: "dialog-one",
            request: { subtype: "request_user_dialog", title: "Native dialog" },
          },
        ],
      },
    },
  },
  {
    sequence: 2,
    payload: {
      type: "control_request",
      request_id: "inherited",
      request: { subtype: "can_use_tool", tool_name: "Read", input: { file_path: "example.txt" } },
    },
  },
];

export const fixture_claudeEchoFailure: readonly IChatEvent[] = [
  {
    sequence: 8,
    payload: {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Reply with exactly DEVHOST_CHAT_ECHO_OK. Do not use any tools or modify files.",
          },
        ],
      },
      session_id: "906e8e84-864a-4741-8657-b4a6f8809257",
      parent_tool_use_id: null,
      uuid: "5b0c4097-da0a-496d-8064-bfb63cbfe196",
      timestamp: "2026-10-21T07:48:46.831Z",
      isReplay: true,
    },
  },
  {
    sequence: 9,
    payload: {
      type: "assistant",
      message: {
        diagnostics: null,
        id: "f3b6dbe1-2212-4afe-b3cb-124e22324092",
        container: null,
        model: "<synthetic>",
        role: "assistant",
        stop_details: null,
        stop_reason: "stop_sequence",
        stop_sequence: "",
        type: "message",
        usage: {
          output_tokens_details: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: {
            web_search_requests: 0,
            web_fetch_requests: 0,
          },
          service_tier: null,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
          inference_geo: null,
          iterations: null,
          speed: null,
          fallback_credit: null,
        },
        content: [
          {
            type: "text",
            text: "Not logged in · Please run /login",
          },
        ],
        context_management: null,
      },
      parent_tool_use_id: null,
      session_id: "906e8e84-864a-4741-8657-b4a6f8809257",
      uuid: "36a76072-b4a4-4738-b7ab-89f0a11c5f76",
      timestamp: "2026-10-21T07:48:46.871Z",
      error: "authentication_failed",
      is_api_error_message: true,
      user_message_uuid: "5b0c4097-da0a-496d-8064-bfb63cbfe196",
      user_message_uuids: ["5b0c4097-da0a-496d-8064-bfb63cbfe196"],
    },
  },
  {
    sequence: 10,
    payload: {
      duration_api_ms: 0,
      stop_reason: "stop_sequence",
      session_id: "906e8e84-864a-4741-8657-b4a6f8809257",
      total_cost_usd: 0,
      usage: {
        output_tokens_details: {
          thinking_tokens: 0,
        },
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0,
        },
        service_tier: "standard",
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        inference_geo: "",
        iterations: [],
        speed: "standard",
        fallback_credit: null,
      },
      modelUsage: {},
      permission_denials: [],
      terminal_reason: "api_error",
      fast_mode_state: "off",
      fast_mode_disabled_reason: "sdk_opt_in_required",
      subagent_stats: {
        spawned: 0,
        requested: {
          background: 0,
          foreground: 0,
          unset: 0,
        },
        started_in_background: 0,
        max_depth: 0,
        spawned_by_subagents: 0,
        completed: 0,
        failed: 0,
        killed: {
          parent: 0,
          user: 0,
          system: 0,
        },
        refused: {
          depth_limit: 0,
          concurrency_limit: 0,
          budget: 0,
        },
        by_type: {},
      },
      safety_stops: 0,
      is_error: true,
      num_turns: 1,
      subtype: "success",
      api_error_status: null,
      result: "Not logged in · Please run /login",
      type: "result",
      duration_ms: 62,
      uuid: "5a841508-897f-4025-bba3-fd8a3aca8915",
      user_message_uuid: "5b0c4097-da0a-496d-8064-bfb63cbfe196",
      user_message_uuids: ["5b0c4097-da0a-496d-8064-bfb63cbfe196"],
      queued_turn_count: 0,
      result_index: 0,
    },
  },
];
