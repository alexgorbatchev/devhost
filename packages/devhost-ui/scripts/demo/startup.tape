Output "raw/startup.mp4"
Require devhost
Set Shell "bash"
Set Width 1280
Set Height 720
Set FontSize 22
Set FontFamily "DejaVu Sans Mono, Noto Color Emoji"
Set Padding 32
Set Framerate 30
Set CursorBlink false
Set TypingSpeed 65ms
Env AGENT "0"
Hide
Type@0ms "export PS1='> '"
Enter
Wait+Line@5s />$/
Ctrl+L
Sleep 300ms
Show
Type "devhost start"
Enter
Wait+Screen@30s /\[Devhost demo\] web \(primary\): https:/
Sleep 6s
Screenshot "startup.png"
Sleep 300ms
Hide
Ctrl+C
Wait+Line@30s />$/
