package websocket

import "io"

// The analyzer needs the native method's type identity, not a network server.
type Conn struct{}

func (*Conn) NextWriter(int) (io.WriteCloser, error) { return nil, nil }
