package devtools

import "strings"

type agentSessionStatus string

const (
	agentSessionStatusWorking  agentSessionStatus = "working"
	agentSessionStatusFinished agentSessionStatus = "finished"
	agentStatusOscPrefix                          = "\x1b]1337;SetAgentStatus="
	agentStatusOscBEL                             = "\x07"
	agentStatusOscST                              = "\x1b\\"
)

type parsedAgentStatusOSC struct {
	carryover string
	statuses  []agentSessionStatus
}

func parseAgentStatusOSC(carryover string, outputChunk string) parsedAgentStatusOSC {
	combinedOutput := carryover + outputChunk
	statuses := []agentSessionStatus{}
	searchStart := 0

	for searchStart < len(combinedOutput) {
		prefixIndex := strings.Index(combinedOutput[searchStart:], agentStatusOscPrefix)
		if prefixIndex == -1 {
			unmatchedSuffix := combinedOutput[searchStart:]
			return parsedAgentStatusOSC{
				carryover: retainStringTail(unmatchedSuffix, len(agentStatusOscPrefix)),
				statuses:  statuses,
			}
		}

		prefixIndex += searchStart
		terminatorStart, terminatorEnd, ok := readAgentStatusOSCTerminator(combinedOutput, prefixIndex+len(agentStatusOscPrefix))
		if !ok {
			return parsedAgentStatusOSC{
				carryover: combinedOutput[prefixIndex:],
				statuses:  statuses,
			}
		}

		statusText := combinedOutput[prefixIndex+len(agentStatusOscPrefix) : terminatorStart]
		if status := parseAgentSessionStatus(statusText); status != nil {
			statuses = append(statuses, *status)
		}
		searchStart = terminatorEnd
	}

	return parsedAgentStatusOSC{
		carryover: retainStringTail(combinedOutput[searchStart:], len(agentStatusOscPrefix)),
		statuses:  statuses,
	}
}

func readAgentStatusOSCTerminator(text string, startIndex int) (int, int, bool) {
	if startIndex > len(text) {
		return 0, 0, false
	}

	searchText := text[startIndex:]
	belIndex := strings.Index(searchText, agentStatusOscBEL)
	stIndex := strings.Index(searchText, agentStatusOscST)
	if belIndex == -1 && stIndex == -1 {
		return 0, 0, false
	}

	if belIndex != -1 && (stIndex == -1 || belIndex < stIndex) {
		start := startIndex + belIndex
		return start, start + len(agentStatusOscBEL), true
	}

	start := startIndex + stIndex
	return start, start + len(agentStatusOscST), true
}

func parseAgentSessionStatus(value string) *agentSessionStatus {
	status := agentSessionStatus(value)
	if status != agentSessionStatusWorking && status != agentSessionStatusFinished {
		return nil
	}
	return &status
}

func retainStringTail(value string, maximumLength int) string {
	if len(value) <= maximumLength {
		return value
	}
	return value[len(value)-maximumLength:]
}
