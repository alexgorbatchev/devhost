package nativebrowser

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

const operationTimeout = 5 * time.Second
const supportedReactVersion = "19.2.5"
const supportedReactExtensionVersion = "8.0.0"
const supportedBrowserProduct = "Chrome/154.0.8037.92"

// This reads the maintained hook/Fiber root contract without adding a backend,
// registering a renderer, subscribing to the hook, or changing the host tree.
const observeHostFunction = `function(binding, supportedVersion) {
 const result = { matches: false, hostRoots: 0, unsupportedRoots: 0 };
 if (location.href !== binding.href) return result;
 const markers = [...document.querySelectorAll("[data-devhost-devtools]")];
 const roots = markers.flatMap(marker => [marker, ...(marker.shadowRoot ? marker.shadowRoot.querySelectorAll("[data-devhost-devtools]") : [])]);
 const matching = roots.filter(root => root.getAttribute("data-devhost-native-instance") === binding.instanceId && root.getAttribute("data-devhost-native-document") === binding.documentId);
 if (matching.length !== 1) return result;
 result.matches = true;
 const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
 if (!hook || !(hook.renderers instanceof Map) || typeof hook.getFiberRoots !== "function") return result;
 for (const [id, renderer] of hook.renderers) {
  const fiberRoots = hook.getFiberRoots(id);
  if (!(fiberRoots instanceof Set)) continue;
  for (const root of fiberRoots) {
   const container = root.containerInfo;
   if (!(container instanceof Element) && !(container instanceof ShadowRoot)) { result.unsupportedRoots++; continue; }
   const host = container instanceof ShadowRoot ? container.host : container;
   const containingRoot = host.getRootNode();
   const shadowHost = containingRoot instanceof ShadowRoot ? containingRoot.host : null;
   if (host.closest("[data-devhost-devtools]") || (shadowHost && shadowHost.closest("[data-devhost-devtools]"))) continue;
   if (renderer.version !== supportedVersion) { result.unsupportedRoots++; continue; }
   if (host.isConnected) result.hostRoots++;
  }
 }
 return result;
}`

type hostObservation struct {
	Matches          bool `json:"matches"`
	HostRoots        int  `json:"hostRoots"`
	UnsupportedRoots int  `json:"unsupportedRoots"`
}

type extensionManifest struct {
	Version      string `json:"version"`
	DevtoolsPage string `json:"devtools_page"`
	Background   struct {
		ServiceWorker string `json:"service_worker"`
	} `json:"background"`
}

func attachNativeTarget(ctx context.Context, id target.ID) (context.Context, context.CancelFunc, error) {
	attached, cancel := chromedp.NewContext(ctx, chromedp.WithTargetID(id), chromedp.WithDetachOnCancel())
	// Target.run belongs to its initialization context. A disposable operation
	// timeout must never become the persistent target's lifecycle owner.
	deadline := time.AfterFunc(operationTimeout, cancel)
	err := chromedp.Do(attached)
	deadline.Stop()
	if err != nil {
		cancel()
		return nil, nil, fmt.Errorf("attach native target: %w", err)
	}
	return attached, cancel, nil
}

func observeNativeHost(ctx context.Context, binding Binding) (hostObservation, error) {
	call, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	global, err := chromedp.Run(call, chromedp.Evaluate[*runtime.RemoteObject]("globalThis"))
	if err != nil {
		return hostObservation{}, err
	}
	observation, observeErr := chromedp.Run(call, chromedp.CallFunctionOn[hostObservation](observeHostFunction, func(params *runtime.CallFunctionOnParams) {
		params.ObjectID = global.ObjectID
	}, binding, supportedReactVersion))
	_, releaseErr := chromedp.Call(call, runtime.ReleaseObject, runtime.ReleaseObjectParams{ObjectID: global.ObjectID})
	return observation, errors.Join(observeErr, releaseErr)
}

func observeReactExtension(ctx context.Context) (bool, error) {
	call, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	m, err := chromedp.Run(call, chromedp.Evaluate[extensionManifest]("chrome.runtime.getManifest()"))
	if err != nil {
		return false, err
	}
	return m.Version == supportedReactExtensionVersion && m.DevtoolsPage == "main.html" && m.Background.ServiceWorker == "build/background.js", nil
}

func isReactExtensionWorker(info *target.Info, id string) bool {
	return info.Type == "service_worker" && info.URL == "chrome-extension://"+id+"/build/background.js"
}

func extensionStateMessage(available bool) string {
	if !available {
		return "React Developer Tools 8.0.0 is missing, disabled, suspended, or unverified in this browser."
	}
	return "React host and extension detected. Open native DevTools, then select Components or Profiler to verify live inspection there."
}

func nativeDocumentMessage(observation hostObservation) string {
	if observation.UnsupportedRoots > 0 {
		return "A host renderer or root container is outside the tested React DOM 19.2.5 Element/ShadowRoot contract."
	}
	return "No mounted React host was detected. The devhost toolbar does not count as a host application."
}

func isNativePage(info *target.Info, href string) bool {
	return info.Type == "page" && info.Subtype == "" && info.URL == href && !strings.HasPrefix(href, "devtools://")
}
