// Package procid tells one process from a later one that was given the same
// PID. A PID names a process only while it runs; the start identity read here
// names it for good, so a record that stores both can be checked against the
// process that now answers to the PID.
package procid
