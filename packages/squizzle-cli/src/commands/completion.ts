import chalk from 'chalk'

export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell'

interface CompletionOptions {
  shell: ShellType
}

/**
 * Generate shell completion script for SQUIZZLE CLI
 */
export async function completionCommand(options: CompletionOptions): Promise<void> {
  const { shell } = options
  
  const script = generateCompletion(shell)
  console.log(script)
  
  // Print installation instructions to stderr so they don't interfere with script output
  console.error(chalk.dim(`\n# To install ${shell} completions:`))
  console.error(chalk.dim(getInstallationInstructions(shell)))
}

/**
 * Generate completion script for the specified shell
 */
export function generateCompletion(shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion()
    case 'zsh':
      return generateZshCompletion()
    case 'fish':
      return generateFishCompletion()
    case 'powershell':
      return generatePowerShellCompletion()
    default:
      throw new Error(`Unsupported shell: ${shell}`)
  }
}

/**
 * Generate Bash completion script
 */
function generateBashCompletion(): string {
  return `#!/usr/bin/env bash
# Bash completion script for SQUIZZLE

_squizzle_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="init build apply rollback status verify list ls config completion help"
  local global_opts="-c --config -e --env -v --verbose --no-banner -h --help -V --version"

  # First argument - complete commands
  if [ $cword -eq 1 ]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  # Get the command
  local cmd="${words[1]}"

  # Command-specific completions
  case "$cmd" in
    build)
      case "$prev" in
        build)
          # Complete version - suggest next version
          local versions=$(squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V | tail -1)
          if [ -n "$versions" ]; then
            local major=$(echo $versions | cut -d. -f1)
            local minor=$(echo $versions | cut -d. -f2)
            local patch=$(echo $versions | cut -d. -f3)
            local next_patch=$((patch + 1))
            local next_minor=$((minor + 1))
            local next_major=$((major + 1))
            COMPREPLY=($(compgen -W "$major.$minor.$next_patch $major.$next_minor.0 $next_major.0.0" -- "$cur"))
          else
            COMPREPLY=($(compgen -W "0.0.1 0.1.0 1.0.0" -- "$cur"))
          fi
          ;;
        -n|--notes|-a|--author)
          # No completion for free text
          ;;
        -t|--tag)
          COMPREPLY=($(compgen -W "schema data security performance" -- "$cur"))
          ;;
        *)
          COMPREPLY=($(compgen -W "-n --notes -a --author -t --tag --dry-run $global_opts" -- "$cur"))
          ;;
      esac
      ;;
    
    apply|rollback|verify)
      case "$prev" in
        apply|rollback|verify)
          # Complete with available versions
          local versions=$(squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V)
          COMPREPLY=($(compgen -W "$versions" -- "$cur"))
          ;;
        --timeout)
          COMPREPLY=($(compgen -W "30000 60000 300000 600000" -- "$cur"))
          ;;
        --max-parallel)
          COMPREPLY=($(compgen -W "1 5 10 20" -- "$cur"))
          ;;
        *)
          local opts=""
          case "$cmd" in
            apply)
              opts="-f --force --dry-run --timeout --parallel --max-parallel"
              ;;
            rollback)
              opts="-f --force --dry-run"
              ;;
            verify)
              opts="--json"
              ;;
          esac
          COMPREPLY=($(compgen -W "$opts $global_opts" -- "$cur"))
          ;;
      esac
      ;;
    
    status)
      case "$prev" in
        -l|--limit)
          COMPREPLY=($(compgen -W "5 10 20 50 100" -- "$cur"))
          ;;
        *)
          COMPREPLY=($(compgen -W "-l --limit --json $global_opts" -- "$cur"))
          ;;
      esac
      ;;
    
    list|ls)
      COMPREPLY=($(compgen -W "--json $global_opts" -- "$cur"))
      ;;
    
    config)
      COMPREPLY=($(compgen -W "--init --validate --show $global_opts" -- "$cur"))
      ;;
    
    completion)
      case "$prev" in
        --shell)
          COMPREPLY=($(compgen -W "bash zsh fish powershell" -- "$cur"))
          ;;
        *)
          COMPREPLY=($(compgen -W "--shell $global_opts" -- "$cur"))
          ;;
      esac
      ;;
    
    init)
      COMPREPLY=($(compgen -W "$global_opts" -- "$cur"))
      ;;
    
    *)
      COMPREPLY=($(compgen -W "$global_opts" -- "$cur"))
      ;;
  esac
}

complete -F _squizzle_completions squizzle`
}

