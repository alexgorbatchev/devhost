#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 4 ]]; then
    echo 'Usage: verifyRustCandidates.sh <candidate directory> <Go oracle checkout> <repaired Go binary> <new evidence directory>' >&2
    exit 2
fi
candidate_directory="$(cd "$1" && pwd -P)"
oracle_directory="$(cd "$2" && pwd -P)"
repaired_binary="$3"
evidence_directory="$4"
mkdir "$evidence_directory"
evidence_directory="$(cd "$evidence_directory" && pwd -P)"
cp "$candidate_directory/provenance.json" "$evidence_directory/distribution-provenance.json"
cp "$candidate_directory/SHA256SUMS" "$evidence_directory/SHA256SUMS"
(
    cd "$candidate_directory"
    shasum -a 256 --check SHA256SUMS
)
extraction_directory="$(mktemp -d "${TMPDIR:-/tmp}/dhc.XXXXXX")"
trap 'rm -rf "$extraction_directory"' EXIT
host="$(uname -s)-$(uname -m)"
bun -e '
    const provenance = await Bun.file(Bun.argv[1]).json();
    if (!Array.isArray(provenance.artifacts) || !provenance.artifacts.length) throw new Error("No candidate artifacts");
    for (const artifact of provenance.artifacts) {
        if (!/^(linux-(x64|arm64)(-musl)?|darwin-arm64)$/.test(artifact.target) ||
            !/^devhost-v[0-9]+\.[0-9]+\.[0-9]+-(linux-(x64|arm64)(-musl)?|darwin-arm64)\.tar\.gz$/.test(artifact.archive) ||
            !/^[a-f0-9]{64}$/.test(artifact.binarySha256)) throw new Error("Invalid candidate provenance");
        console.log([artifact.target, artifact.archive, artifact.binarySha256].join("\t"));
    }
' "$candidate_directory/provenance.json" > "$extraction_directory/manifest"
while IFS=$'\t' read -r target archive expected_hash; do
    case "$host:$target" in
        Linux-x86_64:linux-x64|Linux-x86_64:linux-x64-musl|Linux-aarch64:linux-arm64|Linux-aarch64:linux-arm64-musl|Darwin-arm64:darwin-arm64) ;;
        *) echo "Distribution target $target does not match native host $host" >&2; exit 1 ;;
    esac
    mkdir "$extraction_directory/$target"
    tar -xzf "$candidate_directory/$archive" -C "$extraction_directory/$target"
    binary="$extraction_directory/$target/${archive%.tar.gz}/devhost"
    printf '%s  %s\n' "$expected_hash" "$binary" | shasum -a 256 --check
    just rust comparisons "$oracle_directory" "$repaired_binary" "$binary" "$evidence_directory/$target"
    rm -rf "$extraction_directory/$target"
done < "$extraction_directory/manifest"
