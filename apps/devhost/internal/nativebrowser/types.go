package nativebrowser

type Binding struct {
	InstanceID string `json:"instanceId"`
	DocumentID string `json:"documentId"`
	Href       string `json:"href"`
}

type Request struct {
	ID      string  `json:"id"`
	Command string  `json:"command"`
	Binding Binding `json:"binding"`
}

type State struct {
	Connected         bool   `json:"isConnected"`
	DocumentState     string `json:"documentState"`
	ReactAvailable    bool   `json:"isReactAvailable"`
	NativeWindowOpen  bool   `json:"isNativeWindowOpen"`
	NativeSessionLost bool   `json:"isNativeSessionLost"`
	BrowserVersion    string `json:"browserVersion"`
	Message           string `json:"message"`
}

type Update struct {
	Type     string `json:"type"`
	ID       string `json:"id,omitempty"`
	Revision uint64 `json:"revision,omitempty"`
	State    *State `json:"state,omitempty"`
	Error    string `json:"error,omitempty"`
}

type Options struct {
	Endpoint         string
	ReactExtensionID string
	InitialRequestID string
	AllowsURL        func(string) (bool, error)
}
