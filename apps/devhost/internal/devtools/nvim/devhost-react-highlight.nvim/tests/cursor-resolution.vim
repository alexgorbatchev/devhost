execute "set runtimepath^=" . fnameescape($DEVHOST_REACT_HIGHLIGHT_PLUGIN_ROOT)
set filetype=typescriptreact
lua require("devhost-react-highlight").setup({ endpoint = vim.env.DEVHOST_REACT_HIGHLIGHT_URL, token = vim.env.DEVHOST_CONTROL_TOKEN, project_root = vim.env.DEVHOST_PROJECT_ROOT, debounce_ms = 10 })
lua vim.api.nvim_win_set_cursor(0, {3, 4}); vim.api.nvim_exec_autocmds("CursorMoved", {})
sleep 100m
lua vim.api.nvim_win_set_cursor(0, {5, 6}); vim.api.nvim_exec_autocmds("CursorMoved", {})
sleep 100m
lua vim.api.nvim_win_set_cursor(0, {6, 6}); vim.api.nvim_exec_autocmds("CursorMoved", {})
sleep 100m
lua vim.api.nvim_win_set_cursor(0, {1, 0}); vim.api.nvim_exec_autocmds("CursorMoved", {})
sleep 300m
qa
