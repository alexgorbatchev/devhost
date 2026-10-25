// Package logpolicy enforces the CLI output boundary using resolved Go types.
package logpolicy

import (
	"go/ast"
	"go/constant"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
)

const outputPackage = "github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
const diagnostic = "use cliout for terminal output and log records"

var Analyzer = &analysis.Analyzer{
	Name: "logpolicy",
	Doc:  "require devhost diagnostics and command output to pass through cliout",
	Run:  run,
}

func run(pass *analysis.Pass) (any, error) {
	if pass.Pkg.Path() == outputPackage {
		return nil, nil
	}
	origins := make(map[types.Object][]ast.Expr)
	for _, file := range pass.Files {
		for obj, values := range assignments(pass, file) {
			origins[obj] = append(origins[obj], values...)
		}
	}
	for _, file := range pass.Files {
		if strings.HasSuffix(pass.Fset.Position(file.Pos()).Filename, "_test.go") {
			continue
		}
		for _, spec := range file.Imports {
			if spec.Path.Value == `"log"` || spec.Path.Value == `"log/slog"` {
				pass.Reportf(spec.Pos(), diagnostic)
			}
		}
		called := make(map[ast.Expr]bool)
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			called[call.Fun] = true
			checkCall(pass, call, origins)
			return true
		})
		// Reject function-value aliases as well as direct calls: moving fmt.Fprintf
		// into a variable must not hide an output site from this rule.
		ast.Inspect(file, func(node ast.Node) bool {
			expr, ok := node.(ast.Expr)
			if !ok {
				return true
			}
			if called[expr] {
				return false
			}
			fn := function(pass, expr)
			if fn != nil && fn.Pkg() != nil && ((fn.Pkg().Path() == "fmt" && strings.Contains(" Print Printf Println Fprint Fprintf Fprintln ", " "+fn.Name()+" ")) || (fn.Pkg().Path() == "io" && strings.Contains(" WriteString Copy CopyBuffer CopyN ", " "+fn.Name()+" "))) {
				pass.Reportf(expr.Pos(), diagnostic)
			}
			if selector, ok := expr.(*ast.SelectorExpr); ok && fn != nil && (fn.Name() == "Write" || fn.Name() == "WriteString") && outputSink(pass, selector.X, origins) {
				pass.Reportf(expr.Pos(), diagnostic)
			}
			// A selector's identifier is the same function object; inspect it once.
			_, selector := expr.(*ast.SelectorExpr)
			return !selector
		})
	}
	return nil, nil
}

func function(pass *analysis.Pass, expr ast.Expr) *types.Func {
	var obj types.Object
	switch value := ast.Unparen(expr).(type) {
	case *ast.Ident:
		obj = pass.TypesInfo.ObjectOf(value)
	case *ast.SelectorExpr:
		obj = pass.TypesInfo.ObjectOf(value.Sel)
	}
	fn, _ := obj.(*types.Func)
	return fn
}

func checkCall(pass *analysis.Pass, call *ast.CallExpr, origins map[types.Object][]ast.Expr) {
	if name, ok := call.Fun.(*ast.Ident); ok {
		if builtin, ok := pass.TypesInfo.ObjectOf(name).(*types.Builtin); ok && (builtin.Name() == "print" || builtin.Name() == "println") {
			pass.Reportf(call.Pos(), diagnostic)
			return
		}
	}
	fn := function(pass, call.Fun)
	if fn == nil || fn.Pkg() == nil {
		return
	}
	pkg, name := fn.Pkg().Path(), fn.Name()
	if pkg == "fmt" && name == "Sprintf" && len(call.Args) > 0 {
		checkPrefix(pass, call.Args[0])
	}
	if pkg == outputPackage && (name == "Log" || name == "WriteLog") && len(call.Args) > 2 {
		checkPrefix(pass, call.Args[2])
	}
	if pkg == "fmt" && (name == "Print" || name == "Printf" || name == "Println") {
		pass.Reportf(call.Pos(), diagnostic)
		return
	}
	if (pkg == "fmt" && (name == "Fprint" || name == "Fprintf" || name == "Fprintln")) || (pkg == "io" && (name == "WriteString" || name == "Copy" || name == "CopyBuffer" || name == "CopyN")) {
		if len(call.Args) > 0 && outputSink(pass, call.Args[0], origins) {
			pass.Reportf(call.Pos(), diagnostic)
		}
		return
	}
	if selector, ok := call.Fun.(*ast.SelectorExpr); ok && (name == "Write" || name == "WriteString") && outputSink(pass, selector.X, origins) {
		pass.Reportf(call.Pos(), diagnostic)
	}
}

