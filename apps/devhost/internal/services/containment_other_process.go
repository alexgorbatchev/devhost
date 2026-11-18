//go:build !linux && !darwin

package services

func processIsLive(pid int) bool {
	return processExistsBySignal(pid)
}

// readProcessRecord reports whether some process has pid. This platform has no start identity to read, so the record
// leaves it empty, as readProcessSnapshot does.
func readProcessRecord(pid int) (processRecord, bool) {
	return processRecord{}, processExistsBySignal(pid)
}
