# PRD: Proton Drive WebDAV Bridge

## 1. Product overview

### 1.1 Document title and version

- PRD: Proton Drive WebDAV Bridge
- Version: 1.0

### 1.2 Product summary

Proton Drive WebDAV Bridge is a desktop application that brings Proton Drive integration to the Linux desktop environment. Since Proton Drive uses a custom protocol with proprietary cryptographic algorithms, native file manager integration requires a bridging solution. The application provides a local WebDAV server that translates standard WebDAV requests into Proton Drive API calls, maintaining end-to-end encryption while allowing users to access their cloud storage through familiar desktop tools.

The bridge enables users to mount their Proton Drive as a network location in their system file manager (Nautilus, Dolphin, Thunar, etc.) using GIO, making cloud files accessible alongside local directories. User sessions are securely stored in the system keyring (libsecret/Secret Service), persisting login status across application restarts. The application features a native GTK4/Libadwaita GUI that follows GNOME Human Interface Guidelines, ensuring it feels seamless and intuitive within GNOME and similar desktop environments.

By providing both CLI and GUI interfaces, the application serves technical users who prefer command-line workflows as well as everyday desktop users who expect graphical configuration and status monitoring.

## 2. Goals

### 2.1 Business goals

- Provide a reliable, open-source solution for Proton Drive desktop integration on Linux
- Increase Proton Drive adoption among privacy-conscious Linux users
- Establish the application as the de facto standard for Proton Drive access on Linux desktop environments
- Build community trust through transparent development and security practices
- Enable seamless migration path for users switching from other cloud storage providers

### 2.2 User goals

- Access Proton Drive files through the native file manager without using a web browser
- Maintain end-to-end encryption while enjoying desktop-native file access
- Have the WebDAV bridge start automatically on system login without manual intervention
- Configure connection settings (IP, port) through an intuitive graphical interface
- Monitor mounting status and connection health at a glance
- Manage authentication (login/logout) without touching the command line

### 2.3 Non-goals

- Providing a custom file browser or file manager replacement
- Implementing two-way sync with local folders (this is a mount solution, not a sync client)
- Supporting Windows or macOS in the initial release
- Providing mobile companion applications
- Enterprise features such as team management, audit logging, or centralized administration
- Offline file access or caching beyond standard WebDAV client behavior

## 3. User personas

### 3.1 Key user types

- Privacy-conscious desktop Linux users (primary)
- Linux power users and system administrators
- Open-source software advocates
- Users transitioning from other cloud storage solutions
- Technical writers and content creators using Linux workstations

### 3.2 Basic persona details

- **Privacy-Focused Casual User**: A desktop Linux user (GNOME, KDE, XFCE) who values privacy and uses Proton services but lacks advanced technical skills. They want cloud storage to "just work" like it does on other platforms, without command-line configuration. They may use Flatpak applications exclusively and expect system tray integration.

- **Linux Power User**: A developer or system administrator who manages multiple Proton accounts and expects both CLI and GUI interfaces. They appreciate fine-grained control over network settings, understand WebDAV protocols, and may automate workflows using shell scripts. They value transparent logging and debugging capabilities.

- **Open Source Advocate**: A user who specifically chose Proton for its privacy stance and Linux for its freedom principles. They evaluate software based on security practices, code transparency, and adherence to platform standards (XDG, FreeDesktop.org specifications, GNOME HIG).

### 3.3 Role-based access

- **Individual User**: Full access to all application features including authentication, configuration, mounting/unmounting, and autostart management. All users have equal capabilities as the application is designed for single-user, single-machine deployments.

## 4. Functional requirements

- **Authentication Management** (Priority: Critical)
  - Users must be able to log in with Proton account credentials (email/username and password)
  - Support for two-factor authentication (2FA/TOTP) during login
  - Support for Proton's two-password mode (login password and mailbox password)
  - Secure credential storage using the system keyring (libsecret on Linux)
  - Session persistence across application restarts
  - Logout functionality that cleanly removes stored credentials
  - Authentication status display showing current login state and username

