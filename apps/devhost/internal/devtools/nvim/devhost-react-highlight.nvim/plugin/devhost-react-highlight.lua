local endpoint = vim.env.DEVHOST_REACT_HIGHLIGHT_URL

if endpoint ~= nil and endpoint ~= "" then
  require("devhost-react-highlight").setup()
end
