package main

import (
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/logpolicy"
	"golang.org/x/tools/go/analysis/singlechecker"
)

func main() { singlechecker.Main(logpolicy.Analyzer) }
