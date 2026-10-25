package devtools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

// chatJournal retains complete native replay on disk. The session lock serializes
// appends and snapshots; replay uses a section reader rather than loading history.
type chatJournal struct {
	file     *os.File
	size     int64
	sequence uint64
	err      error
}

func newChatJournal() (*chatJournal, error) {
	file, err := os.CreateTemp("", "devhost-chat-*.json")
	if err != nil {
		return nil, fmt.Errorf("create chat replay: %w", err)
	}
	// The open descriptor retains replay on supported Unix hosts. Unlinking now
	// also reclaims it after a crash, rather than leaving conversations in /tmp.
	if err := os.Remove(file.Name()); err != nil {
		_ = file.Close() // Preserve the unlink error; no session owns this file yet.
		return nil, fmt.Errorf("unlink chat replay: %w", err)
	}
	return &chatJournal{file: file}, nil
}

func (j *chatJournal) append(raw json.RawMessage) error {
	if j.err != nil {
		return j.err
	}
	data, err := json.Marshal(chatEvent{Sequence: j.sequence + 1, Payload: raw})
	if err != nil {
		return err
	}
	if j.sequence > 0 {
		data = append([]byte(",\n"), data...)
	}
	n, err := j.file.Write(data)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	if err != nil {
		j.err = fmt.Errorf("retain chat replay: %w", err)
		return j.err
	}
	j.size += int64(n)
	j.sequence++
	return nil
}

func (j *chatJournal) reader() io.Reader {
	return io.NewSectionReader(j.file, 0, j.size)
}

func (j *chatJournal) remove() error {
	if j.file == nil {
		return nil
	}
	file := j.file
	j.file = nil
	return file.Close()
}

// writeChatSnapshotLocked streams one complete snapshot under both the session
// lock and the client's write lock, before that client joins live publication.
func (c *websocketClient) writeChatSnapshotLocked(s *chatSession) error {
	metadata, err := json.Marshal(chatMessage{Type: "snapshot", SessionID: s.info.ID, Session: s.infoCopyLocked(), PendingRequestIDs: s.pendingIDsLocked()})
	if err != nil {
		return err
	}
	if s.events.err != nil {
		return s.events.err
	}
	reader := io.MultiReader(
		bytes.NewReader(metadata[:len(metadata)-1]),
		strings.NewReader(`,"events":[`),
		s.events.reader(),
		strings.NewReader("]}"),
	)
	return c.writeTextReaderLocked(reader)
}
