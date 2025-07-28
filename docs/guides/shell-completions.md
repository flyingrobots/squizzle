# Shell Completions

SQUIZZLE provides shell completion scripts for bash, zsh, fish, and PowerShell to enhance your command-line experience with intelligent tab completion.

## Quick Start

Generate and install completions for your shell:

```bash
# Bash
squizzle completion --shell bash > ~/.bash_completion.d/squizzle
source ~/.bash_completion.d/squizzle

# Zsh
squizzle completion --shell zsh > ~/.zsh/completions/_squizzle
# Ensure ~/.zsh/completions is in your fpath

# Fish
squizzle completion --shell fish > ~/.config/fish/completions/squizzle.fish

# PowerShell
squizzle completion --shell powershell | Out-String | Invoke-Expression
# To persist, add to your $PROFILE
```

## Features

Shell completions provide:

- **Command suggestions**: All available SQUIZZLE commands
- **Option completion**: Flags and options for each command
- **Version completion**: Available versions from your registry
- **Smart suggestions**: Context-aware completions based on command

### Examples

```bash
# Complete commands
squizzle <TAB>
# Shows: init build apply rollback status verify list config completion

# Complete options
squizzle build <TAB>
# Shows: available options like --notes, --author, --tag, --dry-run

# Complete versions for apply
squizzle apply <TAB>
# Shows: 1.0.0 1.1.0 1.2.0 (from your registry)

# Complete shell types
squizzle completion --shell <TAB>
# Shows: bash zsh fish powershell
```

## Installation by Shell

### Bash

For bash, you have several options:

1. **User-specific (recommended)**:
```bash
# Create completions directory if it doesn't exist
mkdir -p ~/.bash_completion.d

# Generate completion script
squizzle completion --shell bash > ~/.bash_completion.d/squizzle

# Add to ~/.bashrc to load on startup
echo 'source ~/.bash_completion.d/squizzle' >> ~/.bashrc

# Reload your shell
source ~/.bashrc
```

2. **System-wide** (requires root):
```bash
sudo squizzle completion --shell bash > /etc/bash_completion.d/squizzle
```

3. **Direct sourcing**:
```bash
# Add to ~/.bashrc
eval "$(squizzle completion --shell bash)"
```

### Zsh

Zsh uses a more sophisticated completion system:

1. **Using completion directory**:
```bash
# Create custom completions directory
mkdir -p ~/.zsh/completions

# Generate completion
squizzle completion --shell zsh > ~/.zsh/completions/_squizzle

# Add to ~/.zshrc (before compinit)
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

2. **Oh My Zsh users**:
```bash
# Use Oh My Zsh custom directory
squizzle completion --shell zsh > ~/.oh-my-zsh/custom/plugins/squizzle/_squizzle
```

3. **Direct sourcing**:
```bash
# Add to ~/.zshrc
eval "$(squizzle completion --shell zsh)"
```

### Fish

Fish has the simplest installation:

```bash
# Generate to standard completions directory
squizzle completion --shell fish > ~/.config/fish/completions/squizzle.fish

# Completions are loaded automatically
```

### PowerShell

PowerShell completions work on Windows, macOS, and Linux:

1. **Add to profile**:
```powershell
# Find your profile location
$PROFILE

# Edit your profile
notepad $PROFILE  # Windows
code $PROFILE     # VS Code
nano $PROFILE     # Linux/macOS

# Add this line to your profile
squizzle completion --shell powershell | Out-String | Invoke-Expression
```

2. **Manual loading**:
```powershell
# Load completions for current session
squizzle completion --shell powershell | Out-String | Invoke-Expression
```

## Troubleshooting

### Completions not working

1. **Check if completions are loaded**:
```bash
# Bash
complete -p | grep squizzle

# Zsh
print -l ${(ok)_comps} | grep squizzle

# Fish
complete -c squizzle

# PowerShell
Get-Command TabExpansion2
```

2. **Reload your shell**:
```bash
# Bash/Zsh
exec $SHELL

# Fish
exec fish

# PowerShell
. $PROFILE
```

3. **Verify installation path**:
```bash
# Check if completion file exists
ls ~/.bash_completion.d/squizzle    # Bash
ls ~/.zsh/completions/_squizzle     # Zsh
ls ~/.config/fish/completions/squizzle.fish  # Fish
```

### Zsh specific issues

If completions aren't working in Zsh:

1. **Check fpath**:
```bash
echo $fpath
```

2. **Ensure compinit is called**:
```bash
# Add to ~/.zshrc
autoload -Uz compinit
compinit
```

3. **Clear completion cache**:
```bash
rm -f ~/.zcompdump*
compinit
```

### Version suggestions not showing

Version completions require access to your registry:

```bash
# Check if you can list versions
squizzle list

# Ensure you're authenticated
docker login your-registry.com
```

## Advanced Usage

### Custom completion behavior

You can extend the completion scripts for your workflow:

```bash
# Example: Add custom version aliases
_squizzle_custom_versions() {
  echo "latest"
  echo "stable"
  squizzle list 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'
}
```

### Integration with other tools

Combine SQUIZZLE completions with other CLI tools:

```bash
# Example: fzf integration for version selection
squizzle apply $(squizzle list | fzf)
```

## Updating Completions

When SQUIZZLE is updated with new commands or options, regenerate your completions:

```bash
# Bash example
squizzle completion --shell bash > ~/.bash_completion.d/squizzle
source ~/.bash_completion.d/squizzle
```

Consider adding this to your update routine or CI/CD pipeline.