- **WebDAV Server** (Priority: Critical)
  - Local WebDAV server listening on configurable IP address and port
  - Translation of WebDAV requests to Proton Drive API calls
  - Preservation of end-to-end encryption for all file operations
  - Support for standard file operations: read, write, create, delete, rename, move
  - Directory listing and navigation
  - Server lifecycle management (start, stop, restart)
  - Automatic server startup on application launch (optional)

- **File Manager Integration** (Priority: Critical)
  - GIO-based mounting for GVFS-compatible file managers
  - Automatic mount on successful authentication (optional)
  - Manual mount/unmount controls in the GUI
  - Mount status monitoring and display
  - "Open in Files" functionality to launch the file manager at the mount point
  - Graceful handling of mount failures with user-friendly error messages

- **Graphical User Interface** (Priority: High)
  - System tray icon showing connection status
  - Main window with Adwaita design language
  - Authentication flow: login screen with email input and password prompts
  - Dashboard displaying server status, mount status, and storage quota
  - Network settings panel for IP and port configuration
  - Server control: start/stop buttons
  - Mount control: mount/unmount toggle
  - Autostart toggle for launching bridge on login
  - Status badges showing running/stopped states
  - Live status updates without manual refresh
  - Logout/reset authentication button
  - Cache purge option
  - Log viewer for troubleshooting

- **Command-Line Interface** (Priority: High)
  - `auth login` - Interactive authentication flow
  - `auth status` - Display current authentication state
  - `auth logout` - Remove stored credentials
  - `start` - Start WebDAV server
  - `start --daemon` - Start in background mode
  - `start --port <PORT>` - Start with custom port
  - `stop` - Stop WebDAV server
  - `status` - Display comprehensive status (server, auth, config)
  - `status --json` - Machine-readable status output
  - All commands support `--help` for usage information

- **Configuration Management** (Priority: High)
  - Persistent configuration file (JSON format in XDG config directory)
  - WebDAV server settings: host, port, HTTPS toggle
  - Cache settings: enable/disable, TTL, size limits
  - Debug mode toggle
  - Autostart preference
  - Configuration file watching for live updates
  - Safe configuration updates with validation
  - Ability to reset to defaults

- **Session and State Management** (Priority: High)
  - Automatic session refresh using stored refresh tokens
  - Graceful handling of expired sessions with re-authentication prompts
  - Persistence of UI state (window position, selected views)
  - Autostart integration using XDG autostart or systemd user services

- **Error Handling and Recovery** (Priority: High)
  - User-friendly error messages for common failure scenarios
  - Automatic retry for transient network failures
  - Graceful degradation when system keyring is unavailable
  - Clear error states in GUI (connection failed, authentication failed, mount failed)
  - Detailed error logging for debugging

- **Performance and Caching** (Priority: Medium)
  - Metadata caching to reduce API calls and improve responsiveness
  - Configurable cache TTL and size limits
  - Cache invalidation on file modifications
  - Purge cache functionality accessible from GUI and CLI

## 5. User experience

### 5.1 Entry points & first-time user flow

- User installs the application via Flatpak from Flathub
- Application appears in the desktop application menu under "Internet" or "Utilities" category
- First launch presents a clean, welcoming login screen following GNOME HIG principles
- User enters their Proton account email address
- Application prompts for password (and mailbox password if applicable)
- If 2FA is enabled, user receives a prompt for their TOTP code
- Upon successful authentication, the application automatically starts the WebDAV server
- User is presented with option to mount their Proton Drive immediately
- Application offers to enable autostart for convenience
- Success state clearly shows "Connected" or "Mounted" with visual confirmation

### 5.2 Core experience

- **Daily Use**: After autostart is enabled, the application launches silently on login, starts the WebDAV server, and automatically mounts Proton Drive. The system tray icon provides status at a glance. Users interact with their cloud files through their familiar file manager without thinking about the bridge.

  - Ensures a positive experience by removing friction and technical complexity. Users focus on their files, not the infrastructure.

