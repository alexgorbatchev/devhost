use std::io::{self, Write};

use clap::Command;
use clap_complete::Shell;

pub fn command() -> Command {
    Command::new("completion")
        .about("Generate the autocompletion script for the specified shell")
        .long_about("Generate the autocompletion script for devhost for the specified shell.\nSee each subcommand's help for installation instructions.")
        .subcommands([
            shell_command("bash", BASH_HELP),
            shell_command("zsh", ZSH_HELP),
            shell_command("fish", FISH_HELP),
            shell_command("powershell", POWERSHELL_HELP),
        ])
}

fn shell_command(name: &'static str, help: &'static str) -> Command {
    Command::new(name)
        .args_override_self(true)
        .about(match name {
            "bash" => "Generate the autocompletion script for bash",
            "zsh" => "Generate the autocompletion script for zsh",
            "fish" => "Generate the autocompletion script for fish",
            _ => "Generate the autocompletion script for powershell",
        })
        .long_about(help)
        .arg(super::boolean_arg("no-descriptions").help("Disable completion descriptions"))
}

pub fn write(
    shell: Shell,
    root: &Command,
    descriptions: bool,
    output: &mut impl Write,
) -> io::Result<()> {
    let mut command = root.clone();
    command.build();
    if !descriptions {
        command = without_descriptions(command);
    }
    // The generator's infallible API can panic on a failed output writer.
    // Buffer its output so terminal write failures remain ordinary I/O errors.
    let mut script = Vec::new();
    clap_complete::generate(shell, &mut command, "devhost", &mut script);
    output.write_all(&script)
}

fn without_descriptions(command: Command) -> Command {
    command
        .about(None)
        .long_about(None)
        .mut_args(|arg| arg.help(None).long_help(None))
        .mut_subcommands(without_descriptions)
}

pub fn shell(name: &str) -> Shell {
    match name {
        "bash" => Shell::Bash,
        "zsh" => Shell::Zsh,
        "fish" => Shell::Fish,
        "powershell" => Shell::PowerShell,
        _ => unreachable!("completion command defines only the four supported shells"),
    }
}

const BASH_HELP: &str = "Generate the autocompletion script for the bash shell.\n\nLoad completions in the current session:\n  source <(devhost completion bash)\n\nInstall for future sessions (create the directory if needed):\n  mkdir -p ~/.local/share/bash-completion/completions\n  devhost completion bash > ~/.local/share/bash-completion/completions/devhost\n\nEnable bash-completion in your shell startup file to load installed completions.\nStart a new shell after installation.";
const ZSH_HELP: &str = "Generate the autocompletion script for the zsh shell.\n\nEnable completion once in ~/.zshrc:\n  autoload -U compinit; compinit\n\nLoad completions in the current session:\n  source <(devhost completion zsh)\n\nInstall for future sessions in a writable directory on $fpath:\n  devhost completion zsh > \"${fpath[1]}/_devhost\"\n\nOn macOS with Homebrew:\n  devhost completion zsh > $(brew --prefix)/share/zsh/site-functions/_devhost\n\nStart a new shell after installation.";
const FISH_HELP: &str = "Generate the autocompletion script for the fish shell.\n\nLoad completions in the current session:\n  devhost completion fish | source\n\nInstall for future sessions:\n  mkdir -p ~/.config/fish/completions\n  devhost completion fish > ~/.config/fish/completions/devhost.fish\n\nStart a new shell after installation.";
const POWERSHELL_HELP: &str = "Generate the autocompletion script for PowerShell.\n\nLoad completions in the current session:\n  devhost completion powershell | Out-String | Invoke-Expression\n\nFor future sessions, add the command above to your PowerShell profile ($PROFILE).";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_output_is_returned_without_panicking() {
        struct RefuseOutput;
        impl Write for RefuseOutput {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::from(io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let error = write(Shell::Bash, &command(), true, &mut RefuseOutput).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
    }
}
