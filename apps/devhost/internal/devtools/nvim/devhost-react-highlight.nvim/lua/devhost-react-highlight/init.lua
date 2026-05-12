local M = {}

local sign_group = "DevhostReactHighlight"
local sign_name = "DevhostReactHighlightCurrent"
local sign_id = 1

local state = {
  config = nil,
  indicator = nil,
  timer = nil,
  last_locator = nil,
}

local function merge_config(options)
  options = options or {}

  return {
    endpoint = options.endpoint or vim.env.DEVHOST_REACT_HIGHLIGHT_URL or "",
    token = options.token or vim.env.DEVHOST_CONTROL_TOKEN or "",
    project_root = options.project_root or vim.env.DEVHOST_PROJECT_ROOT or vim.fn.getcwd(),
    stack_name = options.stack_name or vim.env.DEVHOST_STACK_NAME or "",
    debounce_ms = options.debounce_ms or 150,
  }
end

local function normalize_path(path)
  return (path or ""):gsub("\\", "/")
end

local function relative_path(path, project_root)
  local normalized_path = normalize_path(path)
  local normalized_root = normalize_path(project_root):gsub("/+$", "")

  if normalized_root == "" then
    return normalized_path
  end

  local prefix = normalized_root .. "/"
  if normalized_path:sub(1, #prefix) == prefix then
    return normalized_path:sub(#prefix + 1)
  end

  return normalized_path
end

local function filetype_language(filetype)
  if filetype == "typescriptreact" then
    return "tsx"
  end

  if filetype == "javascriptreact" then
    return "javascript"
  end

  return nil
end

local function is_jsx_node(node)
  local node_type = node:type()
  return node_type == "jsx_element" or node_type == "jsx_opening_element" or node_type == "jsx_self_closing_element"
end

local function nearest_jsx_node(node)
  local current = node

  while current ~= nil do
    if is_jsx_node(current) then
      if current:type() == "jsx_element" then
        local child = current:named_child(0)
        return child or current
      end
      return current
    end

    current = current:parent()
  end

  return nil
end

local function next_jsx_node_on_line(bufnr, row, column, language)
  local line = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
  if line == nil then
    return nil
  end

  local search_start = column + 1
  local tag_start = line:find("<", search_start, true)
  if tag_start == nil then
    return nil
  end

  local is_closing_tag = line:sub(tag_start + 1, tag_start + 1) == "/"
  local tag_column = tag_start - 1
  local ok, node = pcall(vim.treesitter.get_node, { bufnr = bufnr, pos = { row, tag_column }, lang = language })
  if not ok or node == nil then
    return nil
  end

  local jsx_node = nearest_jsx_node(node)
  if jsx_node == nil then
    return nil
  end

  local start_row, start_column = jsx_node:range()
  if not is_closing_tag and (start_row ~= row or start_column < column) then
    return nil
  end

  if is_closing_tag and start_row > row then
    return nil
  end

  return jsx_node
end

local function resolve_jsx_node_at_cursor(bufnr, row, column, language)
  local ok, node = pcall(vim.treesitter.get_node, { bufnr = bufnr, pos = { row, column }, lang = language })

  if not ok or node == nil then
    return nil
  end

  if node:type() == "jsx_element" then
    return next_jsx_node_on_line(bufnr, row, column, language)
  end

  return nearest_jsx_node(node)
end

local function clear_indicator()
  vim.fn.sign_unplace(sign_group)
  state.indicator = nil
end

local function show_indicator(bufnr, line)
  if state.indicator ~= nil and state.indicator.bufnr == bufnr and state.indicator.line == line then
    return
  end

  clear_indicator()
  vim.fn.sign_place(sign_id, sign_group, sign_name, bufnr, { lnum = line, priority = 30 })
  state.indicator = { bufnr = bufnr, line = line }
end

local function resolve_locator()
  local bufnr = vim.api.nvim_get_current_buf()
  local filetype = vim.bo[bufnr].filetype
  local language = filetype_language(filetype)

  if language == nil then
    return nil
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local row = cursor[1] - 1
  local column = cursor[2]
  local jsx_node = resolve_jsx_node_at_cursor(bufnr, row, column, language)
  if jsx_node == nil then
    return nil
  end

  local start_row, start_column = jsx_node:range()
  local file = relative_path(vim.api.nvim_buf_get_name(bufnr), state.config.project_root)

  return {
    bufnr = bufnr,
    line = start_row + 1,
    locator = ("%s:%d:%d"):format(file, start_row + 1, start_column + 1),
  }
end

local function handle_post_result(locator_result, success)
  vim.schedule(function()
    if not success then
      clear_indicator()
      return
    end

    if locator_result == nil then
      clear_indicator()
      return
    end

    show_indicator(locator_result.bufnr, locator_result.line)
  end)
end

local function post_payload(locator_result)
  local locator = vim.NIL
  if locator_result ~= nil then
    locator = locator_result.locator
  end

  local body = vim.json.encode({ locator = locator })
  local command = {
    "curl",
    "--fail",
    "--silent",
    "--show-error",
    "--request",
    "POST",
    "--header",
    "content-type: application/json",
    "--header",
    "x-devhost-control-token: " .. state.config.token,
    "--data",
    body,
    state.config.endpoint,
  }

  if vim.system ~= nil then
    vim.system(command, { text = true }, function(completed)
      handle_post_result(locator_result, completed.code == 0)
    end)
    return
  end

  vim.fn.jobstart(command, {
    detach = true,
    on_exit = function(_, code)
      handle_post_result(locator_result, code == 0)
    end,
  })
end

local function emit_cursor()
  local locator_result = resolve_locator()
  local locator = nil
  if locator_result ~= nil then
    locator = locator_result.locator
  end

  if locator == state.last_locator then
    return
  end

  state.last_locator = locator
  post_payload(locator_result)
end

local function schedule_cursor_emit()
  if state.timer ~= nil then
    state.timer:stop()
    state.timer:close()
  end

  local uv = vim.uv or vim.loop
  state.timer = uv.new_timer()
  state.timer:start(state.config.debounce_ms, 0, vim.schedule_wrap(emit_cursor))
end

function M.setup(options)
  state.config = merge_config(options)

  if state.config.endpoint == "" or state.config.token == "" then
    return
  end

  vim.fn.sign_define(sign_name, { text = "->", texthl = "Search" })

  local group = vim.api.nvim_create_augroup("DevhostReactHighlight", { clear = true })

  vim.api.nvim_create_autocmd({ "BufEnter", "CursorMoved", "CursorMovedI" }, {
    group = group,
    callback = schedule_cursor_emit,
  })

  vim.api.nvim_create_autocmd({ "BufLeave", "VimLeavePre" }, {
    group = group,
    callback = clear_indicator,
  })

  schedule_cursor_emit()
end

return M