- **Mounting and Unmounting**: Users toggle a single switch in the GUI to mount or unmount their Proton Drive. The interface provides immediate feedback through the status of the switch. Unmounting is similarly straightforward.

  - Ensures a positive experience through clear state communication and predictable behavior, following GNOME HIG principles of reducing user effort.

- **Configuration Changes**: Users can modify the WebDAV server port from the settings panel. Changes require stopping and restarting the server, which the application handles automatically after user confirmation. The interface prevents invalid port numbers and provides clear feedback about the restart process.

  - Ensures a positive experience by anticipating potential issues and guiding users through necessary steps rather than failing silently.

- **Session Management**: When a session expires or becomes invalid, the application detects this during the next API call and presents a non-intrusive notification prompting re-authentication. Users can click the notification to open the login screen without losing their current workflow.

  - Ensures a positive experience by being considerate of user time and attention, following GNOME HIG principles of avoiding unnecessary interruptions.

### 5.3 Advanced features & edge cases

- Power users can access all functionality through the CLI for scripting and automation
- Application handles network interruptions gracefully, attempting to reconnect automatically
- If the system keyring is locked or unavailable, the application prompts for credentials on each startup
- Multiple instances are prevented through lock file mechanism
- Configuration file corruption is detected and user is offered option to reset to defaults
- Port conflicts are detected before server startup with helpful error messages suggesting alternative ports

### 5.4 UI/UX highlights

- Adwaita design language with proper dark mode support
- Consistent iconography following FreeDesktop.org icon naming specification
- Keyboard navigation support throughout the interface
- Screen reader compatibility (ARIA labels where appropriate)
- Responsive layout adapting to different window sizes
- Visual hierarchy emphasizing primary actions (mount/unmount, login/logout)
- Progressive disclosure: advanced settings hidden in expandable sections
- Clear status indicators using color, icons, and text together (accessibility)
- Empty states with helpful guidance when not authenticated or mounted

## 6. Narrative

A privacy-conscious Linux user switches to Proton Drive for secure cloud storage. They install Proton Drive WebDAV Bridge from Flathub, expecting integration similar to what they had with their previous provider. On first launch, they enter their Proton credentials, and the application guides them through 2FA verification. Within moments, their Proton Drive appears in their file manager's sidebar, indistinguishable from any other network location. They drag files to upload, open documents directly from the mount, and save work without thinking about the bridge—it simply works. When they restart their computer, the bridge launches silently, and their cloud storage is ready before they've finished their morning coffee. If they ever need to troubleshoot or adjust settings, the clean, familiar interface provides exactly the controls they need without overwhelming technical jargon. The experience is seamless, secure, and respectful of their time.

## 7. Success metrics

Success metrics are not defined for the initial release. The project will focus on delivering a robust, stable implementation of core functionality before establishing measurement criteria.

## 8. Technical considerations

### 8.1 Integration points

- **Proton Drive SDK**: `@protontech/drive-sdk` for all Proton Drive API interactions
- **System Keyring**: `@napi-rs/keyring` for secure credential storage via libsecret/Secret Service
- **WebDAV Server**: Nephele WebDAV server library with custom adapter for Proton Drive
- **GIO/GVFS**: GLib/GIO bindings (Rust) for mount/unmount operations via D-Bus
- **Tauri Framework**: Desktop application framework for building the GUI with web technologies
- **Adwaita UI**: `adwaveui` web component library for GNOME-style interface elements
- **XDG Specifications**: Configuration paths, autostart entries following FreeDesktop.org standards

### 8.2 Data storage & privacy

- **Credentials**: Stored in system keyring only (never written to disk in plaintext)
- **Session Tokens**: Refresh tokens stored in keyring; access tokens held in memory only
- **Configuration**: JSON file in XDG config directory (`~/.config/proton-drive-webdav-bridge/config.json`) containing non-sensitive settings
- **Cache**: Optional metadata cache stored in XDG cache directory (`~/.cache/proton-drive-webdav-bridge/`) with configurable size limits
- **Logs**: Rotating log files in XDG state directory (`~/.local/state/proton-drive-webdav-bridge/`) with automatic cleanup
- **Encryption**: All files remain end-to-end encrypted; only decrypted content is served via WebDAV (in-memory only)
- **Network**: WebDAV server binds to localhost by default, preventing external network access

