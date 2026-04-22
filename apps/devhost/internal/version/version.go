package version

const placeholderVersion = "dev"

var buildVersion = placeholderVersion

func String() string {
	return buildVersion
}
