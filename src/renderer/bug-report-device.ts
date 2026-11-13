export async function readDeviceInfo(): Promise<Record<string, string>> {
  if (import.meta.env.MODE === 'android') {
    const { vmBridge } = await import('../platform/android-native');
    return vmBridge.bugReportDeviceInfo();
  }
  return { os: navigator.platform, webView: navigator.userAgent };
}