/**
 * Generate Zsh completion script
 */
function generateZshCompletion(): string {
  return `#compdef squizzle
# Zsh completion script for SQUIZZLE

_squizzle() {
  local line state

  _arguments -C \\
    "-c[Config file path]:path:_files" \\
    "--config[Config file path]:path:_files" \\
    "-e[Environment to use]:environment:(development staging production)" \\
    "--env[Environment to use]:environment:(development staging production)" \\
    "-v[Verbose output]" \\
    "--verbose[Verbose output]" \\
    "--no-banner[Disable banner]" \\
    "-h[Show help]" \\
    "--help[Show help]" \\
    "-V[Show version]" \\
    "--version[Show version]" \\
    "1: :_squizzle_commands" \\
    "*::arg:->args"

  case $line[1] in
    build)
      _squizzle_build
      ;;
    apply)
      _squizzle_apply
      ;;
    rollback)
      _squizzle_rollback
      ;;
    status)
      _squizzle_status
      ;;
    verify)
      _squizzle_verify
      ;;
    list|ls)
      _squizzle_list
      ;;
    config)
      _squizzle_config
      ;;
    completion)
      _squizzle_completion
      ;;
  esac
}

_squizzle_commands() {
  local commands=(
    'init:Initialize SQUIZZLE in your project'
    'build:Build a new database version'
    'apply:Apply a database version'
    'rollback:Rollback a database version'
    'status:Show database version status'
    'verify:Verify a database version can be applied'
    'list:List available versions'
    'config:Manage SQUIZZLE configuration'
    'completion:Generate shell completion script'
  )
  _describe 'command' commands
}

_squizzle_build() {
  _arguments \\
    '1:version:_squizzle_next_version' \\
    '-n[Version notes]:notes:' \\
    '--notes[Version notes]:notes:' \\
    '-a[Version author]:author:' \\
    '--author[Version author]:author:' \\
    '-t[Version tags]:tags:(schema data security performance)' \\
    '--tag[Version tags]:tags:(schema data security performance)' \\
    '--dry-run[Simulate build without creating artifacts]'
}

_squizzle_apply() {
  _arguments \\
    '1:version:_squizzle_versions' \\
    '-f[Force apply even if checks fail]' \\
    '--force[Force apply even if checks fail]' \\
    '--dry-run[Simulate apply without running migrations]' \\
    '--timeout[Migration timeout in milliseconds]:timeout:(30000 60000 300000 600000)' \\
    '--parallel[Run independent migrations in parallel]' \\
    '--max-parallel[Max parallel migrations]:number:(1 5 10 20)'
}

_squizzle_rollback() {
  _arguments \\
    '1:version:_squizzle_versions' \\
    '-f[Force rollback without confirmation]' \\
    '--force[Force rollback without confirmation]' \\
    '--dry-run[Simulate rollback]'
}

_squizzle_status() {
  _arguments \\
    '-l[Limit number of versions shown]:limit:(5 10 20 50 100)' \\
    '--limit[Limit number of versions shown]:limit:(5 10 20 50 100)' \\
    '--json[Output as JSON]'
}

_squizzle_verify() {
  _arguments \\
    '1:version:_squizzle_versions' \\
    '--json[Output as JSON]'
}

_squizzle_list() {
  _arguments \\
    '--json[Output as JSON]'
}

_squizzle_config() {
  _arguments \\
    '--init[Initialize config file]' \\
    '--validate[Validate config file]' \\
    '--show[Show current config]'
}

_squizzle_completion() {
  _arguments \\
    '--shell[Shell type]:shell:(bash zsh fish powershell)'
}

# Helper function to get available versions
_squizzle_versions() {
  local versions
  versions=(${(f)"$(squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V)"})
  _describe -t versions 'version' versions
}

# Helper function to suggest next version
_squizzle_next_version() {
  local versions last_version
  versions=(${(f)"$(squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V)"})
  
  if [ ${#versions[@]} -gt 0 ]; then
    last_version=${versions[-1]}
    local major=$(echo $last_version | cut -d. -f1)
    local minor=$(echo $last_version | cut -d. -f2)
    local patch=$(echo $last_version | cut -d. -f3)
    
    local suggestions=(
      "$major.$minor.$((patch + 1))"
      "$major.$((minor + 1)).0"
      "$((major + 1)).0.0"
    )
    _describe -t versions 'version' suggestions
  else
    local suggestions=("0.0.1" "0.1.0" "1.0.0")
    _describe -t versions 'version' suggestions
  fi
}

_squizzle "$@"`
}

