import { LinuxNetworkRoutingProvider } from './linux.ts';
import { MacOSNetworkRoutingProvider } from './macos.ts';
import type { NetworkRoutingProvider } from './types.ts';
import { WindowsNetworkRoutingProvider } from './windows.ts';

/** Used on platforms without an implementation: the setting cannot be turned on, existing behavior is unchanged. */
export class UnsupportedNetworkRoutingProvider implements NetworkRoutingProvider {
  constructor(readonly platform: string) {}
  support() {
    return { supported: false, verified: false, note: `مسیریابی انتخابی روی سیستم‌عامل «${this.platform}» پشتیبانی نمی‌شود.` };
  }
  async snapshot() {
    return { interfaces: [], vpn: null, direct: null, fullTunnel: false };
  }
  async relayCommand() {
    return null;
  }
}

/** The provider for this operating system. Add new platforms here. */
export function createRoutingProvider(platform: NodeJS.Platform = process.platform): NetworkRoutingProvider {
  switch (platform) {
    case 'linux':
      return new LinuxNetworkRoutingProvider();
    case 'win32':
      return new WindowsNetworkRoutingProvider();
    case 'darwin':
      return new MacOSNetworkRoutingProvider();
    default:
      return new UnsupportedNetworkRoutingProvider(platform);
  }
}