### 8.3 Scalability & performance

- **Target**: Smooth operation with Proton Drive accounts up to 500GB and 100,000 files
- **Metadata Caching**: Reduces repeated API calls by caching directory listings and file metadata
- **Lazy Loading**: Directory contents fetched on-demand rather than upfront
- **Concurrent Operations**: WebDAV server handles multiple file operations in parallel
- **Memory Management**: Streaming file transfers to avoid loading entire files into memory
- **Resource Limits**: Configurable cache size prevents unbounded memory growth
- **Startup Time**: Application launches and becomes responsive within 2 seconds on modern hardware

### 8.4 Potential challenges

- **GIO/GVFS Compatibility**: Different file managers may implement GIO mounts with subtle variations; extensive testing across GNOME Files, KDE Dolphin, XFCE Thunar, and others required
- **Keyring Availability**: Systems without a keyring service or with locked keyrings need graceful fallback behavior
- **Network Reliability**: Proton Drive API connectivity issues must be handled without crashing or losing user data
- **Session Expiration**: Detecting and recovering from expired sessions while minimizing user interruption
- **Flatpak Sandboxing**: Ensuring proper permissions for keyring access, D-Bus communication, and file manager integration within Flatpak's security model
- **Port Conflicts**: Handling cases where the configured port is already in use by another service
- **Concurrent Access**: Managing state when multiple applications access the WebDAV mount simultaneously
- **Large File Transfers**: Ensuring reliable upload/download of multi-gigabyte files with progress indication
- **Proton API Rate Limits**: Implementing appropriate backoff strategies to avoid API throttling

## 9. Milestones & sequencing

- **Phase 1 - MVP**: Core WebDAV bridge, authentication, basic GUI, GIO mounting, CLI interface, Flatpak packaging

  - Key deliverables:
    - Functional WebDAV server with Proton Drive backend
    - Authentication flow (login/logout) with keyring storage
    - Basic Tauri GUI with Adwaita styling
    - Mount/unmount functionality via GIO
    - CLI commands for all core operations
    - Configuration management
    - Flatpak manifest and Flathub submission
    - Documentation (README, user guide, man pages)

- **Phase 2 - Polish & Enhancement**: Autostart, improved error handling, caching, performance optimization, expanded testing

  - Key deliverables:
    - Autostart integration
    - System tray icon with status menu
    - Metadata caching implementation
    - Comprehensive error handling and user feedback
    - Performance profiling and optimization
    - Expanded test coverage
    - Accessibility audit and improvements
    - User testing and feedback incorporation

- **Phase 3 - Multi-Account Support**: Infrastructure for multiple accounts, per-account mount points, account switching UI

  - Key deliverables:
    - Multi-account authentication system
    - Per-account WebDAV server instances (different ports)
    - Account list sidebar in GUI
    - Account selection and switching
    - Per-account configuration
    - Migration path for existing single-account users

- **Phase 4 - Proton Drive Photos**: Integration of Proton Drive Photos as separate mount point, photo-specific optimizations

  - Key deliverables:
    - Photos API integration
    - Separate mount point for Photos collection
    - Photo metadata handling
    - Album support in directory structure
    - Thumbnail generation and caching
    - Photo-specific UI elements and status display

## 10. User stories

### 10.1. User authentication with email and password

- **ID**: GH-001
- **Description**: As a Proton Drive user, I want to authenticate using my email and password so that I can securely access my encrypted files through the WebDAV bridge.
- **Acceptance criteria**:
  - User can enter email address in the login screen
  - User is prompted for password after submitting email
  - Application validates credentials with Proton API
  - Successful authentication stores session in system keyring
  - Failed authentication displays clear error message
  - Authentication state persists across application restarts

