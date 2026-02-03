export interface Status { server: { running: boolean; pid?: number | null; url?: string | null }; auth: { loggedIn: boolean; username?: string | null }; config: any; logFile?: string }

export async function runSidecarCommand(args: string[], opts?: { delayMs?: number; mounted?: string | null }): Promise<{ stdout: string; stderr: string }> {
  const delay = opts?.delayMs || 0
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))

  const cmd = args[0]
  if (cmd === 'status') {
    // return a JSON status when '--json' specified
    const json = {
      server: { running: true, pid: 12345, url: 'http://127.0.0.1:8080' },
      auth: { loggedIn: false, username: null },
      storage: { used: 1024, total: 4096 },
      config: {
        webdav: { host: '127.0.0.1', port: 8080, https: false, requireAuth: true },
        remotePath: '/',
      },
      logFile: '/dev/null',
    }
    // Simulate human-readable output plus JSON (like the real sidecar might emit)
    const stdout = `Proton Drive WebDAV Bridge Status\n${JSON.stringify(json, null, 2)}\n`
    return { stdout, stderr: '' }
  }

  if (cmd === 'check_mount_status') {
    // If mounted provided, return it; else return nothing
    const mounted = opts?.mounted ?? null
    if (mounted) return { stdout: mounted, stderr: '' }
    return { stdout: '', stderr: '' }
  }

  // default
  return { stdout: '', stderr: '' }
}
