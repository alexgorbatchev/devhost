# License source overrides

The `include_dir` and `include_dir_macros` 0.7.4 crate archives omit their MIT
license text. Both archives record upstream commit
`d742c6fffce99ee89da91b934e7ce6fb2a82680c` in `.cargo_vcs_info.json`.
`include_dir-0.7.4-MIT.txt` is the unchanged root `LICENSE` at that revision:

<https://github.com/Michael-F-Bryan/include_dir/blob/d742c6fffce99ee89da91b934e7ce6fb2a82680c/LICENSE>

The candidate packager uses this override only for those exact versions and
repository. Other compiled dependencies must carry their own nonempty license
text. Missing texts fail the build.