### 10.2. Two-factor authentication support

- **ID**: GH-002
- **Description**: As a security-conscious user, I want to complete two-factor authentication during login so that my account remains protected with 2FA.
- **Acceptance criteria**:
  - Application detects when 2FA is required for the account
  - User is prompted for TOTP code after password entry
  - Invalid 2FA codes display appropriate error message
  - Successful 2FA completion proceeds to authenticated state
  - User can cancel 2FA prompt and return to login screen

### 10.3. Two-password mode authentication

- **ID**: GH-003
- **Description**: As a user with two-password mode enabled, I want to enter both my login password and mailbox password so that I can complete authentication.
- **Acceptance criteria**:
  - Application detects two-password mode requirement
  - User is prompted for mailbox password after login password
  - Both passwords are required for successful authentication
  - Clear labeling distinguishes between login and mailbox passwords
  - Invalid mailbox password displays specific error message

### 10.4. Secure credential storage

- **ID**: GH-004
- **Description**: As a user, I want my credentials stored securely in the system keyring so that I don't have to re-enter them every time I use the application.
- **Acceptance criteria**:
  - Credentials are stored in system keyring (libsecret) only
  - No credentials are written to disk in plaintext
  - Application retrieves credentials from keyring on startup
  - If keyring is unavailable, user is prompted for credentials
  - Keyring service errors are handled gracefully with user notification

### 10.5. User logout and credential removal

- **ID**: GH-005
- **Description**: As a user, I want to log out of the application so that my credentials are removed and the WebDAV server is stopped.
- **Acceptance criteria**:
  - Logout button is accessible from GUI and CLI
  - Clicking logout stops the WebDAV server
  - All credentials are removed from system keyring
  - User is returned to login screen
  - Logout action is confirmed with visual feedback

### 10.6. WebDAV server startup

- **ID**: GH-006
- **Description**: As a user, I want the WebDAV server to start automatically after authentication so that I can access my files without additional configuration.
- **Acceptance criteria**:
  - WebDAV server starts on successful authentication
  - Server listens on configured IP and port (default: localhost:8080)
  - Server status is displayed in GUI and CLI
  - Server PID is tracked for process management
  - Server startup failures display clear error messages with resolution steps

### 10.7. WebDAV server manual control

- **ID**: GH-007
- **Description**: As a user, I want to manually start and stop the WebDAV server so that I can control when the bridge is active.
- **Acceptance criteria**:
  - Start/stop controls are available in GUI and CLI
  - Server responds to start command within 2 seconds
  - Server responds to stop command within 2 seconds
  - Status indicator updates immediately to reflect server state
  - Starting already-running server displays informative message
  - Stopping already-stopped server displays informative message

### 10.8. Mount Proton Drive in file manager

- **ID**: GH-008
- **Description**: As a user, I want to mount my Proton Drive as a network location in my file manager so that I can browse and manage my files using familiar desktop tools.
- **Acceptance criteria**:
  - Mount action uses GIO to create GVFS mount
  - Mount appears in file manager sidebar
  - Mount URI follows pattern `dav://localhost:<port>`
  - Mount operation completes within 5 seconds
  - Successful mount displays confirmation message
  - Mount persists until explicitly unmounted
  - File manager can be opened directly to mount point

### 10.9. Unmount Proton Drive

- **ID**: GH-009
- **Description**: As a user, I want to unmount my Proton Drive so that I can cleanly disconnect before shutting down or changing configurations.
- **Acceptance criteria**:
  - Unmount action uses GIO to remove GVFS mount
  - Mount disappears from file manager sidebar
  - Unmount operation completes within 5 seconds
  - Successful unmount displays confirmation message
  - Unmounting closes any file manager windows showing mount point
  - WebDAV server can remain running after unmount

### 10.10. Monitor mount status

