# API Design Specification

**Version**: 1.0  
**Last Updated**: January 27, 2026

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tauri IPC API](#tauri-ipc-api)
4. [CLI Interface](#cli-interface)
5. [Sidecar Communication Protocol](#sidecar-communication-protocol)
6. [WebDAV Protocol](#webdav-protocol)
7. [Event System](#event-system)
8. [Error Handling](#error-handling)
9. [Security Considerations](#security-considerations)

## Overview

The Proton Drive WebDAV Bridge uses three primary communication interfaces:

1. **Tauri IPC (Inter-Process Communication)**: Rust backend ↔ TypeScript/Web frontend
2. **CLI Interface**: User/Shell ↔ Node.js/Bun CLI binary
3. **Sidecar Protocol**: Tauri GUI ↔ CLI sidecar binary (via shell subprocess)

### Technology Stack

- **Tauri**: IPC via command/invoke pattern (async RPC-style)
- **CLI**: Commander.js with JSON output support
- **Runtime**: Bun (TypeScript/JavaScript execution)
- **WebDAV**: Nephele server (RFC 4918 compliant)
- **GIO/GVFS**: Native mount integration via GLib/GIO bindings

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                    │
├───────────────────────────┬─────────────────────────────┤
│   Web Frontend (TS/JS)    │   Rust Backend (Tauri)      │
│                           │                             │
│   - UI Components         │   - Tauri Commands          │
│   - Event Listeners       │   - Event Emitters          │
│   - State Management      │   - Sidecar Process Mgmt    │
│                           │   - GIO Mount Operations    │
└───────────▲───────────────┴──────────┬──────────────────┘
            │                          │
            │ Tauri IPC                │ Shell Exec
            │ (invoke/emit)            │ (stdin/stdout)
            │                          │
            │                          ▼
            │                   ┌──────────────────┐
            │                   │  CLI Sidecar     │
            │                   │  (Bun/TS)        │
            │                   │                  │
            │                   │  - Auth          │
            │                   │  - WebDAV Server │
            │                   │  - Proton SDK    │
            │                   └────────┬─────────┘
            │                            │
            │                            │ WebDAV
            │                            │ Protocol
            │                            ▼
            │                   ┌──────────────────┐
            │                   │  File Manager    │
            │                   │  (GIO/GVFS)      │
            │                   └──────────────────┘
            │
            └─────────────── Direct CLI Usage ──────────────►
```

## Tauri IPC API

### Communication Pattern

Tauri uses a command/invoke pattern for RPC-style communication:

- **Frontend → Backend**: `invoke<T>(command: string, args?: object): Promise<T>`
- **Backend → Frontend**: `app.emit(event: string, payload?: object)`

### Design Principles

1. **Async-first**: All commands return `Promise<T>` or `Result<T, E>`
2. **Type-safe**: TypeScript definitions match Rust types via `serde`
3. **Error handling**: Rust `Result<T, String>` maps to JS Promise rejection
4. **Naming convention**: `snake_case` for commands (matches Rust convention)
5. **Minimal state**: Stateless commands preferred; state managed in Rust `State<T>`

### Concurrency and State Management

1. **Concurrent Commands**: Tauri commands execute concurrently and may run simultaneously
   - Multiple `invoke()` calls are not queued
   - Commands may interleave in their execution
   - No automatic mutual exclusion

2. **State Protection**: Application state is protected via `Arc<Mutex<T>>`
   - Ensures thread-safe access to shared state
   - Prevents data races between concurrent operations
   - Lock contention is acceptable for typical usage patterns

3. **Conflict Handling**: When operations conflict:
   - **Duplicate Start**: Calling `start_sidecar` twice returns `"Sidecar already running"`
   - **Stop While Starting**: Stopping during startup may succeed or fail depending on timing
   - **Mount During Start**: Mounting before server is fully ready returns `"Server not running"`
   - **Application should handle** these edge cases gracefully with retry logic

### Input Validation

1. **Port Numbers**
   - Valid range: 1024-65535
   - Rejected ports: < 1024 (requires privilege escalation)
   - Conflict detection: Checks if port is already in use before binding
   - Error returned: `"Invalid port number"` or `"Port already in use"`

2. **Email Addresses**
   - Format validation: Basic email format (RFC 5322 subset)
   - Domain validation: Future enhancement for Proton domains
   - Error returned: `"Invalid email format"`

3. **Paths**
   - Validation happens at: Rust backend command entry point
   - No path traversal: WebDAV adapter prevents `../` attacks
   - Proton Drive paths: Enforced by Proton SDK

4. **Validation Strategy**: All inputs validated at command entry point in Rust with clear, user-friendly error messages

### Commands (Frontend → Backend)

#### Server Lifecycle

##### `start_sidecar`

Start the WebDAV server sidecar process.

**Parameters:**

```typescript
{
  port?: number  // Optional override port (default: 8080)
}
```

**Returns:**

```typescript
Promise<number>; // PID of started process
```

**Errors:**

- `"Sidecar already running"` - Process already active
- `"Failed to spawn sidecar: <reason>"` - Spawn failed

**Example:**

```typescript
const pid = await invoke<number>('start_sidecar', { port: 8080 });
console.log(`Server started with PID ${pid}`);
```

---

##### `stop_sidecar`

Stop the running sidecar process.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- `"Sidecar not running"` - No active process

**Example:**

```typescript
await invoke('stop_sidecar');
```

---

##### `get_status`

Retrieve comprehensive status of server, authentication, and configuration.

**Parameters:** None

**Returns:**

```typescript
Promise<StatusResponse>;

interface StatusResponse {
  server: {
    running: boolean;
    pid: number | null;
    url: string | null;
  };
  auth: {
    loggedIn: boolean;
    username: string | null;
  };
  config: {
    webdav: {
      host: string;
      port: number;
      https: boolean;
      requireAuth: boolean;
      username?: string;
      passwordHash?: string;
    };
    remotePath: string;
    cache?: {
      enabled: boolean;
      ttlSeconds: number;
      maxSizeMB: number;
    };
    debug?: boolean;
    autoStart?: boolean;
  };
  logFile: string;
}
```

**Example:**

```typescript
const status = await invoke<StatusResponse>('get_status');
if (status.server.running) {
  console.log(`Server running at ${status.server.url}`);
}
```

---

#### Authentication

##### `login`

Initiate login flow for a Proton account.

**Parameters:**

```typescript
{
  email: string; // Proton account email
}
```

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- Authentication errors from Proton API
- `"Invalid email format"`

**Notes:**

- In GUI mode, this spawns an interactive CLI subprocess. User must interact with terminal prompts.
- In CLI mode, prompts appear directly in the current terminal.
- Credentials stored in system keyring on success
- **Limitation**: GUI subprocess may not be fully interactive in all terminal environments

**Example:**

```typescript
await invoke('login', { email: 'user@proton.me' });
```

---

##### `logout`

Clear stored credentials and stop server.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Example:**

```typescript
await invoke('logout');
```

---

#### Mount Operations

##### `mount_drive`

Mount Proton Drive using GIO/GVFS.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- `"Server not running"` - WebDAV server must be started first
- `"Mount failed: <reason>"` - GIO mount operation failed
- `"Mount timeout"` - Operation exceeded 30 seconds

**Events Emitted:**

- `mount:status` with intermediate progress messages

**Example:**

```typescript
try {
  await invoke('mount_drive');
  console.log('Drive mounted successfully');
} catch (error) {
  console.error('Mount failed:', error);
}
```

---

##### `unmount_drive`

Unmount the Proton Drive.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- `"Mount not found"` - Drive is not currently mounted
- `"Unmount failed: <reason>"` - GIO unmount operation failed

**Example:**

```typescript
await invoke('unmount_drive');
```

---

##### `check_mount_status`

Check if Proton Drive is currently mounted.

**Parameters:** None

**Returns:**

```typescript
Promise<string | null>;
```

**Returns:**

- `string`: Mount point path if mounted
- `null`: Not mounted

**Example:**

```typescript
const mountPoint = await invoke<string | null>('check_mount_status');
if (mountPoint) {
  console.log(`Mounted at: ${mountPoint}`);
}
```

---

#### Configuration

##### `set_network_port`

Update WebDAV server port (requires server restart).

**Parameters:**

```typescript
{
  port: number; // Port number (1024-65535)
}
```

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- `"Invalid port number"` - Port outside valid range
- `"Port already in use"` - Port conflict detected

**Side Effects:**

- Configuration is updated
- Server restart must be done manually via `stop` and `start` commands or through the GUI

**Example:**

```typescript
await invoke('set_network_port', { port: 9090 });
```

---

##### `purge_cache`

Clear all cached metadata.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Example:**

```typescript
await invoke('purge_cache');
```

---

#### Autostart

##### `get_autostart`

Check if autostart is enabled.

**Parameters:** None

**Returns:**

```typescript
Promise<boolean>;
```

**Example:**

```typescript
const enabled = await invoke<boolean>('get_autostart');
```

---

##### `set_autostart`

Enable or disable autostart.

**Parameters:**

```typescript
{
  enabled: boolean;
}
```

**Returns:**

```typescript
Promise<void>;
```

**Example:**

```typescript
await invoke('set_autostart', { enabled: true });
```

---

#### Utilities

##### `open_in_files`

Open the default file manager at the mount point.

**Parameters:** None

**Returns:**

```typescript
Promise<void>;
```

**Errors:**

- `"Drive not mounted"` - Cannot open unmounted drive
- `"Failed to open file manager"`

**Example:**

```typescript
await invoke('open_in_files');
```

---

##### `emit_test_log` (Debug Only)

Emit a test log event for debugging.

**Parameters:**

```typescript
{
  level?: string;   // Default: "info"
  message?: string; // Default: "Test log message"
}
```

**Returns:**

```typescript
Promise<void>;
```

**Availability:** Debug builds only

**Example:**

```typescript
await invoke('emit_test_log', {
  level: 'error',
  message: 'Test error message',
});
```

---

### Events (Backend → Frontend)

Events use the Tauri event system with typed payloads.

#### `sidecar:log`

Real-time log events from the sidecar process.

**Payload:**

```typescript
{
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}
```

**Example:**

```typescript
import { listen } from '@tauri-apps/api/event';

await listen<{ level: string; message: string }>('sidecar:log', (event) => {
  console.log(`[${event.payload.level}] ${event.payload.message}`);
});
```

---

#### `sidecar:terminated`

Emitted when sidecar process exits unexpectedly.

**Payload:**

```typescript
{
  pid: number;
  code: number | null;
  signal: string | null;
}
```

**Example:**

```typescript
await listen('sidecar:terminated', (event) => {
  const { code, signal } = event.payload;
  console.error(`Sidecar terminated: code=${code}, signal=${signal}`);
});
```

---

#### `mount:status`

Progress updates during mount/unmount operations.

**Payload:**

```typescript
string; // Human-readable status message
```

**Common Messages:**

- `"Mounting..."`
- `"Mounted"`
- `"Checking mount: <uri>"`
- `"Unmounting..."`
- `"Unmounted"`
- `"Mount not found"`
- `"Mount operation timed out"`

The event is also emitted with status `"Mount operation timed out"` if the operation exceeds 30 seconds.

**Example:**

```typescript
await listen<string>('mount:status', (event) => {
  document.getElementById('status').textContent = event.payload;
});
```

---

#### `status:update`

Periodic status updates (emitted during polling).

**Payload:**

```typescript
StatusResponse; // Same as get_status return type
```

**Example:**

```typescript
await listen<StatusResponse>('status:update', (event) => {
  updateUI(event.payload);
});
```

---

#### `accounts:changed`

Emitted when account list changes (future multi-account support).

**Payload:**

```typescript
Array<{
  id: string;
  email: string;
  name?: string;
  status?: string;
}>;
```

**Example:**

```typescript
await listen('accounts:changed', (event) => {
  renderAccountList(event.payload);
});
```

---

#### `account:updated`

Single account information updated.

**Payload:**

```typescript
{
  id: string;
  email: string;
  name?: string;
  status?: string;
  // ... additional account fields
}
```

---

#### `global:autostart`

Autostart setting changed.

**Payload:**

```typescript
boolean; // true if enabled, false if disabled
```

**Example:**

```typescript
await listen<boolean>('global:autostart', (event) => {
  updateAutostartToggle(event.payload);
});
```

---

## CLI Interface

### Design Principles

1. **POSIX compliance**: Follow Unix command-line conventions
2. **Subcommands**: Organize functionality into logical groups
3. **Progressive disclosure**: Simple commands for common tasks, options for advanced use
4. **Machine-readable output**: `--json` flag for scripting
5. **Exit codes**: 0 for success, non-zero for errors
6. **Help everywhere**: `--help` on every command and subcommand

### Command Structure

```
proton-drive-webdav-bridge <command> [subcommand] [options] [arguments]
```

### Global Options

| Option      | Alias | Description         |
| ----------- | ----- | ------------------- |
| `--version` | `-v`  | Show version number |
| `--help`    | `-h`  | Show help message   |

### Commands

#### `auth` - Authentication Management

Manage Proton account authentication.

##### `auth login`

Authenticate with Proton account.

**Usage:**

```bash
proton-drive-webdav-bridge auth login [options]
```

**Options:**

- `--username <email>`, `-u <email>` - Pre-fill email address
- `--help`, `-h` - Show help

**Interactive Flow:**

1. Prompt for email (if not provided)
2. Prompt for password
3. Prompt for mailbox password (if two-password mode)
4. Prompt for 2FA code (if enabled)
5. Store credentials in system keyring

**Exit Codes:**

- `0` - Success
- `1` - Authentication failed
- `2` - Keyring unavailable

**Example:**

```bash
# Interactive login
proton-drive-webdav-bridge auth login

# Pre-fill email
proton-drive-webdav-bridge auth login --username user@proton.me
```

---

##### `auth status`

Check authentication status.

**Usage:**

```bash
proton-drive-webdav-bridge auth status
```

**Output:**

```
✓ Logged in as: user@proton.me
```

or

```
✗ Not logged in. Use "proton-drive-webdav-bridge auth login" to authenticate.
```

**Exit Codes:**

- `0` - Logged in
- `1` - Not logged in

---

##### `auth logout`

Remove stored credentials.

**Usage:**

```bash
proton-drive-webdav-bridge auth logout
```

**Output:**

```
✓ Logged out successfully. Credentials removed.
```

**Side Effects:**

- Removes credentials from system keyring
- Stops WebDAV server if running

**Exit Codes:**

- `0` - Success
- `1` - Error removing credentials

---

#### `start` - Start WebDAV Server

Start the WebDAV server.

**Usage:**

```bash
proton-drive-webdav-bridge start [options]
```

**Options:**

- `--port <number>`, `-p <number>` - Port to listen on (default: 8080)
- `--host <address>`, `-H <address>` - Host to bind to (default: 127.0.0.1)
- `--no-auth` - Disable authentication (not recommended)
- `--daemon`, `-d` - Run in background
- `--no-daemon` - Run in foreground (default)
- `--help`, `-h` - Show help

**Behavior:**

- **Foreground mode**: Blocks until Ctrl+C, shows live logs
- **Daemon mode**: Spawns background process, exits immediately

**Output (Foreground):**

```
Starting WebDAV server...

✓ WebDAV server running at http://127.0.0.1:8080

You can now mount this WebDAV share:
  macOS: Finder → Go → Connect to Server → http://127.0.0.1:8080
  Linux: davfs2, GNOME Files, or other WebDAV clients
  Windows: Map network drive using WebDAV path

Press Ctrl+C to stop the server.
```

**Output (Daemon):**

```
Starting daemon (PID: 12345)...
✓ Server started in background (PID: 12345)
Use "proton-drive-webdav-bridge status" to check server status.
Use "proton-drive-webdav-bridge stop" to stop the server.
```

**Exit Codes:**

- `0` - Server started successfully
- `1` - Failed to start (port conflict, not authenticated, etc.)

**Example:**

```bash
# Start in foreground
proton-drive-webdav-bridge start

# Start on custom port
proton-drive-webdav-bridge start --port 9090

# Start as background daemon
proton-drive-webdav-bridge start --daemon
```

---

#### `stop` - Stop WebDAV Server

Stop the running WebDAV server.

**Usage:**

```bash
proton-drive-webdav-bridge stop [options]
```

**Options:**

- `--force`, `-f` - Force kill if graceful shutdown fails
- `--help`, `-h` - Show help

**Output:**

```
Stopping server (PID: 12345)...
✓ Server stopped successfully.
```

**Exit Codes:**

- `0` - Server stopped
- `1` - Server not running or failed to stop

**Example:**

```bash
proton-drive-webdav-bridge stop

# Force stop
proton-drive-webdav-bridge stop --force
```

---

#### `status` - Show Status

Display comprehensive status information.

**Usage:**

```bash
proton-drive-webdav-bridge status [options]
```

**Options:**

- `--json`, `-j` - Output as JSON
- `--help`, `-h` - Show help

**Output (Human-Readable):**

```
Proton Drive WebDAV Bridge Status
==========================

WebDAV Server:
  Status: ✓ Running (PID: 12345)
  URL: http://127.0.0.1:8080

Authentication:
  Status: ✓ Logged in
  Username: user@proton.me

Configuration:
  Port: 8080
  Host: 127.0.0.1
  HTTPS: No
  Auth Required: Yes
  Remote Path: /

Logs: /home/user/.local/state/proton-drive-webdav-bridge/proton-drive-webdav.log
Config: /home/user/.config/proton-drive-webdav-bridge/config.json
```

**Output (JSON):**

```json
{
  "server": {
    "running": true,
    "pid": 12345,
    "url": "http://127.0.0.1:8080"
  },
  "auth": {
    "loggedIn": true,
    "username": "user@proton.me"
  },
  "config": {
    "webdav": {
      "host": "127.0.0.1",
      "port": 8080,
      "https": false,
      "requireAuth": true
    },
    "remotePath": "/"
  },
  "logFile": "/home/user/.local/state/proton-drive-webdav-bridge/proton-drive-webdav.log"
}
```

**Exit Codes:**

- `0` - Status retrieved successfully
- `1` - Error retrieving status

---

#### `config` - Configuration Management

Manage application configuration.

##### `config show`

Display current configuration.

**Usage:**

```bash
proton-drive-webdav-bridge config show [options]
```

**Options:**

- `--json`, `-j` - Output as JSON
- `--help`, `-h` - Show help

**Output:**

```
Current Configuration
=====================

WebDAV Server:
  Host: 127.0.0.1
  Port: 8080
  HTTPS: No
  Auth Required: Yes
  Username: webdav
  Password: ****

Drive Settings:
  Remote Path: /

Cache:
  Enabled: Yes
  TTL: 300 seconds
  Max Size: 100 MB
```

---

##### `config set`

Update configuration value.

**Usage:**

```bash
proton-drive-webdav-bridge config set <key> <value>
```

**Supported Keys:**

- `webdav.port` - Port number (1024-65535)
- `webdav.host` - Host address
- `webdav.https` - Enable HTTPS (true/false)
- `cache.enabled` - Enable caching (true/false)
- `cache.ttlSeconds` - Cache TTL in seconds
- `cache.maxSizeMB` - Max cache size in MB
- `remotePath` - Root path on Proton Drive

**Example:**

```bash
proton-drive-webdav-bridge config set webdav.port 9090
proton-drive-webdav-bridge config set cache.enabled false
```

---

##### `config reset`

Reset configuration to defaults.

**Usage:**

```bash
proton-drive-webdav-bridge config reset [options]
```

**Options:**

- `--yes`, `-y` - Skip confirmation prompt
- `--help`, `-h` - Show help

**Example:**

```bash
proton-drive-webdav-bridge config reset --yes
```

---

## Sidecar Communication Protocol

The Tauri GUI wrapper communicates with the CLI sidecar binary via subprocess execution.

### Design Principles

1. **JSON over stdout**: Structured output on stdout, errors on stderr
2. **Line-delimited**: Each JSON object on a single line for streaming
3. **Non-interactive in GUI mode**: No stdin prompts when spawned by GUI
4. **Process management**: PID tracking, graceful shutdown, timeout handling

### Communication Flow

```
Tauri Rust Backend
       │
       │ spawn
       ▼
┌──────────────────┐
│  CLI Sidecar     │
│  (child process) │
└──────────────────┘
       │
       │ stdout (JSON)
       ▼
    Parse & Emit Events
       │
       │ Tauri Events
       ▼
  Web Frontend
```

### Status Command Output

The `status` command with `--json` flag outputs structured data that Tauri parses:

**Command:**

```bash
proton-drive-webdav-bridge status --json
```

**Stdout:**

```json
{
  "server": {
    "running": true,
    "pid": 12345,
    "url": "http://127.0.0.1:8080"
  },
  "auth": {
    "loggedIn": true,
    "username": "user@proton.me"
  },
  "config": {
    "webdav": {
      "host": "127.0.0.1",
      "port": 8080,
      "https": false,
      "requireAuth": true,
      "username": "webdav",
      "passwordHash": "..."
    },
    "remotePath": "/",
    "cache": {
      "enabled": true,
      "ttlSeconds": 300,
      "maxSizeMB": 100
    },
    "debug": false,
    "autoStart": true
  },
  "logFile": "/path/to/log.log"
}
```

### Server Startup in GUI Mode

When Tauri starts the sidecar:

**Command:**

```bash
proton-drive-webdav-bridge start --no-daemon --port 8080 --no-auth
```

**Stdout (Line-delimited JSON logs):**

```json
{"level":"info","message":"Starting WebDAV server..."}
{"level":"info","message":"Server listening on http://127.0.0.1:8080"}
{"level":"info","message":"WebDAV server ready"}
```

**Stderr (Error messages):**

```
Error: Port 8080 already in use
```

### Process Management

#### PID File Location

```
~/.local/state/proton-drive-webdav-bridge/server.pid
```

#### PID File Format

```
12345
```

Single line containing the process ID.

#### Lifecycle

1. **Start**: Write PID to file
2. **Running**: PID file exists
3. **Stop**: Remove PID file
4. **Crash**: Stale PID file (process not running)

#### Stale PID Detection

```typescript
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks existence
    return true;
  } catch {
    return false;
  }
}
```

---

## WebDAV Protocol

The WebDAV server implements RFC 4918 standard WebDAV protocol.

### Supported Methods

- `OPTIONS` - Capability discovery
- `PROPFIND` - List files/directories, get metadata
- `GET` - Download file content
- `PUT` - Upload file content
- `DELETE` - Delete files/directories
- `MKCOL` - Create directory
- `COPY` - Copy files/directories
- `MOVE` - Move/rename files/directories
- `LOCK` - Lock files (WebDAV locking)
- `UNLOCK` - Release locks

### Endpoint

```
http://localhost:8080/
```

### Authentication

If `requireAuth` is enabled:

- **Type**: HTTP Basic Authentication
- **Username**: From config (`webdav.username`)
- **Password**: From config (stored as bcrypt hash)

**Header:**

```
Authorization: Basic <base64(username:password)>
```

### Example Requests

#### List Root Directory

```http
PROPFIND / HTTP/1.1
Host: localhost:8080
Depth: 1
Content-Type: application/xml

<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>
```

#### Download File

```http
GET /Documents/file.pdf HTTP/1.1
Host: localhost:8080
```

#### Upload File

```http
PUT /Documents/newfile.txt HTTP/1.1
Host: localhost:8080
Content-Type: text/plain
Content-Length: 13

Hello, World!
```

#### Create Directory

```http
MKCOL /Documents/NewFolder HTTP/1.1
Host: localhost:8080
```

### Error Responses

WebDAV uses standard HTTP status codes:

- `200 OK` - Success
- `201 Created` - Resource created
- `204 No Content` - Success, no body
- `207 Multi-Status` - PROPFIND results
- `401 Unauthorized` - Auth required
- `403 Forbidden` - Permission denied
- `404 Not Found` - Resource doesn't exist
- `409 Conflict` - Parent directory missing
- `423 Locked` - Resource locked
- `500 Internal Server Error` - Server error
- `507 Insufficient Storage` - Quota exceeded

---

## Event System

### Event Naming Convention

- **Namespace**: Use `:` separator (e.g., `sidecar:log`, `mount:status`)
- **Hierarchy**: `namespace:action` or `namespace:subject:action`
- **Consistency**: Use consistent names across Rust and TypeScript

### Event Emission Best Practices

1. **Emit early and often**: Provide real-time feedback
2. **Include context**: Payload should be self-contained
3. **Type safety**: Define TypeScript interfaces for payloads
4. **Error events**: Always emit failure events, never fail silently
5. **Idempotency**: Listeners should handle duplicate events

### Example Event Emission (Rust)

```rust
use tauri::Emitter;

// Success event
app.emit("mount:status", "Mounted successfully").unwrap();

// Progress event
app.emit("mount:status", "Checking mount...").unwrap();

// Error event
app.emit("sidecar:error", serde_json::json!({
    "code": "MOUNT_FAILED",
    "message": "Failed to mount drive",
    "details": error_details
})).unwrap();
```

### Example Event Listening (TypeScript)

```typescript
import { listen } from '@tauri-apps/api/event';

// Typed listener
const unlisten = await listen<string>('mount:status', (event) => {
  console.log('Mount status:', event.payload);
  updateUI(event.payload);
});

// Cleanup
unlisten();
```

---

## Error Handling

### Error Classification

| Category             | Description                           | User Action                     |
| -------------------- | ------------------------------------- | ------------------------------- |
| **Client Error**     | Invalid input, not authenticated      | Fix input, re-authenticate      |
| **Server Error**     | WebDAV server crash, Proton API error | Retry, check logs               |
| **Network Error**    | Connection timeout, DNS failure       | Check connection, retry         |
| **Permission Error** | Keyring locked, file permissions      | Unlock keyring, fix permissions |
| **Resource Error**   | Port conflict, quota exceeded         | Change port, free space         |

### Error Response Format

#### CLI Errors

**Stderr Output:**

```
✗ Failed to start server: Port 8080 already in use

Suggested actions:
  - Stop the process using port 8080
  - Use a different port: proton-drive-webdav-bridge start --port 9090
```

**Exit Code:** Non-zero (1-255)

#### Tauri Command Errors with Structured Types

**Rust (Using `thiserror`):**

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CommandError {
    #[error("Server already running on port {port}")]
    ServerAlreadyRunning { port: u16 },

    #[error("Authentication failed: {reason}")]
    AuthFailed { reason: String },

    #[error("Invalid port number: {port}. Valid range: 1024-65535")]
    InvalidPort { port: u16 },

    #[error("Mount timeout: operation exceeded 30 seconds")]
    MountTimeout,

    #[error("Server not running. Start with: proton-drive-webdav-bridge start")]
    ServerNotRunning,
}

#[tauri::command]
pub async fn example_command() -> Result<String, CommandError> {
    if error_condition {
        return Err(CommandError::ServerAlreadyRunning { port: 8080 });
    }
    Ok("Success".to_string())
}
```

**TypeScript (Discriminated Union):**

```typescript
type CommandError =
  | { type: 'SERVER_ALREADY_RUNNING'; port: number }
  | { type: 'AUTH_FAILED'; reason: string }
  | { type: 'INVALID_PORT'; port: number }
  | { type: 'MOUNT_TIMEOUT' }
  | { type: 'SERVER_NOT_RUNNING' };

try {
  await invoke('example_command');
} catch (error) {
  const parsedError = JSON.parse(error as string) as CommandError;

  switch (parsedError.type) {
    case 'SERVER_ALREADY_RUNNING':
      showError(`Server already running on port ${parsedError.port}`);
      break;
    case 'AUTH_FAILED':
      showError(`Authentication failed: ${parsedError.reason}`);
      break;
    case 'INVALID_PORT':
      showError(`Invalid port ${parsedError.port}. Valid range: 1024-65535`);
      break;
    case 'MOUNT_TIMEOUT':
      showError('Mount operation timed out. Try again or check mount logs.');
      break;
    case 'SERVER_NOT_RUNNING':
      showError('Server not running. Start it first with the start command.');
      break;
  }
}
```

### Operation Timeouts

1. **`get_status` Command**
   - Timeout: 5 seconds
   - Behavior: Returns error if status check exceeds timeout
   - Cause: Server unresponsive or overloaded

2. **`mount_drive` Command**
   - Timeout: 30 seconds
   - Behavior: Returns `"Mount operation timed out"` error
   - Cause: GIO/GVFS mount operation stalled
   - Recovery: Check logs and try unmounting before retrying

3. **Server Initialization**
   - Startup timeout: 10 seconds
   - Error if: Server fails to bind to port or initialize within timeout
   - Check: Use `get_status` to verify readiness before mounting

4. **Best Practice**: Log timeout warnings with context so users can troubleshoot

### Error Codes (Recommended Implementation)

For machine-readable error handling, use structured error enums with error codes:

```typescript
enum ErrorCode {
  // Authentication
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_2FA_REQUIRED = 'AUTH_2FA_REQUIRED',
  AUTH_MAILBOX_PASSWORD_REQUIRED = 'AUTH_MAILBOX_PASSWORD_REQUIRED',

  // Server
  SERVER_ALREADY_RUNNING = 'SERVER_ALREADY_RUNNING',
  SERVER_START_FAILED = 'SERVER_START_FAILED',
  SERVER_PORT_CONFLICT = 'SERVER_PORT_CONFLICT',

  // Mount
  MOUNT_FAILED = 'MOUNT_FAILED',
  MOUNT_TIMEOUT = 'MOUNT_TIMEOUT',
  MOUNT_NOT_FOUND = 'MOUNT_NOT_FOUND',

  // Network
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',

  // Configuration
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_READ_FAILED = 'CONFIG_READ_FAILED',
}
```

**Rust Implementation (thiserror):**

```rust
#[derive(Error, Debug)]
pub enum CommandError {
    #[error("Authentication failed")]
    AuthFailed,

    #[error("Server already running")]
    ServerAlreadyRunning,

    #[error("Port conflict")]
    ServerPortConflict,

    #[error("Mount operation timed out")]
    MountTimeout,
}

impl From<CommandError> for String {
    fn from(err: CommandError) -> Self {
        match err {
            CommandError::AuthFailed => "AUTH_FAILED".to_string(),
            CommandError::ServerAlreadyRunning => "SERVER_ALREADY_RUNNING".to_string(),
            CommandError::ServerPortConflict => "SERVER_PORT_CONFLICT".to_string(),
            CommandError::MountTimeout => "MOUNT_TIMEOUT".to_string(),
        }
    }
}
```

These error codes should be included in the structured error response so clients can programmatically handle specific error types.

---

## Security Considerations

### Authentication Security

1. **Credential Storage**
   - System keyring preferred (libsecret on Linux)
   - Fallback to encrypted file if keyring unavailable
   - Never log credentials
   - Clear from memory after use

2. **WebDAV Authentication**
   - HTTP Basic Auth over localhost only (acceptable)
   - HTTPS required for non-localhost (future enhancement)
   - Bcrypt password hashing for stored WebDAV password

### IPC Security

1. **Tauri IPC**
   - Validated by Tauri framework
   - Commands run in Rust backend (trusted)
   - No direct DOM access from backend

2. **Sidecar Communication**
   - Sidecar runs with same user privileges
   - No privilege escalation
   - PID file prevents duplicate instances

### WebDAV Security

1. **Network Binding**
   - Default: `127.0.0.1` (localhost only)
   - Warning when binding to `0.0.0.0` or public IP
   - HTTPS strongly recommended for non-localhost

2. **File Access**
   - Proton Drive encryption maintained
   - No local file system access (only Proton Drive API)
   - User's Proton permissions enforced

### Input Validation

1. **Port Numbers**
   - Range: 1024-65535
   - Conflict detection before binding

2. **Email Addresses**
   - Basic format validation
   - Proton domain validation (future)

3. **Paths**
   - No path traversal attacks (WebDAV adapter handles)
   - Proton Drive path validation

---

## Architecture Decisions

### Why GUI Uses `--no-auth` Mode

The Tauri GUI spawns the CLI sidecar with `--no-auth` flag for several reasons:

1. **Single Session**: GUI and sidecar share the same authenticated session via the Proton SDK
2. **Shared Credentials**: Credentials loaded once by GUI, reused by sidecar
3. **Simplified Prompts**: Eliminates redundant authentication dialogs
4. **One Keyring Unlock**: User unlocks keyring once, not twice (GUI + sidecar)

**Trade-off**: Requires the GUI to have active authentication before starting sidecar.

### Separate CLI vs GUI Execution Model

The application maintains two distinct execution paths:

**CLI Mode:**

- Direct command invocation: `proton-drive-webdav-bridge start`
- Full authentication flow: prompts for password, 2FA, etc.
- Suitable for: Scripting, automation, headless systems
- Used by: Users, CI/CD pipelines

**GUI Mode:**

- Spawned as subprocess from Tauri: `proton-drive-webdav-bridge start --no-auth --daemon`
- Inherited credentials from GUI session
- Suitable for: Desktop users, interactive use
- Used by: Tauri desktop application

**Rationale**: Allows the same binary to serve both audiences without compromising user experience in either mode.

### Why Sidecar Pattern Is Used

Rather than embedding the WebDAV server directly in Tauri, we spawn it as a separate CLI subprocess:

1. **Process Isolation**: Server crashes don't crash GUI
2. **Resource Control**: Server can be restarted independently
3. **Single Source of Truth**: CLI binary is also sidecar binary
4. **Backward Compatibility**: Users can run CLI standalone
5. **Easy Updates**: Sidecar process can be restarted on version updates
6. **Platform Consistency**: Same behavior on macOS, Linux, Windows

**Trade-off**: Adds complexity for IPC and process management, but gains robustness and flexibility.

---

## Versioning

### API Versioning Strategy

1. **Tauri Commands**: Backward-compatible additions
2. **CLI Interface**: Semantic versioning for breaking changes
3. **Event Names**: Avoid renaming; add new events instead
4. **Configuration**: Migration on load if schema changes

### Deprecation Process

1. Mark deprecated in documentation
2. Log warning when used
3. Remove after 2 major versions

---

## Best Practices Summary

### For Frontend Developers

1. Always handle Promise rejections from `invoke()`
2. Clean up event listeners on component unmount
3. Show loading states during async operations
4. Display user-friendly error messages
5. Implement retry logic for transient failures

### For Backend Developers

1. Return `Result<T, E>` with structured error types (use `thiserror` crate for better error discrimination)
2. Emit progress events for long-running operations
3. Validate all inputs at command entry point with clear error messages
4. Log errors with context before returning
5. Keep commands small and focused
6. Document timeout behavior for all long-running operations
7. Use error codes in structured errors for client-side error discrimination

### For CLI Users

1. Use `--json` for scripting
2. Check exit codes in scripts
3. Redirect stderr for error handling
4. Use daemon mode for background services

---

## Appendix A: Complete Type Definitions

### TypeScript

```typescript
// Status types
interface StatusResponse {
  server: ServerStatus;
  auth: AuthStatus;
  config: ConfigStatus;
  logFile: string;
}

interface ServerStatus {
  running: boolean;
  pid: number | null;
  url: string | null;
}

interface AuthStatus {
  loggedIn: boolean;
  username: string | null;
}

interface ConfigStatus {
  webdav: WebdavConfig;
  remotePath: string;
  cache?: CacheConfig;
  debug?: boolean;
  autoStart?: boolean;
}

interface WebdavConfig {
  host: string;
  port: number;
  https: boolean;
  requireAuth: boolean;
  username?: string;
  passwordHash?: string;
}

interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxSizeMB: number;
}

// Event payloads
interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

interface TerminatedEvent {
  pid: number;
  code: number | null;
  signal: string | null;
}

interface AccountInfo {
  id: string;
  email: string;
  name?: string;
  status?: string;
}

// Command parameters
interface StartSidecarParams {
  port?: number;
}

interface LoginParams {
  email: string;
}

interface SetNetworkPortParams {
  port: number;
}

interface SetAutostartParams {
  enabled: boolean;
}

interface EmitTestLogParams {
  level?: string;
  message?: string;
}
```

### Rust

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub server: ServerStatus,
    pub auth: AuthStatus,
    pub config: ConfigStatus,
    #[serde(rename = "logFile")]
    pub log_file: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    #[serde(rename = "loggedIn")]
    pub logged_in: bool,
    pub username: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub webdav: WebdavConfig,
    #[serde(rename = "remotePath")]
    pub remote_path: String,
    pub cache: Option<CacheConfig>,
    pub debug: Option<bool>,
    #[serde(rename = "autoStart")]
    pub auto_start: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    pub host: String,
    pub port: u16,
    pub https: bool,
    #[serde(rename = "requireAuth")]
    pub require_auth: bool,
    pub username: Option<String>,
    #[serde(rename = "passwordHash")]
    pub password_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheConfig {
    pub enabled: bool,
    #[serde(rename = "ttlSeconds")]
    pub ttl_seconds: u32,
    #[serde(rename = "maxSizeMB")]
    pub max_size_mb: u32,
}

#[derive(Serialize, Clone)]
pub struct LogEvent {
    pub level: String,
    pub message: String,
}
```

---

## Appendix B: Migration Guide

### From Single Account to Multi-Account (Phase 3)

**CLI Changes:**

- `auth login` → `auth login --account <id>`
- `start` → `start --account <id>`

**API Changes:**

- Add `account_id` parameter to relevant commands
- New commands: `list_accounts`, `add_account`, `remove_account`

**Configuration:**

- Move single account config to `accounts[0]`
- Add account selection to GUI

---

## Appendix C: Testing Recommendations

### Tauri IPC Testing

```typescript
// Mock Tauri invoke
import { mockIPC } from '@tauri-apps/api/mocks';

beforeAll(() => {
  mockIPC((cmd, args) => {
    if (cmd === 'get_status') {
      return {
        server: { running: true, pid: 12345, url: 'http://localhost:8080' },
        auth: { loggedIn: true, username: 'test@proton.me' },
        config: {
          /* ... */
        },
        logFile: '/tmp/test.log',
      };
    }
  });
});
```

### CLI Testing

```bash
# Test status command
output=$(proton-drive-webdav-bridge status --json)
echo "$output" | jq -r '.server.running'

# Test error handling
proton-drive-webdav-bridge start --port 80 2>&1 | grep -q "Permission denied"
```
