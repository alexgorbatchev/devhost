package nativebrowser

import (
	"context"
	"fmt"
	"time"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/remote"
)

const observationInterval = 500 * time.Millisecond

// Run owns one explicit document connection. No browser or target is created;
// every attached context detaches on cancellation, including existing native
// extension targets. Separate documents keep their own connection lifetimes.
func Run(ctx context.Context, options Options, binding Binding, requests <-chan Request, publish func(Update) error) error {
	endpoint, err := ResolveEndpoint(ctx, options.Endpoint)
	if err != nil {
		return fmt.Errorf("Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.")
	}
	allocator, stopAllocator := remote.NewAllocator(ctx, endpoint, remote.NoModifyURL, remote.WithDialTimeout(operationTimeout))
	owner, stopOwner := chromedp.NewContext(allocator, chromedp.WithDetachOnCancel())
	defer func() {
		connection := chromedp.FromContext(owner).Browser
		stopOwner()
		stopAllocator()
		chromedp.FromContext(allocator).Allocator.Wait()
		if connection != nil {
			<-connection.LostConnection
		}
	}()
	deadline := time.AfterFunc(operationTimeout, stopOwner)
	_, err = chromedp.Targets(owner)
	defer deadline.Stop()
	if err != nil {
		return fmt.Errorf("Cannot connect to the configured browser. Check its debugging endpoint.")
	}
	call, cancel := context.WithTimeout(owner, operationTimeout)
	version, err := chromedp.CallBrowser(call, browser.GetVersion, cdp.Empty{})
	cancel()
	if err != nil {
		return fmt.Errorf("Cannot read the native browser version.")
	}
	contexts := map[target.ID]context.Context{}
	stops := map[target.ID]context.CancelFunc{}
	defer func() {
		for _, stop := range stops {
			stop()
		}
	}()
	var revision uint64
	var knownWindow target.ID
	lost := false
	previous := State{}
	ticker := time.NewTicker(observationInterval)
	defer ticker.Stop()
	refresh := func(id string, open bool) error {
		budget := time.AfterFunc(operationTimeout, stopOwner)
		defer budget.Stop()
		observed, err := observeConnection(owner, options, binding, version.Product, contexts, stops)
		if err != nil {
			return fmt.Errorf("Native browser observation failed; disconnect and check browser availability.")
		}
		if knownWindow != "" && observed.isWindowObserved && observed.window != knownWindow {
			lost = true
		}
		if observed.window != "" {
			knownWindow = observed.window
		}
		observed.state.NativeSessionLost = lost
		observed.state.ReactAvailable = observed.state.ReactAvailable && !lost
		actionError := ""
		if lost {
			observed.state.Message = "The native React session was lost. Inspection recovery is unverified; this connection cannot reopen it."
		}
		if open {
			if !observed.state.ReactAvailable {
				actionError = "React native access is unavailable for this exact document."
			} else {
				action, cancel := context.WithTimeout(owner, operationTimeout)
				window, openErr := chromedp.CallBrowser(action, target.OpenDevTools, target.OpenDevToolsParams{TargetID: observed.host})
				cancel()
				if openErr != nil {
					actionError = "The browser could not open native DevTools. Its experimental Target.openDevTools command may be unavailable."
				} else {
					knownWindow = window.TargetID
					observed.state.NativeWindowOpen = true
				}
			}
		}
		if id == "" && observed.state == previous {
			return nil
		}
		revision++
		previous = observed.state
		return publish(Update{Type: "state", ID: id, Revision: revision, State: &observed.state, Error: actionError})
	}
	if err := refresh(options.InitialRequestID, false); err != nil {
		return err
	}
	deadline.Stop()
	for {
		select {
		case <-owner.Done():
			return nil
		case <-ticker.C:
			if err := refresh("", false); err != nil {
				return err
			}
		case request, ok := <-requests:
			if !ok {
				return nil
			}
			if request.Binding != binding {
				return fmt.Errorf("A stale document command was rejected.")
			}
			if request.Command != "open-react" && request.Command != "refresh" {
				return fmt.Errorf("Unknown native browser command.")
			}
			if err := refresh(request.ID, request.Command == "open-react"); err != nil {
				return err
			}
		}
	}
}

type connectionObservation struct {
	state            State
	host             target.ID
	window           target.ID
	extension        target.ID
	isWindowObserved bool
}