- **ID**: GH-010
- **Description**: As a user, I want to see whether my Proton Drive is currently mounted so that I know the current state without opening the file manager.
- **Acceptance criteria**:
  - GUI displays mount status (Mounted, Not Mounted, Mounting, Error)
  - Status indicator uses color, icon, and text for accessibility
  - Status updates automatically when mount state changes
  - CLI `status` command shows mount information
  - Mount status includes mount point path when mounted

### 10.11. Configure WebDAV server port

- **ID**: GH-011
- **Description**: As a user, I want to change the WebDAV server port so that I can avoid conflicts with other services.
- **Acceptance criteria**:
  - Port configuration is accessible in GUI settings panel
  - Port number input validates range (1024-65535)
  - Changing port requires server restart
  - Application prompts user before restarting server
  - Port change persists across application restarts
  - Port conflicts are detected and reported before binding

### 10.12. Configure WebDAV server IP address

- **ID**: GH-012
- **Description**: As an advanced user, I want to configure the WebDAV server IP address so that I can allow access from other machines on my network.
- **Acceptance criteria**:
  - IP address configuration is accessible in GUI settings panel (advanced section)
  - IP address input validates format
  - Default value is localhost (127.0.0.1)
  - Security warning is displayed when binding to non-localhost addresses
  - IP change requires server restart
  - IP configuration persists across application restarts

### 10.13. Enable autostart on login

- **ID**: GH-013
- **Description**: As a user, I want the application to start automatically when I log into my desktop so that my Proton Drive is always available.
- **Acceptance criteria**:
  - Autostart toggle is available in GUI
  - Enabling autostart creates XDG autostart entry
  - Disabling autostart removes XDG autostart entry
  - Autostart preference persists across application restarts
  - Application launches silently when autostart is enabled
  - Autostart state is displayed correctly in GUI

### 10.14. View storage quota

- **ID**: GH-014
- **Description**: As a user, I want to see my Proton Drive storage usage and quota so that I know how much space is available.
- **Acceptance criteria**:
  - Storage quota is displayed in GUI dashboard
  - Display shows used space, total space, and percentage
  - Visual progress bar represents usage
  - Quota refreshes periodically (every 5 minutes)
  - Quota is displayed in human-readable units (GB, TB)
  - Near-full quota (>90%) displays warning indicator

### 10.15. View application logs

- **ID**: GH-015
- **Description**: As a user troubleshooting an issue, I want to view application logs so that I can understand what's happening and provide information for support.
- **Acceptance criteria**:
  - Log viewer is accessible from GUI (expandable section)
  - Logs display recent entries (last 100 lines)
  - Logs update in real-time as events occur
  - Log level filtering is available (error, warning, info, debug)
  - "Copy logs" button copies recent logs to clipboard
  - Logs include timestamps and severity levels

### 10.16. Purge metadata cache

- **ID**: GH-016
- **Description**: As a user experiencing stale data, I want to purge the metadata cache so that I can force-refresh all file and folder information.
- **Acceptance criteria**:
  - Cache purge button is available in GUI settings
  - Purge action requires confirmation
  - All cached metadata is deleted on purge
  - Success message confirms cache was cleared
  - File operations after purge fetch fresh data from API
  - CLI `purge-cache` command performs same action

### 10.17. Handle session expiration

- **ID**: GH-017
- **Description**: As a user, I want the application to automatically refresh my session when possible or prompt me to re-authenticate when necessary so that I experience minimal disruption.
- **Acceptance criteria**:
  - Application detects expired access tokens
  - Refresh tokens are used to obtain new access tokens automatically
  - User is not interrupted when automatic refresh succeeds
  - User is prompted to re-authenticate when refresh token expires
  - Re-authentication prompt is non-modal and dismissible
  - Server remains running during re-authentication flow

### 10.18. Browse files and folders

- **ID**: GH-018
- **Description**: As a user, I want to browse my Proton Drive files and folders in my file manager so that I can navigate my cloud storage like any other directory.
- **Acceptance criteria**:
  - Root directory listing shows top-level folders
  - Folders can be opened to reveal contents
  - Files display correct names and extensions
  - File sizes are shown accurately
  - Modification timestamps are displayed correctly
  - Hidden files and folders are handled according to WebDAV conventions