func checkPrefix(pass *analysis.Pass, expr ast.Expr) {
	value := pass.TypesInfo.Types[expr].Value
	if value == nil || value.Kind() != constant.String {
		return
	}
	text := constant.StringVal(value)
	for _, prefix := range []string{"[%s] ", "[devhost] ", "[caddy] ", "WARNING: ", "WARN: ", "ERR: ", "[WARN] ", "[ERROR] ", "[INFO] "} {
		if strings.HasPrefix(text, prefix) {
			pass.Reportf(expr.Pos(), diagnostic)
			return
		}
	}
}

func outputSink(pass *analysis.Pass, expr ast.Expr, origins map[types.Object][]ast.Expr) bool {
	if terminal(pass, expr, origins, make(map[types.Object]bool)) {
		return true
	}
	if websocketWriter(pass, expr, origins, make(map[types.Object]bool)) {
		return false
	}
	t := pass.TypesInfo.TypeOf(expr)
	if t == nil {
		return false
	}
	if _, ok := t.Underlying().(*types.Interface); !ok {
		return false
	}
	// HTTP response bodies have a separate protocol and must stay byte-exact.
	if named, ok := types.Unalias(t).(*types.Named); ok && named.Obj().Pkg() != nil && named.Obj().Pkg().Path() == "net/http" && named.Obj().Name() == "ResponseWriter" {
		return false
	}
	return true
}

// NextWriter returns an interface, but writes native WebSocket frames rather
// than terminal output. Follow aliases so callers can stream large payloads.
func websocketWriter(pass *analysis.Pass, expr ast.Expr, origins map[types.Object][]ast.Expr, seen map[types.Object]bool) bool {
	switch value := expr.(type) {
	case *ast.ParenExpr:
		return websocketWriter(pass, value.X, origins, seen)
	case *ast.CallExpr:
		fn := function(pass, value.Fun)
		return fn != nil && fn.Pkg() != nil && fn.Pkg().Path() == "github.com/gorilla/websocket" && fn.Name() == "NextWriter"
	case *ast.Ident:
		obj := pass.TypesInfo.ObjectOf(value)
		if obj == nil || seen[obj] || len(origins[obj]) == 0 {
			return false
		}
		seen[obj] = true
		defer delete(seen, obj)
		for _, origin := range origins[obj] {
			if !websocketWriter(pass, origin, origins, seen) {
				return false
			}
		}
		return true
	}
	return false
}

func terminal(pass *analysis.Pass, expr ast.Expr, origins map[types.Object][]ast.Expr, seen map[types.Object]bool) bool {
	var obj types.Object
	switch value := expr.(type) {
	case *ast.ParenExpr:
		return terminal(pass, value.X, origins, seen)
	case *ast.SelectorExpr:
		obj = pass.TypesInfo.ObjectOf(value.Sel)
	case *ast.Ident:
		obj = pass.TypesInfo.ObjectOf(value)
	}
	if obj == nil || seen[obj] {
		return false
	}
	seen[obj] = true
	if obj.Pkg() != nil && obj.Pkg().Path() == "os" && (obj.Name() == "Stdout" || obj.Name() == "Stderr") {
		return true
	}
	for _, origin := range origins[obj] {
		if terminal(pass, origin, origins, seen) {
			return true
		}
	}
	return false
}

func assignments(pass *analysis.Pass, file *ast.File) map[types.Object][]ast.Expr {
	result := make(map[types.Object][]ast.Expr)
	ast.Inspect(file, func(node ast.Node) bool {
		var names []ast.Expr
		var values []ast.Expr
		switch value := node.(type) {
		case *ast.AssignStmt:
			names, values = value.Lhs, value.Rhs
		case *ast.ValueSpec:
			for _, name := range value.Names {
				names = append(names, name)
			}
			values = value.Values
		}
		if len(names) == len(values) {
			for i, name := range names {
				if id, ok := name.(*ast.Ident); ok {
					obj := pass.TypesInfo.ObjectOf(id)
					result[obj] = append(result[obj], values[i])
				}
			}
		}
		if len(names) > 1 && len(values) == 1 {
			if id, ok := names[0].(*ast.Ident); ok {
				obj := pass.TypesInfo.ObjectOf(id)
				result[obj] = append(result[obj], values[0])
			}
		}
		return true
	})
	return result
}
