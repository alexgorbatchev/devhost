package devtools

import "testing"

func TestParseAgentStatusOSC(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		carryover string
		chunk     string
		want      parsedAgentStatusOSC
	}{
		{
			name:  "parses working with BEL terminator",
			chunk: "\x1b]1337;SetAgentStatus=working\x07",
			want:  parsedAgentStatusOSC{carryover: "", statuses: []agentSessionStatus{agentSessionStatusWorking}},
		},
		{
			name:  "parses finished with ST terminator",
			chunk: "\x1b]1337;SetAgentStatus=finished\x1b\\",
			want:  parsedAgentStatusOSC{carryover: "", statuses: []agentSessionStatus{agentSessionStatusFinished}},
		},
		{
			name:  "parses multiple statuses in one chunk",
			chunk: "before\x1b]1337;SetAgentStatus=working\x07middle\x1b]1337;SetAgentStatus=finished\x07after",
			want: parsedAgentStatusOSC{
				carryover: "after",
				statuses:  []agentSessionStatus{agentSessionStatusWorking, agentSessionStatusFinished},
			},
		},
		{
			name:  "keeps split prefix in carryover",
			chunk: "noise\x1b]1337;SetAgentSta",
			want:  parsedAgentStatusOSC{carryover: "oise\x1b]1337;SetAgentSta", statuses: []agentSessionStatus{}},
		},
		{
			name:      "parses split terminator",
			carryover: "\x1b]1337;SetAgentStatus=finished\x1b",
			chunk:     "\\tail",
			want:      parsedAgentStatusOSC{carryover: "tail", statuses: []agentSessionStatus{agentSessionStatusFinished}},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := parseAgentStatusOSC(tc.carryover, tc.chunk); !equalParsedAgentStatusOSC(got, tc.want) {
				t.Fatalf("parseAgentStatusOSC(%q, %q) = %#v, want %#v", tc.carryover, tc.chunk, got, tc.want)
			}
		})
	}
}

func equalParsedAgentStatusOSC(left parsedAgentStatusOSC, right parsedAgentStatusOSC) bool {
	if left.carryover != right.carryover || len(left.statuses) != len(right.statuses) {
		return false
	}
	for index := range left.statuses {
		if left.statuses[index] != right.statuses[index] {
			return false
		}
	}
	return true
}