### 10.19. Upload files

- **ID**: GH-019
- **Description**: As a user, I want to upload files to my Proton Drive by copying or dragging them to the mounted location so that I can add content to my cloud storage.
- **Acceptance criteria**:
  - Files can be copied to mount point via file manager
  - Drag-and-drop operations work correctly
  - Upload progress is visible in file manager
  - End-to-end encryption is maintained during upload
  - Large files (>1GB) upload successfully
  - Failed uploads display error messages
  - Uploaded files appear in Proton Drive web interface

### 10.20. Download files

- **ID**: GH-020
- **Description**: As a user, I want to download files from my Proton Drive by opening or copying them from the mounted location so that I can access my cloud content locally.
- **Acceptance criteria**:
  - Files can be opened directly from mount point
  - Files can be copied from mount to local storage
  - File content is decrypted correctly during download
  - Large files (>1GB) download successfully
  - Download progress is visible in file manager
  - Downloaded file content matches original uploaded content

### 10.21. Delete files and folders

- **ID**: GH-021
- **Description**: As a user, I want to delete files and folders from the mounted Proton Drive so that I can manage my cloud storage through the file manager.
- **Acceptance criteria**:
  - Files can be deleted using file manager delete action
  - Folders can be deleted (including non-empty folders)
  - Deleted items are moved to Proton Drive trash
  - Deletion confirmation follows file manager conventions
  - Successful deletion removes item from mount view
  - Failed deletions display error messages

### 10.22. Rename files and folders

- **ID**: GH-022
- **Description**: As a user, I want to rename files and folders in my Proton Drive so that I can organize my content.
- **Acceptance criteria**:
  - Files can be renamed using file manager rename action
  - Folders can be renamed using file manager rename action
  - New names are validated (no invalid characters)
  - Renamed items update immediately in mount view
  - Rename operation preserves file content and metadata
  - Failed renames display error messages with specific reasons

### 10.23. Move files and folders

- **ID**: GH-023
- **Description**: As a user, I want to move files and folders within my Proton Drive so that I can reorganize my directory structure.
- **Acceptance criteria**:
  - Files can be moved between folders via drag-and-drop
  - Folders can be moved to different parent folders
  - Move operation preserves file content and metadata
  - Move progress is visible for large operations
  - Moved items appear in new location immediately
  - Failed moves display error messages

### 10.24. Create new folders

- **ID**: GH-024
- **Description**: As a user, I want to create new folders in my Proton Drive so that I can organize my files.
- **Acceptance criteria**:
  - New folders can be created using file manager "New Folder" action
  - Folder names are validated (no invalid characters)
  - Created folders appear immediately in mount view
  - Created folders are synced to Proton Drive
  - Failed creation displays error message

### 10.25. Handle network errors gracefully

- **ID**: GH-025
- **Description**: As a user experiencing network issues, I want the application to handle connection problems gracefully so that I don't lose data or experience crashes.
- **Acceptance criteria**:
  - Temporary network failures trigger automatic retry (up to 3 attempts)
  - Extended network outages display clear error messages
  - Application does not crash on network errors
  - File operations in progress are either completed or rolled back cleanly
  - Status indicator shows "Connection Error" state during outages
  - Application recovers automatically when network is restored

### 10.26. Handle port conflicts

- **ID**: GH-026
- **Description**: As a user, I want to be notified if the WebDAV server port is already in use so that I can choose a different port.
- **Acceptance criteria**:
  - Port conflict is detected before attempting to start server
  - Error message clearly states the port is in use
  - Suggested alternative ports are provided
  - User can change port from error notification
  - Application does not crash on port conflict

### 10.27. Install via Flatpak

- **ID**: GH-027
- **Description**: As a Linux user, I want to install the application from Flathub so that I can easily install and update it on any distribution.
- **Acceptance criteria**:
  - Application is available on Flathub
  - Installation completes successfully on major distributions (Ubuntu, Fedora, Arch)
  - All required permissions are requested during installation
  - Application launches successfully after Flatpak installation
  - Updates are delivered through Flatpak update mechanism

