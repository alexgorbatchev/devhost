package caddy

import "os"

// SetStackReady completes the detached-start handshake in the existing atomic
// ownership record, after the supervisor has checked health and routing.
func SetStackReady(paths Paths, urls []string) error {
	return withStackRecordsLock(paths.StacksDirectoryPath, func() error {
		data, err := os.ReadFile(getStackRecordPath(paths.StacksDirectoryPath))
		if err != nil {
			return err
		}
		record, err := parseStackRecord(data)
		if err != nil {
			return err
		}
		record.Ready, record.URLs = true, urls
		return writeStackRecord(paths.StacksDirectoryPath, record)
	})
}
