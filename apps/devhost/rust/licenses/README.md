# License source overrides

The `include_dir` and `include_dir_macros` 0.7.4 crate archives omit their MIT
license text. Both archives record upstream commit
`d742c6fffce99ee89da91b934e7ce6fb2a82680c` in `.cargo_vcs_info.json`.
`include_dir-0.7.4-MIT.txt` is the unchanged root `LICENSE` at that revision:

<https://github.com/Michael-F-Bryan/include_dir/blob/d742c6fffce99ee89da91b934e7ce6fb2a82680c/LICENSE>

The `objc2-core-foundation`, `objc2-core-services` and `objc2-io-kit` 0.3.2
archives omit their workspace license file. Each archive records upstream commit
`7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` in `.cargo_vcs_info.json`.
`objc2-frameworks-0.3.2-LICENSE.md` is the unchanged root license declaration:

<https://github.com/madsmtm/objc2/blob/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/LICENSE.md>

These crates offer `Zlib OR Apache-2.0 OR MIT`. The notices retain the upstream
declaration, including its Apple SDK notice, and the complete Apache 2.0 text
from <https://www.apache.org/licenses/LICENSE-2.0.txt>.

The candidate packager selects overrides only for the exact package names,
versions and repositories above. Other compiled dependencies must carry their
own nonempty license text. Missing texts fail the build.