### 10.28. CLI status command

- **ID**: GH-028
- **Description**: As a power user, I want to check application status from the command line so that I can monitor the bridge in scripts and terminal workflows.
- **Acceptance criteria**:
  - `status` command displays server status (running/stopped)
  - Command shows authentication status (logged in/logged out)
  - Command shows current configuration (port, IP, cache settings)
  - `--json` flag outputs machine-readable JSON
  - Command completes within 1 second
  - Exit code indicates overall health (0 = healthy, non-zero = problems)

### 10.29. CLI authentication commands

- **ID**: GH-029
- **Description**: As a power user, I want to manage authentication from the command line so that I can integrate the bridge into automated workflows.
- **Acceptance criteria**:
  - `auth login` prompts for credentials interactively
  - `auth login --username <email>` pre-fills email address
  - `auth status` shows current authentication state
  - `auth logout` removes stored credentials
  - All commands provide clear success/failure messages
  - Credentials are securely stored in keyring from CLI

### 10.30. CLI server control

- **ID**: GH-030
- **Description**: As a power user, I want to start and stop the WebDAV server from the command line so that I can control the bridge without the GUI.
- **Acceptance criteria**:
  - `start` command starts the WebDAV server
  - `start --port <PORT>` starts with custom port
  - `start --daemon` starts in background mode
  - `stop` command stops the WebDAV server
  - Commands provide feedback about server state
  - Exit codes indicate success/failure

### 10.31. Open file manager at mount point

- **ID**: GH-031
- **Description**: As a user, I want to click a button to open my file manager at the Proton Drive mount point so that I can quickly access my files.
- **Acceptance criteria**:
  - "Open in Files" button is available in GUI when mounted
  - Button launches default file manager
  - File manager opens directly to mount point (not root)
  - Button is disabled when drive is not mounted
  - Works across different file managers (Nautilus, Dolphin, Thunar)

### 10.32. System tray integration

- **ID**: GH-032
- **Description**: As a user, I want a system tray icon showing connection status so that I can monitor the bridge without keeping the main window open.
- **Acceptance criteria**:
  - System tray icon appears when application is running
  - Icon changes based on status (connected, disconnected, error)
  - Right-click menu provides quick actions (mount/unmount, show window, quit)
  - Left-click opens main application window
  - Icon respects system theme (light/dark mode)
  - Tooltip shows current status on hover

### 10.33. Adwaita design language

- **ID**: GH-033
- **Description**: As a GNOME user, I want the application to follow Adwaita design language so that it feels native and consistent with my desktop environment.
- **Acceptance criteria**:
  - UI uses Adwaita color palette and typography
  - Buttons, inputs, and controls match GNOME design patterns
  - Dark mode support using Adwaita dark theme
  - Proper spacing and padding following GNOME HIG
  - Animations and transitions match platform conventions
  - Application feels native to GNOME users

### 10.34. Keyboard navigation

- **ID**: GH-034
- **Description**: As a keyboard user, I want to navigate the entire application using keyboard shortcuts so that I can use the bridge efficiently without a mouse.
- **Acceptance criteria**:
  - Tab key navigates between interactive elements
  - Enter/Space activates buttons and toggles
  - Escape closes dialogs and returns to previous screen
  - All functionality is accessible via keyboard
  - Focus indicators are clearly visible
  - Keyboard shortcuts are documented in help

### 10.35. Accessible error messages

- **ID**: GH-035
- **Description**: As a user, I want clear, actionable error messages when something goes wrong so that I can resolve issues without technical knowledge.
- **Acceptance criteria**:
  - Error messages use plain language (avoid technical jargon)
  - Errors explain what happened and why
  - Errors provide specific next steps or solutions
  - Authentication errors distinguish between wrong password, network issues, and other failures
  - Mount errors suggest troubleshooting steps
  - Error messages are screen-reader friendly