/**
 * Generate Fish completion script
 */
function generateFishCompletion(): string {
  return `# Fish completion script for SQUIZZLE

# Disable file completions by default
complete -c squizzle -f

# Global options
complete -c squizzle -s c -l config -d 'Config file path' -r
complete -c squizzle -s e -l env -d 'Environment to use' -xa 'development staging production'
complete -c squizzle -s v -l verbose -d 'Verbose output'
complete -c squizzle -l no-banner -d 'Disable banner'
complete -c squizzle -s h -l help -d 'Show help'
complete -c squizzle -s V -l version -d 'Show version'

# Commands
complete -c squizzle -n '__fish_use_subcommand' -a init -d 'Initialize SQUIZZLE in your project'
complete -c squizzle -n '__fish_use_subcommand' -a build -d 'Build a new database version'
complete -c squizzle -n '__fish_use_subcommand' -a apply -d 'Apply a database version'
complete -c squizzle -n '__fish_use_subcommand' -a rollback -d 'Rollback a database version'
complete -c squizzle -n '__fish_use_subcommand' -a status -d 'Show database version status'
complete -c squizzle -n '__fish_use_subcommand' -a verify -d 'Verify a database version can be applied'
complete -c squizzle -n '__fish_use_subcommand' -a list -d 'List available versions'
complete -c squizzle -n '__fish_use_subcommand' -a ls -d 'List available versions (alias)'
complete -c squizzle -n '__fish_use_subcommand' -a config -d 'Manage SQUIZZLE configuration'
complete -c squizzle -n '__fish_use_subcommand' -a completion -d 'Generate shell completion script'

# Build command options
complete -c squizzle -n '__fish_seen_subcommand_from build' -a '(__fish_squizzle_next_version)'
complete -c squizzle -n '__fish_seen_subcommand_from build' -s n -l notes -d 'Version notes'
complete -c squizzle -n '__fish_seen_subcommand_from build' -s a -l author -d 'Version author'
complete -c squizzle -n '__fish_seen_subcommand_from build' -s t -l tag -d 'Version tags' -xa 'schema data security performance'
complete -c squizzle -n '__fish_seen_subcommand_from build' -l dry-run -d 'Simulate build without creating artifacts'

# Apply command options
complete -c squizzle -n '__fish_seen_subcommand_from apply' -a '(__fish_squizzle_versions)'
complete -c squizzle -n '__fish_seen_subcommand_from apply' -s f -l force -d 'Force apply even if checks fail'
complete -c squizzle -n '__fish_seen_subcommand_from apply' -l dry-run -d 'Simulate apply without running migrations'
complete -c squizzle -n '__fish_seen_subcommand_from apply' -l timeout -d 'Migration timeout in milliseconds' -xa '30000 60000 300000 600000'
complete -c squizzle -n '__fish_seen_subcommand_from apply' -l parallel -d 'Run independent migrations in parallel'
complete -c squizzle -n '__fish_seen_subcommand_from apply' -l max-parallel -d 'Max parallel migrations' -xa '1 5 10 20'

# Rollback command options
complete -c squizzle -n '__fish_seen_subcommand_from rollback' -a '(__fish_squizzle_versions)'
complete -c squizzle -n '__fish_seen_subcommand_from rollback' -s f -l force -d 'Force rollback without confirmation'
complete -c squizzle -n '__fish_seen_subcommand_from rollback' -l dry-run -d 'Simulate rollback'

# Status command options
complete -c squizzle -n '__fish_seen_subcommand_from status' -s l -l limit -d 'Limit number of versions shown' -xa '5 10 20 50 100'
complete -c squizzle -n '__fish_seen_subcommand_from status' -l json -d 'Output as JSON'

# Verify command options
complete -c squizzle -n '__fish_seen_subcommand_from verify' -a '(__fish_squizzle_versions)'
complete -c squizzle -n '__fish_seen_subcommand_from verify' -l json -d 'Output as JSON'

# List command options
complete -c squizzle -n '__fish_seen_subcommand_from list ls' -l json -d 'Output as JSON'

# Config command options
complete -c squizzle -n '__fish_seen_subcommand_from config' -l init -d 'Initialize config file'
complete -c squizzle -n '__fish_seen_subcommand_from config' -l validate -d 'Validate config file'
complete -c squizzle -n '__fish_seen_subcommand_from config' -l show -d 'Show current config'

# Completion command options
complete -c squizzle -n '__fish_seen_subcommand_from completion' -l shell -d 'Shell type' -xa 'bash zsh fish powershell'

# Helper functions
function __fish_squizzle_versions
    squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V
end

function __fish_squizzle_next_version
    set -l versions (squizzle list 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V)
    if test (count $versions) -gt 0
        set -l last_version $versions[-1]
        set -l parts (string split . $last_version)
        set -l major $parts[1]
        set -l minor $parts[2]
        set -l patch $parts[3]
        
        echo "$major.$minor."(math $patch + 1)
        echo "$major."(math $minor + 1)".0"
        echo (math $major + 1)".0.0"
    else
        echo "0.0.1"
        echo "0.1.0"
        echo "1.0.0"
    end
end`
}

