package output

import (
	"bytes"
	f "fmt"
	"io"
	"log"      // want "use cliout"
	"log/slog" // want "use cliout"
	"net/http"
	"os"
	"strings"
)

func output(w io.Writer, response http.ResponseWriter, file *os.File) {
	f.Println("bypass")                // want "use cliout"
	(f.Printf)("parenthesized bypass") // want "use cliout"
	f.Fprintf(w, "bypass")             // want "use cliout"
	io.WriteString(w, "bypass")        // want "use cliout"
	w.Write([]byte("bypass"))          // want "use cliout"
	os.Stderr.WriteString("bypass")    // want "use cliout"
	stderr := os.Stderr
	stderr.Write([]byte("bypass")) // want "use cliout"
	printf := f.Printf             // want "use cliout"
	printf("bypass")
	printer := f.Fprintf // want "use cliout"
	printer(w, "bypass")
	writeString := io.WriteString // want "use cliout"
	writeString(w, "bypass")
	write := w.Write // want "use cliout"
	write([]byte("bypass"))
	println("bypass")                             // want "use cliout"
	_ = f.Sprintf("[%s] %s", "worker", "message") // want "use cliout"
	_ = f.Sprintf("WARNING: stale")               // want "use cliout"
	_ = f.Sprintf("[devhost] duplicated")         // want "use cliout"
	log.Print("bypass")
	slog.Info("bypass")
	var text strings.Builder
	f.Fprintln(&text, "document")
	var buffer bytes.Buffer
	f.Fprint(&buffer, "payload")
	io.WriteString(response, "HTTP body")
	file.Write([]byte("file contents"))
	_ = f.Errorf("failure: %s", "context")
}
