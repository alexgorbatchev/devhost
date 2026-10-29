module github.com/alexgorbatchev/devhost/apps/devhost

go 1.26.7

require github.com/BurntSushi/toml v1.5.0

require (
	github.com/alexgorbatchev/cobra-help-tree/v3 v3.0.0
	github.com/charmbracelet/x/ansi v0.11.9
	github.com/chromedp/cdproto v0.157.8
	github.com/chromedp/chromedp v0.20.0
	github.com/creack/pty v1.1.24
	github.com/fsnotify/fsnotify v1.10.1
	github.com/gorilla/websocket v1.5.3
	github.com/hashicorp/consul/sdk v0.18.2
	github.com/lucasb-eyer/go-colorful v1.4.1
	github.com/shirou/gopsutil/v4 v4.26.9
	github.com/spf13/cobra v1.10.2
	golang.org/x/sys v0.48.0
	golang.org/x/term v0.45.0
	golang.org/x/tools v0.50.0
)

require (
	github.com/clipperhouse/displaywidth v0.11.0 // indirect
	github.com/clipperhouse/uax29/v2 v2.7.0 // indirect
	github.com/ebitengine/purego v0.11.1 // indirect
	github.com/go-json-experiment/json v0.0.0-20260213210345-44df1a37e875 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0 // indirect
	github.com/mattn/go-runewidth v0.0.30 // indirect
	github.com/nishanths/predeclared v0.3.0 // indirect
	github.com/power-devops/perfstat v0.0.0-20260805114148-88456608a4f6 // indirect
	github.com/tklauser/go-sysconf v0.4.0 // indirect
	github.com/tklauser/numcpus v0.12.0 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	golang.org/x/mod v0.41.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
)

require (
	github.com/GiGurra/boa v1.0.25
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.10 // indirect
)

tool (
	github.com/alexgorbatchev/devhost/apps/devhost/cmd/logpolicy
	github.com/nishanths/predeclared
)
