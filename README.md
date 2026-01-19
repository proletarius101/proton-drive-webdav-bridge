# Proton Drive WebDAV Bridge

An unofficial WebDAV bridge for Proton Drive, allowing you to access your Proton Drive files through the standard WebDAV protocol. Mount your encrypted cloud storage as a network drive on any operating system.

## Features

- **WebDAV Server**: Access Proton Drive through any WebDAV client (file managers, sync tools, etc.)
- **End-to-End Encryption**: Your files remain encrypted using Proton's encryption
- **Secure Authentication**: Uses the official Proton Drive SDK with SRP authentication
- **Native Credential Storage**: Stores credentials securely using OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service/libsecret)
- **HTTPS Support**: Optional TLS encryption for the WebDAV server
- **Cross-Platform**: Works on Linux, macOS, and Windows
- **CLI Interface**: Full command-line control
- **GUI Interface**: System tray application (coming soon)

## Installation

### From Source

```bash
# Clone the repository
git clone https://gitlab.com/secure-system/proton/proton-drive-webdav-bridge.git
cd proton-drive-webdav-bridge

# Install dependencies
bun install

# Build
bun run build
```

### Requirements

- [Bun](https://bun.sh) runtime (v1.0+)
- Node.js compatible system
- For Linux: `libsecret-1-dev` for native keychain support (optional)

```bash
# Ubuntu/Debian
sudo apt install libsecret-1-dev

# Fedora
sudo dnf install libsecret-devel

# Arch Linux
sudo pacman -S libsecret
```

## Quick Start

1. **Login to your Proton account:**

   ```bash
   proton-drive-webdav-bridge auth login
   ```

   Enter your Proton credentials (supports 2FA and two-password mode).

2. **Start the WebDAV server:**

   ```bash
   proton-drive-webdav-bridge start
   ```

3. **Connect with your file manager:**
   - **macOS**: Finder → Go → Connect to Server → `http://127.0.0.1:8080`
   - **Linux (GNOME Files)**: Other Locations → Connect to Server → `dav://127.0.0.1:8080`
   - **Linux (davfs2)**: `sudo mount -t davfs http://127.0.0.1:8080 /mnt/proton`
   - **Windows**: Map network drive → `\\127.0.0.1@8080\DavWWWRoot`

## CLI Commands

### Authentication

```bash
# Login to Proton account
proton-drive-webdav-bridge auth login

# Check authentication status
proton-drive-webdav-bridge auth status

# Logout and remove credentials
proton-drive-webdav-bridge auth logout
```

### Server Management

```bash
# Start WebDAV server
proton-drive-webdav-bridge start

# Start in background (daemon mode)
proton-drive-webdav-bridge start --daemon

# Start with custom port
proton-drive-webdav-bridge start --port 9000

# Stop the server
proton-drive-webdav-bridge stop

# Force stop
proton-drive-webdav-bridge stop --force

# Check server status
proton-drive-webdav-bridge status

# Status as JSON
proton-drive-webdav-bridge status --json
```

### Configuration

```bash
# Show current configuration
proton-drive-webdav-bridge config show

# Interactive configuration wizard
proton-drive-webdav-bridge config setup

# Set individual values
proton-drive-webdav-bridge config set webdav.port 9000
proton-drive-webdav-bridge config set webdav.host 0.0.0.0
proton-drive-webdav-bridge config set webdav.requireAuth true
proton-drive-webdav-bridge config set debug true

# Reset to defaults
proton-drive-webdav-bridge config reset
```

### Global Options

```bash
# Enable debug logging
proton-drive-webdav-bridge --debug <command>
```

## Configuration

Configuration is stored in:

- **Linux**: `~/.config/proton-drive-webdav-bridge/config.json`
- **macOS**: `~/Library/Application Support/proton-drive-webdav-bridge/config.json`
- **Windows**: `%APPDATA%/proton-drive-webdav-bridge/config.json`

### Configuration Options

```json
{
  "webdav": {
    "host": "127.0.0.1",
    "port": 8080,
    "requireAuth": true,
    "username": "proton",
    "passwordHash": "sha256_hash_of_password",
    "https": false,
    "certPath": "/path/to/cert.pem",
    "keyPath": "/path/to/key.pem"
  },
  "remotePath": "/",
  "cache": {
    "enabled": true,
    "ttlSeconds": 60,
    "maxSizeMB": 100
  },
  "debug": false,
  "autoStart": false
}
```

### Security Recommendations

1. **Use HTTPS**: For non-localhost access, always enable HTTPS
2. **Enable Authentication**: Keep `requireAuth: true` and set a strong password
3. **Localhost Only**: By default, the server binds to `127.0.0.1` (only accessible from your machine)
4. **Firewall**: If binding to `0.0.0.0`, ensure your firewall is properly configured

## Security

### Credential Storage

Credentials are stored using the native OS keychain:

- **macOS**: Keychain Access
- **Windows**: Windows Credential Manager
- **Linux**: Secret Service API (GNOME Keyring, KDE Wallet, etc.)

On headless Linux systems without a graphical keychain, an encrypted fallback file is used with AES-256-GCM encryption. The encryption key is derived from your password using PBKDF2.

### Session Management

- Sessions are forked into parent (long-lived) and child (short-lived) sessions
- Child sessions are automatically refreshed
- If refresh fails, new child sessions are forked from the parent
- All tokens are stored encrypted in the OS keychain

## Architecture

```
proton-drive-webdav-bridge/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── auth.ts           # Proton SRP authentication
│   ├── config.ts         # Configuration management
│   ├── keychain.ts       # Secure credential storage
│   ├── drive.ts          # Proton Drive SDK wrapper
│   ├── logger.ts         # Winston logging
│   ├── paths.ts          # XDG path management
│   ├── cli/              # CLI commands
│   │   ├── auth.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   ├── status.ts
│   │   └── config.ts
│   └── webdav/           # WebDAV server
│       └── server.ts
└── package.json
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Type check
bun run build:check

# Lint and format
bun run lint
bun run format
```

## Troubleshooting

### "Cannot connect to keychain"

On Linux without a graphical session, the Secret Service may not be available. The application will fall back to encrypted file storage, but you'll need to enter your password on each login.

To use a graphical keychain in headless mode:

```bash
# Start a D-Bus session
eval $(dbus-launch --sh-syntax)

# Start GNOME Keyring
gnome-keyring-daemon --start --components=secrets
```

### "Session expired"

If you see session-related errors, try logging in again:

```bash
proton-drive-webdav-bridge auth logout
proton-drive-webdav-bridge auth login
```

### WebDAV connection issues

1. Check the server is running: `proton-drive-webdav-bridge status`
2. Verify the port is not blocked by firewall
3. For macOS/Windows, try different WebDAV paths in the URL
4. Enable debug mode: `proton-drive-webdav-bridge --debug start`

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Proton](https://proton.me) for the Drive SDK
- [@napi-rs/keyring](https://github.com/nicokosi/napi-rs-keyring) for native credential storage
- [nephele](https://github.com/sciactive/nephele) for the WebDAV implementation

## Disclaimer

This is an unofficial project and is not affiliated with Proton AG. Use at your own risk. Always keep backups of your important data.