func observeConnection(ctx context.Context, options Options, binding Binding, product string, contexts map[target.ID]context.Context, stops map[target.ID]context.CancelFunc) (connectionObservation, error) {
	result := connectionObservation{state: State{Connected: true, DocumentState: "unbound", BrowserVersion: product, Message: "The exact project document is not present in the configured browser."}}
	defer func() {
		for id, stop := range stops {
			if id != result.host && id != result.extension {
				stop()
				delete(stops, id)
				delete(contexts, id)
			}
		}
	}()
	allowed, err := options.AllowsURL(binding.Href)
	if err != nil || !allowed {
		result.state.Message = "This document no longer belongs to the active project route."
		return result, nil
	}
	call, cancel := context.WithTimeout(ctx, operationTimeout)
	infos, err := chromedp.Targets(call)
	cancel()
	if err != nil {
		return result, err
	}
	present := map[target.ID]bool{}
	for _, info := range infos {
		present[info.TargetID] = true
	}
	for id, stop := range stops {
		if !present[id] {
			stop()
			delete(stops, id)
			delete(contexts, id)
		}
	}
	var hostState hostObservation
	matches := 0
	for _, info := range infos {
		if !isNativePage(info, binding.Href) {
			continue
		}
		attached, err := retainNativeTarget(ctx, info.TargetID, contexts, stops)
		if err != nil {
			result.state.Message = "A matching browser page could not be attached. Disconnect browser control and check that the project document and browser are still available."
			return result, nil
		}
		observed, err := observeNativeHost(attached, binding)
		if err != nil {
			result.state.Message = "A matching project document could not be observed. Disconnect browser control and check that the project document and browser are still available."
			return result, nil
		}
		if !observed.Matches {
			continue
		}
		matches++
		result.host = info.TargetID
		hostState = observed
	}
	if matches != 1 {
		result.host = ""
		if matches > 1 {
			result.state.DocumentState = "ambiguous"
			result.state.Message = "More than one browser page has this exact document identity. No native target was selected."
		}
		return result, nil
	}
	result.state.DocumentState = "bound"
	if product != supportedBrowserProduct {
		result.state.Message = "This browser version is outside the tested Chrome 154.0.8037.92 native-window contract."
		return result, nil
	}
	call, cancel = context.WithTimeout(ctx, operationTimeout)
	window, err := chromedp.CallBrowser(call, target.GetDevToolsTarget, target.GetDevToolsTargetParams{TargetID: result.host})
	cancel()
	if err != nil {
		result.state.Message = "The browser does not expose the required native DevTools target API."
		return result, nil
	}
	result.isWindowObserved = true
	result.window = window.TargetID
	result.state.NativeWindowOpen = window.TargetID != ""
	if hostState.HostRoots == 0 {
		result.state.Message = nativeDocumentMessage(hostState)
		return result, nil
	}
	extension := false
	for _, info := range infos {
		worker := isReactExtensionWorker(info, options.ReactExtensionID)
		frontend := info.Type == "iframe" && info.URL == "chrome-extension://"+options.ReactExtensionID+"/main.html" && nativeTargetDescendsFrom(info, window.TargetID, infos)
		if !worker && !frontend {
			continue
		}
		attached, err := retainNativeTarget(ctx, info.TargetID, contexts, stops)
		if err != nil {
			continue
		}
		supported, err := observeReactExtension(attached)
		if err == nil && supported {
			extension = true
			result.extension = info.TargetID
			break
		}
	}
	result.state.ReactAvailable = extension
	result.state.Message = extensionStateMessage(extension)
	return result, nil
}

func retainNativeTarget(ctx context.Context, id target.ID, contexts map[target.ID]context.Context, stops map[target.ID]context.CancelFunc) (context.Context, error) {
	if attached := contexts[id]; attached != nil {
		return attached, nil
	}
	attached, cancel, err := attachNativeTarget(ctx, id)
	if err != nil {
		return nil, err
	}
	contexts[id], stops[id] = attached, cancel
	return attached, nil
}

func nativeTargetDescendsFrom(info *target.Info, ancestor target.ID, infos []*target.Info) bool {
	if ancestor == "" {
		return false
	}
	visited := map[target.ID]bool{}
	parent := info.ParentID
	for parent != "" && !visited[parent] {
		if parent == ancestor {
			return true
		}
		visited[parent] = true
		next := target.ID("")
		for _, candidate := range infos {
			if candidate.TargetID == parent {
				next = candidate.ParentID
				break
			}
		}
		parent = next
	}
	return false
}