/**
 * Generate PowerShell completion script
 */
function generatePowerShellCompletion(): string {
  return `# PowerShell completion script for SQUIZZLE

using namespace System.Management.Automation
using namespace System.Management.Automation.Language

Register-ArgumentCompleter -Native -CommandName squizzle -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    
    $commands = @{
        'init' = 'Initialize SQUIZZLE in your project'
        'build' = 'Build a new database version'
        'apply' = 'Apply a database version'
        'rollback' = 'Rollback a database version'
        'status' = 'Show database version status'
        'verify' = 'Verify a database version can be applied'
        'list' = 'List available versions'
        'ls' = 'List available versions (alias)'
        'config' = 'Manage SQUIZZLE configuration'
        'completion' = 'Generate shell completion script'
    }
    
    $globalOptions = @(
        [CompletionResult]::new('-c', '-c', 'ParameterName', 'Config file path'),
        [CompletionResult]::new('--config', '--config', 'ParameterName', 'Config file path'),
        [CompletionResult]::new('-e', '-e', 'ParameterName', 'Environment to use'),
        [CompletionResult]::new('--env', '--env', 'ParameterName', 'Environment to use'),
        [CompletionResult]::new('-v', '-v', 'ParameterName', 'Verbose output'),
        [CompletionResult]::new('--verbose', '--verbose', 'ParameterName', 'Verbose output'),
        [CompletionResult]::new('--no-banner', '--no-banner', 'ParameterName', 'Disable banner'),
        [CompletionResult]::new('-h', '-h', 'ParameterName', 'Show help'),
        [CompletionResult]::new('--help', '--help', 'ParameterName', 'Show help'),
        [CompletionResult]::new('-V', '-V', 'ParameterName', 'Show version'),
        [CompletionResult]::new('--version', '--version', 'ParameterName', 'Show version')
    )
    
    # Get available versions from squizzle list
    function Get-SquizzleVersions {
        try {
            $versions = & squizzle list 2>$null | Select-String -Pattern '\\d+\\.\\d+\\.\\d+' -AllMatches
            return $versions.Matches.Value | Sort-Object { [Version]$_ }
        } catch {
            return @()
        }
    }
    
    # Suggest next version
    function Get-NextVersions {
        $versions = Get-SquizzleVersions
        if ($versions.Count -gt 0) {
            $lastVersion = [Version]$versions[-1]
            return @(
                "$($lastVersion.Major).$($lastVersion.Minor).$($lastVersion.Build + 1)"
                "$($lastVersion.Major).$($lastVersion.Minor + 1).0"
                "$($lastVersion.Major + 1).0.0"
            )
        } else {
            return @("0.0.1", "0.1.0", "1.0.0")
        }
    }
    
    # Parse the command line
    $elements = $commandAst.CommandElements
    $command = $null
    $subcommand = $null
    
    for ($i = 1; $i -lt $elements.Count; $i++) {
        $element = $elements[$i].ToString()
        if (-not $element.StartsWith('-')) {
            if ($null -eq $command) {
                $command = $element
            } elseif ($null -eq $subcommand) {
                $subcommand = $element
            }
            break
        }
    }
    
    # Complete based on position
    if ($null -eq $command) {
        # Complete command names
        $commands.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
            [CompletionResult]::new($_.Key, $_.Key, 'Command', $_.Value)
        }
        return
    }
    
    # Command-specific completions
    switch ($command) {
        'build' {
            if ($null -eq $subcommand -and -not $wordToComplete.StartsWith('-')) {
                # Suggest versions
                Get-NextVersions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "Version $_")
                }
            } else {
                # Build options
                @(
                    [CompletionResult]::new('-n', '-n', 'ParameterName', 'Version notes'),
                    [CompletionResult]::new('--notes', '--notes', 'ParameterName', 'Version notes'),
                    [CompletionResult]::new('-a', '-a', 'ParameterName', 'Version author'),
                    [CompletionResult]::new('--author', '--author', 'ParameterName', 'Version author'),
                    [CompletionResult]::new('-t', '-t', 'ParameterName', 'Version tags'),
                    [CompletionResult]::new('--tag', '--tag', 'ParameterName', 'Version tags'),
                    [CompletionResult]::new('--dry-run', '--dry-run', 'ParameterName', 'Simulate build')
                ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
            }
        }
        
        'apply' {
            if ($null -eq $subcommand -and -not $wordToComplete.StartsWith('-')) {
                # Suggest available versions
                Get-SquizzleVersions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "Version $_")
                }
            } else {
                # Apply options
                @(
                    [CompletionResult]::new('-f', '-f', 'ParameterName', 'Force apply'),
                    [CompletionResult]::new('--force', '--force', 'ParameterName', 'Force apply'),
                    [CompletionResult]::new('--dry-run', '--dry-run', 'ParameterName', 'Simulate apply'),
                    [CompletionResult]::new('--timeout', '--timeout', 'ParameterName', 'Migration timeout'),
                    [CompletionResult]::new('--parallel', '--parallel', 'ParameterName', 'Run in parallel'),
                    [CompletionResult]::new('--max-parallel', '--max-parallel', 'ParameterName', 'Max parallel')
                ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
            }
        }
        
        'rollback' {
            if ($null -eq $subcommand -and -not $wordToComplete.StartsWith('-')) {
                # Suggest available versions
                Get-SquizzleVersions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "Version $_")
                }
            } else {
                # Rollback options
                @(
                    [CompletionResult]::new('-f', '-f', 'ParameterName', 'Force rollback'),
                    [CompletionResult]::new('--force', '--force', 'ParameterName', 'Force rollback'),
                    [CompletionResult]::new('--dry-run', '--dry-run', 'ParameterName', 'Simulate rollback')
                ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
            }
        }
        
        'verify' {
            if ($null -eq $subcommand -and -not $wordToComplete.StartsWith('-')) {
                # Suggest available versions
                Get-SquizzleVersions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "Version $_")
                }
            } else {
                # Verify options
                @(
                    [CompletionResult]::new('--json', '--json', 'ParameterName', 'Output as JSON')
                ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
            }
        }
        
        'status' {
            # Status options
            @(
                [CompletionResult]::new('-l', '-l', 'ParameterName', 'Limit results'),
                [CompletionResult]::new('--limit', '--limit', 'ParameterName', 'Limit results'),
                [CompletionResult]::new('--json', '--json', 'ParameterName', 'Output as JSON')
            ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
        }
        
        'list' {
            # List options
            @(
                [CompletionResult]::new('--json', '--json', 'ParameterName', 'Output as JSON')
            ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
        }
        
        'config' {
            # Config options
            @(
                [CompletionResult]::new('--init', '--init', 'ParameterName', 'Initialize config'),
                [CompletionResult]::new('--validate', '--validate', 'ParameterName', 'Validate config'),
                [CompletionResult]::new('--show', '--show', 'ParameterName', 'Show config')
            ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
        }
        
        'completion' {
            # Completion options
            if ($elements[-2].ToString() -eq '--shell') {
                # Complete shell types
                @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "Shell type: $_")
                }
            } else {
                @(
                    [CompletionResult]::new('--shell', '--shell', 'ParameterName', 'Shell type')
                ) + $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
            }
        }
        
        default {
            # Just global options
            $globalOptions | Where-Object { $_.CompletionText -like "$wordToComplete*" }
        }
    }
}`
}

/**
 * Get installation instructions for the specified shell
 */
function getInstallationInstructions(shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return `# Add to ~/.bashrc or ~/.bash_profile:
# squizzle completion bash > ~/.bash_completion.d/squizzle
# Or directly:
# eval "$(squizzle completion --shell bash)"`;
      
    case 'zsh':
      return `# Add to ~/.zshrc:
# squizzle completion --shell zsh > ~/.zsh/completions/_squizzle
# Ensure ~/.zsh/completions is in your fpath`;
      
    case 'fish':
      return `# Save to Fish completions directory:
# squizzle completion --shell fish > ~/.config/fish/completions/squizzle.fish`;
      
    case 'powershell':
      return `# Add to your PowerShell profile:
# squizzle completion --shell powershell | Out-String | Invoke-Expression
# To find your profile location: \$PROFILE`;
      
    default:
      return '';
  }
}