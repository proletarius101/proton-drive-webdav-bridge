/**
 * Electron Forge Configuration
 * Uses @electron-forge/plugin-vite to manage all Vite builds for main, preload, and renderer
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  packagerConfig: {
    name: 'Proton Drive WebDAV Bridge',
    executableName: 'proton-drive-webdav-bridge',
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(
      {
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
        signWithParams: process.env.WINDOWS_CERTIFICATE_FILE
          ? `/f ${process.env.WINDOWS_CERTIFICATE_FILE} /p ${process.env.WINDOWS_CERTIFICATE_PASSWORD} /tr http://timestamp.comodoca.com /td sha256`
          : undefined,
      },
      ['win32']
    ),
    new MakerZIP({}, ['darwin']),
    new MakerDeb(
      {
        options: {
          categories: ['Utility'],
        },
      },
      ['linux']
    ),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds for Main process, Preload scripts, Worker process, etc.
      build: [
        {
          // `entry` is an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src-electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src-electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Electron Fuses for security hardening
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'protonprivacy',
          name: 'proton-drive-webdav-bridge',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
};
