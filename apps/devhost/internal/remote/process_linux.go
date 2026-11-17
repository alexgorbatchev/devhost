//go:build linux

package remote

import "github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"

func processExited(pid int) bool {
	stat, err := procid.ReadStat(pid)
	return err == nil && (stat.State == 'Z' || stat.State == 'X')
}
