package caddy

import (
	"strings"
	"testing"
)

func TestWriteCaddyOutput(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		output string
		failed bool
		want   string
	}{
		{
			name:   "truststore skips absent Firefox and Java stores",
			output: "2026/10/19 23:31:49.199\tINFO\tnot NSS security databases found\n2026/10/19 23:31:49.199\tINFO\tdefine JAVA_HOME environment variable to use the Java trust\n",
			failed: true,
		},
		{
			name:   "devhost reports trust installation itself",
			output: `{"level":"warn","ts":1,"logger":"pki.ca.local","msg":"installing root certificate (you might be prompted for password)","path":"storage:pki/authorities/local/root.crt"}` + "\n" + "2026/10/19 23:31:51.513\tINFO\tcertificate installed properly in macOS keychain\n" + `{"level":"info","ts":1,"logger":"pki.ca.local","msg":"root certificate is already trusted by system","path":"storage:pki/authorities/local/root.crt"}` + "\n" + `{"level":"info","ts":1,"logger":"pki.ca.local","msg":"root certificate trust store installation disabled; unconfigured clients may show warnings","path":"storage:pki/authorities/local/root.crt"}` + "\n",
			failed: true,
		},
		{
			name:   "devhost reports the started Caddy itself",
			output: "Successfully started Caddy (pid=50697) - Caddy is running in the background\n",
		},
		{
			name:   "devhost generates the Caddyfile and its catch-all site",
			output: `{"level":"warn","ts":1,"msg":"Caddyfile input is not formatted; run 'caddy fmt --overwrite' to fix inconsistencies","adapter":"caddyfile","line":2}` + "\n" + `{"level":"warn","ts":1,"logger":"tls","msg":"YOUR SERVER MAY BE VULNERABLE TO ABUSE: on-demand TLS is enabled, but no protections are in place","docs":"https://caddyserver.com/docs/automatic-https#on-demand-tls"}` + "\n" + `{"level":"warn","ts":1,"msg":"No files matching import glob pattern","pattern":"/state/caddy/routes/*.caddy"}` + "\n",
		},
		{
			name:   "routine entries are quiet after success",
			output: `{"level":"info","ts":1,"logger":"admin","msg":"admin endpoint started","address":"127.0.0.1:39181"}` + "\n",
		},
		{
			name:   "routine entries explain a failure",
			output: `{"level":"info","ts":1,"logger":"admin","msg":"admin endpoint started","address":"127.0.0.1:39181","enforce_origin":false}` + "\n",
			failed: true,
			want:   "[caddy] admin: admin endpoint started address=127.0.0.1:39181 enforce_origin=false\n",
		},
		{
			name:   "warnings are shown after success",
			output: `{"level":"warn","ts":1,"logger":"tls","msg":"stapling OCSP","identifiers":["a.localhost"]}` + "\n",
			want:   "[caddy] WARN tls: stapling OCSP identifiers=[\"a.localhost\"]\n",
		},
		{
			name:   "console errors keep their fields",
			output: "2026/10/19 23:31:49.199\tERROR\tpki.ca.local\tfailed to install root certificate\t{\"error\":\"exit status 1\"}\r\n",
			failed: true,
			want:   "[caddy] ERROR pki.ca.local failed to install root certificate {\"error\":\"exit status 1\"}\n",
		},
		{
			name:   "plain lines are shown as they are",
			output: "diagnostic\n\nsecond line",
			want:   "[caddy] diagnostic\n[caddy] second line\n",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var output strings.Builder
			if err := writeCaddyOutput(&output, []byte(tc.output), tc.failed); err != nil {
				t.Fatal(err)
			}
			if got := output.String(); got != tc.want {
				t.Fatalf("writeCaddyOutput(...) = %q, want %q", got, tc.want)
			}
		})
	}
}
