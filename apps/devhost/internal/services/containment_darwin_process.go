//go:build darwin

package services

func processIsLive(pid int) bool {
	return processExistsBySignal(pid)
}
