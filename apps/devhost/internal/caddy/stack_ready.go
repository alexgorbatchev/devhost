package caddy

import "os"

// SetStackReady publishes readiness and current URLs in the atomic ownership
// record for detached startup and remote previews.
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
